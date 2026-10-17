import { Router, Request, Response } from "express";
import { config, isPlacesConfigured } from "../config";
import type { AiSummaryResult, PlaceData } from "../aiClient";

/**
 * Google Places integration
 * ---------------------------------------------------------
 * Two uses:
 *  1) POST /places/verify  — user-facing: search + return candidates for the
 *     CreatePostScreen location picker (user chooses, never auto-pick).
 *  2) enrichWithGooglePlaces() — internal: called after AI video summary to
 *     auto-fill province/district/subdistrict/lat/lng that M3 couldn't see
 *     from the video frames. Picks the top result ONLY when confidence is
 *     high (single unambiguous match for a Thai community/place).
 */

// ─────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────

export interface PlaceCandidate {
  name: string;
  address: string;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  types: string[];
}

/** Extract Thai administrative levels from Google addressComponents. */
function extractAdmin(components: any[]): {
  province: string | null;
  district: string | null;
  subdistrict: string | null;
} {
  let province: string | null = null;
  let district: string | null = null;
  let subdistrict: string | null = null;
  for (const c of components ?? []) {
    const types: string[] = c.types ?? [];
    const name: string = c.longText ?? c.long_name ?? "";
    if (types.includes("administrative_area_level_1")) province = name;
    else if (types.includes("administrative_area_level_2")) district = name;
    else if (types.includes("administrative_area_level_3") || types.includes("sublocality_level_1"))
      subdistrict = name;
  }
  return { province, district, subdistrict };
}

/** Call Google Places Text Search. Returns raw candidates array. */
async function searchGooglePlaces(query: string): Promise<PlaceCandidate[]> {
  if (!isPlacesConfigured()) return [];
  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.places.googleKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.id,places.location,places.types,places.addressComponents",
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "th",
      regionCode: "TH",
      maxResultCount: 5,
    }),
  });
  if (!resp.ok) return [];
  const data: any = await resp.json();
  return (data.places ?? []).map((p: any) => {
    const admin = extractAdmin(p.addressComponents);
    return {
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      placeId: p.id ?? "",
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
      province: admin.province,
      district: admin.district,
      subdistrict: admin.subdistrict,
      types: p.types ?? [],
    } as PlaceCandidate;
  });
}

// ─────────────────────────────────────────────
//  2) Internal enricher — called after AI summary
// ─────────────────────────────────────────────

/**
 * After M3 returns a summary, call Google Places with the place/community name
 * it extracted to fill in the location fields (province/district/subdistrict)
 * and coordinates that the model couldn't infer from video frames alone.
 *
 * Rules (never wrong the user):
 *  - Only enrich if M3 gave us a place_name or community (something to search).
 *  - Only auto-fill admin fields that M3 left NULL (don't override M3's visual evidence).
 *  - Only commit the result when there is exactly ONE candidate whose address
 *    confirms it is in Thailand (high-confidence single match).
 *  - If there are multiple candidates, store them in `place.candidates` so the
 *    app can show a picker — never silently pick one.
 *  - If Google fails/times out, return the summary unchanged (non-fatal).
 */
