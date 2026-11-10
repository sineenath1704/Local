import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import { aiFetch } from "./aiHttp";
import type { TranslateResult } from "../data/translateData";

/**
 * ยิงไปหา "เอไAI ช่วยแปลภาษา" ฝั่ง backend
 * -------------------------------------------------------------
 * · /ai-translate  = แปลข้อความ (เป็นของ AI ฝั่งบ้าน)
 * · /ai-transcribe = ถอดเสียงที่ผู้ใช้พูด (Gemini) → แล้วค่อยแปลต่อ
 *
 * ทั้งสองเส้นทางไม่ต้องล็อกอิน (เหมือน /ai-caption) — ใช้ตอนเที่ยวได้เลย
 */

/** แปลข้อความไม่นานเท่าไร — โมเดลต้องคิดนานหน่อย */
const TRANSLATE_TIMEOUT_MS = 30000;

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

/** id ของ "ไทยภาษากลาง" — ใช้เป็นทางกลางของการแปล */
const CENTRAL_THAI_ID = "th-central";

/**
 * id ของภาษาไทยถิ่น 3 ภาค (อีสาน · ล้านนา · ปักษ์ใต้)
 * ถ้าผู้ใช้เลือกเอง → เชื่อว่าเป็นภาษาถิ่น → ต้องแปลให้ได้ ไม่ใช่ตอบว่า “ภาษาเดียวกัน”
 * (ดูรายการใน translateData.ts — DIALECT_LANGUAGES)
 */
const THAI_DIALECT_IDS = ["th-isarn", "th-lanna", "th-paknam"];

/**
 * ป้ายที่ส่งไปให้โมเดลตอน "แปลเป็นไทยภาษากลาง"
 * -------------------------------------------------------------
 * ป้ายภาษาคือช่องที่ backend เอาไปวางใน prompt จริง ๆ (ดู buildTranslatePrompt)
 * การบอกให้ชัดว่า "ไทยภาษากลาง ≠ ภาษาถิ่น" กันไม่ให้โมเดลตอบว่า
 * "เป็นภาษาเดียวกันอยู่แล้ว" แล้วปล่อยคำภาษาถิ่นไว้โดยไม่แปล
 */
const CENTRAL_TH_TARGET_LABEL =
  "ภาษาไทยภาษากลาง (ภาษามาตรฐาน ไม่ใช่ภาษาถิ่น) — ถ้าข้อความต้นทางเป็นคำพูดท้องถิ่น ให้แปลเป็นภาษาไทยภาษากลางเสมอ ห้ามตอบว่าเป็นภาษาเดียวกัน";

/** ป้ายฝั่งต้นทางตอนให้โมเดลตรวจเอง — บอกให้รู้ว่าคำภาษาถิ่นนับเป็นภาษาต่างหนึ่ง */
const AUTO_SOURCE_LABEL =
  "อัตโนมัติ — ตรวจหาภาษาต้นทางเอง (ถ้าเป็นคำพูดท้องถิ่นของไทย ให้ถือว่าเป็นภาษาถิ่นนั้น)";

/** ป้ายฝั่งต้นทางตอนแปลต่อจากไทยกลางไปภาษาปลายทาง */
const CENTRAL_TH_SOURCE_LABEL = "ภาษาไทย (ภาษากลาง)";

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
 * แปลแบบ "เข้าใจกลางก่อน แล้วค่อยแปลต่อ"
 * -------------------------------------------------------------
 * ที่ผู้ใช้ต้องการ: คำภาษาถิ่นต้องถูก “แปล” เสมอ ไม่ใช่ถูกตอบว่า
 * "เป็นภาษาไทยอยู่แล้ว" (เช่น “อะหยัง” → “อย่างไรบ้าง”)
 *
 * · ขั้นที่ 1: แปลทุกอย่างให้เป็น “ไทยภาษากลาง” ก่อนเสมอ
 *   (ภาษาถิ่น → ไทยกลาง · ภาษาต่างประเทศ → ไทยกลาง)
 *   ถ้าโมเดลตอบว่า “เป็นภาษาเดียวกันอยู่แล้ว” (เกิดกับคำถิ่น เช่น “อะหยัง”)
 *   → ขอแปลอีกครั้งแบบเจาะจงว่าให้แปลเป็นไทยกลางเสมอ
 * · ขั้นที่ 2: ถ้าปลายทางไม่ใช่ไทยกลาง → เอา “ไทยกลาง” ที่ได้ไปแปลต่อ
 *   (ไทยกลาง → ภาษาท้องถิ่นอื่น · ไทยกลาง → ภาษาต่างประเทศ)
 *   ถ้าขั้นที่ 1 ไม่ได้แปลเลย → แปลตรงจากภาษาต้นทางเดิมไปปลายทางแทน
 * · ปลายทาง = ไทยกลาง → จบที่ขั้นที่ 1
 */
