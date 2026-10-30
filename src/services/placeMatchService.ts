import type { MatchLevel, PlaceCandidate, PlaceEvidenceSource } from "./placeTypes";

export type { MatchLevel };

/**
 * เทียบ candidate กับ "ที่ลงทะเบียนของชุมชน"
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §6.2 (D2)
 *
 * D2 = **เทียบด้วย Google id อย่างเดียว**
 *   ไม่เทียบด้วยชื่อ ไม่เทียบด้วยระยะทาง — เพราะชื่อหมู่บ้าน/ชื่อร้าน
 *   ในไทยซ้ำกันเยอะมาก ("บ้านปาย" กับ "บ้านปายใหม่") และการเทียบชื่อคือ
 *   การ "เดา" ซึ่งแอปเคยทำให้ผู้ใช้เลือกผิดเองโดยไม่รู้ตัว
 *
 *   → `registeredPlaceId` ที่ไม่ใช่ Google id (เช่น `host-…`, `otop-…`)
 *     ถือว่า "ไม่ตรง" เสมอ
 */

export type MatchKind = "registered" | "none";

export function matchAgainstRegistered(
  candidates: PlaceCandidate[],
  registeredPlaceId: string | null | undefined
): { kind: MatchKind; candidate: PlaceCandidate | null } {
  if (!registeredPlaceId) return { kind: "none", candidate: null };
  const hit = candidates.find((c) => c.placeId === registeredPlaceId) ?? null;
  return { kind: hit ? "registered" : "none", candidate: hit };
}

/**
 * ระดับที่สถานที่จับคู่กับชุมชนได้ (3 ชั้น)
 * -------------------------------------------------------------
 * ชั้น 1: ชื่อหมู่บ้านปรากฏในชื่อ/ที่อยู่  → village
 * ชั้น 2: ตำบลตรง                            → subdistrict
 * ชั้น 3: อำเภอตรง (หรือ parse ตำบลไม่ได้)  → district
 *
 * ค่านี้เป็น **คำเดา** ของระบบ ไม่ใช่การยืนยัน — ผู้ใช้ต้องกดยืนยันเสมอ
 */

/** ป้ายบอกผู้ใช้ว่า "ตรงแค่ไหน" — ห้ามทำให้ดูเหมือนอยู่ในหมู่บ้านจริง */
export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = {
  village: "อยู่ในหมู่บ้านนี้",
  subdistrict: "อยู่ตำบลเดียวกัน",
  district: "อยู่ในอำเภอเดียวกัน",
};

/** เรียงตามความเจาะจง — ชั้นที่เจาะจงกว่าขึ้นก่อน */
export const MATCH_LEVEL_ORDER: MatchLevel[] = ["village", "subdistrict", "district"];

/** จัดลำดับ candidate ตามระดับการจับคู่ (เดิมลำดับไว้คงเดิม) */
export function sortByMatchLevel(candidates: PlaceCandidate[]): PlaceCandidate[] {
  return [...candidates].sort((a, b) => {
    const rank = (c: PlaceCandidate) => {
      const i = MATCH_LEVEL_ORDER.indexOf((c.matchLevel ?? "district") as MatchLevel);
      return i < 0 ? MATCH_LEVEL_ORDER.length : i;
    };
    return rank(a) - rank(b);
  });
}

/**
 * จัดลำดับตามที่ AI ให้ก่อน — แล้วค่อยตกไประดับอำเภอ/ตำบล
 * -------------------------------------------------------------
 * รอบ "AI หาสถานที่" ใหม่ให้ `aiRank` มาด้วย (1 = ตรงกับคลิปที่สุด)
 * → ผู้ใช้ต้องเห็นอันดับนั้นก่อน ไม่ใช่เรียงตามระดับภูมิศาสตร์อย่างเดียว
 *
 * · มี `aiRank` ทั้งคู่      → เรียงตาม `aiRank`
 * · อันหนึ่งมี อีกอันไม่มี    → อันที่ AI มีความเห็นขึ้นก่อน
 * · ไม่มีทั้งคู่             → ตกไปใช้ระดับอำเภอ/ตำบล (ผลค้นจากแอปเอง)
 *
 * `Array.prototype.sort` เป็น stable → key เท่ากันได้ลำดับเดิมของ backend ไว้
 */
export function sortByAiRank(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const levelRank = (c: PlaceCandidate) => {
    const i = MATCH_LEVEL_ORDER.indexOf((c.matchLevel ?? "district") as MatchLevel);
    return i < 0 ? MATCH_LEVEL_ORDER.length : i;
  };
  return [...candidates].sort((a, b) => {
    const ar = a.aiRank ?? null;
    const br = b.aiRank ?? null;
    if (ar !== null && br !== null) return ar - br;
    if (ar !== null) return -1;
    if (br !== null) return 1;
    return levelRank(a) - levelRank(b);
  });
}

/**
 * ป้ายบอกผู้ใช้ว่าหลักฐานมาจากไหน — ผู้ใช้ต้องเห็นว่า "ที่มา" ของชื่อคืออะไร
 */
export const EVIDENCE_SOURCE_LABEL: Record<PlaceEvidenceSource, string> = {
  transcript: "จากเสียงในคลิป",
  on_screen_text: "จากตัวหนังสือบนจอ",
  visual: "จากภาพในคลิป",
  caption: "จากแคปชัน",
  user_location: "จากที่ผู้ใช้ระบุ",
};

/**
 * ป้ายกำกับแหล่งที่มาของข้อมูล (D21)
 * -------------------------------------------------------------
 * ผู้ใช้ต้องรู้ว่าค่าที่เห็นมาจากใคร — เจ้าของแจ้ง, จากคลิป, หรือจาก Google
 */
export const SOURCE_LABEL = {
  owner: "เจ้าของแจ้ง",
  clip: "จากคลิป",
  google: "จาก Google",
} as const;

/** ป้ายของระดับการจับคู่กับชุมชนที่ผู้ใช้เลือกเอง */
export const MANUAL_MATCH_LABEL = "ผู้ใช้ระบุเอง";
