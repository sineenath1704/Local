/**
 * ============================================================
 *  SUMMARY TEXT — ประกอบข้อความสรุปสุดท้ายเป็น 3 บล็อก
 * ============================================================
 *
 * ผู้ใช้เจอปัญหา "เอาประโยคที่สรุปไปแล้วมาพูดซ้ำอีกรอบ" เพราะข้อเท็จจริงชิ้นเดียวกัน
 * ถูกเขียนออกมาได้หลายรอบ: M3 เขียน visual_description, M3 เขียน scene_inventory,
 * M3 เขียน summary แล้วนักเล่าก็ยังเขียนซ้ำอีกชั้น
 *
 * วิธีแก้ไม่ใช่สั่งโมเดลว่าอย่าซ้ำ (สั่งไม่รับประกัน) แต่คือแยกหน้าที่:
 *   · ของที่เห็นในฉาก มีที่เดียวคือ scene_inventory
 *   · คำบรรยายเขียนครั้งเดียว โดยโมเดลเขียนแค่เนื้อ 2 ย่อหน้า
 *   · หัวข้อและบรรทัดรายการ สร้างด้วยโค้ด ไม่ใช่โมเดล
 *     (หัวข้อจึงไม่มีทางเพี้ยน และรายการตรงกับ scene_inventory เป๊ะ)
 *
 * รูปแบบข้อความสุดท้าย (คั่นบล็อกด้วยบรรทัดว่าง):
 *   ในคลิปนี้เห็น
 *   <ย่อหน้า 1>
 *
 *   สิ่งที่เห็นในคลิป (N ชิ้น)
 *   <ชิ้นที่ 1>
 *   <ชิ้นที่ 2>
 *
 *   เงื่อนไขก่อนไป
 *   <ย่อหน้า 2>
 */

import type { SceneRow } from "./summarySchema";

/** หัวข้อบล็อกแรก — สิ่งที่เห็นในคลิป */
export const HEADING_SCENE = "ในคลิปนี้เห็น";
/** หัวข้อบล็อกกลาง — รายการของที่เห็น */
export const HEADING_LIST = "สิ่งที่เห็นในคลิป";
/** หัวข้อบล็อกท้าย — เงื่อนไขก่อนไป */
export const HEADING_CONDITIONS = "เงื่อนไขก่อนไป";

/**
 * จำนวนชิ้นให้เป็นข้อความเดียวกันเสมอ
 *
 * count เป็น string เพราะคลิปพูดว่า "3-4" หรือ "1 คู่" ได้ ถ้าเป็นตัวเลขล้วน
 * จะเติมหน่วย "ชิ้น" ให้อ่านรู้เรื่อง ส่วนค่าที่ไม่ใช่ตัวเลข (เช่น "ไม่ชัด")
 * ใช้ตามเดิม
 */
export function countText(count: string | null | undefined): string | null {
  const t = (count ?? "").trim();
  if (!t) return null;
  if (t === "ไม่ชัด") return t;
  if (/^\d+(-\d+)?$/.test(t)) return `${t} ชิ้น`;
  return t;
}

/** รายการของในฉาก — บรรทัดละชิ้น พร้อม 4 อย่างที่มี */
function sceneLine(row: SceneRow): string {
  const bits = [
    row.material,
    countText(row.count),
    row.condition,
    row.position,
  ].filter(Boolean) as string[];
  return bits.length ? `${row.item} (${bits.join(" · ")})` : row.item;
}

/**
 * บล็อกรายการของที่เห็น — สร้างจาก scene_inventory ตรง ๆ
 *
 * ไม่ใช้คำบรรยายของโมเดล เพราะถ้าใช้คำบรรยาย รายละเอียดจะเพี้ยนจากของจริง
 */
export function buildSceneListBlock(rows: SceneRow[]): string {
  const lines = rows.map(sceneLine);
  return [`${HEADING_LIST} (${rows.length} ชิ้น)`, ...lines].join("\n");
}

