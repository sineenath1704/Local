/**
 * โฟลเดอร์คลิป → รายชื่อ "สถานที่ที่โฟลเดอร์นี้ไป"
 * =============================================================
 * ทำหน้าที่เหมือน `communityContext.ts` แต่อ่านจากโฟลเดอร์คลิปที่ผู้ใช้
 * กด save ไว้ (คลิปของคนอื่น) แล้วแปลงเป็น "สถานที่" ที่มีข้อมูลจริง
 *
 * ทำไมต้องอยู่ฝั่ง backend
 *   · ทะเบียน `community_places` อ่านด้วย anon key ไม่ได้ (RLS ไม่ให้ —
 *     ดูคอมเมนต์ที่ `src/services/communityService.ts:185`) → ต้องใช้
 *     service_role ของ backend
 *   · คลิปในโฟลเดอร์อาจเป็นของคนอื่น → ต้องอ่าน `videos.ai_summary`
 *     (ไม่ใช่ `video_ai_analyses` ที่เป็น owner-only)
 *   · หน้าโฟลเดอร์ / แชท / แพลนทริป ต้องเห็นรายการเดียวกัน → มีที่เดียว
 *     ที่คำนวณ (อื่นนั้นคำนวณเอง = ต่างกันเองเงียบ ๆ)
 *
 * กฎการจับคู่ (ทะเบียนก่อน → ข้อความในคลิปเป็นสำรอง)
 *   1. ชื่อตรงเป๊ะหลัง normalize                    → registry-exact
 *   2. ชื่อครอบ/ถูกครอบ + จังหวัดตรงกัน            → registry-name
 *   3. พิกัดใกล้กัน ≤ 150 ม. (สองฝั่งต้องมีพิกัด) → registry-proximity
 *   4. ไม่เจอ                                       → clip-text (ยังไม่ยืนยัน)
 *
 * **ไม่ยิง Google Places เพิ่ม** — จับคู้ด้วยชื่อ/พิกัดจากข้อมูลที่มีอยู่
 * (PLAN_PLACE_MATCHING.md §8)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────
//  ขนาดสูงสุด (กัน prompt บวมจนช้า หรือเกินขนาด JSON 1 MB ที่ app.ts:33)
// ─────────────────────────────────────────────────────────────
export const MAX_FOLDER_CLIPS = 40;
export const MAX_FOLDER_PLACES = 25;
export const MAX_REGISTRY_ROWS = 600;
/** ระยะที่ถือว่า "ที่เดียวกัน" (เมตร) */
export const PROXIMITY_METERS = 150;
/** ชื่อสั้นกว่านี้ไม่เอามาเทียบ — กันชื่อสั้นไปตรงกันมั่ว */
const MIN_NAME_LENGTH = 3;

// ─────────────────────────────────────────────────────────────
//  ชนิดข้อมูล
// ─────────────────────────────────────────────────────────────

export type MatchKind =
  | "registry-exact"
  | "registry-name"
  | "registry-proximity"
  | "clip-text";

/** ข้อมูลที่ตัดทอนจาก `videos.ai_summary` (jsonb) */
export interface FolderClipSummaryPlace {
  place_name?: string | null;
  community?: string | null;
  location?: {
    province?: string | null;
    district?: string | null;
    subdistrict?: string | null;
    gps?: string | null;
  } | null;
  price_info?: {
    weekday?: string | null;
    weekend?: string | null;
    currency?: string | null;
    level?: string | null;
  } | null;
  contact?: {
    phone?: string | null;
    facebook?: string | null;
    line?: string | null;
    website?: string | null;
  } | null;
  opening_hours?: string | null;
  capacity?: Record<string, string | null> | null;
  rules?: string[];
  areas?: string[];
  facilities?: string[];
  highlights?: string[];
  category?: string[];
  activities?: string[];
  confidence?: Record<string, unknown> | null;
}

export interface FolderClipSummary {
  text?: string | null;
  visualDescription?: string | null;
  place?: FolderClipSummaryPlace | null;
}

