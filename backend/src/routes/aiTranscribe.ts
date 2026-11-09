import express, { Router, Request, Response, NextFunction } from "express";
import { transcribeAudio, MAX_AUDIO_BASE64_CHARS } from "../geminiAudio";
import { sendError } from "../middleware/errors";

const router = Router();

/**
 * POST /ai-transcribe
 * -------------------------------------------------------------
 * ถอดเสียงที่ผู้ใช้พูด (ปุ่มไมค์ในหน้าแปลภาษา) → ได้ข้อความกลับไปแสดงในช่อง
 * แล้วแอปจะยิง /ai-translate ต่อให้อัตโนมัติ (พูดแล้วแปลเลย)
 *
 * Body: { audioBase64: "…", mimeType: "audio/mp4" }
 * ตอบกลับ: { text: "บางกอกอีหน่อยนะ" }  ·  text = "" = ไม่มีเสียงพูด
 */

// เสียง base64 ค่อนข้างใหญ่ → route นี้ใช้ parser ของตัวเอง (ไม่ใช่ 1 MB ของทั้งแอป)
// ต้อง mount router นี้ก่อน express.json ของทั้งแอป (ดู app.ts)
router.use(express.json({ limit: "3mb" }));

// ไฟล์เสียงที่ใหญ่เกิน limit → ตอบ 413 พร้อมเหตุผลที่อ่านเข้าใจ
router.use(
  (err: any, _req: Request, res: Response, next: NextFunction): void => {
    if (err?.type === "entity.too.large") {
      res.status(413).json({
        error: "ไฟล์เสียงยาวเกินไป — ลองพูดสั้น ๆ แล้วใหม่",
        code: "AUDIO_TOO_LARGE",
      });
      return;
    }
    next(err);
  }
);

router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { audioBase64?: unknown; mimeType?: unknown };
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";

  if (!audioBase64) {
    return res.status(400).json({
      error: "ไม่มีไฟล์เสียง — ลองกดไมค์อีกครั้ง",
      code: "NO_AUDIO",
    });
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    return res.status(413).json({
      error: "ไฟล์เสียงยาวเกินไป — ลองพูดสั้น ๆ แล้วใหม่",
      code: "AUDIO_TOO_LARGE",
    });
  }

  const mimeType = typeof body.mimeType === "string" ? body.mimeType : undefined;

  try {
    const result = await transcribeAudio(audioBase64, mimeType);
    if (!result.ok) {
      return res.status(502).json({
        error: `ถอดเสียงไม่สำเร็จ: ${result.reason}`,
        code: "TRANSCRIBE_FAILED",
      });
    }
    return res.json({ text: result.text });
  } catch (err: any) {
    sendError(res, err, req);
    return;
  }
});

export default router;
