/**
 * ตัวตรวจ "เปิด/ปิด ณ เวลาที่จะไปถึง"
 * -------------------------------------------------------------
 * ก่อนหน้านี้ทั้งระบบไม่มีฟังก์ชันที่ตอบคำถามนี้ → ปล่อยให้ LLM
 * ตัดสินใจเองจากข้อความ → "ไปทันเวลาเปิด" เลยไม่น่าเชื่อถือ
 *
 * แหล่งข้อมูล เรียงตามความน่าเชื่อถือ:
 * 1. `businessHours` (JSONB ที่เจ้าของกรอกเอง)  → confidence "host"
 * 2. `openingHours` (ข้อความอิสระ 2 รูปแบบ)      → confidence "google"
 * 3. ไม่มีข้อมูล → "unknown" (ห้ามเดา)
 *
 * หมายเหตุ: ตัว parse ส่วนนี้คัดลอก/ปรับมาจาก `src/lib/businessProfile.ts`
 * ของฝั่งแอป (backend import จาก src/ ไม่ได้) — ไฟล์ต้นทางไม่ถูกแตะ
 */

/** โครงสร้างชั่วโมงแบบเดียวกับ `businessHours` ในฝั่งแอป */
export type DayRange = { open: string; close: string };
export type StructuredHours = Record<string, DayRange[]>;

/** โครงสร้างข้อมูลสถานที่ที่ตัวตรวจนี้ต้องใช้ (subset ของ PlaceContext) */
export interface OpenHoursInput {
  /** เวลาเปิดที่เจ้าของกรอกเอง (JSONB) — เชื่อถือที่สุด */
  businessHours?: StructuredHours | null;
  /** เวลาเปิดแบบข้อความอิสระ */
  openingHours?: string | null;
}

export type OpenVerdict = {
  status: "open" | "closed" | "unknown";
  /** "08:00" */
  openFrom?: string;
  /** "17:00" */
  closeTo?: string;
  /** host = ข้อมูลเจ้าของ · google = ข้อความอิสระ · unknown = ไม่มีข้อมูล */
  confidence: "host" | "google" | "unknown";
  /** อธิบายสั้น ๆ ให้คนอ่านรู้เรื่อง */
  note?: string;
};

// ── ตารางชื่อวัน ────────────────────────────────────────────────────────
export const WEEKDAY_KEYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** ไทย + อังกฤษ → index ใน WEEKDAY_KEYS */
const DAY_NAME_TO_INDEX: { match: string; index: number }[] = [
  { match: "จันทร์", index: 0 },
  { match: "อังคาร", index: 1 },
  { match: "พุธ", index: 2 },
  { match: "พฤหัส", index: 3 },
  { match: "ศุกร์", index: 4 },
  { match: "เสาร์", index: 5 },
  { match: "อาทิตย์", index: 6 },
  { match: "Monday", index: 0 },
  { match: "Tuesday", index: 1 },
  { match: "Wednesday", index: 2 },
  { match: "Thursday", index: 3 },
  { match: "Friday", index: 4 },
  { match: "Saturday", index: 5 },
  { match: "Sunday", index: 6 },
];

/** ตัวย่อไทยที่เจ้าของใช้ในวงเล็บ: จ อ พ พฤ ศ ส อา */
const SHORT_DAY_TO_INDEX: Record<string, number> = {
  จ: 0,
  อ: 1,
  พ: 2,
  พฤ: 3,
  ศ: 4,
  ส: 5,
  อา: 6,
};

const DAY_KEY_TO_INDEX: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

function dayIndexFromToken(token: string): number | null {
  const t = token.trim();
  if (!t) return null;
  const full = DAY_NAME_TO_INDEX.find((d) => t.includes(d.match));
  if (full) return full.index;
  const stripped = t.replace(/[.\s]+/g, "");
  if (stripped in SHORT_DAY_TO_INDEX) return SHORT_DAY_TO_INDEX[stripped];
  return null;
}

/** index ของวันในสัปดาห์ (0 = จันทร์) จาก Date (ใช้เวลาท้องถิ่น) */
export function weekdayIndex(date: Date): number {
  const js = date.getDay(); // 0 = อาทิตย์
  return (js + 6) % 7;
}

/** "08:30" → 510 (นาทีนับจาก 00:00) */
export function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
}

