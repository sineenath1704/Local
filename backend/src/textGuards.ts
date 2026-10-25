/**
 * ============================================================
 *  TEXT GUARDS — การตรวจแบบกำหนดผลลัพธ์ (deterministic)
 * ============================================================
 *
 * ทั้งรอบ "แก้สะกด" และรอบ "เขียนคำบรรยาย" ต้องตอบคำถามเดียวกันว่า
 * "โมเดลเปลี่ยนสิ่งที่มันไม่ควรเปลี่ยนหรือเปล่า" — ถ้าคำนวณสองที่แยกกัน
 * คำตอบจะเอื้อมกันไม่ได้ ฟังก์ชันตัวเลข/ข้อความจึงอยู่ที่นี่ที่เดียว
 * แล้วทั้งสองรอบ import จากที่นี่
 *
 * หลักการ: เราเชื่อ "ตัวเลขต้องเหมือนเดิมทุกหลัก" และ "ชื่อเฉพาะแก้ได้แค่ระดับ
 * ตัวสะกด" มากกว่าเชื่อคำสั่งที่สั่งโมเดลว่าอย่าผิด — เพราะสองอย่างนี้ตรวจได้เอง
 */

/** เลขไทย (๒) → เลขอารบิก (2) — ต้องเทียบตัวเลขให้เหมือนกันทั้งสองแบบ */
const THAI_DIGITS: Record<string, string> = {
  "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
  "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
};

/** เฉพาะตัวเลข — เอาไว้เทียบว่า "ตัวเลขเปลี่ยนไปหรือเปล่า" */
export function digitsOnly(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] ?? d).replace(/\D/g, "");
}

/** ตัวเลขต้องตรงกันทุกหลัก — กันไม่ให้ราคา/จำนวนคนเพี้ยน */
export function sameDigits(a: string, b: string): boolean {
  return digitsOnly(a) === digitsOnly(b);
}

/**
 * ดึงตัวเลขทุกกลุ่มออกจากข้อความ (เลขไทยถูกแปลงเป็นเลขอารบิกก่อน)
 * ใช้ตรวจว่า "คำบรรยายมีตัวเลขที่ไม่ได้มาจากข้อเท็จจริงหรือเปล่า"
 */
export function extractNumbers(s: string): string[] {
  return (
    s
      .replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] ?? d)
      .match(/\d+(?:\.\d+)?/g) ?? []
  );
}

/** ระยะแก้ไขแบบ Levenshtein (ใช้ตัดสินว่าผิดแค่ระดับ "สะกดผิด" หรือเปลี่ยนคำ) */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * โครงสร้างข้อความให้เทียบง่าย ๆ: ตัดช่องว่าง ตัดเครื่องหมาย และพิมพ์เล็ก
 * ใช้คำถามว่า "คำนี้อยู่ใน transcript ไหม" โดยไม่ต้องเขียน regex ซ้ำ ๆ
 */
export function normalizeLoose(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

/**
 * คำนี้อยู่ใน transcript หรือเปล่า
 *
 * ใช้ยืนยันการ "แก้สะกด" ชื่อเฉพาะ: ถ้าชื่อที่โมเดลแก้มาไม่ได้ปรากฏใน
 * transcript เลย แปลว่าโมเดลไม่ได้ "แก้สะกด" แต่กำลัง "เปลี่ยนคำ" — ซึ่งต้อง
 * ไม่ผ่าน เพราะชื่อสถานที่คือคำที่จะถูกเอาไปค้น Google
 */
export function appearsIn(haystack: string | null | undefined, needle: string): boolean {
  const h = normalizeLoose(haystack ?? "");
  const n = normalizeLoose(needle);
  if (!n) return false;
  return h.includes(n);
}

/**
 * ทำให้ข้อความเป็นรูปแบบเทียบง่าย ๆ พร้อมแผนที่กลับไปหาตำแหน่งเดิม
 *
 * ต้องการแผนที่เพราะเราจะตัดวลีที่ซ้ำออกจาก "ต้นฉบับ" ไม่ใช่จากข้อความที่
 * ตัดเครื่องหมายออกแล้ว ถ้าไม่มีแผนที่จะตัดผิดตำแหน่ง
 */
export function normalizeLooseWithMap(s: string): {
  text: string;
  map: number[];
} {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const lower = s[i].toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(lower)) continue;
    // ตัวพิมพ์เล็กอาจกินความยาว (เช่น ß) ไทยไม่มี แต่แผนที่ต้องไม่เพี้ยน
    for (const ch of lower) {
      text += ch;
      map.push(i);
    }
  }
  return { text, map };
}

/** วลีที่เจอซ้ำในข้อความเดียว */
export interface RepeatedPhrase {
  /** วลีที่ซ้ำ ดึงจากต้นฉบับ อ่านได้ */
  phrase: string;
  /** ซ้ำกี่ครั้ง */
  count: number;
}

/**
 * หาวลีที่ซ้ำซ้อนในข้อความเดียว
 *
 * ปัญหาที่ผู้ใช้เจอคือเอาประโยคที่สรุปไปแล้วมาพูดซ้ำอีกรอบ โมเดลเขียน
 * เรื่องเดียวกันสองรอบด้วยถ้อยคำต่างกันเล็กน้อย การเทียบทั้งประโยคจับไม่ได้
 * (ภาษาไทยไม่มีจุดจบประโยค) แต่การเทียบหน้าต่างเลื่อนของอักษรจับได้
 * เพราะส่วนที่ซ้ำจริงคือวลียาว ๆ ไม่ใช่ทั้งประโยค
 *
 * คืนเฉพาะวลีที่ยาวพอ (window ตัวอักษร) และอยู่ห่างกันพอ (minGap)
 * เพื่อไม่ให้จับคำทั่วไปที่ซ้ำกันติด ๆ
 */
export function findRepeatedPhrases(
  text: string,
  opts?: { window?: number; minGap?: number }
): RepeatedPhrase[] {
  const w = opts?.window ?? 24;
  const minGap = opts?.minGap ?? 60;
  const { text: norm, map } = normalizeLooseWithMap(text);
  if (norm.length < w * 2) return [];

  const firstAt = new Map<string, number>();
  const hits = new Map<string, number>();
  for (let i = 0; i + w <= norm.length; i++) {
    const key = norm.slice(i, i + w);
    const prev = firstAt.get(key);
    if (prev === undefined) {
      firstAt.set(key, i);
      continue;
    }
    if (i - prev < minGap) continue;
    hits.set(key, (hits.get(key) ?? 0) + 1);
  }
  if (!hits.size) return [];

  // หน้าต่างที่ซ้ำจะทับกันเป็นก้อนเดียว วลีเดียวยาว 40 ตัวอักษรให้
  // หน้าต่าง 24 ตัวอักษรซ้ำกันหลายครั้ง เก็บไว้หนึ่งชิ้นต่อก้อน
  const kept: RepeatedPhrase[] = [];
  let lastStart = -Infinity;
  const seen = new Set<string>();
  for (const key of [...hits.keys()].sort()) {
    const at = firstAt.get(key) ?? 0;
    if (at - lastStart < w) continue;
    lastStart = at;
    const original = text.slice(map[at], map[at + w - 1] + 1).trim();
    if (!original || seen.has(original)) continue;
    seen.add(original);
    kept.push({ phrase: original, count: hits.get(key) ?? 1 });
  }
  return kept.slice(0, 5);
}
