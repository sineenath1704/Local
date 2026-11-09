import { TripPlanLeg } from "../data/tripsData";

/**
 * คำนวณเส้นทางฝั่งแอป (สำหรับแพลนที่ผู้ใช้สร้างเอง)
 * =============================================================
 * · หลัก: เรียก OSRM สาธารณะ (ไม่ต้องใช้คีย์) → ได้เส้นทางตามถนนจริง
 *   รูปแบบ URL เดียวกับที่ backend ใช้ (backend/src/routing.ts) แต่ **ไม่แตะ backend**
 * · สำรอง: ถ้าออฟไลน์/ช้า/โดนจำกัดอัตรา → คำนวณเองจาก haversine
 *   (ROAD_FACTOR 1.35 · AVG_SPEED_KMH 45 — ค่าเดียวกับ backend เพื่อให้ตัวเลขตรงกัน)
 * · OSRM ไม่รู้สภาพจราจร → ค่าที่ได้เป็น "ประมาณ" ต้องเขียนกำกับใน UI
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** จุดหนึ่งจุดของเส้นทาง (จุดเริ่มต้น · จุดแวะ · จุดสิ้นสุด) */
export interface RoutePoint {
  label: string;
  coords?: LatLng | null;
}

export interface RouteResult {
  /** เส้นทางรายขา (index อ้างถึงตำแหน่งใน array จุดที่ส่งเข้าไป) */
  legs: TripPlanLeg[];
  /** ระยะรวม (กม.) */
  totalKm: number;
  /** เวลาเดินทางรวม (นาที) */
  totalDriveMinutes: number;
  /** "osrm" = เส้นทางจริง · "estimate" = ค่าประมาณ */
  routeSource: "osrm" | "estimate";
  /** เครดิตที่ต้องแสดงในแอป (กฎของ OSM / OSM Foundation) */
  routeCredit: string;
}

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const REQUEST_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 ชั่วโมง
const MIN_INTERVAL_MS = 1000; // ไม่เกิน 1 req/s
const ROAD_FACTOR = 1.35; // ระยะจริง ≈ ระยะเป็นเส้นตรง × 1.35
const AVG_SPEED_KMH = 45; // ความเร็วเฉลี่ยในเขตเมือง/ถนนหลัก

/** เครดิตที่ต้องแสดงในแอป */
export const ROUTE_CREDIT = "ข้อมูลเส้นทาง: © OpenStreetMap contributors (ผ่าน OSRM)";

// ── cache + rate limit (in-memory) ──────────────────────────────────────
interface CacheEntry {
  at: number;
  result: RouteResult;
}
const cache = new Map<string, CacheEntry>();
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ระยะเป็นเส้นตรง (กม.) — haversine */
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function validCoords(p?: LatLng | null): p is LatLng {
  if (!p) return false;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  // (0,0) = ค่าเริ่มต้นของฟอร์มที่ยังไม่ได้กรอก → ไม่ใช่พิกัดจริง
  return !(p.lat === 0 && p.lng === 0);
}

/** จุดที่ใช้คำนวณได้จริง (มีพิกัด) + ตำแหน่งเดิมใน array เดิม */
interface UsablePoint {
  origIndex: number;
  coords: LatLng;
}

/**
 * ตัวประมาณระยะ/เวลา (ใช้เมื่อ OSRM ใช้ไม่ได้)
 * → เส้นทางเป็นเส้นตรง แอปต้องรู้ว่านี่คือค่าประมาณ
 */
export function estimateRoute(
  usable: UsablePoint[]
): { legs: TripPlanLeg[]; totalKm: number; totalDriveMinutes: number } {
  const legs: TripPlanLeg[] = [];
  let totalKm = 0;
  for (let i = 0; i < usable.length - 1; i++) {
    const a = usable[i].coords;
    const b = usable[i + 1].coords;
    const km = haversineKm(a, b) * ROAD_FACTOR;
    const minutes = (km / AVG_SPEED_KMH) * 60;
    legs.push({
      fromIndex: usable[i].origIndex,
      toIndex: usable[i + 1].origIndex,
      km: round1(km),
      minutes: Math.round(minutes),
      source: "estimate",
      geometry: [
        { lat: a.lat, lng: a.lng },
        { lat: b.lat, lng: b.lng },
      ],
    });
    totalKm += km;
  }
  return {
    legs,
    totalKm: round1(totalKm),
    totalDriveMinutes: legs.reduce((s, l) => s + l.minutes, 0),
  };
}

