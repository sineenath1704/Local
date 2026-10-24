import { Router, Request, Response } from "express";
import { generateCaptions } from "../aiClient";
import { CaptionInput } from "../prompt";
import { errorBody } from "../middleware/errors";

const router = Router();

/**
 * POST /ai-caption
 * -------------------------------------------------------------
 * "ให้ AI ช่วยคิดแคปชัน" — returns 2-3 caption suggestions for a post,
 * built mainly from the clip's AI summary + location, plus a set of
 * suggested hashtags the user can tap to add.
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
    const { captions, hashtags } = await generateCaptions(input);
    return res.json({ captions, hashtags });
  } catch (err: any) {
    const body = errorBody(err, req);
    // Keep `status`/`message` keys so the existing client shape still works.
    return res.status(502).json({ ...body, status: "error", message: body.error });
  }
});

export default router;
