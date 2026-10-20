/**
 * Business-profile helpers shared by the community registration wizard
 * (OnboardingScreen) and the "แก้ไขร้าน" modal (ProfileLocal).
 *
 * These were previously defined inside ProfileLocal.tsx. The wizard had no way
 * to reach them, so `bizType` stayed on its "homestay" default no matter what
 * Google said about the place. They live here now so both screens — and any
 * future one — read the same rules.
 *
 * Everything in this file is pure: no React, no Supabase. Given the same
 * input it always returns the same output, which is what makes it safe to use
 * while auto-filling a form.
 */

export type BizType = "homestay" | "activity" | "cafe" | "custom";

/** Single-letter keys used to store closed days in the DB string. */
export const DAYS_OF_WEEK = [
  { key: "จ", label: "จ." },
  { key: "อ", label: "อ." },
  { key: "พ", label: "พ." },
  { key: "พฤ", label: "พฤ." },
  { key: "ศ", label: "ศ." },
  { key: "ส", label: "ส." },
  { key: "อา", label: "อา." },
];

export const BIZ_TYPE_OPTIONS: { id: BizType; label: string }[] = [
  { id: "homestay", label: "🏡 โฮมสเตย์ / ที่พัก" },
  { id: "activity", label: "🎨 กิจกรรม / ท่องเที่ยว" },
  { id: "cafe", label: "☕ ร้านค้า / คาเฟ่" },
  { id: "custom", label: "⚙️ กำหนดเอง" },
];

/**
 * Price units offered as chips. `custom` is not a real unit — it reveals a text
 * box whose content is stored as `/ <whatever the host typed>`.
 *
 * `/ บริการ` is the default for the "กำหนดเอง" business type, so it has to be a
 * selectable chip too or nothing would light up when a host picks that type.
 */
export const PRICE_UNITS = [
  { id: "/ คืน", label: "/ คืน" },
  { id: "/ ท่าน", label: "/ ท่าน" },
  { id: "/ เมนู", label: "/ เมนู" },
  { id: "/ บริการ", label: "/ บริการ" },
  { id: "custom", label: "กำหนดเอง" },
] as const;

// Google is asked for Thai, but it falls back to English when the place has no
// Thai translations — keep both so a missing language never silently drops the
// hours. Full names only: "Sat"/"Sun" would collide with "Saturday"/"Sunday".
const DAY_NAME_TO_KEY: { match: string; key: string }[] = [
  { match: "จันทร์", key: "จ" },
  { match: "อังคาร", key: "อ" },
  { match: "พุธ", key: "พ" },
  { match: "พฤหัส", key: "พฤ" },
  { match: "ศุกร์", key: "ศ" },
  { match: "เสาร์", key: "ส" },
  { match: "อาทิตย์", key: "อา" },
  { match: "Monday", key: "จ" },
  { match: "Tuesday", key: "อ" },
  { match: "Wednesday", key: "พ" },
  { match: "Thursday", key: "พฤ" },
  { match: "Friday", key: "ศ" },
  { match: "Saturday", key: "ส" },
  { match: "Sunday", key: "อา" },
];

/** Full Thai weekday names, keyed by the single-letter day key used in the DB string. */
export const KEY_TO_DAY_NAME: Record<string, string> = {
  จ: "วันจันทร์",
  อ: "วันอังคาร",
  พ: "วันพุธ",
  พฤ: "วันพฤหัสบดี",
  ศ: "วันศุกร์",
  ส: "วันเสาร์",
  อา: "วันอาทิตย์",
};

export interface BizDetectionResult {
  bizType: BizType;
  badgeLabel: string;
  icon: string;
  weekdayLabel: string;
  weekendLabel: string;
  priceUnit: string;
  defaultWeekdayHours: string;
  defaultWeekendHours: string;
}

const PROFILES: Record<BizType, BizDetectionResult> = {
  homestay: {
    bizType: "homestay",
    badgeLabel: "ที่พัก / โฮมสเตย์",
    icon: "🏡",
    weekdayLabel: "วันธรรมดา (อา.-พฤ.)",
    weekendLabel: "วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)",
    priceUnit: "/ คืน",
    defaultWeekdayHours: "เช็คอิน 14:00 / เช็คเอาท์ 11:00",
    defaultWeekendHours: "เช็คอิน 14:00 / เช็คเอาท์ 11:00",
  },
  cafe: {
    bizType: "cafe",
    badgeLabel: "ร้านค้า / คาเฟ่",
    icon: "☕",
    weekdayLabel: "วันธรรมดา (จ.-ศ.)",
    weekendLabel: "วันหยุดสุดสัปดาห์ (ส.-อา.)",
    priceUnit: "/ เมนู",
    defaultWeekdayHours: "08:30 - 17:00",
    defaultWeekendHours: "08:00 - 18:00",
  },
  activity: {
    bizType: "activity",
    badgeLabel: "กิจกรรม / ท่องเที่ยว",
    icon: "🎨",
    weekdayLabel: "วันธรรมดา (จ.-ศ.)",
    weekendLabel: "วันหยุดสุดสัปดาห์ (ส.-อา. & นักขัตฤกษ์)",
    priceUnit: "/ ท่าน",
    defaultWeekdayHours: "08:30 - 16:30",
    defaultWeekendHours: "08:30 - 17:00",
  },
  custom: {
    bizType: "custom",
    badgeLabel: "สถานประกอบการชุมชน",
    icon: "📍",
    weekdayLabel: "วันธรรมดา",
    weekendLabel: "วันหยุด / เทศกาล",
    priceUnit: "/ บริการ",
    defaultWeekdayHours: "08:30 - 17:00",
    defaultWeekendHours: "08:30 - 17:00",
  },
};

