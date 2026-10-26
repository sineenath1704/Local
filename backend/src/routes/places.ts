import { Router, Request, Response } from "express";
import { config, isPlacesConfigured } from "../config";
import type { AiSummaryResult } from "../aiClient";
import type { PlaceCandidate } from "../placeTypes";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { sendError } from "../middleware/errors";
import { DiagLog, errorDetail } from "../summaryDiag";

export type { PlaceCandidate };

/**
 * Google Places integration
 * ---------------------------------------------------------
 * Two uses:
 *  1) POST /places/verify   — user-facing: search + return candidates for the
 *     CreatePostScreen location picker (user chooses, never auto-pick).
 *  2) POST /places/details  — user-facing: ONE Place Details call, made only
 *     AFTER the user ticks a candidate, to fill the location form.
 *  3) POST /places/place-details — read the details we already hold for a
 *     place, so the editing card shows the place's own values, not Google's.
 *  4) POST /places/save-place-details — a host confirms a place's price band,
 *     website, phone and opening hours; the correction lands on the place's
 *     row in `community_places`, which is what the AI chat reads.
 *  5) enrichWithGooglePlaces() — internal: after the AI video summary, look
 *     up candidate places for the clip. It returns the candidate LIST and
 *     nothing else — it no longer picks a place and no longer overwrites the
 *     name/location the AI read from the clip. Choosing is the user's job.
 *
 * Cost note: a search used to cost 6 billable calls (1 text search + 5 Place
 * Details). It is now 1 call to search, and 1 more for details — but only for
 * the place the user actually ticks.
 */

// ─────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────

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

/**
 * Field masks.
 *
 * Places API (New) bills the SKU by the fields you ask for: "basic" fields
 * (name/address/location/types) sit in the cheap Essentials tier, while
 * contact + atmosphere fields (phone, website, opening hours, rating) push the
 * call into the pricier Pro tier. So the SEARCH asks for basic fields only,
 * and the contact/atmosphere fields are fetched later — once, for the single
 * place the user ticks.
 */
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.addressComponents",
  "places.googleMapsUri",
  "places.businessStatus",
].join(",");

const DETAILS_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.addressComponents",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.regularOpeningHours",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
].join(",");

/** Map a Places API (New) payload → our candidate shape. */
function mapNewPlace(p: any): PlaceCandidate {
  const admin = extractAdmin(p.addressComponents);
  const lat = p.location?.latitude ?? null;
  const lng = p.location?.longitude ?? null;
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
    googleMapsUri:
      p.googleMapsUri ??
      (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null),
    businessStatus: p.businessStatus ?? null,
    primaryType: p.primaryType ?? null,
    primaryTypeDisplayName: p.primaryTypeDisplayName?.text ?? null,
    priceLevel: p.priceLevel ?? null,
  };
}

/**
 * Search Google Places by text. ONE billable call.
 *
 * Returns only what the picker needs (name / address / coords / admin area).
 * Phone, hours, website and rating are NOT fetched here — they cost a Pro-tier
 * details call, and we only spend that once the user has picked a place.
 */
