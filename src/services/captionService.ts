import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import { aiFetch, AiError, asAiError, toastAiError } from "./aiHttp";

/**
 * Caption helper + pre-upload AI summary.
 * -------------------------------------------------------------
 * Both talk to OUR backend (which holds the AI token). The summary is
 * generated at UPLOAD time (before posting) via /ai-summary/preview — no
 * DB row exists yet — then persisted with the video on post, so the comment
 * sheet reads it instantly later.
 */

/** A Google Places candidate the user can tick. */
export interface GooglePlaceCandidate {
  name: string;
  address: string;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  types: string[];
  phone?: string | null;
  openingHours?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  website?: string | null;
  googleMapsUri?: string | null;
  businessStatus?: string | null;
  primaryType?: string | null;
  primaryTypeDisplayName?: string | null;
  priceLevel?: number | null;
}

/** Structured place block (mirrors backend AiSummaryResult.place). */
export interface SummaryPlace {
  place_name: string | null;
  community?: string | null;
  location: {
    province: string | null;
    district: string | null;
    subdistrict?: string | null;
    gps?: string | null;
  };
  atmosphere?: string | null;
  category: string[];
  activities: string[];
  price_info: {
    weekday: string | null;
    weekend: string | null;
    currency?: string;
    /** Google's price band for a confirmed place ("฿" / "฿฿฿" / "ฟรี"). */
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
   * How many people the place takes. Strings on purpose — the clip says
   * "ห้องใหญ่ 4-6 คน" and a number would force one reading of that.
   */
  capacity?: {
    rooms?: string | null;
    guests_per_room?: string | null;
    max_guests?: string | null;
    beds?: string | null;
  } | null;
  /** กติกาของสถานที่ เช่น "รับวันละ 1 กลุ่ม" */
  rules?: string[];
  /** โซน/พื้นที่ในสถานที่ เช่น "โซนเจ้าบ้าน" */
  areas?: string[];
  /** สิ่งอำนวยความสะดวก เช่น "ระเบียง", "กองไฟ" */
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
  /** Places the AI found for this clip — the user ticks one, we never pick. */
  google_candidates?: GooglePlaceCandidate[];
}

/** ผลของหนึ่งขั้นตอนในการสรุป */
export type DiagStatus = "ok" | "failed" | "skipped";

export interface DiagStep {
  id: string;
  label: string;
  status: DiagStatus;
  /** ใช้เวลากี่มิลลิวินาที */
  ms: number;
  /** อธิบายสั้น ๆ ว่าเกิดอะไรขึ้น */
  detail: string;
  data?: Record<string, number | string | boolean | null>;
}

/**
 * รายงานการวิเคราะห์ — backend ส่งกลับมาพร้อม summary
 * บอกว่าแต่ละขั้นตอน (ถอดเสียง → สรุป → ตรวจสะกด → ค้นสถานที่ → เขียนคำบรรยาย)
 * เกิดอะไรขึ้น เพื่อให้รู้ว่า "ทำไมข้อมูลไม่ครบ"
 */
export interface SummaryDiag {
  startedAt: string;
  totalMs: number;
  verdict: "ok" | "partial" | "failed";
  /** ปัญหาที่ทำให้ข้อมูลไม่ครบ */
  problems: string[];
  steps: DiagStep[];
}

/** Full summary object returned by the backend (what we persist + display). */
export interface AiSummaryResult {
  status: "ready" | "processing" | "unavailable" | "error";
  generatedAt?: string;
  model?: string;
  text: string;
  /** Detailed description of everything visible in the clip (Pillar 1). */
  visualDescription?: string;
  place?: SummaryPlace;
  tags?: string[];
  highlights?: string[];
  visualTags?: string[];
  onScreenText?: string[];
  transcriptHighlights?: string[];
  /** รายงานการวิเคราะห์ (มีตอน backend ทำงานสำเร็จบางส่วนหรือล้มเหลว) */
  _diag?: SummaryDiag;
}

export interface SummaryInput {
  caption?: string;
  location?: string;
  audioType?: "speech" | "music" | "mixed" | "none";
  uploaderType?: "tourist" | "community";
  /** Public URL of the clip — makes the backend analyze the VIDEO directly. */
  videoUrl?: string;
}

/**
 * Budget for one full summary run: Gemini transcription + M3 video analysis
 * + narration. The old 48s (API_TIMEOUT_MS × 6) was shorter than the
 * server's own 120s AI timeout, so long clips always timed out on the
 * phone while the server was still working.
 */
const SUMMARY_TIMEOUT_MS = 240000;

export interface CaptionRequest {
  draft?: string;
  locationName?: string;
  province?: string;
  district?: string;
  hashtags?: string[];
  summaryText?: string;
  highlights?: string[];
}

/**
 * Generate the FULL AI summary for a clip before posting (no DB row yet).
 *
 * Returns the whole summary object so the UI can show it and we can persist
 * it verbatim with the video.
 *
 * Throws `AiError` on failure — this used to return `null`, which the caller
 * could not tell apart from "AI ran fine but found no location". A null used
 * to make the create-post screen wipe the user's typed-in location fields.
 *
 * The timeout is long on purpose: the server now runs the whole pipeline —
 * Gemini transcribes the clip, M3 reads the video and the transcript, then a
 * narration pass writes the final text. That is minutes, not seconds.
 */
export async function generatePreviewSummary(
  input: SummaryInput
): Promise<AiSummaryResult> {
  const timeoutMs = SUMMARY_TIMEOUT_MS;
  const data = await aiFetch<AiSummaryResult>({
    label: "ai-summary/preview",
    path: "/ai-summary/preview",
    method: "POST",
    body: {
      caption: input.caption ?? "",
      location: input.location ?? "",
      audioType: input.audioType ?? "none",
      uploaderType: input.uploaderType ?? "tourist",
      videoUrl: input.videoUrl,
    },
    timeoutMs,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });

  if (!data || typeof data.text !== "string") {
    throw new AiError({
      kind: "bad-shape",
      status: 200,
      body: JSON.stringify(data ?? null),
      requestId: null,
      label: "ai-summary/preview",
      url: `${API_BASE_URL}/ai-summary/preview`,
      durationMs: 0,
      timeoutMs,
    });
  }
  return data;
}

/**
 * ดึงรายงานการวิเคราะห์ออกจากคำตอบที่ backend ตอบกลับ — ทั้งกรณีสำเร็จ
 * (อยู่ใน `summary._diag`) และกรณีล้มเหลว (อยู่ใน body ของ error)
 *
 * ใช้ตอนสรุปไม่สำเร็จ เพื่อบอกผู้ใช้ว่า "ติดที่ขั้นไหน" แทนคำว่า "เรียก AI ไม่สำเร็จ"
 */
export function extractDiag(err: unknown): SummaryDiag | null {
  const aiErr = asAiError(err);
  // `responseBody` = ข้อความที่ backend ส่งมาทั้งก้อน (มี `_diag`)
  // `body` = อาจเป็น body ของปลายทาง AI ที่ backend ส่งต่อมาแทน
  const raw = aiErr?.responseBody ?? aiErr?.body;
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const diag = data?._diag;
    if (diag && typeof diag === "object" && Array.isArray(diag.steps)) {
      return diag as SummaryDiag;
    }
  } catch {
    // body ไม่ใช่ JSON — ไม่มีรายงานให้ดึง
  }
  return null;
}

/** Caption suggestions + hashtag suggestions returned by the backend. */
export interface CaptionSuggestion {
  captions: string[];
  hashtags: string[];
}

/**
 * Returns 2–3 caption suggestions + a set of suggested hashtags.
 * Throws `AiError` on failure (was: `[]`).
 */
export async function suggestCaptions(req: CaptionRequest): Promise<CaptionSuggestion> {
  const data = await aiFetch<{ captions?: unknown; hashtags?: unknown }>({
    label: "ai-caption",
    path: "/ai-caption",
    method: "POST",
    body: req,
    timeoutMs: API_TIMEOUT_MS * 3,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });

  if (!Array.isArray(data?.captions)) {
    throw new AiError({
      kind: "bad-shape",
      status: 200,
      body: JSON.stringify(data ?? null),
      requestId: null,
      label: "ai-caption",
      url: `${API_BASE_URL}/ai-caption`,
      durationMs: 0,
      timeoutMs: API_TIMEOUT_MS * 3,
    });
  }
  const captions = data.captions.filter((c: unknown): c is string => typeof c === "string");
  const hashtags = Array.isArray(data?.hashtags)
    ? data.hashtags.filter((h: unknown): h is string => typeof h === "string")
    : [];
  return { captions, hashtags };
}
