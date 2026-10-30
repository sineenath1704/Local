import { config, isAiConfigured } from "./config";
import { AiUpstreamError } from "./aiErrors";
import { callAiText } from "./aiStream";
import { pickHashtagSuggestions } from "./hashtagText";
import { DiagLog, errorDetail } from "./summaryDiag";
import type {
  PlaceCandidate,
  PlaceEvidence,
  PlaceEvidenceSource,
  PlaceReading,
  PlaceResolution,
} from "./placeTypes";
// ชนิดการ์ดหน้าโพสต์ (V2) — import แบบ type เท่านั้น (ถูกลบตอน compile)
// เพื่อไม่ให้เกิด circular import ตอน `videoPromptV2Compat.ts` เรียกกลับมา
import type { PostCard } from "./videoPromptV2";
import {
  SYSTEM_PROMPT,
  buildSummaryPrompt,
  VideoAnalysisInput,
  CAPTION_SYSTEM_PROMPT,
  buildCaptionPrompt,
  CaptionInput,
  SUMMARY_NARRATION_PROMPT,
  buildNarrationPrompt,
  PLACE_RESOLVE_PROMPT,
  buildPlaceResolvePrompt,
  PLACE_RANK_PROMPT,
  buildPlaceRankPrompt,
} from "./prompt";
// สายสรุป V2 (Video Content Analyzer V2) — โหมดทดลอง เปิดด้วย VCA_V2_ENABLED
// (import ตรง ๆ ได้ เพราะฝั่ง `videoPromptV2Compat` ไม่ import `aiClient` แบบ runtime)
import { analyzeVideoCompat } from "./videoPromptV2Compat";

/**
 * งบ token สำรอง ตอนคำตอบถูกตัดกลางคัน
 * -------------------------------------------------------------
 * prompt สรุปขอ JSON ~70 คีย์ ซึ่งกิน token 1,400–3,000
 * ถ้า AI_MAX_TOKENS ตั้งไว้ต่ำกว่านั้น (เคยเป็น 1024 บน Vercel)
 * โมเดลจะตอบกลาง JSON → `place` ว่าง → Google Places ไม่มีอะไรให้ค้น
 * → ผู้ใช้เห็นสรุปเปล่าโดยไม่มีใครบอกว่าติดตรงไหน
 *
 * กันไว้ในโค้ด: ถ้าคำตอบถูกตัด ให้ลองใหม่ด้วยงบนี้ก่อน
 * (งบจริงยังตั้งผ่าน env ได้ แต่ลืมตั้งไม่ควรทำให้สรุดว่างเงียบ ๆ)
 */
const RETRY_MAX_TOKENS = 32768;

/**
 * งบขั้นต่ำของรอบสรุป
 * -------------------------------------------------------------
 * AI_MAX_TOKENS เคยเป็น 1024 บน Vercel (ลืมตั้งค่า) → โมเดลตอบกลาง JSON
 * → สรุปว่างเงียบ ๆ ตัวแก้ไขนี้กันไว้ในโค้ด: ถ้า env ตั้งไว้ต่ำกว่านี้
 * ให้ยกขึ้นมาที่ขั้นต่ำเสมอ (max_tokens เป็น "เพดาน" ไม่ใช่เป้าหมาย
 * → ยกไม่ทำให้โมเดลยาวขึ้น แต่กันไม่ให้คำตอบถูกตัดกลาง JSON)
 */
const MIN_SUMMARY_TOKENS = 8192;

/** Structured place data extracted from the clip (Video Content Analyzer). */
export interface PlaceData {
  place_name: string | null;
  /** Community / village name (separate from the specific place_name). */
  community?: string | null;
  location: {
    province: string | null;
    district: string | null;
    subdistrict?: string | null;
    gps?: string | null;
  };
  /**
   * Google Places candidates for this clip. The app shows them as a picker —
   * the USER ticks one, we never pick for them. Not persisted: the app
   * strips this list before saving the summary.
   */
  google_candidates?: PlaceCandidate[];
  atmosphere?: string | null;
  category: string[];
  activities: string[];
  price_info: {
    weekday: string | null;
    weekend: string | null;
    currency?: string;
    /**
     * Google's price band for a place the user confirmed ("฿" / "฿฿฿" /
     * "ฟรี"). An overall estimate — NOT a weekday/weekend price, so it sits
     * beside them rather than in them. Filled in on the app when the user
     * tick-confirms a Google candidate.
     */
    level?: string | null;
  };
  contact: {
    phone?: string | null;
    facebook?: string | null;
    line?: string | null;
    /** Website of the confirmed place, from Google. */
    website?: string | null;
  };
  opening_hours?: string | null;
  /**
   * How many people the place takes. Every slot is a STRING on purpose: the
   * clip says "มี 3 ห้อง ห้องใหญ่นอนได้ 4-6 คน" and a number would force us
   * to pick one reading of an ambiguous sentence.
   */
  capacity?: {
    rooms?: string | null;
    guests_per_room?: string | null;
    max_guests?: string | null;
    beds?: string | null;
  } | null;
  /** The place's rules — "รับวันละ 1 กลุ่ม", "ต้องช่วยกันทำเตาไฟ". */
  rules?: string[];
  /** Zones of the place — "โซนเจ้าบ้าน", "โซนคาเฟ่". */
  areas?: string[];
  /** Facilities — "ระเบียง", "กองไฟ". */
  facilities?: string[];
  otop_products: string[];
  highlights: string[];
  tags: string[];
  confidence?: {
    overall_confidence?: number;
    source_used?: string[];
    missing_info?: string[];
    warning?: string | null;
  };
}

/** Shape returned to the mobile app (superset of the app's AiSummary type). */
/**
 * One object from the clip's scene inventory (Pillar 1). The narrator treats
 * this list as a checklist — every row has to end up in paragraph 1, so a
 * small detail (a towel, a sign, a water bottle) is never dropped.
 */
export interface SceneItem {
  /** Name of the thing ("เตียงไม้") — "ไม่ชัด" when it can't be identified. */
  item: string;
  /** What it's made of ("ไม้เนื้อแข็ง"). */
  material: string | null;
  /** How many ("2", "3-4", "1 คู่") — a string because clips say ranges. */
  count: string | null;
  /** How it looks now ("เก่า มีรอยชำรุด"). */
  condition: string | null;
  /** Where it sits in the frame ("ซ้าย บนโต๊ะ"). */
  position: string | null;
}