export interface FolderClip {
  videoId: string;
  caption: string | null;
  hashtags: string[];
  placeName: string | null; // videos.place_name
  locationName: string | null; // videos.location_name
  province: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  thumbnailUrl: string | null;
  summary: FolderClipSummary | null;
}

export interface FolderPlaceFacts {
  price?: string | null;
  openingHours?: string | null;
  phone?: string | null;
  facilities?: string[];
  highlights?: string[];
  rating?: number | null;
}

export interface FolderPlace {
  /** กุญแจ dedupe — "r:<place_id>" (ทะเบียน) หรือ "a:<ชื่อ>|<จังหวัด>" (จากคลิป) */
  key: string;
  /** ชื่อที่แสดง (ชื่อในทะเบียน ถ้าจับคู่ได้) */
  name: string;
  /** registry = ยืนยันในทะเบียนแล้ว / clip = มาจากข้อความในคลิป */
  source: "registry" | "clip";
  matchKind: MatchKind;
  registryPlaceId: string | null;
  communityId: string | null;
  communityName: string | null;
  address: string | null;
  province: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  clipCount: number;
  videoIds: string[];
  facts: FolderPlaceFacts;
}

export interface FolderContext {
  folderId: string;
  folderName: string;
  clipCount: number;
  clips: FolderClip[];
  places: FolderPlace[];
  /** จับคู่ทะเบียนได้กี่แห่ง */
  registryHits: number;
  /** มาจากข้อความในคลิปกี่แห่ง */
  aiFallbacks: number;
  /** อ่านคอลัมน์/ตารางบางส่วนไม่ได้ → ข้อมูลไม่ครบ */
  partial: boolean;
}

/** แถวใน `community_places` (ชุดคอลัมน์ที่เราอ่าน) */
export interface RegistryRow {
  id?: string | null;
  place_id?: string | null;
  place_name?: string | null;
  formatted_address?: string | null;
  province?: string | null;
  district?: string | null;
  subdistrict?: string | null;
  village?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  opening_hours?: string | null;
  price_info?: string | null;
  price_level?: string | null;
  rating?: number | null;
  website?: string | null;
  community_id?: string | null;
  facilities?: unknown;
}

// ─────────────────────────────────────────────────────────────
//  ฟังก์ชันบริสุทธิ์ (ทดสอบได้โดยไม่ต้องมี credential)
// ─────────────────────────────────────────────────────────────

/**
 * คำนำหน้าแบบราชการ (จังหวัด/จ./อำเภอ/อ./ตำบล/ต./เขต/แขวง)
 *
 * "จ.เชียงใหม่" → "เชียงใหม่" — ชื่อจังหวัดที่มีได้หลายรูปแบบ
 * ต้องแปลงให้เหมือนกันก่อนเทียบ
 *
 * ตัดได้ทุกตำแหน่งที่ตามด้วยตัวคั่น (ไม่ใช่แค่ต้นบรรทัด) เพราะชื่อสถานที่
 * มักมีที่อยู่ติดมา เช่น "อ.เมือง ต.สุเทพ" → "เมืองสุเทพ"
 *
 * "เขต/แขวง" ตัดได้เฉพาะเมื่อถัดไปเป็นช่องว่าง/ตัวเลข/จบข้อความ
 * (ไม่งั้น "เขตสวน" จะกลายเป็น "สวน")
 */
const ADMIN_PREFIX_RE =
  /(^|[\s\-/·,|()\[\]])(?:จังหวัด|จ\.|อำเภอ|อ\.|ตำบล|ต\.|(?:เขต|แขวง)(?=\s|\d|$))\s*/g;