export async function searchPlaceCandidates(query: string): Promise<PlaceCandidate[]> {
  if (!isPlacesConfigured()) return [];

  // 1) Places API (New) — preferred (cheaper per call).
  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.places.googleKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
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
      if (places.length > 0) return places.map(mapNewPlace);
    }
  } catch (err: any) {
    console.warn("[places] Places API (New) fetch error:", err?.message);
  }

  // 2) Legacy TextSearch fallback — also ONE call. It has no address
  //    components, so the admin area is parsed out of the formatted address.
  try {
    const legacyUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query
    )}&language=th&region=th&key=${config.places.googleKey}`;
    const legacyResp = await fetch(legacyUrl);
    if (legacyResp.ok) {
      const legData: any = await legacyResp.json();
      if (legData.status === "OK" && Array.isArray(legData.results)) {
        return legData.results.slice(0, 5).map((p: any) => {
          const admin = extractAdminFromAddress(p.formatted_address ?? "");
          const lat = p.geometry?.location?.lat ?? null;
          const lng = p.geometry?.location?.lng ?? null;
          return {
            name: p.name ?? "",
            address: p.formatted_address ?? "",
            placeId: p.place_id ?? "",
            latitude: lat,
            longitude: lng,
            province: admin.province,
            district: admin.district,
            subdistrict: admin.subdistrict,
            types: p.types ?? [],
            // Not available on the search response — filled by the details call.
            phone: null,
            openingHours: null,
            rating: p.rating ?? null,
            userRatingCount: p.user_ratings_total ?? null,
            website: null,
            googleMapsUri:
              lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null,
            businessStatus: p.business_status ?? null,
            primaryType: p.types?.[0] ?? null,
            primaryTypeDisplayName: null,
            priceLevel: p.price_level ?? null,
          } as PlaceCandidate;
        });
      }
    }
  } catch (err: any) {
    console.warn("[places] Legacy textsearch error:", err?.message);
  }

  return [];
}

/**
 * Fetch the full record for ONE place id. ONE billable call.
 *
 * Called only after the user ticks a candidate — this is where the contact /
 * atmosphere fields (phone, opening hours, website, rating) come from.
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceCandidate | null> {
  if (!isPlacesConfigured() || !placeId) return null;

  // 1) Places API (New)
  try {
    const resp = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": config.places.googleKey,
          "X-Goog-FieldMask": DETAILS_FIELD_MASK,
        },
      }
    );
    if (resp.ok) {
      const p: any = await resp.json();
      return mapNewPlace(p);
    }
  } catch (err: any) {
    console.warn("[places] Places (New) details error:", err?.message);
  }

  // 2) Legacy Place Details fallback
  try {
    const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
      placeId
    )}&fields=name,formatted_address,address_component,geometry,type,formatted_phone_number,opening_hours,rating,user_ratings_total,website,url,business_status,price_level&language=th&key=${config.places.googleKey}`;
    const detResp = await fetch(detUrl);
    if (detResp.ok) {
      const detData: any = await detResp.json();
      if (detData.status === "OK" && detData.result) {
        const r = detData.result;
        const admin = extractAdmin(r.address_components);
        const lat = r.geometry?.location?.lat ?? null;
        const lng = r.geometry?.location?.lng ?? null;
        return {
          name: r.name ?? "",
          address: r.formatted_address ?? "",
          placeId,
          latitude: lat,
          longitude: lng,
          province: admin.province,
          district: admin.district,
          subdistrict: admin.subdistrict,
          types: r.types ?? [],
          phone: r.formatted_phone_number ?? null,
          openingHours: Array.isArray(r.opening_hours?.weekday_text)
            ? r.opening_hours.weekday_text.join(" | ")
            : null,
          rating: r.rating ?? null,
          userRatingCount: r.user_ratings_total ?? null,
          website: r.website ?? null,
          googleMapsUri:
            r.url ??
            (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null),
          businessStatus: r.business_status ?? null,
          primaryType: r.type ?? null,
          primaryTypeDisplayName: null,
          priceLevel: r.price_level ?? null,
        } as PlaceCandidate;
      }
    }
  } catch (err: any) {
    console.warn("[places] Legacy details error:", err?.message);
  }

  return null;
}

// ─────────────────────────────────────────────
//  2) Internal enricher — called after AI summary
// ─────────────────────────────────────────────

/**
 * After M3 returns a summary, look up candidate places for the clip and hand
 * the LIST back to the app.
 *
 * It does NOT choose a place and it does NOT overwrite the name or location
 * the AI read from the clip — the user ticks the right candidate, and only
 * then does the app spend one Place Details call to fill the form.
 */
