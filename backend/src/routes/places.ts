import { Router, Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, isPlacesConfigured } from "../config";
import type { AiSummaryResult } from "../aiClient";
import type { CommunityMatchLevel, PlaceCandidate, PlaceResolution } from "../placeTypes";
import {
  filterByScope,
  matchLevelFor,
  MATCH_RANK,
  type LocationScope,
  type ScopeLevel,
} from "../placeScope";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { sendError } from "../middleware/errors";
import { DiagLog, errorDetail } from "../summaryDiag";
import { placeNameLooksRight } from "../googleMaps";
import {
  parseMapsUrlCoords,
  mapsUrlPlaceName,
  isShortMapsLink,
  expandMapsUrl,
} from "../mapsUrl";

export type { PlaceCandidate, CommunityMatchLevel, LocationScope, ScopeLevel };
// ผู้เรียกเดิมอาจดึงฟังก์ชันเทียบจากที่นี่ — คงไว้ให้ใช้ต่อได้
export {
  normalizeAdmin,
  villageKeyOf,
  isTooShortToMatchVillage,
  isSameAdmin,
  matchLevelFor,
  filterByScope,
} from "../placeScope";

/**
 * Google ตอบว่า "ผิดพลาด" — ไม่ใช่ "ไม่เจอ"
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §2.6.2 — เดิมโค้ดเช็คแค่ `status === "OK"` แล้ว
 * คืน [] เงียบ ๆ ทำให้ "บิลลิ่มปิด" กับ "ค้นไม่เจอ" เป็นเรื่องเดียวกัน
 */
export class PlacesApiError extends Error {
  readonly provider: "places_new" | "legacy";
  readonly googleStatus?: string;

  constructor(
    message: string,
    provider: "places_new" | "legacy",
    googleStatus?: string
  ) {
    super(message);
    this.name = "PlacesApiError";
    this.provider = provider;
    this.googleStatus = googleStatus;
  }
}

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
 *  6) GET /places/community — every place of one community, read back for the
 *     community profile page (PLAN §5.7).
 *  7) searchPlaceCandidatesMulti() — internal: ค้นหลายคำแล้วรวมผล ตอนที่รอบ
 *     "หาสถานที่" ให้คำค้นที่มีหลักฐานรองรับมาหลายคำ
 *  8) POST /places/resolve-coords — ลิงก์ Google Maps (หรือชื่อ/ที่อยู่) → พิกัด
 *     ใช้ตอนผู้ใช้วางลิงก์แผนที่ที่ไม่มีพิกัดในตัว (ลิงก์สั้น/ลิงก์ที่มีแต่ชื่อ)
 *     → ต้องกางลิงก์และ/หรือถาม Google Places ที่ฝั่งเซิร์ฟเวอร์ (คีย์เป็น server-only)
 *
 * Cost note: a search used to cost 6 billable calls (1 text search + 5 Place
 * Details). It is now 1 call to search, and 1 more for details — but only for
 * the place the user actually ticks.
 *
 * หลังเพิ่มการค้นหลายคำ: หนึ่งคำค้น = 1 ค่าเรียก API → การค้นหลายคำจึง
 * หยุดเร็วทันทีที่เจอผู้สมัครที่ตรงขอบเขตแล้ว (ดู `searchPlaceCandidatesMulti`)
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
  "places.photos",
].join(",");

/**
 * รูปสถานที่ → path ของ route ที่ยิงรูปมาให้แอป
 *
 * Google ไม่ให้ URL รูปตรง ๆ (Legacy ต้องใช้ `photo_reference` + key,
 * New ต้องใช้ photo `name`) และ key เป็น server-only → แอปต้องผ่าน
 * `/places/photo` ของเราแทน ค่า path ที่คืนเป็น relative เพราะ backend
 * ไม่รู้ public URL ของตัวเอง (บน Vercel ขึ้นกับ deployment)
 */
function photoPathFor(ref?: string | null, name?: string | null): string | null {
  if (ref) return `/places/photo?ref=${encodeURIComponent(ref)}&w=400`;
  if (name) return `/places/photo?name=${encodeURIComponent(name)}&w=400`;
  return null;
}


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
    photoUrl: photoPathFor(null, p.photos?.[0]?.name ?? null),
  };
}

/**
 * Search Google Places by text. ONE billable call.
 *
 * Returns only what the picker needs (name / address / coords / admin area).
 * Phone, hours, website and rating are NOT fetched here — they cost a Pro-tier
 * details call, and we only spend that once the user has picked a place.
 *
 * ข้อสำคัญ (PLAN_PLACE_MATCHING.md §2.6.2): ถ้า Google ตอบว่าผิดพลาด
 * (เช่น REQUEST_DENIED ตอนบิลลิ่มปิด) ต้อง **throw** — ไม่ใช่คืน [] เงียบ ๆ
 * เพราะ [] แปลว่า "ค้นแล้วไม่เจอ" ซึ่งไม่ใช่ความจริง
 */