/**
 * คำนำหน้าที่พบบ่อยและไม่ใช่ส่วนที่แยกสถานที่ออกจากกัน
 * (คนเขียนชื่อร้านไม่เหมือนกัน) — ตัดออกทั้งสองฝั่งจึงเทียบกันได้
 *
 * ⚠️ เรียงจากยาวไปสั้น — "ร้านอาหาร" ต้องมาก่อน "ร้าน" ไม่งั้นจะเหลือ "อาหาร..."
 * ⚠️ "คาเฟ่" ต้องมาก่อน "คาเฟ" ไม่งั้น "คาเฟ่มะลิ" จะเหลือ "่มะลิ" (สระค้าง)
 */
const GENERIC_PREFIXES = [
  "ร้านอาหาร",
  "บ้านพัก",
  "ที่พัก",
  "คาเฟ่",
  "แกรนดี้",
  "ร้าน",
  "คาเฟ",
  "cafe",
  "shop",
];

/**
 * ทำให้ชื่อไทย/อังกฤษเทียบกันได้
 * -------------------------------------------------------------
 * **ต้องเก็บสระและวรรณยุกต์ไว้** — "บ้าน" ≠ "บาน" ถ้าตัดทิ้งจะเทียบผิด
 * (`\p{M}` = combining marks, `\p{L}` = ตัวอักษร, `\p{N}` = ตัวเลข)
 */
export function normalizePlaceName(raw: string | null | undefined): string {
  const base = (raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(ADMIN_PREFIX_RE, " ")
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "")
    .trim();
  if (!base) return "";

  // ตัดคำนำหน้าทั่วไปออก (วนซ้ำได้ — "ร้านร้านกาแฟ" → "กาแฟ")
  let out = base;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(
      new RegExp(`^(?:${GENERIC_PREFIXES.join("|")})`, "i"),
      ""
    );
    if (next === out) break;
    out = next;
  }
  // ถ้าตัดจนเหลือสั้นเกินไป (เช่น "ร้าน") ให้ใช้ชื่อเดิมที่ยังมีความหมาย
  if (out.length < MIN_NAME_LENGTH) return base;
  return out;
}

/** ระยะห่างระหว่างสองพิกัด (เมตร) — สูตร haversine */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** ชื่อที่คลิปนี้มี เรียงตามความน่าเชื่อถือ */
export function clipNameCandidates(clip: {
  placeName?: string | null;
  locationName?: string | null;
  summary?: FolderClipSummary | null;
}): string[] {
  const p = clip.summary?.place ?? null;
  const raw = [
    p?.place_name,
    clip.placeName,
    p?.community,
    clip.locationName,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = (r ?? "").trim();
    if (!t) continue;
    const key = normalizePlaceName(t);
    if (!key || key.length < MIN_NAME_LENGTH) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.trim());
  }
  return out;
}

interface MatchHit {
  row: RegistryRow;
  kind: MatchKind;
  score: number;
  nameLength: number;
}

/**
 * จับคู่คลิปหนึ่งกับทะเบียน
 * -------------------------------------------------------------
 * เรียงความสำคัญ: ชื่อตรง > ชื่อครอบ > พิกัดใกล้
 * และถ้าตรงกันมากกว่าหนึ่งแถว → **ชื่อที่ยาวกว่าชนะ** (เจาะจงกว่า)
 * เช่น "บ้านปาย" กับ "บ้านปายใหม่" → ต้องได้ "บ้านปายใหม่"
 * (กฎเดียวกับที่แชทใช้ที่ `backend/src/routes/aiChat.ts:265-271`)
 */
