import { Router, Request, Response } from "express";
import { generateSummary } from "../aiClient";
import { getSummary, saveSummary, hasSummary } from "../summaryStore";
import { VideoAnalysisInput } from "../prompt";

const router = Router();

/**
 * GET /ai-summary/:postId
 * -------------------------------------------------------------
 * The mobile app calls this to DISPLAY a pre-computed summary.
 * Returns 200 + summary when ready, 404 when not generated yet.
 */
router.get("/:postId", (req: Request, res: Response) => {
  const { postId } = req.params;
  const summary = getSummary(postId);

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
 * -------------------------------------------------------------
 * Called at UPLOAD time (by the upload pipeline / owner), NOT when a user
 * opens comments. Body carries the Speech-to-Text + Vision results.
 *
 * Body (Video Content Analyzer input): {
 *   caption?: string,
 *   transcript?: string,                               // audio_transcript
 *   audioType?: "speech" | "music" | "mixed" | "none",
 *   onScreenText?: string[],
 *   visualDescription?: string,                        // from Vision AI
 *   videoDurationSec?: number,
 *   uploaderType?: "community" | "tourist",
 *   location?: string
 * }
 */
router.post("/:postId/generate", async (req: Request, res: Response) => {
  const { postId } = req.params;
  const body = (req.body ?? {}) as VideoAnalysisInput;

  const input: VideoAnalysisInput = {
    caption: body.caption,
    transcript: body.transcript,
    audioType: body.audioType,
    onScreenText: Array.isArray(body.onScreenText) ? body.onScreenText : undefined,
    visualDescription: body.visualDescription,
    videoDurationSec: body.videoDurationSec,
    uploaderType: body.uploaderType,
    location: body.location,
  };

  try {
    const summary = await generateSummary(input);
    saveSummary(postId, summary);
    return res.status(201).json(summary);
  } catch (err: any) {
    const message = err?.name === "AbortError"
      ? "หมดเวลาเชื่อมต่อ AI endpoint"
      : err?.message || "สร้างสรุปด้วย AI ไม่สำเร็จ";
    return res.status(502).json({ status: "error", message });
  }
});

/** HEAD-style check used by clients/pipelines to see if a summary exists. */
router.get("/:postId/exists", (req: Request, res: Response) => {
  return res.json({ exists: hasSummary(req.params.postId) });
});

export default router;