export async function searchPlaceCandidates(
  query: string,
  opts?: { maxResults?: number }
): Promise<PlaceCandidate[]> {
  if (!isPlacesConfigured()) return [];

  // จำนวนผลลัพธ์ที่เก็บไว้ให้ตัวเลือกพิกัดพิจารณา
  //   · ค่าเริ่มต้น 5 = เหมือนเดิม (ผู้ใช้ติ๊กเอง → แค่หน้าแรกก็พอ)
  //   · งานหาพิกัดจากลิงก์ใช้ 20 เพราะชื่อสถานที่ซ้ำข้ามจังหวัด
  //     และของจริงอาจอยู่อันดับที่ 6-20 (Google เรียงตามความเกี่ยวข้องของมันเอง)
  const maxResults = Math.max(1, Math.min(opts?.maxResults ?? 5, 20));

  // 1) Places API (New) — preferred (cheaper per call).
  //    ถ้าล้มเหลว → ลอง Legacy ต่อ (จะ throw ถ้าตัวนั้นก็ล้มเหลว)
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
        maxResultCount: Math.min(maxResults, 10),
      }),
    });

    if (resp.ok) {
      const data: any = await resp.json();
      const places = data.places ?? [];
      if (places.length > 0) return places.map(mapNewPlace);
    } else {
      const body: any = await resp.json().catch(() => null);
      const status = body?.error?.status;
      console.warn(
        `[places] Places API (New) HTTP ${resp.status}${status ? ` (${status})` : ""} — ใช้ Legacy ต่อ`
      );
    }
  } catch (err: any) {
    console.warn("[places] Places API (New) fetch error:", err?.message);
  }

  // 2) Legacy TextSearch fallback — also ONE call. It has no address
  //    components, so the admin area is parsed out of the formatted address.
  let legacyResp: globalThis.Response;
  try {
    const legacyUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query
    )}&language=th&region=th&key=${config.places.googleKey}`;
    legacyResp = await fetch(legacyUrl);
  } catch (err: any) {
    throw new PlacesApiError(
      `เรียก Google Places ไม่สำเร็จ: ${err?.message ?? "เชื่อมต่อไม่ได้"}`,
      "legacy"
    );
  }

  if (!legacyResp.ok) {
    throw new PlacesApiError(
      `Google Places ตอบกลับ HTTP ${legacyResp.status}`,
      "legacy"
    );
  }

  const legData: any = await legacyResp.json().catch(() => null);
  const status: string = legData?.status ?? "UNKNOWN";

  // ZERO_RESULTS = ค้นแล้วไม่เจอจริง → คืน [] ปกติ
  if (status === "ZERO_RESULTS") return [];

  // อย่างอื่น = ผิดพลาดของ API (REQUEST_DENIED / OVER_QUERY_LIMIT / …)
  if (status !== "OK") {
    const detail = legData?.error_message ? ` — ${legData.error_message}` : "";
    throw new PlacesApiError(
      `Google Places ตอบกลับสถานะ ${status}${detail}`,
      "legacy",
      status
    );
  }

  const results: any[] = Array.isArray(legData?.results) ? legData.results : [];
  return results.slice(0, maxResults).map((p: any) => {
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

/**
 * ผลการค้นหลายคำ
 * -------------------------------------------------------------
 * คำค้นหนึ่งคำมักไม่พอ — ชื่อที่ AI อ่านมาอาจสะกดต่างจากที่ Google
 * บันทึกไว้ หรือพื้นที่ที่คลิปพูดถึงอาจไม่ใช่ชื่อที่ Google ใช้
 * → ลองหลายคำ แล้วรวมผลที่ได้ (ตัดซ้ำ) ให้ผู้ใช้ติ๊กเอง
 */
export interface MultiSearchResult {
  /** ผู้สมัครที่รวมจากทุกคำค้น (ตัดรายการซ้ำแล้ว) */
  candidates: PlaceCandidate[];
  /** คำค้นที่ลองจริง */
  queries: string[];
  /** ข้อความ error ของคำค้นที่ล้มเหลว — ไม่ทำให้ทั้งหมดล้มเหลว */
  errors: string[];
}

/** เติม "ประเทศไทย" ให้คำค้น — แอปใช้ข้อมูลแค่ประเทศไทย */
function withThailandSuffix(query: string): string {
  const q = (query ?? "").trim();
  if (!q) return "";
  if (q.includes("ประเทศไทย") || q.toLowerCase().includes("thailand")) return q;
  return `${q} ประเทศไทย`;
}

/**
 * มีผู้สมัครที่ "ตรงขอบเขต" แรง ๆ แล้วไหม (อยู่หมู่บ้านเดียวกัน / ตำบลเดียวกัน)
 * → ใช้ตัดสินว่าจะหยุดค้นคำต่อไหม (ประหยัดค่าเรียก API)
 */
function hasStrongScopeMatch(
  candidates: PlaceCandidate[],
  scope: LocationScope
): boolean {
  return candidates.some((c) => {
    const level = matchLevelFor(c, scope);
    return level === "village" || level === "subdistrict";
  });
}

/**
 * ค้น Google หลายคำ แล้วรวมผล
 * -------------------------------------------------------------
 * แต่ละคำค้น = 1 ค่าเรียก API (บิลลิ่ม) → จึงหยุดเร็วเมื่อ:
 *   - ได้ผู้สมัครครบ `maxCandidates` แล้ว
 *   - หรือเจอผู้สมัครที่ตรงขอบเขต (หมู่บ้าน/ตำบล) แล้ว — คำค้นที่เหลือ
 *     แทบไม่มีทางดีกว่า และแต่ละคำค้นคือเงิน
 *
 * คำค้นแรกล้มเหลว = ปัญหาของ Google (คีย์/บิลลิ่ม) → **throw**
 * (PLAN §2.6.2 — "ผิดพลาด" กับ "ค้นไม่เจอ" ต้องไม่กลายเป็นเรื่องเดียวกัน)
 * คำค้นหลังล้มเหลว = ของบางคำค้น → ใช้ผลที่ได้ไปต่อ แล้วรายงานไว้
 */
export async function searchPlaceCandidatesMulti(
  queries: string[],
  opts: {
    /** จำนวนผู้สมัครสูงสุดที่จะเก็บ */
    maxCandidates?: number;
    /** ขอบเขตที่กำลังหา — ใช้ตัดสินว่าจะหยุดค้นเร็วไหม */
    scope?: LocationScope;
    /**
     * ค้น **ทุก** คำค้นให้ครบ ไม่หยุดที่คำแรกที่เจอผู้สมัครตรงขอบเขต
     * -------------------------------------------------------------
     * ใช้ตอนเสียงพูดกับตัวหนังสือบนจออ่านได้คนละชื่อ → ต้องค้นทั้งสอง
     * คำค้น แล้วให้ผู้ใช้เลือกเองว่าอันไหนถูก (ถ้าหยุดที่คำแรก
     * ผู้สมัครของชื่อที่สองจะไม่มีโอกาสโผล่บนจอเลย)
     */
    searchAll?: boolean;
    /** ใช้แทนการยิง Google จริง — มีไว้ให้เทสต์ (ค่าเริ่มต้นคือของจริง) */
    search?: (query: string) => Promise<PlaceCandidate[]>;
  } = {}
): Promise<MultiSearchResult> {
  const maxCandidates = opts.maxCandidates ?? 8;
  const runSearch = opts.search ?? searchPlaceCandidates;
  const list = (queries ?? [])
    .map((q) => (q ?? "").trim())
    .filter(Boolean);

  // โหมด "ค้นทุกคำ" — แบ่งงบผู้สมัครให้แต่ละคำค้นได้ของของตัวเอง
  // (ถ้าให้คำแรกกินงบหมด คำที่สองจะไม่มีผู้สมัครมาให้เลือก)
  const perQueryCap = opts.searchAll
    ? Math.max(3, Math.ceil(maxCandidates / 2))
    : maxCandidates;
  const totalCap = opts.searchAll
    ? perQueryCap * Math.max(1, list.length)
    : maxCandidates;

  const out: PlaceCandidate[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  const used: string[] = [];

  for (const query of list) {
    used.push(query);
    let batch: PlaceCandidate[] = [];
    try {
      batch = await runSearch(query);
    } catch (err: any) {
      errors.push(`${query} — ${errorDetail(err)}`);
      if (used.length === 1 && !out.length) throw err;
      continue;
    }

    let added = 0;
    for (const c of batch) {
      if (added >= perQueryCap) break;
      const key = c.placeId || `${c.name}|${c.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      added++;
      if (out.length >= totalCap) break;
    }
    if (out.length >= totalCap) break;
    // หยุดเร็วได้เฉพาะตอน "ค้นคำเดียวพอ" — ถ้ามีหลายชื่อต้องค้นให้ครบ
    if (!opts.searchAll && opts.scope && hasStrongScopeMatch(out, opts.scope)) break;
  }

  return { candidates: out, queries: used, errors };
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
    )}&fields=name,formatted_address,address_component,geometry,type,formatted_phone_number,opening_hours,rating,user_ratings_total,website,url,business_status,price_level,photos&language=th&key=${config.places.googleKey}`;
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
          photoUrl: photoPathFor(r.photos?.[0]?.photo_reference ?? null, null),
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
 * ผลการค้นผู้สมัครสถานที่
 * -------------------------------------------------------------
 * แยกออกมาเป็นชิ้นเดียว เพราะต้องเรียกได้สองทาง:
 *   · ตามรอบสรุป (เดิม) → ค้นหลังรอบสรุปเสร็จ
 *   · ตามรอบ "หาสถานที่" (ใหม่) → ค้นก่อน/ขนานกับรอบสรุป
 *     เพราะคำค้นมาจากหลักฐานในคลิป ไม่ต้องรอชื่อที่รอบสรุปตั้งชื่อเอง
 */
export interface PlaceSearchOutcome {
  /** ผู้สมัครที่ผ่านการกรองขอบเขตแล้ว (เรียงตามระดับขอบเขต → คะแนน AI) */
  candidates: PlaceCandidate[];
  /** คำค้นที่ลองจริง */
  queries: string[];
  /** คำค้นที่ล้มเหลว (ไม่ทำให้ทั้งหมองล้มเหลว) */
  errors: string[];
  /** จำนวนผู้สมัครดิบก่อนกรองขอบเขต */
  rawCount: number;
}

/**
 * เรียงผู้สมัคร: ระดับขอบเขตก่อน (หมู่บ้าน > ตำบล > อำเภอ) → คะแนน AI
 * -------------------------------------------------------------
 * คะแนน AI เป็นตัวตัดสินรอง เพราะหลังกรองขอบเขตแบบ strict แล้ว
 * ผู้สมัครที่เหลือมักอยู่ระดับเดียวกัน → ให้ AI เทียบกับหลักฐานในคลิปตัดสิน
 * ผู้สมัครที่ยังไม่ได้คะแนน (ไม่มีรอบจัดอันดับ) จะอยู่ท้ายกลุ่มของตัวเอง
 */
export function sortPlaceCandidates(
  candidates: PlaceCandidate[],
  scope?: LocationScope
): PlaceCandidate[] {
  const score = (c: PlaceCandidate) => {
    let s = 0;
    if (scope?.province && (c.province === scope.province || c.address.includes(scope.province))) s += 3;
    if (scope?.district && (c.district === scope.district || c.address.includes(scope.district))) s += 2;
    if (scope?.subdistrict && c.address.includes(scope.subdistrict)) s += 1;
    return s;
  };
  return [...candidates]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const byLevel =
        MATCH_RANK[b.c.matchLevel ?? "district"] - MATCH_RANK[a.c.matchLevel ?? "district"];
      if (byLevel !== 0) return byLevel;
      const sa = a.c.aiScore ?? -1;
      const sb = b.c.aiScore ?? -1;
      if (sb !== sa) return sb - sa;
      const byScore = score(b.c) - score(a.c);
      if (byScore !== 0) return byScore;
      return a.i - b.i;
    })
    .map((o) => o.c);
}

/**
 * คำค้นหลายคำ → รายการคำค้นที่จะยิงจริง (ไม่ซ้ำ / ไม่ว่าง)
 * -------------------------------------------------------------
 * · คำค้นที่มีหลักฐานรองรับมาก่อนเสมอ (แม่นกว่า)
 * · คำค้นสำรองจากชื่อ+พื้นที่ต่อท้าย (เผื่อคำแรกไม่เจอ)
 * · ทุกคำเติม "ประเทศไทย" (แอปใช้ข้อมูลแค่ประเทศไทย)
 */
export function buildPlaceQueries(
  evidenceQueries: string[] | undefined,
  fallbackParts: (string | null | undefined)[] | undefined
): string[] {
  const out: string[] = [];
  for (const q of evidenceQueries ?? []) {
    const query = withThailandSuffix(q);
    if (query && !out.includes(query)) out.push(query);
  }
  const parts = (fallbackParts ?? []).filter(
    (x): x is string => typeof x === "string" && x.trim() !== ""
  );
  if (parts.length) {
    const fallback = `${parts.join(" ")} ประเทศไทย`.trim();
    if (fallback && !out.includes(fallback)) out.push(fallback);
  }
  return out;
}

/**
 * ต้องค้น **ทุก** คำค้นไหม — คือมีชื่อที่อ่านได้มากกว่าหนึ่งค่าไหม
 * -------------------------------------------------------------
 * เสียงพูดกับตัวหนังสือบนจออ่านได้คนละชื่อ → ค้นทั้งสองคำค้น
 * แล้วให้ผู้ใช้ติ๊กเองว่าอันไหนถูก (ถ้าหยุดที่คำแรกที่เจอ
 * ผู้สมัครของชื่อที่สองจะไม่มีโอกาสโผล่บนจอเลย)
 */
export function needsSearchAll(resolution?: PlaceResolution | null): boolean {
  if (!resolution?.found) return false;
  const names = new Set(
    (resolution.readings ?? [])
      .map((r) => (r.placeName ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  return names.size > 1;
}

/**
 * ค้นผู้สมัครสถานที่ → กรองขอบเขต → เรียงลำดับ
 * -------------------------------------------------------------
 * `evidenceQueries` = คำค้นที่มีหลักฐานรองรับ (จากรอบ "หาสถานที่")
 *   → มาก่อนเสมอ เพราะแม่นกว่าคำค้นที่สร้างจากชื่อที่รอบสรุปตั้งชื่อเอง
 * `fallbackParts` = ชื่อ/ชุมชน/พื้นที่ (จากรอบสรุป หรือจากรอบหาสถานที่)
 *   → ใช้เป็นคำค้นสำรอง ถ้าคำค้นหลักฐานไม่เจอ
 *
 * แต่ละคำค้น = 1 ค่าเรียก API → จึงหยุดเร็วเมื่อเจอผู้สมัครที่ตรงขอบเขตแล้ว
 * (ดู `searchPlaceCandidatesMulti`)
 */
export async function searchClipPlaceCandidates(opts: {
  evidenceQueries?: string[];
  fallbackParts?: (string | null | undefined)[];
  scope?: LocationScope;
  maxCandidates?: number;
  /** ค้นทุกคำค้นให้ครบ (ใช้เมื่อมี 2 ชื่อจาก 2 แหล่ง — ผู้ใช้ต้องเลือกเอง) */
  searchAll?: boolean;
  /** ใช้แทนการยิง Google จริง — มีไว้ให้เทสต์ */
  search?: (query: string) => Promise<PlaceCandidate[]>;
}): Promise<PlaceSearchOutcome> {
  const scope = opts.scope;
  const queries = buildPlaceQueries(opts.evidenceQueries, opts.fallbackParts);

  if (!queries.length) {
    return { candidates: [], queries: [], errors: [], rawCount: 0 };
  }

  console.log("[places] searching candidates with queries:", queries.join(" | "));

  const search = await searchPlaceCandidatesMulti(queries, {
    scope,
    maxCandidates: opts.maxCandidates ?? 8,
    searchAll: opts.searchAll,
    search: opts.search,
  });

  // Filter to Thailand-only results.
  const thCandidates = search.candidates.filter(
    (c) => c.address.includes("ไทย") || c.address.toLowerCase().includes("thailand")
  );
  const pool = thCandidates.length > 0 ? thCandidates : search.candidates;

  // กรองด้วยขอบเขต (ชั้นที่ 1-3 ของ PLAN §2.2.2)
  let scoped = filterByScope(pool, scope, true);

  // จังหวัดต้องตรงด้วย — ชื่อตำบลซ้ำกันข้ามจังหวัดได้ (เช่น "บ้านป่า")
  // ถ้าไม่มีผู้สมัครในจังหวัดที่ขอเลย → เก็บของเดิมไว้ (ผู้ใช้ยังต้องติ๊กเอง)
  const wantedProvince = scope?.province?.trim();
  if (wantedProvince) {
    const inProvince = scoped.filter(
      (c) => c.province === wantedProvince || c.address.includes(wantedProvince)
    );
    if (inProvince.length > 0) scoped = inProvince;
  }

  // ติดป้ายระดับที่จับคู่ได้ — เรียงลำดับตามป้ายนี้
  const tagged = scoped.map((c) => ({
    ...c,
    matchLevel: scope ? matchLevelFor(c, scope) : null,
  }));

  return {
    candidates: sortPlaceCandidates(tagged, scope),
    queries: search.queries,
    errors: search.errors,
    rawCount: pool.length,
  };
}

/**
 * After M3 returns a summary, look up candidate places for the clip and hand
 * the LIST back to the app.
 *
 * It does NOT choose a place and it does NOT overwrite the name or location
 * the AI read from the clip — the user ticks the right candidate, and only
 * then does the app spend one Place Details call to fill the form.
 *
 * `scope` (ไม่บังคับ) = ขอบเขตที่กำลังหา — ชุมชน/ตำบล/อำเภอ/จังหวัด
 * ถ้ามี scope → คำค้นจะแคบลง และผลจะถูกกรองเป็น 3 ชั้น + ติดป้าย `matchLevel`
 *
 * `preSearched` = ผลค้นที่ทำไว้ล่วงหน้า (ขนานกับรอบสรุป) → ไม่ต้องค้นซ้ำ
 */
export async function enrichWithGooglePlaces(
  summary: AiSummaryResult,
  diag?: DiagLog,
  scope?: LocationScope,
  preSearched?: PlaceSearchOutcome | null
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

  // ผลจากรอบ "หาสถานที่" (มีหลักฐานรองรับ) — เชื่อถือกว่าที่รอบสรุปอ่านมา
  const resolution = summary.placeResolution;
  const resAdmin = resolution?.found ? resolution.admin : null;

  // Detect province from location or context texts
  const knownProvince =
    place.location?.province ||
    detectProvinceFromText(rawTranscript, rawOnScreen, rawReasoning, summary.text);

  const knownDistrict = place.location?.district || null;
  const knownSubdistrict = place.location?.subdistrict || null;

  // ขอบเขตที่ส่งมาเหนือกว่าข้อมูลในคลิป (เช่น host บอกว่าอยู่ชุมชนไหน)
  // ลำดับ: ขอบเขตจากแอป > พื้นที่ที่มีหลักฐาน (รอบหาสถานที่) > เดาจากรอบสรุป
  const scopedCommunity = scope?.community || null;
  const scopedSubdistrict =
    scope?.subdistrict || resAdmin?.subdistrict || knownSubdistrict || null;
  const scopedDistrict =
    scope?.district || resAdmin?.district || knownDistrict || null;
  const scopedProvince =
    scope?.province || resAdmin?.province || knownProvince || null;

  // ขอบเขตที่ใช้กรองผล — ต้องได้ก่อนค้น เพราะใช้ตัดสินว่าจะหยุดค้นเร็วไหม
  const activeScope: LocationScope | undefined = scope
    ? {
        community: scopedCommunity,
        subdistrict: scopedSubdistrict,
        district: scopedDistrict,
        province: scopedProvince,
      }
    : undefined;

  // ── ค้นผู้สมัคร ───────────────────────────────────────────────────────
  // 1) คำค้นจากรอบ "หาสถานที่" — มีหลักฐานรองรับ เลยแม่นที่สุด
  // 2) คำค้นเดิม (ชื่อที่รอบสรุปอ่านมา + ขอบเขต) — เผื่อคำแรกไม่เจอ
  // ตำบลต้องอยู่ในคำค้นด้วย — เดิมค้นได้แค่ระดับอำเภอ (PLAN §5.2)
  const queryParts = [
    place.place_name,
    (place as any).community,
    scopedCommunity,
    scopedSubdistrict,
    scopedDistrict,
    scopedProvince,
  ].filter((x): x is string => typeof x === "string" && x.trim() !== "");

  // ถ้ามีผลค้นที่ทำไว้ล่วงหน้า (ขนานกับรอบสรุป) → ใช้เลย ไม่ต้องจ่ายซ้ำ
  let outcome: PlaceSearchOutcome | null = preSearched ?? null;

  if (!outcome) {
    try {
      outcome = await searchClipPlaceCandidates({
        evidenceQueries: resolution?.found ? resolution.queries : [],
        fallbackParts: queryParts.length
          ? queryParts
          : scopedProvince
          ? [scopedSubdistrict, scopedDistrict, scopedProvince]
          : [],
        scope: activeScope,
        maxCandidates: 8,
        // ชื่อ 2 ค่า (เสียงกับป้ายบนจอไม่ตรงกัน) → ค้นให้ครบทั้งสองคำ
        searchAll: needsSearchAll(resolution),
      });
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
  }

  // คำค้นบางคำล้มเหลว — บอกไว้ แต่ไม่ทำให้ทั้งหมดล้มเหลว
  for (const e of outcome.errors) {
    diag?.problem(`คำค้น Google บางคำล้มเหลว: ${e}`);
  }

  const ranked = outcome.candidates;

  // Clean up internal fields before returning.
  const { _transcript, _onScreenText, ...cleanSummary } = summary as any;
  void _transcript; void _onScreenText;

  // ชื่อที่มีหลักฐานรองรับ ทับชื่อที่รอบสรุปตั้งชื่อเอง
  // (ชื่อนี้ผ่านการตรวจว่าอยู่ในคลิปจริง → เชื่อถือได้กว่า)
  const confirmedName = resolution?.found ? resolution.placeName : null;
  const placeOut = {
    ...place,
    place_name: confirmedName ?? place.place_name,
  };

  if (ranked.length === 0) {
    if (diag) {
      const noQuery = outcome.queries.length === 0;
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: "failed",
        ms: Date.now() - t0,
        detail: noQuery
          ? "สร้างคำค้นไม่ได้ (ไม่มีชื่อสถานที่/ชุมชน/จังหวัด)"
          : `ค้นแล้วไม่เจอสถานที่ (คำค้น: ${outcome.queries.join(" | ")})`,
      });
      diag.problem(
        noQuery
          ? "สร้างคำค้น Google ไม่ได้ — ไม่มีชื่อสถานที่หรือจังหวัดเลย"
          : `ค้น Google Places แล้วไม่เจอสถานที่ — คำค้น "${outcome.queries.join(" | ")}"`
      );
    }
    // ไม่มีผู้สมัคร แต่ชื่อที่มีหลักฐานยังได้ถูกใช้ (แอปจะเปิด "ค้นใหม่ในชุมชน")
    return { ...cleanSummary, place: placeOut };
  }

  console.log("[places] candidate list:", ranked.length, "— awaiting user pick");

  if (diag) {
    const levels = ranked.reduce<Record<string, number>>((acc, c) => {
      const k = c.matchLevel ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    // ถ้าค้นไว้ล่วงหน้า (ขนานกับรอบสรุป) → ผู้เรียกบันทึกผลไว้แล้ว ไม่ต้องบันทึกซ้ำ
    if (!preSearched) {
      diag.add({
        id: "places",
        label: "ค้นสถานที่ (Google Places)",
        status: "ok",
        ms: Date.now() - t0,
        detail: `เจอ ${ranked.length} จุด — รอผู้ใช้ติ๊ก`,
        // `data` เก็บค่าแบบแบนเท่านั้น → สรุประดับการจับคู่เป็นข้อความเดียว
        data: {
          candidates: ranked.length,
          queries: outcome.queries.length,
          levels: Object.entries(levels)
            .map(([level, count]) => `${level}:${count}`)
            .join(" "),
        },
      });
    }
    if (activeScope && ranked.length === 0 && outcome.rawCount > 0) {
      diag.problem(
        `ค้น Google แล้วได้ ${outcome.rawCount} จุด แต่ไม่มีจุดไหนอยู่ในขอบเขตที่ขอ ` +
          `(ตำบล/อำเภอ) — ต้องเปิดเส้นทาง "ค้นใหม่ในชุมชน"`
      );
    }
    // พื้นที่ที่ใช้กรองต่างจากที่รอบสรุปอ่านมา — บันทึกไว้ให้เห็นว่าใช้อันไหน
    if (resAdmin && knownProvince && resAdmin.province !== knownProvince) {
      diag.problem(
        `พื้นที่จากหลักฐาน (${resAdmin.province}) ต่างจากที่รอบสรุปอ่านมา (${knownProvince}) — ใช้ตัวหนักฐาน`
      );
    }
  }

  return {
    ...cleanSummary,
    place: {
      ...placeOut,
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

  // strict = true  → กรองจริงตามตำบล/อำเภอ และถ้าไม่เหลือก็คืน []
  //                 (เส้นทาง ③ "ค้นใหม่ในชุมชน" — PLAN §5.4)
  // strict = false → พฤติกรรมเดิม (prefer) — default เพื่อไม่ให้ผู้เรียกเดิม
  //                 เช่น ProfileLocal ได้ผลเปลี่ยน
  const strict = body.strict === true;
  const scopeLevel: ScopeLevel = body.scopeLevel === "district" ? "district" : "subdistrict";

  try {
    const rawCandidates = await searchPlaceCandidates(`${parts} ประเทศไทย`);

    const scope: LocationScope = {
      community: body.community ?? null,
      subdistrict: body.subdistrict ?? null,
      district: body.district ?? null,
      province: body.province ?? null,
    };

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

    // กรองตามขอบเขต (ชั้นที่ 1-3) + ติดป้ายระดับที่จับคู่ได้
    const filtered = filterByScope(candidates, scope, strict, scopeLevel);
    const withLevel = filtered.map((c) => ({
      ...c,
      matchLevel: matchLevelFor(c, scope),
    }));

    // เรียง: village → subdistrict → district
    const ordered = [...withLevel].sort(
      (a, b) => MATCH_RANK[b.matchLevel] - MATCH_RANK[a.matchLevel]
    );

    return res.json({ configured: true, candidates: ordered });
  } catch (err: any) {
    const message =
      err?.name === "AbortError"
        ? "หมดเวลาเชื่อมต่อ Google"
        : err?.message || "ค้นหาสถานที่ไม่สำเร็จ";
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
//  6) GET /places/community — the places of one community
// ─────────────────────────────────────────────

/**
 * รายการสถานที่ของชุมชนหนึ่งชุมชน
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §5.7
 *
 * ทำไมต้องมี endpoint นี้
 *   ชุมชนคือ "ขอบเขต" ไม่ใช่แค่ชื่อ (D1) — หน้าโปรไฟล์ชุมชนต้องแสดง
 *   "สถานที่ใกล้ชุมชน" ซึ่งคือทุกแถวใน `community_places` ที่ `community_id`
 *   ชี้มาที่ชุมชนนั้น (ไม่ใช่แค่สถานที่ที่ host คนนี้เป็นเจ้าของ)
 *
 * ชื่อ hierarchy มาจาก `communities` เสมอ (D18) — ไม่อ่านจากแถวใน
 * `community_places` เพราะแถวนั้นถูกคัดลอกมาจากที่อื่นและชื่อตำบล/อำเภอ
 * ในนั้นอาจเป็นรูปแบบเดิม (มี "ต." นำหน้า) หรือไม่ตรงกับทะเบียน
 *
 * Public on purpose: `community_places` กับ `communities` อ่านได้สาธารณะอยู่แล้ว
 */
router.get("/community", async (req: Request, res: Response) => {
  const communityId = (req.query.communityId ?? "").toString().trim();
  if (!communityId) {
    return res.status(400).json({ error: "communityId is required", code: "BAD_REQUEST" });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
      code: "NOT_CONFIGURED",
    });
  }

  // ── ชุมชน ──────────────────────────────────────────────────────
  const { data: community, error: communityErr } = await admin
    .from("communities")
    .select("id, name, region, province, district, subdistrict")
    .eq("id", communityId)
    .maybeSingle();
  if (communityErr) {
    console.error("[places] community read failed:", communityErr.message);
    return res.status(500).json({ error: "อ่านข้อมูลชุมชนไม่สำเร็จ", code: "READ_FAILED" });
  }
  if (!community) {
    return res.status(404).json({ error: "ไม่พบชุมชนนี้", code: "NOT_FOUND" });
  }

  // ── สถานที่ของชุมชน ─────────────────────────────────────────────
  const PLACE_COLUMNS =
    "id, place_id, place_name, formatted_address, latitude, longitude, google_maps_url, " +
    "phone, opening_hours, price_info, price_level, website, business_status, source, " +
    "owner_id, recorded_by, community_match_level, business_hours, business_pricing, " +
    "updated_at, capacity, house_rules, areas, facilities";

  const { data: rows, error: placesErr } = await admin
    .from("community_places")
    .select(PLACE_COLUMNS)
    .eq("community_id", communityId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (placesErr) {
    // `community_id` มาจาก add_place_matching.sql — ถ้ายังไม่ได้รัน
    // → endpoint นี้ยังใช้ไม่ได้เลย (บอกตรง ๆ ดีกว่าคืนรายการว่าง)
    if (missingColumnName(placesErr.message) === "community_id") {
      console.warn("[places] community places: ยังไม่มีคอลัมน์ community_id");
      return res.status(503).json({
        error: "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration add_place_matching.sql",
        code: "MIGRATION_REQUIRED",
      });
    }
    // คอลัมน์อื่นของ migration ที่ยังไม่ได้รัน (facts / price_level)
    // → อ่านเฉพาะคอลัมน์พื้นฐาน แล้วคืนสถานที่ที่มีอยู่เท่าที่อ่านได้
    console.warn("[places] community places read failed, retrying with base columns:", placesErr.message);
    const { data: fallback, error: fallbackErr } = await admin
      .from("community_places")
      .select(
        "id, place_id, place_name, formatted_address, province, district, subdistrict, village, " +
          "latitude, longitude, google_maps_url, phone, opening_hours, price_info, website, " +
          "business_status, source, owner_id, updated_at"
      )
      .eq("community_id", communityId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (fallbackErr) {
      console.error("[places] community places read failed:", fallbackErr.message);
      return res.status(500).json({ error: "อ่านข้อมูลสถานที่ของชุมชนไม่สำเร็จ", code: "READ_FAILED" });
    }
    const shaped = withHierarchy(community, fallback ?? []);
    return res.json({ ...shaped, partial: true });
  }

  const shaped = withHierarchy(community, rows ?? []);
  return res.json({ ...shaped, partial: false });
});

/**
 * เติมชื่อ hierarchy จากชุมชนลงในทุกแถวสถานที่ (D18)
 * + แปลง `recorded_by` / `owner_id` ให้เป็นข้อมูลที่มีชื่อคนให้ดู
 */
function withHierarchy(
  community: any,
  rows: any[]
): { community: any; places: any[] } {
  const places = rows.map((row) => ({
    ...row,
    // hierarchy จากชุมชน — ไม่ใช่จากแถว (D18)
    province: community.province ?? row.province ?? null,
    district: community.district ?? row.district ?? null,
    subdistrict: community.subdistrict ?? row.subdistrict ?? null,
    village: community.name ?? row.village ?? null,
  }));
  return { community, places };
}

// ─────────────────────────────────────────────
//  7) GET /places/district — the places of one district (map pin layer)
// ─────────────────────────────────────────────

/**
 * สถานที่ที่ยืนยันแล้วในอำเภอหนึ่ง ๆ
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §7.2 — ชั้นหมุดระดับสถานที่บนแผนที่
 *
 * "ในอำเภอ" = สองทางรวมกัน
 *   ① สถานที่ที่ผูกกับชุมชนของอำเภอนั้น (community_id)
 *   ② สถานที่ที่แถวของมันระบุอำเภอเอง (ยังไม่ได้ผูกชุมชน)
 *
 * ไม่ใช้ระยะทาง — ชุมชนไม่มีพิกัดที่เชื่อถือได้ (PLAN §7.4)
 */
router.get("/district", async (req: Request, res: Response) => {
  const district = (req.query.district ?? "").toString().trim();
  const province = (req.query.province ?? "").toString().trim();
  if (!district) {
    return res.status(400).json({ error: "district is required", code: "BAD_REQUEST" });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
      code: "NOT_CONFIGURED",
    });
  }

  const PLACE_COLUMNS =
    "id, place_id, place_name, formatted_address, province, district, subdistrict, village, " +
    "latitude, longitude, google_maps_url, phone, opening_hours, price_info, price_level, " +
    "website, rating, user_ratings_total, source, owner_id, community_id, community_match_level, " +
    "business_hours, business_pricing, updated_at";

  /** คอลัมน์พื้นฐาน — ใช้ตอน migration ที่เพิ่มคอลัมน์ใหม่ยังไม่รัน */
  const PLACE_COLUMNS_BASE =
    "id, place_id, place_name, formatted_address, province, district, subdistrict, village, " +
    "latitude, longitude, google_maps_url, phone, opening_hours, price_info, website, " +
    "rating, user_ratings_total, source, owner_id, updated_at";

  const readPlaces = async (apply: (q: any) => any): Promise<any[]> => {
    const wide = (await apply(admin.from("community_places").select(PLACE_COLUMNS))).data;
    if (wide) return wide;
    const base = (await apply(admin.from("community_places").select(PLACE_COLUMNS_BASE))).data;
    return base ?? [];
  };

  // ① ชุมชนในอำเภอนี้ → id ของชุมชน
  let communityQuery = admin
    .from("communities")
    .select("id, name, region, province, district, subdistrict")
    .eq("district", district);
  if (province) communityQuery = communityQuery.eq("province", province);
  const { data: communities, error: communitiesErr } = await communityQuery.limit(200);
  if (communitiesErr) {
    console.error("[places] district communities read failed:", communitiesErr.message);
    return res.status(500).json({ error: "อ่านข้อมูลชุมชนไม่สำเร็จ", code: "READ_FAILED" });
  }

  const communityIds = (communities ?? []).map((c: any) => c.id as string);
  const byCommunity = communityIds.length
    ? await readPlaces((q) =>
        q
          .in("community_id", communityIds)
          .order("updated_at", { ascending: false })
          .limit(200)
      )
    : [];

  // ② แถวที่ยังไม่ได้ผูกชุมชน แต่ระบุอำเภอเอง
  const byDistrict = await readPlaces((q) =>
    q.eq("district", district).order("updated_at", { ascending: false }).limit(200)
  );

  const nameByCommunity = new Map<string, string>(
    (communities ?? []).map((c: any) => [c.id as string, (c.name ?? "") as string])
  );
  const merged = [...byCommunity, ...byDistrict];
  const seen = new Set<string>();
  const places = merged
    .map((row: any) => ({
      ...row,
      community_name: row.community_id ? nameByCommunity.get(row.community_id) ?? null : null,
    }))
    .filter((row: any) => {
      const key = String(row.place_id ?? row.id ?? "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return res.json({ places, partial: false });
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
 * อ่านแถวของสถานที่โดยไม่พังเมื่อ migration ยังไม่ได้รัน
 * -------------------------------------------------------------------------
 * `community_places` โตทีละคอลัมน์ในหลาย migration:
 *   • `price_level`                              — add_community_places_price_level.sql
 *   • `capacity`/`house_rules`/`areas`/`facilities` — add_community_places_place_facts.sql
 *   • `community_id`/`recorded_by`                — add_place_matching.sql (ขั้น 1.1, ยังไม่รัน)
 *
 * ถ้า select คอลัมน์ที่ยังไม่มี → error ทั้ง statement → ถอยไปอ่านชุดที่แคบกว่า
 * แล้วคืน "คอลัมน์ที่ยืนยันว่ามีจริง" ไปด้วย เพื่อให้ผู้เรียกรู้ว่าอะไรเขียนได้
 */
const PLACE_ROW_SELECTS = [
  // ชุดที่มีคอลัมน์ของขั้น 1.1 ครบ (มีเมื่อรัน add_place_matching.sql แล้ว)
  "id, owner_id, community_id, community_match_level, phone, opening_hours, price_level, website, capacity, house_rules, areas, facilities",
  "id, owner_id, community_id, phone, opening_hours, price_level, website, capacity, house_rules, areas, facilities",
  "id, owner_id, community_id, phone, opening_hours, price_level, website",
  "id, owner_id, community_id, phone, opening_hours, website",
  "id, owner_id, community_id",
  "id, owner_id",
];

interface PlaceRowRead {
  row: Record<string, any> | null;
  /** คอลัมน์ที่ยืนยันว่ามีอยู่จริงในตารางตอนนี้ */
  columns: Set<string>;
  error: string | null;
}

async function readPlaceRow(
  admin: SupabaseClient,
  placeId: string
): Promise<PlaceRowRead> {
  let lastError: string | null = null;
  for (const columns of PLACE_ROW_SELECTS) {
    const { data, error } = await admin
      .from("community_places")
      .select(columns)
      .eq("place_id", placeId)
      .maybeSingle();
    if (!error) {
      return {
        row: (data as Record<string, any> | null) ?? null,
        columns: new Set(columns.split(",").map((c) => c.trim())),
        error: null,
      };
    }
    // คอลัมน์ยังไม่มี → ถอยไปชุดที่แคบกว่า / อย่างอื่น = พังจริง
    if (!isMissingColumnError(error.message)) {
      return { row: null, columns: new Set(), error: error.message };
    }
    lastError = error.message;
  }
  return { row: null, columns: new Set(), error: lastError };
}

/**
 * ชื่อคอลัมน์ที่ Postgres บอกว่าไม่มี
 * -------------------------------------------------------------------------
 *   update/select → `column community_places.community_id does not exist`
 *   insert        → `column "community_id" of relation "community_places" does not exist`
 */
function missingColumnName(message: string): string | null {
  const msg = message ?? "";
  const ofRelation = msg.match(/column\s+"?([a-z_][a-z0-9_]*)"?\s+of relation/i);
  if (ofRelation) return ofRelation[1];
  const qualified = msg.match(
    /column\s+"?[a-z_][a-z0-9_]*"?\."?([a-z_][a-z0-9_]*)"?\s+does not exist/i
  );
  if (qualified) return qualified[1];
  const bare = msg.match(/column\s+"?([a-z_][a-z0-9_]*)"?\s+does not exist/i);
  return bare ? bare[1] : null;
}

/**
 * เขียนแถว โดยถอยออกมาเมื่อคอลัมน์ยังไม่มี
 * -------------------------------------------------------------------------
 * คอลัมน์ที่ยังไม่มีในตาราง → ตัดทิ้งแล้วลองใหม่ (ไม่งั้น host ที่เพิ่งแก้ราคา
 * ได้ จะเสียทั้งราคาเพราะคอลัมน์ `facilities` ยังไม่ถูก migration เพิ่ม)
 */
async function writePlaceRow(
  admin: SupabaseClient,
  mode: "insert" | "update",
  row: Record<string, unknown>,
  placeId: string
): Promise<{ error: string | null; skipped: string[] }> {
  const skipped: string[] = [];
  const current: Record<string, unknown> = { ...row };
  // จำกัดจำนวนครั้งเท่าจำนวนคอลัมน์ที่อาจหายได้
  for (let attempt = 0; attempt < 8; attempt++) {
    const query =
      mode === "insert"
        ? admin.from("community_places").insert(current)
        : admin.from("community_places").update(current).eq("place_id", placeId);
    const { error } = await query;
    if (!error) return { error: null, skipped };
    const missing = missingColumnName(error.message);
    if (!missing || !(missing in current)) return { error: error.message, skipped };
    delete current[missing];
    skipped.push(missing);
  }
  return { error: "บันทึกข้อมูลสถานที่ไม่สำเร็จ", skipped };
}

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
 *
 * สิทธิ์ (PLAN_PLACE_MATCHING.md §5.6 — D6/D26):
 *   host   → แก้ได้ทุกช่อง (ราคา/เวลาเปิด/โทร/เว็บ + ข้อมูลจากคลิป)
 *   tourist→ เขียนแถวใหม่ได้ แต่แก้ "ข้อมูลเจ้าของร้าน" ไม่ได้
 *            (phone/opening_hours/price_level/website) และเติมข้อมูลจากคลิป
 *            ได้เฉพาะช่องที่ยังว่าง
 *
 * ⚠️ backend ใช้ service role → RLS ถูกข้าม → การบล็อกต้องทำที่ backend
 *    (policy ฝั่ง RLS แก้ไว้ให้ตรงกันแล้วใน supabase/policies.sql)
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

  // ---- what role does the caller have? ------------------------------------
  // `users.community_id` มาจาก add_place_matching.sql — ถ้ายังไม่ได้รัน
  // → ถอยไปอ่านแค่ role (และถือว่าผู้เรียกยังไม่มีชุมชน)
  let role = "";
  let callerCommunityId: string | null = null;
  {
    const full = await admin
      .from("users")
      .select("role, community_id")
      .eq("id", uid)
      .maybeSingle();
    if (!full.error) {
      role = full.data?.role ?? "";
      callerCommunityId = full.data?.community_id ?? null;
    } else if (isMissingColumnError(full.error.message)) {
      const basic = await admin.from("users").select("role").eq("id", uid).maybeSingle();
      if (basic.error) {
        console.error("[places] save-place-details role read failed:", basic.error.message);
        return res.status(500).json({ error: "ตรวจสอบสิทธิ์ไม่สำเร็จ", code: "READ_FAILED" });
      }
      role = basic.data?.role ?? "";
    } else {
      console.error("[places] save-place-details role read failed:", full.error.message);
      return res.status(500).json({ error: "ตรวจสอบสิทธิ์ไม่สำเร็จ", code: "READ_FAILED" });
    }
  }
  const isHost = role === "host";
  const isTourist = role === "tourist";
  if (!isHost && !isTourist) {
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

  // ชุมชนของสถานที่ — host ใช้ชุมชนของตัวเอง (ถ้าไม่บอกมา) / tourist ต้องระบุ
  const requestedCommunityId: string = (body.communityId ?? "").toString().trim();
  const communityId = requestedCommunityId || (isHost ? callerCommunityId ?? "" : "");
  if (communityId) {
    const { data: community } = await admin
      .from("communities")
      .select("id")
      .eq("id", communityId)
      .maybeSingle();
    if (!community) {
      return res.status(400).json({
        error: "ไม่พบชุมชนที่เลือก — กรุณาเลือกชุมชนอีกครั้ง",
        code: "BAD_REQUEST",
      });
    }
  }

  // ระดับที่จับคู่ชุมชนได้ (D28) — ผู้ใช้ที่เลือกสถานที่เอง = "manual"
  // (ค่าที่เชื่อถือที่สุด) · ค่าอื่นมาจากการกรอง 3 ชั้นของแอป
  const MATCH_LEVEL_VALUES = new Set(["village", "subdistrict", "district", "manual"]);
  const requestedMatchLevel: string = (body.communityMatchLevel ?? "").toString().trim();
  const matchLevel = MATCH_LEVEL_VALUES.has(requestedMatchLevel) ? requestedMatchLevel : "";

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

  // Tourist แตะ "ข้อมูลเจ้าของร้าน" ไม่ได้ (D6) → ตัดออกก่อนเขียน
  if (!isHost) {
    for (const column of Object.values(DETAIL_FIELDS)) delete patch[column];
  }

  const fullPatch = { ...patch, ...factPatch };
  if (Object.keys(fullPatch).length === 0 && !communityId) {
    return res.status(400).json({ error: "ไม่มีข้อมูลให้บันทึก", code: "BAD_REQUEST" });
  }

  try {
    // The row may already exist — owned by whoever registered the place.
    // อ่านแบบถอยหลัง: ถ้าคอลัมน์ยังไม่มี (migration ยังไม่รัน) → อ่านชุดที่แคบกว่า
    const { row: existing, columns: available, error: readErr } = await readPlaceRow(
      admin,
      placeId
    );
    if (readErr) {
      console.error("[places] save-place-details read failed:", readErr);
      return res.status(500).json({ error: "อ่านข้อมูลสถานที่ไม่สำเร็จ", code: "READ_FAILED" });
    }

    if (existing) {
      // Tourist เติมได้เฉพาะช่องที่ยังว่าง (D26) — ช่องที่มีค่าอยู่แล้วห้ามแตะ
      let effectivePatch = fullPatch;
      if (!isHost) {
        effectivePatch = {};
        for (const [column, value] of Object.entries(factPatch)) {
          // อ่านไม่ได้ (คอลัมน์ยังไม่มี) → ไม่มีค่าเดิมให้ต้องรักษา → เขียนได้
          if (!available.has(column)) {
            effectivePatch[column] = value;
            continue;
          }
          const current = (existing as any)[column];
          const isEmpty =
            current === null ||
            current === undefined ||
            (Array.isArray(current) && current.length === 0) ||
            (typeof current === "object" && !Array.isArray(current) && Object.keys(current).length === 0);
          if (isEmpty) effectivePatch[column] = value;
        }
        // ชุมชนที่ยังไม่มี → เติมได้ (แต่ห้ามย้ายชุมชนของแถวที่มีอยู่แล้ว)
        if (communityId && available.has("community_id") && !existing.community_id) {
          effectivePatch.community_id = communityId;
        }
        // ระดับการจับคู่ชุมชน — ผู้ใช้ระบุเองได้ ("manual" เชื่อถือที่สุด)
        if (
          matchLevel &&
          available.has("community_match_level") &&
          (existing as any).community_match_level !== matchLevel
        ) {
          effectivePatch.community_match_level = matchLevel;
        }
        if (Object.keys(effectivePatch).length === 0) {
          return res.status(400).json({
            error: "ข้อมูลช่องนี้มีอยู่แล้ว — แก้ไขได้เฉพาะช่องที่ยังว่าง",
            code: "BAD_REQUEST",
          });
        }
      } else {
        effectivePatch = { ...fullPatch };
        if (
          matchLevel &&
          available.has("community_match_level") &&
          (existing as any).community_match_level !== matchLevel
        ) {
          effectivePatch.community_match_level = matchLevel;
        }
        if (communityId && available.has("community_id") && !existing.community_id) {
          effectivePatch.community_id = communityId;
        }
      }

      // ไม่มีอะไรให้แก้ → ไม่ต้องยิง statement เปล่า (PostgREST ตอบ error)
      if (Object.keys(effectivePatch).length === 0) {
        return res.json({ ok: true, ownerId: existing.owner_id ?? null });
      }

      // Keep the place's existing owner — the price belongs to the place.
      const { error: updErr, skipped } = await writePlaceRow(
        admin,
        "update",
        effectivePatch,
        placeId
      );
      if (updErr) {
        console.error("[places] save-place-details update failed:", updErr);
        return res.status(400).json({
          error: humanizeDetailsError(updErr),
          code: "WRITE_FAILED",
        });
      }
      return res.json({
        ok: true,
        ownerId: existing.owner_id ?? null,
        ...(skipped.length ? { factsSkipped: true, skippedColumns: skipped } : {}),
      });
    }

    // A place we have never stored.
    // • host   → host คนนี้เป็นเจ้าของ (ราคาเป็นของเขา)
    // • tourist→ ไม่มีเจ้าของ (owner_id = NULL) แต่มีคนบันทึก (recorded_by)
    //   และต้องรู้ชุมชน — ชุมชนไม่มี = บันทึกไม่ได้ (D11)
    if (!isHost && !communityId) {
      return res.status(400).json({
        error: "ยังไม่ทราบว่าสถานที่นี้อยู่ชุมชนไหน — กรุณาเลือกชุมชนก่อนบันทึก",
        code: "BAD_REQUEST",
      });
    }
    // tourist ต้องผูกชุมชน — ถ้าคอลัมน์ยังไม่มีในตาราง ทำไม่ได้ (migration ยังไม่รัน)
    if (!isHost && !available.has("community_id")) {
      return res.status(503).json({
        error: "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration add_place_matching.sql",
        code: "MIGRATION_REQUIRED",
      });
    }

    const baseRow: Record<string, unknown> = {
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
      owner_id: isHost ? uid : null,
      source: "google_places",
    };
    // คอลัมน์ของขั้น 1.1 — เขียนก็ต่อเมื่อคอลัมน์มีอยู่จริง
    if (available.has("recorded_by")) baseRow.recorded_by = uid;
    if (available.has("community_id")) baseRow.community_id = communityId || null;
    if (matchLevel && available.has("community_match_level")) {
      baseRow.community_match_level = matchLevel;
    }

    const { error: insErr, skipped } = await writePlaceRow(
      admin,
      "insert",
      { ...baseRow, ...fullPatch },
      placeId
    );
    if (insErr) {
      console.error("[places] save-place-details insert failed:", insErr);
      return res.status(400).json({
        error: humanizeDetailsError(insErr),
        code: "WRITE_FAILED",
      });
    }
    return res.json({
      ok: true,
      ownerId: isHost ? uid : null,
      ...(skipped.length ? { factsSkipped: true, skippedColumns: skipped } : {}),
    });
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
  // คอลัมน์ของขั้น 1.1 (add_place_matching.sql) — ยังไม่ได้รัน
  if (
    (m.includes("community_id") ||
      m.includes("recorded_by") ||
      m.includes("community_match_level")) &&
    m.includes("does not exist")
  ) {
    return "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration add_place_matching.sql";
  }
  // FK ของชุมชน — ชุมชนที่ส่งมาไม่มีอยู่จริง
  if (m.includes("community_places_community_id_fkey")) {
    return "ไม่พบชุมชนที่เลือก — กรุณาเลือกชุมชนอีกครั้ง";
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

/**
 * GET /places/photo?ref=… | ?name=…&w=400
 *
 * ยิงรูปสถานที่จาก Google แล้วส่งไบต์กลับให้แอป
 *
 * ทำไมต้องมี route นี้: รูปของ Google ต้องใช้ API key ซึ่งเป็น server-only
 * (ถ้าให้แอปยิงเอง key จะหลุดออกไปกับไบนารีของแอป) → backend ต้องเป็นคนยิง
 * แล้วส่งรูปกลับเป็นไบต์ แอปเอา URL ของ route นี้ไปใช้ได้เลย
 *
 * - `ref`  = photo_reference ของ Places Legacy
 * - `name` = photo name ของ Places (New) เช่น "places/ID/photos/PHOTO"
 * - `w`    = ความกว้างที่ขอ (80–1200)
 */
router.get("/photo", async (req: Request, res: Response) => {
  const ref = String(req.query.ref ?? "").trim();
  const name = String(req.query.name ?? "").trim();
  const rawWidth = Number.parseInt(String(req.query.w ?? "400"), 10);
  const width = Number.isFinite(rawWidth) ? Math.min(Math.max(rawWidth, 80), 1200) : 400;

  if (!isPlacesConfigured()) {
    return res.status(503).json({ error: "Google Places ยังไม่ได้ตั้งค่า" });
  }

  // ตรวจรูปแบบก่อน — ค่านี้จะไปอยู่ใน query string ของ Google
  // (host ของปลายทางถูกกำหนดไว้แล้ว และค่าถูก encodeURIComponent ก่อนใช้
  //  → ผู้เรียกใช้ route นี้เป็นพร็อกซียิงที่อื่นไม่ได้)
  const refOk = ref.length > 0 && ref.length <= 500 && /^[A-Za-z0-9_=.-]+$/.test(ref);
  const nameOk = name.length > 0 && name.length <= 300 && /^[A-Za-z0-9_/-]+$/.test(name);

  let upstreamUrl: string;
  if (refOk) {
    upstreamUrl =
      `https://maps.googleapis.com/maps/api/place/photo` +
      `?maxwidth=${width}&photoreference=${encodeURIComponent(ref)}&key=${config.places.googleKey}`;
  } else if (nameOk) {
    upstreamUrl =
      `https://places.googleapis.com/v1/${encodeURIComponent(name)}/media` +
      `?maxWidthPx=${width}&key=${config.places.googleKey}`;
  } else {
    return res.status(400).json({ error: "ต้องระบุ ref หรือ name ที่ถูกต้อง" });
  }

  try {
    // Google ตอบ 302 ไป CDN — fetch ตาม redirect ให้เอง
    const upstream = await fetch(upstreamUrl, { redirect: "follow" });
    if (!upstream.ok) {
      return res.status(404).json({ error: "ไม่พบรูปภาพของสถานที่นี้" });
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=604800");
    return res.send(bytes);
  } catch (err: any) {
    console.warn("[places] photo error:", err?.message);
    return res.status(502).json({ error: "ดึงรูปจาก Google ไม่สำเร็จ" });
  }
});