export async function enrichWithGooglePlaces(
  summary: AiSummaryResult,
  diag?: DiagLog
): Promise<AiSummaryResult> {
  const t0 = Date.now();

  if (!isPlacesConfigured()) {
    if (diag) {
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: "skipped",
        ms: 0,
        detail: "ไม่ได้ตั้งค่า GOOGLE_PLACES_API_KEY บนเซิร์ฟเวอร์",
      });
      diag.problem("ไม่ได้ตั้งค่า GOOGLE_PLACES_API_KEY — ค้นสถานที่ไม่ได้");
    }
    return summary;
  }

  const place = summary.place;
  if (!place) {
    if (diag) {
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: "failed",
        ms: Date.now() - t0,
        detail: "AI ไม่ได้ส่งข้อมูลสถานที่มาเลย (place ว่าง) — ไม่มีอะไรให้ค้น",
      });
      diag.problem(
        "AI ไม่ได้ส่งข้อมูลสถานที่มาเลย — ค้น Google Places ไม่ได้ (มักเป็นเพราะคำตอบของโมเดลถูกตัด)"
      );
    }
    return summary;
  }

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

  if (!query) {
    if (diag) {
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: "failed",
        ms: Date.now() - t0,
        detail: "สร้างคำค้นไม่ได้ (ไม่มีชื่อสถานที่/ชุมชน/จังหวัด)",
      });
      diag.problem("สร้างคำค้น Google ไม่ได้ — ไม่มีชื่อสถานที่หรือจังหวัดเลย");
    }
    return summary;
  }

  console.log("[places] searching candidates with query:", query);

  let candidates: PlaceCandidate[] = [];
  try {
    candidates = await searchPlaceCandidates(query);
  } catch (err: any) {
    if (diag) {
      const msg = errorDetail(err);
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: "failed",
        ms: Date.now() - t0,
        detail: `เรียก Google Places ไม่สำเร็จ: ${msg}`,
      });
      diag.problem(`เรียก Google Places ไม่สำเร็จ: ${msg}`);
    }
    return summary; // non-fatal
  }

  if (candidates.length === 0) {
    if (diag) {
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: "failed",
        ms: Date.now() - t0,
        detail: `ค้นแล้วไม่เจอสถานที่ (คำค้น: ${query})`,
      });
      diag.problem(`ค้น Google Places แล้วไม่เจอสถานที่ — คำค้น "${query}"`);
    }
    return summary;
  }

  // Filter to Thailand-only results.
  const thCandidates = candidates.filter(
    (c) => c.address.includes("ไทย") || c.address.toLowerCase().includes("thailand")
  );
  const pool = thCandidates.length > 0 ? thCandidates : candidates;

  // Order the list so the most likely match is first — but the user still has
  // to tick it. Ordering is a hint, not a decision.
  const ranked = [...pool].sort((a, b) => {
    const score = (c: PlaceCandidate) => {
      let s = 0;
      if (knownProvince && (c.province === knownProvince || c.address.includes(knownProvince))) s += 3;
      if (knownDistrict && (c.district === knownDistrict || c.address.includes(knownDistrict))) s += 2;
      if (knownSubdistrict && c.address.includes(knownSubdistrict)) s += 1;
      return s;
    };
    return score(b) - score(a);
  });

  console.log("[places] candidate list:", ranked.length, "— awaiting user pick");

  if (diag) {
    diag.add({
      id: "places",
      label: "ค้นสถานที่ (Google Places)",
      status: "ok",
      ms: Date.now() - t0,
      detail: `เจอ ${ranked.length} จุด — รอผู้ใช้ติ๊ก`,
      data: { candidates: ranked.length },
    });
  }

  // Clean up internal fields before returning.
  const { _transcript, _onScreenText, ...cleanSummary } = summary as any;
  void _transcript; void _onScreenText;
  return {
    ...cleanSummary,
    place: {
      ...place,
      google_candidates: ranked,
    },
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

  const parts = [placeName, body.community, body.subdistrict, body.district, body.province]
    .filter((x: unknown) => typeof x === "string" && (x as string).trim())
    .join(" ");

  try {
    const rawCandidates = await searchPlaceCandidates(`${parts} ประเทศไทย`);
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
    // A host looking for a spot inside their own community: keep only the
    // candidates that actually sit in that tambol.
    if (body.subdistrict && candidates.length > 0) {
      const subClean = cleanAdminName(body.subdistrict);
      const subMatches = candidates.filter(
        (c) => c.subdistrict === subClean || c.address.includes(subClean)
      );
      if (subMatches.length > 0) {
        candidates = subMatches;
      }
    }

    return res.json({ configured: true, candidates });
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ Google" : err?.message || "ค้นหาสถานที่ไม่สำเร็จ";
    return res.status(502).json({ error: message });
  }
});

