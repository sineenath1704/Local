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

/** วันสิ้นสุด = วันเริ่ม + (จำนวนวัน - 1) — คืน null ถ้าไม่มีวันเริ่ม */
function computeEndDate(departDate: string | undefined, days: number): string | null {
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
async function persistPlan(params: {
  admin: any;
  creatorId: string;
  folderId: string | null;
  folderName: string | null;
  tripReq: TripRequest;
  plan: any;
  source: string;
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
    },
  };

  try {
    const { data, error } = await admin
      .from("trip_plans")
      .insert({
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
        // check constraint: status in ('upcoming','draft','past')
        status: "draft",
        is_shared: false,
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

  try {
    const raw = await callAi({
      system: TRIP_SYSTEM_PROMPT,
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

export default router;