// ─────────────────────────────────────────────
//  8) POST /places/resolve-coords — ลิงก์/ชื่อสถานที่ → พิกัด
// ─────────────────────────────────────────────

/**
 * แปลง "ลิงก์ Google Maps" หรือ "ชื่อ/ที่อยู่" ให้เป็นพิกัด
 * -------------------------------------------------------------
 * ทำไมต้องมี
 *   ลิงก์ที่ผู้ใช้วางมีหลายรูปแบบ และหลายรูปแบบไม่มีพิกัดอยู่ในตัวข้อความ
 *     · ลิงก์สั้น `https://maps.app.goo.gl/XXXX`   → ต้องกาง redirect
 *     · ลิงก์ชื่อ `.../maps/place/ชื่อสถานที่/...` → มีแต่ชื่อ
 *     · `?q=ชื่อสถานที่`                            → มีแต่ชื่อ
 *   ถ้าปล่อยไว้ → จุดที่ผู้ใช้บันทึกไว้จะไม่มีพิกัด → แผนทริปบอกว่า "หาพิกัดไม่ได้"
 *
 * ทำไมต้องอยู่ฝั่งเซิร์ฟเวอร์
 *   · React Native ตาม redirect ให้แล้วแต่ไม่เห็น URL ปลายทาง
 *     (`response.url` ว่างเปล่า) → ฝั่งแอปกางลิงก์สั้นไม่ได้
 *   · คีย์ของ Google เป็น server-only → ค้นชื่อสถานที่ต้องยิงจากที่นี่
 *
 * ขั้นตอน
 *   1) พิกัดในตัวลิงก์เอง (เร็ว + แม่นที่สุด)
 *   2) ลิงก์สั้น → กาง redirect ที่นี่ → อ่านพิกัดจาก URL ที่กางแล้ว
 *   3) ชื่อสถานที่ → Google Places (TextSearch)
 */

