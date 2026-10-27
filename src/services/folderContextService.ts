import { API_TIMEOUT_MS } from "./apiConfig";
import { aiFetch } from "./aiHttp";
import { getFolderContextForAi } from "./folderService";
import { TripFolderPlace } from "../data/tripsData";

/**
 * บริบทโฟลเดอร์จริง — "โฟลเดอร์นี้ไปสถานที่ไหนบ้าง"
 * =============================================================
 * ที่เดียวที่หน้าโฟลเดอร์ / แชท / แพลนทริป ใช้รายการสถานที่ชุดเดียวกัน
 *
 * ข้อมูลมาจาก backend (`GET /folders/:id/context`) ซึ่งเป็นคนอ่านคลิปจริง
 * จับคู่กับทะเบียนสถานที่ แล้วคืนรายการพร้อมป้ายที่มา
 * (ยืนยันในทะเบียนแล้ว / ยังไม่ยืนยัน)
 *
 * ถ้าเรียกไม่ได้ (backend เก่า / ไม่มี token / ตารางยังไม่มี) → ถอยไปใช้
 * `getFolderContextForAi` แบบเดิม (ชื่อสถานที่ดิบจากคลิป) — ข้อมูลน้อยกว่า
 * แต่ยังดีกว่าไม่มีอะไรให้แสดง
 */

export type FolderPlaceSource = "registry" | "clip";

export interface FolderPlaceFacts {
  price?: string | null;
  openingHours?: string | null;
  phone?: string | null;
  facilities?: string[];
  highlights?: string[];
  rating?: number | null;
}

