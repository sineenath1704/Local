/**
 * ============================================================
 *  OSM CLIENT — ข้อมูลเส้นทาง/ใกล้เคียง/ผิวถนน (ข้อมูลเสริม)
 * ============================================================
 * แผน: PLAN_VIDEO_ANALYZER_V2.md §9
 *
 * ข้อมูลชุดนี้เป็น **ข้อมูลเสริม** — ไม่ใช่ตัวแทนของ Google Places
 * (ปุ่มติ๊กเลือกสถานที่ + ปุ่ม Maps + ทะเบียน `community_places` ยังทำงานเหมือนเดิม)
 *
 * กติกาที่ต้องเขียนในโค้ด (ตามแผน §9)
 *   · User-Agent จริง (ไม่ใช่ค่า default ของ fetch)
 *   · เรียก ≤ 1 req/s ต่อเซิร์ฟเวอร์
 *   · cache ตามพิกัด
 *   · มี timeout ทุกคำขอ
 *   · งบเวลารวม ≤ 6 วินาที (ยิงหลัง AI สำเร็จเท่านั้น)
 *   · ล้มเหลวแล้วต้องไม่ทำให้สรุปคลิปล้ม → ข้ามเงียบ ๆ
 *   · ต้องแสดงเครดิต "© OpenStreetMap contributors"
 *
 * ไม่เพิ่ม dependency — Node 20 มี `fetch` ในตัว
 * (ใช้ AbortController + setTimeout เพราะ tsconfig เป็น lib ES2020
 *  → `AbortSignal.timeout` ใช้ไม่ได้)
 */

/**
 * ข้อมูลเส้นทาง/ใกล้เคียง/ผิวถนนจาก OSM
 * -------------------------------------------------------------
 * ⚠️ โมดูลนี้ **ไม่ได้อยู่ในเส้นทางรันจริงแล้ว** — การ์ดเปลี่ยนไปใช้
 *    Google Places + Google Routes แทน (ดู `googleMaps.ts`)
 *    ไฟล์นี้ยังอยู่เพื่อเทียบผล/ใช้ตรวจเทียบเฉพาะกรณี (ดู `scripts/vca_v2_osm_check.ts`)
 */
export interface OsmInfo {
  /** พิกัดที่หาได้ */
  lat?: number | null;
  lon?: number | null;
  /** ชื่อสถานที่ใกล้เคียง */
  nearby?: string[];
  /** ผิวถนนรอบพิกัด */
  roadSurface?: string | null;
  /** เส้นทางจากจุดอ้างอิง */
  routeKm?: number | null;
  routeMinutes?: number | null;
  /** จุดอ้างอิงที่ใช้คำนวณเส้นทาง */
  routeFrom?: string | null;
  /** เครดิตแผนที่ */
  credit?: string | null;
}

/** User-Agent — ตั้งค่าเองได้ผ่าน env (แนะนำให้ใส่ช่องทางติดต่อจริง) */
const USER_AGENT =
  process.env.OSM_USER_AGENT?.trim() ||
  "LocalTravelApp/2.0 (video summary; openstreetmap data client)";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** งบเวลารวมของการยิง OSM ทั้งหมด (มิลลิวินาที) */
const TOTAL_BUDGET_MS = 6000;
/** timeout ต่อคำขอ */
const REQUEST_TIMEOUT_MS = 3000;
/** เวลาขั้นต่ำระหว่างสองคำขอของเซิร์ฟเวอร์เดียวกัน (นโยบาย ≤ 1 req/s) */
const MIN_INTERVAL_MS = 1100;

// ─────────────────────────────────────────────
//  ตัวช่วยเล็ก ๆ
// ─────────────────────────────────────────────

let lastCallAt = 0;

/** รอให้ผ่านช่วงเวลาขั้นต่ำก่อนยิงคำขอถัดไป */
async function respectRateLimit(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallAt = Date.now();
}