/**
 * ย่อข้อความให้เทียบกันได้ (เหมือน `foldPlaceName` ใน googleMaps.ts)
 * ─ ตัดช่องว่าง/เครื่องหมายทิ้ง ("บ้าน สวน ริมน้ำ" = "บ้านสวนริมน้ำ")
 */
function foldText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** คำในคำค้นที่ใช้เทียบได้ (ยาวพอสมควร) */
function queryTokens(query: string): string[] {
  return String(query ?? "")
    .split(/[\s,]+/)
    .map((t) => foldText(t))
    .filter((t) => t.length >= 2);
}

/**
 * จังหวัดที่คำค้นพูดถึง (ถ้ามี)
 * ─ รองรับชื่อที่คนเขียนสั้น ๆ เช่น "กรุงเทพ" → "กรุงเทพมหานคร"
 */
function provinceInQuery(query: string): string | null {
  const q = foldText(query);
  if (!q) return null;
  if (q.includes("กรุงเทพ") || q.includes("บางกอก")) return "กรุงเทพมหานคร";
  return detectProvinceFromText(query);
}

/**
 * ทำให้ชื่อจังหวัดอยู่ในรูปเดียวกัน
 * ─ Google เขียน "กรุงเทพมหานคร" แต่คนพิมพ์ "กรุงเทพ" → ต้องเท่ากัน
 */