export interface AiSummaryResult {
  status: "ready" | "processing" | "unavailable";
  generatedAt: string;
  model: string;
  /** Natural-language summary (maps to the model's "summary"). */
  text: string;
  /** Detailed description of everything visible in the clip (Pillar 1). */
  visualDescription?: string;
  /** Every visible object, itemised — the narrator's checklist for ¶1. */
  sceneInventory?: SceneItem[];
  /** Structured extraction (place/location/price/contact/...), when available. */
  place?: PlaceData;
  // Back-compat display fields used by the current app UI:
  tags?: string[];
  highlights?: string[];
  visualTags?: string[];
  onScreenText?: string[];
  transcriptHighlights?: string[];
  /**
   * การ์ดหน้าโพสต์แบบมีโครงสร้าง (V2)
   * -------------------------------------------------------------
   * มีเฉพาะคลิปที่สรุปด้วย VCA V2 เท่านั้น · คลิปเก่าไม่มี field นี้
   * → แอปต้อง fallback ไปใช้ `text` แบบเดิมเมื่อไม่มี `card`
   */
  card?: PostCard;
  /**
   * ผลการ "หาสถานที่" จากรอบ AI ที่ทำงานหน้าที่เดียว (ถ้ามี)
   * -------------------------------------------------------------
   * มีเมื่อระบบรันรอบหาสถานที่แยก → ชื่อใน `place.place_name` ควรตรงกับ
   * ที่อยู่ใน `resolution.placeName` และผู้ใช้ติ๊กยืนยันจากรายการที่ Google
   * ค้นมาด้วยคำค้นใน `resolution.queries`
   */
  placeResolution?: PlaceResolution;
}

/**
 * Normalise the model's `scene_inventory` into our shape. Rows without a
 * usable name are dropped — a nameless row can't be narrated.
 */
function parseSceneInventory(raw: unknown): SceneItem[] {
  if (!Array.isArray(raw)) return [];
  const rows: SceneItem[] = [];
  for (const row of raw as any[]) {
    const item = typeof row?.item === "string" ? row.item.trim() : "";
    if (!item) continue;
    rows.push({
      item,
      material: row?.material != null ? String(row.material) : null,
      count: row?.count != null ? String(row.count) : null,
      condition: row?.condition != null ? String(row.condition) : null,
      position: row?.position != null ? String(row.position) : null,
    });
  }
  return rows;
}

