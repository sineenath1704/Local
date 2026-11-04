/**
 * ตัวเรียก OSRM สาธารณะ + ตัวประมาณระยะ/เวลา
 * -------------------------------------------------------------
 * ใช้กับแผนทริปของ AI (POST /trips/plan)
 *
 * ทำไมต้องมีโมดูลนี้
 * - Google Routes API v2 ใช้ไม่ได้ (บิลลิ่งปิด + ไม่ได้ enable) → ใช้ OSRM แทน
 * - OSRM คืนเส้นทางตามถนนจริง แต่ "ไม่รู้สภาพจราจร" → ต้องเขียนกำกับใน UI
 *
 * หมายเหตุ: `backend/src/osmClient.ts` เป็นโมดูลเดิมของ "สรุปคลิป" → ไม่แตะ
 * โมดูลนี้ใหม่เอาไว้เฉพาะงานวางแผนทริป
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  /** ดัชนีจุดเริ่มของขานี้ใน array จุดที่ส่งเข้าไป */
  fromIndex: number;
  /** ดัชนีจุดปลายทางของขานี้ */
  toIndex: number;
  km: number;
  minutes: number;
}

export interface RouteResult {
  ok: boolean;
  /** ระยะรวม (กม.) */
  km: number;
  /** เวลารวม (นาที) */
  minutes: number;
  legs: RouteLeg[];
  /** เส้นทางทั้งเส้น (สำหรับวาด polyline) */
  geometry: LatLng[];
  /** จุดที่ OSRM ดึงไปตรึงกับถนนจริง (ใช้เป็นตำแหน่งหมุด) */
  snapped: LatLng[];
  /** "osrm" = เส้นทางจริง · "estimate" = ค่าประมาณ (OSRM ใช้ไม่ได้) */
  source: "osrm" | "estimate";
}

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const REQUEST_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 ชั่วโมง
const MIN_INTERVAL_MS = 1000; // ไม่เกิน 1 req/s ต่อ instance
const ROAD_FACTOR = 1.35; // ระยะจริง ≈ ระยะเป็นเส้นตรง × 1.35
const AVG_SPEED_KMH = 45; // ความเร็วเฉลี่ยในเขตเมือง/ถนนหลัก
const USER_AGENT =
  process.env.OSM_USER_AGENT?.trim() ||
  "LocalTripPlanner/1.0 (https://github.com/local-app; contact via app)";

/** เครดิตที่ต้องแสดงในแอป (กฎของ OSM/OSM Foundation) */
export const ROUTE_CREDIT = "ข้อมูลเส้นทาง: © OpenStreetMap contributors (ผ่าน OSRM)";

// ── cache + rate limit (in-memory ต่อ instance) ──────────────────────────
interface CacheEntry {
  at: number;
  result: RouteResult;
}
const cache = new Map<string, CacheEntry>();
let lastRequestAt = 0;