export function matchClipToRegistry(
  clip: {
    placeName?: string | null;
    locationName?: string | null;
    province?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    summary?: FolderClipSummary | null;
  },
  registry: RegistryRow[]
): { row: RegistryRow; kind: MatchKind; score: number } | null {
  const names = clipNameCandidates(clip);
  if (!names.length) return null;

  // จังหวัดของคลิป — ใช้ `videos.province` ก่อน ถ้าไม่มีค่อยใช้จังหวัดในสรุป AI
  const clipProvince = normalizePlaceName(
    clip.province ?? clip.summary?.place?.location?.province ?? ""
  );
  const hits: MatchHit[] = [];

  for (const row of registry) {
    const regName = (row.place_name ?? "").trim();
    const regKey = normalizePlaceName(regName);
    if (!regKey || regKey.length < MIN_NAME_LENGTH) continue;

    // เกตรองัด: ชื่อสถานที่ไทยซ้ำข้ามจังหวัดเยอะมาก
    // ถ้าคลิปมีจังหวัด → ต้องตรงกัน ถึงจะเทียบด้วยชื่อได้
    if (clipProvince) {
      const rowProvince = normalizePlaceName(row.province);
      if (rowProvince && rowProvince !== clipProvince) continue;
    }

    for (const name of names) {
      const key = normalizePlaceName(name);
      if (!key || key.length < MIN_NAME_LENGTH) continue;
      if (key === regKey) {
        hits.push({ row, kind: "registry-exact", score: 1, nameLength: regKey.length });
      } else if (regKey.includes(key) || key.includes(regKey)) {
        hits.push({ row, kind: "registry-name", score: 0.9, nameLength: regKey.length });
      }
    }

    // พิกัดใกล้ — ใช้ได้ต่อเมื่อทั้งสองฝั่งมีพิกัด
    if (
      typeof clip.latitude === "number" &&
      typeof clip.longitude === "number" &&
      typeof row.latitude === "number" &&
      typeof row.longitude === "number"
    ) {
      const meters = haversineMeters(
        clip.latitude,
        clip.longitude,
        row.latitude,
        row.longitude
      );
      if (meters <= PROXIMITY_METERS) {
        hits.push({
          row,
          kind: "registry-proximity",
          score: 0.85,
          nameLength: regKey.length,
        });
      }
    }
  }

  if (!hits.length) return null;

  const kindRank: Record<MatchKind, number> = {
    "registry-exact": 3,
    "registry-name": 2,
    "registry-proximity": 1,
    "clip-text": 0,
  };
  hits.sort(
    (a, b) =>
      kindRank[b.kind] - kindRank[a.kind] ||
      b.nameLength - a.nameLength ||
      (Number(b.row.rating) || 0) - (Number(a.row.rating) || 0)
  );
  const best = hits[0];
  return { row: best.row, kind: best.kind, score: best.score };
}

/** ข้อเท็จจริงที่เตรียมจากข้อความในคลิป (ใช้ตอนจับคู่ทะเบียนไม่ได้) */
export function factsFromClip(clip: {
  summary?: FolderClipSummary | null;
}): FolderPlaceFacts {
  const p = clip.summary?.place ?? null;
  const price =
    p?.price_info?.weekday ||
    p?.price_info?.weekend ||
    p?.price_info?.level ||
    null;
  const highlights = Array.isArray(p?.highlights) ? p?.highlights ?? [] : [];
  return {
    price,
    openingHours: p?.opening_hours ?? null,
    phone: p?.contact?.phone ?? null,
    facilities: Array.isArray(p?.facilities) ? p?.facilities ?? [] : [],
    highlights,
    rating: null,
  };
}

