import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Fuel price cache — one row per Thai calendar day.
 * -------------------------------------------------------------
 * Primary: Supabase `fuel_price_cache` table (survives Vercel cold starts
 *   and keeps "one fetch per day" true across instances).
 * Fallback: in-memory Map when Supabase isn't configured or the table
 *   doesn't exist yet (local dev / migration not run).
 *
 * The rule the backend follows (see `backend/src/fuelPrice.ts`):
 *   today's row  → today's price
 *   no row + fetch works → write today's row
 *   no row + fetch fails → fall back to the newest OLDER row and label it
 *                         "ข้อมูลเก่า" (never write an old price as today's)
 */

/** แถวหนึ่งแถวของ cache (ชื่อคอลัมน์ตรงกับตารางใน Supabase) */
export interface FuelPriceCacheRow {
  /** วันไทยที่ดึงราคามา ("YYYY-MM-DD") */
  cache_date: string;
  /** ราคาต่อลิตร แยกตามชนิดน้ำมัน */
  prices: Record<string, number>;
  /** วันที่ราคามีผลบังคับใช้ (ข้อความที่เว็บเขียนไว้) */
  effective_date: string | null;
  /** วันที่รูปแบบอื่นที่เว็บเขียนไว้ */
  effective_date_alt: string | null;
  /** ที่มาของตัวเลขในรอบนี้ */
  source: string;
  /** "pttor.com" | "fallback" */
  origin: string;
  /** true = ตัวเลขมาจากค่าสำรองในโค้ด ไม่ใช่เว็บ */
  is_estimate: boolean;
  /** URL ที่ดึงมา */
  url: string | null;
  /** เวลาที่เขียนแถวนี้ (ISO) */
  fetched_at: string;
}

/** cache ใน memory (ใช้ตอน Supabase ใช้ไม่ได้) */
const memory = new Map<string, FuelPriceCacheRow>();

/**
 * ใช้ตอนเทสต์: ปิดการอ่าน/เขียน Supabase (ใช้แค่ memory)
 * -------------------------------------------------------------
 * เทสต์ใช้ราคาปลอม (fixture) → ถ้าเขียนลงตารางจริง จะทำให้ราคาวันนี้ของ
 * ผู้ใช้จริงเพี้ยนทันที → ต้องปิดไว้ตอนรันเทสต์
 */
let useSupabase = true;

export function __setFuelPriceStoreUseSupabase(on: boolean): void {
  useSupabase = on;
}

function toRow(raw: unknown): FuelPriceCacheRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const date = String(r.cache_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const prices: Record<string, number> = {};
  if (r.prices && typeof r.prices === "object" && !Array.isArray(r.prices)) {
    for (const [k, v] of Object.entries(r.prices as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) prices[k] = n;
    }
  }
  if (Object.keys(prices).length === 0) return null;
  return {
    cache_date: date,
    prices,
    effective_date: r.effective_date ? String(r.effective_date) : null,
    effective_date_alt: r.effective_date_alt
      ? String(r.effective_date_alt)
      : null,
    source: String(r.source ?? "unknown"),
    origin: String(r.origin ?? "unknown"),
    is_estimate: r.is_estimate === true,
    url: r.url ? String(r.url) : null,
    fetched_at: String(r.fetched_at ?? new Date().toISOString()),
  };
}

/**
 * อ่านราคาของวันที่ระบุ (null = ยังไม่มีข้อมูลของวันนั้น)
 * ลำดับ: Supabase → memory
 */
export async function readFuelPriceCache(
  dayKey: string
): Promise<FuelPriceCacheRow | null> {
  const admin = useSupabase ? getSupabaseAdmin() : null;
  if (admin) {
    try {
      const { data, error } = await admin
        .from("fuel_price_cache")
        .select("*")
        .eq("cache_date", dayKey)
        .maybeSingle();
      if (!error && data) {
        const row = toRow(data);
        if (row) {
          memory.set(row.cache_date, row);
          return row;
        }
      }
    } catch (e: any) {
      // ยังไม่ได้รัน migration หรือตารางยังไม่มี → ใช้ memory ต่อ
      // eslint-disable-next-line no-console
      console.warn(
        `[fuelPriceStore] อ่าน cache จาก Supabase ไม่ได้ (${dayKey}): ${
          e?.message ?? e
        }`
      );
    }
  }
  return memory.get(dayKey) ?? null;
}

/**
 * อ่านราคาของวันที่เก่าที่สุดที่ยังมี (ใช้ตอนดึงราคาวันนี้ไม่สำเร็จ)
 * → ผู้ใช้ต้องเห็นป้ายว่าเป็นข้อมูลเก่า
 */
export async function readLatestFuelPriceCache(
  beforeDayKey: string
): Promise<FuelPriceCacheRow | null> {
  const admin = useSupabase ? getSupabaseAdmin() : null;
  if (admin) {
    try {
      const { data, error } = await admin
        .from("fuel_price_cache")
        .select("*")
        .lt("cache_date", beforeDayKey)
        .order("cache_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        const row = toRow(data);
        if (row) {
          memory.set(row.cache_date, row);
          return row;
        }
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn(
        `[fuelPriceStore] อ่าน cache เก่าจาก Supabase ไม่ได้: ${e?.message ?? e}`
      );
    }
  }
  // memory: เลือกวันที่ใหญ่ที่สุดที่ยังน้อยกว่า beforeDayKey
  let best: FuelPriceCacheRow | null = null;
  for (const row of memory.values()) {
    if (row.cache_date >= beforeDayKey) continue;
    if (!best || row.cache_date > best.cache_date) best = row;
  }
  return best;
}

/**
 * เขียนราคาของวันนี้ลง cache (Supabase ก่อน → memory สำรอง)
 * ถ้าเขียน Supabase ไม่ได้ → ไม่ error (ระบบยังทำงานต่อด้วย memory)
 */
export async function writeFuelPriceCache(
  row: FuelPriceCacheRow
): Promise<void> {
  memory.set(row.cache_date, row);

  const admin = useSupabase ? getSupabaseAdmin() : null;
  if (!admin) return;

  try {
    const { error } = await admin
      .from("fuel_price_cache")
      .upsert(
        {
          cache_date: row.cache_date,
          prices: row.prices,
          effective_date: row.effective_date,
          effective_date_alt: row.effective_date_alt,
          source: row.source,
          origin: row.origin,
          is_estimate: row.is_estimate,
          url: row.url,
          fetched_at: row.fetched_at,
        },
        { onConflict: "cache_date" }
      );
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[fuelPriceStore] เขียน cache ไม่ได้ (${row.cache_date}): ${error.message}`
      );
    }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fuelPriceStore] เขียน cache ไม่ได้ (${row.cache_date}): ${e?.message ?? e}`
    );
  }
}

/** ล้าง cache ใน memory (ใช้ตอนเทสต์) */
export function __clearFuelPriceMemory(): void {
  memory.clear();
}
