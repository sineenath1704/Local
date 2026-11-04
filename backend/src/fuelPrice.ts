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
 */

import type { FuelType } from "./vehicles";

const SOURCE_URL = "https://www.pttor.com/";
const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 ชั่วโมง
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
}

export interface ResolvedFuelPrice {
  fuelType: FuelType;
  pricePerLitre: number | null;
  /** "ผู้ใช้ระบุเอง" | "pttor.com" | "ค่าสำรอง" */
  sourceLabel: string;
  effectiveDate?: string;
  fetchedAt?: string;
  isEstimate: boolean;
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

// ── cache ────────────────────────────────────────────────────────────────
let cached: { at: number; table: FuelPriceTable } | null = null;
let inflight: Promise<FuelPriceTable> | null = null;

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
  cached = null;
  inflight = null;
}

function fallbackTable(): FuelPriceTable {
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
  };
}

/**
 * ดึงราคาน้ำมันสด
 * - แคป 3 ชั่วโมง (ไม่ยิงซ้ำทุกคำขอ)
 * - ดึงไม่สำเร็จ → คืนค่าสำรองในโค้ด พร้อม source:"fallback" + isEstimate:true
 *   → ระบบไม่ล้ม แต่ผู้ใช้ต้องเห็นว่าเป็นค่าประมาณ
 */
export async function fetchFuelPrices(
  opts?: { force?: boolean }
): Promise<FuelPriceTable> {
  const now = Date.now();
  if (!opts?.force && cached && now - cached.at < CACHE_TTL_MS) {
    return {
      ...cached.table,
      source: cached.table.origin === "fallback" ? "fallback" : "cache",
    };
  }
  if (inflight) return inflight;

  inflight = (async (): Promise<FuelPriceTable> => {
    try {
      const html = await fetchImpl(SOURCE_URL);
      const parsed = parseFuelPricesFromHtml(html);
      const hasPrices = Object.keys(parsed.prices).length > 0;
      if (!hasPrices) {
        console.warn("[fuelPrice] ดึงราคาจากเว็บไม่ได้ → ใช้ค่าสำรอง");
        const fb = fallbackTable();
        cached = { at: Date.now(), table: fb };
        return fb;
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
      };
      cached = { at: Date.now(), table };
      return table;
    } catch (e: any) {
      console.warn("[fuelPrice] ดึงราคาไม่สำเร็จ:", e?.message ?? e);
      const fb = fallbackTable();
      cached = { at: Date.now(), table: fb };
      return fb;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
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
      sourceLabel: table.origin === "fallback" ? "ค่าสำรอง" : "pttor.com",
      effectiveDate: table.effectiveDate,
      fetchedAt: table.fetchedAt,
      isEstimate: table.isEstimate,
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
