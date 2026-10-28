/**
 * ============================================================
 *  GOOGLE MAPS CLIENT — พิกัด + สถานที่ใกล้เคียง + เส้นทาง (ข้อมูลเสริม)
 * ============================================================
 * ทั้งหมดมาจาก Google Maps Platform ด้วย key เดียวกัน (`GOOGLE_PLACES_API_KEY`)
 *
 *   · พิกัดสถานที่         → Places (Legacy) TextSearch
 *   · เวลาเปิด-ปิดสถานที่    → Places (Legacy) TextSearch (มาพร้อมพิกัด ไม่ต้องยิงเพิ่ม)
 *   · สถานที่ใกล้เคียง     → Places (Legacy) Nearby Search
 *   · เส้นทาง/เวลา/ค่าผ่าน → Routes API v2 (`directions/v2:computeRoutes`)
 *
 * ทำไมไม่ใช้ OpenStreetMap แล้ว
 *   OSM (Nominatim/Overpass/OSRM) เป็น API สาธารณะ — จำกัดอัตราการเรียก
 *   ไม่มี SLA และไม่มีข้อมูลครบในพื้นที่ชนบทไทย → สรุปคลิปล้มบ่อย
 *   → เปลี่ยนมาใช้ Google ทั้งหมด (คีย์เดียว คิดงบเป็นชุด)
 *
 * ข้อจำกัดของ Google Routes ที่ต้องรู้ (สำคัญ)
 *   Routes API **ไม่มีฟิลด์ "ผิวถนน"** เลย
 *   (`route.proto` / `route_label.proto` มีแต่ระยะ เวลา ค่าผ่าน และป้ายกำกับเส้นทาง)
 *   → ผิวถนนในการ์ดจึงมาจากคลิป (โมเดลดูวิดีโอ) เท่านั้น ไม่เดาเอง
 *
 * กติกา
 *   · ล้มเงียบ ๆ — เป็นข้อมูลเสริม ล้มแล้วไม่ทำให้สรุปคลิปล้ม
 *   · ไม่มี API key → คืน null (ไม่ยิง)
 *   · งบเวลารวม ≤ 5 วินาที (ยิงหลัง AI สำเร็จเท่านั้น)
 */

import { config, isPlacesConfigured } from "./config";

const PLACES = "https://maps.googleapis.com/maps/api/place";
const ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";

const REQUEST_TIMEOUT_MS = 4000;
/** งบเวลารวมของทั้งรอบ (พิกัด + ใกล้เคียง + เส้นทาง) */
export const TOTAL_BUDGET_MS = 5000;
const RADIUS_M = 15000;
const MAX_ITEMS = 4;

/** เครดิตที่ต้องแสดงเมื่อใช้ข้อมูลจาก Google */
export const GOOGLE_MAP_CREDIT = "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform";

// ─────────────────────────────────────────────
//  ชนิดข้อมูล
// ─────────────────────────────────────────────

/** สถานที่ใกล้เคียง 1 แห่ง */
export interface NearbyAttraction {
  name: string;
  /** ป้ายภาษาไทยของประเภท เช่น "วัด" "พิพิธภัณฑ์" (null = ไม่รู้) */
  label: string | null;
  /** ระยะจากสถานที่ (กม.) */
  distanceKm: number | null;
  /** คะแนนรีวิว 0-5 (null = ไม่มี) */
  rating: number | null;
  /** พิกัดของสถานที่ใกล้เคียง — ใช้ทำลิงก์ "เดินทางจากสถานที่ในคลิป" */
  lat?: number | null;
  lon?: number | null;
}

/**
 * เวลาเปิด-ปิดของสถานที่ (จาก Google Places)
 * -------------------------------------------------------------
 * · `openNow`   → ตอนนี้เปิดอยู่ไหม (Google คิดตามเวลาท้องถิ่นของสถานที่)
 * · `weekdayText` → ตารางรายวัน เช่น ["จันทร์: 08:00–17:00", ...]
 *   (Places Legacy คืนมาเป็นภาษาที่ขอไว้ — เราขอ `language=th`)
 */
export interface OpeningHours {
  /** เปิดอยู่ตอนนี้ไหม (null = ไม่มีข้อมูล) */
  openNow: boolean | null;
  /** ตารางเวลารายวัน (ข้อความดิบจาก Google) */
  weekdayText: string[];
}