/** รวมสถานที่เดียวกัน — ข้อมูลทะเบียนชนะข้อมูลจากคลิป */
export function dedupePlaces(places: FolderPlace[]): FolderPlace[] {
  const byKey = new Map<string, FolderPlace>();
  for (const place of places) {
    const prev = byKey.get(place.key);
    if (!prev) {
      byKey.set(place.key, { ...place, videoIds: [...place.videoIds] });
      continue;
    }
    prev.clipCount += place.clipCount;
    prev.videoIds = [...new Set([...prev.videoIds, ...place.videoIds])];
    prev.facts = {
      price: prev.facts.price ?? place.facts.price,
      openingHours: prev.facts.openingHours ?? place.facts.openingHours,
      phone: prev.facts.phone ?? place.facts.phone,
      facilities: unionOf(prev.facts.facilities, place.facts.facilities),
      highlights: unionOf(prev.facts.highlights, place.facts.highlights),
      rating: prev.facts.rating ?? place.facts.rating,
    };
    // ถ้าเดิมมาจากคลิป แต่รอบนี้เจอในทะเบียน → ใช้ของทะเบียนแทน
    if (prev.source === "clip" && place.source === "registry") {
      byKey.set(place.key, {
        ...place,
        clipCount: prev.clipCount,
        videoIds: prev.videoIds,
        facts: prev.facts,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === "registry" ? -1 : 1;
    if (b.clipCount !== a.clipCount) return b.clipCount - a.clipCount;
    return a.name.localeCompare(b.name, "th");
  });
}

function unionOf(a?: string[] | null, b?: string[] | null): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

// ─────────────────────────────────────────────────────────────
//  I/O — อ่านฐานข้อมูล
// ─────────────────────────────────────────────────────────────

/** คอลัมน์ของ `videos` — ชุดกว้าง (มี `place_name` ซึ่งแอปเขียนจริงแต่ไม่มีใน schema.sql) */
const VIDEO_COLUMNS_FULL =
  "id, caption, hashtags, ai_summary, location_name, place_name, province, district, latitude, longitude, thumbnail_url";
/** ชุดพื้นฐาน — ใช้เมื่อ DB ไม่มี `place_name` */
const VIDEO_COLUMNS_BASE =
  "id, caption, hashtags, ai_summary, location_name, province, district, latitude, longitude, thumbnail_url";

const REGISTRY_COLUMNS_FULL =
  "id, place_id, place_name, formatted_address, province, district, subdistrict, village, latitude, longitude, phone, opening_hours, price_info, price_level, rating, website, community_id, facilities";
const REGISTRY_COLUMNS_BASE =
  "id, place_id, place_name, formatted_address, province, district, subdistrict, village, latitude, longitude, phone, opening_hours, price_info, rating, website, community_id";
const REGISTRY_COLUMNS_MIN = "id, place_name, province";

export class FolderAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FolderAccessError";
  }
}

interface VideoRow {
  id: string;
  caption: string | null;
  hashtags: unknown;
  ai_summary: unknown;
  location_name: string | null;
  place_name?: string | null;
  province: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  thumbnail_url?: string | null;
}

/** อ่านคลิปในโฟลเดอร์ — เลือกชุดคอลัมน์แบบสองชั้น (กันคอลัมน์ที่ยังไม่มีใน DB) */
async function readFolderClips(
  admin: SupabaseClient,
  videoIds: string[]
): Promise<{ rows: VideoRow[]; partial: boolean }> {
  const read = async (columns: string) =>
    admin.from("videos").select(columns).in("id", videoIds).limit(MAX_FOLDER_CLIPS);

  const first = await read(VIDEO_COLUMNS_FULL);
  if (!first.error) {
    return { rows: (first.data ?? []) as unknown as VideoRow[], partial: false };
  }
  const second = await read(VIDEO_COLUMNS_BASE);
  if (second.error) {
    console.warn("[folderContext] อ่านคลิปในโฟลเดอร์ไม่สำเร็จ:", second.error.message);
    return { rows: [], partial: true };
  }
  // อ่านได้แต่คอลัมน์ไม่ครบ → ข้อมูลไม่สมบูรณ์ (บอกโมเดลได้)
  return { rows: (second.data ?? []) as unknown as VideoRow[], partial: true };
}

/** อ่านทะเบียนสถานที่ — เลือกชุดคอลัมน์แบบสองชั้น */
async function readRegistryRows(
  admin: SupabaseClient
): Promise<{ rows: RegistryRow[]; partial: boolean }> {
  const read = async (columns: string) =>
    admin.from("community_places").select(columns).limit(MAX_REGISTRY_ROWS);

  const first = await read(REGISTRY_COLUMNS_FULL);
  if (!first.error) {
    return { rows: (first.data ?? []) as unknown as RegistryRow[], partial: false };
  }
  const second = await read(REGISTRY_COLUMNS_BASE);
  if (second.error) {
    const third = await read(REGISTRY_COLUMNS_MIN);
    if (third.error) {
      console.warn("[folderContext] อ่านทะเบียนสถานที่ไม่สำเร็จ:", third.error.message);
      return { rows: [], partial: true };
    }
    return { rows: (third.data ?? []) as unknown as RegistryRow[], partial: true };
  }
  return { rows: (second.data ?? []) as unknown as RegistryRow[], partial: true };
}

