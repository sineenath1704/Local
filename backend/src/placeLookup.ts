/**
 * placeLookup.ts — ข้อมูล "สถานที่เจาะจง" จาก Google Places
 * -------------------------------------------------------------
 * โมเดลข้อมูลทั้งหมดที่เกี่ยวกับ "รู้จักสถานที่ 1 แห่ง" เก็บไว้ที่ไฟล์เดียว:
 *   ข้อความผู้ใช้ → ชื่อสถานที่ → search/details → gate → merge → cache
 *
 * ทำไมต้องมีไฟล์นี้
 *   ก่อนหน้านี้ฝั่งแชท/แพลนทริปไม่เคยยิง Google Places เลย — ข้อมูลสถานที่ที่
 *   แชทตอบได้มาจาก `community_places` อย่างเดียว ผู้ใช้ที่ถามชื่อที่ยังไม่มี
 *   ในทะเบียน → โมเดลตอบว่า "ไม่มีข้อมูล" แล้วจบ
 *
 * กฎเหล็กของไฟล์นี้
 *   1) **ไม่มีทางใช้ผลค้นอันแรกตรง ๆ** — ต้องผ่าน gate ทุกข้อ
 *      (ชื่อตรง · ไม่ปิดถาวร · อยู่ในขอบเขต) ไม่ผ่าน = ไม่มีข้อมูล
 *   2) **ไม่ throw** — ทุกฟังก์ชันคืน null/[] ได้ เพื่อให้แชทที่ใช้ได้อยู่แล้ว
 *      ไม่พังเมื่อ Google ล่ม/คิวต์
 *   3) **ข้อมูล host ชนะเสมอ** — Google เติมเฉพาะช่องที่ยังว่าง
 *   4) **ไม่เขียนกลับ `community_places`** — cache แยกต่างหาก
 *      (ดู supabase/migrations/add_google_place_cache.sql)
 *
 * ทดสอบ: `cd backend && npm run test:place-lookup` (ออฟไลน์ ไม่ใช้คีย์)
 */

import { createHash } from "node:crypto";

import { filterByScope, normalizeAdmin } from "./placeScope";
import type { LocationScope } from "./placeScope";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getPlaceDetails, searchPlaceCandidates } from "./routes/places";
import type { PlaceCandidate } from "./placeTypes";
import type { FolderPlace } from "./folderContext";
import type { PlaceContext } from "./tripPrompt";

/** ตาราง cache (ดู migration เดียวกัน) */
const CACHE_TABLE = "google_place_cache";

/**
 * log สำหรับไล่ว่า "ทำไมแชท/แพลนทริปไม่ได้ข้อมูลสถานที่"
 * -------------------------------------------------------------
 * พิมพ์ออกทาง stdout ของ backend (terminal ที่รันเซิร์ฟเวอร์ :1025)
 * 1 บรรทัดต่อเหตุการณ์ · ดูได้ด้วย `grep "\[placeLookup\]"`
 *
 * ปิดได้ชั่วคราวด้วย env `PLACES_LOOKUP_LOG=off` (เผื่อ log รกตอน production)
 */
export function placeLog(stage: string, detail: Record<string, unknown> = {}): void {
  if ((process.env.PLACES_LOOKUP_LOG ?? "").toLowerCase() === "off") return;
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  console.log(`[placeLookup] ${stage}${parts.length ? " · " + parts.join(" · ") : ""}`);
}

/** TTL (วัน) — search ปกติ */
const SEARCH_TTL_DAYS = 30;
/** TTL (วัน) — search ที่ไม่เจออะไรเลย (อย่าเก็บนาน เพราะข้อมูลจะเพิ่มทีหลัง) */
const EMPTY_SEARCH_TTL_DAYS = 1;
/** TTL (วัน) — details */
const DETAILS_TTL_DAYS = 14;

// ─────────────────────────────────────────────
//  ชนิดข้อมูลที่ส่งออก
// ─────────────────────────────────────────────

/**
 * ที่มาของข้อมูลสถานที่
 * - `community` = มาจากชุมชน/เจ้าของ (ยืนยันแล้ว)
 * - `google`    = มาจาก Google อย่างเดียว (ยังไม่มีใครยืนยัน)
 * - `mixed`     = บางส่วนจากชุมชน บางส่วนจาก Google
 */
export type PlaceSource = "community" | "google" | "mixed";

/**
 * สถานที่หนึ่งแห่งที่ผู้ใช้เลือกจากรายการ (ชื่อซ้ำหลายแห่ง)
 * รายการนี้คือสิ่งที่แอปเอาไปโชว์ให้ผู้ใช้แตะ
 */
export interface PlaceChoice {
  placeId: string;
  name: string;
  address: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  community: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  googleMapsUrl: string | null;
}

// ─────────────────────────────────────────────
//  cache
// ─────────────────────────────────────────────

/** ที่เก็บข้อมูลจาก Google — แยกเป็น interface เพื่อให้เทสต์ออฟไลน์ได้ */
export interface PlaceCache {
  /** ผลของคำค้น (ไม่พบใน cache = null) */
  getSearch(key: string): Promise<PlaceCandidate[] | null>;
  putSearch(key: string, query: string, candidates: PlaceCandidate[]): Promise<void>;
  /** ข้อมูลเต็มของสถานที่ 1 แห่ง (ไม่พบใน cache = null) */
  getDetails(placeId: string): Promise<PlaceCandidate | null>;
  putDetails(place: PlaceCandidate): Promise<void>;
}

/** สิ่งที่โมเดลนี้ต้องใารู้จากนอก — แทนค่าได้ในเทสต์ */
export interface PlaceLookupDeps {
  search: (query: string) => Promise<PlaceCandidate[]>;
  details: (placeId: string) => Promise<PlaceCandidate | null>;
  cache: PlaceCache | null;
  /** นับคำขอที่คิดเงิน (ไว้ดูงบ + เทสต์) */
  onBillable?: (kind: "search" | "details") => void;
}

function cacheKeyForSearch(query: string): string {
  const hash = createHash("sha1").update(normalizeAdmin(query)).digest("hex").slice(0, 24);
  return `search:${hash}`;
}

function cacheKeyForDetails(placeId: string): string {
  return `details:${placeId}`;
}

