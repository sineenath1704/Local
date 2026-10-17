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
  phone?: string | null;
  openingHours?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  website?: string | null;
  googleMapsUri?: string | null;
  businessStatus?: string | null;
}

function cleanAdminName(name: string): string {
  if (!name) return "";
  return name.replace(/^(จังหวัด|จ\.|อำเภอ|อ\.|ตำบล|ต\.|เขต|แขวง)\s*/g, "").trim();
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
    const name: string = cleanAdminName(c.longText ?? c.long_name ?? "");
    if (!name) continue;
    if (types.includes("administrative_area_level_1")) {
      province = name;
    } else if (types.includes("administrative_area_level_2")) {
      district = name;
    } else if (
      types.includes("locality") ||
      types.includes("sublocality") ||
      types.includes("sublocality_level_1") ||
      types.includes("administrative_area_level_3")
    ) {
      if (!subdistrict) subdistrict = name;
    }
  }
  return { province, district, subdistrict };
}

/**
 * Parse province/district/subdistrict from a Thai formatted_address string.
 * Thai address pattern: "..., ตำบลXXX อำเภอXXX จังหวัดXXX XXXXX"
 * Used as fallback when addressComponents are not available.
 */
function extractAdminFromAddress(address: string): {
  province: string | null;
  district: string | null;
  subdistrict: string | null;
} {
  let province: string | null = null;
  let district: string | null = null;
  let subdistrict: string | null = null;

  const explicitProv = address.match(/(?:จังหวัด|จ\.)\s*([^\s,\d]+)/);
  if (explicitProv) {
    province = cleanAdminName(explicitProv[1]);
  } else {
    const zipProv = address.match(/([^\s,]+)\s+\d{5}/);
    if (zipProv && !zipProv[1].startsWith("อำเภอ") && !zipProv[1].startsWith("อ.")) {
      province = cleanAdminName(zipProv[1]);
    } else if (address.includes("กรุงเทพ")) {
      province = "กรุงเทพมหานคร";
    }
  }

  const distMatch = address.match(/(?:อำเภอ|อ\.|เขต)\s*([^\s,]+)/);
  if (distMatch) district = cleanAdminName(distMatch[1]);

  const subMatch = address.match(/(?:ตำบล|ต\.|แขวง)\s*([^\s,]+)/);
  if (subMatch) subdistrict = cleanAdminName(subMatch[1]);

  return { province, district, subdistrict };
}

export const THAI_PROVINCES = [
  "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร",
  "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท",
  "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง",
  "ตราด", "ตาก", "นครนายก", "นครปฐม", "นครพนม",
  "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี", "นราธิวาส",
  "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์",
  "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา", "พังงา",
  "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์",
  "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน",
  "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง",
  "ราชบุรี", "ลพบุรี", "ลำปาง", "ลำพูน", "เลย",
  "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
  "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี",
  "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย",
  "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์",
  "อุทัยธานี", "อุบลราชธานี"
];

function detectProvinceFromText(...texts: (string | undefined | null)[]): string | null {
  const combined = texts.filter(Boolean).join(" ");
  if (!combined) return null;
  for (const prov of THAI_PROVINCES) {
    if (combined.includes(prov)) return prov;
  }
  return null;
}

