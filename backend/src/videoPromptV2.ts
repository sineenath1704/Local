/**
 * ============================================================
 *  VIDEO CONTENT ANALYZER V2 — แกนกลาง (ชนิดข้อมูล + ตรวจ + ประกอบการ์ด)
 * ============================================================
 * ไฟล์นี้เก็บ "โค้ด" ของสายสรุปวิดีโอรุ่น V2 (แผน: PLAN_VIDEO_ANALYZER_V2.md)
 *
 * ⚠️ PROMPT อยู่ที่ `prompt.ts` แล้ว — แก้ prompt ของสายสรุปคลิปให้แก้ที่ไฟล์นั้นที่เดียว
 *   SYSTEM_PROMPT_CARD / EXTRACTION_SCHEMA / buildExtractionPrompt()
 *
 * สิ่งที่อยู่ในไฟล์นี้
 *   1. ชนิดข้อมูล V2 (V2Core / V2Stay / V2Food / ...)
 *   2. validateExtraction()    — ตรวจความถูกต้องด้วยโค้ด (ไม่ใช่ AI)
 *   3. buildPostCard()         — ประกอบการ์ดหน้าโพสต์จากข้อมูลที่ผ่านการตรวจ
 *   4. renderPostText()        — ประกอบการ์ดเป็น "ข้อความล้วน" (ใช้เป็น `text`)
 *
 * หลักการ
 *   · โมเดล "สกัดเป็นฟิลด์" เท่านั้น — การเรียงการ์ด/เติมบรรทัดทำโดยโค้ด
 *   · โมดูลที่ไม่เกี่ยวข้องกับคลิป = null ทั้งก้อน (โค้ดจึงตัดหัวข้อว่างทิ้งได้)
 *   · ค่าที่เป็นตัวเลขต้องมีที่มาจากเสียงพูด — ถ้าไม่เจอใน transcript
 *     เรา "เตือน" ไม่ใช่ "ลบ" (ผู้พูดอาจพูดเป็นตัวอักษร)
 */

import type { MapInfo, NearbyAttraction, OpeningHours } from "./googleMaps";

// ─────────────────────────────────────────────
//  1) ชนิดข้อมูล V2
// ─────────────────────────────────────────────

/** ราคา — weekday/weekend เก็บเป็น "ตัวเลขล้วน" เช่น "450" หรือ "450-500" */
export interface V2Price {
  weekday: string | null;
  weekend: string | null;
  /** "ต่อคน" | "ต่อคืน" | "ต่อกลุ่ม" | null */
  unit: string | null;
  currency: string;
  /** สิ่งที่รวมในราคา เช่น "รวมอาหารเย็นและอาหารเช้า" */
  inclusions: string[];
}

export interface V2Core {
  place_name: string | null;
  community: string | null;
  location: { province: string | null; district: string | null; subdistrict: string | null };
  category: string[];
  /**
   * คำบรรยายรวม 2-4 ประโยค: ที่นี่เป็นแบบไหน + ไปแล้วจะเจออะไร + ทำไมคนควรไป
   * → ส่วนแรกของการ์ด (ใต้ชื่อสถานที่)
   */
  overview: string | null;
  price: V2Price;
  opening_hours: string | null;
  contact: { phone: string | null; facebook: string | null; line: string | null };
  restrictions: string[];
  activities: string[];
  views: string[];
  highlights: string[];
  tags: string[];
}

export interface V2RoomType {
  name: string | null;
  /** จำนวนห้องของประเภทนี้ */
  count: string | null;
  /** จำนวนคนที่นอนได้ เช่น "1-3" */
  capacity: string | null;
  /** เตียงอะไรกี่เตียง เช่น "เตียงเดี่ยว 1" */
  beds: string | null;
  /** ห้องน้ำในห้อง / ห้องน้ำรวม */
  bathroom: string | null;
}

export interface V2Stay {
  room_types: V2RoomType[];
  /**
   * ที่นอน 1 ประโยค — ต้องมีวัสดุ/ลักษณะที่เห็นจริง
   * (โครงเตียง → ฟูก/เสื่อ → ผ้าปู → ผ้าห่ม → หมอน)
   */
  bedding: string | null;
  mosquito_net: string | null;
  /** ของ/อุปกรณ์ที่มีอยู่ในห้อง (สิ่งที่เห็นได้จริง) */
  facilities: string[];
  /** บริการที่มีให้ลูกค้า (น้ำร้อน อาหาร ชา/กาแฟ ผ้าเช็ดตัว ที่ซักผ้า …) */
  services: string[];
}

export interface V2Food {
  menu_highlights: string[];
  price_from: string | null;
  seating: string | null;
  payment: string[];
}

export interface V2Activity {
  what_you_do: string | null;
  duration: string | null;
  min_max_people: string | null;
  take_home: string | null;
  need_booking: string | null;
}

export interface V2Otop {
  products: { name: string | null; price: string | null; note: string | null }[];
  can_buy_on_site: string | null;
  can_try_making: string | null;
}

export interface V2Access {
  road_condition: string | null;
  vehicle_advice: string | null;
  walk_required: string | null;
  parking: string | null;
}

export interface V2Confidence {
  /** 0–1 ความมั่นใจรวม */
  overall: number;
  /** ความมั่นใจแยกตามโมดูล (0–1) */
  per_module: { stay: number; food: number; activity: number; otop: number };
  /** ข้อขัดแย้งระหว่างเสียงกับภาพ */
  conflicts: string[];
  /** ข้อมูลที่ยังขาด */
  missing_info: string[];
  /** คำเตือนรวม (โค้ดรวมให้ ไม่ใช่โมเดล) */
  warning?: string | null;
  /** แหล่งที่มาของข้อมูล: audio_transcript | on_screen_text | visual | caption */
  source_used: string[];
}

/** JSON ที่โมเดลตอบ (หลังผ่าน validateExtraction แล้ว) */
export interface V2Extraction {
  core: V2Core;
  stay: V2Stay | null;
  food: V2Food | null;
  activity: V2Activity | null;
  otop: V2Otop | null;
  access: V2Access | null;
  confidence: V2Confidence;
}

// ─────────────────────────────────────────────
//  2) การ์ดหน้าโพสต์
// ─────────────────────────────────────────────

/**
 * บรรทัดในการ์ด
 * -------------------------------------------------------------
 * `kind` เก็บไว้ให้แอปเลือกสีได้ (ok = ยืนยันได้ · warn = ข้อจำกัด/กติกา ·
 * info = ข้อมูลจากแผนที่) — รูปแบบใหม่ไม่ใช้ไอคอนหน้าบรรทัดแล้ว
 */
export interface PostCardLine {
  kind: "ok" | "warn" | "info";
  text: string;
  /** ลิงก์เปิดแผนที่ (มีเฉพาะบรรทัดที่พาไปยังสถานที่จริง) — แอปทำให้กดได้ */
  url?: string | null;
}

/** บล็อกหนึ่งบล็อกของการ์ด */
export interface PostCardBlock {
  /** หัวข้อของบล็อก (เช่น "ราคา" "ที่พัก" "สถานที่ที่อยู่ใกล้เคียง") — ไม่มี = บรรทัดต่อเนื่อง */
  title?: string | null;
  /**
   * bullets = รายการข้อความ (แอปขึ้นต้นด้วย "• ")
   * facts   = บรรทัดข้อเท็จจริงสรุป ไม่มี bullet
   *           (เช่น "ราคา 700 บาท/คน · เปิด 08:00-18:00")
   */
  style: "bullets" | "facts";
  lines: PostCardLine[];
}

/**
 * หัวข้อหนึ่งหัวข้อของการ์ดรูปแบบเก่า (มีไอคอน ✔/⚠/ℹ)
 * — การ์ดที่สรุปไว้ก่อนเปลี่ยนรูปแบบยังมีฟิลด์นี้อยู่
 */
export interface PostCardSection {
  title: string;
  highlight?: string | null;
  lines: PostCardLine[];
}