function ttlDaysFromEnv(): number {
  const raw = Number(process.env.PLACES_CACHE_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : SEARCH_TTL_DAYS;
}

function isExpired(fetchedAt: string | null | undefined, ttlDays: number): boolean {
  if (!fetchedAt) return true;
  const at = Date.parse(fetchedAt);
  if (Number.isNaN(at)) return true;
  return Date.now() - at > ttlDays * 24 * 60 * 60 * 1000;
}

/** แถวในตาราง cache → PlaceCandidate (ฝั่ง details) */
function rowToCandidate(row: any): PlaceCandidate | null {
  if (!row?.place_id) return null;
  return {
    name: row.name ?? "",
    address: row.address ?? "",
    placeId: row.place_id,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    province: row.province ?? null,
    district: row.district ?? null,
    subdistrict: row.subdistrict ?? null,
    types: Array.isArray(row.types) ? row.types : [],
    phone: row.phone ?? null,
    openingHours: row.opening_hours ?? null,
    rating: row.rating ?? null,
    userRatingCount: row.user_ratings_total ?? null,
    website: row.website ?? null,
    googleMapsUri: row.google_maps_uri ?? null,
    businessStatus: row.business_status ?? null,
    priceLevel: row.price_level ?? null,
  };
}

/** PlaceCandidate → แถวในตาราง cache (ฝั่ง details) */
function candidateToRow(place: PlaceCandidate): Record<string, unknown> {
  return {
    place_id: place.placeId,
    name: place.name,
    address: place.address ?? null,
    phone: place.phone ?? null,
    opening_hours: place.openingHours ?? null,
    website: place.website ?? null,
    rating: place.rating ?? null,
    user_ratings_total: place.userRatingCount ?? null,
    price_level: place.priceLevel ?? null,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    google_maps_uri: place.googleMapsUri ?? null,
    province: place.province ?? null,
    district: place.district ?? null,
    subdistrict: place.subdistrict ?? null,
    business_status: place.businessStatus ?? null,
    types: place.types ?? [],
  };
}

/**
 * cache จริง (Supabase) — ถ้ายังไม่ได้ตั้งค่า Supabase จะคืน null
 * → ระบบยังทำงานต่อได้ แค่ไม่มี cache (ยิง Google ทุกครั้ง)
 */
function createSupabasePlaceCache(): PlaceCache | null {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const readRow = async (cacheKey: string): Promise<any | null> => {
    try {
      const { data, error } = await admin
        .from(CACHE_TABLE)
        .select("*")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (error) {
        console.warn("[placeLookup] อ่าน cache ไม่สำเร็จ:", error.message);
        return null;
      }
      return (data as any) ?? null;
    } catch (err: any) {
      console.warn("[placeLookup] อ่าน cache ไม่สำเร็จ:", err?.message);
      return null;
    }
  };

  const writeRow = async (row: Record<string, unknown>): Promise<void> => {
    try {
      const { error } = await admin
        .from(CACHE_TABLE)
        .upsert(row as any, { onConflict: "cache_key" });
      if (error) console.warn("[placeLookup] เขียน cache ไม่สำเร็จ:", error.message);
    } catch (err: any) {
      console.warn("[placeLookup] เขียน cache ไม่สำเร็จ:", err?.message);
    }
  };

  return {
    async getSearch(key) {
      const row = await readRow(key);
      if (!row) return null;
      const list = Array.isArray(row.candidates) ? (row.candidates as PlaceCandidate[]) : [];
      const ttl = list.length === 0 ? EMPTY_SEARCH_TTL_DAYS : ttlDaysFromEnv();
      if (isExpired(row.fetched_at, ttl)) return null;
      return list;
    },
    async putSearch(key, query, candidates) {
      await writeRow({
        cache_key: key,
        kind: "search",
        name: query,
        candidates,
        fetched_at: new Date().toISOString(),
      });
    },
    async getDetails(placeId) {
      const row = await readRow(cacheKeyForDetails(placeId));
      if (!row) return null;
      if (isExpired(row.fetched_at, DETAILS_TTL_DAYS)) return null;
      return rowToCandidate(row);
    },
    async putDetails(place) {
      if (!place?.placeId) return;
      await writeRow({
        cache_key: cacheKeyForDetails(place.placeId),
        kind: "details",
        ...candidateToRow(place),
        fetched_at: new Date().toISOString(),
      });
    },
  };
}

// ─────────────────────────────────────────────
//  เครื่องมือชื่อ
// ─────────────────────────────────────────────

/** คำที่ใช้ได้แต่ไม่ใช่ "ชื่อสถานที่" — ต้องตัดทิ้งก่อนเอาไปค้น */
const NAME_STOP_WORDS = new Set([
  "ที่นี่",
  "ร้านนี้",
  "ที่นั่น",
  "ตรงนี้",
  "ที่ไหน",
  "อะไร",
  "อย่างไร",
  "ยังไง",
  "เปิด",
  "ปิด",
  "ราคา",
  "ค่าใช้จ่าย",
  "เวลา",
  "กี่โมง",
  "วันไหน",
  "เท่าไร",
  "เท่าไหร่",
  "โทร",
  "โทรหา",
  "ช่วย",
  "ถาม",
  "แนะนำ",
  "สถานที่",
  "ท่องเที่ยว",
  "แผนทริป",
  "วางแผน",
  "วางแผนทริป",
  "ทริป",
  "ทริปท่องเที่ยว",
  "วันละ",
  "คน",
  "กี่",
]);

/** คำที่ใช้นำหน้าในคำถาม — ตัดออกตอนเดาชื่อจากข้อความ */
const LEAD_NOISE = [
  "ช่วยวางแผน",
  "ช่วยหน่อย",
  "ช่วย",
  "ขอ",
  "ถาม",
  "รู้ไหม",
  "หน่อย",
  "ครับ",
  "คะ",
  "ค่ะ",
  "วางแผน",
  "แผนทริป",
  "ทริป",
  "เรื่อง",
  "แบบ",
  "ของ",
];

/** คำที่บอกว่าช่วงหลังของประโยคคือคำถาม ไม่ใช่ชื่อสถานที่ */
const NAME_CUT_WORDS = [
  "เปิด",
  "ปิด",
  "อยู่",
  "ราคา",
  "ค่าใช้จ่าย",
  "โทร",
  "โทรหา",
  "เวลา",
  "กี่โมง",
  "วันไหน",
  "วันละ",
  "เท่าไร",
  "เท่าไหร่",
  "ที่ไหน",
  "คิด",
  "อะไร",
  "แนะนำ",
  "เดินทาง",
  "ขับรถ",
  "นั่ง",
  "เที่ยว",
  "ดีไหม",
  "มีไหม",
  "ไหม",
  "ยังไง",
  "อย่างไร",
  "เกี่ยว",
  "ตั้งอยู่",
  "เข้า",
  "ถึง",
  "จาก",
  "และ",
  "ประมาณ",
];

/** ชื่อที่ใช้ค้นได้: ยาวพอสมควร + ไม่ใช่คำทั่วไป + มีตัวอักษรจริง */
export function isUsableName(name: string | null | undefined): boolean {
  const raw = (name ?? "").trim();
  if (!raw) return false;
  const key = normalizeAdmin(raw);
  if (key.length < 4) return false;
  if (NAME_STOP_WORDS.has(key)) return false;
  // ต้องมีตัวอักษรอย่างน้อย 2 ตัว (กันตัวเลขล้วน)
  const letters = key.match(/[ก-๙A-Za-z]/g);
  return (letters?.length ?? 0) >= 2;
}

/**
 * คำที่ขึ้นต้นประโยคแล้วบอกว่า "ผู้ใช้ไม่ได้ตั้งชื่อสถานที่" (เช่น "อยากเที่ยวที่ไหนดี")
 * → ไม่ต้องเดาชื่อจากประโยคแบบนี้
 */
const FILLER_PREFIXES = [
  "อยาก",
  "ช่วย",
  "ขอ",
  "ถาม",
  "แนะนำ",
  "หา",
  "รู้",
  "ควร",
  "ดู",
  "เช็ค",
  "เช็ก",
  "ไป",
  "มา",
  "จะ",
  "กำลัง",
  "ที่ไหน",
  "อะไร",
  "ที่นี่",
  "ร้านนี้",
  "สถานที่นี้",
  "ตรงนี้",
];

/** ชื่อที่ยาวที่สุดที่ "โผล่" ในข้อความ (ชื่อยาวกว่า = เจาะจงกว่า) */
function findLongestNameInText(text: string, names: string[]): string | null {
  const hay = normalizeAdmin(text);
  if (!hay) return null;
  let best: string | null = null;
  for (const raw of names ?? []) {
    const name = (raw ?? "").trim();
    if (!isUsableName(name)) continue;
    if (!hay.includes(normalizeAdmin(name))) continue;
    if (!best || name.length > best.length) best = name;
  }
  return best;
}

/**
 * จับคู่ชื่อแบบยืดหยุ่น (ใช้ตอนทางลัด "ชื่ออยู่ในข้อความตรง ๆ" ไม่ผ่าน)
 * -------------------------------------------------------------
 * เช่น ผู้ใช้พิมพ์ "แม่ยายโฮมเสตย์" แต่ในทะเบียนเป็น "แม่ยาย โฮมสเตย์"
 * → เทียบด้วยคะแนนความคล้าย (เกณฑ์เดียวกับทุกจุดในระบบ)
 */
function findFuzzyNameMatch(
  guessed: string,
  names: string[]
): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const raw of names ?? []) {
    const name = (raw ?? "").trim();
    if (!isUsableName(name)) continue;
    const score = nameSimilarity(guessed, name);
    if (score < NAME_SIMILARITY_THRESHOLD) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && name.length > best.name.length)
    ) {
      best = { name, score };
    }
  }
  return best;
}

/**
 * หารายการที่ชื่อ "ตรงกับ" ข้อความที่ผู้ใช้พิมพ์ (ทะเบียน/โฟลเดอร์)
 * -------------------------------------------------------------
 * - ชื่ออยู่ในข้อความตรง ๆ (เว้นวรรคไม่สำคัญ) → คะแนน 1
 * - สะกดผิด/เว้นวรรคผิด → เทียบคะแนนกับชื่อที่เดาจากข้อความ
 */
export function findNameMatches<T>(
  text: string,
  items: T[],
  getName: (item: T) => string | null | undefined
): { item: T; score: number }[] {
  const hay = foldForCompare(text ?? "");
  const guess = guessNameFromText(text ?? "");
  const out: { item: T; score: number }[] = [];
  for (const item of items ?? []) {
    const raw = (getName(item) ?? "").trim();
    if (!raw) continue;
    const nameKey = foldForCompare(raw);
    if (!nameKey) continue;
    // ทางลัดเดิม: ชื่อทั้งหมดอยู่ในข้อความ → เว้นวรรคไม่ทำให้พลาด
    if (hay && hay.includes(nameKey)) {
      out.push({ item, score: 1 });
      continue;
    }
    if (!guess) continue;
    const score = nameSimilarity(guess, raw);
    if (score >= NAME_SIMILARITY_THRESHOLD) out.push({ item, score });
  }
  return out;
}

/** ชื่อในเครื่องหมายคำพูด "..." */
function extractQuotedName(text: string): string | null {
  const re = /["“”«»']([^"“”«»']{2,60})["“”«»']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const candidate = (m[1] ?? "").trim();
    if (isUsableName(candidate)) return candidate;
  }
  return null;
}

