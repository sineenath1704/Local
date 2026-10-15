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
 * Extracts coordinates and address details from Google Maps URLs or text.
 * Examples:
 * - https://maps.app.goo.gl/... (will be resolved via fetch)
 * - https://www.google.com/maps/place/ชื่อสถานที่/@13.6512,100.4957...
 * - https://www.google.com/maps?q=13.7563,100.5018
 */
export async function resolveGoogleMapsUrl(input: string): Promise<{ lat?: number; lng?: number; placeName?: string; query?: string }> {
  if (!input) return {};
  const trimmed = input.trim();

  // If it's a short link maps.app.goo.gl, fetch HEAD or GET to follow redirect
  if (trimmed.includes("maps.app.goo.gl")) {
    try {
      const res = await fetch(trimmed, { method: "HEAD", redirect: "follow" });
      const finalUrl = res.url || "";
      if (finalUrl && finalUrl !== trimmed) {
        return parseGoogleMapsUrlString(finalUrl);
      }
    } catch (e) {
      console.warn("Could not resolve short url:", e);
    }
  }

  return parseGoogleMapsUrlString(trimmed);
}

export function parseGoogleMapsUrlString(trimmed: string): { lat?: number; lng?: number; placeName?: string; query?: string } {
  let placeName: string | undefined;

  // Extract place name if present: /maps/place/ชื่อสถานที่/
  const placeMatch = trimmed.match(/\/place\/([^/@?]+)/);
  if (placeMatch && placeMatch[1]) {
    try {
      placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));
    } catch {
      placeName = placeMatch[1];
    }
  }

  // Pattern: @13.7563,100.5018
  const atMatch = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]), placeName };
  }

  // Pattern: q=13.7563,100.5018 or query=13.7563,100.5018
  const qMatch = trimmed.match(/[?&](?:q|query)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]), placeName };
  }

  // Pattern: ll=13.7563,100.5018
  const llMatch = trimmed.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (llMatch) {
    return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]), placeName };
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
