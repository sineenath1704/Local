import { Router, Request, Response } from "express";
import {
  generateSummary,
  generateNarration,
  resolvePlace,
  rankPlaceCandidates,
  type AiSummaryResult,
  type PlaceData,
} from "../aiClient";
import {
  proofreadSummary,
  proofreadNarration,
  applyProofreadToSummary,
  narrationFacts,
  proofreadCard,
  applyProofreadToCard,
  applyProofreadHighlights,
} from "../thaiProofread";
import { getSummary, saveSummary, hasSummary } from "../summaryStore";
import { VideoAnalysisInput } from "../prompt";
import { renderPostText } from "../videoPromptV2";
import { config } from "../config";
import {
  enrichWithGooglePlaces,
  searchClipPlaceCandidates,
  sortPlaceCandidates,
  needsSearchAll,
  type LocationScope,
  type PlaceSearchOutcome,
} from "./places";
import { transcribeVideo, type TranscriptResult } from "../geminiTranscribe";
import { DiagLog, errorDetail } from "../summaryDiag";
import { errorBody } from "../middleware/errors";
import { requestId } from "../middleware/requestContext";
import type { PlaceResolution } from "../placeTypes";

const router = Router();

function readInput(body: any): VideoAnalysisInput {
  return {
    caption: body?.caption,
    transcript: body?.transcript,
    audioType: body?.audioType,
    onScreenText: Array.isArray(body?.onScreenText) ? body.onScreenText : undefined,
    visualDescription: body?.visualDescription,
    videoDurationSec: body?.videoDurationSec,
    uploaderType: body?.uploaderType,
    location: body?.location,
    videoUrl: body?.videoUrl,
  };
}

/**
 * ขอบเขตทางภูมิศาสตร์ของการค้นสถานที่ — มาจาก `body.locationScope`
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §5.3
 *
 * ทำไมต้องมี
 *   โหมด `community_spot` ส่ง `uploaderType: "tourist"` และ `location: undefined`
 *   → backend ไม่รู้ว่าสถานที่อยู่ชุมชนไหน → ค้น Google ได้แค่ระดับประเทศ
 *   client จึงต้องบอก "ชุมชนนี้" มาด้วย (หมู่บ้าน / ตำบล / อำเภอ / จังหวัด)
 *   แล้ว backend จะกรอง candidate ให้เหลือแต่ในขอบเขตนั้น (§5.2)
 *
 * ทุกช่องเป็น optional — ขาดไปหนึ่งช่องก็ยังค้นได้ แค่กรองแคบลง
 */
function readScope(body: any): LocationScope | undefined {
  const raw = body?.locationScope;
  if (!raw || typeof raw !== "object") return undefined;
  const pick = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s : null;
  };
  const scope: LocationScope = {
    community: pick(raw.community),
    subdistrict: pick(raw.subdistrict),
    district: pick(raw.district),
    province: pick(raw.province),
  };
  // ไม่มีสักช่องที่ใช้ได้ → ไม่ต้องส่ง scope ไป (พฤติกรรมเดิม)
  if (!scope.community && !scope.subdistrict && !scope.district && !scope.province) {
    return undefined;
  }
  return scope;
}

/**
 * Pillar 1: give the summary the clip's SPEECH, not just its picture.
 *
 * The caller may hand us a transcript; if it doesn't, Gemini transcribes the
 * clip for us. `audioType` is then set to whatever the audio really is, so
 * the prompt can tell "no speech" apart from "speech we failed to capture".
 *
 * A transcription failure is NOT fatal — we fall back to a visual-only
 * summary and say so in the log, rather than wiping the user's data.
 */
async function withTranscript(
  input: VideoAnalysisInput,
  diag?: DiagLog
): Promise<{ input: VideoAnalysisInput; transcript: TranscriptResult | null }> {
  if (input.transcript?.trim()) {
    if (diag) diag.skip("transcribe", "ถอดเสียง (Gemini)", "ผู้เรียกส่ง transcript มาเอง");
    return { input, transcript: null };
  }
  if (!input.videoUrl) {
    if (diag) diag.skip("transcribe", "ถอดเสียง (Gemini)", "ไม่มี URL คลิป");
    return { input, transcript: null };
  }

  const result = await transcribeVideo(input.videoUrl, diag);
  if (!result) {
    console.warn("[summary] ถอดเสียงไม่สำเร็จ — สรุปจากภาพอย่างเดียว");
    return { input, transcript: null };
  }

  console.log(
    `[summary] transcript: ${result.transcript.length} ตัวอักษร, audioType=${result.audioType}, transport=${result.transport}` +
      (result.onScreenText.length
        ? `, ตัวหนังสือบนจอ ${result.onScreenText.length} บรรทัด`
        : "")
  );
  return {
    input: {
      ...input,
      transcript: result.transcript || undefined,
      audioType: result.audioType,
      // ตัวหนังสือบนจอมาจากคำขอเดียวกับเสียงพูด (คลิปอยู่ในคำขอนั้นอยู่แล้ว)
      // → รอบ "หาสถานที่" เห็นมันทันที ไม่ต้องรอบพิเศษ
      onScreenText: result.onScreenText.length
        ? result.onScreenText
        : input.onScreenText,
    },
    transcript: result,
  };
}

