/**
 * พิมพ์การ์ดตัวอย่างเป็นข้อความล้วน (ตามที่ caption/แชทอ่าน)
 * ใช้เช็คเรียงหัวข้อ + emoji ตามประเภทสถานที่
 *
 * ข้อมูลตัวอย่างตรงกับ `EXTRACTION_SCHEMA` ใน `prompt.ts` (สายการ์ด)
 * → ถ้าแก้ schema ต้องแก้ไฟล์นี้ด้วย
 */
import { validateExtraction, buildPostCard, renderPostText } from "../src/videoPromptV2";

const HOMESTAY = {
  core: {
    place_name: "โฮมสเตยบ้านน้ำไหลเขา",
    community: "หมู่บ้านห้วยหอม",
    location: { province: "แม่ฮ่องสอน", district: "แมล่าน้อย", subdistrict: "ห้วยหอม" },
    category: ["ที่พัก"],
    overview:
      "บ้านไม้ชั้นเดียวยกใต้ถุน หลังคามุงกระเบื้องไม้ ตั้งอยู่กลางหมู่บ้านห้วยหอม " +
      "ด้านหน้ามีระเบียงไม้ไผ่ที่มองเห็นทุ่งนาและหมู่บ้าน ช่วงเช้ามีหมอกบางปกคลุมทุ่งจนมองไม่เห็น " +
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
    restrictions: ["รับวันละ 1 กลุ่ม", "ทุกคนที่มาพักต้องช่วยกันทำกองไฟ"],
    activities: ["พักค้างคืน", "ปิงไฟ"],
    views: ["วิวทะเลหมอก"],
    highlights: ["วิวทะเลหมอกยามเช้า", "มีกองไฟกลางหมู่บ้าน"],
    tags: ["แม่ฮ่องสอน", "พักค้างคืน"],
  },
  stay: {
    room_types: [
      {
        name: "ห้องเล็ก",
        count: "1",
        capacity: "1-3",
        beds: "เตียงเดี่ยว 1",
        bathroom: "ห้องน้ำรวม",
      },
      {
        name: "ห้องใหญ่",
        count: "2",
        capacity: "4-6",
        beds: "เตียงเดี่ยว 2",
        bathroom: "ห้องน้ำรวม",
      },
    ],
    bedding: "นอนพื้น ปูเสื่อ ที่นอนมีผ้าห่ม",
    mosquito_net: "มีมุ้งกันยุง",
    facilities: ["มีเตาไฟ", "มีพัดลม"],
    services: ["มีน้ำร้อน", "มีชา/กาแฟ"],
  },
  food: null,
  activity: {
    what_you_do: "พักค้างคืน ชมวิวภูเขาและหมู่บ้าน ปิงไฟ",
    duration: "2 วัน 1 คืน",
    min_max_people: "2-10 คน",
    take_home: "เก็บผลไม้กลับได้",
    need_booking: "ต้องจองล่วงหน้า 3 วัน",
  },
  otop: null,
  access: {
    road_condition: "ถนนลูกรังช่วงท้าย",
    vehicle_advice: "แนะนำรถยนต์ 4 ล้อ",
    walk_required: "เดินเข้าซอยอีก 5 นาที",
    parking: "จอดรถหน้าบ้านได้ 2 คัน",
  },
  confidence: {
    overall: 0.82,
    per_module: { stay: 0.9, food: 0, activity: 0.8, otop: 0 },
    conflicts: [],
    missing_info: [],
    source_used: ["audio_transcript", "on_screen_text"],
  },
};

const CAFE = {
  core: {
    place_name: "คาเฟมะลิ",
    community: "บ้านปาย",
    location: { province: "เชียงราย", district: "แม่สาย", subdistrict: "บ้านปาย" },
    category: ["คาเฟ", "ร้านอาหาร"],
    overview:
      "คาเฟเล็กตัวร้านเป็นศาลาไม้ไผ่ 1 หลัง หลังคามุงใบตองตึง ตั้งอยู่ในหมู่บ้านปาย " +
      "ด้านในมีโต๊ะไม้กลมเตี้ยวางเรียงริมลำธาร แสงเช้าลอดใบไม้เป็นลายบนพื้นไม้ " +
      "เหมาะกับคนที่อยากนั่งชิลยาวดูวิวทะเลหมอกในช่วงเช้า",
    price: {
      weekday: "60",
      weekend: null,
      unit: "ต่อคน",
      currency: "THB",
      inclusions: [],
    },
    opening_hours: "08:00-17:00",
    contact: { phone: null, facebook: "cafe.mali", line: null },
    restrictions: [],
    activities: ["นั่งดูวิว"],
    views: [],
    highlights: ["วิวทะเลหมอกชัดในช่วงเช้า"],
    tags: ["เชียงราย", "คาเฟ"],
  },
  stay: null,
  food: {
    menu_highlights: ["กาแฟมะลิ", "ขนมปังปิง"],
    price_from: "60",
    seating: "นั่งได้ 10 ที่",
    payment: ["โอนเงิน", "เงินสด"],
  },
  activity: null,
  otop: null,
  access: null,
  confidence: {
    overall: 0.75,
    per_module: { stay: 0, food: 0.8, activity: 0, otop: 0 },
    conflicts: [],
    missing_info: [],
    source_used: ["audio_transcript", "on_screen_text"],
  },
};