/** Try to pull a JSON object out of the model's text response. */
export function extractJson(raw: string): any | null {
  // Direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to the first {...} block
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

/**
 * Call the AI endpoint to generate a video summary.
 * The endpoint + token come from config (env), never from the client.
 *
 * `diag` เป็นบันทึกรายงาน (ไม่บังคับ) — เวลามีให้ใส่ จะได้รู้ว่าโมเดลตอบ
 * ถูกตัดกลางทางไหม / ตอบมาเป็น JSON ที่อ่านได้ไหม / ใช้เวลาเท่าไหร่
 */
export async function generateSummary(
  input: VideoAnalysisInput,
  diag?: DiagLog
): Promise<AiSummaryResult> {
  const now = new Date().toISOString();
  const t0 = Date.now();

  // ─────────────────────────────────────────────────────────────────
  // VCA V2 (จุดต่อข้อ 1 จากแผน) — เปิดด้วย flag เท่านั้น
  // ─────────────────────────────────────────────────────────────────
  // ปิด flag = โค้ดข้างล่างทั้งหมดคือสาย V1 แบบเดิมทุกประการ
  // เปิด flag = สรุปด้วย SYSTEM_PROMPT_CARD (อยู่ใน prompt.ts) → ได้ `card` (การ์ดหน้าโพสต์)
  //           + `text` เป็นข้อความการ์ด (ใช้กับ Caption helper + AI แชทได้)
  if (config.ai.vcaV2Enabled) {
    return analyzeVideoCompat(input, diag);
  }

  // No credentials configured → return a graceful stub so dev still works.
  if (!isAiConfigured()) {
    if (diag) {
      diag.add({
        id: "analyze",
        label: "สรุปโครงสร้าง (M3)",
        status: "failed",
        ms: Date.now() - t0,
        detail: "ยังไม่ได้ตั้งค่า AI (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)",
        data: { configured: false },
      });
      diag.problem(
        "ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)"
      );
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

  /**
   * เรียกโมเดลหนึ่งครั้ง — คืนข้อความดิบ พร้อมบอกว่า "จบ" หรือ "ถูกตัด"
   * ------------------------------------------------------------------
   * เรียกผ่าน callAiText → สตรีมก่อนเสมอ เพราะ proxy ข้างหน้าปลายทาง
   * ตัดการเชื่อมต่อเมื่อไม่มีข้อมูลไหลมา ~60 วินาที (nginx proxy_read_timeout)
   * → 504 ตอนที่โมเดลยัง "คิด" อยู่ (เคยเห็น 61.6 วินาที แล้วขั้นตอน
   * "สรุปโครงสร้าง (M3)" ล้มเหลวด้วย 504)
   */
  const askModel = async (
    maxTokens: number,
    opts: { compact?: boolean } = {},
  ) => {
    const compact = opts.compact === true;
    // Build comprehensive prompt containing transcript from Speech-to-Text,
    // on-screen text, visual description, and anti-hallucination rules.
    // โหมดย่อใช้ schema ที่เล็กลงมาก (ตัด reasoning / scene_inventory ออก)
    const promptText = buildSummaryPrompt({ ...input, compact });
    const messageContent: any = input.videoUrl
      ? [
          { type: "text", text: promptText },
          { type: "video", source: { type: "url", url: input.videoUrl, fps: 1 } },
        ]
      : promptText;

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
        system: SYSTEM_PROMPT,
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
      maxTokens,
      outputTokens: res.outputTokens,
      parsed: extractJson(res.text),
      truncated: res.stopReason === "max_tokens" || res.stopReason === "length",
      streamed: res.streamed,
    };
  };

  /** เรียกโมเดลหนึ่งครั้ง (ถอยแบบไม่สตรีมอยู่ใน callAiText แล้ว) */
  const callModel = async (
    maxTokens: number,
    opts: { compact?: boolean } = {},
  ) => askModel(maxTokens, opts);

  try {
    // งบขั้นต่ำกันคำตอบถูกตัดกลาง JSON (AI_MAX_TOKENS เคยเป็น 1024 บน Vercel)
    const firstTokens = Math.max(config.ai.maxTokens, MIN_SUMMARY_TOKENS);
    let attempt: Awaited<ReturnType<typeof callModel>>;

    try {
      attempt = await callModel(firstTokens);
    } catch (err: any) {
      // ปลายทางตอบ 5xx (504 = proxy ตัดสายกลางทาง) → ลองใหม่แบบ "ย่อ"
      // (schema เล็กลงมาก → โมเดลตอบจบก่อนที่ proxy จะตัดการเชื่อมต่อ)
      const canCompact =
        err instanceof AiUpstreamError &&
        err.upstreamStatus >= 500 &&
        input.compact !== true;
      if (!canCompact) throw err;

      const tCompact = Date.now();
      attempt = await callModel(firstTokens, { compact: true });
      if (diag) {
        diag.add({
          id: "analyze-compact",
          label: "สรุปโครงสร้าง (M3) — โหมดย่อ",
          status: attempt.truncated ? "failed" : "ok",
          ms: Date.now() - tCompact,
          detail: `ปลายทางตอบ ${err.upstreamStatus} → ลองใหม่แบบย่อ (JSON เล็กลง)`,
          data: {
            upstreamStatus: err.upstreamStatus,
            parsedOk: attempt.parsed !== null,
            rawChars: attempt.rawText.length,
          },
        });
      }
    }

    // ถูกตัด = ข้อมูลตายเงียบ (place ว่าง → Google ค้นไม่ได้ → สรุดว่าง)
    // แก้ให้เอง: ลองใหม่ด้วยงบที่มากกว่า แทนที่จะปล่อยให้ผู้ใช้เจอสรุปเปล่า
    if (attempt.truncated) {
      const firstTokensUsed = attempt.maxTokens;
      const retryTokens = Math.max(attempt.maxTokens, RETRY_MAX_TOKENS);
      const tRetry = Date.now();
      // งบเท่าเดิม = ลองซ้ำก็ถูกตัดแบบเดิม → เปลี่ยนไปลองแบบย่อแทน
      const retry = await callModel(retryTokens, {
        compact: retryTokens === firstTokensUsed ? true : undefined,
      });
      if (diag) {
        diag.add({
          id: "analyze-retry",
          label: "สรุปโครงสร้าง (M3) — ลองใหม่",
          status: retry.truncated ? "failed" : "ok",
          ms: Date.now() - tRetry,
          detail: retry.truncated
            ? `ถูกตัดอีกครั้งที่ ${retryTokens} tokens — งบ token ไม่พอสำหรับสรุปนี้`
            : `คำตอบแรกถูกตัดที่ ${firstTokensUsed} tokens → ลองใหม่${retryTokens === firstTokensUsed ? "แบบย่อ" : `ด้วยงบ ${retryTokens}`} แล้วได้ JSON ที่อ่านได้`,
          data: {
            stopReason: retry.stopReason,
            firstTokens: firstTokensUsed,
            maxTokens: retryTokens,
            parsedOk: retry.parsed !== null,
          },
        });
      }
      attempt = retry;
    }

    const { rawText, stopReason, outputTokens, parsed, truncated } = attempt;
    const usedTokens = attempt.maxTokens;

    if (diag) {
      const parsedOk = parsed !== null;
      const detail = truncated
        ? `โมเดลตอบถูกตัดที่ ${usedTokens} tokens — คำตอบไม่จบ`
        : parsedOk
        ? `ได้ JSON ที่อ่านได้ (${rawText.length} ตัวอักษร)`
        : `โมเดลไม่ได้ตอบเป็น JSON ที่อ่านได้ (${rawText.length} ตัวอักษร)`;
      diag.add({
        id: "analyze",
        label: "สรุปโครงสร้าง (M3)",
        // ถูกตัด = ข้อมูลตายจริง (ไม่ใช่แค่คำตอบไม่สวย) → นับเป็นล้มเหลว
        status: truncated || rawText.length === 0 ? "failed" : "ok",
        ms: Date.now() - t0,
        detail,
        data: {
          stopReason,
          outputTokens,
          maxTokens: usedTokens,
          parsedOk,
          rawChars: rawText.length,
          streamed: attempt.streamed,
          hasPlaceName: typeof parsed?.place_name === "string" && !!parsed.place_name,
        },
      });
      if (truncated) {
        diag.problem(
          `โมเดลตอบถูกตัดที่ ${usedTokens} tokens (AI_MAX_TOKENS) — ข้อมูลในคำตอบถูกตัดทิ้ง เพิ่ม AI_MAX_TOKENS ที่ Vercel`
        );
      } else if (!parsedOk) {
        diag.problem(
          "โมเดลตอบมาไม่ใช่ JSON ที่อ่านได้ — ใช้ข้อความดิบแทนข้อมูลสรุป"
        );
      }
    }

    if (parsed) {
      // Diagnostic logging of reasoning and extracted fields
      // eslint-disable-next-line no-console
      console.log("[generateSummary] reasoning =", parsed.reasoning);
      // eslint-disable-next-line no-console
      console.log("[generateSummary] place_name =", parsed.place_name, "community =", parsed.community, "location =", parsed.location);
    }

    // New structured format: has a "summary" string.
    if (parsed && typeof parsed.summary === "string") {
      const place: PlaceData = {
        place_name: parsed.place_name ?? null,
        community: parsed.community ?? null,
        location: parsed.location ?? { province: null, district: null },
        atmosphere: parsed.atmosphere ?? null,
        category: parsed.category ?? [],
        activities: parsed.activities ?? [],
        price_info: parsed.price_info ?? { weekday: null, weekend: null, currency: "THB" },
        contact: parsed.contact ?? {},
        opening_hours: parsed.opening_hours ?? null,
        capacity: parsed.capacity ?? null,
        rules: parsed.rules ?? [],
        areas: parsed.areas ?? [],
        facilities: parsed.facilities ?? [],
        otop_products: parsed.otop_products ?? [],
        highlights: parsed.highlights ?? [],
        tags: parsed.tags ?? [],
        confidence: parsed.confidence,
      };
      return {
        status: "ready",
        generatedAt: now,
        model: config.ai.model,
        text: parsed.summary,
        visualDescription: parsed.visual_description ?? undefined,
        sceneInventory: parseSceneInventory(parsed.scene_inventory),
        place,
        tags: place.tags,
        highlights: place.highlights,
        onScreenText: input.onScreenText ?? [],
      };
    }

    // Model replied but not as structured JSON — still return the plain text.
    return {
      status: "ready",
      generatedAt: now,
      model: config.ai.model,
      text: (parsed && typeof parsed.text === "string" ? parsed.text : rawText) || "AI ไม่ได้ส่งเนื้อหาสรุปกลับมา",
      onScreenText: input.onScreenText ?? [],
    };
  } catch (err: any) {
    if (diag) {
      const msg = errorDetail(err);
      diag.add({
        id: "analyze",
        label: "สรุปโครงสร้าง (M3)",
        status: "failed",
        ms: Date.now() - t0,
        detail: msg,
        data: {
          upstreamStatus:
            typeof err?.upstreamStatus === "number" ? err.upstreamStatus : null,
        },
      });
      diag.problem(`สรุปโครงสร้าง (M3) ล้มเหลว: ${msg}`);
    }
    throw err;
  }
}

// ============================================================
//  รอบ AI ที่งานหน้าที่เดียว: "หาสถานที่" (แยกจากรอบสรุป)
// ============================================================
// รอบสรุปมีงานราว 30 อย่างใน prompt เดียว และ "ชื่อสถานที่" เป็นแค่อีกฟิลด์
// หนึ่ง → โมเดลมักตั้งชื่อจากบรรยากาศ ไม่ใช่จากหลักฐานในคลิป (ที่มาของชื่อ
// ที่ค้น Google แล้วไม่ตรง)
//
// รอบนี้ทำงานแบบ "หลักฐานนำ" — โมเดลต้องให้ quote ที่คัดมาจากคลิป แล้วฝั่ง
// โค้ดตรวจว่า quote นั้นอยู่ในข้อความจริงหรือไม่ → ไม่ผ่าน = ทิ้ง
// กันการเดาชื่อได้ในระดับโค้ด ไม่ใช่แค่ขอให้โมเดลตั้งใจ

/** งบ token ของรอบหาสถานที่ — JSON เล็ก (ชื่อ + หลักฐาน + คำค้น) */
const PLACE_RESOLVE_MAX_TOKENS = 4096;

/** งบ token ของรอบจัดอันดับ — 1 บรรทัดต่อผู้สมัคร */
const PLACE_RANK_MAX_TOKENS = 4096;

/** ที่มาของหลักฐานที่ระบบรู้จัก */
const PLACE_EVIDENCE_SOURCES: PlaceEvidenceSource[] = [
  "transcript",
  "on_screen_text",
  "visual",
  "caption",
  "user_location",
];

/**
 * แปลงคำที่โมเดลเขียนมาให้เป็นที่มาที่ระบบรู้จัก
 * -------------------------------------------------------------
 * โมเดลมักเขียนคำพวกนี้แทนชื่อที่เรากำหนด ("audio_transcript" ตามที่
 * prompt เดิมใช้, "sign" สำหรับป้ายในภาพ ฯลฯ) → แปลงให้เข้าใจก่อน
 *
 * ถ้าเป็นคำที่ไม่รู้จักเลย → null = ไม่ใช่หลักฐานที่ตรวจสอบได้ (ทิ้ง)
 * (ต้องไม่เดาเป็น "visual" เพราะ visual ไม่ต้องผ่านการตรวจสตริง)
 */
function normalizeEvidenceSource(value: unknown): PlaceEvidenceSource | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (PLACE_EVIDENCE_SOURCES.includes(raw as PlaceEvidenceSource)) {
    return raw as PlaceEvidenceSource;
  }
  const map: Record<string, PlaceEvidenceSource> = {
    audio_transcript: "transcript",
    speech: "transcript",
    audio: "transcript",
    voice: "transcript",
    เสียงพูด: "transcript",
    onscreen: "on_screen_text",
    on_screen: "on_screen_text",
    text: "on_screen_text",
    sign: "on_screen_text",
    signage: "on_screen_text",
    subtitle: "on_screen_text",
    ป้าย: "on_screen_text",
    ซับ: "on_screen_text",
    image: "visual",
    frame: "visual",
    video: "visual",
    ภาพ: "visual",
    user: "user_location",
    location: "user_location",
    ที่อยู่: "user_location",
  };
  return map[raw] ?? null;
}

/**
 * ย่อข้อความให้เทียบกันได้ — ตัดช่องว่าง/เครื่องหมายวรรคตอนออก
 * (ชื่อ "บ้าน สวน ริมน้ำ" กับ "บ้านสวนริมน้ำ" ต้องถือว่าตรงกัน)
 */
function foldText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** ข้อความ A มีข้อความ B อยู่ข้างในหรือไม่ (แบบย่อ) */
function containsText(haystack: string, needle: string): boolean {
  const n = foldText(needle);
  if (!n) return false;
  return foldText(haystack).includes(n);
}

/** จำกัดคะแนนให้อยู่ในช่วง 0–1 · ค่าที่แปลงไม่ได้ = null */
function clamp01(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/** ข้อความสั้น ๆ ที่ไม่ว่าง · เกิน 160 ตัวอักษรตัดทิ้ง */
function cleanNote(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

/**
 * เก็บเฉพาะหลักฐานที่ "มีอยู่จริง" ในคลิป
 * -------------------------------------------------------------
 * transcript / แคปชัน / ตัวหนังสือบนจอ / ที่อยู่ที่ผู้ใช้กรอก → ต้องค้น
 * สตริงย่อยแล้วเจอจริง ถึงจะรับ
 *
 * visual → ป้ายในภาพที่ Vision ถอดเป็นข้อความไม่ได้ ตรวจไม่ได้ → รับไว้
 * แต่ถือเป็นหลักฐานระดับอ่อน (ดู `normalizePlaceResolution`)
 */
function collectVerifiedEvidence(
  raw: unknown,
  input: VideoAnalysisInput,
): PlaceEvidence[] {
  const rows = Array.isArray(raw) ? (raw as any[]) : [];
  const strictSources: { source: PlaceEvidenceSource; text: string }[] = [
    { source: "transcript", text: input.transcript ?? "" },
    { source: "on_screen_text", text: (input.onScreenText ?? []).join(" \n ") },
    { source: "caption", text: input.caption ?? "" },
    { source: "user_location", text: input.location ?? "" },
  ];

  const out: PlaceEvidence[] = [];
  for (const row of rows) {
    if (out.length >= 5) break;
    const quote = typeof row?.quote === "string" ? row.quote.trim() : "";
    if (!quote) continue;
    const source = normalizeEvidenceSource(row?.source);
    if (!source) continue;

    if (source === "visual") {
      out.push({ source, quote, note: cleanNote(row?.note) });
      continue;
    }

    // หลักฐานชนิดอื่นต้องมีอยู่จริงในข้อความที่ส่งเข้าไป — ไม่เจอ = ทิ้ง
    const hit = strictSources.find((s) => containsText(s.text, quote));
    if (!hit) continue;
    out.push({ source: hit.source, quote, note: cleanNote(row?.note) });
  }
  return out;
}

/**
 * โมเดลตั้งชื่อได้ดีแต่ลืมใส่ quote — ถ้าชื่อนั้นปรากฏในข้อความจริง
 * ให้เก็บหลักฐานให้เอง แทนที่จะทิ้งชื่อที่ถูกทิ้ง
 */
function rescueEvidence(
  placeName: string,
  input: VideoAnalysisInput,
): PlaceEvidence[] {
  if (!placeName) return [];
  const sources: { source: PlaceEvidenceSource; text: string }[] = [
    { source: "transcript", text: input.transcript ?? "" },
    { source: "on_screen_text", text: (input.onScreenText ?? []).join(" \n ") },
    { source: "caption", text: input.caption ?? "" },
    { source: "user_location", text: input.location ?? "" },
  ];
  const hit = sources.find((s) => containsText(s.text, placeName));
  if (!hit) return [];
  return [
    { source: hit.source, quote: placeName, note: "ชื่อสถานที่ปรากฏในข้อความนี้" },
  ];
}

/**
 * "การอ่านชื่อ" จากแต่ละแหล่ง — เสียงพูด กับ ตัวหนังสือบนจอ
 * -------------------------------------------------------------
 * ชื่อที่อ่านได้ต้องผ่าน 2 เงื่อนไข (ตรวจได้ด้วยโค้ด ไม่ใช่เชื่อโมเดล):
 *   1. quote ต้องคัดมาจากแหล่งนั้นจริง (ต้องมีอยู่ใน transcript / ป้ายบนจอ)
 *   2. ชื่อต้องอยู่ใน quote นั้น (ไม่งั้นโมเดลแต่งชื่อขึ้นเอง)
 *
 * เก็บได้ทีละแหล่ง (เสียง 1 · ป้ายบนจอ 1) — เพราะคำค้น Google ยิงตามจำนวนชื่อ
 * และผู้ใช้ต้องเลือกจากรายการได้ 2 ทางพอดี
 */
function collectVerifiedReadings(
  raw: unknown,
  input: VideoAnalysisInput
): PlaceReading[] {
  const rows = Array.isArray(raw) ? (raw as any[]) : [];
  const sources: { source: PlaceReading["source"]; text: string }[] = [
    { source: "transcript", text: input.transcript ?? "" },
    { source: "on_screen_text", text: (input.onScreenText ?? []).join(" \n ") },
  ];

  const out: PlaceReading[] = [];
  for (const row of rows) {
    const source: PlaceReading["source"] | null =
      row?.source === "on_screen_text"
        ? "on_screen_text"
        : row?.source === "transcript"
          ? "transcript"
          : null;
    if (!source) continue;

    const placeName =
      typeof row?.place_name === "string" ? row.place_name.trim() : "";
    const quote = typeof row?.quote === "string" ? row.quote.trim() : "";
    if (!placeName || !quote) continue;

    // ทีละแหล่งเดียว — เก็บตัวแรกที่ผ่าน (โมเดลเรียงตามความมั่นใจ)
    if (out.some((r) => r.source === source)) continue;

    const src = sources.find((s) => s.source === source)!;
    if (!containsText(src.text, quote)) continue; // คัดมาไม่ตรงกับแหล่งจริง
    if (!containsText(quote, placeName)) continue; // ชื่อไม่ได้อยู่ใน quote

    out.push({ source, placeName, quote, note: cleanNote(row?.note) });
  }

  // ชื่อเดียวกันจากสองทาง → เก็บไว้ทางเดียว (เสียงพูดมาก่อน) แล้วค้นคำเดียว
  const byName = new Map<string, PlaceReading>();
  for (const r of out) {
    const key = foldText(r.placeName);
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev || (prev.source !== "transcript" && r.source === "transcript")) {
      byName.set(key, r);
    }
  }

  // เรียงให้เสียงพูดมาก่อน (เสียงคือสิ่งที่คนพูดว่าที่นี่คืออะไร)
  return [...byName.values()].sort((a, b) =>
    a.source === b.source ? 0 : a.source === "transcript" ? -1 : 1
  );
}

/**
 * คำค้นสำหรับ Google — เก็บเฉพาะคำที่มีชื่อสถานที่อยู่จริง
 * -------------------------------------------------------------
 * **หนึ่งคำค้นต่อหนึ่งชื่อ** — ถ้าเสียงกับป้ายบนจออ่านได้คนละชื่อ
 * ต้องค้นทั้งสองชื่อ (ผู้ใช้ต้องเลือกเองว่าอันไหนถูก) ถ้าชื่อเดียวกัน
 * ก็ค้นคำเดียว ไม่ต้องยิงซ้ำ
 */
function buildQueries(
  raw: unknown,
  names: string[],
  admin: Record<string, unknown>
): string[] {
  const rows = Array.isArray(raw) ? (raw as any[]) : [];
  const rawQueries: string[] = [];
  for (const row of rows) {
    const q = typeof row === "string" ? row.trim() : "";
    if (!q || q.length > 120) continue;
    if (rawQueries.some((x) => x === q)) continue;
    rawQueries.push(q);
  }

  const where = ["subdistrict", "district", "province"]
    .map((key) => (typeof admin?.[key] === "string" ? (admin[key] as string).trim() : ""))
    .filter(Boolean);

  const out: string[] = [];
  const usedRaw = new Set<number>();
  for (const name of names) {
    if (!name) continue;
    // คำค้นจากโมเดลที่พูดถึงชื่อนี้ (ยังไม่ถูกใช้ไป) — ไม่มีก็สร้างเองจากชื่อ + พื้นที่
    let hit = -1;
    for (let i = 0; i < rawQueries.length; i++) {
      if (usedRaw.has(i)) continue;
      if (containsText(rawQueries[i], name)) {
        hit = i;
        break;
      }
    }
    const q =
      hit >= 0
        ? rawQueries[hit]
        : [name, ...where].join(" ").slice(0, 120);
    if (hit >= 0) usedRaw.add(hit);
    if (q && !out.some((x) => x === q)) out.push(q);
  }
  return out;
}

/**
 * แปลงคำตอบของรอบหาสถานที่ → รูปแบบที่ระบบใช้ พร้อมตัดสิ่งที่ไม่มีหลักฐานทิ้ง
 * -------------------------------------------------------------
 * กฎที่บังคับด้วยโค้ด (ไม่ใช่แค่ขอให้โมเดล):
 *   - ไม่มีหลักฐานที่ตรวจผ่าน = ไม่มีชื่อ (found = false)
 *   - มีหลักฐานแบบตรวจได้ (transcript/ป้าย/แคปชัน) = ชื่อต้องโผล่ในหลักฐานนั้น
 */
/**
 * พื้นที่บริหารที่ "มีที่มา" — ต้องโผล่ในข้อความในคลิปจริง
 * -------------------------------------------------------------
 * ชื่อสถานที่ถูกบังคับด้วยหลักฐานอยู่แล้ว แต่พื้นที่ (จังหวัด/อำเภอ/ตำบล)
 * โมเดลเดาได้โดยไม่ต้องมีที่มา → ถ้าเดาแล้วผิด คำค้น Google จะแคบไป
 * ผิดที่ → ไม่เจอสถานที่ที่ถูกเลย (แย่กว่าค้นกว้าง)
 *
 * กฎ: ต้องมีคำนี้อยู่ในข้อความที่ส่งเข้าไป (ถอดเสียง/ป้ายบนจอ/แคปชัน/
 * ที่อยู่ที่ผู้ใช้กรอก) หรือในหลักฐานที่ผ่านการตรวจแล้ว
 * ไม่มี → ตัดทิ้ง (ค้นกว้างขึ้น ดีกว่าค้นผิดที่)
 */
function verifyAdminValues(
  admin: Record<string, unknown>,
  input: VideoAnalysisInput,
  evidence: PlaceEvidence[]
): {
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  village: string | null;
} {
  const haystack = [
    input.transcript ?? "",
    (input.onScreenText ?? []).join(" \n "),
    input.caption ?? "",
    input.location ?? "",
    ...evidence.map((e) => e.quote),
  ].join(" \n ");

  const pick = (value: unknown): string | null => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s) return null;
    // "จังหวัดเชียงใหม่" → "เชียงใหม่" (โมเดลบางทีใส่คำนำหน้า)
    const bare = s.replace(/^(จังหวัด|อำเภอ|ตำบล|แขวง|เขต)\s*/u, "").trim();
    return containsText(haystack, s) || (!!bare && containsText(haystack, bare))
      ? s
      : null;
  };

  return {
    province: pick(admin.province),
    district: pick(admin.district),
    subdistrict: pick(admin.subdistrict),
    village: pick(admin.village),
  };
}

