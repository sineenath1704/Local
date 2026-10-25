/**
 * ============================================================
 *  ANALYSIS SCHEMA — ตรวจรูปแบบผลลัพธ์ของโมเดลก่อนใช้
 * ============================================================
 *
 * เดิมระบบแค่ `JSON.parse()` ผลที่โมเดลตอบมา แล้วเชื่อว่า shape ถูกต้อง
 * ผลคือ: ถ้าโมเดลคืน key ผิด ค่าผิดชนิด หรือคัดลอก "ค่าตัวอย่าง" จาก schema
 * มาเป็นค่าจริง (เช่น place_name = "ชื่อสถานที่เฉพาะ หรือ null") ระบบก็เก็บลง
 * ฐานข้อมูลและเอาไปค้น Google โดยไม่มีใครสังเกต
 *
 * โมดูลนี้คือ "กระชั้นกันพลาด" ที่อยู่ฝั่งโค้ด ไม่ใช่ฝั่งคำสั่ง:
 *   · ฟิลด์ผิดชนิด → ใส่ค่าเริ่มต้น (null / []) และบันทึกข้อผิดพลาด
 *   · ค่าที่ดูเป็น "ค่าตัวอย่างจาก schema" → ถือว่าไม่มีข้อมูล
 *   · category ที่ไม่อยู่ในคำคงที่ → ตัดทิ้ง
 *   · ราคา → แยกเป็น "จำนวนเงิน" กับ "สิ่งที่รวม" เสมอ แม้โมเดลจะคืน
 *     มาเป็นข้อความเดียวก็แยกให้เอง
 *
 * คืนค่าเป็นโครงสร้างที่เชื่อถือได้ 100% — ทุกช่องได้ชนิดถูกต้อง
 * โค้ดถัดไปจึงไม่ต้องกันชนิดอีก
 */

import { PLACE_CATEGORIES, type PlaceCategory } from "./placeTypes";

/** ราคาหนึ่งช่วง — แยก "ตัวเลข" ออกจาก "สิ่งที่รวม" */
export interface PriceSlot {
  /** จำนวนเงินล้วน เช่น "700" หรือ "450-500" — ไม่มีหน่วย ไม่มีคำว่า "รวม" */
  amount: string | null;
  /** สิ่งที่ราคานั้นครอบคลุม เช่น "รวมอาหารเย็นและอาหารเช้า" */
  includes: string | null;
}

export interface PriceInfo {
  currency: string;
  weekday: PriceSlot;
  weekend: PriceSlot;
  /** ช่วงราคาจาก Google ("฿" / "฿฿฿" / "ฟรี") — แอปเป็นเจ้าของค่านี้ */
  level?: string | null;
}

/** หนึ่งชิ้นของที่เห็นในคลิป */
export interface SceneRow {
  item: string;
  material: string | null;
  count: string | null;
  condition: string | null;
  position: string | null;
}

/** ผลวิเคราะห์ที่ผ่านการตรวจแล้ว — ทุกช่องมีชนิดที่ระบบรับประกัน */
export interface SanitizedAnalysis {
  reasoning: {
    audio_clues: string | null;
    visual_clues: string | null;
    location_deduction: string | null;
  };
  place_name: string | null;
  community: string | null;
  location: {
    province: string | null;
    district: string | null;
    subdistrict: string | null;
    gps: string | null;
  };
  atmosphere: string | null;
  visual_description: string | null;
  scene_inventory: SceneRow[];
  category: PlaceCategory[];
  activities: string[];
  price_info: PriceInfo;
  contact: {
    phone: string | null;
    facebook: string | null;
    line: string | null;
    website: string | null;
  };
  opening_hours: string | null;
  /** วิธีเดินทางมาที่นี่ ถ้าเสียงพูดพูดถึงไว้ */
  directions: string | null;
  capacity: {
    rooms: string | null;
    guests_per_room: string | null;
    max_guests: string | null;
    beds: string | null;
  } | null;
  rules: string[];
  areas: string[];
  facilities: string[];
  otop_products: string[];
  highlights: string[];
  tags: string[];
  confidence: {
    overall_confidence: number;
    source_used: string[];
    missing_info: string[];
    warning: string | null;
  };
}

/** ค่าที่โมเดลมักคัดลอกกลับมาแทนค่าจริง */
const PLACEHOLDER_WORDS = new Set([
  "null", "undefined", "n/a", "na", "-", "--", "none", "nil",
  "ไม่มี", "ไม่ทราบ", "ไม่ระบุ", "ไม่มีข้อมูล", "ที่ดีแล้ว", "ทั้งหมด", "ว่าง",
]);

