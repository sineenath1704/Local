/**
 * ราคาน้ำมันสดจากเว็บ (real-time)
 * -------------------------------------------------------------
 * ทำไมต้องดึงเองที่ backend
 * - โมเดลของเรา (minimax-m3 ผ่าน Anthropic-compatible proxy) ยิงแบบไม่มี `tools`
 *   → ใช้ web_search ไม่ได้ → ถ้าไม่ส่งราคาเข้าไป โมเดลจะเดาราคาเอง
 *   (เคยฝังค่าผิดไว้ 32 ฿/ลิตร ทั้งที่ราคาจริงคือ 41.54)
 *
 * แหล่งข้อมูล: PTT Oil Station (https://www.pttor.com/)
 * - ราคาถูก render ฝั่งเซิร์ฟเวอร์ → ไม่ต้องรัน JS
 * - โครงสร้าง:
 *     <div class="oil-item">
 *       <picture>…<img … alt="Gasohol 95" …></picture>
 *       <div class="oil-price">41.54</div>
 *     </div>
 * - วันที่ราคามีผลบังคับใช้ เขียนไว้ในหัวข้อ "ปรับราคาเมื่อวันที่ …"
 *
 * แหล่งที่ตัดทิ้ง (ใช้ไม่ได้จริง):
 * - eppo.go.th → ค่า placeholder 30.00 ทั้ง 153 ช่อง (JS เป็นคนเติม)
 * - bangchak.co.th/en/OilPrice → JS-rendered มีแต่ shell 15 KB ไม่มีตัวเลข
 *
 * แคป "รายวัน" (ไม่ใช่รายชั่วโมง)
 * -------------------------------------------------------------
 * ราคาน้ำมันเปลี่ยนทุกวัน (เว็บประกาศวันที่มีผลบังคับใช้) → ดึงวันละครั้งพอ
 * วันที่นับเป็น **เวลาไทย** (Asia/Bangkok) เพื่อให้ "วันนี้" ตรงกับที่ผู้ใช้เห็น
 *
 * ลำดับการหา:
 *   memory ของวันนี้ → Supabase ของวันนี้ → ดึงจากเว็บ → บันทึกกลับ (Supabase + memory)
 *
 * ถ้าดึงราคาวันนี้ไม่สำเร็จ:
 *   · มี cache ของวันก่อน → ใช้ค่านั้น + ติดป้าย `isStale` (ห้ามโชว์เป็น "ราคาวันนี้"
 *     และห้ามเขียนค่าเก่าลง cache ของวันนี้)
 *   · ไม่มี cache เลย → ค่าสำรองในโค้ด (`isEstimate: true`) + หน่วงซ้ำ 15 นาทีก่อนลองใหม่
 */

import type { FuelType } from "./vehicles";
import {
  readFuelPriceCache,
  readLatestFuelPriceCache,
  writeFuelPriceCache,
  type FuelPriceCacheRow,
} from "./fuelPriceStore";

const SOURCE_URL = "https://www.pttor.com/";
const FETCH_TIMEOUT_MS = 5000;
/** หน่วงการยิงซ้ำเมื่อใช้ค่าสำรอง (ไม่มี cache เลย) — 15 นาที */
const FALLBACK_RETRY_MS = 15 * 60 * 1000;
const USER_AGENT =
  process.env.FUEL_PRICE_USER_AGENT?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** alt ของภาพบนเว็บ → key ของเรา */
const ALT_TO_FUEL_TYPE: Record<string, FuelType> = {
  "gasohol 95": "gasohol95",
  "gasohol 91": "gasohol91",
  "gasohol e20": "gasoholE20",
  "diesel b20": "dieselB20",
  diesel: "diesel",
  "premium diesel": "premiumDiesel",
  "super power gsh95": "gsh95",
  "super power x99": "x99",
  "gasoline 95": "gasoline95",
};

/**
 * ค่าสำรอง — ใช้เมื่อดึงเว็บไม่สำเร็จ
 * (ค่าที่ probe ได้จริงเมื่อ 4 พ.ย. 2026 · ราคามีผล 29 ต.ค. 2569)
 * ต้องติดป้าย "ประมาณการ" เสมอเมื่อใช้ค่านี้
 */