function normalizeProvinceName(value: string | null | undefined): string {
  const v = foldText(value);
  if (!v) return "";
  if (v.startsWith("กรุงเทพ")) return "กรุงเทพมหานคร";
  return v;
}

/**
 * ผลลัพธ์นี้อยู่ในจังหวัดที่ถามไหม
 * ─ เทียบกับ "จังหวัดที่ Google ระบุในที่อยู่" เป็นหลัก
 *   (ชื่อสถานที่ห้ามใช้ตัดสินจังหวัด — "โรงแรมเชียงใหม่" อาจอยู่ที่ไหนก็ได้)
 */
function candidateInProvince(c: PlaceCandidate, province: string): boolean {
  const wanted = normalizeProvinceName(province);
  if (wanted.length < 4) return false;
  // จังหวัดที่ Google ระบุมาเอง → เชื่อได้ที่สุด
  const own = normalizeProvinceName(c.province);
  if (own) return own === wanted;
  // ไม่ระบุจังหวัด → ดูในที่อยู่
  const haystack = foldText(
    [c.address, c.district, c.subdistrict].filter(Boolean).join(" ")
  );
  if (haystack.includes(wanted)) return true;
  // "กรุงเทพ" ในที่อยู่ = "กรุงเทพมหานคร"
  if (wanted === "กรุงเทพมหานคร" && haystack.includes("กรุงเทพ")) return true;
  return false;
}

