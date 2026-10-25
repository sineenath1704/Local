/**
 * ============================================================
 *  HASHTAG TEXT — ทำให้แฮชแท็กเป็นรูปแบบเดียวกัน โดยไม่ทำลายภาษาไทย
 * ============================================================
 *
 * ปัญหาที่เจอ: สระและวรรณยุกต์ไทยหายไปทั้งหมด
 *   "#ที่พักริมนา" → "ทพกรมนา",  "#คาเฟ่ริมน้ำ" → "คาเฟรมนำ"
 *
 * เพราะสระ/วรรณยุกต์ไทยเป็น Unicode category Mn (nonspacing mark)
 * ซึ่งอยู่ในกลุ่ม `\p{M}` — **ไม่ใช่** `\p{L}` (อักษร) เหมือนพยัญชนะ
 * ถ้ากรองด้วย `[^\p{L}\p{N}_]` มาร์กทุกตัวจะถูกลบทิ้ง
 *
 * ตัวอย่าง (ยืนยันด้วย Unicode category จริง):
 *   ท  U+0E17  → L  (พยัญชนะ → รอด)
 *   ี  U+0E35  → M  (สระ → ถูกลบ)
 *   ่  U+0E48  → M  (วรรณยุกต์ → ถูกลบ)
 *   เ  U+0E40  → L  (สระเอก เป็นอักษร → รอด)
 *
 * ข้อควรรู้: ภาษาไทยไม่มี canonical composition/decomposition
 * ทดสอบแล้ว NFC กับ NFD ให้ผลเหมือนกันทุกคำ การเรียก NFC จึงไม่ได้
 * "ซ่อม" สระที่หายไป แต่ช่วยให้การเทียบ dedupe ของแท็กอังกฤษ/ยุโรป
 * (เช่น "Café" ที่มี/ไม่มี combining accent) เท่ากันเสมอ
 */

/** อักขระที่ยอมให้อยู่ในแฮชแท็ก: อักษร ตัวเลข `_` และมาร์ก (สระ/วรรณยุกต์) */
const HASHTAG_ALLOWED = /[^\p{L}\p{N}\p{M}_]/gu;

/** มาร์กที่หลงค้างหน้าคำโดยไม่มีตัวอักษรนำหน้า (เช่น "่ทด") */
const LEADING_MARK = /^[\p{M}]+/u;

/** ความยาวสูงสุดของแฮชแท็ก (นับเป็น code point) */
const MAX_LENGTH = 40;

/** จำนวนแฮชแท็กสูงสุดที่เสนอให้ผู้ใช้เลือก */
const MAX_SUGGESTIONS = 8;

/**
 * ทำให้แฮชแท็กเป็นรูปแบบเดียวกัน
 *
 * - ตัด `#` นำหน้า (ระบบคิดแคปชันส่งมาพร้อม `#` แล้ว แต่ช่องกรอกของ
 *   ผู้ใช้เก็บค่าไม่มี `#` → ค่าที่เก็บลงฐานข้อมูลต้องเป็นแบบเดียวกัน)
 * - ตัดช่องว่าง (แฮชแท็กห้ามมีช่องว่าง)
 * - เก็บอักษร ตัวเลข `_` และมาร์กไทยไว้ ตัดที่เหลือทิ้ง
 * - ตัดความยาวเกิน 40 ตัว (นับ code point → emoji ไม่ถูกหั่นครึ่งตัว)
 */
export function normalizeHashtag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .normalize("NFC")
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(HASHTAG_ALLOWED, "")
    .replace(LEADING_MARK, "");
  return Array.from(cleaned).slice(0, MAX_LENGTH).join("");
}

/**
 * เลือกแฮชแท็กที่จะเสนอให้ผู้ใช้
 *
 * - ตัดสิ่งที่ใช้เป็นแฮชแท็กไม่ได้ออก
 * - ไม่เสนอซ้ำกับที่ผู้ใช้พิมพ์เอง
 * - ไม่เสนอซ้ำกับตัวเอง (โมเดลอาจส่งคำเดียวกันมาหลายครั้ง)
 * - เอาไม่เกิน 8 อัน
 */
export function pickHashtagSuggestions(
  modelHashtags: unknown,
  userHashtags?: string[],
  limit: number = MAX_SUGGESTIONS
): string[] {
  if (!Array.isArray(modelHashtags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of modelHashtags) {
    const tag = normalizeHashtag(raw);
    if (!tag || seen.has(tag)) continue;
    if (userHashtags?.some((u) => normalizeHashtag(u) === tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}