/** การ์ดหน้าโพสต์ — backend ประกอบจากข้อมูลจริง แอปเรนเดอร์เป็นการ์ด */
export interface PostCard {
  /** ชื่อสถานที่ + ที่อยู่ที่รวบรวมแล้ว + คำบรรยายรวม */
  place?: {
    name?: string | null;
    address?: string | null;
    /** รูปแบบเก่าเท่านั้น — ประโยคสั้นว่าที่นี่คืออะไร (ตอนนี้รวมไปใน description แล้ว) */
    tagline?: string | null;
    /** คำบรรยายรวม (core.overview) — ที่นี่เป็นแบบไหน + ไปแล้วจะเจออะไร + ทำไมควรไป */
    description?: string | null;
  } | null;
  /** บล็อกของการ์ด (รูปแบบใหม่) — เรียงตามลำดับที่จะแสดง */
  blocks: PostCardBlock[];
  /** การ์ดรูปแบบเก่า — มีเฉพาะการ์ดที่สรุปไว้ก่อนเปลี่ยนรูปแบบ */
  sections?: PostCardSection[] | null;
  /** ติดต่อ/จอง */
  contact?: {
    phone?: string | null;
    facebook?: string | null;
    line?: string | null;
    /** เวลาเปิด — รูปแบบเก่าเท่านั้น (รูปแบบใหม่อยู่ในบรรทัดข้อเท็จจริง) */
    hours?: string | null;
  } | null;
  /** เครดิตแผนที่ — ต้องแสดงเมื่อมีข้อมูลจาก Google Maps Platform */
  mapCredit?: string | null;
}

// ─────────────────────────────────────────────
//  3) SYSTEM PROMPT V2  → ย้ายไปที่ prompt.ts แล้ว (SYSTEM_PROMPT_CARD)
// ─────────────────────────────────────────────
//  4) SCHEMA ที่ขอจากโมเดล  → ย้ายไปที่ prompt.ts แล้ว (EXTRACTION_SCHEMA)
// ─────────────────────────────────────────────
//  5) user prompt  → ย้ายไปที่ prompt.ts แล้ว (buildExtractionPrompt)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  6) validateExtraction — ตรวจด้วยโค้ด
// ─────────────────────────────────────────────

/** ผลลัพธ์ของการตรวจสอบ */
export interface V2Validation {
  /** ข้อมูลที่ผ่านการทำความสะอาดแล้ว (ค่าที่ผิดถูกตัด/เติมตามกฎ) */
  data: V2Extraction;
  /** คำเตือนรวม (ไปเขียนใน confidence.warning) */
  warnings: string[];
  /** ข้อขัดแย้ง (ไปเป็นบรรทัด ⚠ ในการ์ด) */
  conflicts: string[];
  /** ข้อมูลที่ขาด (ไปเขียนใน confidence.missing_info) */
  missing: string[];
}

const NUMERIC = /^\d+(?:\s*-\s*\d+)?(?:\.\d+)?$/;

/** ตัวเลขทุกตัวในข้อความ (ใช้ตรวจว่าตัวเลขที่โมเดลให้มามีที่มาจริง) */
function digitsIn(text: string): string[] {
  return (text.match(/\d+/g) || []).map((d) => d.replace(/^0+(?=\d)/, ""));
}

/** ตัวเลขที่ "ต้องมีที่มาจากเสียงพูด" ยังไม่เจอใน transcript */
function numbersMissingInTranscript(value: string, transcript: string): string[] {
  const wanted = digitsIn(value);
  if (wanted.length === 0) return [];
  const have = new Set(digitsIn(transcript));
  return wanted.filter((d) => !have.has(d));
}

/** ตัดค่าที่ว่างเปล่าออกจากออบเจกต์ (ใช้ตรวจว่าโมดูลว่างจริงหรือไม่) */
function isEmptyObject(v: any): boolean {
  if (!v || typeof v !== "object") return true;
  return Object.values(v).every(
    (val) =>
      val === null ||
      val === undefined ||
      (typeof val === "string" && val.trim() === "") ||
      (Array.isArray(val) && val.length === 0)
  );
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return String(v);
  return null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asString(x))
    .filter((x): x is string => Boolean(x));
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * แปลง JSON ดิบจากโมเดล → โครงสร้าง V2 ที่สะอาดแล้ว
 * (ยังไม่ตรวจความถูกต้อง — นั่นคือ validateExtraction)
 */
export function normalizeExtraction(raw: any): V2Extraction {
  const core = raw?.core ?? {};
  const price = core.price ?? {};
  const confidence = raw?.confidence ?? {};

  const normalized: V2Extraction = {
    core: {
      place_name: asString(core.place_name),
      community: asString(core.community),
      location: {
        province: asString(core.location?.province),
        district: asString(core.location?.district),
        subdistrict: asString(core.location?.subdistrict),
      },
      category: asStringArray(core.category),
      overview: asString(core.overview),
      price: {
        weekday: asString(price.weekday),
        weekend: asString(price.weekend),
        unit: asString(price.unit),
        currency: asString(price.currency) || "THB",
        inclusions: asStringArray(price.inclusions),
      },
      opening_hours: asString(core.opening_hours),
      contact: {
        phone: asString(core.contact?.phone),
        facebook: asString(core.contact?.facebook),
        line: asString(core.contact?.line),
      },
      restrictions: asStringArray(core.restrictions),
      activities: asStringArray(core.activities),
      views: asStringArray(core.views),
      highlights: asStringArray(core.highlights),
      tags: asStringArray(core.tags),
    },
    stay: null,
    food: null,
    activity: null,
    otop: null,
    access: null,
    confidence: {
      overall: asNumber(confidence.overall, 0),
      per_module: {
        stay: asNumber(confidence.per_module?.stay, 0),
        food: asNumber(confidence.per_module?.food, 0),
        activity: asNumber(confidence.per_module?.activity, 0),
        otop: asNumber(confidence.per_module?.otop, 0),
      },
      conflicts: asStringArray(confidence.conflicts),
      missing_info: asStringArray(confidence.missing_info),
      source_used: asStringArray(confidence.source_used),
    },
  };

  // ── stay ──
  if (raw?.stay && typeof raw.stay === "object") {
    const roomTypes = Array.isArray(raw.stay.room_types)
      ? raw.stay.room_types
          .map((r: any) => ({
            name: asString(r?.name),
            count: asString(r?.count),
            capacity: asString(r?.capacity),
            beds: asString(r?.beds),
            bathroom: asString(r?.bathroom),
          }))
          .filter((r: any) => r.name || r.count || r.capacity || r.beds || r.bathroom)
      : [];
    normalized.stay = {
      room_types: roomTypes,
      bedding: asString(raw.stay.bedding),
      mosquito_net: asString(raw.stay.mosquito_net),
      facilities: asStringArray(raw.stay.facilities),
      services: asStringArray(raw.stay.services),
    };
  }

  // ── food ──
  if (raw?.food && typeof raw.food === "object") {
    normalized.food = {
      menu_highlights: asStringArray(raw.food.menu_highlights),
      price_from: asString(raw.food.price_from),
      seating: asString(raw.food.seating),
      payment: asStringArray(raw.food.payment),
    };
  }

  // ── activity ──
  if (raw?.activity && typeof raw.activity === "object") {
    normalized.activity = {
      what_you_do: asString(raw.activity.what_you_do),
      duration: asString(raw.activity.duration),
      min_max_people: asString(raw.activity.min_max_people),
      take_home: asString(raw.activity.take_home),
      need_booking: asString(raw.activity.need_booking),
    };
  }

  // ── otop ──
  if (raw?.otop && typeof raw.otop === "object") {
    const products = Array.isArray(raw.otop.products)
      ? raw.otop.products
          .map((p: any) => ({
            name: asString(p?.name),
            price: asString(p?.price),
            note: asString(p?.note),
          }))
          .filter((p: any) => p.name || p.price || p.note)
      : [];
    normalized.otop = {
      products,
      can_buy_on_site: asString(raw.otop.can_buy_on_site),
      can_try_making: asString(raw.otop.can_try_making),
    };
  }

  // ── access ──
  if (raw?.access && typeof raw.access === "object") {
    normalized.access = {
      road_condition: asString(raw.access.road_condition),
      vehicle_advice: asString(raw.access.vehicle_advice),
      walk_required: asString(raw.access.walk_required),
      parking: asString(raw.access.parking),
    };
  }

  return normalized;
}

