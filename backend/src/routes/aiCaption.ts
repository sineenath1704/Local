import { Router, Request, Response } from "express";
import { generateCaptions } from "../aiClient";
import { CaptionInput } from "../prompt";

const router = Router();

/**
 * POST /ai-caption
 * -------------------------------------------------------------
 * "ให้ AI ช่วยคิดแคปชัน" — returns 2-3 caption suggestions for a post,
 * built mainly from the clip's AI summary + location.
 *
 * Body (CaptionInput): {
 *   draft?, locationName?, province?, district?,
 *   hashtags?: string[], summaryText?, highlights?: string[],
 *   uploaderType?: "community" | "tourist"
 * }
 */
router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as CaptionInput;
  const input: CaptionInput = {
    draft: body.draft,
    locationName: body.locationName,
    province: body.province,
    district: body.district,
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : undefined,
    summaryText: body.summaryText,
    highlights: Array.isArray(body.highlights) ? body.highlights : undefined,
    uploaderType: body.uploaderType,
  };

  try {
    const captions = await generateCaptions(input);
    return res.json({ captions });
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ AI" : err?.message || "ขอแคปชันจาก AI ไม่สำเร็จ";
    return res.status(502).json({ status: "error", message });
  }
});

export default router;