/** เรียก fetch พร้อม timeout — คืน null เมื่อล้ม/ช้าเกินกำหนด (ไม่ throw) */
async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response | null> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await respectRateLimit();
    const resp = await fetch(url, {
      ...rest,
      headers: { "User-Agent": USER_AGENT, ...(rest.headers || {}) },
      signal: controller.signal,
    });
    return resp;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────
//  cache (อยู่ใน memory ของ process — พอสำหรับลดการยิงซ้ำ)
// ─────────────────────────────────────────────

interface CacheEntry {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 ชั่วโมง

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
  // ไม่ให้ cache บวม (serverless ทำงานนานได้นาน)
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

// ─────────────────────────────────────────────
//  1) Nominatim — หาพิกัด
// ─────────────────────────────────────────────

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
  addresstype?: string;
}

/**
 * หาพิกัดจากชื่อสถานที่ + จังหวัด
 * คืน null เมื่อ "หาไม่เจอ" หรือ "กำกวมเกินกว่าจะเดา" (ตามกติกา §9 ข้อ 3)
 */
export async function geocodePlace(
  placeName: string | null | undefined,
  province: string | null | undefined,
  district: string | null | undefined
): Promise<{ lat: number; lon: number; label: string } | null> {
  const name = (placeName || "").trim();
  const prov = (province || "").trim();
  const dist = (district || "").trim();
  if (!name && !dist) return null;

  const key = `geo:${name}|${dist}|${prov}`;
  const cached = cacheGet<{ lat: number; lon: number; label: string } | null>(key);
  if (cached !== null) return cached;

  const q = [name, dist, prov, "ประเทศไทย"].filter(Boolean).join(" ");
  const url = `${NOMINATIM}?format=jsonv2&countrycodes=th&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`;

  const resp = await fetchWithTimeout(url);
  if (!resp || !resp.ok) {
    cacheSet(key, null);
    return null;
  }
  const hits = (await resp.json().catch(() => [])) as NominatimHit[];
  if (!Array.isArray(hits) || hits.length === 0) {
    cacheSet(key, null);
    return null;
  }

  const first = hits[0];
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    cacheSet(key, null);
    return null;
  }

  // กำกวมเกินไป → ไม่เดา (ผลต่างกันมากกว่า ~5 กม. = คนละที่ชัดเจน)
  if (hits.length > 1) {
    const second = hits[1];
    const dLat = (Number(second.lat) - lat) * 111;
    const dLon = (Number(second.lon) - lon) * 111 * Math.cos((lat * Math.PI) / 180);
    if (Math.hypot(dLat, dLon) > 5) {
      cacheSet(key, null);
      return null;
    }
  }

  const value = { lat, lon, label: name || first.display_name.split(",")[0] };
  cacheSet(key, value);
  return value;
}

/** หาพิกัดของ "จุดอ้างอิง" (เช่น ตัวอำเภอ) สำหรับคำนวณระยะทาง */
export async function geocodeReference(
  district: string | null | undefined,
  province: string | null | undefined
): Promise<{ lat: number; lon: number; label: string } | null> {
  const dist = (district || "").trim();
  const prov = (province || "").trim();
  if (!dist && !prov) return null;

  const key = `ref:${dist}|${prov}`;
  const cached = cacheGet<{ lat: number; lon: number; label: string } | null>(key);
  if (cached !== null) return cached;

  const q = [dist, prov, "ประเทศไทย"].filter(Boolean).join(" ");
  const url = `${NOMINATIM}?format=jsonv2&countrycodes=th&limit=1&q=${encodeURIComponent(q)}`;

  const resp = await fetchWithTimeout(url);
  if (!resp || !resp.ok) {
    cacheSet(key, null);
    return null;
  }
  const hits = (await resp.json().catch(() => [])) as NominatimHit[];
  const hit = Array.isArray(hits) ? hits[0] : null;
  if (!hit) {
    cacheSet(key, null);
    return null;
  }
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    cacheSet(key, null);
    return null;
  }
  const value = { lat, lon, label: dist || prov };
  cacheSet(key, value);
  return value;
}