/**
 * Map a place to a business type.
 *
 * `primaryType` is Google's own single best-fit category ("lodging", "cafe",
 * …) — when it carries a category we recognise it decides the answer outright,
 * because `types[]` often also lists generic entries ("establishment",
 * "point_of_interest") that would otherwise drag the result the wrong way.
 * `types[]` is the fallback, and the Thai name regex is the last resort for
 * places Google has not categorised at all.
 */
export function detectBusinessProfile(
  types: string[] = [],
  name: string = "",
  primaryType?: string | null
): BizDetectionResult {
  const norm = (list: (string | null | undefined)[]) =>
    list.filter(Boolean).map((t) => String(t).toLowerCase());

  const has = (list: string[], values: string[]) => values.some((v) => list.includes(v));

  const LODGING = ["lodging", "hotel", "guest_house", "campground", "resort"];
  const FOOD = ["cafe", "coffee_shop", "food", "restaurant", "bakery", "bar"];
  const ACTIVITY = ["tourist_attraction", "park", "museum", "art_gallery", "place_of_worship"];

  const NAME_LODGING = /(โฮมสเตย์|ที่พัก|รีสอร์ท|รีสอร์ต|บ้านพัก|แคมป์|เกสต์เฮาส์|เต็นท์|พูลวิลล่า|hostel)/i;
  const NAME_FOOD = /(กาแฟ|คาเฟ่|อาหาร|ครัว|ชา|เบเกอรี่|ก๋วยเตี๋ยว|ส้มตำ|บาร์|ร้านข้าว)/i;
  const NAME_ACTIVITY = /(กิจกรรม|ท่องเที่ยว|สวน|ศูนย์เรียนรู้|ล่องแพ|เวิร์กช็อป|สวนผลไม้|วัด|นำเที่ยว|หัตถกรรม|ทอผ้า)/i;

  const lowerName = (name || "").toLowerCase();

  const fromGoogleTypes = (values: string[]): BizType | null =>
    has(LODGING, values) ? "homestay"
    : has(FOOD, values) ? "cafe"
    : has(ACTIVITY, values) ? "activity"
    : null;

  // 1. Google's own best-fit type, on its own.
  const primary = norm([primaryType]);
  const byPrimary = primary.length ? fromGoogleTypes(primary) : null;
  if (byPrimary) return PROFILES[byPrimary];

  // 2. The wider types[] list.
  const byTypes = fromGoogleTypes(norm(types));
  if (byTypes) return PROFILES[byTypes];

  // 3. Nothing categorical from Google — guess from the Thai name.
  if (NAME_LODGING.test(lowerName)) return PROFILES.homestay;
  if (NAME_FOOD.test(lowerName)) return PROFILES.cafe;
  if (NAME_ACTIVITY.test(lowerName)) return PROFILES.activity;

  return PROFILES.custom;
}

/** `"เปิดทุกวัน"` when nothing is closed, otherwise `"ปิดทุกวันจันทร์, วันอาทิตย์"`. */
export function formatClosedDaysStr(days: string[]): string {
  if (!days || days.length === 0) return "เปิดทุกวัน";
  return `ปิดทุก${days.map((d) => KEY_TO_DAY_NAME[d] || d).join(", ")}`;
}

export interface ParsedGoogleHours {
  /** Hours for จ.-ศ., e.g. "08:00 – 17:00". Empty when the whole group is closed. */
  weekdayHours: string;
  /** Hours for ส.-อา. */
  weekendHours: string;
  /** Keys of days Google lists as closed, e.g. ["อา"]. */
  closedDayKeys: string[];
  /** True when open days inside the weekday group don't share one schedule. */
  weekdayMixed: boolean;
  weekendMixed: boolean;
}

/**
 * Split Google's 7-line opening-hours text into the two schedules this app
 * stores.
 *
 * Input arrives from the backend already joined with " | ", one line per day,
 * e.g. `"วันจันทร์: 08:00 – 17:00 | … | วันอาทิตย์: ปิดทำการ"`.
 *
 * The previous version of this logic took the first open day and used it for
 * BOTH weekday and weekend — so a place open 08:00-17:00 on weekdays and
 * 08:30-18:00 at the weekend lost the weekend hours entirely. That's the bug
 * this replaces.
 *
 * Returns null when the string has no recognisable day, so callers can tell
 * "Google has no hours" apart from "Google says closed all week".
 */