/** ชื่อสถานที่ที่ซ่อนอยู่ในลิงก์ Google Maps */
function extractMapsUrlName(text: string): string | null {
  const m = /maps\/place\/([^\/?#\s]+)/i.exec(text);
  if (!m) return null;
  let raw = m[1] ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // คงค่าเดิมถ้า decode ไม่ได้
  }
  const name = raw.replace(/\+/g, " ").trim();
  return isUsableName(name) ? name : null;
}

/**
 * เดาชื่อสถานที่จากข้อความคำถาม
 * "บ้านปายเปิดกี่โมง" → "บ้านปาย"
 * ใช้เป็นทางสุดท้ายเท่านั้น (ต้องมีจังหวัดในบริบทด้วย ไม่งั้นไม่ใช้)
 */
export function guessNameFromText(text: string): string | null {
  const firstLine = (text ?? "").split(/\n|\?/)[0] ?? "";

  // ขึ้นต้นด้วยคำขอ/คำถามกว้าง ๆ = ผู้ใช้ไม่ได้ตั้งชื่อสถานที่ → ไม่เดา
  for (const filler of FILLER_PREFIXES) {
    if (firstLine.startsWith(filler)) return null;
  }

  let name = firstLine.trim();

  // ตัดท้ายที่คำที่บอกว่าเป็นคำถาม
  let cut = -1;
  for (const word of NAME_CUT_WORDS) {
    const idx = name.indexOf(word);
    if (idx > 0 && (cut === -1 || idx < cut)) cut = idx;
    // ขึ้นต้นด้วยคำถามเลย (เช่น "ราคาห้องพักเท่าไหร่") = ทั้งประโยคคือคำถาม
    // ไม่ใช่ชื่อสถานที่ → ไม่ต้องเดา (กันยิง Google เปล่า ๆ)
    if (idx === 0) return null;
  }
  if (cut > 0) name = name.slice(0, cut);

  // ตัดหน้าประโยคที่เป็นคำขอ
  let changed = true;
  while (changed) {
    changed = false;
    for (const noise of LEAD_NOISE) {
      if (name.startsWith(noise)) {
        name = name.slice(noise.length).trim();
        changed = true;
      }
    }
  }

  // ตัดเฉพาะอักขระที่ไม่ใช่ตัวอักษร/ตัวเลข/สระหรือวรรณยุกต์ไทย (ํ ์ ๊) ที่อยู่หัวท้าย
  // — วรรณยุกต์ไทยเป็นส่วนหนึ่งของตัวอักษร ถ้าตัดทิ้ง "แม่ยายโฮมเสตย์" จะกลายเป็น "แม่ยายโฮมเสตย"
  name = name
    .replace(/^[^\p{L}\p{N}\p{M}]+/u, "")
    .replace(/[^\p{L}\p{N}\p{M}]+$/u, "")
    .trim();
  // ชื่อที่ขึ้นต้นด้วยตัวเลข = ไม่ใช่ชื่อสถานที่ (เช่น "3 วัน")
  if (!/^[\p{L}]/u.test(name)) return null;
  return isUsableName(name) ? name : null;
}

// ─────────────────────────────────────────────
//  หาชื่อสถานที่ที่ผู้ใช้ถามถึง
// ─────────────────────────────────────────────

export type PlaceIntentSource =
  | "placeName"
  | "folder"
  | "registry"
  | "quoted"
  | "maps-url"
  | "heuristic";

export interface PlaceIntent {
  name: string | null;
  source: PlaceIntentSource | null;
  confidence: "exact" | "high" | "low";
  /** เหตุผลที่หาชื่อไม่ได้ (ใช้ log เท่านั้น) */
  reason?: string;
}

/**
 * หาชื่อสถานที่ที่ผู้ใช้ถามถึง จากข้อความ
 * -------------------------------------------------------------
 * ลำดับ: ชื่อที่แอปส่งมา → ชื่อในโฟลเดอร์ → ชื่อในทะเบียน → "..." →
 * ลิงก์ maps/place → เดาจากประโยค (ต้องมีจังหวัดในบริบทด้วย)
 */
export function extractPlaceIntent(args: {
  text: string;
  placeName?: string | null;
  folderNames?: string[];
  registryNames?: string[];
  hasProvince?: boolean;
}): PlaceIntent {
  const text = (args.text ?? "").trim();
  if (!text) return { name: null, source: null, confidence: "low", reason: "ไม่มีข้อความ" };

  const explicit = (args.placeName ?? "").trim();
  if (isUsableName(explicit)) {
    return { name: explicit, source: "placeName", confidence: "exact" };
  }

  const folderHit = findLongestNameInText(text, args.folderNames ?? []);
  if (folderHit) return { name: folderHit, source: "folder", confidence: "high" };

  const registryHit = findLongestNameInText(text, args.registryNames ?? []);
  if (registryHit) return { name: registryHit, source: "registry", confidence: "high" };

  const quoted = extractQuotedName(text);
  if (quoted) return { name: quoted, source: "quoted", confidence: "high" };

  const fromUrl = extractMapsUrlName(text);
  if (fromUrl) return { name: fromUrl, source: "maps-url", confidence: "high" };

  // เดาชื่อจากข้อความ — ทำได้แม้ไม่มีจังหวัดในบริบท
  // -------------------------------------------------------------
  // ถ้าไม่มีจังหวัด → gate จะไม่กรองจังหวัด แต่ยังกรอง "ชื่อตรง" เสมอ
  // และถ้าชื่อซ้ำหลายแห่งจะให้ผู้ใช้เลือก (ไม่ใช่เดาจุดเดียว)
  // (เดิมบังคับให้มีจังหวัด → แชทที่ไม่มีชุมชนในบริบทไม่ยิง Google เลย
  //  ทำให้ถามชื่อสถานที่ธรรมดาได้คำตอบว่า "ยังไม่มีข้อมูล" เสมอ)
  const guessed = guessNameFromText(text);
  if (guessed) {
    // สะกดผิด/เว้นวรรคไม่ตรง → ลองจับคู่กับทะเบียน/โฟลเดอร์ก่อน
    // (ชื่อที่ถูกต้องของเรา + ข้อมูลที่มีอยู่แล้ว ดีกว่าไปค้น Google ด้วยชื่อที่พิมพ์)
    const fuzzyFolder = findFuzzyNameMatch(guessed, args.folderNames ?? []);
    if (fuzzyFolder) {
      return { name: fuzzyFolder.name, source: "folder", confidence: "high" };
    }
    const fuzzyRegistry = findFuzzyNameMatch(guessed, args.registryNames ?? []);
    if (fuzzyRegistry) {
      return { name: fuzzyRegistry.name, source: "registry", confidence: "high" };
    }
    return { name: guessed, source: "heuristic", confidence: "low" };
  }

  return {
    name: null,
    source: null,
    confidence: "low",
    reason:
      "ไม่พบชื่อในโฟลเดอร์/ทะเบียน/เครื่องหมายคำพูด/ลิงก์แมพ " +
      "และเดาชื่อจากข้อความไม่ได้ (ไม่ยิง Google)",
  };
}

// ─────────────────────────────────────────────
//  gate — กันจับสถานที่ผิด
// ─────────────────────────────────────────────

/**
 * ชื่อจังหวัดที่ Google ใช้คนละชื่อกับที่เราใช้
 * -------------------------------------------------------------
 * Google Maps ยังใช้ชื่อจังหวัดแบบเก่าอยู่บางจังหวัด เช่น อำเภอปาย
 * ขึ้นที่อยู่ "จ.แม่ฮ่องสอน" (ชื่อเดิมของเชียงใหม่) — ถ้าเทียบตรง ๆ
 * สถานที่ในเชียงใหม่จะโดนตัดทิ้งหมด
 * → แปลงเป็นชื่อกลางก่อนเทียบ
 */
const PROVINCE_ALIASES: Record<string, string> = {
  "แม่ฮ่องสอน": "เชียงใหม่",
  "กรุงเทพ": "กรุงเทพมหานคร",
  "กรุงเทพฯ": "กรุงเทพมหานคร",
  "อยุธยา": "พระนครศรีอยุธยา",
};

/** ชื่อจังหวัด → รูปมาตรฐาน (เทียบกันได้) */
function canonicalProvince(p: string | null | undefined): string {
  // ตัดคำนำหน้าที่อาจติดมาด้วย เช่น "จังหวัดเชียงใหม่" / "จ.เชียงใหม่"
  let key = normalizeAdmin(p).replace(/^จังหวัด/, "").replace(/^จ(?=[ก-๙])/, "");
  if (!key) return "";
  return PROVINCE_ALIASES[key] ?? key;
}

/** อยู่ในจังหวัดที่ขอไหม (ถ้า Google ไม่ได้บอกจังหวัด → ไม่ตัดทิ้ง) */
function matchesProvince(c: PlaceCandidate, scope?: LocationScope | null): boolean {
  const want = canonicalProvince(scope?.province);
  if (!want) return true;
  const got = canonicalProvince(c.province);
  if (!got) return true;
  return got === want;
}

/**
 * ชื่อที่คนพิมพ์/พูด กับชื่อที่ Google คืนมา มักไม่ตรงกันเป๊ะ
 * -------------------------------------------------------------
 * เช่น ผู้ใช้พิมพ์ "แม่ยายโฮมเสตย์" แต่ Google มี "แม่ยาย โฮมสเตย์ ห้วยห้อม"
 * (คนละตัวสะกด + มีชื่อหมู่บ้านต่อท้าย) → ถ้าเทียบตรง ๆ จะตกทุกครั้ง
 * แล้วผู้ใช้ก็ยังโดนคำตอบว่า "ยังไม่มีข้อมูล" เหมือนเดิม
 *
 * วิธี: คะแนนความคล้ายของชื่อ (0–1) จากหลายมุม แล้วเอาคะแนนสูงสุด
 *   1) ชื่อเดียวกัน / เป็นส่วนหนึ่งของอีกอัน → 1.0 (เว้นวรรคไม่มีความหมาย)
 *   2) ชุดคำเหมือนกันแต่สลับลำดับ → 1.0
 *   3) เทียบบน "โครงหลักพยันธ์" (ตัดสระ/วรรณยุกต์ไทย) ด้วยระยะ Damerau
 *      (สลับตัวอักษรข้างกันนับ 1 ครั้ง) → สะกดผิดได้ แต่คนละชื่อไม่ผ่าน
 *   4) ฝั่งที่ยาวกว่ามี "หาง" เป็นชื่อหมู่บ้าน/ตำบลต่อท้าย → เทียบเฉพาะส่วนหน้า
 * — ยังไม่ใช่การเอา `results[0]` ตรง ๆ ตามกฎเดิม
 * — ถ้าชื่อต่างกันมาก (เช่น "โรงแรมแม่ยาย" vs "โรงแรมแม่นา") → ตก
 */

/** ตัดอักขระที่ไม่ใช่ตัวอักษร/ตัวเลขออก (ใช้เทียบชื่อ) */
function foldForCompare(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * สระ + วรรณยุกต์ไทยที่ต้องตัดออก (รวมตัวที่เป็น "ตัวอักษรแยก" เช่น ะ า เ แ โ ใ ไ)
 * ตัวที่เป็น combining mark จะถูกตัดด้วย `\p{M}` แยกอีกชั้น
 */
const THAI_VOWELS = /[ฤฦะ-฿เ-๎ๆ๏]/g;

/**
 * "โครงหลักพยันธ์" — ตัดสระ/วรรณยุกต์ไทยออก เหลือพยันธ์กับตัวเลข
 * -------------------------------------------------------------
 * คนพิมพ์ผิดมักผิดที่สระ/วรรณยุกต์ (เสดย์/สเตย์, เปิด/เปิ้ด) ไม่ใช่พยันธ์
 * → ตัดสระออกแล้วชื่อที่ต่างกันเล็กน้อยจะตรงกัน
 * แต่ "แม่ยาย" กับ "แม่นา" ยังต่างกันชัด → ไม่จับผิด
 */
function consonantSkeleton(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/\p{M}+/gu, "") // วรรณยุกต์/สระที่ผสมกับตัวอักษร
    .replace(THAI_VOWELS, "") // สระไทยที่เป็นตัวอักษรแยก
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** ระยะ Damerau-Levenshtein (สลับตัวอักษรข้างกันนับ 1 ครั้ง) */
function damerauDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () =>
    new Array<number>(bl + 1).fill(0)
  );
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
    }
  }
  return d[al][bl];
}