/**
 * ตรวจสะกดสรุป — แตกทางตามโหมด
 * -------------------------------------------------------------
 * · สายการ์ด (V2) → ตรวจ `summary.card` เพราะนั่นคือสิ่งที่แอปเรนเดอร์จริง
 *   (รอบตรวจสะกดสายเก่าแก้แค่ `text`/`place` → ผลที่แก้ไว้ไม่มีที่โผล่บนจอ
 *    แถมรอบนั้นคืน "คำบรรยาย" ที่เขียนใหม่ทั้งย่อหน้า ซึ่งการ์ดไม่ใช่)
 * · สายเก่า (V1) → ตรวจ `text`/`place` ตามเดิม
 *
 * ต้องทำก่อนค้น Google Places เสมอ — ชื่อสถานที่ที่สะกดผิดจะหาที่ไม่เจอ
 */
async function proofreadSummaryFor(
  summary: AiSummaryResult,
  transcript: string | null | undefined,
  diag: DiagLog
): Promise<AiSummaryResult> {
  const card = summary.card;
  if (config.ai.vcaV2Enabled && card) {
    // ไฮไลต์ไม่ได้อยู่ในการ์ด แต่แอปเรนเดอร์ใต้การ์ด → ต้องตรวจด้วย
    const originalHighlights =
      summary.highlights ?? summary.place?.highlights ?? [];
    const corrections = await proofreadCard(
      card,
      transcript,
      diag,
      originalHighlights
    );
    if (!corrections) return summary;
    const fixed = applyProofreadToCard(card, corrections);
    const highlights =
      applyProofreadHighlights(originalHighlights, corrections.highlights) ??
      originalHighlights;
    return {
      ...summary,
      card: fixed,
      // ข้อความล้วนต้องตรงกับการ์ด (แอป + Caption helper อ่าน text)
      text: renderPostText(fixed),
      // ไฮไลต์ที่ตรวจแล้ว (แอปอ่านจากตัวบนสุดก่อน)
      highlights,
      // ชื่อที่แก้แล้วต้องไปถึงจุดที่ใช้ค้น Google ด้วย
      place: summary.place
        ? {
            ...summary.place,
            place_name: fixed.place?.name ?? summary.place.place_name,
            highlights,
          }
        : summary.place,
    };
  }
  const corrected = await proofreadSummary(summary, transcript, diag);
  return corrected ? applyProofreadToSummary(summary, corrected) : summary;
}

/**
 * ตรวจสะกดคำบรรยาย
 * -------------------------------------------------------------
 * สายการ์ด: ข้อความที่ผู้ใช้เห็นคือการ์ด ซึ่งตรวจสะกดไปแล้ว
 * → ไม่ต้องยิงรอบตรวจคำบรรยายสายเก่าซ้ำ (เปลืองเวลาและโทเคนโดยเปล่า)
 * → และไม่ต้องโชว์ขั้นตอนนี้ในรายงานด้วย เพราะมันไม่ได้ทำงานอยู่จริง
 *   (ขั้นตอนที่ "ข้าม" ทำให้ผู้ใช้เข้าใจว่าระบบพัง)
 */
async function proofreadNarrationFor(
  text: string,
  facts: Record<string, unknown>,
  transcript: string | null | undefined,
  diag: DiagLog
): Promise<string> {
  if (config.ai.vcaV2Enabled) {
    // โหมดการ์ด — ไม่มีขั้นตอนนี้ในสายงาน ไม่ต้องรายงาน
    return text;
  }
  const fixed = await proofreadNarration(text, facts, transcript, diag);
  return fixed || text;
}

