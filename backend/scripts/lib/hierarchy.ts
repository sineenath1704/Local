/**
 * ตัวช่วยอ่าน `src/data/thailand_hierarchy.json` (ชุมชน OTOP ทั้งประเทศ)
 * ---------------------------------------------------------------------------
 * ใช้ร่วมกันโดยสคริปต์ใน `backend/scripts/`:
 *   • seed_communities.ts   — ขั้น 1.2 (seed ตาราง communities)
 *   • backfill_places.ts   — ขั้น 1.3/1.4 (backfill B1–B6)
 *   • otop_village_map.ts  — ขั้น 0.4 (ทำไฟล์แมปหมู่บ้าน → CDD Village_ID)
 *   • phase0_probe.ts      — ขั้น 0.1/0.5/0.7 (probe)
 *
 * ทั้งไฟล์เป็น read-only ต่อข้อมูล — ไม่แตะฐานข้อมูล ไม่เขียนไฟล์ข้อมูล
 * (ยกเว้น `otop_village_map.ts` ที่เขียนไฟล์แมปเมื่อสั่ง `--write`)
 */

import fs from "fs";
import path from "path";

export const ROOT = path.resolve(__dirname, "../../..");
export const HIERARCHY_FILE = path.join(ROOT, "src/data/thailand_hierarchy.json");
export const VILLAGE_MAPPING_FILE = path.join(ROOT, "src/data/otop_village_mapping.json");

/** แถวชุมชนหนึ่งหน่วยใน hierarchy */
export interface PlaceItem {
  id: string;
  name: string;
  subdistrict: string;
  districtName: string;
  provinceName: string;
  regionName: string;
  category: string;
  highlight: string;
  isVisited: boolean;
  reviewClipCount: number;
}

/** โหลด hierarchy แล้วแบนเป็นรายการชุมชน (region → province → district → places) */
export function loadHierarchy(): PlaceItem[] {
  const raw = JSON.parse(fs.readFileSync(HIERARCHY_FILE, "utf8"));
  const out: PlaceItem[] = [];
  for (const region of raw ?? []) {
    for (const prov of region.provinces ?? []) {
      for (const dist of prov.districts ?? []) {
        for (const p of dist.places ?? []) out.push(p);
      }
    }
  }
  return out;
}

/**
 * `"ต.สุเทพ, หมู่ 11"` → `"สุเทพ"`
 * ---------------------------------------------------------------------------
 * กฎ (ตามข้อมูลจริงในไฟล์):
 *   1. เอาส่วนแรกก่อนจุลภาค (ส่วนที่หลัง `,` คือเลขหมู่ ไม่ใช่ชื่อตำบล)
 *   2. ตัดคำนำหน้า `ตำบล` / `ต.` / `แขวง`
 *   3. ถ้ายังมีท้ายแบบ `"ในเมือง อ.คลองสามวา"` (กรุงเทพฯ 53 แถว)
 *      ให้ตัดทิ้งส่วนหลัง เหลือ `"ในเมือง"` — เพราะเขตอยู่ที่คอลัมน์
 *      `districtName` อยู่แล้ว และชื่อที่ Google ใช้คือ "แขวงในเมือง"
 */
export function parseSubdistrict(raw: string): string {
  if (!raw) return "";
  const first = (raw.split(",")[0] ?? "").trim();
  const stripped = first.replace(/^(ตำบล|ต\.|แขวง)\s*/, "").trim();
  const cut = stripped.split(/\s+(?:อ\.|เขต)/)[0] ?? stripped;
  return cut.trim();
}

/**
 * ชื่อหมู่บ้าน → คีย์เทียบ: ตัด "บ้าน"/"หมู่" นำหน้า + ตัดช่องว่าง/ขีด/จุด
 * ใช้เทียบกับที่อยู่จาก Google
 */
export function villageSearchKey(name: string): string {
  return (name ?? "")
    .replace(/^บ้าน\s*/, "")
    .replace(/^หมู่\s*/, "")
    .replace(/[\s.,\-/()]+/g, "")
    .trim();
}

/**
 * ชื่อหมู่บ้านที่สั้นเกินไป → ใช้เทียบแล้วจะ match ทั้งจังหวัด
 * (ดู PLAN_PLACE_MATCHING.md §2.2.2) — ตัวอักษรไทยนับเป็นตัวเดียว
 */
export function isTooShortToMatch(name: string): boolean {
  return villageSearchKey(name).length < 5;
}

/** ชื่อตำบล/อำเภอ/จังหวัด → คีย์เทียบ (ตัดคำนำหน้า จ./อ./ต./แขวง/เขต) */
export function adminKey(name: string): string {
  return (name ?? "")
    .replace(/^(จังหวัด|จ\.)\s*/, "")
    .replace(/^(อำเภอ|อ\.)\s*/, "")
    .replace(/^(ตำบล|ต\.)\s*/, "")
    .replace(/^(แขวง|เขต)\s*/, "")
    .replace(/[\s.,\-/()]+/g, "")
    .trim();
}

/** คีย์ประจำชุมชนจากชื่อ + ตำบล (ใช้จับคู่ host กับ hierarchy) */
export function tambolKey(
  province: string,
  district: string,
  subdistrict: string
): string {
  return [adminKey(province), adminKey(district), adminKey(subdistrict)].join("|");
}

/** ข้อมูลในไฟล์แมป (ขั้น 0.4) — โครงสร้างเดียวกับที่ `otop_village_map.ts` เขียน */
export interface VillageMapping {
  otop_village_id: string;
  village_name: string;
  subdistrict: string;
  district: string;
  province: string;
}

export interface VillageMappingFile {
  _note?: string;
  _generated?: string;
  communities?: Record<string, VillageMapping>;
}

/** อ่านไฟล์แมปหมู่บ้าน → CDD Village_ID (ถ้ายังไม่มีไฟล์ = คืนว่าง) */
export function loadVillageMapping(): Record<string, VillageMapping> {
  if (!fs.existsSync(VILLAGE_MAPPING_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(VILLAGE_MAPPING_FILE, "utf8"));
    return (parsed?.communities ?? {}) as Record<string, VillageMapping>;
  } catch {
    return {};
  }
}