/** เกณฑ์คะแนนความคล้ายของชื่อ — ต่ำกว่านี้ = คนละสถานที่ */
export const NAME_SIMILARITY_THRESHOLD = 0.8;
/** ชื่อสั้นกว่านี้ไม่ยอมใกล้เคียง (กันจับสถานที่ผิด) */
const FUZZY_NAME_MIN_LENGTH = 8;
/** คะแนนขั้นต่ำตอนเทียบ "ชุดคำ" */
const WORD_SET_MIN_SCORE = 0.85;

/** เทียบคำเดี่ยว ๆ (ใช้ตอนเทียบชุดคำ) */
function wordSimilarity(a: string, b: string): number {
  const fa = foldForCompare(a);
  const fb = foldForCompare(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  if (fa.length >= 4 && fb.includes(fa)) return 1;
  if (fb.length >= 4 && fa.includes(fb)) return 1;
  const sa = consonantSkeleton(a);
  const sb = consonantSkeleton(b);
  if (sa.length < 3 || sb.length < 3) return 0;
  return Math.max(0, 1 - damerauDistance(sa, sb) / Math.max(sa.length, sb.length));
}

/**
 * ชุดคำเหมือนกันแต่สลับลำดับ (เช่น "โฮมสเตย์ แม่ยาย" ↔ "แม่ยาย โฮมสเตย์")
 * → ต้องมีทั้งสองฝั่งอย่างน้อย 2 คำ และจำนวนคำเท่ากัน
 */
function wordSetsMatch(a: string, b: string): boolean {
  const wa = String(a ?? "").trim().split(/\s+/).filter(Boolean);
  const wb = String(b ?? "").trim().split(/\s+/).filter(Boolean);
  if (wa.length < 2 || wb.length < 2 || wa.length !== wb.length) return false;
  const used = new Array<boolean>(wb.length).fill(false);
  for (const word of wa) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < wb.length; i++) {
      if (used[i]) continue;
      const s = wordSimilarity(word, wb[i]);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestScore < WORD_SET_MIN_SCORE) return false;
    used[bestIdx] = true;
  }
  return true;
}

/** เรียงตัวอักษรตามลำดับ (ใช้เทียบชื่อที่สลับลำดับคำ โดยไม่สนตำแหน่ง) */
function sortChars(value: string): string {
  return value.split("").sort().join("");
}

/**
 * คะแนนเทียบกับ "คำที่เริ่มต้น" ของอีกฝั่ง
 * -------------------------------------------------------------
 * ชื่อที่ยาวกว่าอาจมีหางเป็นชื่อหมู่บ้าน/ตำบลต่อท้าย
 * ("แม่ยาย โฮมสเตย์ ห้วยห้อม") → ลองตัดท้ายทีละคำแล้วเทียบใหม่
 * ตัดที่ขอบเขตคำเท่านั้น (ไม่ตัดกลางคำ) ไม่งั้น "โรงแรมแม่นา" จะเผลอ
 * ตรงกับ "โรงแรมแม่ยาย" (ต่างกันตรงกลางคำ ไม่ใช่หางท้าย)
 */
