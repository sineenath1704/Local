/**
 * ============================================================
 *  VIDEO CONTENT ANALYZER V2 — ตัวแปลงผลลัพธ์เข้ารูปแบบเดิม
 * ============================================================
 * แผน: PLAN_VIDEO_ANALYZER_V2.md §3 (ตารางบังคับของ `toLegacySummary`) + §4.3
 *
 * ทำไมต้องมีไฟล์นี้
 *   ระบบเดิมอ่าน `AiSummaryResult` ที่หลายที่ (แอป 2 หน้า · Caption helper ·
 *   AI แชทโฟลเดอร์ · ทะเบียนสถานที่) → ถ้า V2 คืนรูปแบบใหม่ ทุกจุดนั้นพังพร้อมกัน
 *   → ไฟล์นี้แปลงผล V2 กลับเป็นรูปแบบเดิม **ครบทุกคีย์ที่มีผู้อ่านจริง**
 *   แล้วผนวก `card` (PostCard) เข้าไปด้วย
 *
 * กติกา (ตาม §3 ของแผน)
 *   · ห้ามแตะคีย์ที่ "แอป/Google" เป็นเจ้าของ
 *     (`price_info.level` · `contact.website` · `location.gps` · `google_candidates`)
 *     → ไม่ใส่ค่า ไม่ลบค่า
 *   · ค่า "ความจุ" ต้องเป็น string เสมอ
 *     (PlaceDetailsCard แสดงผิด/พังถ้าเป็นตัวเลข — แผน §13 ข้อ 8)
 *   · `rules` / `areas` / `facilities` / `capacity` มีผู้อ่านจริง
 *     (AI แชท + การ์ดสถานที่) → ต้องเติมให้ครบ
 *
 * หมายเหตุเรื่อง import
 *   ไฟล์นี้ถูก `aiClient.ts` เรียกใช้ (จุดต่อข้อ 1) → ถ้า import ตัวช่วยจาก
 *   `aiClient` แบบ runtime จะเป็น circular import → จึง import แบบ `import type`
 *   (ถูกลบตอน compile) และคัดลอก `extractJson` มาไว้ในไฟล์นี้แทน
 */

import { config, isAiConfigured } from "./config";
import { AiUpstreamError } from "./aiErrors";
import { callAiText } from "./aiStream";
import { DiagLog, errorDetail } from "./summaryDiag";
import type { VideoAnalysisInput } from "./prompt";
import type { AiSummaryResult, PlaceData } from "./aiClient";
import {
  validateExtraction,
  buildPostCard,
  renderPostText,
  type PostCard,
  type V2Core,
  type V2Extraction,
  type V2Price,
  type V2RoomType,
  type V2Stay,
} from "./videoPromptV2";
import { SYSTEM_PROMPT_CARD, buildExtractionPrompt } from "./prompt";
import {
  fetchNearbyAttractions,
  getMapInfo,
  TOTAL_BUDGET_MS,
  type MapInfo,
  type NearbyAttraction,
  type TimeBudget,
} from "./googleMaps";

// ============================================================
//  ค่าคงที่
// ============================================================

/**
 * งบขั้นต่ำของรอบสกัดข้อมูล
 * -------------------------------------------------------------
 * JSON V2 เล็กกว่าเดิมมาก แต่ยังมีโอกาสที่โมเดลจะ "คิดนาน" ก่อนตอบ
 * (เคยเห็น AI_MAX_TOKENS = 1024 ทำให้คำตอบถูกตัดกลาง JSON)
 * → ใช้เพดานเดียวกับสาย V1
 */
const MIN_V2_TOKENS = 8192;

/** งบตอนคำตอบถูกตัด — ลองใหม่ด้วยเพดานสูงสุด */
const RETRY_MAX_TOKENS = 32768;

// ============================================================
//  1) อ่าน JSON จากคำตอบของโมเดล
// ============================================================

/**
 * ดึง JSON ออกจากคำตอบของโมเดล
 * -------------------------------------------------------------
 * โมเดลไม่รองรับ structured output → อาจมีข้อความนำหน้า/ท้าย
 * ลอง parse ตรง ๆ ก่อน ถ้าไม่ได้ค่อยหาบล็อก { ... } แรกถึงสุดท้าย
 */