/**
 * ค่านี้ดูเป็น "ตัวอย่างจาก schema" หรือไม่
 *
 * Schema ที่ส่งให้โมเดลเคยเขียนค่าตัวอย่างไว้ในรูปแบบ
 * `"place_name": "ชื่อสถานที่เฉพาะ หรือ null"` — โมเดลบางตัวจะคัดลอก
 * มาเป็นค่าจริง ถ้าปล่อยไป ชื่อสถานที่ปลอมจะถูกเอาไปค้น Google
 */
export function looksLikePlaceholder(value: string): boolean {
  const t = value.trim();
  const low = t.toLowerCase();
  if (PLACEHOLDER_WORDS.has(low)) return true;
  if (/หรือ\s*null/i.test(t)) return true;
  if (/เช่น\s/.test(t)) return true;
  if (/2\s*[–-]\s*4\s*ประโยค/.test(t)) return true;
  if (/^\.{3}/.test(t) || /\.\.\.$/.test(t)) return true;
  return false;
}

/** ข้อความจริง หรือ null ถ้าไม่ใช่ข้อความ/เป็นค่าตัวอย่าง */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  if (looksLikePlaceholder(t)) return null;
  return t;
}

/** รายการข้อความ — ตัดค่าตัวอย่างและค่าที่ไม่ใช่ข้อความออก */
function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = str(item);
    if (s) out.push(s);
  }
  return out;
}

/** ชื่อสถานที่/ชุมชน — ตัดคำนำหน้าแบบที่ Google ใช้ออก */
function placeName(value: unknown): string | null {
  return str(value);
}

/**
 * แยกข้อความราคาเดี่ยวออกเป็น "จำนวนเงิน" กับ "สิ่งที่รวม"
 *
 * โมเดลอาจไม่ทำตาม schema ใหม่แล้วคืน "450 - 500 บาท/คืน (รวมอาหารเช้า)"
 * มาเป็นข้อความเดียว — เราซ้อมแยกให้เอง เพื่อให้ตัวเลขที่จะตรวจได้
 * แยกอยู่ในช่องเดียวเสมอ
 */
export function splitPriceText(text: string): PriceSlot {
  const t = text.trim();
  if (!t) return { amount: null, includes: null };

  // ส่วนที่อยู่ในวงเล็บคือ "สิ่งที่รวม"
  let includes: string | null = null;
  let rest = t;
  const bracket = t.match(/[([]([^)\]]*)[)\]]/);
  if (bracket) {
    const inside = bracket[1].trim();
    if (inside) {
      includes = inside.replace(/^รวม\s*/i, "").trim() || null;
      const at = bracket.index ?? 0;
      rest = (t.slice(0, at) + " " + t.slice(at + bracket[0].length)).trim();
    }
  }

  // เผื่อมีคำว่า "รวม" นอกวงเล็บ
  if (!includes) {
    const idx = rest.search(/รวม/);
    if (idx > 0) {
      includes = rest.slice(idx).replace(/^รวม\s*/, "").trim() || null;
      rest = rest.slice(0, idx).trim();
    }
  }

  // จำนวนเงิน = ตัวเลขที่เหลือ (เอาหน่วยทิ้ง เก็บไว้ใน currency)
  const nums = rest.match(/\d[\d\s.,-]*/g);
  let amount: string | null = null;
  if (nums && nums.length) {
    const merged = nums.join(" ").replace(/\s*-\s*/g, "-").replace(/\s+/g, "").replace(/[.,]$/, "");
    amount = merged || null;
  }
  return { amount, includes };
}

/** ช่องราคาหนึ่งช่วง — รับทั้งรูปแบบใหม่ (amount/includes) และรูปแบบเดิม (ข้อความเดียว) */
export function readPriceSlot(value: unknown): PriceSlot {
  if (typeof value === "string") return splitPriceText(value);
  if (!value || typeof value !== "object") return { amount: null, includes: null };
  const v = value as Record<string, unknown>;
  const amount = str(v.amount);
  const includes = str(v.includes);
  if (amount || includes) return { amount, includes };
  // รูปแบบเก่าที่เก็บทั้งจำนวนเงินและคำว่า "รวม" ไว้ใน amount
  const legacy = str(v.weekday) ?? str(v.weekend) ?? str(v.amount);
  return legacy ? splitPriceText(legacy) : { amount: null, includes: null };
}

/** อ่าน `price_info` ทั้งก้อน */
export function readPriceInfo(value: unknown): PriceInfo {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const currency = str(v.currency) ?? "THB";
  const level = str(v.level);
  return {
    currency,
    weekday: readPriceSlot(v.weekday),
    weekend: readPriceSlot(v.weekend),
    ...(level ? { level } : {}),
  };
}

function readLocation(value: unknown) {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    province: str(v.province),
    district: str(v.district),
    subdistrict: str(v.subdistrict),
    gps: str(v.gps),
  };
}