export function normalizePlaceResolution(
  raw: any,
  input: VideoAnalysisInput,
): PlaceResolution {
  const admin = raw?.admin ?? {};
  const str = (value: unknown): string | null => {
    const s = typeof value === "string" ? value.trim() : "";
    return s ? s : null;
  };

  // ── อ่านชื่อจากสองทาง: เสียงพูด และ ตัวหนังสือบนจอ ──────────────────
  // ทุก reading ที่รอดตรวจ = มี quote จริงในแหล่งนั้น + ชื่ออยู่ใน quote
  const readings = collectVerifiedReadings(raw?.readings, input);
  const fromSpeech = readings.find((r) => r.source === "transcript");
  const fromScreen = readings.find((r) => r.source === "on_screen_text");

  // ชื่อหลัก: เสียงพูดมาก่อน (คนพูดว่าที่นี่คืออะไร) → ถ้าไม่มีเสียงใช้ป้ายบนจอ
  const placeName = fromSpeech?.placeName ?? fromScreen?.placeName ?? str(raw?.place_name);
  const community = str(raw?.community);

  let evidence = collectVerifiedEvidence(raw?.evidence, input);
  // quote ของแต่ละ reading คือหลักฐานด้วย → เติมเข้าไป (ถ้ายังไม่มี)
  for (const r of readings) {
    if (evidence.some((e) => e.source === r.source && e.quote === r.quote)) continue;
    evidence.push({ source: r.source, quote: r.quote, note: r.note });
  }
  if (!evidence.length && placeName) {
    evidence = rescueEvidence(placeName, input);
  }

  const strictEvidence = evidence.filter((e) => e.source !== "visual");
  const nameInEvidence = evidence.some(
    (e) =>
      containsText(e.quote, placeName ?? "") ||
      containsText(placeName ?? "", e.quote),
  );
  const nameOk = placeName
    ? strictEvidence.length === 0
      ? true
      : nameInEvidence
    : false;

  // มี reading ที่ผ่านการตรวจ = มีหลักฐานรองรับชื่อนั้นจริง (แม้โมเดลจะตอบ found=false)
  const found =
    (raw?.found === true || readings.length > 0) &&
    !!placeName &&
    evidence.length > 0 &&
    nameOk;

  // หลักฐานที่มาจากภาพอย่างเดียว (ป้ายที่ Vision ถอดเป็นข้อความไม่ได้)
  // = เชื่อได้น้อยกว่าหลักฐานจากเสียง/ตัวหนังสือ → จำกัดคะแนนไว้ที่ 0.5
  const weakOnly =
    evidence.length > 0 && evidence.every((e) => e.source === "visual");

  // พื้นที่ที่ไม่มีที่มาในคลิป → ตัดทิ้ง (ค้นกว้างขึ้น ดีกว่าค้นผิดที่)
  const adminVerified = verifyAdminValues(admin, input, evidence);

  // ชื่อที่ต้องค้น: ชื่อที่ต่างกัน → ค้นทีละชื่อ (ผู้ใช้ต้องเลือกเอง)
  const names: string[] = [];
  for (const r of readings) {
    if (!names.some((n) => foldText(n) === foldText(r.placeName))) {
      names.push(r.placeName);
    }
  }
  if (!names.length && placeName) names.push(placeName);

  return {
    found,
    placeName: found ? placeName : null,
    community: found ? community : null,
    admin: adminVerified,
    category: str(raw?.category),
    confidence: found
      ? Math.min(clamp01(raw?.confidence) ?? 0, weakOnly ? 0.5 : 1)
      : 0,
    reason: str(raw?.reason),
    evidence,
    readings,
    queries: buildQueries(raw?.queries, found ? names : [], adminVerified),
  };
}