/** ดึงเวลาทั้งหมดในข้อความ → ["08:00","17:00"] */
function extractTimes(text: string): string[] {
  const out: string[] = [];
  const re = /(\d{1,2})\s*[:.]\s*(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h > 24 || mm > 59) continue;
    out.push(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  return out;
}

/** "08:00 - 17:00" → [{open,close}] · "24 ชม." → [{open:"00:00",close:"24:00"}] */
function parseRangeText(text: string): DayRange[] | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (/24\s*ชม|ตลอด\s*24|open\s*24/i.test(t)) {
    return [{ open: "00:00", close: "24:00" }];
  }
  if (/ปิด|closed/i.test(t)) return [];
  const times = extractTimes(t);
  if (times.length < 2) return null;
  return [{ open: times[0], close: times[times.length - 1] }];
}

/**
 * แตกช่วงวันในวงเล็บ เช่น "(จ.-ศ.)" → [0,1,2,3,4]
 * รองรับช่วงที่หลุดสัปดาห์ เช่น "(ส.-อา.)" → [5,6]
 */
function expandDayRange(text: string): number[] {
  const out: number[] = [];
  const items = text
    .split(/[,&\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const item of items) {
    if (/[-–—]/.test(item)) {
      const parts = item.split(/[-–—]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length !== 2) continue;
      const start = dayIndexFromToken(parts[0]);
      const end = dayIndexFromToken(parts[1]);
      if (start == null || end == null) continue;
      // เดินหน้าตามลำดับจันทร์→อาทิตย์ (wrap around)
      for (let i = 0; i < 7; i++) {
        const idx = (start + i) % 7;
        out.push(idx);
        if (idx === end) break;
      }
      continue;
    }
    const single = dayIndexFromToken(item);
    if (single != null) out.push(single);
  }
  return Array.from(new Set(out));
}

/**
 * วันที่ร้านปิด (จาก "วันหยุดร้าน: …") → รายการ index ที่ปิด
 * ความหมายเหมือนฝั่งแอป (`parseClosedSegmentText` ใน src/lib/businessProfile.ts):
 * - "เปิดทุกวัน" = เปิดทุกวัน → **ไม่มีวันปิดเลย**
 * - นอกเหนือจากนั้น = ชื่อวันที่เขียนไว้คือวันที่ปิด
 */
function parseClosedDays(text: string): { allDays: boolean; days: number[] } {
  if (/เปิดทุกวัน|เปิดตลอด/.test(text)) {
    return { allDays: true, days: [] };
  }
  const days: number[] = [];
  for (const d of DAY_NAME_TO_INDEX) {
    if (text.includes(d.match) && !days.includes(d.index)) days.push(d.index);
  }
  // ตัวย่อไทยที่ไม่ซ้ำกับชื่อเต็ม
  for (const [short, index] of Object.entries(SHORT_DAY_TO_INDEX)) {
    if (text.includes(short) && !days.includes(index)) days.push(index);
  }
  return { allDays: false, days };
}

/**
 * แปลงข้อความเวลาเปิดอิสระ → ชั่วโมงรายวัน
 * รองรับ 2 รูปแบบ:
 * - รูปแบบป้ายกำกับ: "วันธรรมดา (จ.-ศ.): 08:00 - 17:00 | วันหยุดสุดสัปดาห์ (ส.-อา.): … | วันหยุดร้าน: เปิดทุกวัน"
 * - รูปแบบ Google:  "วันจันทร์: 08:00 – 17:00 | วันอังคาร: … | วันอาทิตย์: ปิดทำการ"
 */
export function parseFreeTextHours(
  raw: string | null | undefined
): StructuredHours | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const parts = text
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const byDay: Record<number, DayRange[]> = {};
  const closedDays = new Set<number>();
  let closedTouched = false;

  for (const part of parts) {
    // ── วันหยุดร้าน ──
    if (part.startsWith("วันหยุดร้าน")) {
      closedTouched = true;
      const after = part.slice("วันหยุดร้าน".length).replace(/^[:.\s]+/, "");
      const closed = parseClosedDays(after);
      // allDays = "เปิดทุกวัน" → ไม่มีวันปิด → ไม่ต้องแตะอะไร
      if (!closed.allDays) {
        closed.days.forEach((d) => closedDays.add(d));
      }
      continue;
    }

    // ── วันธรรมดา / วันหยุดสุดสัปดาห์ (มีหรือไม่มีวงเล็บกำกับ) ──
    if (part.startsWith("วันธรรมดา") || part.startsWith("วันปกติ")) {
      const colon = part.indexOf(":");
      if (colon === -1) continue;
      const label = part.slice(0, colon);
      const hours = part.slice(colon + 1).trim();
      const ranges = parseRangeText(hours);
      if (!ranges) continue;
      const paren = label.match(/\(([^)]*)\)/);
      const days = paren
        ? expandDayRange(paren[1])
        : [0, 1, 2, 3, 4]; // ไม่ระบุ = จ.-ศ.
      days.forEach((d) => {
        byDay[d] = ranges.map((r) => ({ ...r }));
      });
      continue;
    }
    if (part.startsWith("วันหยุดสุดสัปดาห์") || part.startsWith("วันหยุด")) {
      const colon = part.indexOf(":");
      if (colon === -1) continue;
      const label = part.slice(0, colon);
      const hours = part.slice(colon + 1).trim();
      const ranges = parseRangeText(hours);
      if (!ranges) continue;
      const paren = label.match(/\(([^)]*)\)/);
      const days = paren ? expandDayRange(paren[1]) : [5, 6];
      days.forEach((d) => {
        byDay[d] = ranges.map((r) => ({ ...r }));
      });
      continue;
    }

    // ── รูปแบบ Google: "วันจันทร์: …" ──
    const dayEntry = DAY_NAME_TO_INDEX.find(
      (d) => part.startsWith("วัน" + d.match) || part.startsWith(d.match)
    );
    if (dayEntry) {
      const colon = part.indexOf(":");
      const hours = colon === -1 ? "" : part.slice(colon + 1).trim();
      if (/ปิด|closed/i.test(hours)) {
        closedTouched = true;
        closedDays.add(dayEntry.index);
        continue;
      }
      const ranges = parseRangeText(hours);
      if (!ranges) continue;
      byDay[dayEntry.index] = ranges.map((r) => ({ ...r }));
      continue;
    }
    // เซ็กเมนต์ที่ไม่รู้จัก → ข้าม (ไม่เดา)
  }

  if (!Object.keys(byDay).length && !closedTouched) return null;

  // วันที่ปิดชัดเจน → [] (ปิดแน่นอน)
  closedDays.forEach((d) => {
    byDay[d] = [];
  });

  const out: StructuredHours = {};
  for (const [index, ranges] of Object.entries(byDay)) {
    const key = WEEKDAY_KEYS[Number(index)];
    if (key) out[key] = ranges;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * ตรวจว่าสถานที่เปิด ณ เวลาที่จะไปถึงหรือไม่
 * -------------------------------------------------------------
 * ไม่เดาเด็ดขาด — ถ้าไม่มีข้อมูลคืน "unknown"
 */
export function evaluateOpenHours(
  input: OpenHoursInput,
  at: Date
): OpenVerdict {
  const dayIndex = weekdayIndex(at);
  const dayKey = WEEKDAY_KEYS[dayIndex];
  const yesterdayKey = WEEKDAY_KEYS[(dayIndex + 6) % 7];
  const nowMinutes = at.getHours() * 60 + at.getMinutes();

  // 1) ข้อมูลเจ้าของ (JSONB)
  const host = input.businessHours;
  if (host && typeof host === "object" && Object.keys(host).length) {
    // ช่วงข้ามคืนของเมื่อวานยังท่วงถึงวันนี้อยู่ (เช่น ศ. 18:00 - ส. 02:00)
    const spill = overnightSpill(host[yesterdayKey], nowMinutes);
    if (spill) {
      return {
        status: "open",
        openFrom: spill.open,
        closeTo: spill.close,
        confidence: "host",
        note: "เปิดต่อเนื่องจากเมื่อวาน",
      };
    }
    const ranges = host[dayKey];
    if (ranges === undefined) {
      return {
        status: "unknown",
        confidence: "host",
        note: "เจ้าของยังไม่ได้ระบุเวลาเปิดของวันนี้",
      };
    }
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return {
        status: "closed",
        confidence: "host",
        note: "เจ้าของระบุว่าวันนี้ปิด",
      };
    }
    return verdictFromRanges(ranges, nowMinutes, "host");
  }

  // 2) ข้อความอิสระ
  const parsed = parseFreeTextHours(input.openingHours);
  if (parsed && Object.keys(parsed).length) {
    const spill = overnightSpill(parsed[yesterdayKey], nowMinutes);
    if (spill) {
      return {
        status: "open",
        openFrom: spill.open,
        closeTo: spill.close,
        confidence: "google",
        note: "เปิดต่อเนื่องจากเมื่อวาน",
      };
    }
    const ranges = parsed[dayKey];
    if (ranges === undefined) {
      return {
        status: "unknown",
        confidence: "google",
        note: "ไม่พบข้อมูลเวลาเปิดของวันนี้",
      };
    }
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return {
        status: "closed",
        confidence: "google",
        note: "ข้อมูลเวลาเปิดระบุว่าวันนี้ปิด",
      };
    }
    return verdictFromRanges(ranges, nowMinutes, "google");
  }

  // 3) ไม่มีข้อมูล
  return {
    status: "unknown",
    confidence: "unknown",
    note: "ยังไม่มีข้อมูลเวลาเปิด",
  };
}