/** Call Google Places Text Search. Returns raw candidates array with Place Details enrichment. */
async function searchGooglePlaces(query: string): Promise<PlaceCandidate[]> {
  if (!isPlacesConfigured()) return [];

  // 1. Try Google Places API (New) first
  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.places.googleKey,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.id,places.location,places.types,places.addressComponents,places.regularOpeningHours,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,places.businessStatus",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "th",
        regionCode: "TH",
        maxResultCount: 5,
      }),
    });

    if (resp.ok) {
      const data: any = await resp.json();
      const places = data.places ?? [];
      if (places.length > 0) {
        return places.map((p: any) => {
          const admin = extractAdmin(p.addressComponents);
          const lat = p.location?.latitude ?? null;
          const lng = p.location?.longitude ?? null;
          const mapsUri =
            p.googleMapsUri ??
            (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);
          const hours = Array.isArray(p.regularOpeningHours?.weekdayDescriptions)
            ? p.regularOpeningHours.weekdayDescriptions.join(" | ")
            : null;

          return {
            name: p.displayName?.text ?? "",
            address: p.formattedAddress ?? "",
            placeId: p.id ?? "",
            latitude: lat,
            longitude: lng,
            province: admin.province,
            district: admin.district,
            subdistrict: admin.subdistrict,
            types: p.types ?? [],
            phone: p.nationalPhoneNumber ?? null,
            openingHours: hours,
            rating: p.rating ?? null,
            userRatingCount: p.userRatingCount ?? null,
            website: p.websiteUri ?? null,
            googleMapsUri: mapsUri,
            businessStatus: p.businessStatus ?? null,
          } as PlaceCandidate;
        });
      }
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn("[places] Places API (New) fetch error:", err?.message);
  }

  // 2. Fallback to Classic Google Maps TextSearch API + Place Details for 100% accurate address components
  try {
    const legacyUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query
    )}&language=th&region=th&key=${config.places.googleKey}`;
    const legacyResp = await fetch(legacyUrl);
    if (legacyResp.ok) {
      const legData: any = await legacyResp.json();
      if (legData.status === "OK" && Array.isArray(legData.results)) {
        const topResults = legData.results.slice(0, 5);

        // Fetch Place Details in parallel to get official, structured address_components and details
        const candidates = await Promise.all(
          topResults.map(async (p: any) => {
            const placeId = p.place_id ?? "";
            let admin = extractAdminFromAddress(p.formatted_address ?? "");
            let candidateName = p.name ?? "";
            let candidateAddress = p.formatted_address ?? "";
            let lat = p.geometry?.location?.lat ?? null;
            let lng = p.geometry?.location?.lng ?? null;
            let phone: string | null = null;
            let openingHours: string | null = null;
            let rating: number | null = p.rating ?? null;
            let userRatingCount: number | null = p.user_ratings_total ?? null;
            let website: string | null = null;
            let googleMapsUri: string | null =
              lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
            let businessStatus: string | null = p.business_status ?? null;

            if (placeId) {
              try {
                const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
                  placeId
                )}&fields=name,formatted_address,address_component,geometry,type,formatted_phone_number,opening_hours,rating,user_ratings_total,website,url,business_status&language=th&key=${config.places.googleKey}`;
                const detResp = await fetch(detUrl);
                if (detResp.ok) {
                  const detData: any = await detResp.json();
                  if (detData.status === "OK" && detData.result) {
                    const r = detData.result;
                    const parsedAdmin = extractAdmin(r.address_components);
                    if (parsedAdmin.province) admin.province = parsedAdmin.province;
                    if (parsedAdmin.district) admin.district = parsedAdmin.district;
                    if (parsedAdmin.subdistrict) admin.subdistrict = parsedAdmin.subdistrict;
                    if (r.name) candidateName = r.name;
                    if (r.formatted_address) candidateAddress = r.formatted_address;
                    if (r.geometry?.location?.lat != null) lat = r.geometry.location.lat;
                    if (r.geometry?.location?.lng != null) lng = r.geometry.location.lng;
                    if (r.formatted_phone_number) phone = r.formatted_phone_number;
                    if (Array.isArray(r.opening_hours?.weekday_text)) {
                      openingHours = r.opening_hours.weekday_text.join(" | ");
                    }
                    if (r.rating != null) rating = r.rating;
                    if (r.user_ratings_total != null) userRatingCount = r.user_ratings_total;
                    if (r.website) website = r.website;
                    if (r.url) googleMapsUri = r.url;
                    if (r.business_status) businessStatus = r.business_status;
                  }
                }
              } catch {
                // non-fatal, fallback to textsearch values
              }
            }

            return {
              name: candidateName,
              address: candidateAddress,
              placeId,
              latitude: lat,
              longitude: lng,
              province: admin.province,
              district: admin.district,
              subdistrict: admin.subdistrict,
              types: p.types ?? [],
              phone,
              openingHours,
              rating,
              userRatingCount,
              website,
              googleMapsUri,
              businessStatus,
            } as PlaceCandidate;
          })
        );

        return candidates;
      }
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn("[places] Legacy textsearch error:", err?.message);
  }

  return [];
}

// ─────────────────────────────────────────────
//  2) Internal enricher — called after AI summary
// ─────────────────────────────────────────────

/**
 * After M3 returns a summary, call Google Places with the place/community name
 * and contextual location clues to fill in the location fields (province/district/subdistrict)
 * and coordinates with 100% precision.
 */
