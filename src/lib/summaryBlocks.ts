/**
 * ============================================================
 *  SUMMARY BLOCKS — แยกข้อความสรุป 3 บล็อกของฝั่งแอป
 * ============================================================
 *
 * เซิร์ฟเวอร์ประกอบสรุปให้เป็น 3 บล็อก (backend/src/summaryText.ts):
 *   ในคลิปนี้เห็น        → ย่อหน้าเล่าฉาก
 *   สิ่งที่เห็นในคลิป (N ชิ้น) → รายการของที่เห็น ทีละบรรทัด
 *   เงื่อนไขก่อนไป      → ย่อหน้าเงื่อนไขก่อนตัดสินใจไป
 *
 * หัวข้อทั้งสามถูกสร้างด้วยโค้ด ไม่ใช่โมเดล → จึงไม่เพี้ยน และแอปแค่
 * ต้องรู้ว่าจะแบ่งย่อหน้ายังไง
 *
 * สรุปที่บันทึกไว้ก่อนรูปแบบนี้ไม่มีหัวข้อ → parseSummaryBlocks คืน null
 * ให้ผู้เรียกไปเรนเดอร์แบบเดิม (ข้อความก้อนเดียว) โพสต์เก่าจึงไม่พัง
 */

/** หัวข้อบล็อกแรก — สิ่งที่เห็นในคลิป */
export const HEADING_SCENE = "ในคลิปนี้เห็น";
/** หัวข้อบล็อกกลาง — รายการของที่เห็น */
export const HEADING_LIST = "สิ่งที่เห็นในคลิป";
/** หัวข้อบล็อกท้าย — เงื่อนไขก่อนไป */
export const HEADING_CONDITIONS = "เงื่อนไขก่อนไป";

export type SummaryBlock =
  | { kind: "scene"; title: string; body: string }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "conditions"; title: string; body: string };

/**
 * แยกข้อความสรุปรูปแบบใหม่ออกเป็นบล็อก ๆ
 *
 * คืน null ถ้าไม่ใช่รูปแบบใหม่ (สรุปเก่า) — ผู้เรียกต้องมีทางสำรอง
 */
export function parseSummaryBlocks(text: string | undefined): SummaryBlock[] | null {
  const lines = (text ?? "").split(/\r?\n/);
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = [HEADING_SCENE, HEADING_LIST, HEADING_CONDITIONS].find((h) =>
      trimmed.startsWith(h)
    );
    if (heading) {
      if (current) sections.push(current);
      current = { title: trimmed, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else if (trimmed) {
      // มีเนื้อหาก่อนหัวข้อแรก → ไม่ใช่รูปแบบใหม่
      return null;
    }
  }
  if (current) sections.push(current);

  // ต้องมีบล็อกรายการของที่เห็น ถึงจะยืนยันได้ว่าเป็นสรุปรูปแบบใหม่
  if (sections.length < 2) return null;
  if (!sections.some((s) => s.title.startsWith(HEADING_LIST))) return null;

  return sections.map((s) => {
    if (s.title.startsWith(HEADING_LIST)) {
      return {
        kind: "list" as const,
        title: s.title,
        items: s.lines.map((l) => l.trim()).filter(Boolean),
      };
    }
    if (s.title.startsWith(HEADING_CONDITIONS)) {
      return {
        kind: "conditions" as const,
        title: s.title,
        body: s.lines.join("\n").trim(),
      };
    }
    return { kind: "scene" as const, title: s.title, body: s.lines.join("\n").trim() };
  });
}

/**
 * แยกบรรทัดรายการ "เตียงไม้ (ไม้เนื้อแข็ง · 1 ชิ้น · เก่า)" เป็นชื่อ + รายละเอียด
 *
 * ถ้าบรรทัดไม่มีวงเล็บ → ถือว่าทั้งบรรทัดคือชื่อ
 */
export function splitSceneLine(line: string): { name: string; detail: string } {
  const at = line.indexOf(" (");
  if (at === -1 || !line.endsWith(")")) return { name: line, detail: "" };
  return {
    name: line.slice(0, at),
    detail: line.slice(at + 2, -1).split(" · ").filter(Boolean).join(" · "),
  };
}