/**
 * ตรวจความถูกต้องด้วยโค้ด (ไม่ใช่ AI)
 * -------------------------------------------------------------
 * V1 ตัวเลข (ราคา/เบอร์) ต้องมีที่มาจากเสียงพูด → ไม่เจอ = เตือน (ไม่ลบ)
 * V2 โมดูลที่กรอกแล้วว่าง → null
 * V3 จำนวนห้องที่ไม่ใช่ตัวเลข → เตือน
 * V4 conflicts → เขียนเป็นบรรทัด ⚠ ในการ์ด
 * V5 ความมั่นใจของโมดูลต่ำกว่า 0.5 → ต่อท้ายชื่อหัวข้อ
 * V6 ราคาต้องเป็นตัวเลข/ช่วงตัวเลข → ไม่งั้นเตือน
 * V7 ราคาเท่ากันทั้งวันธรรมดาและวันหยุด → โค้ดเติมเอง
 */
export function validateExtraction(
  raw: any,
  ctx: { transcript?: string } = {}
): V2Validation {
  const data = normalizeExtraction(raw);
  const warnings: string[] = [];
  const conflicts: string[] = [...data.confidence.conflicts];
  const missing: string[] = [...data.confidence.missing_info];
  const transcript = (ctx.transcript || "").trim();

  // ── V2: โมดูลว่าง → null ──
  if (data.stay && isEmptyObject(data.stay)) data.stay = null;
  if (data.food && isEmptyObject(data.food)) data.food = null;
  if (data.activity && isEmptyObject(data.activity)) data.activity = null;
  if (data.otop && isEmptyObject(data.otop)) data.otop = null;
  if (data.access && isEmptyObject(data.access)) data.access = null;

  // ── V1: ตัวเลขที่มีค่า ต้องเจอในเสียงพูด ──
  // (ถ้าไม่มี transcript เลย → ตรวจไม่ได้ → ไม่เตือน ไม่แตะค่า)
  if (transcript) {
    const checks: { label: string; value: string | null }[] = [
      { label: "ราคาวันธรรมดา", value: data.core.price.weekday },
      { label: "ราคาวันหยุด", value: data.core.price.weekend },
      { label: "เบอร์โทร", value: data.core.contact.phone },
    ];
    for (const c of checks) {
      if (!c.value) continue;
      const notFound = numbersMissingInTranscript(c.value, transcript);
      if (notFound.length > 0) {
        const msg = `${c.label} (${c.value}) — ไม่พบตัวเลขนี้ในเสียงพูด`;
        missing.push(msg);
        warnings.push(msg);
      }
    }
  }

  // ── V3: จำนวนห้องต้องเป็นตัวเลข ──
  if (data.stay) {
    for (const r of data.stay.room_types) {
      if (r.count && !NUMERIC.test(r.count.replace(/,/g, ""))) {
        const msg = `จำนวนห้อง "${r.count}" ไม่ใช่ตัวเลข — ควรตรวจสอบ`;
        conflicts.push(msg);
        warnings.push(msg);
      }
    }
  }

  // ── V6: ราคาต้องเป็นตัวเลข/ช่วงตัวเลข ──
  for (const key of ["weekday", "weekend"] as const) {
    const v = data.core.price[key];
    if (v && !NUMERIC.test(v.replace(/,/g, "").replace(/\s/g, ""))) {
      const msg = `ราคา${key === "weekday" ? "วันธรรมดา" : "วันหยุด"} "${v}" ไม่ใช่ตัวเลข — ควรตรวจสอบ`;
      conflicts.push(msg);
      warnings.push(msg);
    }
  }

  // ── V4: คำเตือนรวม ──
  const warningText = [...conflicts, ...warnings].filter(Boolean).join(" · ");
  data.confidence.conflicts = conflicts;
  data.confidence.missing_info = missing;
  data.confidence.warning = warningText || null;

  return { data, warnings, conflicts, missing };
}

// ─────────────────────────────────────────────
//  7) ประกอบการ์ด
// ─────────────────────────────────────────────

const UNIT_SUFFIX: Record<string, string> = {
  ต่อคน: "/คน",
  ต่อคืน: "/คืน",
  ต่อกลุ่ม: "/กลุ่ม",
};

/**
 * ตัดข้อความซ้ำ
 * -------------------------------------------------------------
 * โมเดลกับข้อมูลจากแผนที่มักเขียนเรื่องเดียวกันคนละแบบ
 * (เช่น "วิวทะเลหมอกยามเช้า" กับ "ดูวิวทะเลหมอกตอนเช้าได้")
 * → ถ้าข้อความหนึ่งอยู่ในอีกข้อความหนึ่ง ให้เก็บของยาวไว้ข้อเดียว
 */
function dedupeTexts(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const t = (raw ?? "").trim();
    if (!t) continue;
    const norm = t.toLowerCase().replace(/\s+/g, "");
    const dup = out.some((o) => {
      const on = o.toLowerCase().replace(/\s+/g, "");
      return on.includes(norm) || norm.includes(on);
    });
    if (!dup) out.push(t);
  }
  return out;
}

/**
 * ตัดบรรทัดซ้ำแบบเดียวกับ dedupeTexts แต่เก็บชนิด (ok/warn/info) ไว้
 * ถ้าข้อความหนึ่งเป็นส่วนหนึ่งของอีกข้อความ → เก็บข้อความที่ยาวกว่า (ข้อมูลเยอะกว่า)
 */
function dedupeLines(lines: PostCardLine[]): PostCardLine[] {
  const out: PostCardLine[] = [];
  for (const line of lines) {
    const t = (line.text ?? "").trim();
    if (!t) continue;
    const norm = t.toLowerCase().replace(/\s+/g, "");
    const idx = out.findIndex((o) => {
      const on = o.text.toLowerCase().replace(/\s+/g, "");
      return on.includes(norm) || norm.includes(on);
    });
    if (idx === -1) {
      out.push({ ...line, text: t });
    } else if (norm.length > out[idx].text.replace(/\s+/g, "").length) {
      out[idx] = { ...line, text: t };
    }
  }
  return out;
}

/**
 * ข้อความที่ "เกือบเหมือน" กันแค่ไหน (0 = ไม่เหมือนเลย · 1 = เหมือนกันหมด)
 * -------------------------------------------------------------
 * ไทยไม่มีเว้นวรรคระหว่างคำ → เทียบด้วย "กลุ่มตัวอักษร 3 ตัว" (trigram) แทนคำ
 * นับว่ากลุ่มตัวอักษรของข้อความหนึ่ง มีกี่ส่วนที่โผล่ในอีกข้อความ
 */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** สัดส่วนที่สองข้อความ "ตรงกัน" (0-1) */
function overlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  const ga = trigrams(a);
  const gb = trigrams(b);
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return hit / ga.size;
}

/** เก็บเฉพาะตัวอักษรที่ใช้เทียบ (ไทย/อังกฤษ/ตัวเลข) — ตัดช่องว่างและเครื่องหมายทิ้ง */
function normalizeForCompare(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^฀-๿a-z0-9]/g, "");
}

/**
 * คำที่เป็น "ข้อมูลเฉพาะของที่นี่" — ถ้าการ์ดมีคำนี้ไปแล้ว
 * ข้อความที่พูดถึงมันซ้ำ ๆ ก็ไม่ได้เพิ่มอะไรให้คนอ่าน
 */
const KEY_FACT_TERMS = [
  "กองไฟ",
  "น้ำร้อน",
  "มุ้งกันยุง",
  "ฟูก",
  "เสื่อ",
  "ห้องน้ำรวม",
  "รถยนต์",
  "รถบัส",
  "ลูกรัง",
  "ปีอก",
  "สลัม",
  "ไวไฟ",
  "ตู้เย็น",
  "อาบน้ำ",
  "ที่จอดรถ",
];