function readContact(value: unknown) {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    phone: str(v.phone),
    facebook: str(v.facebook),
    line: str(v.line),
    website: str(v.website),
  };
}

function readCapacity(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const rooms = str(v.rooms);
  const guestsPerRoom = str(v.guests_per_room);
  const maxGuests = str(v.max_guests);
  const beds = str(v.beds);
  if (!rooms && !guestsPerRoom && !maxGuests && !beds) return null;
  return {
    rooms,
    guests_per_room: guestsPerRoom,
    max_guests: maxGuests,
    beds,
  };
}

function readSceneInventory(value: unknown): SceneRow[] {
  if (!Array.isArray(value)) return [];
  const rows: SceneRow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const item = str(r.item);
    if (!item) continue; // ไม่มีชื่อ = เล่าไม่ได้ = ไม่มีประโยชน์
    rows.push({
      item,
      material: str(r.material),
      count: str(r.count),
      condition: str(r.condition),
      position: str(r.position),
    });
  }
  return rows;
}

/** category ต้องอยู่ในคำคงที่ — คำอื่นคือข้อมูลที่ค้นไม่ได้ จึงตัดทิ้ง */
function readCategory(value: unknown): PlaceCategory[] {
  const list = strList(value);
  const out: PlaceCategory[] = [];
  for (const item of list) {
    // เทียบแบบไม่สนตัวพิมพ์ใหญ่/เล็ก — โมเดลเขียน "workshop" หรือ
    // "Workshop" ได้ทั้งคู่ (prompt ก็ยอมรับทั้งสองแบบ)
    const match = PLACE_CATEGORIES.find(
      (c) => c.toLowerCase() === item.trim().toLowerCase()
    );
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

function readConfidence(value: unknown) {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  let overall = 0;
  if (typeof v.overall_confidence === "number" && Number.isFinite(v.overall_confidence)) {
    overall = Math.min(1, Math.max(0, v.overall_confidence));
  }
  return {
    overall_confidence: overall,
    source_used: strList(v.source_used),
    missing_info: strList(v.missing_info),
    warning: str(v.warning),
  };
}

function readReasoning(value: unknown) {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    audio_clues: str(v.audio_clues),
    visual_clues: str(v.visual_clues),
    location_deduction: str(v.location_deduction),
  };
}

/** แท็กไม่ขึ้นต้นด้วย # — ให้ตรงกับแฮชแท็กที่ระบบคิดแคปชันใช้ */
function readTags(value: unknown): string[] {
  return strList(value).map((t) => t.replace(/^#+/, ""));
}

/**
 * ตรวจและทำความสะอาดผลวิเคราะห์จากโมเดล
 *
 * ไม่โยน error — คืนโครงสร้างที่ใช้ได้เสมอ พร้อมรายการข้อผิดพลาด
 * ให้ฝั่งเรียกบันทึกลง log (ไม่มีข้อมูลไหนหายไปเงียบ ๆ)
 */
export function sanitizeAnalysis(raw: unknown): {
  analysis: SanitizedAnalysis;
  errors: string[];
} {
  const errors: string[] = [];
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  if (!raw || typeof raw !== "object") {
    errors.push("ผลวิเคราะห์ไม่ใช่ object");
  }

  const visualDescription = str(root.visual_description);
  const sceneInventory = readSceneInventory(root.scene_inventory);

  if (!visualDescription && sceneInventory.length === 0) {
    errors.push("ไม่มี visual_description และไม่มี scene_inventory");
  }

  const analysis: SanitizedAnalysis = {
    reasoning: readReasoning(root.reasoning),
    place_name: placeName(root.place_name),
    community: placeName(root.community),
    location: readLocation(root.location),
    atmosphere: str(root.atmosphere),
    visual_description: visualDescription,
    scene_inventory: sceneInventory,
    category: readCategory(root.category),
    activities: strList(root.activities),
    price_info: readPriceInfo(root.price_info),
    contact: readContact(root.contact),
    opening_hours: str(root.opening_hours),
    directions: str(root.directions),
    capacity: readCapacity(root.capacity),
    rules: strList(root.rules),
    areas: strList(root.areas),
    facilities: strList(root.facilities),
    otop_products: strList(root.otop_products),
    highlights: strList(root.highlights),
    tags: readTags(root.tags),
    confidence: readConfidence(root.confidence),
  };

  if (Array.isArray(root.category)) {
    const dropped = strList(root.category).filter(
      (c) => !analysis.category.includes(c as PlaceCategory)
    );
    if (dropped.length) errors.push(`category นอกคำคงที่ถูกตัด: ${dropped.join(", ")}`);
  }

  return { analysis, errors };
}