// ─────────────────────────────────────────────
//  3) POST /places/place-details — what we already hold for a place
// ─────────────────────────────────────────────

/**
 * The details `community_places` already holds for a Google place id.
 *
 * The host picks a place while posting a clip and gets Google's price band,
 * phone, website and opening hours. Those are Google's opinion — the place's
 * owner may already have corrected them. Reading the row first means the
 * editing card shows the place's OWN values, with Google's as the fallback
 * only where the place has nothing yet.
 *
 * Public on purpose: `community_places` is publicly readable anyway, and the
 * card is shown to whoever is posting, not only to hosts.
 */
router.post("/place-details", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const placeId: string = (body.placeId ?? "").toString().trim();
  if (!placeId) {
    return res.status(400).json({ error: "placeId is required", code: "BAD_REQUEST" });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
      code: "NOT_CONFIGURED",
    });
  }

  const { data, error } = await admin
    .from("community_places")
    .select(
      "place_name, phone, opening_hours, price_info, price_level, website, capacity, house_rules, areas, facilities"
    )
    .eq("place_id", placeId)
    .maybeSingle();

  if (error) {
    // The four fact columns need their migration. Without it, read the rest —
    // the card still shows the place's own price, phone and hours.
    const { data: fallback, error: fallbackErr } = await admin
      .from("community_places")
      .select("place_name, phone, opening_hours, price_info, price_level, website")
      .eq("place_id", placeId)
      .maybeSingle();
    if (fallbackErr) {
      console.error("[places] place-details read failed:", fallbackErr.message);
      return res.status(500).json({ error: "อ่านข้อมูลสถานที่ไม่สำเร็จ", code: "READ_FAILED" });
    }
    return res.json({ place: fallback ?? null });
  }

  return res.json({ place: data ?? null });
});

// ─────────────────────────────────────────────
//  4) POST /places/save-place-details — the host's corrections
// ─────────────────────────────────────────────

/** Fields the host may correct, mapped onto `community_places` columns. */
const DETAIL_FIELDS: Record<string, string> = {
  phone: "phone",
  openingHours: "opening_hours",
  priceLevel: "price_level",
  website: "website",
};

/**
 * The clip-derived facts, stored as JSONB.
 *
 * `rules` is `house_rules` in Postgres: `rules` is a keyword there, and the
 * column name says what it holds anyway. `capacity` is an object
 * ({rooms, guests_per_room, max_guests, beds}), the other three are lists of
 * short strings.
 */
const DETAIL_JSON_FIELDS: Record<string, string> = {
  capacity: "capacity",
  rules: "house_rules",
  areas: "areas",
  facilities: "facilities",
};

/**
 * Save a place's details as confirmed by a host.
 *
 * The price of a place belongs to the PLACE, not to whoever posted the clip:
 * the row is keyed by the Google place id and keeps the owner it already had,
 * so a correction lands on the owner's record and the AI chat — which reads
 * `community_places` — answers from it.
 *
 * Only the columns in the request are touched. `price_info` (the owner's own
 * weekday/weekend prices) and `business_pricing` / `business_hours` are never
 * written from here: the price BAND is a different fact and lives in its own
 * column, and the structured prices belong to the profile editor.
 */