export function parseOpeningHours(
  raw: string | null | undefined
): ParsedGoogleHours | null {
  if (!raw) return null;

  const byKey = new Map<string, string | null>();
  for (const segment of raw.split("|").map((p) => p.trim())) {
    if (!segment) continue;
    const colon = segment.indexOf(":");
    if (colon === -1) continue;

    const dayText = segment.slice(0, colon);
    const timeText = segment.slice(colon + 1).trim();
    const entry = DAY_NAME_TO_KEY.find((d) => dayText.includes(d.match));
    if (!entry) continue;

    const lowered = timeText.toLowerCase();
    const isClosed = timeText.startsWith("ปิด") || lowered.startsWith("closed");
    byKey.set(entry.key, isClosed ? null : timeText);
  }

  if (byKey.size === 0) return null;

  const weekdayKeys = ["จ", "อ", "พ", "พฤ", "ศ"];
  const weekendKeys = ["ส", "อา"];

  const group = (keys: string[]): { hours: string; mixed: boolean } => {
    const open = keys.map((k) => byKey.get(k)).filter((v): v is string => Boolean(v));
    if (open.length === 0) return { hours: "", mixed: false };
    return { hours: open[0], mixed: open.some((v) => v !== open[0]) };
  };

  const weekday = group(weekdayKeys);
  const weekend = group(weekendKeys);
  const closedDayKeys = DAYS_OF_WEEK.map((d) => d.key).filter(
    (k) => byKey.has(k) && !byKey.get(k)
  );

  return {
    weekdayHours: weekday.hours,
    weekendHours: weekend.hours,
    closedDayKeys,
    weekdayMixed: weekday.mixed,
    weekendMixed: weekend.mixed,
  };
}

/**
 * The labels, price unit and opening hours that belong to a business type.
 * Lets a caller react to a type change without re-deriving them by hand.
 */
export function profileFor(type: BizType): BizDetectionResult {
  return PROFILES[type] ?? PROFILES.custom;
}

export interface ParsedPrice {
  weekdayPrice: string;
  weekendPrice: string;
  /** Always a resolved unit like "/ คืน" — never the literal "custom". */
  unit: string;
}

/** A number, or a range: "500", "1,200", "50-150", "45.50". */
const PRICE_RE = /\d[\d,]*(?:\.\d+)?(?:\s*-\s*\d[\d,]*(?:\.\d+)?)?/;

/**
 * Units an older row may have spelled out that mean one of the preset chips.
 * "/ แก้ว" and "/ เมนู" are the same thing to a reader, but only one of them can
 * light a chip — without this the chip row would come up with nothing selected.
 */
const UNIT_SYNONYMS: Record<string, string> = {
  "เมนู": "/ เมนู",
  "แก้ว": "/ เมนู",
  "จาน": "/ เมนู",
  "ท่าน": "/ ท่าน",
  "คน": "/ ท่าน",
  "คืน": "/ คืน",
  "บริการ": "/ บริการ",
};

/**
 * Split the stored price back out of its Thai wrapper.
 *
 * Only one format is ever written now (see formatPriceStr), but rows saved
 * before this existed use `"วันธรรมดา (จ.-ศ.): 500 บาท"` — label, colon, price.
 * Both are accepted so nobody's existing data disappears; the colon case takes
 * everything after the colon so a digit inside a label can't be read as the
 * price.
 *
 * `||` separates a secondary service and is only ever written by the profile
 * editor, so it is cut off before the primary pair is parsed.
 *
 * Each half is matched on its label, not on its position: a host who only sets
 * a weekend price stores a single `"วันหยุด 750 …"` segment, and reading it
 * positionally would hand them back a weekday price they never entered.
 * Position is only the fallback for unlabelled rows.
 */
export function parsePriceStr(raw: string | null | undefined): ParsedPrice {
  const primary = (raw ?? "").split("||")[0];
  const parts = primary.split("|").map((p) => p.trim()).filter(Boolean);

  const priceOf = (segment?: string) => {
    if (!segment) return "";
    const tail = segment.includes(":") ? segment.slice(segment.indexOf(":") + 1) : segment;
    // A timespan is not a price. Without this guard the regex happily returns
    // the leading "08" of "08:30 - 17:00" and that gets stored as the price.
    if (/\d{1,2}\s*:\s*\d{2}/.test(tail)) return "";
    const hit = tail.match(PRICE_RE);
    return hit ? hit[0].replace(/\s+/g, "") : "";
  };

  // Once any segment is labelled, labels are authoritative for both halves —
  // otherwise a lone "วันหยุด 750 …" would satisfy both the label lookup and the
  // positional fallback. Unlabelled rows still fall back to position.
  const labelled = parts.some((s) => s.includes("วันธรรมดา") || s.includes("วันหยุด"));
  const weekdaySeg = labelled ? parts.find((s) => s.includes("วันธรรมดา")) : parts[0];
  const weekendSeg = labelled ? parts.find((s) => s.includes("วันหยุด")) : parts[1];

  return {
    weekdayPrice: priceOf(weekdaySeg),
    weekendPrice: priceOf(weekendSeg),
    unit: detectPriceUnit(primary),
  };
}

