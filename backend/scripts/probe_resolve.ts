/**
 * ดูว่า Google Places คืนอะไรให้คำค้นที่ระบบใช้จริง
 * -------------------------------------------------------------
 * ใช้ตอนแก้ `pickCoordCandidate` ใน `src/routes/places.ts` — ต้องเห็น
 * รายชื่อผู้สมัครทั้งหมด ที่อยู่ และพิกัด ถึงจะรู้ว่าทำไมถึงเลือกผิดตัว
 *
 * รัน: npm run probe:resolve
 */

import { searchPlaceCandidates } from "../src/routes/places";

const QUERIES = [
  "วัดพระแก้ว เชียงใหม่",
  "ที่ธีอารามหลวงเชียงใหม่",
  "คอนโดเดอะเบส อ่อนนุช",
  "ดอยอินทนนท์ เชียงใหม่",
  "พระบาทสมเด็จพระเจ้าอยู่หัว",
];

async function main() {
  for (const q of QUERIES) {
    console.log(`\n=== ${q} ===`);
    const results = await searchPlaceCandidates(q);
    if (!results.length) {
      console.log("  (ไม่มีผลลัพธ์)");
      continue;
    }
    for (const r of results) {
      console.log(
        `  • ${r.name}\n      ${r.address}\n      ` +
          `${r.latitude}, ${r.longitude} · จังหวัด=${r.province ?? "-"} · อำเภอ=${r.district ?? "-"}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
