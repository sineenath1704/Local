import { Router, Request, Response } from "express";
import { generateSummary, generateNarration } from "../aiClient";
import {
  proofreadSummary,
  proofreadNarration,
  applyProofreadToSummary,
  narrationFacts,
} from "../thaiProofread";
import { getSummary, saveSummary, hasSummary } from "../summaryStore";
import { VideoAnalysisInput } from "../prompt";
import { enrichWithGooglePlaces } from "./places";
import { transcribeVideo, type TranscriptResult } from "../geminiTranscribe";
import { DiagLog, errorDetail } from "../summaryDiag";
import { errorBody } from "../middleware/errors";
import { requestId } from "../middleware/requestContext";

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
    `[summary] transcript: ${result.transcript.length} ตัวอักษร, audioType=${result.audioType}, transport=${result.transport}`
  );
  return {
    input: {
      ...input,
      transcript: result.transcript || undefined,
      audioType: result.audioType,
    },
    transcript: result,
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

    // Step 2: M3 summarizes — from the video, the transcript, and the text
    // on screen together.
    const rawSummary = await generateSummary(withAudio, diag);

    // Step 2b: proofread pass — the model writes fresh Thai, so it slips on
    // spelling. Copy-edit it BEFORE Google, because the place name is part
    // of the search query: a misspelled name finds nothing.
    const corrected = await proofreadSummary(rawSummary, withAudio.transcript, diag);
    const cleanSummary = corrected
      ? applyProofreadToSummary(rawSummary, corrected)
      : rawSummary;

    // Hand any transcript the caller supplied to the enricher so it can build a
    // better Google Places search query. See places.ts `_transcript`.
    const summaryWithCtx = withAudio.transcript
      ? {
          ...cleanSummary,
          _transcript: withAudio.transcript,
          _onScreenText: withAudio.onScreenText ?? [],
        }
      : cleanSummary;

    // Step 3: Google Places returns candidate places for the user to tick.
    const enriched = await enrichWithGooglePlaces(summaryWithCtx, diag).catch(
      (err: any) => {
        diag.problem(`ค้น Google Places ล้มเหลว: ${errorDetail(err)}`);
        return cleanSummary;
      }
    );

    // Step 4: Stage 2 Storytelling Narration
    const narrationText = await generateNarration(enriched, diag).catch(() => enriched.text);

    // Step 4b: proofread the narration — this is the text the reader sees.
    const cleanNarration = await proofreadNarration(
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
    const rawSummary = await generateSummary(input, diag);

    // Same proofread → Google → narration order as /preview: the corrected
    // place name is the one that goes into the Google search query.
    const corrected = await proofreadSummary(rawSummary, input.transcript, diag);
    const cleanSummary = corrected
      ? applyProofreadToSummary(rawSummary, corrected)
      : rawSummary;
    const summaryWithCtx = input.transcript
      ? { ...cleanSummary, _transcript: input.transcript }
      : cleanSummary;
    const enriched = await enrichWithGooglePlaces(summaryWithCtx, diag).catch(
      (err: any) => {
        diag.problem(`ค้น Google Places ล้มเหลว: ${errorDetail(err)}`);
        return cleanSummary;
      }
    );
    const narrationText = await generateNarration(enriched, diag).catch(() => enriched.text);
    const cleanNarration = await proofreadNarration(
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