function cacheKey(points: LatLng[]): string {
  return points
    .map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`)
    .join(";");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ตัวช่วย: haversine (กม.) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** ตัวช่วย: ย่อจุดของเส้นทางให้เหลือไม่เกิน maxPoints (เก็บจุดแรก/ท้ายไว้เสมอ) */
export function simplifyPoints(points: LatLng[], maxPoints: number): LatLng[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;
  const step = Math.ceil(points.length / (maxPoints - 1));
  const out: LatLng[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * ตัวประมาณระยะ/เวลา (ใช้เมื่อ OSRM ใช้ไม่ได้)
 * - ระยะ = ผลรวม haversine ของแต่ละขา × ROAD_FACTOR
 * - เวลา = ระยะ ÷ ความเร็วเฉลี่ย
 */
export function estimateRoute(points: LatLng[]): RouteResult {
  const legs: RouteLeg[] = [];
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const km = haversineKm(points[i], points[i + 1]) * ROAD_FACTOR;
    const minutes = (km / AVG_SPEED_KMH) * 60;
    legs.push({ fromIndex: i, toIndex: i + 1, km, minutes });
    totalKm += km;
  }
  return {
    ok: true,
    km: totalKm,
    minutes: legs.reduce((sum, l) => sum + l.minutes, 0),
    legs,
    // เส้นตรง (ไม่มีข้อมูลถนน) — แอปต้องรู้ว่านี่คือค่าประมาณ
    geometry: points.map((p) => ({ ...p })),
    snapped: [],
    source: "estimate",
  };
}

/**
 * เรียก OSRM (multi-waypoint)
 * -------------------------------------------------------------
 * คืน null เมื่อใช้ไม่ได้ (พัง / ช้า / จำกัดอัตรา) — ไม่ throw
 * ผู้เรียกต้อง fallback ไปใช้ estimateRoute()
 */
export async function osrmRoute(
  points: LatLng[],
  opts?: { timeoutMs?: number }
): Promise<RouteResult | null> {
  if (!Array.isArray(points) || points.length < 2) return null;

  const key = cacheKey(points);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  // จำกัดอัตรา: เว้นระหว่างคำขออย่างน้อย 1 วินาที
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const coords = points
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(";");
  const url =
    `${OSRM_BASE}/${coords}` +
    `?overview=full&geometries=geojson&steps=false`;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? REQUEST_TIMEOUT_MS
  );

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    if (body?.code !== "Ok" || !Array.isArray(body.routes) || !body.routes[0]) {
      return null;
    }

    const route = body.routes[0];
    const rawLegs: any[] = Array.isArray(route.legs) ? route.legs : [];
    const legs: RouteLeg[] = rawLegs.map((leg, i) => ({
      fromIndex: i,
      toIndex: i + 1,
      km: (Number(leg?.distance ?? 0) || 0) / 1000,
      minutes: Math.round((Number(leg?.duration ?? 0) || 0) / 60),
    }));

    // geometry แบบ GeoJSON = [[lng,lat], …] → แปลงเป็น {lat,lng}
    const rawCoords: any[] = Array.isArray(route.geometry?.coordinates)
      ? route.geometry.coordinates
      : [];
    const geometry: LatLng[] = rawCoords.map((pair) => ({
      lat: Number(pair?.[1]),
      lng: Number(pair?.[0]),
    }));

    // จุดที่ OSRM ตรึงกับถนนจริง (snap ได้ห่างจากที่ขอได้ถึง ~300 ม.)
    const snapped: LatLng[] = Array.isArray(body.waypoints)
      ? body.waypoints.map((w: any) => ({
          lat: Number(w?.location?.[1]),
          lng: Number(w?.location?.[0]),
        }))
      : [];

    const result: RouteResult = {
      ok: true,
      km: (Number(route.distance ?? 0) || 0) / 1000,
      minutes: Math.round((Number(route.duration ?? 0) || 0) / 60),
      legs,
      geometry: simplifyPoints(geometry, 400),
      snapped,
      source: "osrm",
    };

    cache.set(key, { at: Date.now(), result });
    return result;
  } catch (e: any) {
    console.warn("[routing] OSRM ใช้ไม่ได้:", e?.message ?? e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * คำนวณเส้นทาง — ลอง OSRM ก่อน ถ้าไม่ได้ค่อยใช้ตัวประมาณ
 * ผลลัพธ์มี `source` เสมอ → ผู้เรียกต้องแสดงให้ผู้ใช้เห็น
 */
export async function routeBetween(
  points: LatLng[],
  opts?: { timeoutMs?: number }
): Promise<RouteResult> {
  if (!Array.isArray(points) || points.length < 2) {
    return { ...estimateRoute([]), km: 0, minutes: 0, legs: [], geometry: [] };
  }
  const live = await osrmRoute(points, opts);
  if (live) return live;
  return estimateRoute(points);
}

/** คีย์ของ cache (สำหรับเทสต์) */
export function __routingCacheKey(points: LatLng[]): string {
  return cacheKey(points);
}

/** ล้าง cache (สำหรับเทสต์) */
export function __clearRoutingCache(): void {
  cache.clear();
}