// ─────────────────────────────────────────────
//  2) Overpass — ถนนรอบพิกัด + สถานที่ใกล้เคียง
// ─────────────────────────────────────────────

const SURFACE_TH: Record<string, string> = {
  unpaved: "ถนนดิน/ลูกรัง",
  gravel: "ถนนลูกรัง",
  dirt: "ถนนดิน",
  ground: "ถนนดิน",
  compacted: "ถนนลูกรังอัด",
  sand: "ถนนทราย",
  concrete: "ถนนคอนกรีต",
  asphalt: "ถนนลาดยาง",
  paved: "ถนนลาดยาง",
  cobblestone: "ถนนหินกลัง",
  sett: "ถนนหินกลัง",
  unpaved_: "ถนนดิน",
};

/** แปลงผิวถนนจาก OSM เป็นภาษาไทย */
export function surfaceToThai(surface: string | null | undefined): string | null {
  if (!surface) return null;
  return SURFACE_TH[surface.trim().toLowerCase()] ?? null;
}

/** รวมผิวถนนหลายจุด → ประโยคเดียว (บอกด้วยว่า "ช่วงท้ายอาจต่างจากนี้") */
export function mergeSurfaces(surfaces: string[]): string | null {
  const uniq = [...new Set(surfaces.filter(Boolean))];
  if (uniq.length === 0) return null;
  if (uniq.length === 1) return `ถนนรอบพิกัดเป็น${uniq[0]}`;
  return `รอบพิกัดมีทั้ง ${uniq.join(" และ ")} (ช่วงท้ายทางเข้าอาจต่างจากนี้)`;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpass(query: string, budget: { left: number }): Promise<any[] | null> {
  if (budget.left <= 0) return null;
  const started = Date.now();
  const resp = await fetchWithTimeout(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString(),
    timeoutMs: Math.min(REQUEST_TIMEOUT_MS + 1000, budget.left),
  });
  budget.left -= Date.now() - started;
  if (!resp || !resp.ok) return null;
  const data: any = await resp.json().catch(() => null);
  return Array.isArray(data?.elements) ? data.elements : null;
}

/** ถนนรอบพิกัด (ผิวถนน) */
export async function fetchRoadSurface(
  lat: number,
  lon: number,
  budget: { left: number }
): Promise<string | null> {
  const key = `road:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = cacheGet<string | null>(key);
  if (cached !== null) return cached;

  const query = `[out:json][timeout:15];(way(around:250,${lat},${lon})["highway"];);out tags;`;
  const elements = await overpass(query, budget);
  if (!elements) {
    cacheSet(key, null);
    return null;
  }
  const surfaces: string[] = [];
  for (const el of elements as OverpassElement[]) {
    const s = surfaceToThai(el.tags?.surface);
    if (s) surfaces.push(s);
  }
  const merged = mergeSurfaces(surfaces);
  cacheSet(key, merged);
  return merged;
}

/** สถานที่ใกล้เคียง (จุดชมวิว / คาเฟ่ / ตลาด / ธรรมชาติ) */
export async function fetchNearby(
  lat: number,
  lon: number,
  budget: { left: number }
): Promise<string[]> {
  const key = `nearby:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cacheGet<string[]>(key);
  if (cached !== null) return cached;

  const query = `[out:json][timeout:20];(nwr(around:2500,${lat},${lon})["tourism"="viewpoint"];nwr(around:2500,${lat},${lon})["tourism"="attraction"];nwr(around:2500,${lat},${lon})["amenity"="cafe"];nwr(around:2500,${lat},${lon})["shop"="market"];nwr(around:2500,${lat},${lon})["tourism"="hotel"];);out center tags;`;
  const elements = await overpass(query, budget);
  if (!elements) {
    cacheSet(key, []);
    return [];
  }

  const names: string[] = [];
  for (const el of elements as OverpassElement[]) {
    const name = el.tags?.name?.trim();
    if (!name) continue;
    if (names.includes(name)) continue;
    names.push(name);
    if (names.length >= 6) break;
  }
  cacheSet(key, names);
  return names;
}