/** ตัดหัวข้อที่อาจติดมากับย่อหน้า (กันหัวข้อซ้ำสองชั้น) */
function stripHeadings(paragraph: string): string {
  return paragraph
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return (
        !t.startsWith(HEADING_SCENE) &&
        !t.startsWith(HEADING_LIST) &&
        !t.startsWith(HEADING_CONDITIONS)
      );
    })
    .join("\n")
    .trim();
}

/**
 * ประกอบคำบรรยาย 2 ย่อหน้า + รายการของที่เห็น → ข้อความ 3 บล็อก
 *
 * รายการของที่เห็นแทรกไว้ตรงกลาง เพราะมันเป็นส่วนที่อธิบาย "สิ่งที่เห็น"
 * และย่อหน้าที่ 2 คือ "เงื่อนไขก่อนไป" ซึ่งคนละเรื่องกัน
 */
export function assembleSummaryText(narration: string, rows: SceneRow[]): string {
  const paragraphs = (narration ?? "")
    .split(/\n\s*\n/)
    .map((p) => stripHeadings(p))
    .filter(Boolean);

  const blocks: string[] = [];
  const first = paragraphs[0];
  if (first) blocks.push(`${HEADING_SCENE}\n${first}`);

  if (rows.length) blocks.push(buildSceneListBlock(rows));

  const rest = paragraphs.slice(1).join("\n\n");
  if (rest) blocks.push(`${HEADING_CONDITIONS}\n${rest}`);

  return blocks.join("\n\n");
}

// ============================================================
//  Fallback — คำบรรยายแบบกำหนดผลได้ ใช้ตอนโมเดลไม่ตอบ
// ============================================================

/** อ่านรายการของในฉากจากผลวิเคราะห์ได้ทั้งสองทาง (แยกรูปแบบเก่า/ใหม่) */
function readRows(analysis: any): SceneRow[] {
  const list = Array.isArray(analysis?.sceneInventory)
    ? analysis.sceneInventory
    : Array.isArray(analysis?.place?.scene_inventory)
    ? analysis.place.scene_inventory
    : Array.isArray(analysis?.scene_inventory)
    ? analysis.scene_inventory
    : [];
  return (list as SceneRow[]).filter((r) => r && typeof r.item === "string" && r.item.trim());
}

/** เล่าของชิ้นหนึ่งเป็นประโยคสั้น ๆ */
function describeRow(row: SceneRow): string {
  const bits: string[] = [row.item];
  if (row.material) bits.push(`ทำจาก${row.material}`);
  const c = countText(row.count);
  if (c) bits.push(c);
  if (row.position) bits.push(`อยู่${row.position}`);
  if (row.condition) bits.push(row.condition);
  return bits.join(" ");
}

/** ย่อหน้าที่ 1 — สิ่งที่เห็นในคลิป (แบบ fallback) */
function fallbackScene(rows: SceneRow[], place: any, analysis: any): string {
  const parts: string[] = [];
  const name = place?.place_name ?? null;
  const kind = Array.isArray(place?.category) ? place.category[0] : null;
  if (name) parts.push(`คลิปนี้เป็น${kind ? `${kind} ` : ""}${name}`);
  else if (kind) parts.push(`คลิปนี้เป็น${kind}`);

  const atmosphere = place?.atmosphere ?? analysis?.atmosphere ?? null;
  if (atmosphere) parts.push(String(atmosphere));

  const described = rows.map(describeRow).filter(Boolean);
  // ห้ามใช้คำว่า "ในคลิปนี้เห็น" ตรงนี้ เพราะระบบจะเติมหัวข้อนั้นให้เอง
  // ถ้าใช้ซ้ำจะกลายเป็นหัวข้อซ้ำสองชั้น (ซึ่งคือปัญหาที่ผู้ใช้เคยเจอ)
  if (described.length) parts.push(`ในฉากมี ${described.join(" ")}`);

  return parts.join(" ");
}

