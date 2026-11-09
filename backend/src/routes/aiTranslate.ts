import { Router, Request, Response } from "express";
import { translateText } from "../aiClient";
import { TranslateInput } from "../prompt";
import { sendError } from "../middleware/errors";

const router = Router();

/**
 * POST /ai-translate
 * -------------------------------------------------------------
 * "เอไAI ช่วยแปลภาษา" — แปลคำที่ผู้ใช้เจอ (พิมพ์หรือพูด) ให้เป็นภาษาเป้าหมาย
 * ไม่ต้องล็อกอิน (เหมือน /ai-caption) — ใช้ตอนเที่ยว ไม่ต้องมีบัญชีก็แปลได้
 *
 * Body (TranslateInput): {
 *   text: "บางกอกอีหน่อยนะ",
 *   sourceId?: "auto",  sourceLabel?: "อัตโนมัติ — ตรวจหาให้",
 *   targetId?: "th-central", targetLabel?: "ภาษาของฉัน (ไทย)"
 * }
 *
 * ตอบกลับ: { detectedSource, sourceLabel, targetLabel, original,
 *             translation, pronunciation, note, confidence, sameLanguage }
 * translation = null → โมเดลไม่มีคำแปลที่ใช้ได้ (แอปบอกว่าแปลไม่สำเร็จ)
 */

/** ข้อความที่ยาวเกินนี้ไม่ใช่ "ประโยคที่พูด" → ปฏิเสธตั้งแต่ต้น */
const MAX_TEXT = 2000;

router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Partial<TranslateInput>;
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    return res.status(400).json({
      error: "ยังไม่ได้พิมพ์หรือพูดอะไร — พิมพ์ข้อความที่อยากแปลได้เลย",
      code: "EMPTY_TEXT",
    });
  }
  if (text.length > MAX_TEXT) {
    return res.status(400).json({
      error: `ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร`,
      code: "TEXT_TOO_LONG",
    });
  }

  const input: TranslateInput = {
    text,
    sourceId: typeof body.sourceId === "string" ? body.sourceId : "auto",
    sourceLabel:
      typeof body.sourceLabel === "string" && body.sourceLabel
        ? body.sourceLabel
        : "อัตโนมัติ — ตรวจหาให้",
    targetId: typeof body.targetId === "string" ? body.targetId : "",
    targetLabel:
      typeof body.targetLabel === "string" && body.targetLabel
        ? body.targetLabel
        : "ภาษาไทย",
  };

  try {
    const result = await translateText(input);
    return res.json(result);
  } catch (err: any) {
    sendError(res, err, req);
    return;
  }
});

export default router;