/** ข้อมูลแผนที่ที่การ์ดใช้ (เส้นทาง/ค่าผ่าน/รถติด) */
export interface MapInfo {
  /** พิกัดที่หาได้ */
  lat?: number | null;
  lon?: number | null;
  /** ระยะทางจากจุดอ้างอิง (กม.) */
  routeKm?: number | null;
  /** เวลาที่ใช้เดินทาง (นาที) */
  routeMinutes?: number | null;
  /** จุดอ้างอิงที่ใช้คำนวณเส้นทาง */
  routeFrom?: string | null;
  /** ชื่อถนน/เส้นทางที่ Google แนะนำ */
  routeVia?: string | null;
  /** มีสะพานข้ามที่เก็บค่าผ่านไหม */
  hasToll?: boolean | null;
  /** คิวรถติดบนเส้นทาง (วินาที) = duration − staticDuration */
  trafficDelaySec?: number | null;
  /** เวลาเปิด-ปิดของสถานที่ (จาก Google Places) */
  openingHours?: OpeningHours | null;
  /** เครดิตที่ต้องแสดง */
  credit?: string | null;
}

/** พิกัด + ชื่อ */
export interface GeoHit {
  lat: number;
  lon: number;
  label: string;
  /** เวลาเปิด-ปิด (มีเฉพาะผลของสถานที่จริง ไม่ใช่จุดอ้างอิง) */
  openingHours?: OpeningHours | null;
}

/**
 * งบเวลาของทั้งรอบ (มิลลิวินาทีที่ยังเหลือ)
 * ใช้ตัวเดียวกันทั้งรอบ → พิกัด + เส้นทาง + สถานที่ใกล้เคียง รวมกันไม่เกิน TOTAL_BUDGET_MS
 */
export interface TimeBudget {
  left: number;
}

// ─────────────────────────────────────────────
//  ตัวช่วยเรียก API
// ─────────────────────────────────────────────

/**
 * เรียก API พร้อม timeout + งบเวลารวม
 * คืน null เมื่อล้ม/ช้าเกินกำหนด (ไม่ throw)
 */
async function fetchJson(
  url: string,
  init: RequestInit,
  budget: TimeBudget
): Promise<any | null> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(REQUEST_TIMEOUT_MS, Math.max(500, budget.left))
  );
  try {
    const resp = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "LocalApp/1.0 (video-summary)",
        ...(init.headers || {}),
      },
    });
    if (!resp.ok) return null;
    return await resp.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    budget.left -= Date.now() - started;
  }
}

/**
 * ป้ายภาษาไทยของประเภทสถานที่ — ไล่จากเฉพาะเฉพาะไปกว้าง
 * (Google ให้ types หลายตัว เช่น ["tourist_attraction","place_of_worship","hindu_temple"])
 */
const TYPE_LABELS: Record<string, string> = {
  mosque: "มัสยิด",
  hindu_temple: "ศาสนสถาน",
  buddhist_temple: "วัด",
  church: "โบสถ์",
  cemetery: "สุสาน",
  museum: "พิพิธภัณฑ์",
  aquarium: "พิพิธภัณฑ์สัตว์น้ำ",
  zoo: "สวนสัตว์",
  park: "สวนสาธารณะ",
  natural_feature: "จุดธรรมชาติ",
  tourist_attraction: "จุดท่องเที่ยว",
  place_of_worship: "วัด/ศาสนสถาน",
  establishment: "จุดน่าสนใจ",
  point_of_interest: "จุดน่าสนใจ",
};

function labelOf(types: unknown): string | null {
  if (!Array.isArray(types)) return null;
  for (const t of types) {
    if (typeof t === "string" && TYPE_LABELS[t]) return TYPE_LABELS[t];
  }
  return null;
}

/** ระยะทางแบบ haversine (กม.) */
function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** ชื่อเหมือนกันไหม (ใช้ตัดตัวสถานที่เองออกจากรายการใกล้เคียง) */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const na = norm(a);
  const nb = norm(b);
  return (
    na === nb ||
    (na.length > 3 && nb.includes(na)) ||
    (nb.length > 3 && na.includes(nb))
  );
}

// ─────────────────────────────────────────────
//  1) Places (Legacy) — พิกัด
// ─────────────────────────────────────────────

/**
 * แปลง `opening_hours` ของ Places Legacy → ข้อมูลที่การ์ดใช้
 *
 * Place Search คืน `open_now` เป็น boolean (บางที่เป็นสตริง "true"/"false")
 * และ `weekday_text` เป็นตารางรายวันที่แปลภาษาไว้แล้ว
 */
