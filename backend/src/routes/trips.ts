import { Router, Request, Response } from "express";
import { callAi, extractJson, isAiConfigured } from "../aiCore";
import { TRIP_SYSTEM_PROMPT, buildTripPrompt, TripRequest } from "../tripPrompt";
import { errorBody } from "../middleware/errors";
import { requestId } from "../middleware/requestContext";
import { getSupabaseAdmin } from "../supabaseAdmin";
import {
  loadFolderContext,
  FolderAccessError,
  type FolderPlace,
} from "../folderContext";
import {
  enrichDestinations,
  nameSimilarity,
  NAME_SIMILARITY_THRESHOLD,
} from "../placeLookup";
import { fetchNearbyAttractions, type NearbyAttraction } from "../googleMaps";
import { detectProvinceInText } from "../communityContext";
import type { LocationScope } from "../placeScope";
import {
  buildTripPlan,
  type AiSelection,
  type AiStop,
  type CandidateStop,
  type PlanPoint,
} from "../tripPlanner";
import { routeBetween, haversineKm, type LatLng } from "../routing";
import {
  getVehicle,
  FUEL_TYPE_LABELS,
  type FuelType,
} from "../vehicles";
import { fetchFuelPrices, resolveFuelPrice } from "../fuelPrice";
import { findLodging } from "../lodging";
import { config, isPlacesConfigured } from "../config";

const router = Router();

/** Build a reasonable offline itinerary when AI isn't configured. */
function stubItinerary(req: TripRequest) {
  const stops = [req.startPoint, ...req.destinations];
  const perDay = Math.max(1, Math.ceil(stops.length / req.days));
  const days = [];
  let idx = 0;
  for (let d = 1; d <= req.days; d++) {
    const dayStops = [];
    for (let k = 0; k < perDay && idx < stops.length; k++, idx++) {
      dayStops.push({
        name: stops[idx],
        activity: d === 1 && k === 0 ? "เริ่มต้นเดินทาง" : "สำรวจชุมชน / พักผ่อน",
        stayHours: 2 + (k % 2),
        driveToNextMins: 60 + ((idx * 25) % 90),
      });
    }
    if (dayStops.length === 0) {
      dayStops.push({ name: "พักผ่อนอิสระ", activity: "เที่ยวชมรอบที่พัก", stayHours: 3, driveToNextMins: 0 });
    }
    days.push({ day: d, stops: dayStops });
  }

  const lodging = req.nights * 500;
  const fuel = req.days * 350;
  const food = req.days * 400;
  const total = lodging + fuel + food;
  return {
    title: `ทริป ${req.destinations[0] ?? req.startPoint} ${req.days} วัน`,
    summary: `โร้ดทริปสไตล์ ${req.style} เริ่มจาก ${req.startPoint}`,
    days,
    budget: {
      lodging,
      fuel,
      food,
      total,
      perPerson: total,
      withinBudget: total <= req.budgetPerPerson,
    },
    source: "stub",
  };
}

/** แปลงสถานที่ที่ resolve ได้ → รูปแบบที่ใส่ใน prompt (พร้อมที่มา) */
function toPromptPlace(p: FolderPlace): Record<string, unknown> {
  return {
    name: p.name,
    // "registry" = ยืนยันในทะเบียนแล้ว / "clip" = มาจากข้อความในคลิป (ยังไม่ยืนยัน)
    source: p.source,
    confirmed: p.source === "registry",
    match: p.matchKind,
    clips: p.clipCount,
    community: p.communityName,
    address: p.address,
    province: p.province,
    district: p.district,
    latitude: p.latitude,
    longitude: p.longitude,
    price: p.facts.price,
    opening_hours: p.facts.openingHours,
    phone: p.facts.phone,
    facilities: p.facts.facilities,
    highlights: p.facts.highlights,
    rating: p.facts.rating,
  };
}

/** บรรทัดข้อมูลสถานที่ 1 แห่ง (จาก Google) ในรูปแบบที่โมเดลอ่านง่าย */
function formatGooglePlaceLine(p: any): string {
  const where = [p.subdistrict, p.district, p.province].filter(Boolean).join(" ");
  const bits: string[] = [];
  if (where) bits.push(where);
  if (p.phone) bits.push(`เบอร์ ${p.phone}`);
  if (p.openingHours) bits.push(`เปิด ${p.openingHours}`);
  if (p.priceLevel) bits.push(`ราคา ${p.priceLevel}`);
  if (p.rating != null) {
    bits.push(
      `เรตติง ${p.rating}${p.userRatingsTotal != null ? ` (${p.userRatingsTotal} รีวิว)` : ""}`
    );
  }
  if (p.category) bits.push(`ประเภท ${p.category}`);
  if (p.businessStatus) bits.push(`สถานะ ${p.businessStatus}`);
  if (p.website) bits.push(`เว็บ ${p.website}`);
  if (p.googleMapsUrl) bits.push(`แมพ ${p.googleMapsUrl}`);
  return `- ${p.placeName}${bits.length ? ` | ${bits.join(" | ")}` : ""}`;
}

/** บรรทัดจุดใกล้เคียง 1 แห่ง */
function formatNearbyLine(n: NearbyAttraction): string {
  const bits: string[] = [];
  if (n.label) bits.push(n.label);
  if (n.distanceKm != null) bits.push(`ระยะ ${n.distanceKm.toFixed(1)} กม.`);
  if (n.rating != null) bits.push(`เรตติง ${n.rating.toFixed(1)}`);
  return `- ${n.name}${bits.length ? ` | ${bits.join(" | ")}` : ""}`;
}

/**
 * บล็อกข้อมูลสถานที่จาก Google สำหรับแผนทริป
 * -------------------------------------------------------------
 * แนบไปท้าย system prompt ก้อนเดียว (ข้อมูล + กฎ "ห้ามเดา")
 * ถ้าไม่มีข้อมูลเลย → คืน "" (ไม่เพิ่มบล็อกเปล่า)
 *
 * export ไว้ให้เทสต์ออฟไลน์ได้ (scripts/place_lookup_test.ts)
 */
export function buildGoogleBlock(
  places: any[],
  nearby: NearbyAttraction[],
  nearbyFor: string
): string {
  const parts: string[] = [];
  if (places.length) {
    parts.push(
      `[ข้อมูลสถานที่จาก Google Maps ของจุดหมายในแผน (google_places)]\n` +
        places.map(formatGooglePlaceLine).join("\n")
    );
  }
  if (nearby.length && nearbyFor) {
    parts.push(
      `[จุดใกล้เคียงของ "${nearbyFor}" (nearby_attractions)]\n` +
        nearby.slice(0, 6).map(formatNearbyLine).join("\n")
    );
  }
  if (!parts.length) return "";
  return (
    parts.join("\n\n") +
    "\n\nกฎ: ข้อมูลชุดนี้มาจาก Google Maps ยังไม่มีเจ้าของหรือชุมชนยืนยัน " +
    "ใช้ประกอบได้ตามที่เขียนไว้ แต่ถ้าจุดไหนไม่มีข้อมูลในบล็อกนี้ห้ามเดาค่าเอง " +
    "ให้เขียนว่ายังไม่มีข้อมูลและแนะนำให้เช็กในแผนที่ก่อน"
  );
}