export interface FolderPlaceInfo {
  key: string;
  name: string;
  /** registry = ยืนยันในทะเบียนแล้ว / clip = มาจากข้อความในคลิป */
  source: FolderPlaceSource;
  sourceLabel?: string;
  matchKind?: string;
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

export interface FolderClipInfo {
  videoId: string;
  caption: string | null;
  hashtags: string[];
  placeName: string | null;
  locationName: string | null;
  province: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  thumbnailUrl: string | null;
  summary?: {
    text?: string | null;
    visualDescription?: string | null;
    place?: { place_name?: string | null; community?: string | null } | null;
  } | null;
}

export interface FolderContextInfo {
  folderId: string;
  folderName: string;
  clipCount: number;
  clips: FolderClipInfo[];
  places: FolderPlaceInfo[];
  /** จับคู่ทะเบียนได้กี่แห่ง */
  registryHits: number;
  /** มาจากข้อความในคลิปกี่แห่ง */
  aiFallbacks: number;
  /** ข้อมูลบางส่วนอ่านไม่ครบ */
  partial: boolean;
  /** true = มาจาก endpoint ของ backend · false = fallback แบบเดิม */
  fromBackend: boolean;
}

interface BackendFolderContext {
  folderId: string;
  folderName: string;
  clipCount: number;
  clips?: FolderClipInfo[];
  places?: FolderPlaceInfo[];
  registryHits?: number;
  aiFallbacks?: number;
  partial?: boolean;
}

/**
 * ดึงบริบทโฟลเดอร์ — พยายามเรียก backend ก่อนเสมอ
 * คืน null เมื่อไม่มีทางได้ข้อมูลเลย (ไม่มีโฟลเดอร์/ไม่มีคลิป)
 */
export async function getFolderContext(
  folderId: string,
  token?: string | null
): Promise<FolderContextInfo | null> {
  if (!folderId) return null;

  const fromBackend = await fetchFromBackend(folderId, token);
  if (fromBackend) return fromBackend;

  return fetchLegacy(folderId);
}

/** เรียก endpoint ใหม่ของ backend — คืน null เมื่อเรียกไม่ได้ */
async function fetchFromBackend(
  folderId: string,
  token?: string | null
): Promise<FolderContextInfo | null> {
  try {
    const data = await aiFetch<BackendFolderContext>({
      label: "folders/context",
      path: `/folders/${folderId}/context`,
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      timeoutMs: API_TIMEOUT_MS * 2,
    });
    if (!data || typeof data.folderId !== "string") return null;
    const places = Array.isArray(data.places) ? data.places : [];
    return {
      folderId: data.folderId,
      folderName: data.folderName ?? "โฟลเดอร์",
      clipCount: Number(data.clipCount) || 0,
      clips: Array.isArray(data.clips) ? data.clips : [],
      places,
      registryHits: Number(data.registryHits) || 0,
      aiFallbacks: Number(data.aiFallbacks) || 0,
      partial: Boolean(data.partial),
      fromBackend: true,
    };
  } catch {
    // 401 (ไม่มี token) / 404 (ตารางยังไม่มี) / backend ไม่ตอบ → ใช้ทางสำรอง
    return null;
  }
}

/** ทางสำรอง: อ่านชื่อสถานที่ดิบจากคลิป (ข้อมูลน้อยกว่า แต่ไม่ต้องพึ่ง backend) */
async function fetchLegacy(
  folderId: string
): Promise<FolderContextInfo | null> {
  let ctx: Awaited<ReturnType<typeof getFolderContextForAi>> = null;
  try {
    ctx = await getFolderContextForAi(folderId);
  } catch {
    return null;
  }
  if (!ctx) return null;

  const clips: FolderClipInfo[] = ctx.clips.map((c) => ({
    videoId: c.video_id,
    caption: c.caption,
    hashtags: c.hashtags ?? [],
    placeName: null,
    locationName: c.location_name,
    province: c.province,
    district: null,
    latitude: null,
    longitude: null,
    thumbnailUrl: null,
    summary: null,
  }));

  // รวมชื่อสถานที่ที่เหมือนกัน (ไม่มีทะเบียนให้ยืนยัน → ป้าย "จากคลิป")
  const byName = new Map<string, FolderPlaceInfo>();
  for (const clip of clips) {
    const name = (clip.locationName ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.clipCount += 1;
      existing.videoIds.push(clip.videoId);
      continue;
    }
    byName.set(key, {
      key: `a:${key}`,
      name,
      source: "clip",
      sourceLabel: "จากคลิป (ยังไม่ยืนยันในทะเบียน)",
      matchKind: "clip-text",
      registryPlaceId: null,
      communityId: null,
      communityName: null,
      address: null,
      province: clip.province,
      district: null,
      latitude: clip.latitude,
      longitude: clip.longitude,
      clipCount: 1,
      videoIds: [clip.videoId],
      facts: {},
    });
  }

  const places = [...byName.values()];
  return {
    folderId: ctx.folder_id,
    folderName: ctx.folder_name,
    clipCount: clips.length,
    clips,
    places,
    registryHits: 0,
    aiFallbacks: places.length,
    partial: true,
    fromBackend: false,
  };
}

/** ข้อความสรุปบรรทัดเดียวของสถานที่ (ใช้ในการ์ด) */
export function describeFolderPlace(place: FolderPlaceInfo): string {
  const bits: string[] = [];
  if (place.communityName) bits.push(place.communityName);
  if (place.address) bits.push(place.address);
  else if (place.province) bits.push(place.province);
  if (place.facts.price) bits.push(place.facts.price);
  return bits.join(" · ");
}

/**
 * แปลงรายการสถานที่ของโฟลเดอร์ → รูปแบบที่เก็บไว้กับแพลนทริป
 * ใช้ร่วมกัน 3 ที่ (แชท / wizard / แพลนที่โหลดจาก DB) เพื่อให้ป้ายที่มาเหมือนกัน
 */
export function toTripFolderPlaces(
  places: FolderPlaceInfo[] | null | undefined
): TripFolderPlace[] {
  if (!Array.isArray(places)) return [];
  return places
    .filter((p) => Boolean(p?.name))
    .map((p) => ({
      name: p.name,
      source: p.source === "registry" ? "registry" : "clip",
      clipCount: Number(p.clipCount) || undefined,
      communityName: p.communityName ?? null,
      address: p.address ?? null,
    }));
}