function parseOpeningHours(raw: unknown): OpeningHours | null {
  if (!raw || typeof raw !== "object") return null;
  const oh = raw as { open_now?: unknown; weekday_text?: unknown };

  let openNow: boolean | null = null;
  if (typeof oh.open_now === "boolean") openNow = oh.open_now;
  else if (typeof oh.open_now === "string") {
    const t = oh.open_now.trim().toLowerCase();
    if (t === "true") openNow = true;
    else if (t === "false") openNow = false;
  }

  const weekdayText: string[] = Array.isArray(oh.weekday_text)
    ? oh.weekday_text
        .map((t: unknown) => String(t ?? "").trim())
        .filter((t: string) => t.length > 0)
    : [];

  if (openNow == null && weekdayText.length === 0) return null;
  return { openNow, weekdayText };
}

/** ค้นชื่อสถานที่ → พิกัด (TextSearch) */
async function textSearch(
  query: string,
  budget: TimeBudget
): Promise<GeoHit | null> {
  const q = query.trim();
  if (!q) return null;
  const url = `${PLACES}/textsearch/json?query=${encodeURIComponent(
    q
  )}&language=th&region=th&key=${config.places.googleKey}`;
  const data = await fetchJson(url, { method: "GET" }, budget);
  if (!data || String(data.status ?? "") !== "OK") return null;
  const first = data?.results?.[0];
  const lat = Number(first?.geometry?.location?.lat);
  const lon = Number(first?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    label: String(first?.name ?? "").trim() || q,
    // เวลาเปิด-ปิดมาพร้อมกับผลการค้นเลย (ไม่ต้องยิงเพิ่ม)
    openingHours: parseOpeningHours(first?.opening_hours),
  };
}

/** พิกัดของสถานที่ในคลิป (ชื่อ + อำเภอ + จังหวัด) */
export async function searchPlaceCoords(
  placeName: string | null | undefined,
  district: string | null | undefined,
  province: string | null | undefined,
  budget: TimeBudget
): Promise<GeoHit | null> {
  const name = (placeName ?? "").trim();
  if (!name) return null;
  return textSearch(
    [name, district, province].filter(Boolean).join(" "),
    budget
  );
}

/** พิกัดจุดอ้างอิง (ตัวอำเภอ / จังหวัด) สำหรับคำนวณระยะทาง */
export async function searchReferenceCoords(
  district: string | null | undefined,
  province: string | null | undefined,
  budget: TimeBudget
): Promise<GeoHit | null> {
  const dist = (district ?? "").trim();
  const prov = (province ?? "").trim();
  if (!dist && !prov) return null;
  const query = dist ? `อำเภอ${dist} ${prov}`.trim() : prov;
  const hit = await textSearch(query, budget);
  if (!hit) return null;
  return { lat: hit.lat, lon: hit.lon, label: dist ? `ตัวอำเภอ${dist}` : prov };
}

// ─────────────────────────────────────────────
//  2) Places (Legacy) — สถานที่ใกล้เคียง
// ─────────────────────────────────────────────

/** ประเภทที่ถามหา — "สถานที่แลนมาคหรือสถานที่ท่องเที่ยว" */
const NEARBY_TYPES = ["tourist_attraction", "place_of_worship"];

/**
 * ดึงสถานที่ใกล้เคียงจาก Google Places (Nearby Search)
 * -------------------------------------------------------------
 * คืน [] เสมอถ้าล้ม (ไม่ throw) — เป็นข้อมูลเสริม
 */