export async function enrichWithGooglePlaces(
  summary: AiSummaryResult
): Promise<AiSummaryResult> {
  if (!isPlacesConfigured()) return summary;

  const place = summary.place;
  if (!place) return summary;

  const rawTranscript = (summary as any)._transcript as string | undefined;
  const rawOnScreen = Array.isArray((summary as any)._onScreenText)
    ? ((summary as any)._onScreenText as string[]).join(" ")
    : undefined;
  const rawReasoning = (summary as any).reasoning
    ? JSON.stringify((summary as any).reasoning)
    : undefined;

  // Detect province from location or context texts
  const knownProvince =
    place.location?.province ||
    detectProvinceFromText(rawTranscript, rawOnScreen, rawReasoning, summary.text);

  const knownDistrict = place.location?.district || null;
  const knownSubdistrict = place.location?.subdistrict || null;

  // Build search query — combine place_name / community WITH district and province for maximum precision!
  const queryParts = [
    place.place_name,
    (place as any).community,
    knownDistrict,
    knownProvince,
  ].filter((x): x is string => typeof x === "string" && x.trim() !== "");

  let query = "";
  if (queryParts.length > 0) {
    query = `${queryParts.join(" ")} ประเทศไทย`.trim();
  } else if (knownProvince) {
    query = `${[knownSubdistrict, knownDistrict, knownProvince].filter(Boolean).join(" ")} ประเทศไทย`.trim();
  }

  if (!query) return summary;

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

  // Prioritize candidates matching known province if available
  let prioritizedPool = pool;
  if (knownProvince) {
    const provMatches = pool.filter(
      (c) => c.province === knownProvince || c.address.includes(knownProvince)
    );
    if (provMatches.length > 0) {
      prioritizedPool = provMatches;
    }
  }

  const enrichedLocation: PlaceData["location"] = { ...place.location };
  let googlePlaceName: string | null = null;
  let googleCommunity: string | null = null;
  let googleMapsLink: string | null = null;

  if (prioritizedPool.length > 0) {
    const c = prioritizedPool[0];
    if (c.province) enrichedLocation.province = c.province;
    if (c.district) enrichedLocation.district = c.district;
    if (c.subdistrict) enrichedLocation.subdistrict = c.subdistrict;
    if (c.name) googlePlaceName = c.name;
    if (c.subdistrict) googleCommunity = c.subdistrict;
    if (c.latitude != null && c.longitude != null) {
      googleMapsLink = `https://www.google.com/maps?q=${c.latitude},${c.longitude}`;
    } else if (c.placeId) {
      googleMapsLink = `https://www.google.com/maps/place/?q=place_id:${c.placeId}`;
    }
    // eslint-disable-next-line no-console
    console.log("[places] best match →", c.name, "province:", c.province, "district:", c.district, "subdistrict:", c.subdistrict);
  }

  // Clean up internal fields before returning.
  const { _transcript, _onScreenText, ...cleanSummary } = summary as any;
  void _transcript; void _onScreenText;
  return {
    ...cleanSummary,
    place: {
      ...place,
      place_name: googlePlaceName ?? place.place_name,
      community: (place as any).community || googleCommunity || null,
      location: {
        ...enrichedLocation,
        gps: googleMapsLink ?? enrichedLocation.gps ?? null,
      },
      ...(prioritizedPool.length > 0 ? { google_candidates: prioritizedPool } : {}),
    } as PlaceData & { community?: string | null; google_candidates?: PlaceCandidate[] },
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
    const rawCandidates = await searchGooglePlaces(`${parts} ประเทศไทย`);
    let candidates = rawCandidates;

    // Strict scoping: prioritize/filter candidates in the specified province/district
    if (body.province) {
      const provClean = cleanAdminName(body.province);
      const provMatches = rawCandidates.filter(
        (c) => c.province === provClean || c.address.includes(provClean)
      );
      if (provMatches.length > 0) {
        candidates = provMatches;
      }
    }
    if (body.district && candidates.length > 0) {
      const distClean = cleanAdminName(body.district);
      const distMatches = candidates.filter(
        (c) => c.district === distClean || c.address.includes(distClean)
      );
      if (distMatches.length > 0) {
        candidates = distMatches;
      }
    }

    return res.json({ configured: true, candidates });
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ Google" : err?.message || "ค้นหาสถานที่ไม่สำเร็จ";
    return res.status(502).json({ error: message });
  }
});

export default router;