/**
 * โหลดบริบทของโฟลเดอร์ทั้งหมด
 * -------------------------------------------------------------
 * `uid` = ผู้เรียก (ต้อง verify จาก JWT ก่อน) — ใช้ตรวจสิทธิ์
 * เจ้าของ / ผู้ร่วม / โฟลเดอร์สาธารณะ
 */
export async function loadFolderContext(
  admin: SupabaseClient,
  folderId: string,
  uid: string
): Promise<FolderContext> {
  const id = (folderId ?? "").trim();
  if (!id) {
    throw new FolderAccessError(400, "BAD_REQUEST", "ไม่ระบุรหัสโฟลเดอร์");
  }

  const { data: folder, error: folderErr } = await admin
    .from("folders")
    .select("id, name, owner_id, is_public")
    .eq("id", id)
    .maybeSingle();
  if (folderErr) {
    throw new FolderAccessError(
      500,
      "READ_FAILED",
      `อ่านโฟลเดอร์ไม่สำเร็จ: ${folderErr.message}`
    );
  }
  if (!folder) {
    throw new FolderAccessError(404, "NOT_FOUND", "ไม่พบโฟลเดอร์นี้");
  }

  const { data: collabs } = await admin
    .from("folder_collaborators")
    .select("user_id")
    .eq("folder_id", id);
  const collaboratorIds = (collabs ?? [])
    .map((c: any) => String(c.user_id ?? ""))
    .filter(Boolean);

  const isOwner = String(folder.owner_id ?? "") === uid;
  const isCollaborator = collaboratorIds.includes(uid);
  const isPublic = Boolean(folder.is_public);
  if (!isOwner && !isCollaborator && !isPublic) {
    throw new FolderAccessError(
      403,
      "FORBIDDEN",
      "คุณไม่มีสิทธิ์ดูโฟลเดอร์นี้"
    );
  }

  const { data: items, error: itemsErr } = await admin
    .from("folder_items")
    .select("video_id")
    .eq("folder_id", id)
    .order("created_at", { ascending: true })
    .limit(MAX_FOLDER_CLIPS);
  if (itemsErr) {
    throw new FolderAccessError(
      500,
      "READ_FAILED",
      `อ่านรายการในโฟลเดอร์ไม่สำเร็จ: ${itemsErr.message}`
    );
  }

  const videoIds = (items ?? [])
    .map((i: any) => String(i.video_id ?? ""))
    .filter(Boolean);
  if (!videoIds.length) {
    return {
      folderId: id,
      folderName: folder.name ?? "โฟลเดอร์",
      clipCount: 0,
      clips: [],
      places: [],
      registryHits: 0,
      aiFallbacks: 0,
      partial: false,
    };
  }

  const { rows: videoRows, partial: partialVideos } = await readFolderClips(
    admin,
    videoIds
  );
  const clips: FolderClip[] = videoRows.map((row) => ({
    videoId: row.id,
    caption: row.caption ?? null,
    hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [],
    placeName: row.place_name ?? null,
    locationName: row.location_name ?? null,
    province: row.province ?? null,
    district: row.district ?? null,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    thumbnailUrl: row.thumbnail_url ?? null,
    summary: (row.ai_summary ?? null) as FolderClipSummary | null,
  }));

  const { rows: registry, partial: partialRegistry } = await readRegistryRows(admin);

  const places = resolvePlaces(clips, registry);

  return {
    folderId: id,
    folderName: folder.name ?? "โฟลเดอร์",
    clipCount: videoIds.length,
    clips,
    places,
    registryHits: places.filter((p) => p.source === "registry").length,
    aiFallbacks: places.filter((p) => p.source === "clip").length,
    partial: partialVideos || partialRegistry,
  };
}