router.post("/save-place-details", async (req: Request, res: Response) => {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
      code: "NOT_CONFIGURED",
    });
  }

  // ---- who is calling? ---------------------------------------------------
  const token = /^Bearer\s+(.+)$/i.exec(req.header("authorization") ?? "")?.[1]?.trim();
  if (!token) {
    return res.status(401).json({
      error: "ต้องเข้าสู่ระบบก่อนจึงจะบันทึกข้อมูลสถานที่ได้",
      code: "UNAUTHORIZED",
    });
  }

  let uid: string;
  try {
    const { data: verified, error: verifyErr } = await admin.auth.getUser(token);
    if (verifyErr || !verified?.user?.id) {
      return res.status(401).json({
        error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
        code: "UNAUTHORIZED",
      });
    }
    uid = verified.user.id;
  } catch (err: any) {
    return sendError(res, err, req, 401);
  }

  // Only a host (community) curates place details. A tourist posting a
  // review must not be able to rewrite a place's price for everyone.
  const { data: userRow, error: userErr } = await admin
    .from("users")
    .select("role")
    .eq("id", uid)
    .maybeSingle();
  if (userErr) {
    return res.status(500).json({ error: "ตรวจสอบสิทธิ์ไม่สำเร็จ", code: "READ_FAILED" });
  }
  if (userRow?.role !== "host") {
    return res.status(403).json({
      error: "เฉพาะชุมชนเท่านั้นที่แก้ไขข้อมูลสถานที่ได้",
      code: "FORBIDDEN",
    });
  }

  // ---- what are we saving? ------------------------------------------------
  const body = req.body ?? {};
  const placeId: string = (body.placeId ?? "").toString().trim();
  const placeName: string = (body.placeName ?? "").toString().trim();
  const province: string = (body.province ?? "").toString().trim();
  if (!placeId || !placeName || !province) {
    return res.status(400).json({
      error: "ข้อมูลสถานที่ไม่ครบ (ต้องมีชื่อสถานที่และจังหวัด)",
      code: "BAD_REQUEST",
    });
  }

  // Two patches: the plain columns, and the JSONB facts. They are kept apart
  // so a fact column whose migration hasn't run yet can't cost the host the
  // price they just corrected.
  const patch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(DETAIL_FIELDS)) {
    if (!(key in body)) continue;
    const value = (body as any)[key];
    // null / undefined mean "we don't know" — the column is left as it is,
    // because the row may already carry the owner's own value. "" is the
    // host saying "clear this one".
    if (value === undefined || value === null) continue;
    patch[column] = String(value).trim();
  }

  // The JSONB facts keep their shape — a list stays a list, an object stays
  // an object. Same three-state rule: unknown leaves the column alone.
  const factPatch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(DETAIL_JSON_FIELDS)) {
    if (!(key in body)) continue;
    const value = (body as any)[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      factPatch[column] = value.map((v) => String(v ?? "").trim()).filter(Boolean);
      continue;
    }
    if (typeof value === "object") {
      const obj: Record<string, string> = {};
      for (const [k, v] of Object.entries(value)) {
        const text = String(v ?? "").trim();
        if (text) obj[k] = text;
      }
      factPatch[column] = obj;
      continue;
    }
    // "" from the client = the host cleared this fact. Anything else that
    // isn't a list or an object isn't a shape these columns can hold.
    factPatch[column] = null;
  }
  const fullPatch = { ...patch, ...factPatch };
  if (Object.keys(fullPatch).length === 0) {
    return res.status(400).json({ error: "ไม่มีข้อมูลให้บันทึก", code: "BAD_REQUEST" });
  }

  try {
    // The row may already exist — owned by whoever registered the place.
    const { data: existing, error: readErr } = await admin
      .from("community_places")
      .select("id, owner_id")
      .eq("place_id", placeId)
      .maybeSingle();
    if (readErr) {
      console.error("[places] save-place-details read failed:", readErr.message);
      return res.status(500).json({ error: "อ่านข้อมูลสถานที่ไม่สำเร็จ", code: "READ_FAILED" });
    }

    if (existing) {
      // Keep the place's existing owner — the price belongs to the place.
      const { error: updErr } = await admin
        .from("community_places")
        .update(fullPatch)
        .eq("place_id", placeId);
      if (updErr) {
        // A fact column that doesn't exist yet must not cost the host the
        // price they corrected — write the rest and say the facts were left.
        if (Object.keys(factPatch).length > 0 && isMissingColumnError(updErr.message)) {
          const { error: retryErr } = await admin
            .from("community_places")
            .update(patch)
            .eq("place_id", placeId);
          if (!retryErr) {
            console.warn("[places] save-place-details: fact columns missing, saved the rest");
            return res.json({
              ok: true,
              ownerId: existing.owner_id ?? null,
              factsSkipped: true,
            });
          }
        }
        console.error("[places] save-place-details update failed:", updErr.message);
        return res.status(400).json({
          error: humanizeDetailsError(updErr.message),
          code: "WRITE_FAILED",
        });
      }
      return res.json({ ok: true, ownerId: existing.owner_id ?? null });
    }

    // A place we have never stored: the host who confirms it becomes its
    // owner, so the row has a person behind it.
    const { error: insErr } = await admin.from("community_places").insert({
      place_id: placeId,
      place_name: placeName,
      province,
      district: body.district ?? null,
      subdistrict: body.subdistrict ?? null,
      village: body.village ?? null,
      formatted_address: body.formattedAddress ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      google_maps_url: body.googleMapsUrl ?? null,
      owner_id: uid,
      source: "google_places",
      ...fullPatch,
    });
    if (insErr) {
      // Same as the update path: a missing fact column must not cost the
      // host the place itself — insert the row without the facts.
      if (Object.keys(factPatch).length > 0 && isMissingColumnError(insErr.message)) {
        const { error: retryErr } = await admin.from("community_places").insert({
          place_id: placeId,
          place_name: placeName,
          province,
          district: body.district ?? null,
          subdistrict: body.subdistrict ?? null,
          village: body.village ?? null,
          formatted_address: body.formattedAddress ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          google_maps_url: body.googleMapsUrl ?? null,
          owner_id: uid,
          source: "google_places",
          ...patch,
        });
        if (!retryErr) {
          console.warn("[places] save-place-details: fact columns missing, saved the rest");
          return res.json({ ok: true, ownerId: uid, factsSkipped: true });
        }
      }
      console.error("[places] save-place-details insert failed:", insErr.message);
      return res.status(400).json({
        error: humanizeDetailsError(insErr.message),
        code: "WRITE_FAILED",
      });
    }
    return res.json({ ok: true, ownerId: uid });
  } catch (err: any) {
    return sendError(res, err, req, 500);
  }
});

