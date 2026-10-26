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
 * Find already-confirmed places in the Local store.
 *
 * Two ways in, and the difference matters:
 *
 * ① **by Google id** (`googlePlaceId`) — the identity of a place. Exact
 *    (`.eq`), so it can never drift onto a similarly-named place.
 * ② **by name** — a fuzzy browse for a place we have no id for yet. It can
 *    match the wrong place ("บ้านปาย" vs "บ้านปายใหม่"), so the caller
 *    MUST let the user pick — never auto-pick a single hit.
 *
 * D7 (PLAN_PLACE_MATCHING.md §6.1): the name search used to be the only
 * path, and the auto-pick that followed made the app choose a place the
 * user never confirmed — and then stop looking at Google at all.
 */
export async function findLocalPlaces(opts: {
  name?: string | null;
  googlePlaceId?: string | null;
  province?: string | null;
  district?: string | null;
}): Promise<LocalPlace[]> {
  if (!isSupabaseConfigured) return [];
  const googlePlaceId = opts.googlePlaceId?.trim() ?? "";
  const name = opts.name?.trim() ?? "";
  if (!googlePlaceId && !name) return [];

  let q = supabase.from("places").select("*").limit(10);
  if (googlePlaceId) {
    // Exact match on the id — nothing fuzzy about it.
    q = q.eq("google_place_id", googlePlaceId);
  } else {
    // Case-insensitive partial match on the name.
    q = q.ilike("name", `%${name}%`);
    if (opts.province) q = q.ilike("province", `%${opts.province.trim()}%`);
  }
  const { data, error } = await q;
  if (error || !data) return [];

  // Extra client-side filter: normalize-compare district when provided.
  // Skipped for the id path — an exact id hit is already unambiguous, and
  // a district spelled slightly differently must not hide the row.
  if (googlePlaceId) return data.map(rowToPlace);
  const nd = normalizeThaiName(opts.district);
  const rows = nd
    ? data.filter((r: any) => !r.district || normalizeThaiName(r.district) === nd)
    : data;
  return rows.map(rowToPlace);
}

/**
 * Save a confirmed place.
 *
 * Deduplication is by **Google id** when we have one (the place's identity),
 * and only falls back to name + area for a place the user typed in by hand
 * (which has no id at all). It used to dedupe by name only, so two different
 * places that share a name collapsed into one.
 */
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

  const googlePlaceId = input.googlePlaceId?.trim() ?? "";
  if (googlePlaceId) {
    // Same id = same place. Reuse the row we already have.
    const byId = await findLocalPlaces({ googlePlaceId });
    if (byId.length > 0) return byId[0];
  } else {
    // No id (a place the user typed by hand) — name + area is all we have.
    const existing = await findLocalPlaces({
      name: input.name,
      province: input.province,
      district: input.district,
    });
    const exact = existing.find(
      (p) => normalizeThaiName(p.name) === normalizeThaiName(input.name)
    );
    if (exact) return exact;
  }

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