/** GeoJSON [[lng,lat], …] → {lat,lng}[] */
function toLatLngs(raw: any): LatLng[] {
  if (!Array.isArray(raw)) return [];
  const out: LatLng[] = [];
  for (const pair of raw) {
    const lat = Number(pair?.[1]);
    const lng = Number(pair?.[0]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
  }
  return out;
}

/**
 * ตัดเส้นทางเป็นรายขา
 * -------------------------------------------------------------
 * OSRM คืน geometry ทั้งเส้น → ต้องหั่นตามจุดที่ผ่าน (waypoints)
 * โดยหาจุดใน geometry ที่ใกล้ waypoint ที่สุด แล้วเดินไปข้างหน้าตามลำดับ
 */
function splitGeometry(
  geometry: LatLng[],
  waypoints: LatLng[]
): LatLng[][] {
  if (geometry.length < 2) return [];
  if (waypoints.length < 2) return [geometry];

  const cuts: number[] = [0];
  let cursor = 0;
  for (const wp of waypoints) {
    let best = cursor;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = cursor; i < geometry.length; i++) {
      const d = haversineKm(geometry[i], wp);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    cuts.push(best);
    cursor = Math.min(best + 1, geometry.length - 1);
  }
  cuts.push(geometry.length - 1);

  const out: LatLng[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b <= a) {
      out.push([geometry[a], geometry[Math.min(a + 1, geometry.length - 1)]]);
      continue;
    }
    out.push(geometry.slice(a, b + 1));
  }
  return out;
}

/**
 * คำนวณเส้นทาง — ลอง OSRM ก่อก ถ้าไม่ได้ค่อยใช้ตัวประมาณ
 * -------------------------------------------------------------
 * `points` = [จุดเริ่มต้น, ...จุดแวะ, จุดสิ้นสุด] (จุดที่ไม่มีพิกัดจะถูกข้าม)
 */
export async function computeRoute(points: RoutePoint[]): Promise<RouteResult> {
  const usable: UsablePoint[] = [];
  points.forEach((p, i) => {
    if (validCoords(p.coords)) {
      usable.push({ origIndex: i, coords: { lat: p.coords.lat, lng: p.coords.lng } });
    }
  });

  if (usable.length < 2) {
    return {
      legs: [],
      totalKm: 0,
      totalDriveMinutes: 0,
      routeSource: "estimate",
      routeCredit: ROUTE_CREDIT,
    };
  }

  const key = usable
    .map((p) => `${p.coords.lat.toFixed(3)},${p.coords.lng.toFixed(3)}`)
    .join(";");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const live = await osrmRoute(usable);
  const result: RouteResult = live ?? (() => {
    const est = estimateRoute(usable);
    return {
      legs: est.legs,
      totalKm: est.totalKm,
      totalDriveMinutes: est.totalDriveMinutes,
      routeSource: "estimate" as const,
      routeCredit: ROUTE_CREDIT,
    };
  })();

  cache.set(key, { at: Date.now(), result });
  return result;
}

/**
 * เรียก OSRM — คืน null เมื่อใช้ไม่ได้ (พัง/ช้า/จำกัดอัตรา) ไม่ throw
 */
async function osrmRoute(usable: UsablePoint[]): Promise<RouteResult | null> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const coords = usable
    .map((p) => `${p.coords.lng.toFixed(6)},${p.coords.lat.toFixed(6)}`)
    .join(";");
  const url =
    `${OSRM_BASE}/${coords}` +
    `?overview=full&geometries=geojson&steps=false`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    if (body?.code !== "Ok" || !Array.isArray(body.routes) || !body.routes[0]) {
      return null;
    }

    const route = body.routes[0];
    const rawLegs: any[] = Array.isArray(route.legs) ? route.legs : [];
    const geometry = toLatLngs(route.geometry?.coordinates);
    const snapped: LatLng[] = Array.isArray(body.waypoints)
      ? body.waypoints.map((w: any) => ({
          lat: Number(w?.location?.[1]),
          lng: Number(w?.location?.[0]),
        }))
      : [];

    // หั่นเส้นทางเป็นรายขา (ใช้จุดที่ OSRM snap ไว้ ถ้ามี)
    const cutPoints = snapped.length === usable.length ? snapped : usable.map((u) => u.coords);
    const pieces = splitGeometry(geometry, cutPoints);

    const legs: TripPlanLeg[] = rawLegs.map((leg: any, i: number) => {
      const from = usable[i];
      const to = usable[i + 1];
      const piece = pieces[i] ?? [];
      const geom =
        piece.length >= 2
          ? piece
          : from && to
          ? [
              { lat: from.coords.lat, lng: from.coords.lng },
              { lat: to.coords.lat, lng: to.coords.lng },
            ]
          : [];
      return {
        fromIndex: from?.origIndex ?? i,
        toIndex: to?.origIndex ?? i + 1,
        km: round1((Number(leg?.distance ?? 0) || 0) / 1000),
        minutes: Math.round((Number(leg?.duration ?? 0) || 0) / 60),
        source: "osrm",
        geometry: geom,
      };
    });

    return {
      legs,
      totalKm: round1((Number(route.distance ?? 0) || 0) / 1000),
      totalDriveMinutes: Math.round((Number(route.duration ?? 0) || 0) / 60),
      routeSource: "osrm",
      routeCredit: ROUTE_CREDIT,
    };
  } catch (e: any) {
    console.warn("[tripRouteService] OSRM ใช้ไม่ได้:", e?.message ?? e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** ล้าง cache (ใช้ตอนทดสอบ) */
export function __clearRouteCache(): void {
  cache.clear();
}