export const FALLBACK_FUEL_PRICES: Record<string, number> = {
  gasohol95: 41.54,
  gasohol91: 41.17,
  gasoholE20: 33.5,
  dieselB20: 33.5,
  diesel: 42.54,
  premiumDiesel: 49.05,
  gsh95: 47.05,
  x99: 49.05,
  gasoline95: 51.03,
};

export const FALLBACK_EFFECTIVE_DATE = "29 ต.ค. 2569";

export type FuelPriceSource = "pttor.com" | "cache" | "fallback";

export interface FuelPriceTable {
  /** ราคาต่อลิตร ของแต่ละชนิด (null = ยังไม่มีข้อมูล) */
  prices: Partial<Record<FuelType, number>>;
  /** เวลาที่ดึงข้อมูล (ISO) */
  fetchedAt: string;
  /** วันที่ราคามีผลบังคับใช้ (ข้อความที่เว็บเขียนไว้) */
  effectiveDate: string;
  /** วันที่รูปแบบอื่นที่เว็บเขียนไว้ (เช่น "4 November 2026") — เก็บไว้ให้ผู้ใช้ดูด้วย */
  effectiveDateAlt?: string;
  /** วิธีที่ได้ตัวเลขนี้มาในครั้งนี้ */
  source: FuelPriceSource;
  /** ตัวเลขนี้มาจากเว็บจริงหรือจากค่าสำรองในโค้ด */
  origin: "pttor.com" | "fallback";
  /** true = ใช้ค่าสำรองในโค้ด (ยังไม่ใช่ราคาสด) */
  isEstimate: boolean;
  /** URL ที่ดึงมา */
  url: string;
  /** วันไทยที่ราคานี้เป็นของ ("YYYY-MM-DD") — null = ไม่มี cache (ค่าสำรอง) */
  cacheDate?: string | null;
  /** true = ดึงราคาวันนี้ไม่สำเร็จ ใช้ค่าของวันก่อนมาแทน */
  isStale?: boolean;
  /** ข้อความแจ้งผู้ใช้ว่าเป็นข้อมูลเก่า */
  staleNotice?: string | null;
  /** วันไทยวันนี้ (ที่ backend ใช้ตัดสินว่า cache หมดอายุหรือยัง) */
  bangkokDate?: string | null;
}

export interface ResolvedFuelPrice {
  fuelType: FuelType;
  pricePerLitre: number | null;
  /** "ผู้ใช้ระบุเอง" | "pttor.com" | "ค่าสำรอง" */
  sourceLabel: string;
  effectiveDate?: string;
  fetchedAt?: string;
  isEstimate: boolean;
  /** true = ราคานี้เป็นข้อมูลของวันก่อน (ดึงวันนี้ไม่สำเร็จ) */
  isStale?: boolean;
  /** วันที่ของราคา (วันไทย) */
  cacheDate?: string;
}

/** ผลลัพธ์ที่ parse ได้จาก HTML */
export interface ParsedFuelHtml {
  prices: Partial<Record<FuelType, number>>;
  effectiveDate?: string;
  effectiveDateAlt?: string;
}

function normalizeAlt(alt: string): string {
  return alt
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^super\s*power\s*/i, "super power ")
    .trim();
}

/**
 * แยกราคาออกจาก HTML ของ pttor.com
 * - แตกทีละ `<div class="oil-item">` แล้วเอา alt ของภาพ + ตัวเลขใน oil-price
 * - วันที่มีผล: หัวข้อ "ปรับราคาเมื่อวันที่ …" (เว็บมี 2 ชุด คนละ responsive)
 */
