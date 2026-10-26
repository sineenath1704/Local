/**
 * การเทียบสถานที่กับ "ขอบเขต" ของชุมชน
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §2.2.2 — การกรอง 3 ชั้น
 *
 *   village    = อยู่ตำบลเดียวกัน และชื่อหมู่บ้านปรากฏในที่อยู่
 *   subdistrict = อยู่ตำบลเดียวกัน แต่ยังไม่เจอชื่อหมู่บ้าน
 *   district   = อยู่อำเภอเดียวกัน (หรือ parse ตำบลไม่ได้ → ให้ผู้ใช้ตัดสิน)
 *
 * ทำไมแยกไฟล์เดียว
 *   ส่วนนี้เป็น **ตรรกะบริสุทธิ์** — ไม่แตะ Google, ไม่แตะฐานข้อมูล,
 *   ไม่ต้องมี credential ใด ๆ → ทดสอบตรง ๆ ได้
 *   และให้ฝั่งแอป (แฟส 3) อ้างอิงกติกาเดียวกันได้
 */

import type { CommunityMatchLevel, PlaceCandidate } from "./placeTypes";

export type { CommunityMatchLevel };

/**
 * ขอบเขตของการค้น — บอกว่าเรากำลังหาสถานที่ "ในที่ไหน"
 * -------------------------------------------------------------
 * Google Places ไม่มีระดับ "หมู่บ้าน" ใน address components → ขอบเขตที่ทำได้
 * คือ ตำบล (หรือเขต/แขวงในกรุงเทพ) + เช็คชื่อหมู่บ้านเป็นข้อความ
 */
export interface LocationScope {
  /** ชื่อหมู่บ้าน/ชุมชน เช่น "บ้านดอยปุย" */
  community?: string | null;
  /** ตำบล/แขวง เช่น "สุเทพ" */
  subdistrict?: string | null;
  /** อำเภอ/เขต เช่น "เมืองเชียงใหม่" */
  district?: string | null;
  /** จังหวัด เช่น "เชียงใหม่" */
  province?: string | null;
}

/**
 * ขอบเขตที่กรองจริง (strict) หรือกรองแบบ "prefer" (ไม่ strict)
 * - strict = ตำบล (หรืออำเภอ ถ้า scopeLevel = "district")
 * - ไม่ strict = ไล่จากกว้างไปแคบ แต่ถ้าไม่มีอะไรตรงเลยก็เก็บของเดิมไว้
 */
export type ScopeLevel = "subdistrict" | "district";

/**
 * ทำให้ชื่อไทยเทียบกันได้ — ตัดช่องว่าง/วรรคตอน/ขีด/จุด
 * (Google เขียน "สุเทพ" / "สุ เทพ" / "สุ-เทพ" ได้ทั้งหมด)
 */
export function normalizeAdmin(s: string | null | undefined): string {
  return (s ?? "").replace(/[\s.,\-/()]+/g, "").trim();
}

/**
 * คีย์เทียบชื่อหมู่บ้าน — ตัดคำนำหน้า "บ้าน"/"หมู่" ออก
 * แล้วเทียบแบบ substring (ชื่อหมู่บ้านไทยซ้ำกันมาก)
 */
export function villageKeyOf(name: string | null | undefined): string {
  return normalizeAdmin(
    (name ?? "")
      .replace(/^บ้าน\s*/, "")
      .replace(/^หมู่\s*/, "")
  );
}

/** ชื่อที่สั้นเกินไปจะ match ทั้งจังหวัด → ข้ามชั้นที่ 1 */
export function isTooShortToMatchVillage(name: string | null | undefined): boolean {
  return villageKeyOf(name).length < 5;
}

/** ชื่อสถานที่ + ที่อยู่ → เอาไว้เทียบว่าชื่อหมู่บ้านโผล่ในที่อยู่ไหม */
function candidateHaystack(c: PlaceCandidate): string {
  return normalizeAdmin(`${c.name ?? ""} ${c.address ?? ""}`);
}

/**
 * สถานที่อยู่ในระดับที่ขอไหม
 * - ถ้า parse ระดับนั้นได้ → เทียบค่าตรง ๆ (ถ้าต่าง → ไม่ใช่)
 * - ถ้า parse ไม่ได้ → ดูว่าชื่อนั้นโผล่ในที่อยู่ไหม (ทางเลือกสำรอง)
 */
export function inAdminLevel(
  c: PlaceCandidate,
  level: "subdistrict" | "district",
  want: string
): boolean {
  const parsed = level === "subdistrict" ? c.subdistrict : c.district;
  const wantKey = normalizeAdmin(want);
  if (!wantKey) return false;
  if (parsed) return normalizeAdmin(parsed) === wantKey;
  return normalizeAdmin(c.address).includes(wantKey);
}