// ─────────────────────────────────────────────
//  3) OSRM — เส้นทางจากจุดอ้างอิง
// ─────────────────────────────────────────────

export async function fetchRoute(
  from: { lat: number; lon: number; label: string },
  to: { lat: number; lon: number },
  budget: { left: number }
): Promise<{ km: number; minutes: number } | null> {
  const key = `route:${from.lat.toFixed(3)},${from.lon.toFixed(3)}>${to.lat.toFixed(3)},${to.lon.toFixed(3)}`;
  const cached = cacheGet<{ km: number; minutes: number } | null>(key);
  if (cached !== null) return cached;

  const url = `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const resp = await fetchWithTimeout(url, {
    timeoutMs: Math.min(REQUEST_TIMEOUT_MS, budget.left),
  });
  if (!resp || !resp.ok) {
    cacheSet(key, null);
    return null;
  }
  const data: any = await resp.json().catch(() => null);
  const route = data?.routes?.[0];
  if (!route) {
    cacheSet(key, null);
    return null;
  }
  const value = {
    km: Number(route.distance) / 1000,
    minutes: Number(route.duration) / 60,
  };
  cacheSet(key, value);
  return value;
}

// ─────────────────────────────────────────────
//  4) รวมทั้งหมด
// ─────────────────────────────────────────────

export interface OsmQuery {
  /** ชื่อสถานที่จากคลิป */
  placeName?: string | null;
  province?: string | null;
  district?: string | null;
  /** พิกัดที่ผู้ใช้ตั้งเองในแอป (videos.latitude/longitude) — ถ้ามี ใช้เลย ไม่ต้องค้น */
  lat?: number | null;
  lon?: number | null;
}

/**
 * รวบรวมข้อมูล OSM ทั้งหมด
 * คืน null เมื่อไม่มีพิกัดที่เชื่อถือได้ (ข้ามเงียบ ๆ ไม่ทำให้สรุปคลิปล้ม)
 */
export async function getOsmInfo(query: OsmQuery): Promise<OsmInfo | null> {
  const budget = { left: TOTAL_BUDGET_MS };
  const info: OsmInfo = {
    lat: null,
    lon: null,
    nearby: [],
    roadSurface: null,
    routeKm: null,
    routeMinutes: null,
    routeFrom: null,
    credit: "© OpenStreetMap contributors",
  };

  // 1) พิกัด — พิกัดที่ผู้ใช้ตั้งเองมาก่อนเสมอ (ไม่ยิง Nominatim ให้เปลือง)
  let lat = typeof query.lat === "number" && Number.isFinite(query.lat) ? query.lat : null;
  let lon = typeof query.lon === "number" && Number.isFinite(query.lon) ? query.lon : null;

  if (lat === null || lon === null) {
    const geo = await geocodePlace(query.placeName, query.province, query.district);
    if (!geo) return null;
    lat = geo.lat;
    lon = geo.lon;
  }

  info.lat = lat;
  info.lon = lon;

  // 2) ถนนรอบพิกัด
  info.roadSurface = await fetchRoadSurface(lat, lon, budget);

  // 3) สถานที่ใกล้เคียง
  info.nearby = await fetchNearby(lat, lon, budget);

  // 4) เส้นทางจากจุดอ้างอิง (ตัวอำเภอ) — ข้ามถ้างบหมด
  if (budget.left > 500) {
    const ref = await geocodeReference(query.district, query.province);
    if (ref) {
      const route = await fetchRoute(ref, { lat, lon }, budget);
      if (route) {
        info.routeKm = route.km;
        info.routeMinutes = route.minutes;
        info.routeFrom = ref.label;
      }
    }
  }

  // ไม่มีข้อมูลที่มีประโยชน์เลย → ไม่ต้องมีการ์ด "เดินทาง"
  if (!info.roadSurface && !info.routeKm && (info.nearby || []).length === 0) {
    return null;
  }

  return info;
}
