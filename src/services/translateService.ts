import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { aiFetch } from "./aiHttp";
import type { TranslateResult } from "../data/translateData";

/**
 * ยิงไปหา "AI ช่วยแปลภาษา" ฝั่ง backend
 * -------------------------------------------------------------
 * · /ai-translate  = แปลข้อความ (เป็นของ AI ฝั่งบ้าน)
 * · /ai-transcribe = ถอดเสียงที่ผู้ใช้พูด (Gemini) → แล้วค่อยแปลต่อ
 *
 * ทั้งสองเส้นทางไม่ต้องล็อกอิน (เหมือน /ai-caption) — ใช้ตอนเที่ยวได้เลย
 */

/**
 * แปลข้อความไม่นานเท่าไร
 * -------------------------------------------------------------
 * ฝั่ง backend ทำได้ 2 รอบ (ตรวจภาษา + ค้นเว็บ → แปลต่อเป้าหมาย)
 * รอบแรกมี google_search → ให้เวลาเยอะไว้
 */
const TRANSLATE_TIMEOUT_MS = 120000;

/** ถอดเสียงนานกว่า (ส่งไฟล์เสียงขึ้นไปด้วย) */
const TRANSCRIBE_TIMEOUT_MS = 60000;

/**
 * ขนาด base64 สูงสุด — ต้องตรงกับ MAX_AUDIO_BASE64_CHARS ฝั่ง backend
 * (3 MB) ไม่งั้นจะได้ 413 จากฝั่ง server (ข้อความจะน้อยกว่าที่ควรเป็น)
 */
const MAX_AUDIO_BASE64_CHARS = 3 * 1024 * 1024;

export interface TranslateRequest {
  text: string;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
}

/**
 * แปลข้อความ
 * คืนผลลัพธ์ที่ normalize แล้ว (ค่าที่แอปใช้ต่อได้เลย ไม่ต้องกันเอง)
 * โยน error เมื่อเซิร์ฟเวอร์ตอบมาไม่ใช่รูปแบบที่รู้จัก
 */
export async function translateText(
  input: TranslateRequest
): Promise<TranslateResult> {
  const raw = await aiFetch<unknown>({
    label: "ai-translate",
    path: "/ai-translate",
    method: "POST",
    body: input,
    timeoutMs: TRANSLATE_TIMEOUT_MS,
  });
  return normalizeResult(raw, input);
}

/**
 * แปลข้อความ (ทางเข้าหลักของหน้าจอ)
 * -------------------------------------------------------------
 * ตอนนี้ฝั่ง backend ทำ "2 ขั้น" ให้เอง ภายในคำขอเดียว:
 *   ขั้น 1  ตรวจภาษา + หาความหมายกลาง (ภาษาไทยภาษากลาง) — ค้นเว็บช่วยเมื่อไม่รู้
 *   ขั้น 2  ถ้าปลายทางไม่ใช่ภาษากลาง → แปล "ความหมายกลาง" ไปเป็นภาษาเป้าหมาย
 * แอปจึงยิงแค่คำขอเดียว และได้ทั้ง "ภาษาที่ตรวจพบ" + "คำแปล" + "ความหมายกลาง"
 */
export async function translateTextFlow(
  input: TranslateRequest
): Promise<TranslateResult> {
  return translateText(input);
}

/**
 * ถอดเสียงจากไฟล์ที่อัดไว้ → ข้อความ
 * คืน "" เมื่อไฟล์นั้นไม่มีเสียงพูดจริง ๆ (ผู้ใช้เงียบไป)
 */
export async function transcribeAudio(
  uri: string,
  mimeType: string
): Promise<string> {
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  if (!base64) {
    throw new Error("ไม่ได้ยินเสียงพูด — ลองพูดอีกครั้ง");
  }
  if (base64.length > MAX_AUDIO_BASE64_CHARS) {
    throw new Error("เสียงยาวเกินไป — ลองพูดสั้น ๆ แล้วใหม่");
  }

  const raw = await aiFetch<unknown>({
    label: "ai-transcribe",
    path: "/ai-transcribe",
    method: "POST",
    body: { audioBase64: base64, mimeType },
    timeoutMs: TRANSCRIBE_TIMEOUT_MS,
  });

  const text = (raw as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text.trim() : "";
}

/**
 * กันคำตอบมั่วจากการอ่านผิดรูปแบบ
 * -------------------------------------------------------------
 * กติกา: ต้องมี "original" หรือ "translation" อย่างน้อยอันหนึ่ง
 * ถ้าไม่มีเลย = เซิร์ฟเวอร์ตอบมาไม่ใช่รูปแบบที่เรารู้จัก
 * → โยน error ให้ผู้ใช้เห็นว่า "แปลไม่สำเร็จ" แทนที่จะโชว์คำแปลมั่ว
 */
function normalizeResult(
  raw: unknown,
  input: TranslateRequest
): TranslateResult {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const text = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    return v.trim() === "" ? null : v;
  };

  const original = text(data.original);
  const translation = text(data.translation);

  if (!original && !translation) {
    throw new Error(
      "แปลไม่สำเร็จ — เซิร์ฟเวอร์ตอบมาไม่ใช่รูปแบบที่อ่านได้ ลองอีกครั้ง"
    );
  }

  const rawConfidence = Number(data.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : 0.5;

  return {
    detectedSource: text(data.detectedSource),
    detectedSourceId: text(data.detectedSourceId),
    sourceLabel: text(data.sourceLabel) ?? input.sourceLabel,
    targetLabel: text(data.targetLabel) ?? input.targetLabel,
    // ต้นฉบับต้องเป็นของผู้ใช้เสมอ (ไม่ใช่ของที่โมเดลยกมา)
    original: original ?? input.text,
    translation,
    // ความหมายกลาง (มีตอนที่ backend แปลผ่านไทยภาษากลางมา)
    centralMeaning: text(data.centralMeaning),
    pronunciation: text(data.pronunciation),
    note: text(data.note),
    confidence,
    sameLanguage: data.sameLanguage === true || data.sameLanguage === "true",
  };
}
