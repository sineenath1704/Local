/**
 * Offline check of the narration prompt — no network, no keys.
 * Prints what the narrator actually receives for a clip like the homestay one.
 */
import { buildNarrationPrompt, SUMMARY_NARRATION_PROMPT } from "../src/prompt";

const fake = {
  place: {
    place_name: "บ้านไม้บ้านปาย",
    community: "บ้านปาย",
    location: { province: "แพร่", district: "บ้านปาย", subdistrict: "บ้านปาย" },
    atmosphere: "บ้านไม้เก่าแก่ท่ามกลางธรรมชาติ มีหมอกในตอนเช้า",
    visual_description:
      "บ้านไม้ชั้นเดียวหลังคา สั่นไหว เตียงไม้เก่า มีผ้านอนลาย หมอกพุ่งเข้ามาในห้อง",
    scene_inventory: [
      { item: "หลังคาสังกะสี", material: "สังกะสี", count: "1", condition: "เก่า สีน้ำตาลไหม้ที่ขอบ", position: "บนหลังบ้าน" },
      { item: "เตียงไม้", material: "ไม้เนื้อแข็ง", count: "2", condition: "เก่า มีขาสี่ขา ยังแข็งแรง", position: "กลางห้องนอน" },
      { item: "ปูเสื่อ", material: "ผ้า", count: "2 ชั้น", condition: "ซีดจนเหลือง", position: "บนเตียง" },
      { item: "หมอนผ้า", material: "ผ้า", count: "1", condition: "เก่า ปลอมหนึ่งใบ", position: "หัวเตียง" },
      { item: "โต๊ะไม้", material: "ไม้", count: "1", condition: "ผิวไม้ทาแล้วเป็นเงา", position: "ริมหน้าต่าง" },
      { item: "แก้วน้ำ", material: "แก้ว", count: "2", condition: "สะอาด", position: "บนโต๊ะ" },
      { item: "กองไฟ", material: "อิฐ", count: "1", condition: "เก่า วางเป็นวงกลม", position: "มุมห้อง" },
      { item: "เครื่องชงกาแฟ", material: "แก้วและโลหะ", count: "1", condition: "เก่า มีรอยที่ก้น", position: "บนเคาน์เตอร์" },
    ],
    activities: ["นอนพัก", "ทำอาหาร"],
    highlights: ["เตียงไม้หลังเก่า", "หมอกเข้าห้อง"],
    otop_products: ["ผ้าทอมือ"],
    tags: ["#บ้านปาย"],
    price_info: { weekday: "700 บาท รวมอาหารเย็นและอาหารเช้า", weekend: null, currency: "THB" },
    contact: { phone: null, facebook: null, line: null, website: null },
    opening_hours: null,
    capacity: { rooms: "3", guests_per_room: "1-2", max_guests: "4-6", beds: null },
    rules: ["รับวันละ 1 กลุ่ม", "ทุกคนที่มาพักต้องช่วยกันทำเตาไฟ"],
    areas: ["โซนเจ้าบ้าน", "โซนคาเฟ่"],
    facilities: ["ระเบียง", "กองไฟ"],
    summary: "คลิปนี้พามาปักหมุดกันที่บ้านไม้ในชุมชนบ้านปาย",
  },
  visualDescription: "บ้านไม้ชั้นเดียวหลังคา สั่นไหว เตียงไม้เก่า",
  sceneInventory: [
    { item: "หลังคาสังกะสี", material: "สังกะสี", count: "1", condition: "เก่า สีน้ำตาลไหม้ที่ขอบ", position: "บนหลังบ้าน" },
    { item: "เตียงไม้", material: "ไม้เนื้อแข็ง", count: "2", condition: "เก่า มีขาสี่ขา ยังแข็งแรง", position: "กลางห้องนอน" },
    { item: "ปูเสื่อ", material: "ผ้า", count: "2 ชั้น", condition: "ซีดจนเหลือง", position: "บนเตียง" },
    { item: "หมอนผ้า", material: "ผ้า", count: "1", condition: "เก่า ปลอมหนึ่งใบ", position: "หัวเตียง" },
    { item: "โต๊ะไม้", material: "ไม้", count: "1", condition: "ผิวไม้ทาแล้วเป็นเงา", position: "ริมหน้าต่าง" },
    { item: "แก้วน้ำ", material: "แก้ว", count: "2", condition: "สะอาด", position: "บนโต๊ะ" },
    { item: "กองไฟ", material: "อิฐ", count: "1", condition: "เก่า วางเป็นวงกลม", position: "มุมห้อง" },
    { item: "เครื่องชงกาแฟ", material: "แก้วและโลหะ", count: "1", condition: "เก่า มีรอยที่ก้น", position: "บนเคาน์เตอร์" },
  ],
  text: "คลิปนี้พามาปักหมุดกันที่บ้านไม้ในชุมชนบ้านปาย",
};

console.log("=== what the narrator receives ===");
console.log(buildNarrationPrompt(fake));
console.log("\n=== paragraph rules in the system prompt ===");
const rules = SUMMARY_NARRATION_PROMPT.split("\n").filter((l) =>
  /ย่อหน้า/.test(l)
);
rules.forEach((l) => console.log("  " + l));