/**
 * แปลงคลิป → รายการสถานที่ (บริสุทธิ์ — แยกออกจาก I/O เพื่อให้ทดสอบง่าย)
 */
export function resolvePlaces(
  clips: FolderClip[],
  registry: RegistryRow[]
): FolderPlace[] {
  const collected: FolderPlace[] = [];

  for (const clip of clips) {
    const match = matchClipToRegistry(clip, registry);
    if (match) {
      const row = match.row;
      const registryId = row.place_id || row.id || null;
      const clipFacts = factsFromClip(clip);
      collected.push({
        key: `r:${registryId ?? normalizePlaceName(row.place_name)}`,
        name: (row.place_name ?? "").trim() || (clip.placeName ?? "").trim(),
        source: "registry",
        matchKind: match.kind,
        registryPlaceId: registryId,
        communityId: row.community_id ?? null,
        communityName: row.village ?? null,
        address: row.formatted_address ?? null,
        province: row.province ?? null,
        district: row.district ?? null,
        latitude: typeof row.latitude === "number" ? row.latitude : null,
        longitude: typeof row.longitude === "number" ? row.longitude : null,
        clipCount: 1,
        videoIds: [clip.videoId],
        facts: {
          price: row.price_info ?? clipFacts.price,
          openingHours: row.opening_hours ?? clipFacts.openingHours,
          phone: row.phone ?? clipFacts.phone,
          facilities: Array.isArray(row.facilities)
            ? (row.facilities as string[])
            : clipFacts.facilities,
          highlights: clipFacts.highlights,
          rating: typeof row.rating === "number" ? row.rating : null,
        },
      });
      continue;
    }

    // ไม่เจอในทะเบียน → ใช้ชื่อจากคลิป (ป้าย "ยังไม่ยืนยัน")
    const name =
      clipNameCandidates(clip)[0] ?? (clip.locationName ?? "").trim() ?? "";
    if (!name) continue;
    const clipFacts = factsFromClip(clip);
    const place = clip.summary?.place ?? null;
    collected.push({
      key: `a:${normalizePlaceName(name)}|${normalizePlaceName(
        clip.province ?? ""
      )}`,
      name,
      source: "clip",
      matchKind: "clip-text",
      registryPlaceId: null,
      communityId: null,
      communityName: place?.community ?? null,
      address: null,
      province: clip.province ?? place?.location?.province ?? null,
      district: clip.district ?? place?.location?.district ?? null,
      latitude: clip.latitude,
      longitude: clip.longitude,
      clipCount: 1,
      videoIds: [clip.videoId],
      facts: clipFacts,
    });
  }

  return dedupePlaces(collected).slice(0, MAX_FOLDER_PLACES);
}

// ─────────────────────────────────────────────────────────────
//  บล็อก prompt
// ─────────────────────────────────────────────────────────────

