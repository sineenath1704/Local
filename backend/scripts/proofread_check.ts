/**
 * Offline check of the proofread guards — no network, no keys.
 *
 * The proofread pass calls the model, but the part that actually protects the
 * data is deterministic: which corrections are allowed through. This script
 * feeds those guards a set of corrections — some legitimate typo fixes, some
 * attempts to change numbers / names / lists — and prints which survived.
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/proofread_check.ts
 */

import { applyProofreadToSummary, type ProofreadCorrections } from "../src/thaiProofread";
import type { AiSummaryResult } from "../src/aiClient";

const summary: AiSummaryResult = {
  status: "ready",
  generatedAt: new Date().toISOString(),
  model: "minimax-m3",
  text: "ในคลิปนี้เห็นบ้านไม้หลังคาสังกะสี เตียงไม้เก่า ๒ ตัว ปูเสื่อซีดจนเหลือง",
  visualDescription: "บ้านไม้ชั้นเดียว หลังคาสังกะสี เตียงไม้เก่า ๒ ตัว มีหมอกในตอนเช้า",
  sceneInventory: [],
  place: {
    place_name: "บ้านป่าย",
    community: "บ้านปาย",
    location: { province: "เพร่", district: "บ้านปาย", subdistrict: "บ้านปาย" },
    atmosphere: "บ้านไม้เก่าแก่ท่ามกลางธรรมชาติ",
    category: ["โฮมสเตย์"],
    activities: ["นอนพัก"],
    price_info: { weekday: "700 บาท รวมอาหารเย็นและอาหารเช้า", weekend: null, currency: "THB" },
    contact: { phone: "081-234-5678", facebook: null, line: null, website: null },
    opening_hours: "ตั้งแต่ 15:00 น.",
    capacity: { rooms: "3", guests_per_room: "1-2", max_guests: "4-6", beds: null },
    rules: ["รับวันละ 1 กลุ่ม", "ทุกคนที่มาพักต้องช่วยกันทำเตาไฟ"],
    areas: ["โซนเจ้าบ้าน"],
    facilities: ["ระเบียง", "กองไฟ"],
    otop_products: [],
    highlights: ["เตียงไม้หลังเก่า"],
    tags: ["#บ้านปาย"],
  },
};

const cases: { name: string; corrections: ProofreadCorrections }[] = [
  {
    name: "สะกดผิดในข้อความ → ต้องแก้",
    corrections: {
      summary: "ในคลิปนี้เห็นบ้านไม้หลังคาสังกะสี เตียงไม้เก่า 2 ตัว ปูเสื่อซีดจนเหลือง",
      place_name: "บ้านปาย",
    },
  },
  {
    name: "ชื่อสถานที่สะกดผิด → ต้องแก้",
    corrections: { place_name: "บ้านปาย" },
  },
  {
    name: "ชื่อสถานที่ถูก แต่โมเดลอยากเปลี่ยนเป็นคนละคำ → ต้องไม่ผ่าน",
    corrections: { place_name: "บ้านหลวง" },
  },
  {
    name: "ราคาขยับ 700 → 7,000 → ต้องไม่ผ่าน",
    corrections: { price_weekday: "7,000 บาท รวมอาหารเย็นและอาหารเช้า" },
  },
  {
    name: "ความจุขยับ 4-6 → 6-8 → ต้องไม่ผ่าน",
    corrections: { capacity_max_guests: "6-8" },
  },
  {
    name: "เบอร์โทรขยับ → ต้องไม่ผ่าน",
    corrections: { phone: "089-999-9999" },
  },
  {
    name: "จังหวัดสะกดผิด → ต้องแก้",
    corrections: { province: "แพร่" },
  },
  {
    name: "รายการหายไป 1 ข้อ → ต้องไม่ผ่าน",
    corrections: { facilities: ["ระเบียง"] },
  },
  {
    name: "รายการเพิ่มขึ้น 1 ข้อ → ต้องไม่ผ่าน",
    corrections: { rules: ["รับวันละ 1 กลุ่ม", "ทุกคนที่มาพักต้องช่วยกันทำเตาไฟ", "ห้ามสูบบุหรี่"] },
  },
  {
    name: "เติมค่าที่เดิมไม่มี (เว็บไซต์) → ต้องไม่ผ่าน",
    corrections: { website: "https://example.com" },
  },
];

console.log("=== proofread guard check ===\n");
for (const c of cases) {
  const out = applyProofreadToSummary(summary, c.corrections);
  const place = out.place!;
  const before = {
    summary: summary.text,
    place_name: summary.place!.place_name,
    price: summary.place!.price_info.weekday,
    max_guests: summary.place!.capacity?.max_guests,
    phone: summary.place!.contact.phone,
    province: summary.place!.location.province,
    rules: (summary.place!.rules ?? []).join(" | "),
    facilities: (summary.place!.facilities ?? []).join(" | "),
  };
  const after = {
    summary: out.text,
    place_name: place.place_name,
    price: place.price_info.weekday,
    max_guests: place.capacity?.max_guests,
    phone: place.contact.phone,
    province: place.location.province,
    rules: (place.rules ?? []).join(" | "),
    facilities: (place.facilities ?? []).join(" | "),
  };
  const changed = Object.keys(before).filter((k) => before[k as keyof typeof before] !== after[k as keyof typeof after]);
  console.log(`— ${c.name}`);
  if (changed.length === 0) {
    console.log("   ผ่านเข้า: ไม่มี (ข้อมูลคงเดิม)");
  } else {
    changed.forEach((k) => {
      console.log(`   ${k}: ${before[k as keyof typeof before]} → ${after[k as keyof typeof after]}`);
    });
  }
  console.log("");
}