function bestWordPrefixScore(expectedSkeleton: string, otherName: string): number {
  const words = String(otherName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return 0; // ไม่มีคำแยก → ไม่มี "หาง" ที่ปลอดภัย
  let best = 0;
  for (let take = 1; take < words.length; take++) {
    const sp = consonantSkeleton(words.slice(0, take).join(" "));
    if (sp.length < 4) continue;
    const score =
      1 -
      damerauDistance(expectedSkeleton, sp) /
        Math.max(expectedSkeleton.length, sp.length);
    if (score > best) best = score;
  }
  return best;
}

/**
 * ชื่อที่ค้น "ตรงกับ" ชื่อที่ Google (หรือทะเบียน) มีไหม → คะแนน 0–1
 * - ตรงเป๊ะ / เป็นส่วนหนึ่งของอีกอัน → 1 (เว้นวรรค/ท้ายเติมไม่มีความหมาย)
 * - ชุดคำเหมือนแต่สลับลำดับ → 1
 * - สะกดผิด (ตัดสระแล้วเทียบโครงพยันธ์) → คะแนนสูง
 * - คนละชื่อ → คะแนนต่ำ
 */
export function nameSimilarity(expected: string, actual: string): number {
  const e = foldForCompare(expected);
  const a = foldForCompare(actual);
  if (!e || !a) return 0;
  if (e === a) return 1;
  // ชื่อที่ยาวกว่าเป็นส่วนหนึ่งของอีกอัน (ต้องยาวพอจะเป็นชื่อจริง)
  if (e.length >= 4 && a.includes(e)) return 1;
  if (a.length >= 4 && e.includes(a)) return 1;
  // ชุดคำเดียวกันแต่สลับลำดับ
  if (wordSetsMatch(expected, actual)) return 1;
  // ชื่อสั้นเกินไป → ตัดสินใจไม่ได้ (กันจับผิด)
  if (e.length < FUZZY_NAME_MIN_LENGTH || a.length < FUZZY_NAME_MIN_LENGTH) return 0;

  const se = consonantSkeleton(expected);
  const sa = consonantSkeleton(actual);
  if (se.length < 4 || sa.length < 4) return 0;
  const maxLen = Math.max(se.length, sa.length);
  // เทียบเต็ม (สลับตัวอักษรข้างกันนับ 1 ครั้ง)
  const full = 1 - damerauDistance(se, sa) / maxLen;
  // ฝั่งที่ยาวกว่าอาจมี "หาง" เป็นชื่อหมู่บ้าน/ตำบลต่อท้าย → ตัดท้ายทีละคำแล้วเทียบใหม่
  const tail = Math.max(
    bestWordPrefixScore(se, actual),
    bestWordPrefixScore(sa, expected)
  );
  // สลับลำดับคำ (ชื่อที่พิมพ์ไม่มีช่องว่าง) → เทียบแบบไม่สนลำดับตัวอักษร
  const unordered = 1 - damerauDistance(sortChars(se), sortChars(sa)) / maxLen;
  return Math.max(0, full, tail, unordered);
}

/**
 * ชื่อที่ค้น "ตรงกับ" ชื่อที่อีกฝั่งมีไหม (ใช้เกณฑ์เดียวกันทุกที่)
 */
export function nameLooksRight(expected: string, actual: string): boolean {
  return nameSimilarity(expected, actual) >= NAME_SIMILARITY_THRESHOLD;
}

/**
 * คัดผู้มีคัดจาก Google ให้เหลือแต่อันที่ "ใช่ได้"
 * -------------------------------------------------------------
 * 1. ชื่อที่ค้นต้องตรงกับชื่อที่ Google คืนมา (`nameSimilarity` ≥ 0.8)
 * 2. ปิดถาวร → ตก
 * 3. ผิดจังหวัด → ตก
 * 4. ตำบล/อำเภอ → ไล่จากกว้างไปแคบ (ถ้าไม่มีอันไหนตรงเลย เก็บของเดิมไว้
 *    ให้ผู้ใช้ตัดสินใจ — พฤติกรรมเดียวกับ flow เดิม)
 *
 * ไม่มีทางใช้ `raw[0]` ตรง ๆ เด็ดขาด
 */
export function pickCandidates(
  name: string,
  raw: PlaceCandidate[],
  scope?: LocationScope | null
): PlaceCandidate[] {
  return filterCandidatesWithTrace(name, raw, scope).picked;
}

/**
 * ผลของการกรองแบบมีร่องรอย — ใช้ตอน log ว่า "ทำไมผลค้นถูกตัดทิ้ง"
 */
export interface CandidateTrace {
  /** จำนวนผลดิบจาก Google */
  raw: number;
  /** ผ่านด้านชื่อ */
  nameMatched: number;
  /** ผ่านด้านชื่อแบบ "ใกล้เคียง" (สะกดต่าง / มีหางเป็นชื่อหมู่บ้าน) */
  fuzzyMatched: number;
  /** ผ่านด้านสถานะ (ไม่ปิดถาวร) */
  alive: number;
  /** ผ่านด้านจังหวัด */
  inProvince: number;
  /** ผ่านด้านตำบล/อำเภอ */
  afterScope: number;
  /** ผลที่ถูกตัด + เหตุผล */
  dropped: string[];
  /** ผลที่ "ผ่าน" แบบใกล้เคียง (ชื่อไม่ตรงเป๊ะ แต่คะแนนผ่านเกณฑ์) — ไม่ใช่ของที่ตก */
  fuzzy: string[];
}

/**
 * คัดผู้มีคัด + เก็บร่องรอยว่าตกที่ขั้นไหน
 * (เหมือน `pickCandidates` แต่คืนเหตุผลที่ตกด้วย ใช้ log เท่านั้น)
 */
export function filterCandidatesWithTrace(
  name: string,
  raw: PlaceCandidate[],
  scope?: LocationScope | null
): { picked: PlaceCandidate[]; trace: CandidateTrace } {
  const trace: CandidateTrace = {
    raw: (raw ?? []).length,
    nameMatched: 0,
    fuzzyMatched: 0,
    alive: 0,
    inProvince: 0,
    afterScope: 0,
    dropped: [],
    fuzzy: [],
  };
  if (!isUsableName(name)) {
    trace.dropped.push(`ชื่อที่ค้น "${name}" ใช้ไม่ได้ (สั้นเกิน/เป็นคำทั่วไป)`);
    return { picked: [], trace };
  }

  const named: PlaceCandidate[] = [];
  let fuzzyMatched = 0;
  for (const c of raw ?? []) {
    const score = nameSimilarity(name, c.name ?? "");
    if (score >= NAME_SIMILARITY_THRESHOLD) {
      named.push(c);
      if (score < 1) {
        fuzzyMatched++;
        trace.fuzzy.push(
          `${c.name} → ชื่อใกล้เคียงกับ "${name}" (คะแนน ${score.toFixed(3)})`
        );
      }
    } else {
      trace.dropped.push(
        `${c.name} → ชื่อไม่ตรงกับ "${name}" (คะแนน ${score.toFixed(3)})`
      );
    }
  }
  trace.nameMatched = named.length;
  trace.fuzzyMatched = fuzzyMatched;

  const alive = named.filter((c) => {
    if (c.businessStatus !== "CLOSED_PERMANENTLY") return true;
    trace.dropped.push(`${c.name} → ปิดถาวร`);
    return false;
  });
  trace.alive = alive.length;

  const inProvince = alive.filter((c) => {
    if (matchesProvince(c, scope)) return true;
    trace.dropped.push(
      `${c.name} → จังหวัดไม่ตรง (${c.province ?? "-"} ≠ ${scope?.province ?? "-"})`
    );
    return false;
  });
  trace.inProvince = inProvince.length;

  const scoped = filterByScope(inProvince, scope ?? undefined, false);
  trace.afterScope = scoped.length;
  if (scoped.length < inProvince.length) {
    trace.dropped.push(
      `${inProvince.length - scoped.length} รายการ → ตำบล/อำเภอไม่ตรงกับขอบเขต`
    );
  }

  return { picked: scoped.slice(0, 5), trace };
}

// ─────────────────────────────────────────────
//  แปลงข้อมูล
// ─────────────────────────────────────────────

/** ระดับราคาของ Google (0–4) → ข้อความ */
export function priceLevelLabel(level: number | null | undefined): string | null {
  switch (level) {
    case 0:
      return "ฟรี";
    case 1:
      return "฿";
    case 2:
      return "฿฿";
    case 3:
      return "฿฿฿";
    case 4:
      return "฿฿฿฿";
    default:
      return null;
  }
}

/** สถานะของสถานที่ → ข้อความ (null = ปกติ ไม่ต้องบอก) */
export function businessStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "CLOSED_TEMPORARILY") return "ปิดชั่วคราว";
  if (s === "CLOSED_PERMANENTLY") return "ปิดถาวร";
  return null;
}

/**
 * ป้ายไทยของประเภทสถานที่จาก Google
 * -------------------------------------------------------------
 * Places (New) คืน `primaryTypeDisplayName` มาให้แล้ว แต่ **Legacy ไม่คืน**
 * (คืนมาแค่รหัสประเภท เช่น "lodging") → ต้องแปลงเองถ้าอยากได้ "ประเภทสถานที่"
 * ใช้เฉพาะประเภทที่รู้จักเท่านั้น — ไม่รู้ → ไม่ใส่ (ห้ามเดา)
 */
const GOOGLE_TYPE_LABELS: Record<string, string> = {
  lodging: "ที่พัก",
  hotel: "โรงแรม",
  homestay: "โฮมสเตย์",
  guest_house: "ที่พัก",
  resort: "รีสอร์ท",
  restaurant: "ร้านอาหาร",
  food: "อาหาร",
  cafe: "คาเฟ่",
  bakery: "เบเกอรี่",
  bar: "บาร์",
  tourist_attraction: "จุดท่องเที่ยว",
  local_tourist_attraction: "จุดท่องเที่ยวท้องถิ่น",
  temple: "วัด",
  church: "โบสถ์",
  mosque: "มัสยิด",
  park: "สวนสาธารณะ",
  national_park: "อุทยานแห่งชาติ",
  waterfall: "น้ำตก",
  mountain: "ภูเขา",
  beach: "ชายหาด",
  natural_feature: "ธรรมชาติ",
  hiking: "เส้นทางเดินป่า",
  campground: "แคมป์ปิ้ง",
  camping: "แคมป์ปิ้ง",
  camp_site: "แคมป์ปิ้ง",
  museum: "พิพิธภัณฑ์",
  market: "ตลาด",
  shopping_mall: "ห้างสรรพสินค้า",
  store: "ร้านค้า",
  convenience_store: "ร้านสะดวกซื้อ",
  supermarket: "ซุปเปอร์มาร์เก็ต",
  pharmacy: "ร้านขายยา",
  hospital: "โรงพยาบาล",
  school: "โรงเรียน",
  university: "มหาวิทยาลัย",
  bank: "ธนาคาร",
  atm: "ตู้เอทีม",
  gas_station: "ปั๊มน้ำมัน",
  parking: "ที่จอดรถ",
  bus_station: "สถานีขนส่ง",
  train_station: "สถานีรถไฟ",
  airport: "สนามบิน",
  travel_agency: "บริษัทท่องเที่ยว",
  tourist_agency: "บริษัทท่องเที่ยว",
};

/** ประเภทที่ "ทั่วไป" — ไม่ใช่ประเภทของสถานที่ → ข้ามไป */
const GENERIC_GOOGLE_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "geocode",
  "premise",
  "subpremise",
  "street_address",
  "route",
  "floor",
  "room",
  "locality",
  "postal_code",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "administrative_area_level_4",
  "political",
  "country",
  "plus_code",
  "generic",
]);

/** ประเภทจาก Google (Legacy) → ป้ายไทย (null = ไม่รู้จัก → ไม่ใส่) */
export function categoryFromTypes(
  types: string[] | null | undefined,
  primaryType?: string | null
): string | null {
  const list = [primaryType, ...(types ?? [])].filter(Boolean) as string[];
  for (const t of list) {
    const key = String(t).toLowerCase().trim();
    if (!key || GENERIC_GOOGLE_TYPES.has(key)) continue;
    const label = GOOGLE_TYPE_LABELS[key];
    if (label) return label;
  }
  return null;
}

/** PlaceCandidate (จาก Google) → PlaceContext (ข้อมูลที่เข้า prompt) */
export function contextFromCandidate(c: PlaceCandidate): PlaceContext {
  const ctx: PlaceContext = {
    placeName: c.name,
    googlePlaceId: c.placeId,
  };
  if (c.address) ctx.address = c.address;
  if (c.phone) ctx.phone = c.phone;
  if (c.openingHours) ctx.openingHours = c.openingHours;
  if (c.website) ctx.website = c.website;
  if (c.province) ctx.province = c.province;
  if (c.district) ctx.district = c.district;
  if (c.subdistrict) ctx.subdistrict = c.subdistrict;
  if (c.googleMapsUri) ctx.googleMapsUrl = c.googleMapsUri;
  // พิกัด — เอาไว้ให้เอไaiตอบ "อยู่ตรงไหน" และให้ฝั่งแอปทำแผนที่/เส้นทางต่อได้
  if (c.latitude != null && c.longitude != null) {
    ctx.latitude = c.latitude;
    ctx.longitude = c.longitude;
  }
  if (c.rating != null) ctx.rating = c.rating;
  if (c.userRatingCount != null) ctx.userRatingsTotal = c.userRatingCount;
  const price = priceLevelLabel(c.priceLevel);
  if (price) ctx.priceLevel = price;
  const category =
    c.primaryTypeDisplayName || categoryFromTypes(c.types, c.primaryType);
  if (category) ctx.category = category;
  const status = businessStatusLabel(c.businessStatus);
  if (status) ctx.businessStatus = status;
  return ctx;
}