/** Postgres complaining that one of our columns doesn't exist yet. */
function isMissingColumnError(message: string): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("does not exist") && m.includes("column");
}

/** Postgres messages about our own schema — the app shouldn't leak them raw. */
function humanizeDetailsError(message: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("price_level") && m.includes("does not exist")) {
    return "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration add_community_places_price_level.sql";
  }
  if (
    (m.includes("house_rules") ||
      m.includes("capacity") ||
      m.includes("facilities") ||
      m.includes("areas")) &&
    m.includes("does not exist")
  ) {
    return "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration add_community_places_place_facts.sql";
  }
  if (m.includes("community_places") && m.includes("does not exist")) {
    return "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration create_community_places.sql";
  }
  return "บันทึกข้อมูลสถานที่ไม่สำเร็จ";
}

// ─────────────────────────────────────────────
//  2) POST /places/details — ONE call, only after the user ticks
// ─────────────────────────────────────────────

router.post("/details", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const placeId: string = (body.placeId ?? "").toString().trim();
  if (!placeId) {
    return res.status(400).json({ error: "placeId is required" });
  }
  if (!isPlacesConfigured()) {
    return res.json({ configured: false, place: null });
  }

  try {
    const place = await getPlaceDetails(placeId);
    if (!place) {
      return res.status(404).json({ error: "ไม่พบข้อมูลสถานที่นี้" });
    }
    return res.json({ configured: true, place });
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ Google" : err?.message || "ดึงข้อมูลสถานที่ไม่สำเร็จ";
    return res.status(502).json({ error: message });
  }
});

export default router;
