import { supabase, isSupabaseConfigured } from "../lib/supabase";

export interface UserSavedPlace {
  id: string;
  user_id: string;
  label: string; // e.g. "บ้าน", "หอพัก", "ที่ทำงาน"
  address_text: string; // e.g. "คอนโดลุมพินี พระราม 9" or formatted address
  google_maps_url?: string;
  lat?: number;
  lng?: number;
  is_default?: boolean;
  created_at?: string;
}

const LOCAL_STORAGE_KEY = "@local_saved_places";

// In-memory cache for offline/instant access
let inMemoryPlaces: UserSavedPlace[] = [
  {
    id: "default-home",
    user_id: "me",
    label: "บ้าน",
    address_text: "กรุงเทพมหานคร",
    google_maps_url: "https://maps.google.com/?q=Bangkok",
    lat: 13.7563,
    lng: 100.5018,
    is_default: true,
  },
];

/**
 * ตัวช่วยแปลงลิงก์ Google Maps → พิกัด + ชื่อสถานที่
 * -------------------------------------------------------------
 * มีสำเนาแบบเดียวกันอยู่ที่ backend (`backend/src/mapsUrl.ts`)
 * (แอปกับ backend เป็นคนละแพ็กเกจ → import ข้ามกันไม่ได้)
 */

/** ตัวเลขพิกัดในลิงก์ (ละเลยเครื่องหมายลบ/ทศนิยมได้) */
const NUM = "(-?\\d+(?:\\.\\d+)?)";

/**
 * รูปแบบที่มีพิกัดอยู่ในตัวลิงก์ — เรียงจาก "เจาะจง" ไป "กว้าง"
 * · `!3d18.7883!4d98.9923` → ลิงก์ place แบบ ?data=!4m8!3d…!4d…
 * · `@18.7883,98.9923`      → ลิงก์แผนที่ทั่วไป
 * · `?q= / ?query= / ?ll= / ?center=` → ลิงก์ค้นหา
 * · `/maps/dir/18.7883,98.9923`      → ลิงก์เส้นทาง
 */
const COORD_PATTERNS: RegExp[] = [
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(`@${NUM},${NUM}`),
  new RegExp(`[?&](?:q|query|ll|center)=${NUM},${NUM}`),
  new RegExp(`/maps/dir/${NUM},${NUM}`),
];

/** decode แบบไม่โยน error (URL ผิดรูปแบบ) */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** แทนที่ comma ที่ถูก encode แล้ว decode ครั้งเดียว */
function normalizeUrl(url: string): string {
  return safeDecode(url.replace(/%2C/gi, ","));
}