/** ย่อหน้าที่ 2 — เงื่อนไขก่อนไป (แบบ fallback) เรียงตามลำดับเดียวกับที่สั่งโมเดล */
function fallbackConditions(place: any): string {
  const out: string[] = [];

  // 1. ที่ตั้งและวิธีเดินทาง
  const loc = place?.location ?? {};
  const where = [
    place?.place_name,
    loc.subdistrict ? `ต.${loc.subdistrict}` : null,
    loc.district ? `อ.${loc.district}` : null,
    loc.province ? `จ.${loc.province}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (where) out.push(`อยู่${where}`);
  if (place?.directions) out.push(String(place.directions));

  // 2. ราคาและสิ่งที่รวม
  const price = place?.price_info ?? {};
  const slot = price.weekday?.amount
    ? price.weekday
    : price.weekend?.amount
    ? price.weekend
    : null;
  if (slot?.amount) {
    out.push(
      `คืนละ ${slot.amount} บาท${slot.includes ? ` รวม${slot.includes}` : ""}`
    );
  }

  // 3. ความจุและห้องพัก
  const cap = place?.capacity ?? null;
  if (cap?.rooms) out.push(`มี ${cap.rooms} ห้อง`);
  if (cap?.guests_per_room) out.push(`ห้องปกตินอนได้ ${cap.guests_per_room} คน`);
  if (cap?.max_guests) out.push(`ห้องใหญ่นอนได้ ${cap.max_guests} คน`);
  if (cap?.beds) out.push(`มี ${cap.beds} เตียง`);

  // 4. กติกาและข้อตกลง
  if (Array.isArray(place?.rules) && place.rules.length) out.push(place.rules.join(" "));

  // 5. โซนและสิ่งอำนวยความสะดวก
  if (Array.isArray(place?.areas) && place.areas.length) out.push(place.areas.join(" "));
  if (Array.isArray(place?.facilities) && place.facilities.length) {
    out.push(place.facilities.join(" "));
  }

  // 6. กิจกรรมและจุดเด่น
  const acts = [
    ...(Array.isArray(place?.activities) ? place.activities : []),
    ...(Array.isArray(place?.highlights) ? place.highlights : []),
  ];
  if (acts.length) out.push(acts.join(" "));

  // 7. เวลาเปิดและการติดต่อ
  // opening_hours มักขึ้นต้นด้วย "เปิด" อยู่แล้ว เช่น "เปิดตั้งแต่เช้าถึงเย็น"
  // ถ้าเติมคำว่า "เปิด" ซ้ำจะได้ "เปิดเปิด..." → เช็คก่อน
  if (place?.opening_hours) {
    const hours = String(place.opening_hours).trim();
    out.push(hours.startsWith("เปิด") ? hours : `เปิด${hours}`);
  }
  const contact = place?.contact ?? {};
  const contactBits = [
    contact.phone,
    contact.facebook ? `เพจ ${contact.facebook}` : null,
    contact.line ? `ไลน์ ${contact.line}` : null,
    contact.website,
  ].filter(Boolean) as string[];
  if (contactBits.length) out.push(`ติดต่อ ${contactBits.join(" ")}`);

  // 8. ปิดท้าย
  // หลีกเลี่ยงคำว่า "เงื่อนไขก่อนไป" ในประโยคนี้ เพราะระบบจะเติมหัวข้อนั้นไว้ข้างบน
  out.push(
    "ถ้าอยากรู้ราคาแน่นอนหรือข้อกำหนดก่อนไป ลองทักถามทางชุมชนได้เลยนะคะ"
  );

  return out.join(" ");
}

/**
 * คำบรรยายแบบ fallback — 2 ย่อหน้า (ยังไม่มีหัวข้อและรายการ)
 *
 * ใช้ตอนโมเดลไม่ได้ตอบหรือคำตอบไม่ผ่านเงื่อนไข ต้องมีรูปแบบเดียวกับ
 * คำบรรยายของโมเดล ไม่งั้นผู้ใช้จะเห็นคุณภาพกระตุกตอนเอไอล้ม
 */
export function buildFallbackNarration(analysis: any): string {
  const place = analysis?.place ?? analysis ?? {};
  const rows = readRows(analysis);
  const scene = fallbackScene(rows, place, analysis);
  const conditions = fallbackConditions(place);
  return [scene, conditions].filter((s) => s && s.trim()).join("\n\n");
}