/**
 * คำค้นสำหรับ "ค้นเจาะจงจังหวัด"
 * ─ ตัดชื่อจังหวัดเดิมออก (ถ้ามี) แล้วเติม "จังหวัด…" ให้ชัด
 *   "วัดพระแก้ว เชียงใหม่" → "วัดพระแก้ว จังหวัดเชียงใหม่"
 */
function scopedQueryForProvince(query: string, province: string): string {
  const q = String(query ?? "").trim();
  const wanted = normalizeProvinceName(province);
  const alias = wanted === "กรุงเทพมหานคร" ? "กรุงเทพ" : wanted;
  const tokens = q
    .split(/[\s,]+/)
    .filter((t) => t.trim() && foldText(t) !== alias);
  return `${tokens.join(" ")} จังหวัด${province}`.trim();
}

/**
 * สัดส่วนคำในคำค้นที่ "มีอยู่" ในผลลัพธ์ (ชื่อ + ที่อยู่ + จังหวัด/อำเภอ/ตำบล)
 * ─ ช่วยแยก "วัดพระแก้ว เชียงใหม่" วัดในเชียงใหม่ ออกจากวัดพระแก้วในอีกจังหวัด
 */
function candidateCoverage(query: string, c: PlaceCandidate): number {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const haystack = foldText(
    [c.name, c.address, c.province, c.district, c.subdistrict]
      .filter(Boolean)
      .join(" ")
  );
  let hit = 0;
  for (const t of tokens) if (haystack.includes(t)) hit++;
  return hit / tokens.length;
}