export function parseFuelPricesFromHtml(html: string): ParsedFuelHtml {
  const out: ParsedFuelHtml = { prices: {} };
  if (!html || typeof html !== "string") return out;

  const blocks = html.split('<div class="oil-item">');
  for (const block of blocks.slice(1)) {
    const altMatch = block.match(/<img[^>]*\balt="([^"]*)"/i);
    const priceMatch = block.match(
      /<div class="oil-price">\s*([0-9]+(?:[.,][0-9]+)?)\s*<\/div>/i
    );
    if (!altMatch || !priceMatch) continue;
    const key = ALT_TO_FUEL_TYPE[normalizeAlt(altMatch[1])];
    if (!key) continue;
    const value = Number(priceMatch[1].replace(",", ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    // ราคาแรกที่เจอคือค่าที่ใช้จริง (หน้าเว็บอาจมีหลายชุดสำหรับ responsive)
    if (out.prices[key] === undefined) out.prices[key] = value;
  }

  // วันที่ราคามีผลบังคับใช้
  const dates = Array.from(
    html.matchAll(/ปรับราคาเมื่อวันที่\s*([^<]{3,40})/g)
  )
    .map((m) => m[1].trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(dates));
  if (uniq.length) {
    // เว็บเขียนวันที่ไทย (พ.ศ.) ไว้ในชุดหลัก → ใช้เป็นหลัก
    const thai = uniq.find((d) => /\d{4}/.test(d) && !/[A-Za-z]{4}/.test(d));
    const english = uniq.find((d) => /[A-Za-z]{4}/.test(d));
    out.effectiveDate = thai ?? uniq[0];
    if (english && english !== out.effectiveDate) {
      out.effectiveDateAlt = english;
    }
  }

  return out;
}

// ── วันไทย ───────────────────────────────────────────────────────────────
/**
 * วันไทยวันนี้ในรูปแบบ "YYYY-MM-DD" (Asia/Bangkok)
 * → "วันนี้" ของ cache ตรงกับเวลาที่ผู้ใช้ไทยเห็นเสมอ
 */
export function bangkokDayKey(now: Date = new Date()): string {
  try {
    // en-CA → "YYYY-MM-DD" ตามท้องถิ่นของเขตเวลาที่ระบุ
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // เครื่องรันไม่มีข้อมูลเขตเวลา ICU → คิดจากเวลาท้องถิ่นแทน
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${mm}-${dd}`;
  }
}

// ── cache ────────────────────────────────────────────────────────────────
/** cache ใน memory ของ process นี้ (วันไทย → ตารางราคา) */
const memoryCache = new Map<string, FuelPriceTable>();
let inflight: Promise<FuelPriceTable> | null = null;
/** หน่วงการยิงซ้ำหลังใช้ค่าสำรอง (ไม่มี cache เลย) */
let fallbackCooldownUntil = 0;

/** ใช้ตอนเทสต์: แทนที่ตัวยิงเว็บ */
let fetchImpl: (url: string) => Promise<string> = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "th,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

export function __setFuelPriceFetcher(fn: (url: string) => Promise<string>): void {
  fetchImpl = fn;
}

export function __clearFuelPriceCache(): void {
  memoryCache.clear();
  inflight = null;
  fallbackCooldownUntil = 0;
}

/** ใช้ตอนเทสต์: ใส่ราคาของวันที่ระบุลง cache (จำลอง cache ของวันก่อน) */
export function __seedFuelPriceCache(dayKey: string, table: FuelPriceTable): void {
  memoryCache.set(dayKey, { ...table, cacheDate: table.cacheDate ?? dayKey });
}

/** แถวของ Supabase → ตารางราคา */
function rowToTable(row: FuelPriceCacheRow): FuelPriceTable {
  const prices: Partial<Record<FuelType, number>> = {};
  for (const [k, v] of Object.entries(row.prices ?? {})) {
    prices[k as FuelType] = v;
  }
  return {
    prices,
    fetchedAt: row.fetched_at,
    effectiveDate: row.effective_date ?? FALLBACK_EFFECTIVE_DATE,
    effectiveDateAlt: row.effective_date_alt ?? undefined,
    source: "cache",
    origin: row.origin === "fallback" ? "fallback" : "pttor.com",
    isEstimate: row.is_estimate === true,
    url: row.url ?? SOURCE_URL,
    cacheDate: row.cache_date,
    isStale: false,
    staleNotice: null,
    bangkokDate: null,
  };
}

/** ตารางราคาของวันที่ระบุ (memory → Supabase) */
async function readTableForDay(dayKey: string): Promise<FuelPriceTable | null> {
  const inMemory = memoryCache.get(dayKey);
  if (inMemory) return inMemory;

  const row = await readFuelPriceCache(dayKey);
  if (!row) return null;
  const table = rowToTable(row);
  memoryCache.set(dayKey, table);
  return table;
}

/** ตารางราคาของวันก่อนที่สุดที่มี (memory → Supabase) */
async function readLatestOlderTable(
  beforeDayKey: string
): Promise<FuelPriceTable | null> {
  let bestDay: string | null = null;
  for (const day of memoryCache.keys()) {
    if (day >= beforeDayKey) continue;
    if (!bestDay || day > bestDay) bestDay = day;
  }
  if (bestDay) {
    const table = memoryCache.get(bestDay);
    if (table) return table;
  }

  const row = await readLatestFuelPriceCache(beforeDayKey);
  if (!row) return null;
  const table = rowToTable(row);
  memoryCache.set(row.cache_date, table);
  return table;
}

function fallbackTable(today: string): FuelPriceTable {
  const prices: Partial<Record<FuelType, number>> = {};
  for (const [k, v] of Object.entries(FALLBACK_FUEL_PRICES)) {
    prices[k as FuelType] = v;
  }
  return {
    prices,
    fetchedAt: new Date().toISOString(),
    effectiveDate: FALLBACK_EFFECTIVE_DATE,
    source: "fallback",
    origin: "fallback",
    isEstimate: true,
    url: SOURCE_URL,
    cacheDate: null,
    isStale: false,
    staleNotice: null,
    bangkokDate: today,
  };
}

/**
 * ดึงราคาน้ำมัน (แคปรายวันตามเวลาไทย)
 * - วันนี้มี cache → ใช้เลย (ไม่ยิงเว็บซ้ำ)
 * - ไม่มี cache → ดึงจากเว็บแล้วบันทึกกลับ (Supabase + memory)
 * - ดึงไม่สำเร็จ → ใช้ cache ของวันก่อน + ติดป้ายว่าเป็นข้อมูลเก่า
 *   หรือถ้าไม่มี cache เลย → ค่าสำรองในโค้ด + source:"fallback" + isEstimate:true
 *   → ระบบไม่ล้ม แต่ผู้ใช้ต้องเห็นว่าเป็นค่าประมาณ
 */
export async function fetchFuelPrices(
  opts?: { force?: boolean; now?: Date }
): Promise<FuelPriceTable> {
  const today = bangkokDayKey(opts?.now);

  if (!opts?.force) {
    const cachedToday = await readTableForDay(today);
    if (cachedToday) {
      return {
        ...cachedToday,
        source: cachedToday.origin === "fallback" ? "fallback" : "cache",
        isStale: false,
        staleNotice: null,
        bangkokDate: today,
      };
    }
  }
  if (inflight) return inflight;

  // เพิ่งล้มเหลวและไม่มี cache เลย → หยุดยิงซ้ำ 15 นาที (ไม่ต้องเครียดเว็บทุกคำขอ)
  // (ยังต้องเช็ค cache ของวันก่อนก่อน เพราะของเก่าดีกว่าค่าสำรองในโค้ด)
  if (!opts?.force && Date.now() < fallbackCooldownUntil) {
    return await useFallbackOrOlder(today, false);
  }

  inflight = (async (): Promise<FuelPriceTable> => {
    try {
      const html = await fetchImpl(SOURCE_URL);
      const parsed = parseFuelPricesFromHtml(html);
      const hasPrices = Object.keys(parsed.prices).length > 0;
      if (!hasPrices) {
        console.warn("[fuelPrice] ดึงราคาจากเว็บไม่ได้ → ใช้ค่าสำรอง");
        return await useFallbackOrOlder(today, true);
      }
      const table: FuelPriceTable = {
        prices: parsed.prices,
        fetchedAt: new Date().toISOString(),
        effectiveDate: parsed.effectiveDate ?? FALLBACK_EFFECTIVE_DATE,
        effectiveDateAlt: parsed.effectiveDateAlt,
        source: "pttor.com",
        origin: "pttor.com",
        isEstimate: false,
        url: SOURCE_URL,
        cacheDate: today,
        isStale: false,
        staleNotice: null,
        bangkokDate: today,
      };
      memoryCache.set(today, table);
      await writeFuelPriceCache({
        cache_date: today,
        prices: parsed.prices as Record<string, number>,
        effective_date: table.effectiveDate,
        effective_date_alt: parsed.effectiveDateAlt ?? null,
        source: "pttor.com",
        origin: "pttor.com",
        is_estimate: false,
        url: SOURCE_URL,
        fetched_at: table.fetchedAt,
      });
      return table;
    } catch (e: any) {
      console.warn("[fuelPrice] ดึงราคาไม่สำเร็จ:", e?.message ?? e);
      return await useFallbackOrOlder(today, true);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * ดึงไม่สำเร็จ → ใช้ cache ของวันก่อน (ติดป้ายว่าเก่า) หรือค่าสำรองในโค้ด
 * - **ห้าม**เขียนค่าเก่าลง cache ของวันนี้ (ไม่งั้น "ราคาวันนี้" จะเป็นของเมื่อวาน)
 * - `markCooldown` = true เฉพาะตอนที่ดึงเว็บล้มจริง (หยุดยิงซ้ำ 15 นาที)
 *   ตอนที่อยู่ในช่วงหยุดยิงซ้ำอยู่แล้ว ต้องไม่ขยายเวลาออกไปเรื่อย ๆ
 */
async function useFallbackOrOlder(
  today: string,
  markCooldown: boolean
): Promise<FuelPriceTable> {
  if (markCooldown) {
    fallbackCooldownUntil = Date.now() + FALLBACK_RETRY_MS;
  }
  const older = await readLatestOlderTable(today);
  if (older) {
    const cacheDate = older.cacheDate ?? null;
    const stale: FuelPriceTable = {
      ...older,
      source: older.origin === "fallback" ? "fallback" : "cache",
      isStale: true,
      staleNotice: `ดึงราคาวันนี้ไม่สำเร็จ — กำลังใช้ราคาของวันที่ ${
        cacheDate ?? "ก่อนหน้า"
      } (ข้อมูลเก่า)`,
      bangkokDate: today,
    };
    return stale;
  }

  // ไม่มี cache เลย → ค่าสำรองในโค้ด (หน่วงซ้ำถูกตั้งไว้แล้วข้างบน)
  return fallbackTable(today);
}

/**
 * เลือกราคาที่จะใช้จริง
 * ลำดับความน่าเชื่อถือ: ราคาที่ผู้ใช้พิมพ์เอง > ราคาสดจากเว็บ > ค่าสำรอง
 */
export function resolveFuelPrice(
  table: FuelPriceTable,
  fuelType: FuelType,
  override?: number | null
): ResolvedFuelPrice {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return {
      fuelType,
      pricePerLitre: override,
      sourceLabel: "ผู้ใช้ระบุเอง",
      isEstimate: false,
    };
  }
  const live = table.prices[fuelType];
  if (typeof live === "number" && Number.isFinite(live)) {
    return {
      fuelType,
      pricePerLitre: live,
      sourceLabel:
        table.origin === "fallback"
          ? "ค่าสำรอง"
          : table.isStale
          ? "pttor.com (ข้อมูลเก่า)"
          : "pttor.com",
      effectiveDate: table.effectiveDate,
      fetchedAt: table.fetchedAt,
      isEstimate: table.isEstimate,
      isStale: table.isStale === true,
      cacheDate: table.cacheDate ?? undefined,
    };
  }
  return {
    fuelType,
    pricePerLitre: null,
    sourceLabel: "ไม่มีข้อมูลราคา",
    isEstimate: true,
  };
}

/** ข้อความอธิบายที่มาของราคา (สำหรับแสดงในแอป) */
export function describeFuelPrice(p: ResolvedFuelPrice): string {
  if (p.pricePerLitre == null) return "ไม่ทราบราคาน้ำมัน";
  const base = `${p.pricePerLitre.toFixed(2)} ฿/ลิตร`;
  const parts = [base, p.sourceLabel];
  if (p.effectiveDate) parts.push(`มีผล ${p.effectiveDate}`);
  if (p.cacheDate) parts.push(`ข้อมูลวันที่ ${p.cacheDate}`);
  if (p.fetchedAt) {
    const d = new Date(p.fetchedAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        `ดึง ${d.toLocaleString("th-TH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Bangkok",
        })}`
      );
    }
  }
  if (p.isEstimate) parts.push("(ประมาณการ)");
  return parts.join(" · ");
}