/**
 * รอบ "หาสถานที่" — มีหน้าที่เดียวคือหาชื่อพร้อมหลักฐานที่ตรวจสอบได้
 * -------------------------------------------------------------
 * ทำงานก่อนรอบสรุป เพราะ:
 *   · ชื่อที่ผ่านหลักฐานจะถูกใส่เป็น hint ให้รอบสรุป (ไม่ให้โมเดลตั้งชื่อใหม่)
 *   · คำค้น Google ต้องมาจากหลักฐาน ไม่ใช่จากการเดาของรอบสรุป
 *
 * ล้มเหลวหรือไม่มีหลักฐาน → คืน null → ระบบถอยไปใช้วิธีเดิม (รอบสรุปตั้งชื่อเอง)
 */
async function resolvePlaceSafely(
  input: VideoAnalysisInput,
  diag: DiagLog
): Promise<PlaceResolution | null> {
  try {
    const resolution = await resolvePlace(input, diag);
    return resolution.found ? resolution : null;
  } catch {
    // resolvePlace บันทึกลง diag ให้แล้ว → ไม่ต้องบันทึกซ้ำ
    return null;
  }
}

/**
 * ค้นผู้สมัครสถานที่ + ให้ AI จัดอันดับ — ทำงาน**ขนานกับรอบสรุป**
 * -------------------------------------------------------------
 * คำค้นมาจากหลักฐานในคลิป → ไม่ต้องรอรอบสรุป → รอบสรุปกับการค้น+จัดอันดับ
 * จึงเดินพร้อมกัน (ปกติรอบสรุปใช้เวลานานกว่าการค้นมาก)
 *
 * คืน `null` = ค้นไม่สำเร็จ (เช่น Google ล่ม) → ให้ระบบถอยไปค้นตามวิธีเดิม
 * คืนผลที่ไม่มีผู้สมัคร = ค้นแล้วไม่เจอจริง → ไม่ต้องค้นซ้ำ
 */
async function searchAndRankPlaces(
  resolution: PlaceResolution,
  scope: LocationScope | undefined,
  diag: DiagLog
): Promise<PlaceSearchOutcome | null> {
  const t0 = Date.now();
  try {
    // ขอบเขต: ของแอป > พื้นที่ที่มีหลักฐาน (เหมือนที่ enrichWithGooglePlaces ใช้)
    const activeScope: LocationScope | undefined = scope
      ? {
          community: scope.community ?? resolution.community ?? null,
          subdistrict: scope.subdistrict ?? resolution.admin.subdistrict ?? null,
          district: scope.district ?? resolution.admin.district ?? null,
          province: scope.province ?? resolution.admin.province ?? null,
        }
      : undefined;

    const outcome = await searchClipPlaceCandidates({
      evidenceQueries: resolution.queries,
      fallbackParts: [
        resolution.placeName,
        resolution.community,
        resolution.admin.subdistrict,
        resolution.admin.district,
        resolution.admin.province,
      ],
      scope: activeScope,
      maxCandidates: 8,
      // เสียงกับป้ายบนจออ่านได้คนละชื่อ → ค้นทั้งสองคำ ให้ผู้ใช้ติ๊กเอง
      searchAll: needsSearchAll(resolution),
    });

    // ให้ AI จัดอันดับ: เทียบแต่ละผู้สมัครกับหลักฐานในคลิป
    const ranked = await rankPlaceCandidates(resolution, outcome.candidates, diag);

    if (diag) {
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: outcome.candidates.length ? "ok" : "failed",
        ms: Date.now() - t0,
        detail: outcome.candidates.length
          ? `เจอ ${outcome.candidates.length} จุด — รอผู้ใช้ติ๊ก`
          : `ค้นแล้วไม่เจอสถานที่ (คำค้น: ${outcome.queries.join(" | ")})`,
        data: {
          candidates: outcome.candidates.length,
          queries: outcome.queries.length,
        },
      });
      if (!outcome.candidates.length) {
        diag.problem(
          `ค้น Google Places แล้วไม่เจอสถานที่ — คำค้น "${outcome.queries.join(" | ")}"`
        );
      }
    }

    return {
      ...outcome,
      candidates: sortPlaceCandidates(ranked, activeScope),
    };
  } catch (err: any) {
    diag.problem(`ค้น Google Places ล้มเหลว: ${errorDetail(err)}`);
    return null;
  }
}

/**
 * `place` ขั้นต่ำจากผลหาสถานที่ — ใช้เมื่อรอบสรุปไม่ได้ให้ฟิลด์ place มาเลย
 * แต่รอบ "หาสถานที่" หาชื่อพร้อมหลักฐานได้ → อย่าทิ้งผลที่หาได้
 */