/**
 * เลือกผลที่ "ตรงกับที่ถาม" ที่สุด
 * ─ ไม่ใช่แค่เอาผลแรก (Google เรียงลำดับตามความเกี่ยวข้องของมันเอง)
 *
 * export ไว้เพื่อให้เทสต์เขียนผลลัพธ์ปลอมมาเช็คได้ โดยไม่ต้องยิง Google จริง
 */
export function pickCoordCandidate(
  candidates: PlaceCandidate[],
  query: string
): PlaceCandidate | null {
  const withCoords = (candidates ?? []).filter(
    (c) => c.latitude != null && c.longitude != null
  );
  if (!withCoords.length) return null;

  const province = provinceInQuery(query);

  // คำค้นระบุจังหวัด → ตัวที่อยู่คนละจังหวัด "ผิดแน่" (เช่น "วัดพระแก้ว" มีทั้งเชียงใหม่และเชียงราย)
  // → ตัดทิ้ง ไม่ตอบพิกัดผิด (พาไปผิดจังหวัดแย่กว่าบอกว่าไม่เจอ)
  let pool = withCoords;
  if (province) {
    const inProvince = withCoords.filter((c) => candidateInProvince(c, province));
    if (inProvince.length) {
      pool = inProvince;
    } else {
      // ทุกตัวระบุจังหวัดชัดเจนว่าคนละจังหวัด → ไม่ตอบเลย
      const allKnown = withCoords.every((c) => !!foldText(c.province));
      if (allKnown) return null;
      // บางตัวระบุจังหวัดไม่ได้ (ที่อยู่ไม่ครบ) → ให้ตัวเหล่านั้นเป็นตัวเลือก
      pool = withCoords.filter((c) => !foldText(c.province));
    }
  }

  let best: PlaceCandidate | null = null;
  let bestCoverage = -1;
  let bestNameMatch = -1;

  for (const c of pool) {
    const tokenCoverage = candidateCoverage(query, c);
    // ตรงจังหวัดที่ถาม = หลักฐานแรงที่สุด (ชื่อเดียวกันมีได้หลายจังหวัด)
    const coverage =
      province && candidateInProvince(c, province) ? 1 : tokenCoverage;
    const nameMatch = placeNameLooksRight(query, String(c.name ?? "")) ? 1 : 0;
    // เรียง: หลักฐานเรื่องที่อยู่มากกว่า → ชื่อตรง → ผลแรก
    const better =
      coverage > bestCoverage ||
      (coverage === bestCoverage && nameMatch > bestNameMatch);
    if (better) {
      best = c;
      bestCoverage = coverage;
      bestNameMatch = nameMatch;
    }
  }

  if (!best) return null;
  // ไม่มีอะไรตรงกับคำค้นเลย → ไม่ตอบพิกัดมั่ว (ดีกว่าพาไปผิดที่)
  if (bestNameMatch === 0 && bestCoverage <= 0) return null;
  return best;
}