/** สถานที่ในโฟลเดอร์ → PlaceContext (ใช้ข้อมูลที่สรุปไว้ในโฟลเดอร์เลย) */
export function contextFromFolderPlace(p: FolderPlace): PlaceContext {
  const ctx: PlaceContext = { placeName: p.name };
  if (p.address) ctx.address = p.address;
  if (p.province) ctx.province = p.province;
  if (p.district) ctx.district = p.district;
  if (p.communityName) ctx.village = p.communityName;
  if (p.facts?.phone) ctx.phone = p.facts.phone;
  if (p.facts?.openingHours) ctx.openingHours = p.facts.openingHours;
  if (p.facts?.price) ctx.priceInfo = p.facts.price;
  if (p.facts?.facilities?.length) ctx.facilities = p.facts.facilities;
  if (p.facts?.rating != null) ctx.rating = p.facts.rating;
  return ctx;
}

/**
 * รวมข้อมูล host กับข้อมูล Google
 * -------------------------------------------------------------
 * กฎ: ของ host/คลิป ชนะเสมอ (ราคา เวลาเปิดแยกวัน ความจุ กติกา โซน สิ่งอำนวยความสะดวก
 * เจ้าของ) · Google เติมเฉพาะช่องที่ยังว่าง (เบอร์ เวลาเปิด เว็บ ระดับราคา)
 * · ฟิลด์ที่ Google เป็นเจ้าของ (เรตติง จำนวนรีวิว ประเภท สถานะ place id)
 *
 * `openingHours` ของ Google อยู่ใน `openingHours` เท่านั้น — ไม่มีทางไหลไป
 * `businessHours` (คนละความหมาย: businessHours = เวลาเปิดที่เจ้าของยืนยันแยกรายวัน)
 */
export function mergePlaceContext(
  base: PlaceContext | null | undefined,
  google: PlaceContext | null | undefined,
  source?: PlaceSource
): PlaceContext | null {
  if (!base && !google) return null;
  if (!base) return google ? { ...google, source: source ?? "google" } : null;
  if (!google) return base;

  const merged: PlaceContext = { ...base };

  // ── เติมเฉพาะช่องที่ยังว่าง ──
  if (!merged.phone && google.phone) merged.phone = google.phone;
  if (!merged.openingHours && google.openingHours) merged.openingHours = google.openingHours;
  if (!merged.website && google.website) merged.website = google.website;
  if (!merged.priceLevel && google.priceLevel) merged.priceLevel = google.priceLevel;
  if (!merged.address && google.address) merged.address = google.address;
  if (!merged.province && google.province) merged.province = google.province;
  if (!merged.district && google.district) merged.district = google.district;
  if (!merged.subdistrict && google.subdistrict) merged.subdistrict = google.subdistrict;
  if (!merged.village && google.village) merged.village = google.village;
  if (!merged.googleMapsUrl && google.googleMapsUrl) merged.googleMapsUrl = google.googleMapsUrl;
  if (merged.latitude == null && google.latitude != null) merged.latitude = google.latitude;
  if (merged.longitude == null && google.longitude != null) merged.longitude = google.longitude;

  // ── ฟิลด์ที่ Google เป็นเจ้าของ ──
  if (google.rating != null) merged.rating = google.rating;
  if (google.userRatingsTotal != null) merged.userRatingsTotal = google.userRatingsTotal;
  if (google.category) merged.category = google.category;
  if (google.businessStatus) merged.businessStatus = google.businessStatus;
  if (google.googlePlaceId) merged.googlePlaceId = google.googlePlaceId;

  merged.source = source ?? "mixed";
  return merged;
}

/** ข้อมูลที่ยังขาดและควรไปเอาจาก Google */
export function needsGoogleFill(ctx: PlaceContext | null | undefined): boolean {
  if (!ctx) return false;
  const phone = Boolean((ctx.phone ?? "").trim());
  const hours = Boolean((ctx.openingHours ?? "").trim());
  const web = Boolean((ctx.website ?? "").trim());
  return !(phone && hours && web);
}

// ─────────────────────────────────────────────
//  ชื่อชุมชน
// ─────────────────────────────────────────────

type CommunityRow = { name: string; province: string | null; district: string | null; subdistrict: string | null };

let communityRowsCache: { at: number; rows: CommunityRow[] } | null = null;

/** อ่านชื่อชุมชนทั้งหมด (แคช 1 ชั่วโมงในตัวเซิร์ฟเวอร์) */
async function loadCommunityRows(): Promise<CommunityRow[]> {
  const now = Date.now();
  if (communityRowsCache && now - communityRowsCache.at < 60 * 60 * 1000) {
    return communityRowsCache.rows;
  }
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  try {
    const { data, error } = await admin
      .from("communities")
      .select("name, province, district, subdistrict")
      .limit(200);
    if (error) return [];
    const rows = ((data ?? []) as any[]).map((r) => ({
      name: r.name ?? "",
      province: r.province ?? null,
      district: r.district ?? null,
      subdistrict: r.subdistrict ?? null,
    }));
    communityRowsCache = { at: now, rows };
    return rows;
  } catch {
    return [];
  }
}

/**
 * ชื่อชุมชนของตำบล/อำเภอนั้น (Google ไม่มีระดับ "ชุมชน" → เติมจากตาราง communities)
 */
export async function communityNameFor(area: {
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
}): Promise<string | null> {
  const sub = normalizeAdmin(area.subdistrict);
  const dist = normalizeAdmin(area.district);
  const prov = normalizeAdmin(area.province);
  if (!sub && !dist && !prov) return null;

  const rows = await loadCommunityRows();
  if (!rows.length) return null;

  const match = rows.find((r) => {
    if (prov && r.province && normalizeAdmin(r.province) !== prov) return false;
    if (sub) return normalizeAdmin(r.subdistrict) === sub;
    if (dist) return normalizeAdmin(r.district) === dist;
    return !r.province || normalizeAdmin(r.province) === prov;
  });
  return match?.name || null;
}

// ─────────────────────────────────────────────
//  ค้น + เติมข้อมูล
// ─────────────────────────────────────────────

export interface EnrichResult {
  /** ข้อมูลสถานที่ (null = หาไม่เจอ / ข้อมูลไม่ครบพอจะตอบ) */
  context: PlaceContext | null;
  /** ชื่อซ้ำหลายแห่ง → ให้ผู้ใช้เลือก */
  candidates: PlaceChoice[];
  /** จำนวนคำขอที่คิดเงินจริง */
  billableCalls: number;
  /** คำค้นที่ใช้ (ไว้ log) */
  query: string | null;
}

const EMPTY_ENRICH: EnrichResult = {
  context: null,
  candidates: [],
  billableCalls: 0,
  query: null,
};

/**
 * หาสถานที่ 1 แห่ง + ดึงข้อมูลมาให้ครบ
 * -------------------------------------------------------------
 * - มี `placeId` → details ตรง (ไม่ค้นชื่อ)
 * - มีชื่อ → search 1 ครั้ง → gate → ถ้าเหลือ 1 อัน details 1 ครั้ง
 *   → ถ้าเหลือหลายอัน คืนรายการให้ผู้ใช้เลือก (ยังไม่ยิง details ประหยัดเงิน)
 *
 * ไม่ throw เด็ดขาด — ล้มเหลวคือ "ไม่มีข้อมูล"
 */