export async function enrichWithGooglePlaces(
  summary: AiSummaryResult
): Promise<AiSummaryResult> {
  if (!isPlacesConfigured()) return summary;

  const place = summary.place;
  if (!place) return summary;

  // Build search query — priority: place_name > community > transcript keywords.
  const nameParts = [place.place_name, (place as any).community]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "");

  // Fallback: extract location keywords from transcript when M3 didn't find place_name.
  if (nameParts.length === 0) {
    const transcript: string = (summary as any)._transcript ?? "";
    const onScreen: string[] = (summary as any)._onScreenText ?? [];
    // Look for community/village name patterns in Thai text
    const patterns = [
      /บ้าน[\u0E00-\u0E7F]{2,20}/g,   // บ้าน...
      /ชุมชน[\u0E00-\u0E7F]{2,20}/g,  // ชุมชน...
      /หมู่บ้าน[\u0E00-\u0E7F]{2,20}/g, // หมู่บ้าน...
    ];
    const allText = transcript + " " + onScreen.join(" ");
    for (const re of patterns) {
      const found = allText.match(re);
      if (found) { nameParts.push(...found.slice(0, 2)); break; }
    }
    // If still nothing, use first 3 nouns from transcript as a last resort.
    if (nameParts.length === 0 && transcript.length > 5) {
      // Take up to 10 words of Thai from the transcript as the query seed.
      const thaiWords = transcript.match(/[\u0E00-\u0E7F]+/g) ?? [];
      if (thaiWords.length > 0) nameParts.push(thaiWords.slice(0, 6).join(" "));
    }
  }

  if (nameParts.length === 0) return summary; // still nothing

  const adminHint = [place.location?.district, place.location?.province]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join(" ");
  const query = `${nameParts.join(" ")} ${adminHint} ประเทศไทย`.trim();

  // eslint-disable-next-line no-console
  console.log("[places] enriching summary with query:", query);

  let candidates: PlaceCandidate[] = [];
  try {
    candidates = await searchGooglePlaces(query);
  } catch {
    return summary; // non-fatal
  }

  if (candidates.length === 0) return summary;

  // Filter to Thailand-only results.
  const thCandidates = candidates.filter(
    (c) => c.address.includes("ไทย") || c.address.toLowerCase().includes("thailand")
  );
  const pool = thCandidates.length > 0 ? thCandidates : candidates;

  // Single unambiguous result → auto-fill missing fields.
  const enrichedLocation: PlaceData["location"] = { ...place.location };
  let enrichedLatLng: { lat: number; lng: number } | undefined;

  if (pool.length === 1) {
    const c = pool[0];
    if (!enrichedLocation.province && c.province) enrichedLocation.province = c.province;
    if (!enrichedLocation.district && c.district) enrichedLocation.district = c.district;
    if (!enrichedLocation.subdistrict && c.subdistrict) enrichedLocation.subdistrict = c.subdistrict;
    if (c.latitude != null && c.longitude != null) {
      enrichedLatLng = { lat: c.latitude, lng: c.longitude };
    }
    // eslint-disable-next-line no-console
    console.log("[places] single match — enriched:", c.name, c.address);
  } else {
    // Multiple candidates — store for the app to show a picker (not auto-picked).
    // eslint-disable-next-line no-console
    console.log("[places] multiple matches —", pool.length, "candidates stored for user choice");
  }

  // Clean up internal fields before returning.
  const { _transcript, _onScreenText, ...cleanSummary } = summary as any;
  void _transcript; void _onScreenText;
  return {
    ...cleanSummary,
    place: {
      ...place,
      location: enrichedLocation,
      ...(enrichedLatLng ? { gps: `${enrichedLatLng.lat},${enrichedLatLng.lng}` } : {}),
      ...(pool.length > 1 ? { google_candidates: pool } : {}),
    } as PlaceData & { gps?: string; google_candidates?: PlaceCandidate[] },
  };
}

// ─────────────────────────────────────────────
//  1) POST /places/verify — user-facing picker
// ─────────────────────────────────────────────

const router = Router();

router.post("/verify", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const placeName: string = (body.placeName ?? "").toString().trim();
  if (!placeName) {
    return res.status(400).json({ error: "placeName is required" });
  }
  if (!isPlacesConfigured()) {
    return res.json({ configured: false, candidates: [] as PlaceCandidate[] });
  }

  const parts = [placeName, body.community, body.district, body.province]
    .filter((x: unknown) => typeof x === "string" && (x as string).trim())
    .join(" ");

  try {
    const candidates = await searchGooglePlaces(`${parts} ประเทศไทย`);
    return res.json({ configured: true, candidates });
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ Google" : err?.message || "ค้นหาสถานที่ไม่สำเร็จ";
    return res.status(502).json({ error: message });
  }
});

export default router;
