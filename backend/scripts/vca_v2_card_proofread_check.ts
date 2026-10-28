/**
 * ตรวจ "ตรวจสะกดการ์ด" กับโมเดลจริง — ผู้ใช้รันเอง
 * ---------------------------------------------------------------------------
 * ข้อมูลเชิงโครงสร้าง (ตัวเลข/ชื่อ) การ์ดเกิดจากโมเดลเอง → ต้องมีรอบตรวจสะกด
 * แต่รอบตรวจสะกดเดิมแก้แค่ `text`/`place` (สายเก่า) ส่วนแอปเรนเดอร์ `card`
 * → ผลที่แก้ไม่เคยไปถึงหน้าจอ
 *
 * สคริปต์นี้ยิงโมเดลจริง 1 รอบ แล้วเทียบ:
 *   · โมเดลแก้คำที่สะกดผิดไหม
 *   · ตัวเลขที่เพี้ยนถูกปฏิเสธไหม (guard)
 *   · บรรทัดจาก Google ถูกแตะไหม (ต้องไม่)
 *
 * ใช้
 *   cd backend
 *   npm run check:vca2:proofread
 */

import { validateExtraction, buildPostCard, renderPostText } from "../src/videoPromptV2";
import { proofreadCard, applyProofreadToCard } from "../src/thaiProofread";

/** การ์ดตัวอย่างที่มี "สะกดผิด" จงใจใส่ไว้ 3 จุด */
const RAW = {
  core: {
    place_name: "โฮมสเตยบ้านน้ำไหลเขา",
    community: "หมู่บ้านห้วยหอม",
    location: { province: "แม่ฮ่องสอน", district: "แมล่าน้อย", subdistrict: "ห้วยหอม" },
    category: ["ที่พัก"],
    overview:
      "บ้านไม้ชั้นเดียวยกใต้ถุน หลังคามุงกระเบื้องไม้ ตั้งอยู่กลางหมู่บ้านห้วยหอม " +
      "ถึงถนนหลักเดิน 5 นาที ขับรถเข้าถึง และมีกองไฟกลางหมู่บ้านให้ทำกิจกรรมร่วมกัน",
    price: {
      weekday: "700",
      weekend: "700",
      unit: "ต่อคน",
      currency: "THB",
      inclusions: ["อาหารเย็นและอาหารเช้า"],
    },
    opening_hours: "08:00-18:00",
    contact: { phone: "08-1234-5678", facebook: null, line: null },
    // จงใจใส่สะกดผิด
    restrictions: ["รับวันละ 1 กลุม", "ทุกคนที่มาพักต้องช่วยกันทำกองไฟ"],
    activities: ["พักค้างคืน"],
    views: ["วิวทะเลหมอก"],
    highlights: ["วิวทะเลหมอกยามเช้า"],
    tags: ["แม่ฮ่องสอน"],
  },
  stay: null,
  food: null,
  activity: null,
  otop: null,
  access: {
    road_condition: "ถนนลูกรังช่วงท้าย",
    vehicle_advice: "แนะนำรถยนต์ 4 ล้อ",
    walk_required: "เดินเข้าซอยอีก 5 นาที",
    parking: "จอดรถหน้าบานได้ 2 คัน", // จงใจใส่สะกดผิด
  },
  confidence: {
    overall: 0.8,
    per_module: {},
    conflicts: [],
    missing_info: [],
    source_used: [],
  },
};

const GOOGLE_NEARBY = [
  { name: "วัดป่าแตง", label: "วัด", distanceKm: 2.4, rating: 4.6 },
];

const MAP = {
  lat: 18.1,
  lon: 97.7,
  routeKm: 12.4,
  routeMinutes: 18,
  routeFrom: "ตัวอำเภอแมล่าน้อย",
  routeVia: "ทางหลวงชนบท 1081",
  credit: "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform",
};

async function main() {
  const data = validateExtraction(RAW as any).data;
  const card = buildPostCard(data, MAP, GOOGLE_NEARBY);

  console.log("═".repeat(60));
  console.log("การ์ดก่อนตรวจสะกด");
  console.log("═".repeat(60));
  console.log(renderPostText(card));

  const t0 = Date.now();
  const corrections = await proofreadCard(
    card,
    "โฮมสเตยบ้านน้ำไหลเขา ห้วยหอม แมล่าน้อย แม่ฮ่องสอน ราคา 700 บาท ต่อคน รับวันละ 1 กลุ่ม ถนนลูกรังช่วงท้าย"
  );
  console.log(`\n(ใช้เวลา ${Date.now() - t0} ms)`);

  if (!corrections) {
    console.log("\n❌ โมเดลไม่ตอบ / ตอบไม่ใช่ JSON → ใช้การ์ดเดิม (ไม่มีอะไรเสีย)");
    console.log("   ดู _diag ของคำขอล่าสุด หรือ log [proofread]");
    return;
  }

  console.log("\n" + "═".repeat(60));
  console.log("สิ่งที่โมเดลแก้กลับมา (ดิบ)");
  console.log("═".repeat(60));
  console.log(JSON.stringify(corrections, null, 2).slice(0, 2000));

  const fixed = applyProofreadToCard(card, corrections);
  console.log("\n" + "═".repeat(60));
  console.log("การ์ดหลังตรวจสะกด");
  console.log("═".repeat(60));
  console.log(renderPostText(fixed));

  console.log("\n" + "═".repeat(60));
  console.log("ผลตรวจ");
  console.log("═".repeat(60));
  const before = renderPostText(card);
  const after = renderPostText(fixed);
  console.log(
    before === after ? "⚠️ ไม่มีอะไรเปลี่ยน — โมเดลอาจไม่ได้แก้อะไรเลย" : "✅ การ์ดเปลี่ยนไป"
  );
  console.log(
    `• "กลุม" → "กลุ่ม"  ${after.includes("รับวันละ 1 กลุ่ม") ? "✅ แก้แล้ว" : "❌ ยังไม่แก้"}`
  );
  console.log(
    `• "หน้าบาน" → "หน้าบ้าน"  ${after.includes("จอดรถหน้าบ้านได้ 2 คัน") ? "✅ แก้แล้ว" : "❌ ยังไม่แก้"}`
  );
  console.log(
    `• ตัวเลขไม่ขยับ  ${/700\/คน/.test(after) ? "✅ ยังอยู่" : "❌ หายไป"}`
  );
  console.log(
    `• บรรทัดจาก Google ไม่ถูกแตะ  ${
      after.includes("วัดป่าแตง · วัด · 2.4 กม. · ★4.6") ? "✅ อยู่" : "❌ ถูกแก้"
    }`
  );
}

main().catch((err) => {
  console.error("ล้ม:", err);
  process.exit(1);
});