function placeFromResolution(resolution: PlaceResolution): PlaceData {
  return {
    place_name: resolution.placeName,
    community: resolution.community,
    location: {
      province: resolution.admin.province,
      district: resolution.admin.district,
      subdistrict: resolution.admin.subdistrict,
    },
    category: resolution.category ? [resolution.category] : [],
    activities: [],
    price_info: { weekday: null, weekend: null },
    contact: {},
    otop_products: [],
    highlights: [],
    tags: [],
  };
}

/**
 * POST /ai-summary/preview
 * -------------------------------------------------------------
 * Generate a summary WITHOUT a saved video row — used at UPLOAD time,
 * before the video exists, so the owner (and the caption helper) can use it.
 * Does NOT persist. Body = Video Content Analyzer input.
 */
router.post("/preview", async (req: Request, res: Response) => {
  // บันทึกว่าแต่ละขั้นตอนเกิดอะไรขึ้น — ส่งกลับแอปใน `_diag`
  // และพิมพ์ไว้บน log ของเซิร์ฟเวอร์ (grep "[summary/diag]")
  const diag = new DiagLog();
  try {
    const input = readInput(req.body);

    // Step 1: Gemini transcribes the clip (so the summary can use the
    // uploader's words, not just the picture).
    const { input: withAudio } = await withTranscript(input, diag);

    // Step 1b: หาสถานที่ (มีหลักฐานรองรับ) — ต้องเสร็จก่อนรอบสรุป
    //   · ชื่อที่ผ่านหลักฐานจะถูกใส่เป็น hint ให้รอบสรุป
    //   · คำค้น Google มาจากหลักฐาน ไม่ต้องรอชื่อที่รอบสรุปตั้งเอง
    const resolution = await resolvePlaceSafely(withAudio, diag);
    const withPlace: VideoAnalysisInput = resolution
      ? { ...withAudio, resolvedPlace: resolution }
      : withAudio;

    // Step 2 + Step 3 ขนานกัน — รอบสรุป ↔ ค้น Google + จัดอันดับผู้สมัคร
    // (คำค้นมาจากหลักฐาน จึงไม่ต้องรอรอบสรุป)
    const scope = readScope(req.body);
    const [rawSummary, searched] = await Promise.all([
      generateSummary(withPlace, diag),
      resolution
        ? searchAndRankPlaces(resolution, scope, diag)
        : Promise.resolve(null),
    ]);

    // Step 2b: proofread pass — the model writes fresh Thai, so it slips on
    // spelling. Copy-edit it BEFORE Google, because the place name is part
    // of the search query: a misspelled name finds nothing.
    const cleanSummary = await proofreadSummaryFor(
      rawSummary,
      withAudio.transcript,
      diag
    );

    // ผลการหาสถานที่ติดไปกับสรุป — ไม่งั้นคำค้นจะกลับไปใช้ชื่อที่รอบสรุปตั้งเอง
    const summaryWithResolution = resolution
      ? {
          ...cleanSummary,
          place: cleanSummary.place ?? placeFromResolution(resolution),
          placeResolution: resolution,
        }
      : cleanSummary;

    // Hand any transcript the caller supplied to the enricher so it can build a
    // better Google Places search query. See places.ts `_transcript`.
    const summaryWithCtx = withAudio.transcript
      ? {
          ...summaryWithResolution,
          _transcript: withAudio.transcript,
          _onScreenText: withAudio.onScreenText ?? [],
        }
      : summaryWithResolution;

    // Step 3: Google Places returns candidate places for the user to tick.
    // The scope (community / tambol / amphur) comes from the client — without
    // it we can only search the whole country. PLAN §5.3
    // `searched` = ผลค้นที่ทำไว้ขนานกับรอบสรุป → ไม่ต้องจ่ายซ้ำ
    const enriched = await enrichWithGooglePlaces(
      summaryWithCtx,
      diag,
      scope,
      searched
    ).catch((err: any) => {
      diag.problem(`ค้น Google Places ล้มเหลว: ${errorDetail(err)}`);
      return summaryWithCtx;
    });

    // Step 4: Stage 2 Storytelling Narration
    const narrationText = await generateNarration(enriched, diag).catch(() => enriched.text);

    // Step 4b: proofread the narration — this is the text the reader sees.
    const cleanNarration = await proofreadNarrationFor(
      narrationText,
      narrationFacts(enriched),
      withAudio.transcript,
      diag
    );
    const report = diag.finish();
    const finalSummary = { ...enriched, text: cleanNarration || narrationText, _diag: report };
    console.log("[summary/diag]", JSON.stringify(report));

    return res.json(finalSummary);
  } catch (err: any) {
    const body = errorBody(err, req);
    const report = diag.finish();
    console.log("[summary/diag]", JSON.stringify(report));
    return res
      .status(502)
      .json({ ...body, status: "error", message: body.error, _diag: report });
  }
});

