/**
 * สคริปต์สด — ยิง Google Places จริง 1 ครั้ง เพื่อดูว่า "ค้นชื่อสถานที่" ได้ผลจริงไหม
 * -------------------------------------------------------------
 * ชุดเทสต์ออฟไลน์ (`npm run test:place-lookup`) พิสูจน์ว่า *ตรรกะ* ถูก
 * สคริปต์นี้พิสูจน์ว่า *ของจริง* ตอบมาแบบที่คาด (ชื่อที่ค้นได้ / จังหวัดตรง / ข้อมูลครบ)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * รันเอง — ใช้คีย์ใน backend/.env (อ่านผ่าน src/config.ts) ไม่มีการเอาคีย์มาใส่
 * บรรทัดคำสั่ง:
 *
 *   cd backend
 *   npm run probe:place-lookup -- "บ้านปาย" "เชียงใหม่"
 *
 * อาร์กิวเมนต์:
 *   argv[2] = ข้อความคำถาม (เช่น "บ้านปายเปิดกี่โมง") — ค่าปริยาย "บ้านปาย"
 *   argv[3] = จังหวัดที่รู้ (ไม่บังคับ) — ใช้กรองว่าสถานที่อยู่จังหวัดเดียวกันไหม
 *
 * หมายเหตุ: ทุกคำขอที่คิดเงินจะแสดงจำนวนท้ายสคริปต์ (Places Legacy ≈ $0.032/ค้น
 * ≈ $0.017/รายละเอียด) — รันเท่าที่จำเป็น
 * ─────────────────────────────────────────────────────────────────────────
 */

import { lookupPlace, defaultDeps } from "../src/placeLookup";
import type { PlaceLookupDeps } from "../src/placeLookup";

async function main() {
  const text = process.argv[2]?.trim() || "บ้านปาย";
  const province = process.argv[3]?.trim() || null;

  const billable: string[] = [];
  const deps: PlaceLookupDeps = {
    ...defaultDeps(),
    onBillable: (kind) => {
      billable.push(kind);
    },
  };

  console.log("=== ค้นสถานที่จาก Google Places (จริง) ===");
  console.log(`คำถาม: ${text}`);
  console.log(`จังหวัดที่รู้: ${province ?? "-"}`);

  const t0 = Date.now();
  const result = await lookupPlace({
    text,
    scope: { community: null, province, district: null, subdistrict: null },
    deps,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[took] ${secs}s`);
  console.log(`ที่มาของข้อมูล: ${result.source ?? "-"}`);

  if (result.context) {
    const c = result.context;
    console.log("\n--- ข้อมูลสถานที่ที่ได้ ---");
    console.log(`ชื่อ: ${c.placeName}`);
    console.log(
      `ที่อยู่: ${[c.subdistrict, c.district, c.province].filter(Boolean).join(" ") || "-"}`
    );
    console.log(`เบอร์: ${c.phone ?? "-"}`);
    console.log(`เวลาเปิด: ${c.openingHours ?? "-"}`);
    console.log(`ระดับราคา: ${c.priceLevel ?? "-"}`);
    console.log(`เว็บ: ${c.website ?? "-"}`);
    console.log(
      `เรตติง: ${c.rating ?? "-"}${
        c.userRatingsTotal != null ? ` (${c.userRatingsTotal} รีวิว)` : ""
      }`
    );
    console.log(`ประเภท: ${c.category ?? "-"}`);
    console.log(`สถานะ: ${c.businessStatus ?? "-"}`);
    console.log(`แมพ: ${c.googleMapsUrl ?? "-"}`);
    console.log(`googlePlaceId: ${c.googlePlaceId ?? "-"}`);
  } else {
    console.log("\n⚠️ ไม่ได้ข้อมูลสถานที่ (ผ่าน gate ไม่ได้ / ไม่พบ / Google ล่ม)");
  }

  if (result.candidates.length) {
    console.log(`\n--- พบ ${result.candidates.length} แห่งที่ชื่อซ้ำ (ให้ผู้ใช้เลือก) ---`);
    result.candidates.forEach((c, i) => {
      console.log(
        `  ${i + 1}. ${c.name} — ${[c.subdistrict, c.district, c.province]
          .filter(Boolean)
          .join(" ") || "-"}`
      );
      console.log(
        `     เรตติง ${c.rating ?? "-"}${
          c.userRatingsTotal != null ? ` (${c.userRatingsTotal})` : ""
        } · ${c.googleMapsUrl ?? "-"}`
      );
    });
  }

  console.log(
    `\nคำขอที่คิดเงิน: ${billable.length} (${billable.join(", ") || "ไม่มี"})`
  );
}

main().catch((err) => {
  console.error("probe ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