/**
 * ตัดบรรทัดที่ซ้ำกับที่การ์ดแสดงไปแล้วออก
 * -------------------------------------------------------------
 * ปัญหาที่เจอ: หัวข้อ "ต้องรู้ก่อนไป" ไปมีข้อมูลที่การ์ดแสดงไว้แล้ว
 * (คำบรรยาย · จุดเด่น · หัวข้ออื่น) → อ่านซ้ำสองรอบ
 *
 * ตัดได้ 3 แบบ
 *   1) ซ้ำเป๊ะ หรือเป็นส่วนหนึ่งของข้อความที่มีอยู่แล้ว
 *   2) ซ้ำเกือบเหมือน (ตัวอักษรตรงกัน ≥ 60%)
 *   3) ไม่เพิ่มข้อมูลใหม่เลย — พูดถึงแค่เรื่องที่การ์ดมีอยู่แล้ว
 *      (และไม่มีตัวเลขที่การ์ดยังไม่มี)
 *
 * ถ้าตัดหมด → หัวข้อ "ต้องรู้ก่อนไป" จะไม่ถูกสร้างขึ้นเลย
 */
function dropDuplicatesAgainst(
  lines: PostCardLine[],
  pool: string[]
): PostCardLine[] {
  const normPool = pool.map(normalizeForCompare).filter((t) => t.length > 0);
  const poolDigits = new Set(
    normPool.join(" ").match(/\d+/g) ?? []
  );
  const out: PostCardLine[] = [];
  for (const line of lines) {
    const t = (line.text ?? "").trim();
    if (!t) continue;
    const n = normalizeForCompare(t);
    if (!n) continue;

    // 0) ซ้ำกับบรรทัดที่เก็บไว้แล้วในหัวข้อนี้ → เก็บอันที่ยาวกว่า
    //    (เช่น "ต้องจองล่วงหน้า 2 วัน" ที่โมเดลเขียนทั้งใน restrictions และ need_booking)
    const dupIdx = out.findIndex((o) => {
      const on = normalizeForCompare(o.text);
      return (
        on === n ||
        (on.length >= 5 && on.includes(n)) ||
        (n.length >= 5 && n.includes(on))
      );
    });
    if (dupIdx !== -1) {
      if (n.length > normalizeForCompare(out[dupIdx].text).length) {
        out[dupIdx] = { ...line, text: t };
      }
      continue;
    }

    // 1) ซ้ำเป๊ะ / เป็นส่วนหนึ่งของข้อความที่การ์ดมีอยู่แล้ว
    const verbatim = normPool.some(
      (p) =>
        p === n ||
        (n.length >= 5 && p.includes(n)) ||
        (p.length >= 5 && n.includes(p))
    );
    if (verbatim) continue;

    // 2) ซ้ำเกือบเหมือน
    if (normPool.some((p) => overlapRatio(n, p) >= 0.6)) continue;

    // 3) ไม่เพิ่มข้อมูลใหม่ — เป็นการเล่าซ้ำเรื่องที่การ์ดมีอยู่แล้ว
    const terms = KEY_FACT_TERMS.filter((k) =>
      n.includes(normalizeForCompare(k))
    );
    if (terms.length > 0) {
      const allInPool = terms.every((k) => {
        const kn = normalizeForCompare(k);
        return normPool.some((p) => p.includes(kn));
      });
      const digits = n.match(/\d+/g) ?? [];
      const hasNewNumber = digits.some((d) => !poolDigits.has(d));
      if (allInPool && !hasNewNumber) continue;
    }

    out.push({ ...line, text: t });
  }
  return out;
}

/**
 * เติมให้ชัดว่า "มีเตียงหรือไม่มีเตียง" ในข้อความที่นอน
 * -------------------------------------------------------------
 * คนอ่านแล้วต้องรู้ทันทีว่านอนบนเตียงหรือนอนพื้น (ฟูก/เสื่อ/ถุงนอน = ไม่มีเตียง)
 */
function describeBedding(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  if (/เตียง/.test(t)) return t;
  if (/ฟูก|เสื่อ|ถุงนอน|พื้น/.test(t)) return `${t} · ไม่มีเตียง`;
  return t;
}

/**
 * คำที่บอกว่าเป็น "บริการ" (มีให้ลูกค้า) ไม่ใช่ "ของที่อยู่ในห้อง"
 * -------------------------------------------------------------
 * โมเดลมีคีย์ `stay.services` แยกให้แล้ว แต่บางครั้งยัดบริการลงไปใน
 * `stay.facilities` → ใช้คำหลักชุดนี้ย้ายกลับ ให้หัวข้อ "ภายในห้องพัก"
 * แยกหมวดถูกเสมอ (คำที่ไม่รู้ → อยู่หมวด "ของในห้อง")
 *
 * ระวัง: ภาษาไทยไม่เว้นวรรค → ใช้คำที่เจาะจงพอ
 * (เช่น "ชา" เฉย ๆ ไม่ใช้ เพราะไปโดน "ชาวบ้าน")
 */
const SERVICE_KEYWORDS = [
  "น้ำร้อน",
  "น้ำดื่ม",
  "น้ำแข็ง",
  "อาหาร",
  "กาแฟ",
  "ชาเย็น",
  "ชาร้อน",
  "ชา/",
  "เครื่องดื่ม",
  "ผ้าเช็ดตัว",
  "ผ้าเช็ดหน้า",
  "ซักผ้า",
  "อบร้อน",
  "รับส่ง",
  "จัดการคืน",
  "เช็คอิน",
  "เช็กอิน",
  "เช็คเอาท์",
  "เช็กเอาท์",
  "ให้ยืม",
  "บริการ",
];

/** ข้อความนี้เป็น "บริการ" หรือ "ของที่อยู่ในห้อง"? */
function isServiceItem(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return SERVICE_KEYWORDS.some((k) => t.includes(k));
}

// ─────────────────────────────────────────────
//  เวลาเปิด-ปิด (จาก Google Places)
// ─────────────────────────────────────────────

/** วันเรียงตามสัปดาห์ (จันทร์ → อาทิตย์) */
const THAI_WEEKDAYS = [
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
  "อาทิตย์",
];

/** ลำดับวัน (ใช้เรียงให้ถูกลำดับ ไม่ว่า Google จะคืนมาลำดับไหน) */
const DAY_ORDER: Record<string, number> = {
  จันทร์: 0,
  อังคาร: 1,
  พุธ: 2,
  พฤหัสบดี: 3,
  ศุกร์: 4,
  เสาร์: 5,
  อาทิตย์: 6,
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/** วันนี้ของไทย (0 = จันทร์) — สถานที่ในแอปอยู่ในไทย (UTC+7) */
function todayThaiWeekday(): number {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return (now.getUTCDay() + 6) % 7;
}

interface HoursEntry {
  day: string;
  time: string;
}

/**
 * แปลง `weekday_text` ของ Google → รายวัน
 * -------------------------------------------------------------
 * รูปแบบที่ Google คืน: "จันทร์: 08:00–17:00" (หรือ "Monday: 8:00 AM – 5:00 PM")
 * → แยกชื่อวันกับช่วงเวลา แล้วเรียงให้เรียงตามสัปดาห์เสมอ
 */
function parseWeekdayTexts(lines: string[]): HoursEntry[] {
  const parsed: HoursEntry[] = [];
  for (const raw of lines) {
    const text = (raw ?? "").trim();
    if (!text) continue;
    const idx = text.indexOf(":");
    if (idx <= 0) {
      parsed.push({ day: "", time: text });
      continue;
    }
    const day = text.slice(0, idx).trim().replace(/^วัน\s*/, "");
    const time = text.slice(idx + 1).trim();
    // ชื่อวันต้องไม่มีตัวเลข — ถ้ามี แปลว่าไม่มีชื่อวัน (เช่น "8:00 AM – 5:00 PM")
    if (!time || /\d/.test(day)) {
      parsed.push({ day: "", time: text });
      continue;
    }
    parsed.push({ day, time });
  }
  return parsed
    .map((e, i) => ({ ...e, i, order: DAY_ORDER[e.day.toLowerCase()] ?? 99 }))
    .sort((a, b) => (a.order === b.order ? a.i - b.i : a.order - b.order))
    .map(({ day, time }) => ({ day, time }));
}

/**
 * บรรทัดของหัวข้อ "เวลาเปิด" (ข้อมูลจาก Google Places)
 * -------------------------------------------------------------
 * บรรทัดแรก  → เปิด/ปิดอยู่ตอนนี้ (+ เวลาของวันนี้)
 * บรรทัดถัดมา → ตารางรายวัน (วันที่เวลาเหมือนกันรวมเป็นช่วงเดียว)
 *
 * คืน [] ถ้าไม่มีข้อมูลเลย → ไม่มีหัวข้อ "เวลาเปิด" (ไม่ต้องมีหัวข้อว่าง)
 */
function buildOpeningHoursLines(
  hours: OpeningHours | null | undefined
): string[] {
  if (!hours) return [];
  const entries = parseWeekdayTexts(hours.weekdayText ?? []);
  const lines: string[] = [];

  // เวลาของวันนี้ (ไม่ต้องเดาวันจากลำดับที่ Google คืนมา — ดูจากชื่อวันแทน)
  const todayName = THAI_WEEKDAYS[todayThaiWeekday()];
  const todayEntry = entries.find((e) => e.day === todayName) ?? null;

  if (hours.openNow != null) {
    const state = hours.openNow ? "เปิดอยู่ตอนนี้" : "ปิดอยู่ตอนนี้";
    lines.push(todayEntry ? `${state} · วันนี้ ${todayEntry.time}` : state);
  }

  // ตารางรายวัน — รวมวันที่เวลาเหมือนกันติดกันเป็นช่วงเดียว
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].time === entries[i].time) j++;
    const from = entries[i].day;
    const to = entries[j].day;
    const range = from && to && from !== to ? `${from}–${to}` : from || to;
    lines.push(range ? `${range}: ${entries[i].time}` : entries[i].time);
    i = j + 1;
  }

  return lines;
}