export async function enrichPlace(args: {
  name?: string | null;
  placeId?: string | null;
  scope?: LocationScope | null;
  deps?: PlaceLookupDeps;
}): Promise<EnrichResult> {
  const deps = args.deps ?? defaultDeps();
  let calls = 0;

  const bill = (kind: "search" | "details") => {
    calls++;
    deps.onBillable?.(kind);
  };

  const searchGoogle = async (query: string): Promise<PlaceCandidate[]> => {
    bill("search");
    try {
      return await deps.search(query);
    } catch (err: any) {
      console.warn("[placeLookup] ค้น Google ไม่สำเร็จ:", err?.message);
      return [];
    }
  };

  const detailsGoogle = async (placeId: string): Promise<PlaceCandidate | null> => {
    bill("details");
    try {
      return await deps.details(placeId);
    } catch (err: any) {
      console.warn("[placeLookup] ดึงรายละเอียดจาก Google ไม่สำเร็จ:", err?.message);
      return null;
    }
  };

  // ── (1) ผู้ใช้เลือกสถานที่มาแล้ว → details ตรง ──
  const placeId = (args.placeId ?? "").trim();
  if (placeId) {
    const cached = (await deps.cache?.getDetails(placeId)) ?? null;
    const candidate = cached ?? (await detailsGoogle(placeId));
    if (!candidate) {
      placeLog("ดึงรายละเอียดไม่ได้", { placeId, fromCache: Boolean(cached) });
      return { ...EMPTY_ENRICH, billableCalls: calls };
    }
    if (!cached) {
      try {
        await deps.cache?.putDetails(candidate);
      } catch {
        // cache เขียนไม่ได้ = แค่ไม่มี cache ไม่ใช่ห้ามตอบ
      }
    }
    placeLog("ใช้สถานที่ที่ผู้ใช้เลือก", {
      placeId,
      name: candidate.name,
      fromCache: Boolean(cached),
    });
    return {
      context: contextFromCandidate(candidate),
      candidates: [],
      billableCalls: calls,
      query: null,
    };
  }

  // ── (2) ค้นด้วยชื่อ ──
  const query = (args.name ?? "").trim();
  if (!isUsableName(query)) {
    placeLog("ชื่อใช้ค้นไม่ได้ (สั้นเกิน/คำทั่วไป)", { query });
    return { ...EMPTY_ENRICH, billableCalls: calls };
  }

  const cacheKey = cacheKeyForSearch(query);
  const cachedSearch = (await deps.cache?.getSearch(cacheKey)) ?? null;
  const raw = cachedSearch ?? (await searchGoogle(query));
  if (!cachedSearch) {
    try {
      await deps.cache?.putSearch(cacheKey, query, raw);
    } catch {
      // cache เขียนไม่ได้ = แค่ไม่มี cache ไม่ใช่ห้ามตอบ
    }
  }

  const { picked, trace } = filterCandidatesWithTrace(query, raw, args.scope);
  placeLog("ค้นชื่อแล้ว", {
    query,
    scopeProvince: args.scope?.province ?? null,
    fromCache: Boolean(cachedSearch),
    ผลดิบ: trace.raw,
    ผ่านชื่อ: trace.nameMatched,
    ผ่านชื่อแบบใกล้เคียง: trace.fuzzyMatched,
    ผ่านสถานะ: trace.alive,
    ผ่านจังหวัด: trace.inProvince,
    ผ่านขอบเขต: trace.afterScope,
    รายการที่ผ่านแบบใกล้เคียง: trace.fuzzy.length ? trace.fuzzy.join(" | ") : undefined,
    ตก: trace.dropped.length ? trace.dropped.join(" | ") : undefined,
  });
  if (picked.length === 0) {
    return { context: null, candidates: [], billableCalls: calls, query };
  }

  // ชื่อซ้ำหลายแห่ง → ให้ผู้ใช้เลือกก่อน (ยังไม่ยิง details)
  if (picked.length > 1) {
    const candidates: PlaceChoice[] = [];
    for (const c of picked) {
      const community = await communityNameFor({
        subdistrict: c.subdistrict,
        district: c.district,
        province: c.province,
      });
      candidates.push(toPlaceChoice(c, community));
    }
    placeLog("ชื่อซ้ำหลายแห่ง → ให้ผู้ใช้เลือก", {
      query,
      จำนวน: candidates.length,
      รายการ: candidates.map((c) => c.name).join(" | "),
    });
    return { context: null, candidates, billableCalls: calls, query };
  }

  // เหลือ 1 อัน → ดึงข้อมูลเต็ม
  const only = picked[0];
  const cachedDetails = (await deps.cache?.getDetails(only.placeId)) ?? null;
  const full = cachedDetails ?? (await detailsGoogle(only.placeId));
  if (!full) {
    placeLog("ดึงรายละเอียดไม่ได้", { name: only.name, placeId: only.placeId });
    return { context: null, candidates: [], billableCalls: calls, query };
  }
  // Legacy details ไม่คืนประเภท (types) → ใช้ของที่ได้จากการค้นชื่อแทน
  const detail =
    full.types?.length || full.primaryType
      ? full
      : { ...full, types: only.types ?? [], primaryType: only.primaryType ?? null };
  if (!cachedDetails) {
    try {
      await deps.cache?.putDetails(detail);
    } catch {
      // cache เขียนไม่ได้ = แค่ไม่มี cache ไม่ใช่ห้ามตอบ
    }
  }

  return { context: contextFromCandidate(detail), candidates: [], billableCalls: calls, query };
}

/** PlaceCandidate → รายการที่แอปเอาไปโชว์ */
export function toPlaceChoice(c: PlaceCandidate, community?: string | null): PlaceChoice {
  return {
    placeId: c.placeId,
    name: c.name,
    address: c.address || null,
    province: c.province ?? null,
    district: c.district ?? null,
    subdistrict: c.subdistrict ?? null,
    community: community ?? null,
    rating: c.rating ?? null,
    userRatingsTotal: c.userRatingCount ?? null,
    googleMapsUrl: c.googleMapsUri ?? null,
  };
}

// ─────────────────────────────────────────────
//  สายหลัก — ไล่ลำดับแหล่งข้อมูล
// ─────────────────────────────────────────────

export interface LookupInput {
  /** ข้อความผู้ใช้รอบล่าสุด */
  text: string;
  /** ข้อมูลที่มีอยู่แล้ว (จากทะเบียน) */
  base?: PlaceContext | null;
  /** google place id ของ `base` (ถ้าทะเบียนมี) */
  basePlaceId?: string | null;
  /** สถานที่ในโฟลเดอร์ที่เลือกไว้ */
  folderPlaces?: FolderPlace[];
  /** ชื่อสถานที่ในทะเบียน (ใช้หาชื่อที่ผู้ใช้ถามถึง) */
  registryNames?: string[];
  /** place_id ที่ผู้ใช้เลือกจากรายการ */
  placeId?: string | null;
  /** ชื่อสถานที่ที่แอปส่งมา */
  placeName?: string | null;
  /**
   * ชื่อสถานที่ที่แชทนี้ "เกี่ยวกับ" (เช่น ชื่อในคลิปที่ผู้ใช้กลับมาแชท)
   * -------------------------------------------------------------
   * ใช้เป็นชื่อสำรอง ไม่ใช่ชื่อหลัก: ถ้าข้อความไม่ได้พูดถึงสถานที่อื่นเลย
   * (เช่น "ราคาเท่าไหร่" "มีที่จอดรถไหม") → ใช้ชื่อนี้แทนการเดาชื่อจากข้อความ
   * ถ้าข้อความพูดถึงสถานที่อื่นจริง ๆ → ชื่อนั้นยังชนะอยู่
   */
  anchorPlaceName?: string | null;
  /** ขอบเขตที่รู้ (จังหวัด/อำเภอ/ตำบล/ชุมชน) */
  scope?: LocationScope | null;
  deps?: PlaceLookupDeps;
}

export interface LookupResult {
  /** ข้อมูลสถานที่ที่ได้ (null = ไม่มี) */
  context: PlaceContext | null;
  /** ชื่อซ้ำหลายแห่ง → ให้ผู้ใช้เลือก */
  candidates: PlaceChoice[];
  /** ที่มาของข้อมูล (null = ยังไม่มีข้อมูลจาก Google) */
  source: PlaceSource | null;
  /** จำนวนคำขอที่คิดเงิน */
  billableCalls: number;
  /** ชื่อที่ค้นไปแล้วแต่ไม่เจอ (null = ยังไม่ได้ค้นชื่อ) */
  queriedName?: string | null;
}

/** เปิด/ปิดด้วย env: `PLACES_LOOKUP=off` → ปิดทั้งระบบ */
export function isLookupEnabled(): boolean {
  return (process.env.PLACES_LOOKUP ?? "").toLowerCase() !== "off";
}

/** deps ค่าเริ่มต้น = ของจริง (ค้น/รายละเอียด/ถ้วย) */
export function defaultDeps(): PlaceLookupDeps {
  return {
    search: (query: string) => searchPlaceCandidates(query),
    details: (placeId: string) => getPlaceDetails(placeId),
    cache: createSupabasePlaceCache(),
  };
}

/** สถานที่ในโฟลเดอร์ที่ผู้ใช้พิมพ์ถึง (ชื่อยาวกว่าชนะ) */
export function findFolderPlace(text: string, places: FolderPlace[]): FolderPlace | null {
  const list = places ?? [];
  const names = list.map((p) => p.name);
  const hit = findLongestNameInText(text, names);
  if (hit) return list.find((p) => p.name === hit) ?? null;
  // สะกดผิด/เว้นวรรคไม่ตรง → จับคู่ด้วยคะแนนความคล้าย
  const guessed = guessNameFromText(text);
  if (!guessed) return null;
  const fuzzy = findFuzzyNameMatch(guessed, names);
  if (!fuzzy) return null;
  return list.find((p) => p.name === fuzzy.name) ?? null;
}

/**
 * ไล่ลำดับแหล่งข้อมูล (ครอบทั้งหมดด้วย try/catch — ล้มเหลวก็แชทเดินต่อได้)
 * -------------------------------------------------------------
 *   1. placeId ที่ผู้ใช้เลือก → details ตรง
 *   2. ชื่อที่พิมพ์ตรงกับสถานที่ในโฟลเดอร์ → ใช้ข้อมูลในโฟลเดอร์
 *      (ถ้าขาดเบอร์/เวลาเปิด/เว็บ และมี place_id → details เติม)
 *   3. ทะเบียนมีข้อมูลอยู่แล้ว → ใช้ของทะเบียน (ขาดฟิลด์ → details เติม)
 *   4. ที่เหลือ → หาชื่อจากข้อความ → ค้น Google → gate → ตอบ/ให้เลือก
 */
