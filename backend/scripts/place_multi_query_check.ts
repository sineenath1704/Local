/**
 * ทดสอบการค้น Google Places หลายคำ — ตรวจว่ารวมผลได้จริงไหม
 * ---------------------------------------------------------------------------
 * ก้อนที่ 2 ของงาน "หาสถานที่": คำค้นหนึ่งคำมักไม่พอ (ชื่อที่ AI อ่านมาอาจ
 * สะกดต่างจากที่ Google บันทึกไว้ หรือพื้นที่ที่คลิปพูดถึงอาจไม่ใช่ชื่อ
 * ที่ Google ใช้) → ลองหลายคำแล้วรวมผล
 *
 * ใช้
 *   cd backend
 *   npm run check:place-multi
 *   npm run check:place-multi -- "บ้านสวนริมน้ำ" "ตำบลบ้านป่า" "สันทิตย์" "เชียงใหม่"
 *
 * ทุกอย่างในไฟล์นี้เป็น **read-only** — ไม่เขียนฐานข้อมูล /
 * ไม่มีการเอาคีย์มาใส่บรรทัดคำสั่ง (อ่านจาก backend/.env ผ่าน src/config.ts)
 */

import { isPlacesConfigured } from "../src/config";
import { searchPlaceCandidatesMulti } from "../src/routes/places";

async function main() {
  const name = (process.argv[2]?.trim() || "บ้านสวนริมน้ำ").trim();
  const subdistrict = (process.argv[3]?.trim() || "บ้านป่า").trim();
  const district = (process.argv[4]?.trim() || "สันทิตย์").trim();
  const province = (process.argv[5]?.trim() || "เชียงใหม่").trim();

  if (!isPlacesConfigured()) {
    console.error("❌ ไม่มี GOOGLE_PLACES_API_KEY — ทดสอบไม่ได้");
    process.exit(1);
  }

  // คำค้นแบบเดียวกับที่รอบ "หาสถานที่" สร้างให้
  const queries = [
    [name, subdistrict, province].filter(Boolean).join(" "),
    [name, district, province].filter(Boolean).join(" "),
  ];

  console.log(`สถานที่ที่ทดสอบ: ${name} (${subdistrict} / ${district} / ${province})`);
  console.log(`คำค้น ${queries.length} คำ:`);
  queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

  const t0 = Date.now();
  const scope = { subdistrict, district, province };
  const result = await searchPlaceCandidatesMulti(queries, {
    maxCandidates: 8,
    scope,
  });
  console.log(`[took] ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log(`\nคำค้นที่ลองจริง: ${result.queries.length}/${queries.length}`);
  if (result.queries.length < queries.length) {
    console.log("   (หยุดเร็ว — เจอผู้สมัครที่ตรงตำบล/หมู่บ้านแล้ว ไม่ต้องจ่ายคำค้นที่เหลือ)");
  }
  if (result.errors.length) {
    console.log(`⚠️ คำค้นที่ล้มเหลว ${result.errors.length} คำ:`);
    result.errors.forEach((e) => console.log(`   · ${e}`));
  }

  console.log(`\nผู้สมัครรวม ${result.candidates.length} รายการ:`);
  if (!result.candidates.length) {
    console.log("  (ไม่เจอ — ลองชื่อ/พื้นที่อื่น)");
  }
  result.candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} — ${c.address || "-"}`);
    console.log(
      `     ${c.primaryTypeDisplayName ?? "-"} · ${c.province ?? "-"}/${c.district ?? "-"}/${
        c.subdistrict ?? "-"
      } · รีวิว ${c.rating ?? "-"}/${c.userRatingCount ?? 0}`
    );
    console.log(`     placeId=${c.placeId}`);
  });

  if (result.candidates.length > 1) {
    const places = new Set(result.candidates.map((c) => c.placeId));
    console.log(
      `\nรวมจาก ${result.queries.length} คำค้น ได้ ${places.size} ที่ (ตัดซ้ำแล้ว)`
    );
  }
}

main().catch((err) => {
  console.error("ทดสอบล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
