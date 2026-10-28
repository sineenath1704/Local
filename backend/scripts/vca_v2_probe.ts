/**
 * เฟส 0 — ตรวจของจริงก่อนเปิดใช้ VCA V2 (ผู้ใช้รันเอง)
 * ---------------------------------------------------------------------------
 * ตาม PLAN_VIDEO_ANALYZER_V2.md เฟส 0 — ตรวจ 3 ข้อที่ต้องรู้ก่อนตัดสินใจ:
 *
 *   (ก) สถานะ flag + ค่าที่ตั้งไว้จริงบนเซิร์ฟเวอร์
 *       (VCA_V2_ENABLED · PROOFREAD_ENABLED · AI/Places/Supabase ตั้งไว้ไหม)
 *   (ข) คลิปใน `videos` มีพิกัด GPS ที่ผู้ใช้ตั้งเองไหม
 *       (ถ้ามี → OSM ใช้พิกัดนั้นเลย ไม่ต้องยิง Nominatim)
 *   (ค) คลิปใน `videos` มี `ai_summary` ที่มีข้อมูลสถานที่แค่ไหน
 *       (ประมาณว่า V2 จะได้การ์ดที่มีเนื้อหากี่คลิป)
 *
 * ทุกอย่างในไฟล์นี้เป็น **read-only** — อ่านอย่างเดียว ไม่เขียนฐานข้อมูล
 * ไม่มีการเอาคีย์มาใส่บรรทัดคำสั่ง (อ่านจาก backend/.env ผ่าน src/config.ts)
 *
 * ใช้
 *   cd backend
 *   npm run probe:vca2
 */

import { config, isAiConfigured, isSupabaseConfigured, isPlacesConfigured } from "../src/config";
import { getSupabaseAdmin } from "../src/supabaseAdmin";

function section(title: string) {
  console.log(`\n— ${title} —`);
}

function yn(v: boolean): string {
  return v ? "✅ ตั้งไว้" : "❌ ไม่ได้ตั้ง";
}

async function main() {
  console.log("เฟส 0 — ตรวจสถานะจริงก่อนเปิด VCA V2 (read-only)");

  // ── (ก) flag + ค่าที่ตั้งไว้ ────────────────────────────────
  section("(ก) flag + ค่าที่ตั้งไว้บนเซิร์ฟเวอร์");
  console.log(`   VCA_V2_ENABLED   : ${config.ai.vcaV2Enabled ? "เปิด" : "ปิด (ค่าเริ่มต้น)"}`);
  console.log(`   PROOFREAD_ENABLED: ${config.ai.proofreadEnabled ? "เปิด" : "ปิด"}`);
  console.log(`   AI (baseUrl+token): ${yn(isAiConfigured())} · โมเดล: ${config.ai.model || "(ไม่ได้ตั้ง)"}`);
  console.log(`   AI_MAX_TOKENS     : ${config.ai.maxTokens}`);
  console.log(`   Google Places     : ${yn(isPlacesConfigured())}`);
  console.log(`   Supabase          : ${yn(isSupabaseConfigured())}`);
  console.log(
    `   OSM User-Agent    : ${
      process.env.OSM_USER_AGENT?.trim() || "(ค่าเริ่มต้น — แนะนำให้ใส่ช่องทางติดต่อจริง)"
    }`
  );
  console.log(
    `   → ถ้าจะเปิด "AI รอบเดียว" ต้องตั้ง PROOFREAD_ENABLED=off คู่กับ VCA_V2_ENABLED=on`
  );

  const admin = getSupabaseAdmin();
  if (!admin) {
    section("(ข) (ค) ข้อมูลคลิป");
    console.log("   ⚠️ ไม่ได้ตั้งค่า Supabase → ข้ามการตรวจข้อมูลคลิป");
    return;
  }

  // ── (ข) พิกัด GPS ที่ผู้ใช้ตั้งเอง ───────────────────────────
  section("(ข) คลิปที่มีพิกัด GPS (videos.latitude / longitude)");
  const total = await admin.from("videos").select("id", { count: "exact", head: true });
  console.log(`   คลิปทั้งหมด: ${total.count ?? 0} แถว${total.error ? ` (${total.error.message})` : ""}`);

  // เช็คว่าคอลัมน์มีอยู่จริงไหม (schema.sql ไม่ได้ระบุทุกคอลัมน์ที่แอปเขียน)
  const withGps = await admin
    .from("videos")
    .select("id, latitude, longitude")
    .not("latitude", "is", null)
    .limit(1000);
  if (withGps.error) {
    console.log(`   ⚠️ อ่านคอลัมน์พิกัดไม่ได้: ${withGps.error.message}`);
    console.log("      (ถ้าไม่มีคอลัมน์ latitude/longitude → OSM ต้องใช้ Nominatim ตลอด)");
  } else {
    const rows = withGps.data || [];
    console.log(`   คลิปที่มีพิกัด: ${rows.length} แถว (ดูสูงสุด 1,000)`);
    for (const r of rows.slice(0, 5)) {
      console.log(`      · ${r.id}: ${r.latitude}, ${r.longitude}`);
    }
  }

  // ── (ค) ai_summary ที่มีข้อมูลสถานที่ ───────────────────────
  section("(ค) คลิปที่มี ai_summary พร้อมข้อมูลสถานที่");
  const withSummary = await admin
    .from("videos")
    .select("id, ai_summary")
    .not("ai_summary", "is", null)
    .limit(1000);
  if (withSummary.error) {
    console.log(`   ⚠️ อ่าน ai_summary ไม่ได้: ${withSummary.error.message}`);
  } else {
    const rows = withSummary.data || [];
    let withPlace = 0;
    let withPrice = 0;
    let withCard = 0;
    for (const r of rows) {
      const s = r.ai_summary as any;
      if (!s) continue;
      if (s.place && (s.place.place_name || s.place.community)) withPlace += 1;
      if (s.place?.price_info?.weekday || s.place?.price_info?.weekend) withPrice += 1;
      if (s.card) withCard += 1;
    }
    console.log(`   คลิปที่มี ai_summary: ${rows.length} แถว (ดูสูงสุด 1,000)`);
    console.log(`   · มีชื่อสถานที่/ชุมชน : ${withPlace}`);
    console.log(`   · มีราคา              : ${withPrice}`);
    console.log(`   · มีการ์ด V2 (card)   : ${withCard}  ← ถ้า > 0 แปลว่าเคยเปิด V2 มาแล้ว`);
  }

  console.log("\nเสร็จ — ข้อมูลทั้งหมดเป็น read-only");
}

main()
  .catch((err) => {
    console.error("ล้ม:", err);
    process.exit(1);
  });