export async function fetchNearbyAttractions(opts: {
  placeName?: string | null;
  district?: string | null;
  province?: string | null;
  /** พิกัดสำรอง — ใช้เมื่อค้นชื่อไม่เจอ (หรือพิกัดที่หาเจอแล้ว) */
  fallbackLat?: number | null;
  fallbackLon?: number | null;
  /** งบเวลาที่เหลือ */
  budget?: TimeBudget;
}): Promise<NearbyAttraction[]> {
  if (!isPlacesConfigured()) return [];
  const budget = opts.budget ?? { left: TOTAL_BUDGET_MS };

  // 1) พิกัด — ถ้ามีพิกัดสำรองอยู่แล้ว (หาเจอจากรอบเส้นทาง) ใช้เลย
  //    ไม่งั้นค่อยค้นชื่อสถานที่ (ไม่ยิงซ้ำสองรอบ)
  let coords: GeoHit | null = null;
  const name = (opts.placeName ?? "").trim();
  if (
    typeof opts.fallbackLat === "number" &&
    typeof opts.fallbackLon === "number"
  ) {
    coords = { lat: opts.fallbackLat, lon: opts.fallbackLon, label: "" };
  } else if (name) {
    coords = await searchPlaceCoords(
      name,
      opts.district ?? null,
      opts.province ?? null,
      budget
    );
  }
  if (!coords) return [];

  // 2) Nearby Search — ถามทีละประเภท (Legacy รับได้ type เดียว) แล้วรวมกัน
  const items: NearbyAttraction[] = [];
  const seen = new Set<string>();
  for (const type of NEARBY_TYPES) {
    if (budget.left <= 500) break;
    const url = `${PLACES}/nearbysearch/json?location=${coords.lat},${coords.lon}&radius=${RADIUS_M}&type=${type}&language=th&region=th&key=${config.places.googleKey}`;
    const data = await fetchJson(url, { method: "GET" }, budget);
    if (!data || String(data.status ?? "") !== "OK") continue;
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    for (const r of results) {
      const nm = typeof r?.name === "string" ? r.name.trim() : "";
      if (!nm) continue;
      if (name && sameName(nm, name)) continue; // ตัวสถานที่เอง
      const key = nm.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const lat = Number(r?.geometry?.location?.lat);
      const lon = Number(r?.geometry?.location?.lng);
      const rating = Number.isFinite(Number(r?.rating)) ? Number(r.rating) : null;
      items.push({
        name: nm,
        label: labelOf(r?.types),
        distanceKm:
          Number.isFinite(lat) && Number.isFinite(lon)
            ? Math.round(distanceKm(coords.lat, coords.lon, lat, lon) * 10) / 10
            : null,
        rating,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
      });
    }
  }

  // เรียงตามระยะ — ใกล้สุดขึ้นก่อน (ไม่ต้องเชื่อลำดับที่ Google คืนมา)
  items.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  return items.slice(0, MAX_ITEMS);
}

// ─────────────────────────────────────────────
//  3) Routes API — เส้นทาง
// ─────────────────────────────────────────────

/** "1234s" → วินาที */
function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = Number.parseFloat(value.replace(/s$/i, ""));
  return Number.isFinite(n) ? n : null;
}

export interface RouteResult {
  /** กม. */
  km: number;
  /** นาที (รวมรถติด) */
  minutes: number;
  /** ชื่อถนน/เส้นทาง */
  via: string | null;
  /** มีสะพานข้ามที่เก็บค่าผ่าน */
  hasToll: boolean | null;
  /** คิวรถติด (วินาที) */
  trafficDelaySec: number | null;
}

/** field mask หลัก — มีค่าผ่านด้วย */
const ROUTE_MASK_FULL =
  "routes.distanceMeters,routes.duration,routes.staticDuration,routes.description,routes.travelAdvisory.tollInfo";
/** field mask สำรอง — ตัดค่าผ่านออก (ใช้ตอน API ปฏิเสธ field mask เดิม) */
const ROUTE_MASK_MIN =
  "routes.distanceMeters,routes.duration,routes.staticDuration,routes.description";

/**
 * คำนวณเส้นทางด้วย Google Routes API v2
 * -------------------------------------------------------------
 * POST https://routes.googleapis.com/directions/v2:computeRoutes
 * คีย์เดียวกับ Places (`X-Goog-Api-Key`) — ไม่ต้องเปิดบัญชีแยก
 *
 * ข้อมูลที่ดึงได้
 *   · distanceMeters  → ระยะทาง
 *   · duration        → เวลาเดินทาง (รวมรถติด เมื่อใช้ TRAFFIC_AWARE_OPTIMAL)
 *   · staticDuration  → เวลาเดินทาง (ไม่รวมรถติด) → ผลต่างคือคิวรถติด
 *   · description     → ชื่อถนน/เส้นทางที่ Google แนะนำ
 *   · tollInfo        → มีค่าผ่านไหม (ต้องขอ extraComputations: ["TOLLS"])
 */
