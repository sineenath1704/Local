import { Router, Request, Response } from "express";
import { generateSummary } from "../aiClient";
import { getSummary, saveSummary, hasSummary } from "../summaryStore";
import { VideoAnalysisInput } from "../prompt";

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
    const summary = await generateSummary(readInput(req.body));
    return res.json(summary);
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ AI endpoint" : err?.message || "สร้างสรุปไม่สำเร็จ";
    return res.status(502).json({ status: "error", message });
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
    const summary = await generateSummary(readInput(req.body));
    await saveSummary(postId, summary);
    return res.status(201).json(summary);
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