/** รูปแบบฟังก์ชันค้นหาที่ `resolveCoordsBySearch` ใช้ (แทนไว้เพื่อเทสต์ได้) */
export type PlaceSearchFn = (
  query: string,
  opts?: { maxResults?: number }
) => Promise<PlaceCandidate[]>;

/**
 * หาพิกัดจาก "ชื่อสถานที่" โดยเลือกผลให้ตรงกับที่ถาม
 * -------------------------------------------------------------
 * แยกออกมาเป็นฟังก์ชันเพื่อให้เทสต์เขียนผลลัพธ์ปลอมมาเช็คได้
 * (โดยไม่ต้องยิง Google จริง)
 *
 * 3 ขั้น
 *   1) ค้นด้วยคำที่ถาม (เก็บผลลัพธ์ถึง 20 รายการ ไม่ใช่แค่ 5
 *      เพราะชื่อสถานที่ซ้ำข้ามจังหวัด และของจริงอาจอยู่อันดับที่ 6-20)
 *   2) ถ้าคำค้นมีชื่อจังหวัด แต่ที่ได้ไม่อยู่ในจังหวัดนั้น
 *      → ค้นใหม่แบบเจาะจงจังหวัด ("วัดพระแก้ว เชียงใหม่" → "วัดพระแก้ว จังหวัดเชียงใหม่")
 *   3) ถ้ายังไม่มีตัวที่อยู่ในจังหวัดนั้น → ไม่ตอบพิกัดเลย
 *      (พาไปผิดจังหวัดแย่กว่าบอกว่าไม่เจอ — ผิดจังหวัดแล้วเส้นทาง/ค่าน้ำมันผิดทั้งแผน)
 */
export async function resolveCoordsBySearch(
  query: string,
  search: PlaceSearchFn,
  opts?: { isFromLink?: boolean }
): Promise<PlaceCandidate | null> {
  const SEARCH_LIMIT = 20;

  let candidates = await search(query, { maxResults: SEARCH_LIMIT });
  // คำที่ผู้ใช้พิมพ์เอง → ถ้าไม่เจอ ลองเติม "ประเทศไทย" อีกครั้ง
  // (ชื่อจากลิงก์ไม่ต้องเติม — ลิงก์นั้นระบุประเทศมาแล้ว)
  if (!candidates.length && !opts?.isFromLink) {
    candidates = await search(`${query} ประเทศไทย`, {
      maxResults: SEARCH_LIMIT,
    });
  }

  let picked = pickCoordCandidate(candidates, query);

  // คำค้นมีชื่อจังหวัด แต่ผลที่ได้ไม่ได้อยู่ในจังหวัดนั้น (หรือไม่มีผลเลย)
  // (ชื่อสถานที่ซ้ำกันข้ามจังหวัด — เช่น "วัดพระแก้ว") → ค้นใหม่แบบเจาะจงจังหวัด
  const province = provinceInQuery(query);
  if (province && (!picked || !candidateInProvince(picked, province))) {
    const scoped = await search(scopedQueryForProvince(query, province), {
      maxResults: SEARCH_LIMIT,
    });
    // รวมผลเดิมด้วย — ถ้ามีตัวที่อยู่ในจังหวัดถูกต้องอยู่แล้ว ไม่ต้องเสียงบูรณะ
    const scopedPick = pickCoordCandidate([...candidates, ...scoped], query);
    if (scopedPick && candidateInProvince(scopedPick, province)) {
      picked = scopedPick;
    }
  }

  if (!picked || picked.latitude == null || picked.longitude == null) return null;
  return picked;
}

router.post("/resolve-coords", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const url = String(body.url ?? "").trim();
  const text = String(body.text ?? "").trim();

  if (!url && !text) {
    return res.status(400).json({
      ok: false,
      reason: "empty_input",
      error: "ต้องระบุ url หรือชื่อสถานที่",
    });
  }

  // 1) พิกัดที่อยู่ในตัวลิงก์เอง
  const direct = parseMapsUrlCoords(url);
  if (direct) {
    return res.json({
      ok: true,
      lat: direct.lat,
      lng: direct.lng,
      label: direct.name ?? "",
      source: "url",
    });
  }

  // 2) ลิงก์สั้น → กางที่ฝั่งเซิร์ฟเวอร์
  let name = mapsUrlPlaceName(url);
  if (url && isShortMapsLink(url)) {
    const expanded = await expandMapsUrl(url);
    if (expanded) {
      const parsed = parseMapsUrlCoords(expanded);
      if (parsed) {
        return res.json({
          ok: true,
          lat: parsed.lat,
          lng: parsed.lng,
          label: parsed.name ?? "",
          source: "redirect",
        });
      }
      name = mapsUrlPlaceName(expanded) ?? name;
    }
  }

  // 3) ชื่อสถานที่ → Google Places
  const query = (name ?? text).trim();
  if (!query) {
    return res.json({ ok: false, reason: "no_place_name" });
  }
  if (!isPlacesConfigured()) {
    return res.status(503).json({
      ok: false,
      reason: "places_not_configured",
      error: "Google Places ยังไม่ได้ตั้งค่า",
    });
  }

  try {
    const picked = await resolveCoordsBySearch(query, searchPlaceCandidates, {
      isFromLink: !!name,
    });

    if (picked) {
      return res.json({
        ok: true,
        lat: picked.latitude,
        lng: picked.longitude,
        label: picked.name ?? query,
        source: "places",
      });
    }
  } catch (err: any) {
    console.warn("[places] resolve-coords search failed:", err?.message);
    return res.status(502).json({
      ok: false,
      reason: "search_failed",
      error: err?.message ?? "ค้นหาสถานที่ไม่สำเร็จ",
    });
  }

  return res.json({ ok: false, reason: "not_found" });
});

export default router;