export async function computeRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  budget: TimeBudget
): Promise<RouteResult | null> {
  if (budget.left <= 500) return null;
  const body = {
    origin: {
      location: { latLng: { latitude: from.lat, longitude: from.lon } },
    },
    destination: {
      location: { latLng: { latitude: to.lat, longitude: to.lon } },
    },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    // ค่าผ่าน — ถ้าไม่ขอ extraComputations นี้ API จะไม่ส่ง tollInfo กลับมา
    extraComputations: ["TOLLS"],
    language: "th",
    units: "METRIC",
  };

  const call = async (mask: string) => {
    const data = await fetchJson(
      ROUTES,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": config.places.googleKey,
          "X-Goog-FieldMask": mask,
        },
        body: JSON.stringify(body),
      },
      budget
    );
    return data?.routes?.[0] ?? null;
  };

  // field mask เดิมล้ม (เช่น API ไม่รองรับ tollInfo) → ลองอีกครั้งแบบไม่ขอค่าผ่าน
  let route = await call(ROUTE_MASK_FULL);
  if (!route && budget.left > 500) route = await call(ROUTE_MASK_MIN);
  if (!route) return null;

  const meters = Number(route.distanceMeters);
  if (!Number.isFinite(meters) || meters <= 0) return null;

  const seconds = parseDurationSeconds(route.duration);
  if (seconds == null) return null;

  const staticSeconds = parseDurationSeconds(route.staticDuration);
  // คิวรถติด = เวลาจริง − เวลาไม่รวมรถติด (ถ้าไม่มีข้อมูลรถติด → 0)
  const delay =
    staticSeconds != null ? Math.max(0, Math.round(seconds - staticSeconds)) : 0;

  const viaRaw =
    typeof route.description === "string" ? route.description.trim() : "";
  const tollInfo = route.travelAdvisory?.tollInfo ?? null;

  return {
    km: Math.round((meters / 1000) * 10) / 10,
    minutes: Math.round(seconds / 60),
    via: viaRaw && viaRaw.length <= 80 ? viaRaw : null,
    hasToll: tollInfo ? true : null,
    trafficDelaySec: delay,
  };
}

// ─────────────────────────────────────────────
//  4) รวมทั้งหมด
// ─────────────────────────────────────────────

export interface MapQuery {
  /** ชื่อสถานที่จากคลิป */
  placeName?: string | null;
  province?: string | null;
  district?: string | null;
  /** พิกัดสำรอง (เช่น ที่ผู้ใช้ตั้งเองในแอป) — ใช้เมื่อค้นชื่อไม่เจอ */
  fallbackLat?: number | null;
  fallbackLon?: number | null;
}

/**
 * รวบรวมข้อมูลแผนที่จาก Google
 * คืน null เมื่อไม่มีพิกัดที่เชื่อถือได้ (ข้ามเงียบ ๆ ไม่ทำให้สรุปคลิปล้ม)
 */
export async function getMapInfo(
  query: MapQuery,
  sharedBudget?: TimeBudget
): Promise<MapInfo | null> {
  if (!isPlacesConfigured()) return null;
  const budget = sharedBudget ?? { left: TOTAL_BUDGET_MS };
  const info: MapInfo = {
    lat: null,
    lon: null,
    routeKm: null,
    routeMinutes: null,
    routeFrom: null,
    routeVia: null,
    hasToll: null,
    trafficDelaySec: null,
    openingHours: null,
    credit: GOOGLE_MAP_CREDIT,
  };

  // 1) พิกัด
  let coords = await searchPlaceCoords(
    query.placeName ?? null,
    query.district ?? null,
    query.province ?? null,
    budget
  );
  if (
    !coords &&
    typeof query.fallbackLat === "number" &&
    typeof query.fallbackLon === "number"
  ) {
    coords = {
      lat: query.fallbackLat,
      lon: query.fallbackLon,
      label: "",
    };
  }
  if (!coords) return null;
  info.lat = coords.lat;
  info.lon = coords.lon;
  // เวลาเปิด-ปิดของสถานที่ (มาพร้อมกับพิกัด — ไม่ต้องยิงเพิ่ม)
  info.openingHours = coords.openingHours ?? null;

  // 2) เส้นทางจากจุดอ้างอิง (ตัวอำเภอ) — ข้ามถ้างบหมด
  const ref = await searchReferenceCoords(
    query.district ?? null,
    query.province ?? null,
    budget
  );
  if (ref && budget.left > 800) {
    const route = await computeRoute(ref, coords, budget);
    if (route) {
      info.routeKm = route.km;
      info.routeMinutes = route.minutes;
      info.routeFrom = ref.label;
      info.routeVia = route.via;
      info.hasToll = route.hasToll;
      info.trafficDelaySec = route.trafficDelaySec;
    }
  }

  return info;
}