const WORKSHOP = {
  core: {
    place_name: "ชุมชมทอผ้าสไตล์พื้นเมืองบ้านแม่ลา",
    community: "บ้านแม่ลา",
    location: { province: "เชียงราย", district: "แม่สาย", subdistrict: "แม่ลา" },
    category: ["กิจกรรม", "OTOP", "หัตถกรรม"],
    overview:
      "ห้องถักสานในบ้านไม้ มีโต๊ะถักยาวเรียงริมหน้าต่าง แสงเช้าส่องเข้ามาทางช่องไม้หน้าต่าง " +
      "อาจารย์สอนตั้งแต่เริ่มจากการเลือกเส้นด้าย จบแล้วได้ผ้าผืนกลับไปเอง 1 ผืน",
    price: {
      weekday: "350",
      weekend: null,
      unit: "ต่อคน",
      currency: "THB",
      inclusions: ["ผ้าฝ้ายสำหรับถัก", "อาหารกลางวัน"],
    },
    opening_hours: "09:00-16:00",
    contact: { phone: "08-9876-5432", facebook: "maela.weaving", line: null },
    restrictions: ["ต้องจองล่วงหน้า 2 วัน", "เด็กต่ำกว่า 10 ปี ต้องมาผู้ปกครองมาด้วย"],
    activities: ["ถักผ้า", "ย้อมผ้าด้วยวัสดุธรรมชาติ"],
    views: [],
    highlights: ["มีผ้าทอมือขายในชุมชน"],
    tags: ["เชียงราย", "ถักผ้า", "OTOP"],
  },
  stay: null,
  food: null,
  activity: {
    what_you_do: "ทอผ้าสไตล์พื้นเมือง",
    duration: "ครึ่งวัน",
    min_max_people: "2-6 คน",
    take_home: "ผ้าผืนที่ถักเอง 1 ผืน",
    need_booking: "ต้องจองล่วงหน้า 2 วัน",
  },
  otop: {
    products: [
      { name: "ผ้าถักมือลายพื้นเมือง", price: "350-800 บาท/ผืน", note: null },
      { name: "ผ้าย้อมคราม", price: "450 บาท/ผืน", note: "สีจากใบครามในหมู่บ้าน" },
    ],
    can_buy_on_site: "ได้ที่ห้องจำหน่ายของชุมชม",
    can_try_making: "ถักเองได้ในคลาส",
  },
  access: {
    road_condition: "ถนนลูกรังช่วงท้าย",
    vehicle_advice: "รถยนต์เล็กเข้าได้ รถบัสไม่เข้า",
    walk_required: "เดินจากถนนใหญ่เข้าซอย 3 นาที",
    parking: "มีที่จอดรถหน้าศาลาประชุม 10 คัน",
  },
  confidence: {
    overall: 0.88,
    per_module: { stay: 0, food: 0, activity: 0.9, otop: 0.9 },
    conflicts: [],
    missing_info: [],
    source_used: ["audio_transcript", "on_screen_text"],
  },
};

/**
 * ข้อมูลเส้นทางจาก Google Routes (backend ดึงเองหลังโมเดลตอบ
 * → ดู `src/googleMaps.ts`)
 */
const GOOGLE_MAP = {
  lat: 18.14,
  lon: 97.93,
  routeKm: 8.6,
  routeMinutes: 15,
  routeFrom: "ตัวอำเภอแม่สาย",
  routeVia: "ทางหลวงชนบท 1081",
  hasToll: null,
  trafficDelaySec: 0,
  // เวลาเปิด-ปิด (มาพร้อมพิกัดจาก Google Places — ดู `src/googleMaps.ts`)
  openingHours: {
    openNow: true,
    weekdayText: [
      "จันทร์: 08:00–17:00",
      "อังคาร: 08:00–17:00",
      "พุธ: 08:00–17:00",
      "พฤหัสบดี: 08:00–17:00",
      "ศุกร์: 08:00–18:00",
      "เสาร์: 08:00–18:00",
      "อาทิตย์: 08:00–18:00",
    ],
  },
  credit: "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform",
};

/**
 * สถานที่ใกล้เคียงจาก Google Places (Nearby Search)
 * ── backend ดึงเองหลังโมเดลตอบ → ดู `src/googleMaps.ts`
 */
const GOOGLE_NEARBY = [
  { name: "วัดป่าแตง", label: "วัด", distanceKm: 2.4, rating: 4.6 },
  { name: "ตลาดน้ำไหล", label: "จุดท่องเที่ยว", distanceKm: 3.1, rating: 4.3 },
  { name: "อุทยานแม่สาย", label: "จุดธรรมชาติ", distanceKm: 5.8, rating: 4.5 },
];

for (const [label, raw, map, nearby] of [
  ["โฮมสเตย (ที่พัก)", HOMESTAY, GOOGLE_MAP, GOOGLE_NEARBY],
  ["คาเฟ (ร้านอาหาร)", CAFE, null, GOOGLE_NEARBY],
  ["กิจกรรม/OTOP (ถักผ้า)", WORKSHOP, null, null],
] as const) {
  const data = validateExtraction(raw).data;
  const card = buildPostCard(data, map, nearby);
  console.log("\n" + "═".repeat(60));
  console.log("▶ " + label);
  console.log("═".repeat(60));
  console.log(renderPostText(card));
}