/**
 * รอบ AI ที่หน้าที่เดียว: หาสถานที่จากคลิป พร้อมหลักฐานที่ตรวจสอบได้
 * -------------------------------------------------------------
 * คืน `found = false` เมื่อ "ไม่มีหลักฐานพอ" (ไม่ใช่เมื่อเรียกไม่สำเร็จ)
 * ถ้าเรียกปลายทางไม่สำเร็จจะโยน error → ผู้เรียกต้องถอยไปใช้วิธีเดิม
 */
export async function resolvePlace(
  input: VideoAnalysisInput,
  diag?: DiagLog,
  onRaw?: (raw: any) => void
): Promise<PlaceResolution> {
  const t0 = Date.now();
  if (!isAiConfigured()) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า AI (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN) — หาสถานที่ไม่ได้"
    );
  }

  const promptText = buildPlaceResolvePrompt(input);
  const messageContent: any = input.videoUrl
    ? [
        { type: "text", text: promptText },
        { type: "video", source: { type: "url", url: input.videoUrl, fps: 1 } },
      ]
    : promptText;

  try {
    const res = await callAiText({
      url: `${config.ai.baseUrl}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: config.ai.model,
        max_tokens: PLACE_RESOLVE_MAX_TOKENS,
        temperature: 0.0,
        system: PLACE_RESOLVE_PROMPT,
        messages: [{ role: "user", content: messageContent }],
      },
      timeoutMs: config.ai.timeoutMs,
    });

    if (!res.ok) {
      throw new AiUpstreamError(res.status, res.body);
    }

    const parsed = extractJson(res.text);
    if (!parsed) {
      throw new Error("โมเดลตอบหาสถานที่มาไม่ใช่ JSON ที่อ่านได้");
    }

    const resolution = normalizePlaceResolution(parsed, input);
    onRaw?.(parsed);

    if (diag) {
      diag.add({
        id: "place-resolve",
        label: "หาสถานที่ (AI)",
        status: resolution.found ? "ok" : "skipped",
        ms: Date.now() - t0,
        detail: resolution.found
          ? `ได้ชื่อ "${resolution.placeName}" — หลักฐาน ${resolution.evidence.length} ชิ้น`
          : "ไม่มีหลักฐานที่ตรวจสอบได้ — ใช้วิธีเดิมแทน",
        data: {
          found: resolution.found,
          placeName: resolution.placeName,
          confidence: resolution.confidence,
          evidenceCount: resolution.evidence.length,
          queries: resolution.queries.join(" | "),
        },
      });
    }
    return resolution;
  } catch (err: any) {
    if (diag) {
      const msg = errorDetail(err);
      diag.add({
        id: "place-resolve",
        label: "หาสถานที่ (AI)",
        status: "failed",
        ms: Date.now() - t0,
        detail: msg,
        data: {
          upstreamStatus:
            typeof err?.upstreamStatus === "number" ? err.upstreamStatus : null,
        },
      });
      diag.problem(`หาสถานที่ล้มเหลว: ${msg}`);
    }
    throw err;
  }
}

/**
 * ให้ AI จัดอันดับผู้สมัครที่ Google ค้นมา ตามหลักฐานในคลิป
 * -------------------------------------------------------------
 * "จัดอันดับ" ไม่ใช่ "เลือก" — ผู้ใช้ยังต้องติ๊กเองเสมอ
 * ถ้าเรียกไม่สำเร็จ → คืนผู้สมัครเดิม (ลำดับจากโค้ด) ไม่ให้ขัด
 */
export async function rankPlaceCandidates(
  resolution: PlaceResolution,
  candidates: PlaceCandidate[],
  diag?: DiagLog
): Promise<PlaceCandidate[]> {
  if (!candidates.length) return [];
  const t0 = Date.now();
  if (!isAiConfigured()) return candidates;

  try {
    const res = await callAiText({
      url: `${config.ai.baseUrl}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: config.ai.model,
        max_tokens: PLACE_RANK_MAX_TOKENS,
        temperature: 0.0,
        system: PLACE_RANK_PROMPT,
        messages: [
          { role: "user", content: buildPlaceRankPrompt(resolution, candidates) },
        ],
      },
      timeoutMs: config.ai.timeoutMs,
    });

    if (!res.ok) {
      throw new AiUpstreamError(res.status, res.body);
    }

    const parsed = extractJson(res.text);
    const rows = parsed?.ranked;
    if (!Array.isArray(rows)) {
      throw new Error("โมเดลจัดอันดับสถานที่มาไม่ใช่ JSON ที่อ่านได้");
    }

    const byId = new Map<string, any>();
    for (const row of rows) {
      const id = row?.place_id;
      if (typeof id === "string" && id) byId.set(id, row);
    }

    const scored = candidates.map((c) => {
      const row = byId.get(c.placeId);
      if (!row) {
        return {
          ...c,
          aiScore: null,
          aiReason: null,
          evidenceMatch: null,
          aiRank: null,
        };
      }
      return {
        ...c,
        aiScore: clamp01(row?.score),
        aiReason: cleanNote(row?.reason),
        evidenceMatch: cleanNote(row?.evidence_match),
        aiRank: null,
      };
    });

    // เรียง: คะแนนสูงสุดก่อน · ตัวที่ยังไม่ได้คะแนนอยู่ท้ายสุด (คงลำดับเดิม)
    const order = scored
      .map((c, i) => ({ c, i, s: c.aiScore ?? -1 }))
      .sort((a, b) => b.s - a.s || a.i - b.i);
    const ranked = order.map((o, idx) => ({
      ...o.c,
      aiRank: o.c.aiScore == null ? null : idx + 1,
    }));

    if (diag) {
      diag.add({
        id: "place-rank",
        label: "จัดอันดับสถานที่ (AI)",
        status: "ok",
        ms: Date.now() - t0,
        detail: `จัดอันดับ ${ranked.length} รายการ (ตรงที่สุด: ${
          ranked.find((r) => r.aiRank === 1)?.name ?? "-"
        })`,
        data: {
          candidates: ranked.length,
          top: ranked.find((r) => r.aiRank === 1)?.placeId ?? null,
        },
      });
    }
    return ranked;
  } catch (err: any) {
    if (diag) {
      const msg = errorDetail(err);
      diag.add({
        id: "place-rank",
        label: "จัดอันดับสถานที่ (AI)",
        status: "failed",
        ms: Date.now() - t0,
        detail: `${msg} — ใช้ลำดับจากโค้ดแทน`,
        data: { candidates: candidates.length },
      });
      diag.problem(`จัดอันดับสถานที่ล้มเหลว: ${msg}`);
    }
    return candidates;
  }
}

