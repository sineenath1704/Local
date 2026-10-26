/**
 * ตรวจกติกา "จับคู่สถานที่กับชุมชน" — รันแบบออฟไลน์ ไม่ต้องมี credential
 * ---------------------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §2.2.2 (การกรอง 3 ชั้น)
 *
 * ตรรกะใน `src/placeScope.ts` เป็นตรรกะบริสุทธิ์ (ไม่แตะ Google / ฐานข้อมูล)
 * → ทดสอบได้ตรง ๆ โดยไม่ต้องเปิดบิลลิ่มป์
 *
 * ใช้
 *   cd backend
 *   npx ts-node --transpile-only scripts/place_scope_check.ts
 */

import {
  filterByScope,
  matchLevelFor,
  type LocationScope,
} from "../src/placeScope";
import type { PlaceCandidate } from "../src/placeTypes";

const SCOPE: LocationScope = {
  community: "บ้านดอยปุย",
  subdistrict: "สุเทพ",
  district: "เมืองเชียงใหม่",
  province: "เชียงใหม่",
};

function candidate(
  placeId: string,
  name: string,
  address: string,
  admin: { province: string; district: string; subdistrict: string | null }
): PlaceCandidate {
  return {
    placeId,
    name,
    address,
    latitude: 1,
    longitude: 1,
    types: [],
    ...admin,
  };
}

const CANDIDATES: PlaceCandidate[] = [
  candidate(
    "a",
    "ร้านกาแฟดอยปุย",
    "99 หมู่ 5 บ้านดอยปุย ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200",
    { province: "เชียงใหม่", district: "เมืองเชียงใหม่", subdistrict: "สุเทพ" }
  ),
  candidate(
    "b",
    "ร้านส้มตำ",
    "1 หมู่ 2 ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200",
    { province: "เชียงใหม่", district: "เมืองเชียงใหม่", subdistrict: "สุเทพ" }
  ),
  candidate(
    "c",
    "ร้านของชาวบ้าน",
    "5 ต.ป่าแดง อ.เมืองเชียงใหม่ จ.เชียงใหม่",
    { province: "เชียงใหม่", district: "เมืองเชียงใหม่", subdistrict: "ป่าแดง" }
  ),
  candidate(
    "d",
    "ร้านในกรุง",
    "3 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพ 10110",
    { province: "กรุงเทพมหานคร", district: "คลองเตย", subdistrict: "คลองเตย" }
  ),
  // parse ตำบลไม่ได้ (เส้นทาง Legacy บางกรณี) แต่ชื่อตำบลอยู่ในที่อยู่
  candidate(
    "e",
    "ร้านไม่มีตำบล",
    "7 ต.สุเทพ อ.เมืองเชียงใหม่",
    { province: "เชียงใหม่", district: "เมืองเชียงใหม่", subdistrict: null }
  ),
];

const ids = (list: PlaceCandidate[]) => list.map((c) => c.placeId).join(" | ");

let failed = 0;
function expect(label: string, actual: string, want: string) {
  const ok = actual === want;
  if (!ok) failed += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}: ${actual}${ok ? "" : `  (คาดว่า ${want})`}`);
}

console.log("════════ ตรวจกติกาจับคู่สถานที่กับชุมชน ════════\n");

console.log("— กรองตามระดับ —");
expect(
  "strict ระดับตำบล",
  ids(filterByScope(CANDIDATES, SCOPE, true, "subdistrict")),
  "a | b | e"
);
expect(
  "strict ระดับอำเภอ",
  ids(filterByScope(CANDIDATES, SCOPE, true, "district")),
  "a | b | c | e"
);
expect(
  "ไม่ strict (พฤติกรรมเดิม — ไล่จากกว้างไปแคบ)",
  ids(filterByScope(CANDIDATES, SCOPE, false, "subdistrict")),
  "a | b | e"
);

console.log("\n— ขอบเขตที่ไม่มีระดับให้กรอง —");
expect(
  "มีแต่ชื่อหมู่บ้าน → ไม่ตัดทิ้ง",
  ids(filterByScope(CANDIDATES, { community: "บ้านดอยปุย" }, true, "subdistrict")),
  "a | b | c | d | e"
);
expect(
  "scope ว่างเปล่า → ไม่ตัดทิ้ง",
  ids(filterByScope(CANDIDATES, {}, true, "subdistrict")),
  "a | b | c | d | e"
);

console.log("\n— ป้ายระดับการจับคู่ —");
expect("ชื่อหมู่บ้านโผล่ในที่อยู่", matchLevelFor(CANDIDATES[0], SCOPE), "village");
expect("ตำบลตรง แต่ไม่มีชื่อหมู่บ้าน", matchLevelFor(CANDIDATES[1], SCOPE), "subdistrict");
expect("ตำบลไม่ตรง แต่อำเภอตรง", matchLevelFor(CANDIDATES[2], SCOPE), "district");
expect(
  "ไม่มีระดับไหนตรงเลย → ให้ผู้ใช้ตัดสิน",
  matchLevelFor(CANDIDATES[3], SCOPE),
  "district"
);
expect("parse ตำบลไม่ได้ แต่ชื่อตำบลอยู่ในที่อยู่", matchLevelFor(CANDIDATES[4], SCOPE), "subdistrict");
expect(
  "ชื่อหมู่บ้านสั้นเกินไป → ข้ามชั้น 1",
  matchLevelFor(CANDIDATES[0], { community: "บ้านดอย", subdistrict: "สุเทพ" }),
  "subdistrict"
);

console.log(
  failed === 0
    ? "\n✅ ผ่านทั้งหมด"
    : `\n❌ พลาด ${failed} ข้อ`
);
process.exit(failed === 0 ? 0 : 1);