/**
 * GET /ai-summary/:postId
 * The mobile app calls this to DISPLAY a pre-computed summary.
 * Reads Supabase first (persisted at upload), then memory.
 */
router.get("/:postId", async (req: Request, res: Response) => {
  const summary = await getSummary(req.params.postId);
  if (!summary) {
    return res.status(404).json({
      status: "processing",
      message: "ยังไม่มีสรุปสำหรับวิดีโอนี้ (ยังไม่ถูกประมวลผล)",
      code: "NOT_FOUND",
      requestId: requestId(req),
    });
  }
  return res.json(summary);
});

/**
 * POST /ai-summary/:postId/generate
 * Called at UPLOAD time once the video row exists: generate + PERSIST to the
 * video's row (Supabase), so the app reads it instantly later.
 */
router.post("/:postId/generate", async (req: Request, res: Response) => {
  const { postId } = req.params;
  const diag = new DiagLog();
  try {
    const { input } = await withTranscript(readInput(req.body), diag);

    // หาสถานที่ (มีหลักฐานรองรับ) — ก่อนรอบสรุป เพื่อให้ชื่อที่ผ่านหลักฐาน
    // เป็นทั้ง hint ให้รอบสรุป และคำค้น Google
    const resolution = await resolvePlaceSafely(input, diag);
    const withPlace: VideoAnalysisInput = resolution
      ? { ...input, resolvedPlace: resolution }
      : input;

    // รอบสรุป ↔ ค้น Google + จัดอันดับ — ขนานกัน
    const scope = readScope(req.body);
    const [rawSummary, searched] = await Promise.all([
      generateSummary(withPlace, diag),
      resolution
        ? searchAndRankPlaces(resolution, scope, diag)
        : Promise.resolve(null),
    ]);

    // Same proofread → Google → narration order as /preview: the corrected
    // place name is the one that goes into the Google search query.
    const cleanSummary = await proofreadSummaryFor(
      rawSummary,
      input.transcript,
      diag
    );
    const summaryWithResolution = resolution
      ? {
          ...cleanSummary,
          place: cleanSummary.place ?? placeFromResolution(resolution),
          placeResolution: resolution,
        }
      : cleanSummary;
    const summaryWithCtx = input.transcript
      ? { ...summaryWithResolution, _transcript: input.transcript }
      : summaryWithResolution;
    const enriched = await enrichWithGooglePlaces(
      summaryWithCtx,
      diag,
      scope,
      searched
    ).catch((err: any) => {
      diag.problem(`ค้น Google Places ล้มเหลว: ${errorDetail(err)}`);
      return summaryWithCtx;
    });
    const narrationText = await generateNarration(enriched, diag).catch(() => enriched.text);
    const cleanNarration = await proofreadNarrationFor(
      narrationText,
      narrationFacts(enriched),
      input.transcript,
      diag
    );
    const report = diag.finish();
    const finalSummary = { ...enriched, text: cleanNarration || narrationText, _diag: report };
    console.log("[summary/diag]", JSON.stringify(report));
    await saveSummary(postId, finalSummary);
    return res.status(201).json(finalSummary);
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ AI endpoint" : err?.message || "สร้างสรุปด้วย AI ไม่สำเร็จ";
    const report = diag.finish();
    console.log("[summary/diag]", JSON.stringify(report));
    return res.status(502).json({ status: "error", message, _diag: report });
  }
});

/** Persist an already-generated summary for a video id (upload flow convenience). */
router.put("/:postId", async (req: Request, res: Response) => {
  const { postId } = req.params;
  const summary = req.body;
  if (!summary || typeof summary.text !== "string") {
    return res.status(400).json({ error: "invalid summary body" });
  }
  await saveSummary(postId, summary);
  return res.json({ ok: true });
});

/** HEAD-style check used by clients/pipelines to see if a summary exists. */
router.get("/:postId/exists", async (req: Request, res: Response) => {
  return res.json({ exists: await hasSummary(req.params.postId) });
});

export default router;