/**
 * Ask the AI to suggest 2–3 captions for a post, using the clip's AI summary
 * + location as the main source, plus a set of hashtag suggestions.
 * Returns `{ captions, hashtags }`. The hashtags are suggestions the user picks
 * from — the app never posts them without a tap.
 */
export interface CaptionSuggestion {
  captions: string[];
  hashtags: string[];
}

export async function generateCaptions(input: CaptionInput): Promise<CaptionSuggestion> {
  if (!isAiConfigured()) {
    // Graceful stub so the feature works before the token is set.
    const place = input.locationName || input.province || "ชุมชน";
    const safePlace = place.replace(/\s+/g, "");
    return {
      captions: [
        `วันนี้พามาเที่ยว ${place} บรรยากาศดีมากกก 🌿`,
        `${place} สวยจนต้องมาเอง มาสัมผัสวิถีชุมชนกัน ✨`,
        `แวะ ${place} มาเติมพลังใจ 😊`,
      ],
      hashtags: [
        safePlace,
        "เที่ยวชุมชน",
        "ช้อปปิ้ง",
        "คาเฟ่",
        "ไทย",
      ].filter(Boolean),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const res = await fetch(`${config.ai.baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.ai.model,
        max_tokens: 1024,
        system: CAPTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildCaptionPrompt(input) }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AiUpstreamError(res.status, errText);
    }
    const data: any = await res.json();
    const rawText: string = Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content
      : "";

    const parsed = extractJson(rawText);
    if (parsed && Array.isArray(parsed.captions)) {
      const captions = parsed.captions
        .filter((c: unknown) => typeof c === "string")
        .slice(0, 3) as string[];
      const hashtags = pickHashtagSuggestions(parsed.hashtags, input.hashtags);
      return { captions, hashtags };
    }
    // Fallback: split lines if JSON wasn't returned.
    const captions = rawText
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    return { captions, hashtags: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stage 2: Turn structured JSON into an engaging 2-paragraph narrative
 * for display in the AI summary panel.
 *
 * Paragraph 1 = what the clip shows. Paragraph 2 = the conditions a
 * traveller needs before going (price, rules, capacity, zones, facilities).
 */
export async function generateNarration(
  analysisJson: any,
  diag?: DiagLog
): Promise<string> {
  const t0 = Date.now();

  // ─────────────────────────────────────────────────────────────────
  // VCA V2 (จุดต่อข้อ 2 จากแผน) — ไม่เขียนคำบรรยายรอบที่สอง
  // ─────────────────────────────────────────────────────────────────
  // ในโหมด V2 ข้อความการ์ด (summary.text) คือคำตอบที่ต้องการอยู่แล้ว
  // → คืนข้อความเดิม ไม่ยิงโมเดลอีกรอบ (AI 1 รอบจริง)
  if (config.ai.vcaV2Enabled) {
    const cardText = typeof analysisJson?.text === "string" ? analysisJson.text : "";
    if (cardText.trim()) {
      if (diag) {
        // ในโหมดการ์ด ข้อความการ์ดคือข้อความที่ผู้ใช้อ่าน → ถือว่า "เขียนเสร็จแล้ว"
        // (ไม่ใช่ "ข้าม" เพราะไม่ได้ข้ามงาน แค่ไม่ต้องยิงโมเดลรอบที่สอง)
        diag.add({
          id: "narration",
          label: "เขียนข้อความการ์ด",
          status: "ok",
          ms: Date.now() - t0,
          detail:
            "โหมดการ์ด — ข้อความการ์ดคือข้อความสำหรับโพสต์ (ไม่ยิงโมเดลรอบที่สอง)",
          data: { source: "card", chars: cardText.length },
        });
      }
      return cardText;
    }
  }

  const place = analysisJson?.place ?? analysisJson;
  const placeName = place?.place_name ?? null;
  const province = place?.location?.province ?? null;
  const district = place?.location?.district ?? null;
  const atmosphere = place?.atmosphere ?? analysisJson?.atmosphere ?? null;
  const highlights: string[] = place?.highlights ?? analysisJson?.highlights ?? [];

  const locationText = [district, province].filter(Boolean).join(" ");

  // Paragraph 1 — what the clip shows. The fallback must not be thinner
  // than the AI-written version, so it leans on the visual description and
  // falls back to the highlights / atmosphere when there is none.
  const visualDescription: string | null =
    analysisJson?.visualDescription ?? place?.visual_description ?? null;
  // The inventory is the narrator's checklist. In the fallback it becomes
  // paragraph 1 itself, so nothing the model saw is lost when the AI call
  // fails or the token is not configured.
  const sceneInventory: SceneItem[] = Array.isArray(analysisJson?.sceneInventory)
    ? analysisJson.sceneInventory
    : Array.isArray(place?.scene_inventory)
    ? place.scene_inventory
    : [];
  const inventoryLine = sceneInventory
    .map((row) => {
      const bits = [row.count, row.material, row.condition, row.position].filter(Boolean);
      return bits.length ? `${row.item} (${bits.join(", ")})` : row.item;
    })
    .join(", ");
  const fallbackVisual = visualDescription
    ? `ในคลิปนี้เห็น${visualDescription}`
    : inventoryLine
    ? `ในคลิปนี้เห็น${inventoryLine}`
    : highlights.length
    ? `ในคลิปนี้เห็น${highlights.join(" ")}`
    : atmosphere || "";

  // Paragraph 2 — the conditions. Same order the prompt asks for: price →
  // rules → capacity → zones → facilities.
  const conditions: string[] = [];
  const price = place?.price_info?.weekday ?? place?.price_info?.weekend ?? null;
  if (price) conditions.push(`ราคา ${price}`);
  const rules: string[] = Array.isArray(place?.rules) ? place.rules : [];
  if (rules.length) conditions.push(rules.join(" "));
  const cap = place?.capacity ?? null;
  if (cap?.rooms) conditions.push(`มี ${cap.rooms} ห้อง`);
  if (cap?.guests_per_room) conditions.push(`ห้องปกตินอนได้ ${cap.guests_per_room} คน`);
  if (cap?.max_guests) conditions.push(`ห้องใหญ่นอนได้ ${cap.max_guests} คน`);
  if (cap?.beds) conditions.push(`มี ${cap.beds} เตียง`);
  const areas: string[] = Array.isArray(place?.areas) ? place.areas : [];
  if (areas.length) conditions.push(areas.join(" "));
  const facilities: string[] = Array.isArray(place?.facilities) ? place.facilities : [];
  if (facilities.length) conditions.push(facilities.join(" "));

  const placeLine = placeName
    ? `${placeName}${locationText ? ` ที่ ${locationText}` : ""}`
    : "";
  const fallbackConditions = [
    placeLine,
    conditions.length
      ? conditions.join(" ")
      : "คลิปนี้พามาสัมผัสบรรยากาศความสวยงามและเสน่ห์ของชุมชนท้องถิ่นที่อบอุ่น ชวนแวะมาพักผ่อน สัมผัสวิถีชีวิตเป็นกันเอง และช้อปสินค้า OTOP ชุมชนด้วยตัวเองสักครั้งนะคะ!",
  ]
    .filter(Boolean)
    .join(" — ");

  const fallbackText = [fallbackVisual, fallbackConditions].filter(Boolean).join("\n\n");

  /** บันทึกว่าใช้ข้อความสำรองแทนคำบรรยายจาก AI — และทำไม */
  const noteFallback = (reason: string): string => {
    if (diag) {
      diag.add({
        id: "narration",
        label: "เขียนคำบรรยาย",
        status: "failed",
        ms: Date.now() - t0,
        detail: `ใช้ข้อความสำรอง — ${reason}`,
        data: { source: "fallback", chars: fallbackText.length },
      });
      diag.problem(`เขียนคำบรรยายไม่สำเร็จ (${reason}) — ใช้ข้อความสำรองแทน`);
    }
    return fallbackText;
  };

  if (!isAiConfigured()) {
    return noteFallback("ยังไม่ได้ตั้งค่า AI");
  }

  try {
    const requestBody = {
      model: config.ai.model,
      // Paragraph 1 is written at maximum detail (every object described by
      // material / count / condition), so the old 1024 budget truncated it
      // mid-sentence.
      max_tokens: 4096,
      temperature: 0.6,
      system: SUMMARY_NARRATION_PROMPT,
      messages: [{ role: "user", content: buildNarrationPrompt(analysisJson) }],
    };

    // สตรีมก่อนเสมอ (กัน proxy ตัดสายตอนโมเดลคิดนาน) — ถอยเป็นแบบ
    // ไม่สตรีมอัตโนมัติอยู่ใน callAiText
    const r = await callAiText({
      url: `${config.ai.baseUrl}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: requestBody,
      timeoutMs: config.ai.timeoutMs,
    });

    if (!r.ok) {
      console.warn("[generateNarration] AI returned status", r.status, "→ fallback");
      return noteFallback(`AI ตอบกลับสถานะ ${r.status}`);
    }

    const rawText = r.text;

    // Guards:
    // 1. If AI accidentally returned JSON
    const trimmed = rawText.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      console.warn("[generateNarration] AI returned JSON → using fallback");
      return noteFallback("โมเดลตอบมาเป็น JSON");
    }

    // 2. If AI replied with "ไม่มีข้อมูล" or similar
    if (
      rawText.includes("ไม่มีข้อมูลเพียงพอ") ||
      rawText.includes("ไม่พบข้อมูล") ||
      rawText.includes("ขอรอคลิป")
    ) {
      console.warn("[generateNarration] AI returned no-data phrase → using fallback");
      return noteFallback("โมเดลตอบว่าไม่มีข้อมูล");
    }

    if (diag) {
      const paragraphs = rawText.split(/\n\s*\n/).filter((p) => p.trim()).length;
      diag.add({
        id: "narration",
        label: "เขียนคำบรรยาย",
        status: "ok",
        ms: Date.now() - t0,
        detail: `ได้คำบรรยายจาก AI (${rawText.length} ตัวอักษร, ${paragraphs} ย่อหน้า)`,
        data: { source: "ai", chars: rawText.length, paragraphs },
      });
    }

    return rawText || noteFallback("โมเดลตอบมาว่าง");
  } catch (err) {
    console.warn("[generateNarration] error:", err);
    return noteFallback(errorDetail(err));
  }
}