/** วันสิ้นสุด = วันเริ่ม + (จำนวนวัน - 1) — คืน null ถ้าไม่มีวันเริ่ม */function computeEndDate(departDate: string | undefined, days: number): string | null {
  if (!departDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(departDate.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Math.max(0, days - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * เขียนแพลนลงตาราง `trip_plans`
 * -------------------------------------------------------------
 * ไม่ throw — ถ้าบันทึกไม่สำเร็จ แผนยังถูกส่งคืนให้แอปได้ (เก็บไว้ในเครื่อง)
 * และตอบ `persisted: false` + เหตุผล ให้ UI แสดงว่า "บันทึกลงระบบไม่สำเร็จ"
 */
export async function persistPlan(params: {
  admin: any;
  creatorId: string;
  folderId: string | null;
  folderName: string | null;
  tripReq: TripRequest;
  plan: any;
  source: string;
  /** ข้อมูลเพิ่มเติมที่จะเก็บใน __meta (ใช้กับ /trips/plan) */
  extraMeta?: Record<string, unknown>;
  /**
   * รหัสแผนเดิมที่ต้องการอัปเดตทับ (จากแอป: แก้แผนที่บันทึกไว้แล้ว → ยืนยันอีกครั้ง)
   * → ถ้ามีและเป็นแผนของผู้ใช้คนนี้ จะอัปเดตแถวเดิม (ไม่สร้างแผนซ้ำ)
   */
  existingPlanId?: string | null;
}): Promise<{ planId: string | null; persisted: boolean; reason?: string }> {
  const { admin, creatorId, folderId, folderName, tripReq, plan, source } = params;
  const planName = String(
    plan?.title || `${folderName || tripReq.startPoint} ${tripReq.days} วัน`
  ).slice(0, 100);

  const itineraryData = {
    ...(plan && typeof plan === "object" ? plan : {}),
    __meta: {
      source,
      generatedAt: new Date().toISOString(),
      // ค่าของแอป (draft|planned|active|completed) — คอลัมน์ status ใน DB
      // บังคับเป็น upcoming|draft|past คนละชุดกัน เก็บของแอปไว้ที่นี่
      appStatus: "draft",
      destinations: tripReq.destinations,
      folderPlaces: tripReq.folderPlaces ?? [],
      ...(params.extraMeta ?? {}),
    },
  };

  const columns = {
    creator_id: creatorId,
    source_folder_id: folderId,
    plan_name: planName,
    start_location: tripReq.startPoint,
    return_location: tripReq.endPoint ?? null,
    start_date: tripReq.departDate ?? null,
    end_date: computeEndDate(tripReq.departDate, tripReq.days),
    budget_limit: tripReq.budgetPerPerson,
    travel_style: tripReq.style.slice(0, 30),
    itinerary_data: itineraryData,
    is_shared: false,
  };

  try {
    // ── อัปเดตแผนเดิม (ถ้ามี) ────────────────────────────────────────
    // เช็กเจ้าของแถวด้วย → ผู้ใช้คนอื่นอัปเดตแผนของเราไม่ได้
    const existingId = String(params.existingPlanId ?? "").trim();
    if (existingId) {
      const { data: existing, error: findErr } = await admin
        .from("trip_plans")
        .select("id, creator_id, itinerary_data")
        .eq("id", existingId)
        .eq("creator_id", creatorId)
        .maybeSingle();
      if (findErr) {
        console.warn("[trips] อ่านแผนเดิมเพื่ออัปเดตไม่สำเร็จ:", findErr.message);
      } else if (existing?.id) {
        // เก็บสถานะของแอปไว้ (ผู้ใช้อาจเปลี่ยนสถานะเองแล้ว)
        const prevMeta = (existing.itinerary_data ?? {})?.__meta ?? {};
        const { error: updErr } = await admin
          .from("trip_plans")
          .update({
            ...columns,
            itinerary_data: {
              ...itineraryData,
              __meta: {
                ...itineraryData.__meta,
                ...(prevMeta.appStatus ? { appStatus: prevMeta.appStatus } : {}),
                ...(prevMeta.editedAt ? { editedAt: prevMeta.editedAt } : {}),
              },
            },
          })
          .eq("id", existing.id)
          .eq("creator_id", creatorId);
        if (!updErr) {
          return { planId: existing.id, persisted: true };
        }
        console.warn("[trips] อัปเดตแผนเดิมไม่สำเร็จ:", updErr.message);
        // อัปเดตไม่สำเร็จ → ลอง insert ใหม่ต่อไป (ดีกว่าไม่บันทึกเลย)
      }
    }

    const { data, error } = await admin
      .from("trip_plans")
      .insert({
        ...columns,
        // check constraint: status in ('upcoming','draft','past')
        status: "draft",
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[trips] บันทึก trip_plans ไม่สำเร็จ:", error.message);
      return { planId: null, persisted: false, reason: error.message };
    }
    return { planId: data?.id ?? null, persisted: true };
  } catch (e: any) {
    console.warn("[trips] บันทึก trip_plans ไม่สำเร็จ:", e?.message ?? e);
    return { planId: null, persisted: false, reason: e?.message ?? "บันทึกไม่สำเร็จ" };
  }
}

/**
 * POST /trips/generate
 * -------------------------------------------------------------
 * Turn wizard inputs (+ clips chosen from a folder) into a road-trip itinerary.
 *
 * Body: TripRequest {
 *   startPoint, destinations[], days, nights, budgetPerPerson, style
 *   folderId?   // ใหม่ — backend โหลดโฟลเดอร์เองแล้วใช้สถานที่จริงเป็นจุดหมาย
 * }
 *
 * ถ้ามี `folderId`:
 *   · ต้องมี Bearer token → uid
 *   · backend อ่านคลิปจริง → จับคู่ทะเบียน → ได้รายชื่อสถานที่ + ข้อมูลจริง
 *   · จุดหมายของแผน = สถานที่ในโฟลเดอร์ (ไม่ใช่ชื่ออิสระจาก client)
 *   · เขียนแผนลง `trip_plans` ผูกด้วย `source_folder_id`
 */
router.post("/generate", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const tripReq: TripRequest = {
    startPoint: String(b.startPoint ?? "").trim() || "สนามบินเชียงใหม่",
    destinations: Array.isArray(b.destinations) ? b.destinations : [],
    days: Number(b.days) > 0 ? Number(b.days) : 3,
    nights: Number(b.nights) >= 0 ? Number(b.nights) : 2,
    budgetPerPerson: Number(b.budgetPerPerson) > 0 ? Number(b.budgetPerPerson) : 3000,
    style: String(b.style ?? "").trim() || "โร้ดทริปเน้นธรรมชาติ",
  };
  if (typeof b.endPoint === "string" && b.endPoint.trim()) {
    tripReq.endPoint = b.endPoint.trim();
  }
  if (typeof b.departDate === "string" && b.departDate.trim()) {
    tripReq.departDate = b.departDate.trim();
  }

  // ── โฟลเดอร์ (path ใหม่): ให้ backend เป็นคนหาจุดหมายเอง ──────────
  const folderId: string | null =
    typeof b.folderId === "string" && b.folderId.trim() ? b.folderId.trim() : null;
  let creatorId: string | null = null;
  let folderResolved = false;
  let folderWarning: string | null = null;

  if (folderId) {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({
        error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
        code: "NOT_CONFIGURED",
        requestId: requestId(req),
      });
    }

    const token = /^Bearer\s+(.+)$/i
      .exec(req.header("authorization") ?? "")?.[1]
      ?.trim();
    if (!token) {
      return res.status(401).json({
        error: "ต้องล็อกอินเพื่อสร้างแพลนจากโฟลเดอร์",
        code: "UNAUTHORIZED",
        requestId: requestId(req),
      });
    }

    try {
      const { data: verified, error: verifyErr } = await admin.auth.getUser(token);
      if (verifyErr || !verified?.user?.id) {
        return res.status(401).json({
          error: "โทเค็นไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
          code: "UNAUTHORIZED",
          requestId: requestId(req),
        });
      }
      creatorId = verified.user.id;
    } catch (e: any) {
      return res.status(401).json({
        error: "ตรวจสอบสิทธิ์ไม่สำเร็จ",
        code: "UNAUTHORIZED",
        requestId: requestId(req),
      });
    }

    try {
      const ctx = await loadFolderContext(admin, folderId, creatorId);
      folderResolved = true;
      tripReq.sourceFolderId = folderId;
      tripReq.sourceFolderName = ctx.folderName;
      tripReq.folderPlaces = ctx.places.map(toPromptPlace);

      const names = ctx.places.map((p) => p.name).filter(Boolean);
      if (names.length) {
        // จุดหมายของแพลน = สถานที่ในโฟลเดอร์ (ถ้าผู้ใช้เลือกเองด้วย → รวมเข้าไป)
        const extra = tripReq.destinations.filter(
          (d) => d && !names.includes(d)
        );
        tripReq.destinations = [...names, ...extra];
      } else {
        folderWarning =
          "ยังไม่มีข้อมูลสถานที่ในคลิปของโฟลเดอร์นี้ — แผนที่ได้จึงเป็นแผนทั่วไป ไม่ได้อิงสถานที่ในโฟลเดอร์";
      }
    } catch (e: any) {
      if (e instanceof FolderAccessError) {
        return res.status(e.status).json({
          error: e.message,
          code: e.code,
          requestId: requestId(req),
        });
      }
      return res.status(500).json({
        error: "โหลดข้อมูลโฟลเดอร์ไม่สำเร็จ",
        code: "READ_FAILED",
        requestId: requestId(req),
      });
    }
  }

  const admin = getSupabaseAdmin();

  /** สร้างแผน + บันทึก + ตอบ */
  const respond = async (plan: any, source: string, fallbackReason?: string) => {
    let planId: string | null = null;
    // undefined = ไม่ได้พยายามบันทึก (ไม่มีโฟลเดอร์ → ไม่มีผู้สร้าง)
    // false = พยายามบันทึกแล้วไม่สำเร็จ → แอปต้องเตือนผู้ใช้
    let persisted: boolean | undefined;
    let persistReason: string | undefined;

    if (creatorId && admin) {
      const saved = await persistPlan({
        admin,
        creatorId,
        folderId: tripReq.sourceFolderId ?? null,
        folderName: tripReq.sourceFolderName ?? null,
        tripReq,
        plan,
        source,
      });
      planId = saved.planId;
      persisted = saved.persisted;
      persistReason = saved.reason;
    }

    return res.json({
      ...plan,
      source,
      ...(fallbackReason ? { fallbackReason } : {}),
      planId,
      ...(persisted !== undefined ? { persisted } : {}),
      ...(persistReason ? { persistReason } : {}),
      folderResolved,
      ...(folderWarning ? { folderWarning } : {}),
    });
  };

  if (!isAiConfigured()) {
    return respond(
      stubItinerary(tripReq),
      "local-fallback",
      "ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์"
    );
  }

  // ── จุดหมายที่ยังไม่มีข้อมูล → ดึงจาก Google (สูงสุด 4 จุด) ────────
  // จุดหมายที่มาจากโฟลเดอร์มีข้อมูลอยู่แล้ว → ไม่ยิงซ้ำ
  let googleBlock = "";
  try {
    const folderPlaces = (tripReq.folderPlaces ?? []) as any[];
    const folderNames = new Set(
      folderPlaces.map((p) => String(p?.name ?? "").trim()).filter(Boolean)
    );
    const rawNames = tripReq.destinations
      .map((d) => String(d ?? "").trim())
      .filter((d) => d && !folderNames.has(d));
    // จังหวัดจากโฟลเดอร์ (สถานที่ในโฟลเดอร์มักอยู่จังหวัดเดียวกัน) → ใช้กรองชื่อที่ค้นเจอ
    const folderProvince =
      folderPlaces.map((p) => String(p?.province ?? "").trim()).find(Boolean) ?? null;
    const scope: LocationScope = {
      community: null,
      province:
        folderProvince ??
        detectProvinceInText(`${rawNames.join(" ")} ${tripReq.startPoint}`),
      district: null,
      subdistrict: null,
    };
    const { contexts } = await enrichDestinations({ names: rawNames, scope, max: 4 });

    // จุดใกล้เคียงของจุดหมายหลัก 1 จุด (ห้ามเกิน — คิดเงินคำขอ Google)
    let nearby: NearbyAttraction[] = [];
    let nearbyFor = "";
    const top = contexts[0];
    if (top) {
      try {
        nearby = await fetchNearbyAttractions({
          placeName: top.placeName,
          district: top.district ?? null,
          province: top.province ?? null,
        });
        nearbyFor = top.placeName;
      } catch (e: any) {
        console.warn("[trips] ดึงจุดใกล้เคียงไม่สำเร็จ:", e?.message ?? e);
      }
    }
    googleBlock = buildGoogleBlock(contexts, nearby, nearbyFor);
  } catch (e: any) {
    // ล้มเหลว = ไม่มีบล็อกข้อมูลเพิ่ม → แผนยังสร้างได้เหมือนเดิม
    console.warn("[trips] เติมข้อมูลสถานที่จาก Google ไม่สำเร็จ:", e?.message ?? e);
  }

  try {
    const raw = await callAi({
      system: googleBlock ? `${TRIP_SYSTEM_PROMPT}\n\n${googleBlock}` : TRIP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildTripPrompt(tripReq) }],
      maxTokens: 2048,
    });
    const parsed = extractJson(raw);
    if (parsed && Array.isArray(parsed.days)) {
      return await respond(parsed, "ai");
    }
    // AI replied but not valid JSON → fall back to a usable plan.
    return await respond(
      stubItinerary(tripReq),
      "local-fallback",
      "AI ตอบมาไม่ใช่ JSON ที่ใช้ได้"
    );
  } catch (err: any) {
    const body = errorBody(err, req);
    // Keep `fallback` so the app can still render a usable trip, but now the
    // real reason rides along instead of being silently dropped.
    return res.status(502).json({
      ...body,
      fallback: stubItinerary(tripReq),
      folderResolved,
      ...(folderWarning ? { folderWarning } : {}),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
//  วางแผนทริปจริง (POST /trips/plan)
// ─────────────────────────────────────────────────────────────────────────

/**
 * กติกาเพิ่มเติมให้ AI ตอบเฉพาะส่วนที่ระบบคำนวณต่อได้เอง
 * (ระบบคำนวณเวลา/ระยะ/ค่าน้ำมันใหม่ทั้งหมดหลังจาก AI ตอบ)
 */
const PLAN_SELECTION_RULES = `
[ข้อกำหนดของระบบวางแผน — สำคัญที่สุด]
ระบบจะคำนวณ "เวลา · ระยะทาง · เส้นทางจริง · ค่าน้ำมัน · ค่าใช้จ่าย" ใหม่ทั้งหมดหลังจากคุณตอบ
ดังนั้นคุณทำแค่ 3 อย่าง:
1. เลือกว่าควรไปจุดไหนจาก "สถานที่ในโฟลเดอร์ที่ผู้ใช้เลือก" และจัดว่าวันไหนไปจุดไหน
2. บอกกิจกรรม (activity) · คำอธิบาย (description) · เวลาที่ควรพัก (stayHours) ของแต่ละจุด
3. ประมาณค่าอาหาร · ค่ากิจกรรม · ค่าอื่น แยกเป็นรายการ (ตัวเลขต่อคน)
ห้ามคิดเวลาเดินทางเอง · ห้ามเดาราคาน้ำมัน (ใช้บล็อก fuel ที่ส่งไป) · ห้ามเพิ่มสถานที่ที่ไม่ได้อยู่ในบล็อกสถานที่
ชื่อสถานที่ต้องตรงกับบล็อกสถานที่ทุกตัวอักษร · ถ้าจำไม่ได้ให้ไม่ใส่ชื่อนั้น
แผนหลายวัน: ให้จุดใกล้กันอยู่วันเดียวกัน · วันสุดท้ายต้องจบที่จุดสิ้นสุดที่ผู้ใช้ระบุ
`;

/** ประเภทจุดที่ระบบใช้ได้ (ใช้ refine ประเภทที่เดาจากชื่อ) */
const VALID_STOP_TYPES = new Set([
  "attraction",
  "community",
  "food",
  "cafe",
  "accommodation",
  "activity",
]);

/**
 * จุดในแผน (จุดเริ่ม/จุดสิ้นสุด) ที่แอปส่งมา — ต้องมีพิกัด
 * export ไว้ให้เทสต์ออฟไลน์ได้ (scripts/trip_plan_route_test.ts)
 */
export function readPlanPoint(raw: any): PlanPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const coords = raw.coords ?? raw.coordinates ?? raw;
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng ?? coords?.lon ?? coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const label = String(raw.label ?? raw.name ?? "").trim();
  const address = String(raw.address ?? "").trim();
  return {
    label: label || "จุดที่ไม่ระบุชื่อ",
    address: address || null,
    coords: { lat, lng },
  };
}

/** เดาประเภทจุดจากชื่อ (ทะเบียนไม่มีคอลัมน์ประเภทสถานที่) */
export function guessStopType(name: string): string {
  const n = String(name ?? "").toLowerCase();
  if (
    /บ้านพัก|โรงแรม|รีสอร์ท|คริสตัล|โฮมสเตย์|เกสต์เฮาส์|สถานที่พัก|แคมป์|hotel|resort|hostel|homestay|lodge/.test(
      n
    )
  )
    return "accommodation";
  if (/คาเฟ่|ร้านกาแฟ|coffee|cafe/.test(n)) return "cafe";
  if (/ร้านอาหาร|ร้านอาหาร|อาหาร|ร้าน|food|restaurant/.test(n)) return "food";
  if (
    /วัด|ศาสนา|มูลนิธิ|พิพิธภัณฑ์|โบราณสถาน|วัฒนธรรม|ชุมชน|หมู่บ้าน/.test(n)
  )
    return "community";
  return "attraction";
}

/** ชนิดน้ำมันจาก body (รับทั้ง key และชื่อที่แสดง) */
export function normalizeFuelType(raw: any): FuelType | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s in FUEL_TYPE_LABELS) return s as FuelType;
  const hit = Object.keys(FUEL_TYPE_LABELS).find((k) => FUEL_TYPE_LABELS[k] === s);
  return (hit as FuelType) ?? null;
}

/**
 * เดาชนิดน้ำมันจากชื่อ/รุ่นรถที่ผู้ใช้พิมพ์
 * -------------------------------------------------------------
 * ผู้ใช้กรอกชื่อรถเอง (เช่น "Isuzu D-Max", "Toyota Corolla Altis")
 * แล้วให้เอไaiเป็นคนระบุชนิดน้ำมัน · แต่ถ้าผู้ใช้กดสร้างแพลนเลย
 * โดยยังไม่ได้คุยกับเอไai → ต้องมีค่าเริ่มต้นที่ใกล้เคียงที่สุด
 *
 * เป็นแค่ "ค่าเริ่มต้น" — ค่าที่เอไaiระบุมาจะชนะเสมอ
 * (ลำดับ: fuelType จาก body → เดาจากชื่อรถ → ค่าเริ่มต้นของโปรไฟล์รถ)
 */
export function inferFuelTypeFromVehicleModel(raw: any): FuelType | null {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (!s) return null;

  // ไฮบริด → ใช้น้ำมันเบนซินเหมือนกัน (เช็นก่อนรถไฟฟ้า เพราะบางรุ่นเป็นทั้งคู่)
  if (/hybrid/.test(s)) return "gasohol95";

  // รถไฟฟ้า
  if (
    /ไฟฟ้า|electric|\bev\b|\bev\d|\bbyd\b|\batto\b|\bioniq\b|\bdolphin\b|\bseagull\b|\bneta\b|\bmg4\b|\bora\b|\bbz\d/.test(
      s
    )
  ) {
    return "electric";
  }
  // ดีเซล
  if (/ดีเซล|เดเซล|diesel|\bd-?max\b|\bdmax\b|\bxenon\b|\bfortuner\b|\bhino\b/.test(s)) {
    return "dieselB20";
  }
  // แก๊สโซฮอล์ E20
  if (/\be-?20\b/.test(s)) return "gasoholE20";
  // แก๊สโซฮอล์ 91
  if (/แก๊สโซฮอล์\s*91|gasohol\s*91|\b91\b/.test(s)) return "gasohol91";
  // เบนซิน / พรีเมียม
  if (/เบนซิน|gasoline|premium/.test(s)) return "gasoline95";
  return null;
}

/**
 * จับคู่ชื่อที่ AI เขียนมากับจุดจริง
 * -------------------------------------------------------------
 * คืน null = ชื่อที่แต่งขึ้น (ไม่มีในโฟลเดอร์/ไม่มีในจุดที่ผู้ใช้เพิ่ม) → ต้องตัดทิ้ง
 */
export function reconcileName(
  name: string,
  candidates: CandidateStop[]
): CandidateStop | null {
  const target = String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
  if (!target) return null;
  for (const c of candidates) {
    const cn = c.name.toLowerCase().replace(/\s+/g, "").trim();
    if (cn && cn === target) return c;
  }
  let best: CandidateStop | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = nameSimilarity(name, c.name);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= NAME_SIMILARITY_THRESHOLD ? best : null;
}

/**
 * อ่าน "เวลาเปิด-ปิดที่เจ้าของยืนยัน" (business_hours) ของจุดในโฟลเดอร์
 * -------------------------------------------------------------
 * `community_places.business_hours` เป็น jsonb: {mon:[{open,close}], …}
 * `[]` = ปิดวันนั้น · key ที่ไม่มี = ไม่รู้
 * ถ้าคอลัมน์ยังไม่มีในฐานข้อมูล → คืนค่าว่าง (ไม่ทำให้ระบบล้ม)
 */
async function loadStructuredHours(
  admin: any,
  places: FolderPlace[]
): Promise<Map<string, { businessHours: any; businessPricing: any }>> {
  const out = new Map<string, { businessHours: any; businessPricing: any }>();
  const ids = places
    .map((p) => p.registryPlaceId)
    .filter((v): v is string => Boolean(v && String(v).trim()));
  if (!ids.length) return out;

  const read = async (column: string): Promise<any[]> => {
    try {
      const { data, error } = await admin
        .from("community_places")
        .select("place_id, id, place_name, business_hours, business_pricing")
        .in(column, ids)
        .limit(ids.length);
      if (error) return [];
      return (data ?? []) as any[];
    } catch {
      return [];
    }
  };

  const rows = [...(await read("place_id")), ...(await read("id"))];
  if (!rows.length) return out;

  const byId = new Map<string, any>();
  for (const row of rows) {
    if (row?.place_id) byId.set(String(row.place_id), row);
    if (row?.id) byId.set(String(row.id), row);
  }
  for (const p of places) {
    if (!p.registryPlaceId) continue;
    const row = byId.get(String(p.registryPlaceId));
    if (!row) continue;
    out.set(p.key, {
      businessHours: row.business_hours ?? null,
      businessPricing: row.business_pricing ?? null,
    });
  }
  return out;
}

/** ระยะจากจุดใกล้สุดในเส้นทาง (กม.) */
function distanceToRoute(point: LatLng, routePoints: LatLng[]): number {
  if (!routePoints.length) return 0;
  let best = Infinity;
  for (const p of routePoints) {
    const d = haversineKm(point, p);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * Google Places Legacy — nearbysearch
 * -------------------------------------------------------------
 * เขียนแยกไว้ในไฟล์นี้เพราะ `googleMaps.ts` ใช้ร่วมกับสรุปคลิปอยู่แล้ว (ห้ามแตะ)
 * ล้มเงียบ ๆ — ไม่มี key / ยิงไม่ผ่าน → คืน [] (ไม่ทำให้ทั้งระบบล้ม)
 */
async function googleNearbySearch(
  near: LatLng,
  radiusM: number,
  type: string | null
): Promise<any[]> {
  if (!isPlacesConfigured()) return [];
  const key = config.places.googleKey;
  if (!key) return [];

  const radius = Math.min(Math.max(1, Math.round(radiusM)), 50000);
  const url =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json" +
    `?location=${near.lat},${near.lng}` +
    `&radius=${radius}` +
    (type ? `&type=${encodeURIComponent(type)}` : "") +
    "&language=th" +
    `&key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const json: any = await res.json();
    if (json?.status !== "OK" || !Array.isArray(json.results)) return [];
    return json.results as any[];
  } catch (e: any) {
    console.warn("[trips/nearby] Google ล้ม:", e?.message ?? e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** ผลการจับคู่คำตอบของ AI กับจุดจริง */
export interface ReconciledPlan {
  selection: AiSelection | null;
  usedIds: Set<string>;
  droppedNames: string[];
  title?: string;
  summary?: string;
  tips?: string[];
  warnings?: string[];
  budget?: { food?: number; activities?: number; other?: number };
  typeOverrides: Map<string, string>;
}

/**
 * เอาจากคำตอบ AI เฉพาะส่วนที่ใช้ได้
 * -------------------------------------------------------------
 * · ชื่อสถานที่ต้องตรงกับจุดจริง → ชื่อที่แต่งขึ้นถูกตัดทิ้ง
 * · เวลา/ระยะ/ค่าน้ำมันของ AI ไม่ถูกใช้ (ระบบคำนวณใหม่)
 */
export function reconcileAiPlan(
  ai: any,
  candidates: CandidateStop[],
  days: number
): ReconciledPlan {
  const base: ReconciledPlan = {
    selection: null,
    usedIds: new Set<string>(),
    droppedNames: [],
    typeOverrides: new Map<string, string>(),
  };
  if (!ai || typeof ai !== "object" || !Array.isArray(ai.days)) return base;

  const usedIds = new Set<string>();
  const droppedNames: string[] = [];
  const typeOverrides = new Map<string, string>();
  const dayEntries: AiSelection["days"] = [];

  for (let d = 1; d <= days; d++) {
    const src =
      ai.days.find((x: any) => Number(x?.day) === d) ?? ai.days[d - 1] ?? {};
    const stops: AiStop[] = [];
    for (const s of Array.isArray(src?.stops) ? src.stops : []) {
      const rawName = String(s?.name ?? "").trim();
      if (!rawName) continue;
      const c = reconcileName(rawName, candidates);
      if (!c) {
        droppedNames.push(rawName);
        continue;
      }
      if (usedIds.has(c.id)) continue;
      usedIds.add(c.id);

      const aiType = String(s?.type ?? "").trim();
      if (VALID_STOP_TYPES.has(aiType) && c.type === "attraction") {
        typeOverrides.set(c.id, aiType);
      }

      stops.push({
        name: c.name,
        type: c.type,
        activity: typeof s?.activity === "string" ? s.activity : undefined,
        description:
          typeof s?.description === "string" ? s.description : undefined,
        stayHours:
          typeof s?.stayHours === "number" && s.stayHours > 0
            ? s.stayHours
            : undefined,
        note:
          typeof s?.note === "string" && s.note.trim() ? s.note : undefined,
      });
    }
    dayEntries.push({
      day: d,
      title: typeof src?.title === "string" ? src.title : undefined,
      theme: typeof src?.theme === "string" ? src.theme : undefined,
      stops,
    });
  }

  const budgetRaw = (ai.budget ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  return {
    selection: { days: dayEntries },
    usedIds,
    droppedNames,
    typeOverrides,
    title: typeof ai.title === "string" ? ai.title : undefined,
    summary: typeof ai.summary === "string" ? ai.summary : undefined,
    tips: Array.isArray(ai.tips)
      ? ai.tips.filter((t: any) => typeof t === "string")
      : undefined,
    warnings: Array.isArray(ai.warnings)
      ? ai.warnings.filter((t: any) => typeof t === "string")
      : undefined,
    budget: {
      food: num(budgetRaw.food),
      activities: num(budgetRaw.activities),
      other: num(budgetRaw.other),
    },
  };
}

/**
 * POST /trips/plan
 * -------------------------------------------------------------
 * วางแผนทริปจริง: โหลดจุดจากโฟลเดอร์ → ให้ AI เลือก/จัดวัน → คำนวณเส้นทางจริง (OSRM)
 * → คำนวณเวลาตามเวลาเปิด-ปิด → ค่าน้ำมันจากราคาสด → เสนอที่พัก (หลายวัน)
 *
 * Body: {
 *   folderId?, days, date?, startTime?,
 *   startPoint: {label, address?, coords:{lat,lng}},
 *   returnMode: "same_as_start" | "custom",
 *   endPoint?: {label, address?, coords:{lat,lng}},   // บังคับถ้า returnMode = "custom"
 *   dayEndPoints?: [...],                             // จุดสิ้นสุดของแต่ละวัน (หลายวัน)
 *   vehicle, fuelType?, travelers, budgetPerPerson, style,
 *   extraStops?: [{label, coords, ...}],
 *   fuelPriceOverride?, save?: boolean,
 *   planId?: string                         // รหัสแผนเดิม → อัปเดตทับแทนที่จะสร้างแผนใหม่
 * }
 */
router.post("/plan", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
      code: "NOT_CONFIGURED",
      requestId: requestId(req),
    });
  }

  // ── auth ────────────────────────────────────────────────────────────
  const token = /^Bearer\s+(.+)$/i
    .exec(req.header("authorization") ?? "")?.[1]
    ?.trim();
  if (!token) {
    return res.status(401).json({
      error: "ต้องล็อกอินเพื่อวางแผนทริป",
      code: "UNAUTHORIZED",
      requestId: requestId(req),
    });
  }
  let creatorId: string;
  try {
    const { data: verified, error: verifyErr } = await admin.auth.getUser(token);
    if (verifyErr || !verified?.user?.id) {
      return res.status(401).json({
        error: "โทเค็นไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
        code: "UNAUTHORIZED",
        requestId: requestId(req),
      });
    }
    creatorId = verified.user.id;
  } catch {
    return res.status(401).json({
      error: "ตรวจสอบสิทธิ์ไม่สำเร็จ",
      code: "UNAUTHORIZED",
      requestId: requestId(req),
    });
  }

  // ── ตรวจข้อมูลที่ต้องมี ──────────────────────────────────────────────
  const startPoint = readPlanPoint(b.startPoint);
  if (!startPoint) {
    return res.status(400).json({
      error: "ต้องเลือกจุดเริ่มต้นที่มีพิกัดก่อน",
      code: "BAD_REQUEST",
      requestId: requestId(req),
    });
  }

  const returnMode: "same_as_start" | "custom" =
    b.returnMode === "custom" ? "custom" : "same_as_start";
  let endPoint: PlanPoint;
  if (returnMode === "custom") {
    const p = readPlanPoint(b.endPoint);
    if (!p) {
      return res.status(400).json({
        error: "เลือกจุดสิ้นสุดตอนกลับที่มีพิกัด หรือเปลี่ยนกลับเป็น 'กลับจุดเดิม'",
        code: "BAD_REQUEST",
        requestId: requestId(req),
      });
    }
    endPoint = p;
  } else {
    endPoint = { ...startPoint };
  }

  const days = Math.min(7, Math.max(1, Math.round(Number(b.days) || 1)));
  const dateStr = String(b.date ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;
  const startTimeStr = String(b.startTime ?? "").trim();
  const startTime = /^\d{1,2}:\d{2}$/.test(startTimeStr)
    ? startTimeStr.padStart(5, "0")
    : "08:00";
  const vehicle = getVehicle(String(b.vehicle ?? ""));
  // ชื่อ/รุ่นรถที่ผู้ใช้กรอก (เช่น "Isuzu D-Max") — ใช้เป็นตัวช่วยเดาชนิดน้ำมัน
  const vehicleModelRaw = String(b.vehicleModel ?? "").trim().slice(0, 80);
  const vehicleModel = vehicleModelRaw || null;
  // ลำดับชนิดน้ำมัน: ที่เอไai/ผู้ใช้ระบุไว้ → เดาจากชื่อรถ → ค่าเริ่มต้นของโปรไฟล์รถ
  const fuelType =
    normalizeFuelType(b.fuelType) ??
    inferFuelTypeFromVehicleModel(vehicleModel) ??
    vehicle.defaultFuelType;
  // รถสาธารณะ = ไม่มีค่าน้ำมันในแผน
  const finalFuelType = vehicle.key === "public" ? null : fuelType;
  const travelers = Math.max(1, Math.round(Number(b.travelers) || 1));
  const budgetPerPerson =
    Number(b.budgetPerPerson) > 0 ? Number(b.budgetPerPerson) : 3000;
  const style =
    String(b.style ?? "").trim() || "ท่องเที่ยวธรรมชาติและชุมชนท้องถิ่น";
  const overrideNum = Number(b.fuelPriceOverride);
  const fuelPriceOverride =
    Number.isFinite(overrideNum) && overrideNum > 0 ? overrideNum : null;
  const dayEndPoints: (PlanPoint | null)[] = (
    Array.isArray(b.dayEndPoints) ? b.dayEndPoints : []
  )
    .slice(0, Math.max(0, days - 1))
    .map((p: any) => readPlanPoint(p));

  // ── โฟลเดอร์ ────────────────────────────────────────────────────────
  const folderId =
    typeof b.folderId === "string" && b.folderId.trim() ? b.folderId.trim() : null;
  let folderPlaces: FolderPlace[] = [];
  let folderName: string | null = null;
  let folderWarning: string | null = null;
  if (folderId) {
    try {
      const ctx = await loadFolderContext(admin, folderId, creatorId);
      folderPlaces = ctx.places;
      folderName = ctx.folderName;
    } catch (e: any) {
      if (e instanceof FolderAccessError) {
        return res.status(e.status).json({
          error: e.message,
          code: e.code,
          requestId: requestId(req),
        });
      }
      return res.status(500).json({
        error: "โหลดข้อมูลโฟลเดอร์ไม่สำเร็จ",
        code: "READ_FAILED",
        requestId: requestId(req),
      });
    }
  }

  // ── จุดที่เลือกได้ ──────────────────────────────────────────────────
  const structured = await loadStructuredHours(admin, folderPlaces);
  const candidates: CandidateStop[] = [];

  for (const p of folderPlaces) {
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const hours = structured.get(p.key);
    candidates.push({
      id: p.key,
      name: p.name,
      type: guessStopType(p.name),
      coordinates: { lat, lng },
      address: p.address,
      province: p.province,
      district: p.district,
      price: p.facts.price,
      openingHours: p.facts.openingHours,
      businessHours: hours?.businessHours ?? null,
      phone: p.facts.phone,
      rating: p.facts.rating,
      source: p.source === "registry" ? "community" : "estimated",
    });
  }

  // จุดที่ผู้ใช้เพิ่มเอง (จากแผนที่) → ต้องอยู่ในแผนเสมอ
  const extras = Array.isArray(b.extraStops) ? b.extraStops : [];
  extras.forEach((s: any, i: number) => {
    const point = readPlanPoint(s);
    if (!point) return;
    candidates.push({
      id: `u:${i}:${point.label}`,
      name: point.label,
      type: guessStopType(point.label),
      coordinates: point.coords,
      address: point.address ?? null,
      price: s?.price ?? null,
      openingHours: s?.openingHours ?? null,
      phone: s?.phone ?? null,
      website: s?.website ?? null,
      userAdded: true,
      source: "user",
    });
  });

  if (!candidates.length) {
    return res.status(400).json({
      error: "ยังไม่มีสถานที่ให้วางแผน — เลือกโฟลเดอร์ที่มีสถานที่ หรือเพิ่มจุดแวะเอง",
      code: "NO_STOPS",
      requestId: requestId(req),
    });
  }

  // ── จุดที่ผู้ใช้แก้เอง (ลบ / สลับลำดับ / เพิ่ม) ─────────────────────
  // `selectedStops` = รายการจุดที่ผู้ใช้ต้องการให้อยู่ในแผน พร้อมวันที่และลำดับ
  // เมื่อส่งมา → ระบบจะยึดรายการนี้เป็นจริง (AI ไม่ได้เลือกซ้ำ)
  const rawSelectedStops: any[] = Array.isArray(b.selectedStops)
    ? b.selectedStops
    : [];
  const userStops: { id: string; name: string; day: number }[] = rawSelectedStops
    .map((s: any) => ({
      id: String(s?.id ?? "").trim(),
      name: String(s?.name ?? "").trim(),
      day: Math.min(7, Math.max(1, Math.round(Number(s?.day) || 1))),
    }))
    .filter((s) => s.id || s.name);

  // ── ราคาน้ำมันสด (ต้องมีเสมอ ห้ามให้โมเดลเดา) ─────────────────────
  const fuelTable = await fetchFuelPrices();
  const resolvedFuel = finalFuelType
    ? resolveFuelPrice(fuelTable, finalFuelType, fuelPriceOverride)
    : null;

  // ── ให้ AI เลือกจุด + จัดวัน ───────────────────────────────────────
  const tripReq: TripRequest = {
    startPoint: startPoint.label,
    destinations: candidates.map((c) => c.name),
    days,
    nights: Math.max(0, days - 1),
    budgetPerPerson,
    style,
    travelers,
    transportMode: vehicle.key === "public" ? "public_transport" : "private_car",
    endPoint: endPoint.label,
    departDate: date ?? undefined,
    sourceFolderId: folderId ?? undefined,
    sourceFolderName: folderName ?? undefined,
    folderPlaces: folderPlaces.map(toPromptPlace),
    placeDetails: candidates.map((c) => ({
      name: c.name,
      type: c.type,
      address: c.address,
      province: c.province,
      district: c.district,
      latitude: c.coordinates.lat,
      longitude: c.coordinates.lng,
      price: c.price,
      opening_hours: c.openingHours,
      business_hours: c.businessHours,
      phone: c.phone,
      rating: c.rating,
      userAdded: c.userAdded ?? false,
    })),
  };
  if (finalFuelType && resolvedFuel) {
    tripReq.fuel = {
      fuelType: finalFuelType,
      pricePerLitre: resolvedFuel.pricePerLitre ?? undefined,
      kmPerLitre: vehicle.kmPerLitre ?? undefined,
      source: resolvedFuel.sourceLabel,
      asOf: resolvedFuel.effectiveDate,
    };
  }

  let reconciled: ReconciledPlan = {
    selection: null,
    usedIds: new Set<string>(),
    droppedNames: [],
    typeOverrides: new Map<string, string>(),
  };
  if (isAiConfigured()) {
    try {
      const raw = await callAi({
        system: `${TRIP_SYSTEM_PROMPT}\n\n${PLAN_SELECTION_RULES}`,
        messages: [{ role: "user", content: buildTripPrompt(tripReq) }],
        maxTokens: 2048,
      });
      const parsed = extractJson(raw);
      reconciled = reconcileAiPlan(parsed, candidates, days);
    } catch (e: any) {
      console.warn("[trips/plan] AI ไม่สำเร็จ — ใช้การจัดลำดับตามระยะแทน:", e?.message);
    }
  } else {
    folderWarning =
      folderWarning ??
      "ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ — ระบบจัดลำดับจุดตามระยะให้เอง";
  }

  // refine ประเภทจุดจากคำตอบ AI (เฉพาะจุดที่เดาจากชื่อได้กว้าง ๆ)
  for (const [id, type] of reconciled.typeOverrides) {
    const c = candidates.find((x) => x.id === id);
    if (c) c.type = type;
  }

  // ── ผู้ใช้กำหนดรายการจุดเอง (ลบ / สลับลำดับ / เพิ่ม) ───────────────
  // เมื่อผู้ใช้แก้แผนในแอป (ลบจุด · ขยับลำดับ) ระบบจะยึดรายการนี้เป็นจริง
  // → AI ไม่ได้เลือกซ้ำ แต่งบ/คำแนะนำจาก AI ยังเก็บไว้
  if (userStops.length) {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const byName = new Map(candidates.map((c) => [c.name, c]));
    const perDay = new Map<number, AiStop[]>();
    const usedIds = new Set<string>();
    for (const s of userStops) {
      const c = byId.get(s.id) ?? byName.get(s.name);
      if (!c) continue;
      const list = perDay.get(s.day) ?? [];
      list.push({
        name: c.name,
        type: c.type,
        activity: c.activity ?? undefined,
        description: c.description ?? undefined,
        stayHours: c.stayHours ?? undefined,
        note: c.note ?? undefined,
      });
      perDay.set(s.day, list);
      usedIds.add(c.id);
    }
    if (usedIds.size) {
      reconciled = {
        ...reconciled,
        selection: {
          days: Array.from({ length: days }, (_, i) => ({
            day: i + 1,
            title: reconciled.selection?.days?.[i]?.title,
            theme: reconciled.selection?.days?.[i]?.theme,
            stops: perDay.get(i + 1) ?? [],
          })),
        },
        usedIds,
      };
    }
  }

  // AI เลือกไม่ได้จริง ๆ (ชื่อที่ส่งมาแต่งขึ้นทั้งหมด) → ใช้การจัดลำดับตามระยะแทน
  // ไม่งั้นแผนจะว่างเปล่าทั้งที่โฟลเดอร์มีสถานที่
  // (ยกเว้นเมื่อผู้ใช้กำหนดรายการจุดเอง → ใช้ของผู้ใช้ต่อ)
  const aiPickedCount = reconciled.selection
    ? reconciled.selection.days.reduce((s, d) => s + d.stops.length, 0)
    : 0;
  if (reconciled.selection && aiPickedCount === 0 && !userStops.length) {
    reconciled = {
      ...reconciled,
      selection: null,
      title: undefined,
      summary: undefined,
    };
    folderWarning =
      folderWarning ??
      "เอไอเลือกจุดที่ตรงกับโฟลเดอร์ไม่ได้เลย — ระบบจัดลำดับจุดตามระยะให้เอง";
  }

  // ค่าอาหาร/กิจกรรมจาก AI เป็น "ต่อคน" → แปลงเป็นยอดทั้งกลุ่มก่อนบวกกับค่าน้ำมัน
  const aiBudget = reconciled.budget
    ? {
        food:
          reconciled.budget.food != null
            ? reconciled.budget.food * travelers
            : undefined,
        activities:
          reconciled.budget.activities != null
            ? reconciled.budget.activities * travelers
            : undefined,
        other:
          reconciled.budget.other != null
            ? reconciled.budget.other * travelers
            : undefined,
      }
    : null;

  const aiWarnings = reconciled.warnings ?? [];

  // ── คำนวณแผนจริง ────────────────────────────────────────────────────
  const plan = await buildTripPlan(
    {
      days,
      date,
      startTime,
      startPoint,
      endPoint,
      returnMode,
      dayEndPoints,
      vehicle,
      vehicleModel,
      fuelType: finalFuelType,
      fuelPriceOverride,
      travelers,
      budgetPerPerson,
      style,
      candidates,
      aiSelection: reconciled.selection,
      aiBudget,
      aiTitle: reconciled.title ?? null,
      aiSummary: reconciled.summary ?? null,
      aiTips: reconciled.tips ?? null,
      aiWarnings: aiWarnings ?? null,
      // ผู้ใช้จัดลำดับเอง → ห้ามเรียงใหม่ให้สั้นที่สุด (ต้องเคารพลำดับที่ผู้ใช้เลือก)
      preserveStopOrder: userStops.length > 0,
    },
    {
      route: routeBetween,
      fuelPrices: fetchFuelPrices,
      findLodging: async (near, opts) => findLodging(admin, near, opts),
    }
  );

  // จุดในโฟลเดอร์ที่ AI ไม่ได้เลือก → ส่งคืนให้แอปเสนอ "เพิ่มจุดนี้"
  // (ถ้าไม่ได้ใช้ AI เลย → ทุกจุดอยู่ในแผนหมด ไม่ต้องรายงาน)
  const notSelected = reconciled.selection
    ? candidates
        .filter((c) => !c.userAdded && !reconciled.usedIds.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, type: c.type }))
    : [];

  // ข้อควรระวังจาก AI → รวมเข้า warnings ของแผน (ติดท้ายว่ามาจาก AI)
  for (const w of aiWarnings) {
    if (!plan.warnings.includes(w)) plan.warnings.push(`AI แนะนำ: ${w}`);
  }
  if (reconciled.droppedNames.length) {
    plan.warnings.push(
      `ตัดจุดที่เอไอระบุผิด (ไม่มีในโฟลเดอร์): ${reconciled.droppedNames.join(", ")}`
    );
  }

  // ── บันทึก (ถ้าสั่ง) ───────────────────────────────────────────────
  let planId: string | null = null;
  let persisted: boolean | undefined;
  let persistReason: string | undefined;
  if (b.save === true) {
    const saved = await persistPlan({
      admin,
      creatorId,
      folderId,
      folderName,
      tripReq,
      plan,
      source: "planner",
      // ถ้าส่ง planId มา → อัปเดตแผนเดิม (แก้แล้วยืนยันซ้ำ) ไม่สร้างแผนซ้ำ
      existingPlanId:
        typeof b.planId === "string" && b.planId.trim() ? b.planId.trim() : null,
      extraMeta: {
        returnMode,
        endPoint,
        dayEndPoints,
        notSelected,
        aiWarnings,
        vehicle: plan.vehicle,
        fuel: plan.fuel,
      },
    });
    planId = saved.planId;
    persisted = saved.persisted;
    persistReason = saved.reason;
  }

  return res.json({
    plan,
    planId,
    persisted,
    persistReason,
    source: "planner",
    aiUsed: Boolean(reconciled.selection),
    aiWarnings,
    droppedByAi: reconciled.droppedNames,
    notSelected,
    folderResolved: Boolean(folderId),
    folderWarning,
  });
});

/**
 * POST /trips/nearby
 * -------------------------------------------------------------
 * เสนอจุดใกล้เคียงให้ผู้ใช้กดเพิ่ม (ไม่เพิ่มให้เอง)
 * หา 2 แหล่ง: ทะเบียน `community_places` + Google Places Legacy (nearbysearch)
 */
router.post("/nearby", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const near = readPlanPoint(b.near ?? b.point ?? b.origin);
  if (!near) {
    return res.status(400).json({
      error: "ต้องมีจุดอ้างอิงที่มีพิกัด",
      code: "BAD_REQUEST",
      requestId: requestId(req),
    });
  }
  const radiusKm = Math.min(50, Math.max(1, Number(b.radiusKm) || 10));
  const limit = Math.min(20, Math.max(1, Math.round(Number(b.limit) || 8)));
  const type = String(b.type ?? "").trim() || null;
  const routePoints: LatLng[] = (
    Array.isArray(b.routePoints) ? b.routePoints : []
  )
    .map((p: any) => {
      const lat = Number(p?.lat);
      const lng = Number(p?.lng ?? p?.lon);
      return Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null;
    })
    .filter((p: any): p is LatLng => Boolean(p));
  const excludeIds = new Set(
    (Array.isArray(b.excludeIds) ? b.excludeIds : []).map((v: any) => String(v))
  );

  const admin = getSupabaseAdmin();
  const out: any[] = [];

  // ── ทะเบียน ───────────────────────────────────────────────────────
  if (admin) {
    try {
      const { data, error } = await admin
        .from("community_places")
        .select(
          "place_id, place_name, formatted_address, province, district, latitude, longitude, phone, opening_hours, price_info, rating, website, business_pricing"
        )
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(500);
      if (!error) {
        for (const row of (data ?? []) as any[]) {
          const lat = Number(row.latitude);
          const lng = Number(row.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const point = { lat, lng };
          const distanceKm = routePoints.length
            ? distanceToRoute(point, routePoints)
            : haversineKm({ lat: near.coords.lat, lng: near.coords.lng }, point);
          if (distanceKm > radiusKm) continue;
          const id = `reg:${row.place_id ?? row.place_name}`;
          if (excludeIds.has(id)) continue;
          const pricing = row.business_pricing ?? null;
          const priceText =
            pricing?.weekday?.amount ??
            pricing?.weekend?.amount ??
            row.price_info ??
            null;
          out.push({
            id,
            name: row.place_name ?? "",
            address: row.formatted_address ?? null,
            province: row.province ?? null,
            district: row.district ?? null,
            coordinates: { lat, lng },
            price: priceText,
            priceUnit: pricing?.unit ?? null,
            openingHours: row.opening_hours ?? null,
            phone: row.phone ?? null,
            website: row.website ?? null,
            rating: typeof row.rating === "number" ? row.rating : null,
            distanceKm: Math.round(distanceKm * 10) / 10,
            source: "registry",
          });
        }
      }
    } catch (e: any) {
      console.warn("[trips/nearby] อ่านทะเบียนไม่สำเร็จ:", e?.message);
    }
  }

  // ── Google Places Legacy ──────────────────────────────────────────
  const google = await googleNearbySearch(near.coords, radiusKm * 1000, type);
  for (const r of google) {
    const lat = Number(r?.geometry?.location?.lat);
    const lng = Number(r?.geometry?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const point = { lat, lng };
    const distanceKm = routePoints.length
      ? distanceToRoute(point, routePoints)
      : haversineKm({ lat: near.coords.lat, lng: near.coords.lng }, point);
    if (distanceKm > radiusKm) continue;
    const id = `goo:${r.place_id ?? r.name}`;
    if (excludeIds.has(id)) continue;
    if (out.some((x) => x.name === r.name)) continue;
    out.push({
      id,
      name: r.name ?? "",
      address: r.formatted_address ?? null,
      province: null,
      district: null,
      coordinates: { lat, lng },
      price: null,
      priceUnit: null,
      openingHours: r.opening_hours?.weekday_text ?? null,
      phone: r.formatted_phone_number ?? null,
      website: r.website ?? null,
      rating: typeof r.rating === "number" ? r.rating : null,
      distanceKm: Math.round(distanceKm * 10) / 10,
      source: "google",
    });
  }

  out.sort((a, b2) => (a.distanceKm ?? 999) - (b2.distanceKm ?? 999));
  return res.json({
    places: out.slice(0, limit),
    radiusKm,
    count: Math.min(out.length, limit),
  });
});

/**
 * GET /trips/fuel-price
 * -------------------------------------------------------------
 * ราคาน้ำมันล่าสุด (ดึงสดจากเว็บ) → แอปแสดงให้ผู้ใช้เห็นก่อนกดสร้างแผน
 */
router.get("/fuel-price", async (_req: Request, res: Response) => {
  const table = await fetchFuelPrices();
  return res.json({
    prices: table.prices,
    labels: FUEL_TYPE_LABELS,
    fetchedAt: table.fetchedAt,
    effectiveDate: table.effectiveDate,
    effectiveDateAlt: table.effectiveDateAlt ?? null,
    source: table.source,
    origin: table.origin,
    isEstimate: table.isEstimate,
    url: table.url,
    // ข้อมูล cache รายวัน (เวลาไทย) — แอปใช้ติดป้ายว่าเป็น "ข้อมูลเก่า" หรือไม่
    cacheDate: table.cacheDate ?? null,
    isStale: table.isStale === true,
    staleNotice: table.staleNotice ?? null,
    bangkokDate: table.bangkokDate ?? null,
  });
});

export default router;
