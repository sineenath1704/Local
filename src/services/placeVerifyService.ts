import { ALL_PLACES, PlaceItem } from "../data/thailandGeographicData";
import {
  isValidProvince,
  districtInProvince,
  canonicalProvince,
  canonicalDistrict,
  provincesForDistrict,
  normalizeThaiName,
} from "../data/thaiAdmin";

/**
 * Place verification (OFFLINE, no API / no tokens).
 * -------------------------------------------------------------
 * Takes the location fields the AI summary extracted and checks them against
 * the local Thai admin index (province↔district) and the OTOP community list.
 * Returns a status the UI uses to either confirm, offer choices, or ask the
 * user to search/enter manually. Google Places (phase 4) is only called when
 * this can't confirm a specific place.
 */

export interface AiLocationInput {
  /** Specific place name seen in the clip (ร้าน/จุด/โฮมสเตย์). */
  placeName?: string | null;
  /** Community / village (ชุมชน/หมู่บ้าน). */
  community?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
}

export interface VerifiedLocation {
  placeName: string | null;
  community: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
}

export type VerifyStatus = "verified" | "needs_choice" | "not_found";

export interface VerifyResult {
  status: VerifyStatus;
  /** Best normalized guess (canonical names where possible). */
  normalized: VerifiedLocation;
  /** Community candidates from the OTOP list when ambiguous/uncertain. */
  communityCandidates: PlaceItem[];
  /** Human-readable warnings (e.g. district not in province). */
  warnings: string[];
  /** True when the AI district/province passed the offline admin check. */
  adminValid: boolean;
}

/** Fuzzy contains match on normalized Thai text. */
function nameMatches(a: string, b: string): boolean {
  const na = normalizeThaiName(a);
  const nb = normalizeThaiName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Verify a location offline. Does NOT call any network.
 */
export function verifyLocationOffline(input: AiLocationInput): VerifyResult {
  const warnings: string[] = [];

  let province = input.province?.trim() || null;
  let district = input.district?.trim() || null;
  const subdistrict = input.subdistrict?.trim() || null;
  const community = input.community?.trim() || null;
  const placeName = input.placeName?.trim() || null;

  // 1) Province validity.
  const provinceOk = province ? isValidProvince(province) : false;
  if (province && !provinceOk) {
    // Maybe the AI put a district in province? Try to recover from district.
    warnings.push(`ไม่พบจังหวัด "${province}" ในฐานข้อมูล`);
  }

  // 2) District ↔ province.
  let adminValid = false;
  if (province && district) {
    if (districtInProvince(district, province)) {
      adminValid = true;
    } else {
      // District might be valid but under a different province, or province wrong.
      const owners = provincesForDistrict(district);
      if (owners.length === 1) {
        warnings.push(`อำเภอ "${district}" อยู่ในจังหวัด ${owners[0]} (ปรับให้อัตโนมัติ)`);
        province = owners[0];
        adminValid = true;
      } else if (owners.length > 1) {
        warnings.push(`อำเภอ "${district}" มีในหลายจังหวัด โปรดเลือกจังหวัดที่ถูกต้อง`);
      } else {
        warnings.push(`ไม่พบอำเภอ "${district}" ในจังหวัด ${province}`);
      }
    }
  } else if (province && !district) {
    adminValid = provinceOk;
  }

  // Canonicalize names we trust.
  province = canonicalProvince(province) ?? province;
  if (adminValid) district = canonicalDistrict(district) ?? district;

  // 3) Match a known OTOP community ONLY when an explicit community name is provided
  // (Do NOT try to match arbitrary place names like cafes or attractions to OTOP villages).
  const matchKey = community || (placeName && /^(ชุมชน|หมู่บ้าน)/.test(placeName) ? placeName : null);
  let candidates: PlaceItem[] = [];
  if (matchKey) {
    candidates = ALL_PLACES.filter((p) => {
      const nameHit = nameMatches(p.name, matchKey);
      if (!nameHit) return false;
      // If we have a valid province, keep only candidates in it.
      if (province && isValidProvince(province)) {
        return nameMatches(p.provinceName, province);
      }
      return true;
    });
  }

  const normalized: VerifiedLocation = {
    placeName,
    community: community ?? null,
    subdistrict,
    district,
    province,
  };

  // Decide status.
  let status: VerifyStatus;
  if (candidates.length === 1 && adminValid && community) {
    // One confident community + admin consistent → fill from it.
    const c = candidates[0];
    normalized.community = c.name;
    normalized.district = canonicalDistrict(c.districtName) ?? c.districtName;
    normalized.province = canonicalProvince(c.provinceName) ?? c.provinceName;
    normalized.subdistrict = normalized.subdistrict ?? c.subdistrict;
    status = "verified";
  } else if (candidates.length >= 1) {
    status = "needs_choice"; // multiple communities OR admin uncertain → user picks
  } else if (adminValid && (community || placeName)) {
    // Admin names are valid but the community isn't in our OTOP list — still
    // usable; user confirms (and we can enrich via Google in phase 4).
    status = "needs_choice";
  } else {
    status = "not_found";
  }

  return { status, normalized, communityCandidates: candidates.slice(0, 8), warnings, adminValid };
}