/** เทียบชื่อระดับภูมิภาคหลัง normalize — เท่ากัน = ตรงกัน */
export function isSameAdmin(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeAdmin(a);
  const y = normalizeAdmin(b);
  return Boolean(x) && x === y;
}

/**
 * ระดับที่สถานที่จับคู่กับ scope ได้
 * -------------------------------------------------------------
 * ชั้น 1: ชื่อหมู่บ้านปรากฏในชื่อ/ที่อยู่  → village
 * ชั้น 2: ตำบลตรง                            → subdistrict
 * ชั้น 3: อำเภอตรง (หรือ parse ตำบลไม่ได้)  → district
 *
 * ชั้น 1 เป็นการเดา ไม่ใช่การยืนยัน — ผู้ใช้ต้องกดยืนยันเสมอ
 */
export function matchLevelFor(
  c: PlaceCandidate,
  scope: LocationScope
): CommunityMatchLevel {
  const villageKey = villageKeyOf(scope.community);
  if (villageKey && !isTooShortToMatchVillage(scope.community)) {
    if (candidateHaystack(c).includes(villageKey)) return "village";
  }
  // ใช้ `inAdminLevel` เหมือนตัวกรอง — ถ้า parse ระดับนั้นไม่ได้
  // ให้ดูว่าชื่อนั้นโผล่ในที่อยู่ไหม (ไม่งั้นผลจะขัดกับตัวที่กรองไว้)
  if (scope.subdistrict && inAdminLevel(c, "subdistrict", scope.subdistrict)) {
    return "subdistrict";
  }
  if (scope.district && inAdminLevel(c, "district", scope.district)) {
    return "district";
  }
  // parse ตำบลไม่ได้ (เช่นเส้นทาง Legacy ที่ regex จับได้คำเดียว)
  // → ห้ามทิ้งผลลัพธ์ ปล่อยเป็นชั้น 3 ให้ผู้ใช้ตัดสิน (§2.2.2)
  return "district";
}

/**
 * กรองผลค้นด้วยขอบเขต
 * -------------------------------------------------------------
 * strict = จริง  → เหลือเฉพาะที่อยู่ในระดับที่ขอ (ไม่เหลือ = คืน [])
 * strict = เท็จ → ไล่จากกว้างไปแคบ แต่ถ้าไม่มีอะไรตรงเลย เก็บของเดิมทั้งหมด
 *           (พฤติกรรมเดิมของ /places/verify — default ต้องไม่เปลี่ยน)
 */
export function filterByScope(
  candidates: PlaceCandidate[],
  scope: LocationScope | undefined,
  strict: boolean,
  level: ScopeLevel = "subdistrict"
): PlaceCandidate[] {
  if (!scope) return candidates;
  const wantSub = scope.subdistrict ?? "";
  const wantDist = scope.district ?? "";

  // ไม่มีระดับไหนให้กรองเลย (มีแต่ชื่อหมู่บ้าน) → ไม่ตัดอะไรทิ้ง
  if (!wantSub && !wantDist) return candidates;

  const atSub = (c: PlaceCandidate) =>
    Boolean(wantSub) && inAdminLevel(c, "subdistrict", wantSub);
  const atDist = (c: PlaceCandidate) =>
    Boolean(wantDist) && inAdminLevel(c, "district", wantDist);

  const subMatches = wantSub ? candidates.filter(atSub) : [];
  const distMatches = wantDist ? candidates.filter(atDist) : [];

  if (strict) {
    // ระดับที่ขอ = ระดับที่ต้องได้จริง
    const wanted = level === "district" ? distMatches : subMatches;
    if (wanted.length > 0) return wanted;
    // ถ้าขอระดับตำบลแต่ไม่มีอะไรตรง และมีของในอำเภอ → ใช้ของอำเภอ
    // (ผู้ใช้ยังต้องตัดสินใจเอง — ดู matchLevel)
    if (level === "subdistrict" && distMatches.length > 0) return distMatches;
    return [];
  }

  // ไม่ strict — ไล่จากกว้างไปแคบ (พฤติกรรมเดิม)
  if (subMatches.length > 0) return subMatches;
  if (distMatches.length > 0) return distMatches;
  return candidates;
}

/** เรียงลำดับ: village → subdistrict → district */
export const MATCH_RANK: Record<CommunityMatchLevel, number> = {
  village: 3,
  subdistrict: 2,
  district: 1,
};