export function parseModelJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ============================================================
//  2) แปลงค่า V2 → ค่า legacy
// ============================================================

/** หน่วยของราคา → ตัวย่อที่ใช้แนบกับตัวเลข */
const UNIT_SUFFIX_LEGACY: Record<string, string> = {
  "ต่อคน": "/คน",
  "ต่อคืน": "/คืน",
  "ต่อกลุ่ม": "/กลุ่ม",
};

/**
 * ประกอบราคาเป็น string เดียวแบบเดิม
 * -------------------------------------------------------------
 * V2 เก็บราคาเป็น "ตัวเลขล้วน" (`450` / `450-500`) เพื่อให้เทียบกันได้
 * ส่วนรูปแบบเดิมของระบบคือวลีเต็ม เช่น
 *   "450-500 บาท/คืน (รวมอาหารเช้า)"
 */
export function composePrice(amount: string, price: V2Price): string {
  const currency = price.currency === "THB" ? "บาท" : price.currency;
  const suffix = price.unit ? UNIT_SUFFIX_LEGACY[price.unit] ?? "" : "";
  let out = `${amount} ${currency}${suffix}`.trim();
  const inclusions = price.inclusions.filter(Boolean);
  if (inclusions.length > 0) {
    out += ` (รวม${inclusions.join(" และ ")})`;
  }
  return out;
}

/** ตัวเลขสูงสุดในช่วง เช่น "1-3" → 3, "6" → 6 (ใช้เรียงห้องเล็ก→ห้องใหญ่) */
function capacityMax(capacity: string): number {
  const nums = capacity.match(/\d+/g);
  if (!nums || nums.length === 0) return -1;
  return Math.max(...nums.map(Number));
}

/** จำนวนเตียงจากคำบรรยายเรื่องเตียง เช่น "เตียงเดี่ยว 3 เตียง" → "3" */
function bedsFromBedding(bedding: string | null): string | null {
  if (!bedding) return null;
  const m = bedding.match(/(\d+)\s*เตียง/);
  return m ? m[1] : null;
}

/**
 * จำนวนเตียงรวมจากแต่ละประเภทห้อง
 * เช่น "เตียงเดี่ยว 1" + "เตียงเดี่ยว 2" → "3"
 * (สายการ์ดใหม่เก็บเตียงไว้ที่ระดับห้อง → ใช้ก่อนคำบรรยายรวม)
 */
function bedsFromRoomTypes(roomTypes: V2RoomType[]): string | null {
  let total = 0;
  let found = false;
  for (const r of roomTypes) {
    if (!r.beds) continue;
    const m = r.beds.match(/(\d+)/);
    if (!m) continue;
    total += Number(m[1]);
    found = true;
  }
  return found ? String(total) : null;
}

/**
 * ความจุของที่พัก → `capacity` แบบเดิม
 * -------------------------------------------------------------
 * รูปแบบเดิม (ที่ PlaceDetailsCard / AI แชท อ่าน):
 *   rooms           = "3"           (จำนวนห้องทั้งหมด)
 *   guests_per_room = "1-3"         (ห้องปกตินอนได้กี่คน)
 *   max_guests      = "4-6"         (ห้องใหญ่นอนได้กี่คน)
 *   beds            = "2"           (จำนวนเตียง)
 * ถ้ามีแค่ประเภทห้องเดียว → ไม่ต้องแยก max_guests (ไม่งั้นซ้ำความหมาย)
 */
export function composeCapacity(stay: V2Stay | null): PlaceData["capacity"] {
  if (!stay) return null;

  const types = stay.room_types.filter((r) => r.count || r.capacity);
  const counts = types.map((r) => r.count).filter((c): c is string => Boolean(c));
  const caps = types.map((r) => r.capacity).filter((c): c is string => Boolean(c));

  // จำนวนห้อง — ถ้ามีตัวเลขล้วนก็รวมให้ ถ้ามีอันที่ไม่ใช่ตัวเลข (ถูก flag ไว้แล้ว)
  // → แสดงดิบ ๆ ไม่ตีความ
  let rooms: string | null = null;
  if (counts.length > 0) {
    const allNumeric = counts.every((c) => /^\d+$/.test(c.replace(/,/g, "")));
    rooms = allNumeric
      ? String(counts.reduce((sum, c) => sum + Number(c.replace(/,/g, "")), 0))
      : counts.join(" · ");
  }

  // จำนวนคนต่อห้อง — เรียงจากห้องเล็กไปห้องใหญ่
  const sortedCaps = [...new Set(caps)].sort((a, b) => capacityMax(a) - capacityMax(b));
  const guestsPerRoom = sortedCaps.length > 0 ? sortedCaps[0] : null;
  const maxGuests = sortedCaps.length > 1 ? sortedCaps[sortedCaps.length - 1] : null;

  const beds = bedsFromRoomTypes(stay.room_types) ?? bedsFromBedding(stay.bedding);

  if (!rooms && !guestsPerRoom && !maxGuests && !beds) return null;
  return {
    rooms,
    guests_per_room: guestsPerRoom,
    max_guests: maxGuests,
    beds,
  };
}

