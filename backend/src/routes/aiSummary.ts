import { Router, Request, Response } from "express";
import { generateSummary, generateNarration } from "../aiClient";
import { getSummary, saveSummary, hasSummary } from "../summaryStore";
import { VideoAnalysisInput } from "../prompt";
import { enrichWithGooglePlaces } from "./places";
import { transcribeVideo } from "../transcribe";
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
 * POST /ai-summary/preview
 * -------------------------------------------------------------
 * Generate a summary WITHOUT a saved video row — used at UPLOAD time,
 * before the video exists, so the owner (and the caption helper) can use it.
 * Does NOT persist. Body = Video Content Analyzer input.
 */
router.post("/preview", async (req: Request, res: Response) => {
  try {
    const input = readInput(req.body);
    let transcriptionResult: Awaited<ReturnType<typeof transcribeVideo>> | null = null;

    // Step 1: If we have a video URL, transcribe audio + describe visuals first.
    if (input.videoUrl) {
      // eslint-disable-next-line no-console
      console.log("[preview] transcribing video →", input.videoUrl.slice(-40));
      const tr = await transcribeVideo(input.videoUrl).catch(() => null);
      transcriptionResult = tr;
      if (tr) {
        // eslint-disable-next-line no-console
        console.log("[preview] transcript hasAudio =", tr.hasAudio,
          "len =", tr.transcript?.length ?? 0,
          "onScreen =", tr.onScreenText.length);
        if (tr.transcript) input.transcript = tr.transcript;
        if (tr.visualDescription) input.visualDescription = tr.visualDescription;
        if (tr.onScreenText.length > 0) input.onScreenText = tr.onScreenText;
        input.audioType = tr.hasAudio ? "speech" : "none";
      }
    }

    // Step 2: M3 summarizes.
    const rawSummary = await generateSummary(input);

    // Pass transcript to enricher for a better Google search query.
    const summaryWithCtx = transcriptionResult?.transcript
      ? { ...rawSummary, _transcript: transcriptionResult.transcript, _onScreenText: transcriptionResult.onScreenText }
      : rawSummary;

    // Step 3: Google Places fills province/district/coords.
    const enriched = await enrichWithGooglePlaces(summaryWithCtx).catch(() => rawSummary);

    // Step 4: Stage 2 Storytelling Narration
    const narrationText = await generateNarration(enriched).catch(() => enriched.text);
    const finalSummary = { ...enriched, text: narrationText };

    return res.json(finalSummary);
  } catch (err: any) {
    const body = errorBody(err, req);
    return res.status(502).json({ ...body, status: "error", message: body.error });
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
  try {
    const rawSummary = await generateSummary(readInput(req.body));
    const enriched = await enrichWithGooglePlaces(rawSummary).catch(() => rawSummary);
    const narrationText = await generateNarration(enriched).catch(() => enriched.text);
    const finalSummary = { ...enriched, text: narrationText };
    await saveSummary(postId, finalSummary);
    return res.status(201).json(finalSummary);
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ AI endpoint" : err?.message || "สร้างสรุปด้วย AI ไม่สำเร็จ";
    return res.status(502).json({ status: "error", message });
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
