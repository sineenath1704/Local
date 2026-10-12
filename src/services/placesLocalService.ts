import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { normalizeThaiName } from "../data/thaiAdmin";

/**
 * Local "places" store — specific places that users have confirmed exist.
 * -------------------------------------------------------------
 * Checked BEFORE calling Google Places (phase 4), so a place confirmed once is
 * reused for free afterward. Backed by the Supabase `places` table.
 */

export interface LocalPlace {
  id: string;
  name: string;
  community: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  googlePlaceId: string | null;
  source: "google" | "manual" | "otop";
}

function rowToPlace(r: any): LocalPlace {
  return {
    id: r.id,
    name: r.name,
    community: r.community ?? null,
    subdistrict: r.subdistrict ?? null,
    district: r.district ?? null,
    province: r.province ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    googlePlaceId: r.google_place_id ?? null,
    source: r.source ?? "manual",
  };
}

/**
 * Find already-confirmed places matching a specific name within a province
 * (and optionally district). Returns candidates (may be several) — the caller
 * lets the user choose; never auto-pick when more than one.
 */
export async function findLocalPlaces(opts: {
  name: string;
  province?: string | null;
  district?: string | null;
}): Promise<LocalPlace[]> {
  if (!isSupabaseConfigured || !opts.name?.trim()) return [];
  let q = supabase.from("places").select("*").limit(10);
  // Case-insensitive partial match on the name.
  q = q.ilike("name", `%${opts.name.trim()}%`);
  if (opts.province) q = q.ilike("province", `%${opts.province.trim()}%`);
  const { data, error } = await q;
  if (error || !data) return [];

  // Extra client-side filter: normalize-compare district when provided.
  const nd = normalizeThaiName(opts.district);
  const rows = nd
    ? data.filter((r: any) => !r.district || normalizeThaiName(r.district) === nd)
    : data;
  return rows.map(rowToPlace);
}

/** Save a confirmed place (idempotent on name+district+province via DB unique). */
export async function saveVerifiedPlace(input: {
  name: string;
  community?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  googlePlaceId?: string | null;
  source?: "google" | "manual" | "otop";
}): Promise<LocalPlace | null> {
  if (!isSupabaseConfigured || !input.name?.trim()) return null;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;

  // Reuse if it already exists (unique name+district+province).
  const existing = await findLocalPlaces({
    name: input.name,
    province: input.province,
    district: input.district,
  });
  const exact = existing.find(
    (p) => normalizeThaiName(p.name) === normalizeThaiName(input.name)
  );
  if (exact) return exact;

  const { data, error } = await supabase
    .from("places")
    .insert({
      name: input.name.trim(),
      community: input.community ?? null,
      subdistrict: input.subdistrict ?? null,
      district: input.district ?? null,
      province: input.province ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      google_place_id: input.googlePlaceId ?? null,
      source: input.source ?? "manual",
      verified_by: uid,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return rowToPlace(data);
}