/**
 * คำบรรยายสั้น ๆ สำหรับ `visualDescription`
 * -------------------------------------------------------------
 * มีผู้อ่านจริง (AI แชทโฟลเดอร์) → ห้ามเป็น null
 * แหล่งเดียวที่เหลือคือ `core.overview` (คำบรรยายสถานที่ของสายการ์ด)
 */
function composeVisualDescription(core: V2Core): string {
  const parts: string[] = [];
  if (core.overview) parts.push(core.overview);
  const highlights = core.highlights.slice(0, 3);
  if (highlights.length > 0) parts.push(highlights.join(" "));
  if (parts.length > 0) return parts.join(" ");
  if (core.place_name) return `คลิปนี้เป็นของ ${core.place_name}`;
  return "คลิปนี้ไม่มีคำบรรยายที่ตรวจสอบได้";
}

/**
 * แปลงผล V2 → `AiSummaryResult` รูปแบบเดิม (ครบทุกคีย์ตาม §3)
 * -------------------------------------------------------------
 * `card` ถูกผนวกเข้าไปด้วย (เพิ่มใหม่ — คลิปเก่าไม่มีก็ไม่เป็นไร)
 */
export function toLegacySummary(
  data: V2Extraction,
  card: PostCard,
  input: VideoAnalysisInput
): AiSummaryResult {
  const { core, confidence } = data;

  const place: PlaceData = {
    place_name: core.place_name,
    community: core.community,
    location: {
      province: core.location.province,
      district: core.location.district,
      subdistrict: core.location.subdistrict,
      // gps ไม่แตะ — Google เป็นเจ้าของ (ค่ามาจากที่ผู้ใช้ติ๊กเลือกสถานที่)
    },
    atmosphere: core.overview ?? null,
    category: core.category,
    activities: core.activities,
    price_info: {
      weekday: core.price.weekday
        ? composePrice(core.price.weekday, core.price)
        : null,
      weekend: core.price.weekend
        ? composePrice(core.price.weekend, core.price)
        : null,
      currency: core.price.currency || "THB",
      // level ไม่แตะ — แอปเขียนเองจาก Google
    },
    contact: {
      phone: core.contact.phone,
      facebook: core.contact.facebook,
      line: core.contact.line,
      // website ไม่แตะ — แอปเขียนเองจาก Google
    },
    opening_hours: core.opening_hours,
    capacity: composeCapacity(data.stay),
    rules: core.restrictions,
    // โซนในบ้านถูกถอดออกจากสายการ์ดแล้ว (prompt ใหม่ไม่มีช่อง) → ไม่มีข้อมูล
    areas: [],
    // สายเก่ามีคีย์เดียว → รวม "ของในห้อง" กับ "บริการ" ไว้ที่เดียว
    facilities: [...(data.stay?.facilities ?? []), ...(data.stay?.services ?? [])],
    otop_products: (data.otop?.products ?? [])
      .map((p) => p.name)
      .filter((n): n is string => Boolean(n)),
    highlights: core.highlights,
    tags: core.tags,
    confidence: {
      overall_confidence: confidence.overall,
      source_used: confidence.source_used,
      missing_info: confidence.missing_info,
      warning: confidence.warning ?? null,
    },
  };

  return {
    status: "ready",
    generatedAt: new Date().toISOString(),
    model: config.ai.model,
    // ข้อความล้วนของการ์ด (Caption helper + AI แชทโฟลเดอร์อ่านตัวนี้)
    text: renderPostText(card),
    visualDescription: composeVisualDescription(core),
    place,
    tags: place.tags,
    highlights: place.highlights,
    onScreenText: input.onScreenText ?? [],
    card,
  };
}