/** `/ คืน`, `/ เมนู`, or whatever a host typed for "กำหนดเอง". */
function detectPriceUnit(raw: string): string {
  const written = raw.match(/บาท\s*\/\s*([^\s|]+)/);
  if (written) {
    const word = written[1];
    return UNIT_SYNONYMS[word] ?? `/ ${word}`;
  }
  // Older rows stored the unit inside the label instead ("... 500 บาท / คืน").
  if (raw.includes("ท่าน")) return "/ ท่าน";
  if (raw.includes("เมนู") || raw.includes("แก้ว") || raw.includes("จาน")) return "/ เมนู";
  if (raw.includes("ชิ้น")) return "/ ชิ้น";
  return "/ คืน";
}

/** `"วันธรรมดา 500 บาท/ คืน | วันหยุด 750 บาท/ คืน"` — or "" when no price is set. */
export function formatPriceStr(
  weekdayPrice: string,
  weekendPrice: string,
  unit: string
): string {
  const u = (unit ?? "").trim();
  return [
    weekdayPrice?.trim() ? `วันธรรมดา ${weekdayPrice.trim()} บาท${u}` : "",
    weekendPrice?.trim() ? `วันหยุด ${weekendPrice.trim()} บาท${u}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * Which chip to light up for a stored unit, and what to prefill the custom
 * box with. A unit that isn't one of the presets (a host who typed "/ ชุด")
 * has to light up "กำหนดเอง" instead, or the chip row would show nothing
 * selected and re-saving would silently drop their unit.
 */
export function splitPriceUnit(unit: string): { chipId: string; customUnit: string } {
  const u = (unit ?? "").trim();
  if (PRICE_UNITS.some((x) => x.id === u)) return { chipId: u, customUnit: "" };
  return { chipId: "custom", customUnit: u.replace(/^\/\s*/, "") };
}

/** The chip id plus a free-text override, collapsed into the unit to store. */
export function resolvePriceUnit(chipId: string, customUnit: string): string {
  if (chipId !== "custom") return chipId;
  const typed = (customUnit ?? "").trim();
  return typed ? `/ ${typed}` : "";
}

// ============================================================
// Opening-hours helpers (added 2026-10-20 so both screens — the
// wizard and the "แก้ไขร้าน" modal — read and write opening
// hours through one path. Replaces the old parsePrimaryHoursStr
// in ProfileLocal that silently corrupted closed + weekend-only
// rows.)
// ============================================================

/** Monday-first ordering — required before any contiguity test. */
export const DAY_KEY_ORDER = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"] as const;

export interface HourRange {
  /** "08:00" or null when the input can't be read. */
  open: string | null;
  /** "17:00" or null. */
  close: string | null;
  /** True for "เปิด 24 ชม." style. */
  allDay: boolean;
  /**
   * The original text when the parser bailed (e.g. AM/PM). Empty when the
   * range came back structured. Callers should surface this so the host can
   * re-pick, rather than silently dropping user data.
   */
  raw: string;
}

// Match HH:mm in 24h form, e.g. "08:00", " 8:00 ", "08.00". Multi-occurrence
// (global) so the last match survives split shifts like "08:00 – 12:00, 13:00
// – 17:00" — close is the last time, not the second.
const TIME_RE = /(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)/g;
const AM_PM_RE = /\b(?:am|pm|a\.m\.|p\.m\.)\b/i;
const ALL_DAY_RE = /(?:เปิด\s*)?24\s*ช(?:ม\.?|ั่วโมง)|เปิดตลอด|ตลอด\s*24/i;

/**
 * "08:00 - 17:00" → {open:"08:00", close:"17:00"}
 * "08:00 – 12:00, 13:00 – 17:00" → open=first, close=LAST (not second)
 * "เปิด 24 ชม." → {allDay:true, open:null, close:null}
 * "09:00 AM – 05:00 PM" → {open:null, close:null, raw:"09:00 AM – 05:00 PM"}
 *   — English 12h form is ambiguous (we can't tell 9am from 9pm), so we hand
 *   it back untouched rather than guessing.
 */
export function parseHourRange(raw: string | null | undefined): HourRange {
  if (!raw) return { open: null, close: null, allDay: false, raw: "" };
  const text = String(raw).trim();
  if (!text) return { open: null, close: null, allDay: false, raw: "" };
  if (AM_PM_RE.test(text)) {
    return { open: null, close: null, allDay: false, raw: text };
  }
  if (ALL_DAY_RE.test(text)) {
    return { open: null, close: null, allDay: true, raw: "" };
  }
  const matches: string[] = [];
  for (let m = TIME_RE.exec(text); m !== null; m = TIME_RE.exec(text)) {
    matches.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  if (matches.length < 2) {
    // A lone time — we can't tell if it's open, close, or just a stray digit.
    return { open: null, close: null, allDay: false, raw: text };
  }
  return { open: matches[0], close: matches[matches.length - 1], allDay: false, raw: "" };
}

/**
 * {open:"08:00", close:"17:00"}, "hours"   → "08:00 - 17:00"
 * {open:"14:00", close:"11:00"}, "checkin" → "เช็คอิน 14:00 / เช็คเอาท์ 11:00"
 * {allDay:true}, "hours"                    → "24 ชม."
 *
 * If `range.raw` is set (the parser couldn't reach the structured form), we
 * echo it back so the storage round-trip is byte-stable.
 */
export function formatHourRange(
  range:
    | { open: string | null; close: string | null; allDay?: boolean; raw?: string }
    | HourRange,
  kind: "hours" | "checkin"
): string {
  if (range.raw && String(range.raw).trim()) return String(range.raw).trim();
  if (range.allDay) return "24 ชม.";
  const open = range.open;
  const close = range.close;
  if (!open && !close) return "";
  if (kind === "hours") {
    if (open && close) return `${open} - ${close}`;
    return open ?? close ?? "";
  }
  // checkin
  return `เช็คอิน ${open ?? "—"} / เช็คเอาท์ ${close ?? "—"}`;
}

// ============================================================
// Day-group helpers — let the wizard store "วันธรรมดา (จ.-ศ.)"
// as an explicit day list picked from a checkbox, instead of
// asking the host to type the label from scratch.
// ============================================================

/** Order + dedupe a day array in Monday-first order. Garbage silently dropped. */
export function orderDays(days: string[]): string[] {
  if (!Array.isArray(days)) return [];
  const order = new Map<string, number>(
    (DAY_KEY_ORDER as unknown as readonly string[]).map((k, i) => [k, i])
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of days) {
    if (typeof d !== "string") continue;
    if (!order.has(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return out;
}

/**
 * Days form a single contiguous run through Monday-first, including the wrap
 * from index 6 (อา) back to 0 (จ). Used to decide whether to render
 * "จ.-ศ." or "(จ., พฤ.)". Operates on the days in INPUT order so a wrapping
 * run like ["อา","จ","อ","พ","พฤ"] (homestay default) still reads contiguous.
 */
export function isContiguousRun(days: string[]): boolean {
  if (!Array.isArray(days) || days.length < 2) return false;
  const order = DAY_KEY_ORDER as unknown as readonly string[];
  const indices = days.map((d) => order.indexOf(d));
  if (indices.some((i) => i === -1)) return false;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== (indices[i - 1] + 1) % 7) return false;
  }
  return true;
}

const KEY_TO_LABEL: Record<string, string> = Object.fromEntries(
  DAYS_OF_WEEK.map((d) => [d.key, d.label])
);
// Same data as DAY_NAME_TO_KEY but Thai-only — English day names never land
// inside a stored label, so we don't have to translate "Monday" inside "(...)
// here (parseStoredHours handles the Google-shape case separately).
const THAI_FULL_TO_KEY: { match: string; key: string }[] = DAY_NAME_TO_KEY.filter(
  (d) => !/^[A-Za-z]/.test(d.match)
);

/** Map a day-token to its single-letter key, or null if it isn't a day name. */
function dayKeyFromToken(tok: string): string | null {
  const t = tok.trim();
  if (!t) return null;
  const full = THAI_FULL_TO_KEY.find((d) => t.includes(d.match));
  if (full) return full.key;
  const stripped = t.replace(/[.\s]+/g, "");
  if (stripped && KEY_TO_LABEL[stripped]) return stripped;
  return null;
}

export interface DayGroupParseResult {
  /** In input order — preserved so an "อา.-พฤ." run still wraps through the week. */
  days: string[];
  note?: string;
}

/**
 * "วันธรรมดา (จ.-ศ.)"                       → {days:["จ","อ","พ","พฤ","ศ"]}
 * "วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)"  → {days:["ศ","ส"], note:"นักขัตฤกษ์"}
 * "วันธรรมดา"                              → null   // caller preserves the label as-is
 * "วันหยุด / เทศกาล"                        → null
 *
 * Tokens inside `(...)` are split on `[,&\s]+` so each item is either a range
 * ("จ.-ศ."), a singleton ("จ.", "พฤ."), or a note word ("นักขัตฤกษ์").
 * Ranges get filled Monday-first wraparound-forward so "อา.-พฤ." comes out
 * as [อา, จ, อ, พ, พฤ] — meaning Sun through Thu, not the four days from
 * the start of the week.
 */
export function parseDayGroupFromLabel(label: string): DayGroupParseResult | null {
  if (!label) return null;
  const open = label.indexOf("(");
  const close = label.lastIndexOf(")");
  if (open === -1 || close === -1 || close < open) return null;
  const inner = label.slice(open + 1, close).trim();
  if (!inner) return null;

  const items = inner
    .split(/[,&\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const days: string[] = [];
  const notePieces: string[] = [];
  const seen = new Set<string>();
  const order = DAY_KEY_ORDER as unknown as readonly string[];

  for (const item of items) {
    if (/[-–—]/.test(item)) {
      const parts = item.split(/[-–—]/).map((x) => x.trim()).filter(Boolean);
      if (parts.length !== 2) continue;
      const start = dayKeyFromToken(parts[0]);
      const end = dayKeyFromToken(parts[1]);
      if (!start || !end) continue;
      const sIdx = order.indexOf(start);
      const eIdx = order.indexOf(end);
      if (sIdx === -1 || eIdx === -1) continue;
      for (let i = 0; i < 7; i++) {
        const idx = (sIdx + i) % 7;
        const k = order[idx];
        if (k && !seen.has(k)) {
          seen.add(k);
          days.push(k);
        }
        if (idx === eIdx) break;
      }
    } else {
      const k = dayKeyFromToken(item);
      if (k) {
        if (!seen.has(k)) {
          seen.add(k);
          days.push(k);
        }
      } else {
        notePieces.push(item);
      }
    }
  }

  if (days.length === 0) return null;
  return { days, note: notePieces.length ? notePieces.join(" ").trim() : undefined };
}

/**
 * Render a stored day-group label. Days are taken in INPUT order (the caller
 * is responsible for putting a wrap-around run like [อา,จ,อ,พ,พฤ] in the
 * right order). Empty days means "no specific day list" — the prefix is
 * returned bare, possibly with a note.
 *
 * formatDayGroupLabel("วันธรรมดา", ["จ","อ","พ","พฤ","ศ"])           → "วันธรรมดา (จ.-ศ.)"
 * formatDayGroupLabel("วันธรรมดา", [])                              → "วันธรรมดา"
 * formatDayGroupLabel("วันธรรมดา", ["จ", "พฤ"])                     → "วันธรรมดา (จ., พฤ.)"
 * formatDayGroupLabel("วันหยุดสุดสัปดาห์", ["ศ","ส"], "นักขัตฤกษ์") → "วันหยุดสุดสัปดาห์ (ศ.-ส. & นักขัตฤกษ์)"
 */
export function formatDayGroupLabel(
  prefix: string,
  days: string[],
  note?: string | null
): string {
  const p = (prefix ?? "").trim();
  if (!days || days.length === 0) {
    if (note && String(note).trim()) return `${p} (${String(note).trim()})`;
    return p;
  }
  let inner: string;
  if (isContiguousRun(days)) {
    const startLabel = KEY_TO_LABEL[days[0]] ?? days[0];
    const endLabel = KEY_TO_LABEL[days[days.length - 1]] ?? days[days.length - 1];
    inner = `${startLabel}-${endLabel}`;
  } else {
    inner = days.map((k) => KEY_TO_LABEL[k] ?? k).join(", ");
  }
  if (note && String(note).trim()) inner = `${inner} & ${String(note).trim()}`;
  return `${p} (${inner})`;
}

// ============================================================
// Stored opening-hours string — replace the broken
// parsePrimaryHoursStr in ProfileLocal. Mirrors the pattern of
// parsePriceStr (cut "||", split "|", classify each segment by
// its label prefix, parse the value after the colon) so a single
// path serves both price and hours reads.
// ============================================================

export interface ParsedSegment {
  /** The label exactly as it appeared (e.g. "วันธรรมดา (จ.-ศ.)" or "จันทร์"). */
  label: string;
  /** "08:00 - 17:00" or "" when the value couldn't be read. */
  hours: string;
}

export interface ParsedStoredHours {
  /** Undefined when the input had no weekday segment at all — distinct from
   * an empty-hours weekday, so the writer can preserve "open 7 days". */
  weekday?: ParsedSegment;
  weekend?: ParsedSegment;
  closed: { isAllDays: boolean; dayKeys: string[] };
  /** True when the input contained text we couldn't classify (AM/PM, etc.). */
  hasUnknown: boolean;
  /** Original segments that didn't match any known prefix, so a re-save never
   * silently drops content the host typed before the format existed. */
  unknownSegments: string[];
}

function splitOnPipe(raw: string): string[] {
  const primary = (raw ?? "").split("||")[0];
  return primary.split("|").map((p) => p.trim()).filter(Boolean);
}

/** "label: value" → {label, hours}. Returns null when the segment has no colon. */
function splitLabelAndHours(part: string): ParsedSegment | null {
  const idx = part.indexOf(":");
  if (idx === -1) return null;
  const label = part.slice(0, idx).trim();
  const hours = part.slice(idx + 1).trim();
  if (!label) return null;
  return { label, hours };
}

function parseClosedSegmentText(text: string): { isAllDays: boolean; dayKeys: string[] } {
  // "เปิดทุกวัน" / "เปิดทุกวันอาทิตย์" mean open every day (the legacy reader
  // ignores any day-names inside such a string). Anything else scans for the
  // day-names Google returns.
  if (/เปิดทุกวัน|เปิดตลอด/.test(text)) {
    return { isAllDays: true, dayKeys: [] };
  }
  const dayKeys: string[] = [];
  for (const d of THAI_FULL_TO_KEY) {
    if (text.includes(d.match) && !dayKeys.includes(d.key)) dayKeys.push(d.key);
  }
  return { isAllDays: false, dayKeys };
}

const WEEKDAY_PREFIXES = ["วันธรรมดา", "วันปกติ"];
const WEEKEND_PREFIXES = ["วันหยุดสุดสัปดาห์"];

function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some((p) => text.startsWith(p));
}

const DAY_KEY_INDEX: Record<string, number> = Object.fromEntries(
  DAY_KEY_ORDER.map((k, i) => [k, i])
);

/**
 * Reads both label shape ("วันธรรมดา (จ.-ศ.): 08:00 - 17:00 | …") and Google
 * shape ("จันทร์: 08:00 – 17:00 | …") back into structured data.
 *
 * Bugs in the prior `parsePrimaryHoursStr` this replaces:
 *   A. A row with only a weekend segment ("วันหยุดสุดสัปดาห์ (ส.-อา.): …")
 *      had its hours copied into BOTH weekday and weekend — fixed by NOT
 *      falling back to parts[0] / parts[1] once any labelled segment is
 *      seen, the way `parsePriceStr` already does.
 *   B. A row with the closed segment BEFORE the weekend segment lost its
 *      weekend hours entirely — fixed by classifying each segment by its
 *      label prefix instead of scanning with `parts.find` and a guard that
 *      runs after the weekend lookup.
 */
export function parseStoredHours(raw: string | null | undefined): ParsedStoredHours {
  const out: ParsedStoredHours = {
    closed: { isAllDays: true, dayKeys: [] },
    hasUnknown: false,
    unknownSegments: [],
  };
  if (!raw) return out;

  const parts = splitOnPipe(raw);
  // True once any segment has contributed to closed.dayKeys — either an
  // explicit "วันหยุดร้าน:" segment or Google-shape "วันอาทิตย์: ปิดทำการ"
  // lines. Without this flag the default-after-empty reset below would wipe
  // closed days that came from Google-shape input.
  let closedTouched = false;

  for (const part of parts) {
    if (part.startsWith("วันหยุดร้าน")) {
      closedTouched = true;
      const after = part.slice("วันหยุดร้าน".length).replace(/^[:.\s]+/, "");
      out.closed = parseClosedSegmentText(after);
      continue;
    }
    if (startsWithAny(part, WEEKDAY_PREFIXES)) {
      const seg = splitLabelAndHours(part);
      if (seg) out.weekday = seg;
      continue;
    }
    if (startsWithAny(part, WEEKEND_PREFIXES)) {
      const seg = splitLabelAndHours(part);
      if (seg) out.weekend = seg;
      continue;
    }
    if (part.startsWith("วันหยุด")) {
      // Bare "วันหยุด" without "สุดสัปดาห์" or "ร้าน" — treat as a weekend
      // segment so an older row still reads. The closed branch above
      // (วันหยุดร้าน) runs first and would have already handled anything
      // starting with the longer prefix.
      const seg = splitLabelAndHours(part);
      if (seg) out.weekend = seg;
      continue;
    }
    // Google-shape: segment starts with a Thai full day name, optionally
    // preceded by "วัน" ("วันจันทร์: 08:00 – 17:00" is the canonical shape the
    // backend joins with " | ").
    const googleDay = THAI_FULL_TO_KEY.find(
      (d) => part.startsWith("วัน" + d.match) || part.startsWith(d.match)
    );
    if (googleDay) {
      const timeText = part.includes(":")
        ? part.slice(part.indexOf(":") + 1).trim()
        : "";
      const lower = timeText.toLowerCase();
      const isClosed =
        timeText.startsWith("ปิด") || lower.startsWith("closed");
      if (isClosed) {
        closedTouched = true;
        if (!out.closed.dayKeys.includes(googleDay.key)) {
          out.closed.dayKeys.push(googleDay.key);
          out.closed.isAllDays = false;
        }
        continue;
      }
      const idx = DAY_KEY_INDEX[googleDay.key];
      const isWeekend = idx !== undefined && idx >= 5; // ส, อา
      if (isWeekend) {
        if (!out.weekend) out.weekend = { label: googleDay.match, hours: timeText };
      } else if (!out.weekday) {
        out.weekday = { label: googleDay.match, hours: timeText };
      }
      continue;
    }
    out.hasUnknown = true;
    out.unknownSegments.push(part);
  }

  if (!closedTouched) {
    // No closed segment in the input — default to open every day. The
    // canonical writer always emits one anyway, so a re-save just
    // standardises the row.
    out.closed = { isAllDays: true, dayKeys: [] };
  }

  return out;
}

/**
 * Inverse of `parseStoredHours`. Always emits a "วันหยุดร้าน" segment so the
 * stored string is the canonical 3-part pipe-delimited shape; the consumed
 * UI can rely on every row having one.
 *
 * Round-trip note: `formatStoredHours(parseStoredHours(x))` is byte-equal
 * to x for every shape `x` the writer has historically produced; for Google
 * shape it normalises the day grouping back to a canonical Thai label.
 */
export function formatStoredHours(p: ParsedStoredHours): string {
  const segments: string[] = [];
  if (p.weekday && (p.weekday.label || p.weekday.hours)) {
    segments.push(
      `${p.weekday.label || "วันธรรมดา"}: ${p.weekday.hours || ""}`.trimEnd()
    );
  }
  if (p.weekend && (p.weekend.label || p.weekend.hours)) {
    segments.push(
      `${p.weekend.label || "วันหยุดสุดสัปดาห์"}: ${p.weekend.hours || ""}`.trimEnd()
    );
  }
  const closedLine = p.closed.isAllDays
    ? "วันหยุดร้าน: เปิดทุกวัน"
    : `วันหยุดร้าน: ${formatClosedDaysStr(p.closed.dayKeys)}`;
  segments.push(closedLine);
  return segments.join(" | ");
}

// ============================================================
// Structured (JSONB) form — what the AI reads as ground truth.
//
// The editor still collects hours through the two day-groups
// above; these helpers expand that into one key per weekday so
// "เปิด 08:00-17:00 จ.-ศ., ปิดวันอาทิตย์" is machine-readable
// instead of a sentence the model has to re-parse every prompt.
// The TEXT columns stay authoritative for the UI — these are a
// derived, additive copy.
// ============================================================

/** Storage key per weekday. English, because the AI reads the prompt. */
export const DAY_KEY_TO_JSON_KEY: Record<string, string> = {
  จ: "mon",
  อ: "tue",
  พ: "wed",
  พฤ: "thu",
  ศ: "fri",
  ส: "sat",
  อา: "sun",
};

export interface DayRange {
  /** "08:00" */
  open: string;
  /** "17:00" */
  close: string;
}

export type StructuredHours = Record<string, DayRange[]>;

/**
 * Turn a parsed range into the stored array.
 *
 * "เปิด 24 ชม." has no clock times but IS open all day — writing `[]`
 * there would read as "closed", so it's stored as the full 00:00-24:00
 * span and the AI can say "เปิดตลอด" from the numbers.
 *
 * Returns null when there's no usable range, so the caller can omit the
 * day rather than claim it is closed.
 */
function rangesFrom(parsed: HourRange): DayRange[] | null {
  if (parsed.allDay) return [{ open: "00:00", close: "24:00" }];
  if (parsed.open && parsed.close) return [{ open: parsed.open, close: parsed.close }];
  return null;
}

export interface ComposeHoursInput {
  /** Day keys sharing the weekday schedule, e.g. ["จ","อ","พ","พฤ","ศ"]. */
  weekdayDays: string[];
  /** Raw text the host picked in the sheet, e.g. "08:30 - 17:00". */
  weekdayHours: string | null;
  weekendDays: string[];
  weekendHours: string | null;
  /** Day keys explicitly ticked as "วันหยุดร้าน". */
  dayOffs: string[];
}

/**
 * Expand the two day-groups + the day-off list into one entry per weekday.
 *
 * Three outcomes per day, deliberately distinct:
 *   • ticked as a day off      → `[]`                     (definitely closed)
 *   • in a group with hours    → `[{open, close}]`        (definitely open)
 *   • in a group with unusable text, or in no group at all → key omitted
 *
 * The third case is the one worth being careful about: `parseHourRange`
 * refuses English 12-hour input ("09:00 AM – 05:00 PM") because it can't
 * tell 9am from 9pm. Writing `[]` for those days would have the AI tell
 * tourists the shop is shut on a day it's open all week — worse than
 * saying nothing, since the prompt already tells it to flag unconfirmed
 * data. The host's exact wording still survives in the TEXT column.
 *
 * Returns null when nothing at all was specified, so the caller stores SQL
 * NULL rather than an object of seven empty arrays.
 */
export function composeHoursJson(input: ComposeHoursInput): StructuredHours | null {
  const weekdayRanges = rangesFrom(parseHourRange(input.weekdayHours));
  const weekendRanges = rangesFrom(parseHourRange(input.weekendHours));
  const off = new Set(input.dayOffs ?? []);

  const out: StructuredHours = {};
  let touched = false;
  for (const dayKey of DAY_KEY_ORDER as unknown as readonly string[]) {
    const jsonKey = DAY_KEY_TO_JSON_KEY[dayKey];
    if (!jsonKey) continue;
    if (off.has(dayKey)) {
      out[jsonKey] = [];
      touched = true;
      continue;
    }
    if ((input.weekdayDays ?? []).includes(dayKey)) {
      const ranges = weekdayRanges ? weekdayRanges.map((r) => ({ ...r })) : null;
      if (ranges) {
        out[jsonKey] = ranges;
        touched = true;
      }
      continue;
    }
    if ((input.weekendDays ?? []).includes(dayKey)) {
      const ranges = weekendRanges ? weekendRanges.map((r) => ({ ...r })) : null;
      if (ranges) {
        out[jsonKey] = ranges;
        touched = true;
      }
    }
  }
  return touched ? out : null;
}

export interface PriceTier {
  /**
   * Kept as the host typed it — "500", "1,200", "50-150". Parsing to a number
   * would destroy the range case, which is common enough in practice that
   * the AI should see "50-150" rather than pick one end.
   */
  amount: string;
  currency: string;
}

export interface StructuredPricing {
  weekday: PriceTier | null;
  weekend: PriceTier | null;
  /** "/ คืน", "/ ท่าน", … or null when the host left it blank. */
  unit: string | null;
  /** A second business on the same property, e.g. the café inside a homestay. */
  secondary: { label: string; amount: string; unit: string } | null;
}

/**
 * Structured counterpart to formatPriceStr. A missing price becomes `null`
 * rather than `{amount:""}`, so the AI can tell "not set" from "free".
 */
export function composePricingJson(
  weekdayPrice: string,
  weekendPrice: string,
  unit: string,
  secondary?: { label: string; amount: string; unit: string } | null
): StructuredPricing {
  const tier = (raw: string): PriceTier | null => {
    const amount = (raw ?? "").trim();
    return amount ? { amount, currency: "THB" } : null;
  };
  return {
    weekday: tier(weekdayPrice),
    weekend: tier(weekendPrice),
    unit: (unit ?? "").trim() || null,
    secondary: secondary ?? null,
  };
}