/** พิกัดที่ใช้ได้จริง */
function validCoords(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** ค่าที่เขียนเป็น "lat,lng" หรือเปล่า */
function isCoordPair(value: string): boolean {
  const m = value.match(new RegExp(`^${NUM},${NUM}$`));
  if (!m) return false;
  return validCoords(parseFloat(m[1]), parseFloat(m[2]));
}

/** ชื่อที่อ่านออกจาก URL — `+` คือช่องว่าง */
function decodeName(value: string): string | null {
  const name = safeDecode(value.replace(/\+/g, " ")).trim();
  return name.length > 0 ? name : null;
}

/**
 * ชื่อสถานที่ที่อยู่ในลิงก์ (ถ้ามี)
 * -------------------------------------------------------------
 * รองรับ `/place/<ชื่อ>` · `/search/<ชื่อ>` · `?q=<ชื่อ>` · `?query=<ชื่อ>`
 * ค่า `q=13.7563,100.5018` เป็นพิกัด ไม่ใช่ชื่อ → คืน null
 */
export function mapsUrlPlaceName(raw: string): string | null {
  const url = normalizeUrl(String(raw ?? "").trim());
  if (!url) return null;

  for (const pattern of [/\/place\/([^/@?&#]+)/, /\/search\/([^/@?&#]+)/]) {
    const m = url.match(pattern);
    if (!m?.[1]) continue;
    const name = decodeName(m[1]);
    if (name) return name;
  }

  const q = url.match(/[?&](?:q|query)=([^&#]+)/);
  if (q?.[1]) {
    const value = decodeName(q[1]);
    if (value && !isCoordPair(value)) return value;
  }

  return null;
}

/** ลิงก์สั้นของ Google Maps — ต้องกาง redirect ก่อนจึงจะเห็นพิกัด */
export function isShortMapsLink(raw: string): boolean {
  const url = String(raw ?? "").trim().toLowerCase();
  return url.includes("maps.app.goo.gl") || url.includes("goo.gl/maps");
}

/**
 * Extracts coordinates and address details from Google Maps URLs or text.
 * Examples:
 * - https://maps.app.goo.gl/... (will be resolved via fetch)
 * - https://www.google.com/maps/place/ชื่อสถานที่/@13.6512,100.4957...
 * - https://www.google.com/maps?q=13.7563,100.5018
 */
export async function resolveGoogleMapsUrl(input: string): Promise<{ lat?: number; lng?: number; placeName?: string; query?: string }> {
  if (!input) return {};
  const trimmed = input.trim();

  // Short link -> try to follow the redirect from the app first.
  // React Native usually cannot see the final URL, so when this fails the
  // backend does the expansion for us (see placesService.resolvePlaceCoords).
  if (isShortMapsLink(trimmed)) {
    try {
      const res = await fetch(trimmed, { method: "GET", redirect: "follow" });
      const finalUrl = res.url || "";
      if (finalUrl && finalUrl !== trimmed) {
        const parsed = parseGoogleMapsUrlString(finalUrl);
        if (parsed.lat && parsed.lng) return parsed;
      }
    } catch (e) {
      console.warn("Could not resolve short url:", e);
    }
  }

  return parseGoogleMapsUrlString(trimmed);
}

export function parseGoogleMapsUrlString(trimmed: string): { lat?: number; lng?: number; placeName?: string; query?: string } {
  const url = normalizeUrl(String(trimmed ?? "").trim());
  if (!url) return {};

  // Extract place name if present: /maps/place/ชื่อสถานที่/
  const placeName = mapsUrlPlaceName(url) ?? undefined;

  // พิกัดที่อยู่ในตัวลิงก์ — ไล่ทีละรูปแบบ
  for (const pattern of COORD_PATTERNS) {
    const m = url.match(pattern);
    if (!m) continue;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!validCoords(lat, lng)) continue;
    return { lat, lng, placeName };
  }

  return { query: trimmed, placeName };
}

export function parseGoogleMapsUrl(input: string): { lat?: number; lng?: number; placeName?: string; query?: string } {
  return parseGoogleMapsUrlString(input.trim());
}

/**
 * Loads user saved places from Supabase `user_saved_places` table or local fallback.
 */
export async function getSavedPlaces(): Promise<UserSavedPlace[]> {
  if (!isSupabaseConfigured) {
    return inMemoryPlaces;
  }

  try {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id;
    if (!uid) return inMemoryPlaces;

    const { data, error } = await supabase
      .from("user_saved_places")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (error || !data || data.length === 0) {
      return inMemoryPlaces;
    }

    inMemoryPlaces = data as UserSavedPlace[];
    return inMemoryPlaces;
  } catch (err) {
    console.warn("getSavedPlaces failed, returning local cache:", err);
    return inMemoryPlaces;
  }
}

/**
 * Saves a new favorite place (e.g. "บ้าน", "หอพัก").
 */
export async function saveUserPlace(place: Omit<UserSavedPlace, "id" | "user_id" | "created_at">): Promise<UserSavedPlace> {
  const newPlace: UserSavedPlace = {
    ...place,
    id: `place-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    user_id: "me",
    created_at: new Date().toISOString(),
  };

  inMemoryPlaces = [newPlace, ...inMemoryPlaces];

  if (!isSupabaseConfigured) {
    return newPlace;
  }

  try {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id;
    if (!uid) return newPlace;

    newPlace.user_id = uid;

    const { data, error } = await supabase
      .from("user_saved_places")
      .insert({
        user_id: uid,
        label: newPlace.label,
        address_text: newPlace.address_text,
        google_maps_url: newPlace.google_maps_url,
        lat: newPlace.lat,
        lng: newPlace.lng,
        is_default: newPlace.is_default ?? false,
      })
      .select()
      .single();

    if (!error && data) {
      return data as UserSavedPlace;
    }
  } catch (err) {
    console.warn("saveUserPlace error, kept in memory:", err);
  }

  return newPlace;
}

/**
 * บันทึกพิกัดที่เพิ่งหาได้กลับลงที่อยู่ที่บันทึกไว้
 * -------------------------------------------------------------
 * ที่อยู่ที่ผู้ใช้บันทึกไว้ก่อนหน้านี้ (ตอนที่ยังหาพิกัดไม่ได้) จะไม่มี lat/lng
 * → พอหาพิกัดได้แล้วต้องเขียนกลับ ไม่งั้นทุกครั้งที่เลือกต้องถาม Google ใหม่
 */
export async function updateSavedPlaceCoords(
  id: string,
  lat: number,
  lng: number
): Promise<void> {
  inMemoryPlaces = inMemoryPlaces.map((p) =>
    p.id === id ? { ...p, lat, lng } : p
  );

  if (!isSupabaseConfigured) return;

  try {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id;
    if (!uid) return;

    const { error } = await supabase
      .from("user_saved_places")
      .update({ lat, lng })
      .eq("id", id)
      .eq("user_id", uid);
    if (error) {
      console.warn("updateSavedPlaceCoords failed:", error.message);
    }
  } catch (err) {
    console.warn("updateSavedPlaceCoords error:", err);
  }
}