export async function lookupPlace(input: LookupInput): Promise<LookupResult> {
  const deps = input.deps ?? defaultDeps();
  const empty: LookupResult = {
    context: null,
    candidates: [],
    source: null,
    billableCalls: 0,
  };
  if (!isLookupEnabled()) {
    placeLog("ระบบปิดอยู่ (PLACES_LOOKUP=off) → ไม่ค้น Google");
    return empty;
  }

  const tracked: PlaceLookupDeps = {
    ...deps,
    onBillable: (kind) => deps.onBillable?.(kind),
  };

  placeLog("เริ่มหาสถานที่", {
    ข้อความ: (input.text ?? "").slice(0, 120),
    จังหวัดในบริบท: input.scope?.province ?? null,
    อำเภอในบริบท: input.scope?.district ?? null,
    ชุมชนในบริบท: input.scope?.community ?? null,
    มีplaceId: Boolean((input.placeId ?? "").trim()),
    ชื่อที่ส่งมา: input.placeName ?? null,
    สถานที่ในโฟลเดอร์: (input.folderPlaces ?? []).length,
    ชื่อในทะเบียน: (input.registryNames ?? []).length,
  });

  let calls = 0;
  const track = (n: number) => {
    calls += n;
  };

  try {
    // ── (1) ผู้ใช้เลือกสถานที่จากรายการแล้ว ──
    const placeId = (input.placeId ?? "").trim();
    if (placeId) {
      const r = await enrichPlace({ placeId, scope: input.scope, deps: tracked });
      track(r.billableCalls);
      if (!r.context) return { ...empty, billableCalls: calls };
      // ผู้ใช้เลือกเอง = สถานที่ที่ถูกต้องเสมอ → ใช้ข้อมูลที่เลือก
      // ผนวกของทะเบียนได้เฉพาะเมื่อเป็น "สถานที่เดียวกัน" (place_id ตรงกัน)
      // ไม่งั้นข้อมูล host/เวลาเปิดของอีกแห่งจะไปปนกับอันที่เลือก
      const sameAsBase =
        Boolean((input.basePlaceId ?? "").trim()) &&
        (input.basePlaceId ?? "").trim() === placeId;
      const base = sameAsBase ? input.base : null;
      return {
        context: mergePlaceContext(base, r.context, base ? "mixed" : "google"),
        candidates: [],
        source: base ? "mixed" : "google",
        billableCalls: calls,
      };
    }

    // ── (2) ทะเบียนมีข้อมูลอยู่แล้ว ──
    // ข้อมูลทะเบียนมีของ host/คลิปครบกว่าโฟลเดอร์ → ใช้ของทะเบียนก่อน
    if (input.base) {
      const baseId = (input.basePlaceId ?? "").trim();
      placeLog("ใช้ข้อมูลทะเบียน (ไม่ต้องค้นชื่อ)", {
        ชื่อ: input.base.placeName,
        มีplace_id: Boolean(baseId),
        ต้องเติมจากGoogle: baseId ? needsGoogleFill(input.base) : false,
      });
      if (baseId && needsGoogleFill(input.base)) {
        const r = await enrichPlace({ placeId: baseId, scope: input.scope, deps: tracked });
        track(r.billableCalls);
        if (r.context) {
          return {
            context: mergePlaceContext(input.base, r.context, "mixed"),
            candidates: [],
            source: "mixed",
            billableCalls: calls,
          };
        }
      }
      return {
        context: input.base,
        candidates: [],
        source: null,
        billableCalls: calls,
      };
    }

    // ── (3) สถานที่ในโฟลเดอร์ ──
    // โฟลเดอร์มีชื่อ + ข้อมูลที่สรุปไว้แล้ว → ใช้ได้เลย ไม่ต้องค้นชื่อซ้ำ
    const folderHit = findFolderPlace(input.text, input.folderPlaces ?? []);
    if (folderHit) {
      placeLog("ใช้ข้อมูลในโฟลเดอร์ (ไม่ต้องค้นชื่อ)", { ชื่อ: folderHit.name });
      const folderCtx = contextFromFolderPlace(folderHit);
      let context = mergePlaceContext(folderCtx, null);
      let source: PlaceSource | null = null;
      // เติมข้อมูลที่ขาดจาก Google (ถ้ามี place_id ของทะเบียน)
      if (folderHit.registryPlaceId && needsGoogleFill(context)) {
        const r = await enrichPlace({
          placeId: folderHit.registryPlaceId,
          scope: input.scope,
          deps: tracked,
        });
        track(r.billableCalls);
        if (r.context) {
          context = mergePlaceContext(context, r.context, "mixed");
          source = "mixed";
        }
      }
      return { context, candidates: [], source, billableCalls: calls };
    }

    // ── (4) หาชื่อจากข้อความ → ค้น Google ──
    const intent = extractPlaceIntent({
      text: input.text,
      placeName: input.placeName,
      folderNames: (input.folderPlaces ?? []).map((p) => p.name),
      registryNames: input.registryNames ?? [],
      hasProvince: Boolean(input.scope?.province),
    });
    placeLog("หาชื่อสถานที่จากข้อความ", {
      ชื่อที่ได้: intent.name,
      มาจาก: intent.source,
      มีจังหวัดในบริบท: Boolean(input.scope?.province),
      เหตุผลที่ไม่ได้: intent.reason,
    });
    // ชื่อสถานที่ที่แชทนี้เกี่ยวกับ (จากคลิป) → ใช้แทนการเดาชื่อจากข้อความ
    // เฉพาะเมื่อข้อความไม่ได้พูดถึงที่ไหนเลย (ข้อความตามมาในแชทคลิปมักเป็น
    // "ราคาเท่าไหร่" "มีที่จอดรถไหม" → ไม่มีชื่อให้เดา)
    const anchor = (input.anchorPlaceName ?? "").trim();
    const anchorUsable = isUsableName(anchor);
    if (!intent.name && anchorUsable) {
      placeLog("ไม่พบชื่อในข้อความ → ใช้ชื่อสถานที่ของแชท (จากคลิป)", {
        ชื่อ: anchor,
      });
    }
    const searchName = intent.name ?? (anchorUsable ? anchor : null);
    if (!searchName) return { ...empty, billableCalls: calls };

    const r = await enrichPlace({ name: searchName, scope: input.scope, deps: tracked });
    track(r.billableCalls);
    if (r.context) {
      placeLog("ได้ข้อมูลสถานที่จาก Google", {
        ชื่อ: r.context.placeName,
        ที่มา: "google",
        คำขอที่คิดเงิน: calls,
      });
      return {
        context: mergePlaceContext(null, r.context, "google"),
        candidates: [],
        source: "google",
        billableCalls: calls,
      };
    }
    // เดาชื่อจากข้อความได้ แต่ Google ไม่รู้จัก (เช่น "มีที่จอดรถ" ที่ถูกตัด
    // เหลือเป็นคำถาม) → ลองใช้ชื่อสถานที่ของแชท (จากคลิป) แทน
    // (ค้นจาก cache เดิม → ไม่เสียค่าใช้จ่ายซ้ำ)
    if (anchorUsable && searchName !== anchor && r.candidates.length === 0) {
      const anchorResult = await enrichPlace({
        name: anchor,
        scope: input.scope,
        deps: tracked,
      });
      track(anchorResult.billableCalls);
      if (anchorResult.context) {
        placeLog("ชื่อที่เดาจากข้อความไม่พบ → ใช้ชื่อสถานที่ของแชท (จากคลิป)", {
          ชื่อ: anchorResult.context.placeName,
          คำขอที่คิดเงิน: calls,
        });
        return {
          context: mergePlaceContext(null, anchorResult.context, "google"),
          candidates: [],
          source: "google",
          billableCalls: calls,
        };
      }
    }
    placeLog("ไม่ได้ข้อมูลสถานที่", {
      ชื่อที่ค้น: searchName,
      ผู้มีคัด: r.candidates.length,
      คำขอที่คิดเงิน: calls,
    });
    return {
      context: null,
      candidates: r.candidates,
      source: null,
      billableCalls: calls,
      queriedName: anchorUsable && searchName !== anchor ? anchor : searchName,
    };
  } catch (err: any) {
    // ข้อมูลสถานที่เป็นส่วนเสริม — ล้มเหลวไม่ได้ทำให้แชทใช้ไม่ได้
    console.warn("[placeLookup] ดูข้อมูลสถานที่ไม่สำเร็จ:", err?.message);
    return { ...empty, billableCalls: calls };
  }
}

/**
 * เติมข้อมูล Google ให้ชุดจุดหมาย (ใช้ในแพลนทริป)
 * -------------------------------------------------------------
 * จุดหมายที่ค้นไม่เจอ / ไม่ผ่าน gate → ไม่เอามาใส่ (ห้ามเดา)
 */
export async function enrichDestinations(args: {
  names: string[];
  scope?: LocationScope | null;
  max?: number;
  deps?: PlaceLookupDeps;
}): Promise<{ contexts: PlaceContext[]; billableCalls: number }> {
  const deps = args.deps ?? defaultDeps();
  const max = args.max ?? 4;
  const contexts: PlaceContext[] = [];
  let calls = 0;

  for (const name of args.names ?? []) {
    if (contexts.length >= max) break;
    const trimmed = (name ?? "").trim();
    if (!isUsableName(trimmed)) continue;
    const r = await enrichPlace({ name: trimmed, scope: args.scope, deps });
    calls += r.billableCalls;
    if (r.context) contexts.push(r.context);
  }

  placeLog("เติมข้อมูลจุดหมายในแผนทริป", {
    จุดหมายทั้งหมด: (args.names ?? []).length,
    ได้ข้อมูล: contexts.length,
    รายการ: contexts.map((c) => c.placeName).join(" | "),
    คำขอที่คิดเงิน: calls,
  });

  return { contexts, billableCalls: calls };
}