/** ตัดคำบรรยายให้เหลือบรรทัดเดียว (กัน prompt บวม) */
function firstLine(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  const line = text.split(/\n+/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** ป้ายแหล่งที่มา — ให้ผู้ใช้เห็นว่าอันไหนยืนยันแล้ว อันไหนยังไม่ */
export function folderPlaceSourceLabel(place: {
  source: "registry" | "clip";
  matchKind?: MatchKind;
}): string {
  if (place.source === "registry") {
    if (place.matchKind === "registry-exact") return "ยืนยันในทะเบียนแล้ว (ตรงชื่อ)";
    if (place.matchKind === "registry-name") return "ยืนยันในทะเบียนแล้ว (ชื่อใกล้เคียง)";
    return "ยืนยันในทะเบียนแล้ว (พิกัดตรงกัน)";
  }
  return "จากคลิป (ยังไม่ยืนยันในทะเบียน)";
}

/**
 * ทำบล็อก prompt ของโฟลเดอร์ — เขียนตามแบบเดียวกับ `communityContext.ts`
 * (บล็อก `retrieved_context`) เพื่อให้เข้ากันได้
 */
export function formatFolderContextBlock(ctx: FolderContext): string {
  if (!ctx.clips.length && !ctx.places.length) return "";

  const lines: string[] = [];
  lines.push(
    `[ข้อมูลโฟลเดอร์จากระบบ (folder_context — ใช้เป็นแหล่งข้อมูลหลัก)]:`
  );
  lines.push(
    `โฟลเดอร์: "${ctx.folderName}" (${ctx.clipCount} คลิป → ${ctx.places.length} สถานที่: ยืนยันในทะเบียน ${ctx.registryHits} / จากคลิป ${ctx.aiFallbacks})`
  );

  if (ctx.places.length) {
    lines.push("");
    lines.push("สถานที่ที่โฟลเดอร์นี้ไป:");
    ctx.places.forEach((p, i) => {
      const bits: string[] = [];
      bits.push(`${p.clipCount} คลิป`);
      if (p.communityName) bits.push(`ชุมชน: ${p.communityName}`);
      if (p.address) bits.push(`ที่อยู่: ${p.address}`);
      else if (p.province) {
        bits.push(
          `ที่อยู่: ${[p.district && `อ.${p.district}`, p.province && `จ.${p.province}`]
            .filter(Boolean)
            .join(" ")}`
        );
      }
      if (p.facts.price) bits.push(`ราคา: ${p.facts.price}`);
      if (p.facts.openingHours) bits.push(`เปิด: ${p.facts.openingHours}`);
      if (p.facts.phone) bits.push(`โทร: ${p.facts.phone}`);
      if (p.facts.facilities?.length) {
        bits.push(`สิ่งอำนวยความสะดวก: ${p.facts.facilities.slice(0, 6).join(" • ")}`);
      }
      lines.push(
        `${i + 1}. ${p.name} — ${folderPlaceSourceLabel(p)} — ${bits.join(" — ")}`
      );
    });
  } else {
    lines.push("");
    lines.push("ยังไม่มีข้อมูลสถานที่ของโฟลเดอร์นี้");
  }

  const clipLines = ctx.clips
    .map((clip, i) => {
      const name =
        clip.summary?.place?.place_name ||
        clip.placeName ||
        clip.locationName ||
        "ไม่ทราบชื่อสถานที่";
      const desc = firstLine(clip.summary?.text ?? clip.caption);
      return `- คลิป ${i + 1} · ${name}${desc ? ` — ${desc}` : ""}`;
    })
    .slice(0, MAX_FOLDER_CLIPS);
  if (clipLines.length) {
    lines.push("");
    lines.push("คลิปในโฟลเดอร์ (ย่อ):");
    lines.push(...clipLines);
  }

  if (ctx.partial) {
    lines.push("");
    lines.push(
      "* หมายเหตุ: ข้อมูลบางส่วนของโฟลเดอร์อ่านไม่ครบ (บางคลิปไม่มีสรุป AI) — ถ้าข้อมูลไม่พอให้บอกผู้ใช้ตรง ๆ"
    );
  }

  lines.push("");
  lines.push(
    "* เมื่อผู้ใช้ถามว่าโฟลเดอร์นี้ไปที่ไหนบ้าง ให้ตอบจากรายการ \"สถานที่ที่โฟลเดอร์นี้ไป\" เท่านั้น"
  );
  lines.push(
    "* ห้ามแต่งสถานที่ ราคา เบอร์โทร เวลาเปิด หรือที่อยู่ที่ไม่มีในบล็อกนี้"
  );
  lines.push(
    "* ถ้าสถานที่ไหนยังไม่ยืนยันในทะเบียน ให้บอกผู้ใช้ว่ายังไม่ยืนยัน"
  );
  lines.push(
    "* ถ้ารายการสถานที่ว่าง ให้บอกตรง ๆ ว่ายังไม่มีข้อมูลสถานที่ของโฟลเดอร์นี้"
  );

  return lines.join("\n");
}