export async function translateTextFlow(
  input: TranslateRequest
): Promise<TranslateResult> {
  const sourceId = input.sourceId;
  const sourceLabel =
    sourceId === "auto" ? AUTO_SOURCE_LABEL : input.sourceLabel;

  // ── ขั้นที่ 1: → ไทยภาษากลาง ───────────────────────────────────────
  let central = await translateText({
    text: input.text,
    sourceId,
    sourceLabel,
    targetId: CENTRAL_THAI_ID,
    targetLabel: CENTRAL_TH_TARGET_LABEL,
  });

  // โมเดลตอบว่า “เป็นภาษาเดียวกันอยู่แล้ว” ทั้งที่เป็นคำภาษาถิ่น
  // → ขอให้ลองอีกครั้งแบบเจาะจง
  //   · ผู้ใช้เลือก “ภาษาไทยถิ่น” มาเอง → เชื่อผู้ใช้ ต้องแปลให้ได้
  //   · ต้นทาง “อัตโนมัติ” + ข้อความสั้น → มักเป็นคำถิ่น (เช่น “อะหยัง”)
  const isDialectSource = THAI_DIALECT_IDS.includes(sourceId);
  const maybeDialect =
    isDialectSource ||
    (sourceId === "auto" && input.text.trim().length <= 40);
  if (central.sameLanguage && maybeDialect) {
    central = await translateText({
      text: input.text,
      sourceId,
      sourceLabel: `${sourceLabel} — ข้อความนี้อาจเป็นคำภาษาถิ่น ให้แปลเป็นภาษาไทยภาษากลางเสมอ`,
      targetId: CENTRAL_THAI_ID,
      targetLabel: CENTRAL_TH_TARGET_LABEL,
    });
  }

  // โมเดลยังบอกว่า “ภาษาเดียวกัน” → ไม่มีความหมายกลางให้ใช้ต่อ
  const centralMeaning = central.sameLanguage
    ? null
    : central.translation ?? input.text;

  // ปลายทาง = ไทยกลาง → ใช้ผลขั้นที่ 1 ได้เลย
  if (input.targetId === CENTRAL_THAI_ID) {
    return {
      ...central,
      sourceLabel: input.sourceLabel,
      targetLabel: input.targetLabel,
      centralMeaning: null,
    };
  }

  // ── ขั้นที่ 2: → ภาษาปลายทาง ───────────────────────────────────────
  // · ขั้นที่ 1 แปลได้ → เอา “ไทยกลาง” ไปแปลต่อ
  // · ขั้นที่ 1 ไม่ได้แปล → แปลตรงจากภาษาต้นทางเดิมไปปลายทางแทน
  const hop2 = centralMeaning
    ? {
        text: centralMeaning,
        sourceId: CENTRAL_THAI_ID,
        sourceLabel: CENTRAL_TH_SOURCE_LABEL,
      }
    : { text: input.text, sourceId, sourceLabel };

  try {
    const final = await translateText({
      text: hop2.text,
      sourceId: hop2.sourceId,
      sourceLabel: hop2.sourceLabel,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
    });

    const notes = [central.note, final.note].filter(
      (n): n is string => !!n && n.trim() !== ""
    );
    const uniqueNotes = notes.filter((n, i) => notes.indexOf(n) === i);

    return {
      ...final,
      original: input.text,
      sourceLabel: input.sourceLabel,
      detectedSource: central.detectedSource ?? final.detectedSource,
      pronunciation: final.pronunciation ?? central.pronunciation,
      note: uniqueNotes.length ? uniqueNotes.join(" · ") : null,
      centralMeaning,
    };
  } catch {
    // แปลต่อไม่สำเร็จ — ยังดีกว่าไม่มีอะไรเลย → เอาความหมายภาษาไทยมาให้ดู
    return {
      ...central,
      original: input.text,
      centralMeaning,
      note: `แปลต่อเป็น${input.targetLabel} ไม่สำเร็จ — ด้านบนคือความหมายภาษาไทย`,
    };
  }
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
    sourceLabel: text(data.sourceLabel) ?? input.sourceLabel,
    targetLabel: text(data.targetLabel) ?? input.targetLabel,
    // ต้นฉบับต้องเป็นของผู้ใช้เสมอ (ไม่ใช่ของที่โมเดลยกมา)
    original: original ?? input.text,
    translation,
    pronunciation: text(data.pronunciation),
    note: text(data.note),
    confidence,
    sameLanguage: data.sameLanguage === true || data.sameLanguage === "true",
  };
}