// ============================================================
//  3) เรียกโมเดลแบบ V2
// ============================================================

interface V2Attempt {
  rawText: string;
  stopReason: string | null;
  outputTokens: number | null;
  truncated: boolean;
  streamed: boolean;
  maxTokens: number;
}

/**
 * วิเคราะห์คลิปแบบ V2 — เรียกโมเดล 1 รอบ
 * -------------------------------------------------------------
 * คืน `AiSummaryResult` รูปแบบเดิม + `card`
 * ถ้าโมเดลตอบไม่ใช่ JSON → คืนข้อความดิบแบบ V1 (ไม่ทำให้สรุปพัง)
 */
export async function analyzeVideoCompat(
  input: VideoAnalysisInput,
  diag?: DiagLog
): Promise<AiSummaryResult> {
  const t0 = Date.now();
  const now = new Date().toISOString();

  if (!isAiConfigured()) {
    if (diag) {
      diag.add({
        id: "analyze-v2",
        label: "สกัดข้อมูล (M3) — V2",
        status: "failed",
        ms: Date.now() - t0,
        detail: "ยังไม่ได้ตั้งค่า AI (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)",
        data: { configured: false },
      });
    }
    return {
      status: "unavailable",
      generatedAt: now,
      model: config.ai.model,
      text:
        "ยังไม่ได้ตั้งค่า AI (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN) บนเซิร์ฟเวอร์ — นี่คือข้อความตัวอย่าง",
      onScreenText: input.onScreenText ?? [],
    };
  }

  const promptText = buildExtractionPrompt(input);
  // ส่งวิดีโอไปด้วยเหมือนสาย V1 (รอบเดียวเท่ากัน) — ให้โมเดลอ่านตัวหนังสือในเฟรมได้
  const messageContent: any = input.videoUrl
    ? [
        { type: "text", text: promptText },
        { type: "video", source: { type: "url", url: input.videoUrl, fps: 1 } },
      ]
    : promptText;

  const askModel = async (maxTokens: number): Promise<V2Attempt> => {
    const res = await callAiText({
      url: `${config.ai.baseUrl}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: config.ai.model,
        max_tokens: maxTokens,
        temperature: 0.0,
        system: SYSTEM_PROMPT_CARD,
        messages: [{ role: "user", content: messageContent }],
      },
      timeoutMs: config.ai.timeoutMs,
    });

    if (!res.ok) {
      throw new AiUpstreamError(res.status, res.body);
    }
    return {
      rawText: res.text,
      stopReason: res.stopReason,
      outputTokens: res.outputTokens,
      truncated: res.stopReason === "max_tokens" || res.stopReason === "length",
      streamed: res.streamed,
      maxTokens,
    };
  };

  try {
    const firstTokens = Math.max(config.ai.maxTokens, MIN_V2_TOKENS);
    let attempt: V2Attempt;

    try {
      attempt = await askModel(firstTokens);
    } catch (err: any) {
      // ปลายทางตอบ 5xx (504 = proxy ตัดสายกลางทาง) → ลองใหม่ 1 ครั้ง
      // (สาย V1 ถอยไปใช้ schema compact แต่ V2 ไม่มี compact → ลองซ้ำแบบเดิม)
      const canRetry =
        err instanceof AiUpstreamError && err.upstreamStatus >= 500;
      if (!canRetry) throw err;

      const t5xx = Date.now();
      attempt = await askModel(firstTokens);
      if (diag) {
        diag.add({
          id: "analyze-v2-5xx",
          label: "สกัดข้อมูล (M3) — V2 — ลองใหม่",
          status: "ok",
          ms: Date.now() - t5xx,
          detail: `ปลายทางตอบ ${err.upstreamStatus} → ลองใหม่แล้วสำเร็จ`,
          data: { upstreamStatus: err.upstreamStatus },
        });
      }
    }

    // ถูกตัด = ข้อมูลตายเงียบ → ลองใหม่ด้วยงบที่มากกว่า (เหมือนสาย V1)
    if (attempt.truncated) {
      const retryTokens = Math.max(attempt.maxTokens, RETRY_MAX_TOKENS);
      const tRetry = Date.now();
      attempt = await askModel(retryTokens);
      if (diag) {
        diag.add({
          id: "analyze-v2-retry",
          label: "สกัดข้อมูล (M3) — V2 — ลองใหม่",
          status: attempt.truncated ? "failed" : "ok",
          ms: Date.now() - tRetry,
          detail: attempt.truncated
            ? `ถูกตัดอีกครั้งที่ ${retryTokens} tokens`
            : `คำตอบแรกถูกตัด → ลองใหม่ด้วยงบ ${retryTokens} แล้วได้คำตอบที่จบ`,
          data: { stopReason: attempt.stopReason, maxTokens: retryTokens },
        });
      }
    }

    const parsed = parseModelJson(attempt.rawText);

    if (diag) {
      diag.add({
        id: "analyze-v2",
        label: "สกัดข้อมูล (M3) — V2",
        status: attempt.truncated || !parsed ? "failed" : "ok",
        ms: Date.now() - t0,
        detail: attempt.truncated
          ? `โมเดลตอบถูกตัดที่ ${attempt.maxTokens} tokens — คำตอบไม่จบ`
          : parsed
          ? `ได้ JSON ที่อ่านได้ (${attempt.rawText.length} ตัวอักษร)`
          : `โมเดลไม่ได้ตอบเป็น JSON ที่อ่านได้ (${attempt.rawText.length} ตัวอักษร)`,
        data: {
          stopReason: attempt.stopReason,
          outputTokens: attempt.outputTokens,
          maxTokens: attempt.maxTokens,
          parsedOk: parsed !== null,
          streamed: attempt.streamed,
        },
      });
      if (!parsed) {
        diag.problem(
          "โมเดลตอบมาไม่ใช่ JSON ที่อ่านได้ (V2) — ใช้ข้อความดิบแทนข้อมูลสรุป"
        );
      }
    }

    // โมเดลตอบมาไม่ใช่ JSON → คืนข้อความดิบแบบ V1 (ไม่ทำให้สรุปพัง)
    if (!parsed) {
      return {
        status: "ready",
        generatedAt: now,
        model: config.ai.model,
        text:
          attempt.rawText.trim() ||
          "AI ไม่ได้ส่งเนื้อหาสรุปกลับมา",
        onScreenText: input.onScreenText ?? [],
      };
    }

    // ── ตรวจด้วยโค้ด (ตัวเลขต้องมีที่มาจากเสียงพูด · โมดูลว่าง → null) ──
    const validation = validateExtraction(parsed, { transcript: input.transcript });
    if (diag && (validation.warnings.length > 0 || validation.conflicts.length > 0)) {
      diag.add({
        id: "analyze-v2-validate",
        label: "ตรวจข้อมูล V2 (โค้ด)",
        status: "ok",
        ms: Date.now() - t0,
        detail: `เตือน ${validation.warnings.length} ข้อ · ข้อขัดแย้ง ${validation.conflicts.length} ข้อ`,
        data: {
          warnings: validation.warnings.length,
          conflicts: validation.conflicts.length,
          missing: validation.missing.length,
        },
      });
    }

    // ── ข้อมูลแผนที่ (Google Places + Google Routes) — ยิงหลัง AI สำเร็จ ──
    // ใช้งบเวลาร่วมกัน (พิกัด + เส้นทาง + สถานที่ใกล้เคียง) ไม่เกิน 5 วินาที
    const mapBudget = { left: TOTAL_BUDGET_MS };
    const map = await fetchMapQuietly(validation.data, diag, mapBudget);

    // ── สถานที่ใกล้เคียง (Google Places) — บล็อก "สถานที่ที่อยู่ใกล้เคียง" ──
    const nearby = await fetchNearbyQuietly(
      validation.data,
      map,
      diag,
      mapBudget
    );

    // ── ประกอบการ์ด + แปลงกลับเป็นรูปแบบเดิม ──
    const card = buildPostCard(validation.data, map, nearby);
    const result = toLegacySummary(validation.data, card, input);
    result.generatedAt = now;
    return result;
  } catch (err: any) {
    if (diag) {
      const msg = errorDetail(err);
      diag.add({
        id: "analyze-v2",
        label: "สกัดข้อมูล (M3) — V2",
        status: "failed",
        ms: Date.now() - t0,
        detail: msg,
        data: {
          upstreamStatus:
            typeof err?.upstreamStatus === "number" ? err.upstreamStatus : null,
        },
      });
      diag.problem(`สกัดข้อมูล (M3) — V2 ล้มเหลว: ${msg}`);
    }
    throw err;
  }
}

/**
 * ยิง Google Maps (Places + Routes) แบบ "ล้มเงียบ"
 * -------------------------------------------------------------
 * ข้อมูลแผนที่เป็นข้อมูลเสริม → ล้มแล้วต้องไม่ทำให้สรุปคลิปล้มตาม
 */
async function fetchMapQuietly(
  data: V2Extraction,
  diag?: DiagLog,
  budget?: TimeBudget
): Promise<MapInfo | null> {
  const placeName = data.core.place_name;
  const province = data.core.location.province;
  const district = data.core.location.district;

  // ไม่มีชื่อสถานที่และไม่มีจังหวัด/อำเภอ → ไม่มีอะไรให้ค้น
  if (!placeName && !district && !province) return null;

  const t0 = Date.now();
  try {
    const info = await getMapInfo({ placeName, province, district }, budget);
    if (diag) {
      diag.add({
        id: "google-maps",
        label: "ข้อมูลเส้นทาง (Google Routes)",
        status: info ? "ok" : "skipped",
        ms: Date.now() - t0,
        detail: info
          ? info.routeKm != null
            ? `ได้เส้นทาง ${info.routeKm} กม. · ${info.routeMinutes} นาที` +
              (info.hasToll ? " · มีค่าผ่าน" : "")
            : "พบพิกัดแต่ไม่ได้เส้นทาง — ข้ามหัวข้อเดินทาง"
          : "ไม่พบพิกัด — ข้ามหัวข้อเดินทาง",
        data: {
          hasRoute: info?.routeKm != null,
          hasToll: Boolean(info?.hasToll),
          trafficDelaySec: info?.trafficDelaySec ?? null,
        },
      });
    }
    return info;
  } catch (err: any) {
    if (diag) {
      diag.add({
        id: "google-maps",
        label: "ข้อมูลเส้นทาง (Google Routes)",
        status: "skipped",
        ms: Date.now() - t0,
        detail: `ข้อมูลแผนที่ล้ม — ข้ามเงียบ ๆ (${errorDetail(err)})`,
      });
    }
    return null;
  }
}

/**
 * ยิง Google Places แบบ "ล้มเงียบ"
 * -------------------------------------------------------------
 * สถานที่ใกล้เคียงเป็นข้อมูลเสริม (หัวข้อ "สถานที่ที่อยู่ใกล้เคียง")
 * → ล้ม/ไม่มี key → ไม่มีบล็อกนี้ แต่สรุปคลิปต้องไม่ล้มตาม
 *
 * ถ้า Google หาพิกัดไม่ได้ → ใช้พิกัดที่หาเจอจากรอบเส้นทางแทน
 */
async function fetchNearbyQuietly(
  data: V2Extraction,
  map: MapInfo | null,
  diag?: DiagLog,
  budget?: TimeBudget
): Promise<NearbyAttraction[]> {
  const t0 = Date.now();
  try {
    const items = await fetchNearbyAttractions({
      placeName: data.core.place_name,
      province: data.core.location.province,
      district: data.core.location.district,
      fallbackLat: map?.lat ?? null,
      fallbackLon: map?.lon ?? null,
      budget,
    });
    if (diag) {
      diag.add({
        id: "places-nearby",
        label: "สถานที่ใกล้เคียง (Google Places)",
        status: items.length > 0 ? "ok" : "skipped",
        ms: Date.now() - t0,
        detail:
          items.length > 0
            ? `ได้ ${items.length} แห่ง`
            : "ไม่พบสถานที่ใกล้เคียง — ข้ามหัวข้อ",
        data: { count: items.length },
      });
    }
    return items;
  } catch (err: any) {
    if (diag) {
      diag.add({
        id: "places-nearby",
        label: "สถานที่ใกล้เคียง (Google Places)",
        status: "skipped",
        ms: Date.now() - t0,
        detail: `Google Places ล้ม — ข้ามเงียบ ๆ (${errorDetail(err)})`,
      });
    }
    return [];
  }
}