/**
 * ช่วงข้ามคืนของ "เมื่อวาน" ที่ยังท่วงถึงตอนนี้อยู่หรือไม่
 * (เช่น ศ. 18:00 - 02:00 → ส. 01:00 ยังเปิดอยู่)
 */
function overnightSpill(
  ranges: DayRange[] | undefined,
  nowMinutes: number
): DayRange | null {
  if (!Array.isArray(ranges)) return null;
  for (const r of ranges) {
    const open = minutesOf(r.open);
    const close = minutesOf(r.close);
    if (open == null || close == null) continue;
    if (r.close === "24:00") continue;
    if (close < open && nowMinutes < close) return r;
  }
  return null;
}

/** ตัดสินจากช่วงเวลาของวันนั้น */
function verdictFromRanges(
  ranges: DayRange[],
  nowMinutes: number,
  confidence: "host" | "google"
): OpenVerdict {
  // หา range ที่ตรงกับเวลาปัจจุบัน (รองรับช่วงข้ามคืน เช่น 18:00-02:00)
  for (const r of ranges) {
    const open = minutesOf(r.open);
    const close = minutesOf(r.close);
    if (open == null || close == null) continue;
    const closeValue = r.close === "24:00" ? 24 * 60 : close;
    if (closeValue >= open) {
      if (nowMinutes >= open && nowMinutes < closeValue) {
        return {
          status: "open",
          openFrom: r.open,
          closeTo: r.close,
          confidence,
        };
      }
    } else {
      // ข้ามคืน: เปิดตั้งแต่ open ของวันนี้ (ส่วนหลังเที่ยงคืนอยู่ใน overnightSpill)
      if (nowMinutes >= open) {
        return {
          status: "open",
          openFrom: r.open,
          closeTo: r.close,
          confidence,
        };
      }
    }
  }

  // ไม่เปิด → บอกว่าเปิดเมื่อไหร่ (ถ้าวันนี้มีข้อมูล) หรือปิดแล้ว
  const first = ranges[0];
  const firstOpen = first ? minutesOf(first.open) : null;
  if (firstOpen != null && nowMinutes < firstOpen) {
    return {
      status: "closed",
      openFrom: first.open,
      closeTo: first.close,
      confidence,
      note: `ยังไม่เปิด — เปิด ${first.open} น.`,
    };
  }
  const last = ranges[ranges.length - 1];
  const lastClose = last ? minutesOf(last.close) : null;
  return {
    status: "closed",
    openFrom: first?.open,
    closeTo: last?.close,
    confidence,
    note:
      lastClose != null
        ? `ปิดแล้ว — ปิด ${last?.close} น.`
        : "ปิดในเวลาที่มาถึง",
  };
}

/** ข้อความอธิบายสถานะ 1 บรรทัด (สำหรับส่งให้ LLM) */
export function describeVerdict(v: OpenVerdict): string {
  if (v.status === "unknown") return "ไม่ทราบเวลาเปิด";
  if (v.status === "closed") {
    const range =
      v.openFrom && v.closeTo ? ` (${v.openFrom}-${v.closeTo})` : "";
    return `ปิด${range}${v.note ? ` — ${v.note}` : ""}`;
  }
  const who =
    v.confidence === "host" ? "ข้อมูลจากเจ้าของ" : "ข้อมูลจาก Google";
  return `เปิด ${v.openFrom ?? "?"}-${v.closeTo ?? "?"} (${who})`;
}

/** สำหรับเทสต์: ล้าง state (ไม่มี state แต่คง signature ให้เทสต์เรียกได้) */
export function __openHoursReset(): void {}