/**
 * ลิงก์ไปยังสถานที่ใกล้เคียงบน Google Maps
 * -------------------------------------------------------------
 * จุดเริ่มต้น = สถานที่ในคลิป (พิกัดที่หาได้จาก Google Places)
 * ปลายทาง  = สถานที่ใกล้เคียงแต่ละแห่ง
 * กดแล้วเปิดแผนที่พร้อมเส้นทางจากสถานที่ในคลิปไปยังสถานที่นั้น
 *
 * ถ้าไม่รู้พิกัดจุดเริ่มต้น → ส่งไปค้นหาชื่อสถานที่แทน (ยังดีกว่าไม่มีลิงก์)
 */
function nearbyMapUrl(
  n: NearbyAttraction,
  origin?: { lat?: number | null; lon?: number | null } | null
): string | null {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const oLat = num(origin?.lat);
  const oLon = num(origin?.lon);
  const dLat = num(n.lat);
  const dLon = num(n.lon);

  if (oLat !== null && oLon !== null && dLat !== null && dLon !== null) {
    return (
      "https://www.google.com/maps/dir/?api=1" +
      `&origin=${oLat},${oLon}` +
      `&destination=${dLat},${dLon}` +
      "&travelmode=driving"
    );
  }
  if (dLat !== null && dLon !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${dLat},${dLon}`;
  }
  const q = (n.name ?? "").trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// ─────────────────────────────────────────────
//  7.1 การ์ด — บล็อก "ข้อความล้วน" (ไม่มีไอคอน)
// ─────────────────────────────────────────────

/**
 * กุญแจของกลุ่มข้อมูลที่แสดงเป็น "บรรทัดข้อเท็จจริง" ในการ์ด
 * (เรียงตามประเภทสถานที่ — ดู `TYPE_SECTION_ORDER`)
 */
type FactKey = "price" | "stay" | "roomInside" | "food" | "otop";

/** หัวข้อของบล็อกที่มีรายการ (ไม่มี emoji — การ์ดเป็นข้อความล้วน) */
export const BLOCK_TITLES = {
  nearby: "สถานที่ที่อยู่ใกล้เคียง",
  price: "ราคา",
  stay: "ที่พัก",
  roomInside: "ภายในห้องพัก",
  hours: "เวลาเปิด",
  food: "มีอะไรกิน",
  otop: "สินค้า OTOP",
  know: "ต้องรู้ก่อนไป",
  travel: "เดินทาง",
} as const;

/**
 * บรรทัดนี้มาจาก Google Maps หรือไม่
 * -------------------------------------------------------------
 * ข้อมูลจาก Google ถูกต้องอยู่แล้ว (ชื่อสถานที่จริง ระยะทาง เวลา)
 * และชื่อจริงอาจไม่ตรงกับที่คนไทยเขียน → เวลา "ตรวจสะกด" ห้ามแตะบรรทัดพวกนี้
 *
 *   · บล็อก "สถานที่ที่อยู่ใกล้เคียง" → ทั้งบล็อกมาจาก Google Places
 *   · บล็อก "เวลาเปิด" → ทั้งบล็อกมาจาก Google Places
 *   · บล็อก "เดินทาง" ที่เป็น kind "info" → มาจาก Google Routes
 */
export function isGoogleLine(block: PostCardBlock, line: PostCardLine): boolean {
  if (block.title === BLOCK_TITLES.nearby) return true;
  if (block.title === BLOCK_TITLES.hours) return true;
  if (block.title === BLOCK_TITLES.travel && line.kind === "info") return true;
  return false;
}

/**
 * ส่วนที่เปลี่ยนตามประเภทสถานที่ — เรียงตาม "อะไรที่คนต้องรู้ก่อนไป" จริง ๆ
 * -------------------------------------------------------------
 * ที่พัก   → ราคา → ที่พัก → ภายในห้องพัก → มีอะไรกิน → สินค้า OTOP
 * คาเฟ่    → มีอะไรกิน → ราคา → สินค้า OTOP   (คนเลือกคาเฟ่จากเมนูก่อนราคา)
 * กิจกรรม → ราคา → สินค้า OTOP
 * ธรรมชาติ → ราคา → มีอะไรกิน → สินค้า OTOP
 *
 * ประเภทที่อยู่ก่อนใน `category` จะถูกเลือกก่อน
 */
const TYPE_SECTION_ORDER: { keys: string[]; order: FactKey[] }[] = [
  {
    keys: [
      "โฮมสเตย์",
      "ที่พัก",
      "รีสอร์ท",
      "รีสอร์ต",
      "แคมป์",
      "บ้านพัก",
      "โรงแรม",
      "ห้องพัก",
    ],
    order: ["price", "stay", "roomInside", "food", "otop"],
  },
  {
    keys: [
      "คาเฟ่",
      "กาแฟ",
      "ร้านกาแฟ",
      "ร้านอาหาร",
      "อาหาร",
      "ครัว",
      "ตลาด",
    ],
    order: ["food", "price", "otop"],
  },
  {
    keys: [
      "Workshop",
      "workshop",
      "เวิร์กช็อป",
      "เวิร์คช็อป",
      "กิจกรรม",
      "หัตถกรรม",
      "เรียนรู้",
      "สาธิต",
    ],
    order: ["price", "otop"],
  },
  {
    keys: [
      "ธรรมชาติ",
      "จุดชมวิว",
      "น้ำตก",
      "ภูเขา",
      "เดินป่า",
      "ทะเล",
      "ถ้ำ",
      "สวน",
      "ท่องเที่ยว",
    ],
    order: ["price", "food", "otop"],
  },
  {
    keys: ["วัด", "ศาสนา", "โบรณา"],
    order: ["price", "food", "otop"],
  },
];

const DEFAULT_SECTION_ORDER: FactKey[] = [
  "price",
  "food",
  "stay",
  "roomInside",
  "otop",
];

/** เลือกลำดับหัวข้อตามประเภทสถานที่ (ประเภทแรกที่ match ได้คือประเภทหลัก) */
function pickSectionOrder(category: unknown): FactKey[] {
  const list = Array.isArray(category) ? category.map((c) => String(c)) : [];
  for (const c of list) {
    const hit = TYPE_SECTION_ORDER.find((g) =>
      g.keys.some((k) => c.includes(k))
    );
    if (hit) return hit.order;
  }
  return DEFAULT_SECTION_ORDER;
}

/** มีคำของประเภทนี้ใน category ไหม */
function categoryHas(category: unknown, keys: string[]): boolean {
  const list = Array.isArray(category) ? category.map((c) => String(c)) : [];
  return list.some((c) => keys.some((k) => c.includes(k)));
}

const LODGING_KEYS = [
  "โฮมสเตย์",
  "ที่พัก",
  "รีสอร์ท",
  "รีสอร์ต",
  "แคมป์",
  "บ้านพัก",
  "โรงแรม",
  "ห้องพัก",
];

const FOOD_KEYS = ["คาเฟ่", "กาแฟ", "ร้านอาหาร", "อาหาร", "ครัว", "ตลาด"];

/**
 * ประกอบการ์ดหน้าโพสต์จากข้อมูลที่ผ่านการตรวจแล้ว
 * -------------------------------------------------------------
 * รูปแบบ "ข้อความล้วน" — ไม่มีไอคอนหน้าบรรทัด อ่านต่อเนื่องเป็นเรื่องเดียว
 *
 * โครงสร้างที่ได้
 *   [ชื่อสถานที่] → [ที่อยู่] → [คำบรรยายรวม]
 *   ราคา                 ← หัวข้อจริง + บรรทัดรายละเอียด (facts)
 *   ที่พัก / ภายในห้องพัก ← หัวข้อจริง + บรรทัดรายละเอียด (facts)
 *   มีอะไรกิน / สินค้า OTOP   ← หัวข้อจริง + บรรทัดรายละเอียด (facts)
 *   เวลาเปิด              ← เวลาเปิด-ปิดจาก Google Places (facts)
 *   ต้องรู้ก่อนไป        ← กติกา/ข้อจำกัด/ที่ต้องเตรียม (bullet)
 *   เดินทาง              ← เดิน/จอด/ระยะทาง (bullet)
 *   สถานที่ที่อยู่ใกล้เคียง   ← สถานที่ใกล้เคียงจาก Google Places (bullet · กดไปแผนที่ได้)
 *   [ติดต่อ] → [เครดิตแผนที่]
 *
 * กติกา (ทำในโค้ด ไม่ใช่ AI):
 *   · ข้อมูลที่ไม่มี → ไม่แสดง (ไม่ใช่แสดง "ไม่มีข้อมูล")
 *   · "ราคาเท่ากันทั้งวันธรรมดาและวันหยุด" เทียบ weekday/weekend แล้วเติมเอง
 *   · สถานที่ใกล้เคียงมาจาก Google Places ไม่ใช่จากโมเดล (ห้ามโมเดลแต่งชื่อสถานที่)
 *   · เวลาเปิด-ปิดมาจาก Google Places — ถ้า Google ไม่มี ค่อยใช้ที่โมเดลอ่านมาจากคลิป
 *   · ทุกบรรทัดของ "สถานที่ที่อยู่ใกล้เคียง" มีลิงก์ Google Maps
 *     (จุดเริ่มต้น = สถานที่ในคลิป) และวางไว้ท้ายสุดของการ์ด
 *   · ข้อมูลกลุ่มละกรฐาน ๆ (ราคา/ที่พัก/อาหาร/OTOP) แยกเป็นหัวข้อของตัวเอง
 *     เพื่อให้ผู้ใช้เห็นรายละเอียดชัด ๆ ไม่ต้องไล่หาในบรรทัดยาว ๆ
 *   · ไม่มีหัวข้อ "ทำอะไรได้" — เนื้อหาของมันไปอยู่ใน "ต้องรู้ก่อนไป" แล้ว
 */
export function buildPostCard(
  data: V2Extraction,
  map?: MapInfo | null,
  nearby?: NearbyAttraction[] | null
): PostCard {
  const { core, confidence } = data;
  const blocks: PostCardBlock[] = [];

  // ── เวลาเปิด-ปิด (จาก Google Places) ──
  // มาพร้อมกับพิกัดที่หาได้ → ไม่ต้องยิงเพิ่ม
  const hoursLines = buildOpeningHoursLines(map?.openingHours);

  // ── สถานที่ที่อยู่ใกล้เคียง (คำนวณตอนนี้ แต่วางบล็อกไว้ท้ายการ์ด) ──
  // มาจาก Google Places (Nearby Search) — ถ้าไม่มีจะไม่มีบล็อกนี้
  // แต่ละบรรทัดมีลิงก์: "เดินทางจากสถานที่ในคลิป → สถานที่ใกล้เคียง"
  const nearbyLines: PostCardLine[] = [];
  for (const n of nearby ?? []) {
    const bits = [n.name];
    if (n.label) bits.push(n.label);
    if (n.distanceKm != null) bits.push(`${n.distanceKm} กม.`);
    if (n.rating != null && n.rating >= 4) bits.push(`★${n.rating.toFixed(1)}`);
    nearbyLines.push({
      kind: "ok",
      text: bits.join(" · "),
      url: nearbyMapUrl(n, map),
    });
  }

  // ── บล็อก 2: กลุ่มข้อมูลที่มีหัวข้อของตัวเอง (เรียงตามประเภทสถานที่) ──
  // แต่ละกลุ่ม = หนึ่งหัวข้อ (ราคา / ที่พัก / ภายในห้องพัก / มีอะไรกิน / สินค้า OTOP)
  // → ผู้ใช้เห็นรายละเอียดชัด ๆ ไม่ต้องไล่หาในบรรทัดยาว ๆ
  const facts = new Map<FactKey, string[]>();
  /** ของที่อยู่นอกห้อง (ที่จอดรถ) → ไปอยู่หัวข้อ "เดินทาง" */
  const parkingExtras: string[] = [];
  /** รายการในห้องทีละชิ้น (ไว้ให้ตัวกรองข้อความซ้ำเทียบทีละชิ้น ไม่ใช่เทียบทั้งบรรทัด) */
  const roomItems: string[] = [];

  // ราคา + สิ่งที่รวมในราคา (ทุกประเภท) — คาเฟ่ที่มี food.price_from แล้วไม่ต้องพูดราคาซ้ำ
  // หัวข้อ "ราคา" อยู่ที่บล็อก → ในบรรทัดไม่ต้องขึ้นคำว่า "ราคา" ซ้ำอีก
  const priceBits: string[] = [];
  const p = core.price;
  const unitSuffix = p.unit ? UNIT_SUFFIX[p.unit] ?? `/${p.unit}` : "";
  const hasFoodPrice = Boolean(data.food?.price_from);
  if (!hasFoodPrice && p.weekday && p.weekend) {
    if (p.weekday.trim() === p.weekend.trim()) {
      priceBits.push(`${p.weekday}${unitSuffix}`);
      priceBits.push("เท่ากันทั้งวันธรรมดาและวันหยุด");
    } else {
      priceBits.push(
        `${p.weekday}${unitSuffix} วันธรรมดา / ${p.weekend}${unitSuffix} วันหยุด`
      );
    }
  } else if (!hasFoodPrice && (p.weekday || p.weekend)) {
    priceBits.push(`${p.weekday ?? p.weekend}${unitSuffix}`);
  }
  if (p.inclusions.length > 0) priceBits.push(`รวม${p.inclusions.join("และ")}`);
  if (priceBits.length > 0) facts.set("price", [priceBits.join(" · ")]);

  // ที่พัก — ที่พักเท่านั้นที่ควรมี (ถ้าเป็นคาเฟ่/ร้านอาหารแต่มีข้อมูล "ห้อง"
  // มาด้วย นั่นเป็นข้อมูลจริงของที่นั้น → เก็บไว้แสดง)
  const isLodging = categoryHas(core.category, LODGING_KEYS);
  const isFoodOnly =
    categoryHas(core.category, FOOD_KEYS) &&
    !isLodging &&
    (data.stay?.room_types.length ?? 0) === 0;
  if (data.stay && !isFoodOnly) {
    // "ที่พัก" = ห้องพักเอง (ชื่อห้อง จำนวนห้อง จำนวนคน เตียง ห้องน้ำ)
    const roomBits: string[] = [];
    for (const r of data.stay.room_types) {
      // ชื่อห้อง + จำนวน + จำนวนคน ติดกัน · เตียง/ห้องน้ำ แยกทีหลัง
      const head = [
        r.name,
        r.count ? `${r.count} ห้อง` : null,
        r.capacity ? `(${r.capacity} คน)` : null,
      ]
        .filter(Boolean)
        .join(" ");
      const parts = [head, r.beds, r.bathroom].filter(Boolean).join(" · ");
      if (parts) roomBits.push(parts);
    }
    if (roomBits.length > 0) facts.set("stay", roomBits);

    // "ภายในห้องพัก" = 3 หมวด (รอบที่ 8 — ผู้ใช้เลือก "กลาง + แยกหมวด")
    //   ที่นอน: … / ของในห้อง: … / บริการ: …
    // แต่ละชิ้นขึ้นบรรทัดของตัวเอง (นำหน้า "· ") ไม่ยัดรวมเป็นบรรทัดเดียว
    // → รายละเอียดของชิ้น (วัสดุ/จำนวน/สี/ตำแหน่ง) ไม่ถูกบีบจนอ่านไม่ออก
    //   และยังแยกออกชัดว่าอันไหนของในห้อง อันไหนบริการที่เจ้าของให้
    const roomLines: string[] = [];

    const bedding = describeBedding(data.stay.bedding ?? "");
    if (bedding) {
      roomLines.push(`ที่นอน: ${bedding}`);
      roomItems.push(bedding);
    }

    // ของที่อยู่ในห้อง (เห็นได้จริง)
    const things: string[] = [];
    // บริการที่มีให้ลูกค้า
    const services: string[] = [];

    if (data.stay.mosquito_net) {
      const no = /ไม่มี|ไม่\s*ชัด/.test(data.stay.mosquito_net);
      things.push(no ? "ไม่มีมุ้งกันยุง" : "มีมุ้งกันยุง");
    }
    for (const f of data.stay.facilities) {
      const t = (f ?? "").trim();
      if (!t) continue;
      // ของที่อยู่นอกห้อง (ที่จอดรถ) ไม่ใช่ของในห้อง → ไปอยู่หัวข้อ "เดินทาง" แทน
      if (/ที่จอด|จอดรถ|ลานจอด/.test(t)) {
        parkingExtras.push(t);
        continue;
      }
      // โมเดลยัดบริการมาใน facilities → ย้ายเข้าหมวด "บริการ"
      if (isServiceItem(t)) services.push(t);
      else things.push(t);
    }
    for (const s of data.stay.services) {
      const t = (s ?? "").trim();
      if (!t) continue;
      if (/ที่จอด|จอดรถ|ลานจอด/.test(t)) {
        parkingExtras.push(t);
        continue;
      }
      services.push(t);
    }

    if (things.length > 0) {
      roomLines.push("ของในห้อง:");
      for (const t of things) roomLines.push(`· ${t}`);
      roomItems.push(...things);
    }
    if (services.length > 0) {
      roomLines.push("บริการ:");
      for (const s of services) roomLines.push(`· ${s}`);
      roomItems.push(...services);
    }
    if (roomLines.length > 0) facts.set("roomInside", roomLines);
  }

  // มีอะไรกิน — เมนูแยกทีละจานขึ้นบรรทัด (นำหน้า "· ")
  // → รายละเอียดของแต่ละจาน (วัตถุดิบ/รสชาติ/ราคา) ไม่ถูกยัดรวมเป็นบรรทัดเดียว
  if (data.food) {
    const lines: string[] = [];
    for (const m of data.food.menu_highlights) {
      const t = (m ?? "").trim();
      if (t) lines.push(`· ${t}`);
    }
    if (data.food.price_from) lines.push(`ราคาเริ่มต้น ${data.food.price_from}`);
    if (data.food.seating) lines.push(`ที่นั่ง: ${data.food.seating}`);
    if (data.food.payment.length > 0) {
      lines.push(`จ่าย: ${data.food.payment.join("/")}`);
    }
    if (lines.length > 0) facts.set("food", lines);
  }

  // สินค้า OTOP — แยกทีละชิ้นขึ้นบรรทัด (นำหน้า "· ")
  if (data.otop) {
    const lines: string[] = [];
    for (const prod of data.otop.products) {
      const name = prod.name ?? "สินค้า";
      const price = prod.price ? ` — ${prod.price}` : "";
      const note = prod.note ? ` (${prod.note})` : "";
      lines.push(`· ${name}${price}${note}`);
    }
    if (data.otop.can_buy_on_site) {
      lines.push(`ซื้อที่นี่ได้: ${data.otop.can_buy_on_site}`);
    }
    if (data.otop.can_try_making) {
      lines.push(`ลองทำเองได้: ${data.otop.can_try_making}`);
    }
    if (lines.length > 0) facts.set("otop", lines);
  }

  // ── แต่ละกลุ่มข้อมูล = หนึ่งบล็อกที่มีหัวข้อของตัวเอง ──
  const typeOrder = pickSectionOrder(core.category);
  const orderedKeys = [
    ...typeOrder,
    // หัวข้อที่ไม่ได้อยู่ในลำดับของประเภทนี้ (เช่น "ที่พัก" ของคาเฟ่ที่มีห้องจริง)
    ...(["price", "stay", "roomInside", "food", "otop"] as FactKey[]).filter(
      (k) => !typeOrder.includes(k)
    ),
  ];
  for (const k of orderedKeys) {
    const lines = facts.get(k);
    if (!lines || lines.length === 0) continue;
    blocks.push({
      title: BLOCK_TITLES[k],
      style: "facts",
      lines: lines.map((t) => ({ kind: "ok", text: t })),
    });
  }

  // ── บล็อก "เวลาเปิด" (Google Places) ──
  // ของ Google ตรงกว่าที่โมเดลอ่านจากป้ายในคลิป → ถ้ามีก็ใช้ของ Google
  if (hoursLines.length > 0) {
    blocks.push({
      title: BLOCK_TITLES.hours,
      style: "facts",
      lines: hoursLines.map((t) => ({ kind: "ok", text: t })),
    });
  }

  // ── บรรทัดของหัวข้อ "เดินทาง" ──
  // คำนวณก่อน "ต้องรู้ก่อนไป" เพราะต้องเอาไปเช็คว่าข้อความซ้ำกันไหม
  const travelLines: PostCardLine[] = [];
  if (data.access?.walk_required) {
    travelLines.push({ kind: "ok", text: data.access.walk_required });
  }
  if (data.access?.parking) {
    travelLines.push({ kind: "ok", text: data.access.parking });
  }
  // ของที่โมเดลใส่ผิดกลุ่ม (ที่จอดรถ ที่อยู่นอกห้อง) → มาอยู่ที่นี่
  for (const extra of parkingExtras) {
    travelLines.push({ kind: "ok", text: extra });
  }
  if (map && map.routeKm != null && map.routeMinutes != null) {
    const from = map.routeFrom ? `จาก${map.routeFrom}` : "จากจุดอ้างอิง";
    travelLines.push({
      kind: "info",
      text: `${from} ประมาณ ${map.routeKm.toFixed(1)} กม. · ${Math.round(
        map.routeMinutes
      )} นาที`,
    });
  }
  // ชื่อถนน/เส้นทางที่ Google แนะนำ
  if (map?.routeVia) {
    travelLines.push({ kind: "info", text: `เส้นทาง: ${map.routeVia}` });
  }
  if (map?.hasToll) {
    travelLines.push({ kind: "warn", text: "มีสะพานข้ามที่เก็บค่าผ่าน" });
  }
  if (map?.trafficDelaySec != null && map.trafficDelaySec >= 60) {
    travelLines.push({
      kind: "info",
      text: `รถติดบนเส้นทางประมาณ ${Math.round(map.trafficDelaySec / 60)} นาที`,
    });
  }

  // ── บล็อก 3: "ต้องรู้ก่อนไป" ──
  const knowRaw: PostCardLine[] = [];
  for (const r of core.restrictions) knowRaw.push({ kind: "warn", text: r });
  if (data.activity?.need_booking) {
    // โมเดลอาจคืน "ต้องจองล่วงหน้า 3 วัน" หรือ "3 วันล่วงหน้า" → อย่าให้พูดซ้ำสองรอบ
    const booking = data.activity.need_booking.trim();
    knowRaw.push({
      kind: "warn",
      text: /ต้องจองล่วงหน้า/.test(booking)
        ? booking
        : `ต้องจองล่วงหน้า — ${booking}`,
    });
  }
  if (data.access?.road_condition) {
    knowRaw.push({ kind: "warn", text: data.access.road_condition });
  }
  if (data.access?.vehicle_advice) {
    knowRaw.push({ kind: "warn", text: data.access.vehicle_advice });
  }
  // เวลาเปิด = สิ่งที่ต้องรู้ก่อนไป (ไม่ใช่ราคา) → ไม่ต้องไปอยู่ใต้หัวข้อ "ราคา"
  // ถ้า Google มีเวลาเปิดอยู่แล้ว (หัวข้อ "เวลาเปิด") → ไม่ต้องพูดซ้ำ
  if (core.opening_hours && hoursLines.length === 0) {
    knowRaw.push({ kind: "info", text: `เปิด ${core.opening_hours}` });
  }
  // เนื้อหาของ "ทำอะไรได้" → ย้ายมาอยู่ในบล็อกนี้ (ไม่มีหัวข้อ "ทำอะไรได้" แยกอีกต่อไป)
  if (data.activity?.what_you_do) {
    knowRaw.push({ kind: "ok", text: data.activity.what_you_do.trim() });
  }
  if (data.activity?.duration) {
    knowRaw.push({ kind: "ok", text: `ใช้เวลา ${data.activity.duration.trim()}` });
  }
  if (data.activity?.min_max_people) {
    const people = data.activity.min_max_people.replace(/\s*คน\s*$/, "");
    knowRaw.push({ kind: "ok", text: `รับ ${people} คน` });
  }
  if (data.activity?.take_home) {
    const th = data.activity.take_home.trim();
    // โมเดลมักคืนเป็นกลิปประโยค เช่น "ผ้าผืนที่ถักเอง 1 ผืน" → ต้องเติมคำนำหน้าให้เป็นวลี
    knowRaw.push({
      kind: "ok",
      text: /^(เก็บ|ได้|มี|นำ)/.test(th) ? th : `นำกลับไปได้: ${th}`,
    });
  }
  for (const c of confidence.conflicts) {
    knowRaw.push({ kind: "warn", text: c });
  }

  // ── กรองข้อความซ้ำก่อนเอาไปขึ้นหัวข้อ "ต้องรู้ก่อนไป" ──
  // ข้อมูลที่การ์ดแสดงไปแล้วทั้งหมด (คำบรรยาย · จุดเด่น · หัวข้ออื่น)
  // → บรรทัดที่ซ้ำกับของเหล่านี้ไม่ต้องขึ้นหัวข้อซ้ำอีก
  // ถ้ากรองแล้วไม่เหลืออะไรเลย → หัวข้อนี้ไม่ถูกสร้าง (ไม่เหลือหัวข้อเปล่า)
  const addressParts = [
    core.location.subdistrict,
    core.location.district,
    core.location.province,
  ].filter(Boolean);
  const communityPart = core.community ? `${core.community} ` : "";
  const address = [communityPart + addressParts.join(" ")].join("").trim() || null;

  // โมเดลไม่ได้เขียนคำบรรยาย → ใช้จุดเด่น/จุดชมวิวที่มีแทน
  const fallbackDescription = dedupeTexts([...core.highlights, ...core.views]).join(" · ");
  const description = core.overview || fallbackDescription || null;

  const shownTexts: string[] = [
    description ?? "",
    ...core.highlights,
    core.place_name ?? "",
    address ?? "",
    ...nearbyLines.map((l) => l.text),
    ...travelLines.map((l) => l.text),
    ...[...facts.values()].flat(),
    // ของในห้อง/บริการทีละชิ้น → จับคู่ซ้ำได้ละเอียดกว่า (บรรทัดที่รวมหมวดยาวไป)
    ...roomItems,
    // เวลาเปิดจาก Google → บรรทัดอื่นที่พูดถึงเวลาเปิดซ้ำ ไม่ต้องขึ้นซ้ำอีก
    ...hoursLines,
  ];
  const knowLines = dropDuplicatesAgainst(knowRaw, shownTexts);
  if (knowLines.length > 0) {
    blocks.push({
      title: BLOCK_TITLES.know,
      style: "bullets",
      lines: knowLines,
    });
  }

  // ── บล็อก 4: "เดินทาง" ──
  if (travelLines.length > 0) {
    blocks.push({
      title: BLOCK_TITLES.travel,
      style: "bullets",
      lines: travelLines,
    });
  }

  // ── บล็อก 5: "สถานที่ที่อยู่ใกล้เคียง" (วางท้ายสุด) ──
  // เป็นลิงก์ออกไปข้างนอก — จุดเริ่มต้นคือสถานที่ในคลิป
  if (nearbyLines.length > 0) {
    blocks.push({
      title: BLOCK_TITLES.nearby,
      style: "bullets",
      lines: nearbyLines,
    });
  }

  // ── ชื่อสถานที่ + ที่อยู่ + คำบรรยายรวม ──
  // (address / description คำนวณไว้ข้างบนแล้ว — ต้องใช้ตอนกรองข้อความซ้ำ)
  const contact =
    core.contact.phone || core.contact.facebook || core.contact.line
      ? {
          phone: core.contact.phone,
          facebook: core.contact.facebook,
          line: core.contact.line,
        }
      : null;

  return {
    place: {
      name: core.place_name,
      address,
      description,
    },
    blocks,
    contact,
    mapCredit: map?.credit ?? null,
  };
}

// ─────────────────────────────────────────────
//  8) การ์ด → ข้อความล้วน
// ─────────────────────────────────────────────

/**
 * แปลงการ์ดเป็นข้อความล้วน
 * -------------------------------------------------------------
 * `text` ในระบบถูกใช้ 3 ที่: แอปแสดง (คลิปเก่า), Caption helper,
 * และ AI แชทโฟลเดอร์ → ต้องอ่านแล้วเข้าใจ ไม่ใช่ JSON
 *
 * รูปแบบเดียวกับที่แอปเรนเดอร์: บรรทัดข้อเท็จจริงไม่มีไอคอน
 * บรรทัดรายการใช้ "• " นำหน้า
 */
export function renderPostText(card: PostCard): string {
  const out: string[] = [];

  const name = card.place?.name?.trim();
  const address = card.place?.address?.trim();
  const tagline = card.place?.tagline?.trim();
  const description = card.place?.description?.trim();

  if (name) out.push(name);
  if (address) out.push(address);
  if (tagline) {
    out.push("");
    out.push(tagline);
  }
  if (description) {
    out.push("");
    out.push(description);
  }

  for (const block of card.blocks ?? []) {
    // ทุกบล็อกที่มีหัวข้อ → ขึ้นหัวข้อก่อน (ราคา / ที่พัก / ภายในห้องพัก / ...)
    if (block.title) {
      out.push("");
      out.push(block.title);
    }
    for (const line of block.lines) {
      out.push(block.style === "bullets" ? `• ${line.text}` : line.text);
    }
  }

  const c = card.contact;
  if (c) {
    const bits: string[] = [];
    if (c.phone) bits.push(`โทร ${c.phone}`);
    if (c.facebook) bits.push(`เฟซบุ๊ก ${c.facebook}`);
    if (c.line) bits.push(`ไลน์ ${c.line}`);
    if (c.hours) bits.push(`เวลา ${c.hours}`);
    if (bits.length > 0) {
      out.push("");
      out.push(bits.join(" · "));
    }
  }

  if (card.mapCredit) {
    out.push("");
    out.push(card.mapCredit);
  }

  return out.join("\n").trim();
}
