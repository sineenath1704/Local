/**
 * ตรวจสายสรุปวิดีโอ V2 — รันแบบออฟไลน์ ไม่ต้องมี credential
 * ---------------------------------------------------------------------------
 * ทดสอบ "ตรรกะบริสุทธิ์" ของ V2 ทั้งหมด:
 *   · validateExtraction()  — ตัวเลขที่ไม่มีที่มาจากเสียงพูด / โมดูลว่าง / conflicts
 *   · buildPostCard()       — การ์ดตามหัวข้อ และกติกาที่ตัดหัวข้อที่ไม่มีข้อมูล
 *   · toLegacySummary()     — คีย์เดิมต้องครบและชนิดตรง (แผน §3)
 *   · composePrice/Capacity — รูปแบบ string แบบเดิม
 *   · parseModelJson()      — โมเดลตอบมามีข้อความนำหน้า/ท้าย
 *
 * ไม่ยิงเครือข่าย ไม่ยิงโมเดล ไม่แตะฐานข้อมูล
 *
 * ใช้
 *   cd backend
 *   npm run test:vca2
 */

import {
  validateExtraction,
  buildPostCard,
  renderPostText,
  type V2Extraction,
  type PostCard,
  type PostCardBlock,
} from "../src/videoPromptV2";
import type { VideoAnalysisInput } from "../src/prompt";
import { applyProofreadToCard } from "../src/thaiProofread";
import {
  parseModelJson,
  composePrice,
  composeCapacity,
  toLegacySummary,
} from "../src/videoPromptV2Compat";

// ── ตัวช่วยตรวจ ────────────────────────────────────────────────
let failed = 0;
let passed = 0;

function expect(label: string, actual: unknown, want: unknown) {
  const a = JSON.stringify(actual);
  const w = JSON.stringify(want);
  const ok = a === w;
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? "✅" : "❌"} ${label}: ${a}${ok ? "" : `  (คาดว่า ${w})`}`
  );
}

function expectTrue(label: string, actual: boolean) {
  expect(label, actual, true);
}

function section(title: string) {
  console.log(`\n— ${title} —`);
}

// ── ข้อมูลตัวอย่าง 1: โฮมสเตย (มีที่พัก ไม่มีร้านอาหาร) ──────────
const HOMESTAY_RAW = {
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
      { name: "ห้องเล็ก", count: "1", capacity: "1-3", beds: "เตียงเดี่ยว 1", bathroom: "ห้องน้ำรวม" },
      { name: "ห้องใหญ่", count: "2", capacity: "4-6", beds: "เตียงเดี่ยว 2", bathroom: "ห้องน้ำรวม" },
    ],
    bedding: "เตียงเดี่ยว 3 เตียง",
    mosquito_net: "มีมุ้งกันยุง",
    facilities: ["มีเตาไฟ"],
    services: ["มีน้ำร้อน"],
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
    source_used: ["audio_transcript"],
  },
};

const TRANSCRIPT =
  "ที่นี่โฮมสเตยบ้านน้ำไหลเขา อยู่หมู่บ้านห้วยหอม อำเภอแมล่าน้อย จังหวัดแม่ฮ่องสอน " +
  "ราคาคนละ 700 บาท รวมอาหารเย็นกับอาหารเช้า ทั้งวันธรรมดากับวันหยุดเท่ากัน " +
  "มีห้องเล็ก 1 ห้อง นอนได้ 1 ถึง 3 คน ห้องใหญ่ 2 ห้อง นอนได้ 4 ถึง 6 คน " +
  "มีเตียงเดี่ยว 3 เตียง มีมุ้งกันยุง เดินเข้าซอยอีก 5 นาที " +
  "ติดต่อโทร 08-1234-5678 เปิด 08:00 ถึง 18:00 รับวันละ 1 กลุ่ม";

const INPUT: VideoAnalysisInput = {
  caption: "พักห้วยหอม",
  transcript: TRANSCRIPT,
  audioType: "speech",
  onScreenText: ["ราคา 700 บาท/คน"],
  visualDescription: "บ้านไม้หลังใหญ่ มีระเบียงชมวิว",
  videoDurationSec: 45,
  uploaderType: "tourist",
  location: "หมู่บ้านห้วยหอม",
};

// ── ข้อมูลตัวอย่าง 2: คาเฟ (มีอะไรกิน ไม่มีที่พัก) ────────────────
const CAFE_RAW = {
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

// ============================================================
//  1. parseModelJson
// ============================================================
section("1. อ่าน JSON จากคำตอบของโมเดล");
expect("JSON ตรง ๆ", parseModelJson('{"a":1}'), { a: 1 });
expect("JSON มีข้อความนำหน้า", parseModelJson('ได้เลยครับ\n{"a":1}'), { a: 1 });
expect("JSON มีข้อความท้าย", parseModelJson('{"a":1}\nหวังว่าจะมีประโยชน์'), { a: 1 });
expect("ไม่ใช่ JSON → null", parseModelJson("ไม่มีข้อมูลเลย"), null);

// ============================================================
//  2. validateExtraction
// ============================================================
section("2. ตรวจข้อมูลด้วยโค้ด (V1–V7)");
{
  const v = validateExtraction(HOMESTAY_RAW, { transcript: TRANSCRIPT });
  expect("ตัวเลขในเสียงพูด → ไม่มีคำเตือน", v.warnings.length, 0);
  expect("โมดูลอาหารที่ไม่มีข้อมูล → null", v.data.food, null);
  expect("โมดูลที่พักยังอยู่", v.data.stay !== null, true);
  expect("confidence.warning เป็น null เมื่อไม่มีปัญหา", v.data.confidence.warning, null);
}

{
  // V1 — ตัวเลขที่ไม่มีที่มาจากเสียงพูด → เตือน แต่ "ไม่ลบ" (ค่ายังอยู่)
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.core.price.weekday = "9999";
  const v = validateExtraction(raw, { transcript: TRANSCRIPT });
  expectTrue("V1: เตือนเมื่อตัวเลขไม่พบในเสียงพูด", v.warnings.length > 0);
  expect("V1: ค่ายังอยู่ (ไม่ลบทิ้ง)", v.data.core.price.weekday, "9999");
  expectTrue("V1: ลงใน missing_info ด้วย", v.missing.length > 0);
}

{
  // V3 — จำนวนห้องที่ไม่ใช่ตัวเลข
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.stay.room_types[0].count = "ห้องเดียว";
  const v = validateExtraction(raw, { transcript: TRANSCRIPT });
  expectTrue("V3: จำนวนห้องที่ไม่ใช่ตัวเลข → conflicts", v.conflicts.length > 0);
}

{
  // V6 — ราคาที่ไม่ใช่ตัวเลข
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.core.price.weekday = "ราคาคุยกันได้";
  const v = validateExtraction(raw, { transcript: TRANSCRIPT });
  expectTrue("V6: ราคาที่ไม่ใช่ตัวเลข → conflicts", v.conflicts.length > 0);
}

{
  // V2 — โมดูลที่กรอกแล้วว่างเปล่า → null
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.food = { menu_highlights: [], price_from: null, seating: null, payment: [] };
  const v = validateExtraction(raw, { transcript: TRANSCRIPT });
  expect("V2: โมดูลว่าง → null", v.data.food, null);
}

{
  // V4 — conflicts จากโมเดลต้องไปโผล่ในการ์ด
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.confidence.conflicts = ["เสียงพูดว่าราคา 700 แต่ป้ายในคลิปเขียน 750"];
  const v = validateExtraction(raw, { transcript: TRANSCRIPT });
  const card = buildPostCard(v.data, null);
  const know = (card.blocks ?? []).find((b) => b.title === "ต้องรู้ก่อนไป");
  expectTrue("V4: มีหัวข้อ 'ต้องรู้ก่อนไป'", Boolean(know));
  expectTrue(
    "V4: ข้อขัดแย้งโผล่ในการ์ด",
    Boolean(know && know.lines.some((l) => l.kind === "warn" && l.text.includes("750")))
  );
}

// ============================================================
//  3. การ์ด (รูปแบบข้อความล้วน — ไม่มีไอคอน)
// ============================================================
section("3. การ์ดหน้าโพสต์");
const homeData: V2Extraction = validateExtraction(HOMESTAY_RAW, {
  transcript: TRANSCRIPT,
}).data;
const homeCard = buildPostCard(homeData, null);

/** สถานที่ใกล้เคียงที่ backend ดึงจาก Google Places (Nearby Search) */
const GOOGLE_NEARBY = [
  { name: "วัดป่าแตง", label: "วัด", distanceKm: 2.4, rating: 4.6, lat: 18.11, lon: 97.71 },
  { name: "ตลาดน้ำไหล", label: "จุดท่องเที่ยว", distanceKm: 3.1, rating: 4.3, lat: 18.12, lon: 97.73 },
];
const homeCardWithNearby = buildPostCard(homeData, null, GOOGLE_NEARBY);
/** การ์ดที่มีทั้งพิกัดสถานที่ในคลิป + สถานที่ใกล้เคียง (ใช้ทดสอบลิงก์) */
const homeCardWithMapAndNearby = buildPostCard(
  homeData,
  { lat: 18.1, lon: 97.7, credit: "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform" },
  GOOGLE_NEARBY
);

/** บล็อกที่มีหัวข้อ */
const blockOf = (card: PostCard, title: string): PostCardBlock | undefined =>
  (card.blocks ?? []).find((b) => b.title === title);
/** บรรทัดข้อเท็จจริงทั้งหมด (รวมทุกบล็อกแบบ facts) */
const factLines = (card: PostCard): string[] =>
  (card.blocks ?? [])
    .filter((x) => x.style === "facts")
    .flatMap((x) => x.lines.map((l) => l.text));

{
  expect(
    "บล็อกของการ์ดโฮมสเตย (เรียงตามที่จะแสดง)",
    homeCard.blocks.map((b) => b.title),
    ["ราคา", "ที่พัก", "ภายในห้องพัก", "ต้องรู้ก่อนไป", "เดินทาง"]
  );
  expect(
    "มีสถานที่ใกล้เคียง → บล็อก 'สถานที่ที่อยู่ใกล้เคียง' อยู่ท้ายสุดของการ์ด",
    homeCardWithNearby.blocks.map((b) => b.title),
    [
      "ราคา",
      "ที่พัก",
      "ภายในห้องพัก",
      "ต้องรู้ก่อนไป",
      "เดินทาง",
      "สถานที่ที่อยู่ใกล้เคียง",
    ]
  );
  expectTrue(
    "ไม่มีไอคอนหน้าบรรทัด (ไม่มี ✔/⚠/ℹ)",
    !/[✔⚠ℹ]/.test(renderPostText(homeCard))
  );
  expectTrue(
    "รายการใช้ bullet นำหน้า",
    renderPostText(homeCardWithNearby).includes("• วัดป่าแตง")
  );
  expect("ชื่อสถานที่ในการ์ด", homeCard.place?.name, "โฮมสเตยบ้านน้ำไหลเขา");
  expectTrue(
    "ที่อยู่รวมชุมชน+ตำบล+อำเภอ+จังหวัด",
    (homeCard.place?.address || "").includes("หมู่บ้านห้วยหอม")
  );
  expect("เบอร์โทรในการ์ด", homeCard.contact?.phone, "08-1234-5678");
  expectTrue(
    "ไม่มีการ์ดรูปแบบเก่า (sections) ปนมา",
    !homeCard.sections
  );
}

{
  // "สถานที่ที่อยู่ใกล้เคียง" = สถานที่ใกล้เคียงจาก Google Places (ไม่ใช่จากโมเดล)
  const near = blockOf(homeCardWithNearby, "สถานที่ที่อยู่ใกล้เคียง");
  expectTrue("มีบล็อก 'สถานที่ที่อยู่ใกล้เคียง'", Boolean(near));
  expect(
    "รูปแบบบรรทัด: ชื่อ · ประเภท · ระยะทาง · คะแนน",
    near?.lines.map((l) => l.text),
    ["วัดป่าแตง · วัด · 2.4 กม. · ★4.6", "ตลาดน้ำไหล · จุดท่องเที่ยว · 3.1 กม. · ★4.3"]
  );
  expectTrue(
    "ไม่มีบล็อกนี้ตอนไม่มีข้อมูล (ไม่ใช่แสดง 'ไม่มีข้อมูล')",
    !blockOf(homeCard, "สถานที่ที่อยู่ใกล้เคียง")
  );
  expect(
    "ทุกบรรทัดมีลิงก์ (จุดเริ่มต้น = สถานที่ในคลิป 18.1,97.7)",
    blockOf(homeCardWithMapAndNearby, "สถานที่ที่อยู่ใกล้เคียง")?.lines.map((l) => l.url),
    [
      "https://www.google.com/maps/dir/?api=1&origin=18.1,97.7&destination=18.11,97.71&travelmode=driving",
      "https://www.google.com/maps/dir/?api=1&origin=18.1,97.7&destination=18.12,97.73&travelmode=driving",
    ]
  );
  expectTrue(
    "ไม่รู้พิกัดจุดเริ่มต้น → ยังได้ลิงก์ค้นหาสถานที่ (ไม่ทิ้งบรรทัด)",
    Boolean(
      blockOf(homeCardWithNearby, "สถานที่ที่อยู่ใกล้เคียง")?.lines.every((l) =>
        (l.url ?? "").startsWith("https://www.google.com/maps/")
      )
    )
  );
}

{
  // คำบรรยายรวม (core.overview) → ใต้ชื่อสถานที่
  expect(
    "คำบรรยายรวมในการ์ด",
    homeCard.place?.description,
    homeData.core.overview
  );
  expectTrue("ไม่มีแท็กไลน์แยกอีกแล้ว", !homeCard.place?.tagline);
}

{
  // เวลาเปิด-ปิด = ข้อมูลจาก Google Places (มาพร้อมพิกัด)
  // ตารางเดียวกันทุกวัน → คำว่า "วันนี้" ได้เวลาเดียวกันเสมอ (ทดสอบได้ทุกวัน)
  const SAME_ALL_DAY = [
    "จันทร์: 08:00–17:00",
    "อังคาร: 08:00–17:00",
    "พุธ: 08:00–17:00",
    "พฤหัสบดี: 08:00–17:00",
    "ศุกร์: 08:00–17:00",
    "เสาร์: 08:00–17:00",
    "อาทิตย์: 08:00–17:00",
  ];
  const GOOGLE_HOURS = {
    lat: 18.1,
    lon: 97.7,
    openingHours: { openNow: true, weekdayText: SAME_ALL_DAY },
    credit: "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform",
  };
  const cardWithHours = buildPostCard(homeData, GOOGLE_HOURS, GOOGLE_NEARBY);
  const hours = blockOf(cardWithHours, "เวลาเปิด");

  expectTrue("มีบล็อก 'เวลาเปิด' เมื่อ Google มีข้อมูล", Boolean(hours));
  expect(
    "บรรทัดแรกบอกว่าเปิดอยู่ตอนนี้",
    hours?.lines[0]?.text,
    "เปิดอยู่ตอนนี้ · วันนี้ 08:00–17:00"
  );
  expect(
    "วันที่เวลาเหมือนกัน → รวมเป็นช่วงเดียว",
    hours?.lines.slice(1).map((l) => l.text),
    ["จันทร์–อาทิตย์: 08:00–17:00"]
  );
  expect(
    "บล็อก 'เวลาเปิด' อยู่ระหว่างข้อมูลกลุ่มกับ 'ต้องรู้ก่อนไป'",
    cardWithHours.blocks.map((b) => b.title),
    [
      "ราคา",
      "ที่พัก",
      "ภายในห้องพัก",
      "เวลาเปิด",
      "ต้องรู้ก่อนไป",
      "เดินทาง",
      "สถานที่ที่อยู่ใกล้เคียง",
    ]
  );
  expectTrue(
    "ไม่พูดซ้ำ 'เปิด 08:00-18:00' ที่ 'ต้องรู้ก่อนไป' (Google มีข้อมูลแล้ว)",
    !(blockOf(cardWithHours, "ต้องรู้ก่อนไป")?.lines ?? []).some((l) =>
      l.text.includes("08:00-18:00")
    )
  );
  expectTrue(
    "ไม่มีบล็อก 'เวลาเปิด' ตอนที่ Google ไม่มีข้อมูล",
    !blockOf(homeCard, "เวลาเปิด")
  );
  expectTrue(
    "Google ไม่มีข้อมูล → ใช้เวลาเปิดที่โมเดลอ่านมาจากคลิป",
    (blockOf(homeCard, "ต้องรู้ก่อนไป")?.lines ?? []).some(
      (l) => l.text === "เปิด 08:00-18:00"
    )
  );
  expect(
    "ปิดอยู่ตอนนี้ → บอกตรง ๆ",
    blockOf(
      buildPostCard(homeData, {
        ...GOOGLE_HOURS,
        openingHours: { openNow: false, weekdayText: SAME_ALL_DAY },
      }),
      "เวลาเปิด"
    )?.lines[0]?.text,
    "ปิดอยู่ตอนนี้ · วันนี้ 08:00–17:00"
  );
  expect(
    "ตารางไม่เหมือนกัน → แยกเป็นช่วงตามเวลาจริง",
    blockOf(
      buildPostCard(homeData, {
        ...GOOGLE_HOURS,
        openingHours: {
          openNow: true,
          weekdayText: [
            "จันทร์: 08:00–17:00",
            "อังคาร: 08:00–17:00",
            "พุธ: 08:00–17:00",
            "พฤหัสบดี: 08:00–17:00",
            "ศุกร์: 08:00–17:00",
            "เสาร์: 08:00–18:00",
            "อาทิตย์: ปิด",
          ],
        },
      }),
      "เวลาเปิด"
    )?.lines.slice(1).map((l) => l.text),
    ["จันทร์–ศุกร์: 08:00–17:00", "เสาร์: 08:00–18:00", "อาทิตย์: ปิด"]
  );
}

{
  // ราคา / ที่พัก / ภายในห้องพัก = หัวข้อจริง มีรายละเอียดของตัวเอง
  const priceBlock = blockOf(homeCard, "ราคา");
  const stayBlock = blockOf(homeCard, "ที่พัก");
  const roomInside = blockOf(homeCard, "ภายในห้องพัก");
  expectTrue("มีบล็อกหัวข้อ 'ราคา'", Boolean(priceBlock));
  expectTrue("มีบล็อกหัวข้อ 'ที่พัก'", Boolean(stayBlock));
  expectTrue("มีบล็อกหัวข้อ 'ภายในห้องพัก'", Boolean(roomInside));
  expectTrue(
    "ราคาอยู่ในบล็อก 'ราคา'",
    Boolean(priceBlock?.lines.some((l) => l.text.includes("700/คน")))
  );
  expectTrue(
    "ราคาเท่ากันทั้งสองวัน (V7) — โค้ดเติมเอง",
    Boolean(priceBlock?.lines.some((l) => l.text.includes("เท่ากันทั้งวันธรรมดาและวันหยุด")))
  );
  expectTrue(
    "สิ่งที่รวมในราคาอยู่บรรทัดเดียวกัน",
    Boolean(priceBlock?.lines.some((l) => l.text.includes("รวมอาหารเย็นและอาหารเช้า")))
  );
  expectTrue(
    "หัวข้อ 'ราคา' ไม่ซ้ำคำว่าราคาในบรรทัด",
    !(priceBlock?.lines ?? []).some((l) => l.text.startsWith("ราคา "))
  );
  expectTrue(
    "เวลาเปิดไม่อยู่ใต้หัวข้อราคา (ไปอยู่ใน 'ต้องรู้ก่อนไป')",
    !(priceBlock?.lines ?? []).some((l) => l.text.includes("เปิด 08:00-18:00"))
  );
  expectTrue(
    "เตียงอยู่ติดกับห้องของมัน",
    Boolean(
      stayBlock?.lines.some((l) =>
        l.text.includes("ห้องเล็ก 1 ห้อง (1-3 คน) · เตียงเดี่ยว 1 · ห้องน้ำรวม")
      )
    )
  );
  expectTrue(
    "ห้องน้ำไม่ซ้ำกับสิ่งอำนวยความสะดวก",
    !(roomInside?.lines ?? []).some((l) => l.text.startsWith("ห้องน้ำรวม"))
  );
  expect(
    "ภายในห้องพัก = 3 หมวด (ที่นอน / ของในห้อง / บริการ) หมวดละหนึ่งบรรทัด",
    roomInside?.lines.map((l) => l.text),
    [
      "ที่นอน: เตียงเดี่ยว 3 เตียง",
      "ของในห้อง: มีมุ้งกันยุง · มีเตาไฟ",
      "บริการ: มีน้ำร้อน",
    ]
  );
  expectTrue(
    "ไม่มีหัวข้อ 'ทำอะไรได้' ในการ์ดแล้ว",
    !blockOf(homeCard, "ทำอะไรได้") &&
      !renderPostText(homeCard).includes("ทำอะไรได้")
  );
  expectTrue(
    "เนื้อหาของ 'ทำอะไรได้' ย้ายไปอยู่ใน 'ต้องรู้ก่อนไป'",
    Boolean(
      blockOf(homeCard, "ต้องรู้ก่อนไป")?.lines.some(
        (l) =>
          l.text === "พักค้างคืน ชมวิวภูเขาและหมู่บ้าน ปิงไฟ" ||
          l.text === "ใช้เวลา 2 วัน 1 คืน" ||
          l.text === "รับ 2-10 คน" ||
          l.text === "เก็บผลไม้กลับได้"
      )
    )
  );
}

{
  // "ภายในห้องพัก" — บอกให้ชัดว่านอนบนอะไร มีเตียงไหม และในห้องมีอะไรให้บริการ
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.stay.bedding = "นอนบนฟูกปูเสื่อ";
  raw.stay.facilities = ["มีน้ำร้อน", "มีที่จอดรถหน้าบ้าน"];
  raw.stay.services = [];
  const card = buildPostCard(validateExtraction(raw).data, null);
  const room = blockOf(card, "ภายในห้องพัก");
  expect(
    "นอนบนฟูก/เสื่อ → โค้ดเติม 'ไม่มีเตียง' ให้ชัด + แยกหมวดของ/บริการ",
    room?.lines.map((l) => l.text),
    [
      "ที่นอน: นอนบนฟูกปูเสื่อ · ไม่มีเตียง",
      "ของในห้อง: มีมุ้งกันยุง",
      "บริการ: มีน้ำร้อน",
    ]
  );
  expectTrue(
    "ที่จอดรถไม่ใช่ของในห้อง → ไปอยู่หัวข้อ 'เดินทาง' แทน",
    !(room?.lines ?? []).some((l) => l.text.includes("จอดรถ")) &&
      Boolean(
        blockOf(card, "เดินทาง")?.lines.some((l) =>
          l.text.includes("มีที่จอดรถหน้าบ้าน")
        )
      )
  );
}

{
  // หมวด "บริการ" — รับจาก stay.services ที่โมเดลแยกมาให้
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.stay.facilities = ["มีพัดลม"];
  raw.stay.services = ["มีผ้าเช็ดตัว", "มีที่ซักผ้า"];
  const card = buildPostCard(validateExtraction(raw).data, null);
  const room = blockOf(card, "ภายในห้องพัก");
  expect(
    "ของในห้อง กับ บริการ แยกหมวดชัดเจน",
    room?.lines.map((l) => l.text),
    [
      "ที่นอน: เตียงเดี่ยว 3 เตียง",
      "ของในห้อง: มีมุ้งกันยุง · มีพัดลม",
      "บริการ: มีผ้าเช็ดตัว · มีที่ซักผ้า",
    ]
  );
  expectTrue(
    "หมวดที่ไม่มีข้อมูล → ไม่ขึ้นบรรทัดเปล่า",
    !(room?.lines ?? []).some((l) => /^(ที่นอน|ของในห้อง|บริการ):\s*$/.test(l.text))
  );
}

{
  // บริการที่โมเดลยัดผิดไว้ใน facilities → โค้ดย้ายเข้าหมวด "บริการ" ให้
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.stay.facilities = ["มีน้ำร้อน", "มีโต๊ะไม้"];
  raw.stay.services = [];
  const card = buildPostCard(validateExtraction(raw).data, null);
  const room = blockOf(card, "ภายในห้องพัก");
  expect(
    "บริการที่โมเดลยัดใน facilities → โค้ดย้ายเข้าหมวด 'บริการ'",
    room?.lines.map((l) => l.text),
    [
      "ที่นอน: เตียงเดี่ยว 3 เตียง",
      "ของในห้อง: มีมุ้งกันยุง · มีโต๊ะไม้",
      "บริการ: มีน้ำร้อน",
    ]
  );
}

{
  // "ต้องรู้ก่อนไป" = กติกา + ข้อจำกัด + ต้องจอง + ถนน
  const know = blockOf(homeCard, "ต้องรู้ก่อนไป");
  expectTrue("มีบล็อก 'ต้องรู้ก่อนไป'", Boolean(know));
  expectTrue(
    "กติกาของที่พักอยู่ในบล็อกนี้",
    Boolean(know?.lines.some((l) => l.text === "รับวันละ 1 กลุ่ม"))
  );
  expectTrue(
    "โมเดลคืน 'ต้องจองล่วงหน้า 3 วัน' → ไม่พูดซ้ำสองรอบ",
    Boolean(know?.lines.some((l) => l.text === "ต้องจองล่วงหน้า 3 วัน"))
  );
  expectTrue(
    "สภาพถนนอยู่ในบล็อกนี้",
    Boolean(know?.lines.some((l) => l.text === "ถนนลูกรังช่วงท้าย"))
  );
  expectTrue(
    "เวลาเปิดอยู่ในบล็อกนี้",
    Boolean(know?.lines.some((l) => l.text === "เปิด 08:00-18:00"))
  );
}

{
  // "ต้องรู้ก่อนไป" — ต้องไม่ซ้ำกับที่การ์ดแสดงไปแล้ว (คำบรรยาย/จุดเด่น/หัวข้ออื่น)
  const know = blockOf(homeCard, "ต้องรู้ก่อนไป");
  expectTrue(
    "บรรทัดที่ซ้ำกับคำบรรยาย + จุดเด่น (กองไฟกลางหมู่บ้าน) → ตัดออก",
    !know?.lines.some((l) => l.text.includes("ทำกองไฟ"))
  );
  expectTrue(
    "บรรทัดที่เพิ่มข้อมูลใหม่ยังอยู่",
    Boolean(know?.lines.some((l) => l.text === "รับวันละ 1 กลุ่ม")) &&
      Boolean(know?.lines.some((l) => l.text === "ถนนลูกรังช่วงท้าย"))
  );
}

{
  // กรองแล้วซ้ำทั้งหมด → ตัดหัวข้อ 'ต้องรู้ก่อนไป' ออกเลย (ไม่เหลือหัวข้อเปล่า)
  const raw = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  raw.core.restrictions = ["มีกองไฟกลางหมู่บ้าน"];
  raw.core.opening_hours = null;
  raw.activity = null;
  raw.access = null;
  const card = buildPostCard(validateExtraction(raw).data, null);
  expectTrue(
    "ทุกบรรทัดซ้ำ → ไม่มีหัวข้อ 'ต้องรู้ก่อนไป'",
    !blockOf(card, "ต้องรู้ก่อนไป")
  );
  expectTrue(
    "หัวข้ออื่นยังอยู่ครบ",
    Boolean(blockOf(card, "ราคา")) && Boolean(blockOf(card, "ภายในห้องพัก"))
  );
}

{
  // "เดินทาง" = เดินเท้า + จอดรถ
  const travel = blockOf(homeCard, "เดินทาง");
  expectTrue("มีบล็อก 'เดินทาง'", Boolean(travel));
  expectTrue(
    "ต้องเดินเท้าเข้าซอยอยู่ในบล็อกนี้",
    Boolean(travel?.lines.some((l) => l.text === "เดินเข้าซอยอีก 5 นาที"))
  );
  expectTrue(
    "ที่จอดรถอยู่ในบล็อกนี้",
    Boolean(travel?.lines.some((l) => l.text === "จอดรถหน้าบ้านได้ 2 คัน"))
  );
}

{
  // คาเฟ่ — ต้องไม่มีข้อมูลที่พัก และเมนูต้องมาก่อนราคา
  const cafeData: V2Extraction = validateExtraction(CAFE_RAW, {
    transcript: "คาเฟมะลิ บ้านปาย กาแฟ 60 บาท",
  }).data;
  const cafeCard = buildPostCard(cafeData, null);
  const cafeFacts = factLines(cafeCard);
  expectTrue(
    "ไม่มีบล็อกหัวข้อ 'ที่พัก' ในคลิปคาเฟ",
    !blockOf(cafeCard, "ที่พัก")
  );
  expectTrue(
    "มีบล็อกหัวข้อ 'มีอะไรกิน'",
    Boolean(blockOf(cafeCard, "มีอะไรกิน"))
  );
  expectTrue(
    "เมนูเด่นอยู่ในบล็อก 'มีอะไรกิน'",
    Boolean(
      blockOf(cafeCard, "มีอะไรกิน")?.lines.some((l) =>
        l.text.includes("กาแฟมะลิ · ขนมปังปิง")
      )
    )
  );
  expectTrue(
    "ที่นั่งและวิธีจ่ายอยู่บรรทัดเดียวกัน",
    cafeFacts.some((f) => f.includes("นั่งได้ 10 ที่") && f.includes("จ่าย: โอนเงิน/เงินสด"))
  );
  expectTrue(
    "ราคาเริ่มต้นของคาเฟไม่ซ้ำกับราคาหลัก",
    !cafeFacts.some((f) => f.includes("60/คน"))
  );
  expectTrue(
    "เมนูและราคาเริ่มต้นอยู่บรรทัดเดียวกัน",
    cafeFacts[0]?.includes("กาแฟมะลิ") === true &&
      cafeFacts[0]?.includes("ราคาเริ่มต้น") === true
  );
}

{
  // ต้องไม่มีข้อความเกี่ยวกับแพลตฟอร์ม / คน / เสื้อผ้า
  const text = renderPostText(homeCard);
  const banned = ["TikTok", "tiktok", "โปรโมต", "ประชาสัมพันธ์", "เสื้อ", "กางเกง", "ผู้หญิง", "ผู้ชาย"];
  for (const word of banned) {
    expectTrue(`ไม่มีคำต้องห้าม "${word}" ในการ์ด`, !text.includes(word));
  }
  expectTrue("ข้อความเป็นข้อความล้วน ไม่ใช่ JSON", !text.trim().startsWith("{"));
  expectTrue("ข้อความมีบรรทัดคำบรรยาย", text.includes("โฮมสเตยบ้านน้ำไหลเขา"));
  expectTrue("ข้อความไม่มีสัญลักษณ์หน้าบรรทัด", !/[✔⚠ℹ📍💡🧭💰🛏️🎨🛍️]/.test(text));
}

// ============================================================
//  3.1 ลำดับบล็อกตามประเภทสถานที่
// ============================================================
section("3.1 ลำดับบล็อกตามประเภท");

{
  // กิจกรรม/workshop — ราคามาก่อนสินค้า OTOP และไม่มีหัวข้อ "ทำอะไรได้"
  const workshop = {
    core: {
      place_name: " workshop ถนนไม้ ",
      category: ["Workshop", "หัตถกรรม"],
      price: { weekday: "350", weekend: null, unit: "ต่อคน", currency: "THB", inclusions: [] },
      restrictions: ["ต้องจองล่วงหน้า 2 วัน"],
      overview: " workshop ทอผ้าสไตล์พื้นเมืองในหมู่บ้าน ได้ผ้าผืนกลับไปเอง 1 ผืน ",
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
    otop: null,
    access: null,
    confidence: { overall: 0.9, per_module: { stay: 0, food: 0, activity: 0.9, otop: 0 }, conflicts: [], missing_info: [], source_used: [] },
  };
  const wCard = buildPostCard(validateExtraction(workshop).data, null);
  expectTrue(
    "ไม่มีหัวข้อ 'ทำอะไรได้' ในการ์ด workshop",
    !blockOf(wCard, "ทำอะไรได้") &&
      !renderPostText(wCard).includes("ทำอะไรได้")
  );
  expectTrue(
    "บล็อกแรกของ workshop คือ 'ราคา'",
    wCard.blocks[0]?.title === "ราคา"
  );
  expectTrue(
    "ราคา 350/คน อยู่ใต้หัวข้อราคา",
    Boolean(blockOf(wCard, "ราคา")?.lines.some((l) => l.text.includes("350/คน")))
  );
  expectTrue(
    "เวลาและจำนวนคนของกิจกรรมไปอยู่ใน 'ต้องรู้ก่อนไป'",
    Boolean(
      blockOf(wCard, "ต้องรู้ก่อนไป")?.lines.some(
        (l) => l.text === "ใช้เวลา ครึ่งวัน" || l.text === "รับ 2-6 คน"
      )
    )
  );
  expectTrue(
    "มีสถานที่ใกล้เคียง → บล็อก 'สถานที่ที่อยู่ใกล้เคียง' อยู่ท้ายสุด",
    buildPostCard(validateExtraction(workshop).data, null, GOOGLE_NEARBY).blocks
      .slice(-1)[0]?.title === "สถานที่ที่อยู่ใกล้เคียง"
  );
  expectTrue(
    "'ต้องจองล่วงหน้า' ที่เขียนซ้ำสองที่ (restrictions + need_booking) → พูดครั้งเดียว",
    (blockOf(wCard, "ต้องรู้ก่อนไป")?.lines ?? []).filter((l) =>
      l.text.includes("ต้องจองล่วงหน้า")
    ).length === 1
  );
  expectTrue(
    "ผลิตภัณฑ์ที่นำกลับไปได้ ต้องอ่านเป็นวลี ไม่ใช่คำครึ่ง",
    (blockOf(wCard, "ต้องรู้ก่อนไป")?.lines ?? []).some((l) =>
      l.text.includes("นำกลับไปได้: ผ้าผืน")
    )
  );
}

{
  // คาเฟ่ที่โมเดลใส่ข้อมูลที่พักมาแบบไม่มี "ห้อง" → ตัดข้อมูลที่พักทิ้ง
  const cafeWithStay = JSON.parse(JSON.stringify(CAFE_RAW));
  cafeWithStay.stay = {
    room_types: [],
    bedding: "เตียงเดี่ยว 1 เตียง",
    mosquito_net: null,
    facilities: ["ห้องน้ำ"],
    services: [],
  };
  const cCard = buildPostCard(validateExtraction(cafeWithStay).data, null);
  expectTrue(
    "คาเฟ่ที่มีแต่ข้อมูลที่พัก (ไม่มีห้อง) → ตัดข้อมูลที่พักทิ้ง",
    !factLines(cCard).some((f) => f.startsWith("ที่พัก:"))
  );
}

{
  // คาเฟ่ที่มี "ห้อง" จริง (เช่น ห้องประชุม) → เก็บไว้ ไม่ตัดข้อมูลจริง
  const cafeWithRooms = JSON.parse(JSON.stringify(CAFE_RAW));
  cafeWithRooms.stay = {
    room_types: [{ name: "ห้องประชุม", count: "1", capacity: "10-20", beds: null, bathroom: "ห้องน้ำในห้อง" }],
    bedding: null,
    mosquito_net: null,
    facilities: [],
    services: [],
  };
  const cCard = buildPostCard(validateExtraction(cafeWithRooms).data, null);
  expectTrue(
    "คาเฟ่ที่มีห้องจริง → เก็บข้อมูลที่พักไว้",
    factLines(cCard).some((f) => f.includes("ห้องประชุม 1 ห้อง (10-20 คน)"))
  );
}

// ============================================================
//  4. ข้อมูลแผนที่ (Google Places + Google Routes)
// ============================================================
section("4. ข้อมูลแผนที่ (Google Maps)");
{
  // ไม่มีข้อมูลแผนที่ → การ์ดยังต้องแสดงได้ปกติ
  const card = buildPostCard(homeData, null);
  expectTrue("ไม่มีข้อมูลแผนที่ → ยังมีบล็อกอื่นครบ", card.blocks.length >= 3);
  expectTrue("ไม่มีเครดิตแผนที่ตอนไม่มีข้อมูล", !card.mapCredit);
}
{
  const card = buildPostCard(homeData, {
    lat: 18.1,
    lon: 97.7,
    routeKm: 12.4,
    routeMinutes: 18,
    routeFrom: "ตัวอำเภอแมล่าน้อย",
    routeVia: "ทางหลวงชนบท 1081",
    hasToll: true,
    trafficDelaySec: 300,
    credit: "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform",
  });
  const travel = blockOf(card, "เดินทาง");
  expectTrue("มีบล็อกเดินทางเมื่อมีข้อมูลแผนที่", Boolean(travel));
  expectTrue(
    "มีบรรทัดระยะทาง",
    Boolean(travel && travel.lines.some((l) => l.text.includes("12.4")))
  );
  expectTrue(
    "บรรทัดระยะทางบอกจุดอ้างอิง",
    Boolean(
      travel && travel.lines.some((l) => l.text.includes("ตัวอำเภอแมล่าน้อย"))
    )
  );
  expectTrue(
    "มีบรรทัดชื่อเส้นทาง",
    Boolean(travel && travel.lines.some((l) => l.text.includes("ทางหลวงชนบท 1081")))
  );
  expectTrue(
    "มีบรรทัดค่าผ่าน",
    Boolean(travel && travel.lines.some((l) => l.text.includes("ค่าผ่าน")))
  );
  expectTrue(
    "มีบรรทัดรถติด",
    Boolean(travel && travel.lines.some((l) => l.text.includes("รถติด")))
  );
  expectTrue(
    "ไม่มีหัวข้อ 'สถานที่ที่อยู่ใกล้เคียง' ถ้าไม่มีข้อมูล Google Places",
    !blockOf(card, "สถานที่ที่อยู่ใกล้เคียง")
  );
  expectTrue(
    "ไม่มีคำเตือน 'ข้อมูลจากแผนที่ อาจไม่ตรงกับสภาพจริง'",
    !renderPostText(card).includes("อาจไม่ตรงกับสภาพจริง")
  );
  expectTrue(
    "ไม่มีบรรทัด 'ยังไม่มีข้อมูล: ...'",
    !renderPostText(card).includes("ยังไม่มีข้อมูล")
  );
  expectTrue(
    "ผิวถนนมาจากคลิป (Google ไม่มีฟิลด์ผิวถนน) และไม่ซ้ำ",
    Boolean(
      blockOf(card, "ต้องรู้ก่อนไป")?.lines.some(
        (l) => l.text === "ถนนลูกรังช่วงท้าย"
      )
    ) &&
      !blockOf(card, "ต้องรู้ก่อนไป")?.lines.some((l) =>
        l.text.includes("ข้อมูลจากแผนที่")
      )
  );
  expect(
    "เครดิตแผนที่",
    card.mapCredit,
    "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform"
  );
}
{
  // คลิปไม่ได้พูดถึงถนน → Google Routes ก็ไม่มีฟิลด์ผิวถนน
  // → การ์ดต้องไม่แต่งผิวถนนขึ้นเอง
  const noRoad = JSON.parse(JSON.stringify(HOMESTAY_RAW));
  noRoad.access.road_condition = null;
  const card = buildPostCard(validateExtraction(noRoad).data, {
    lat: 18.1,
    lon: 97.7,
    routeKm: 12.4,
    routeMinutes: 18,
    routeFrom: "ตัวอำเภอแมล่าน้อย",
    credit: "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform",
  });
  expectTrue(
    "ไม่แต่งผิวถนนเอง (ไม่มีทั้งในคลิปและใน Routes)",
    !renderPostText(card).includes("ถนนลูกรัง")
  );
  expectTrue(
    "ยังมีบรรทัดระยะทางอยู่",
    Boolean(blockOf(card, "เดินทาง")?.lines.some((l) => l.text.includes("12.4")))
  );
}


// ============================================================
//  5. รูปแบบ string แบบเดิม (composePrice / composeCapacity)
// ============================================================
section("5. รูปแบบ string แบบเดิม");
expect(
  "ราคา + หน่วย + สิ่งที่รวม",
  composePrice("450-500", {
    weekday: "450-500",
    weekend: null,
    unit: "ต่อคืน",
    currency: "THB",
    inclusions: ["อาหารเช้า"],
  }),
  "450-500 บาท/คืน (รวมอาหารเช้า)"
);
expect(
  "ราคาไม่มีหน่วย",
  composePrice("60", {
    weekday: "60",
    weekend: null,
    unit: null,
    currency: "THB",
    inclusions: [],
  }),
  "60 บาท"
);
expect(
  "ความจุ — รวมห้อง/คนต่อห้อง/ห้องใหญ่/เตียง",
  composeCapacity({
    room_types: [
      { name: "ห้องเล็ก", count: "1", capacity: "1-3", beds: "เตียงเดี่ยว 1", bathroom: null },
      { name: "ห้องใหญ่", count: "2", capacity: "4-6", beds: "เตียงเดี่ยว 2", bathroom: null },
    ],
    bedding: "เตียงเดี่ยว 3 เตียง",
    mosquito_net: null,
    facilities: [],
    services: [],
  }),
  { rooms: "3", guests_per_room: "1-3", max_guests: "4-6", beds: "3" }
);
expect(
  "ความจุ — ประเภทห้องเดียว (ไม่แยก max_guests)",
  composeCapacity({
    room_types: [{ name: "ห้องเดียว", count: "4", capacity: "2-4", beds: null, bathroom: null }],
    bedding: null,
    mosquito_net: null,
    facilities: [],
    services: [],
  }),
  { rooms: "4", guests_per_room: "2-4", max_guests: null, beds: null }
);
expect("ความจุ — ไม่มีที่พัก → null", composeCapacity(null), null);

// ============================================================
//  6. toLegacySummary — คีย์เดิมต้องครบ (แผน §3)
// ============================================================
section("6. คีย์เดิม (legacy) ต้องครบและชนิดตรง");
const legacy = toLegacySummary(homeData, homeCard, INPUT);

expect("status", legacy.status, "ready");
expectTrue("text เป็นข้อความ (ไม่ใช่ JSON)", !legacy.text.trim().startsWith("{"));
expectTrue("text มีเนื้อหาการ์ด", legacy.text.includes("ต้องรู้ก่อนไป"));
expectTrue("visualDescription ไม่เป็น null", typeof legacy.visualDescription === "string" && legacy.visualDescription.length > 0);
expect("card ถูกผนวกมาด้วย", legacy.card === homeCard, true);

{
  const p = legacy.place;
  expectTrue("place มีอยู่", Boolean(p));
  if (!p) throw new Error("ไม่มี place");
  expect("place_name", p.place_name, "โฮมสเตยบ้านน้ำไหลเขา");
  expect("community", p.community, "หมู่บ้านห้วยหอม");
  expect("location.province", p.location.province, "แม่ฮ่องสอน");
  expect("location.district", p.location.district, "แมล่าน้อย");
  expect("location.subdistrict", p.location.subdistrict, "ห้วยหอม");
  expect("atmosphere (จาก overview)", p.atmosphere, homeData.core.overview);
  expectTrue("category เป็น array", Array.isArray(p.category));
  expectTrue("activities เป็น array", Array.isArray(p.activities));
  expect("price_info.weekday", p.price_info.weekday, "700 บาท/คน (รวมอาหารเย็นและอาหารเช้า)");
  expect("price_info.weekend", p.price_info.weekend, "700 บาท/คน (รวมอาหารเย็นและอาหารเช้า)");
  expect("price_info.currency", p.price_info.currency, "THB");
  expect("contact.phone", p.contact.phone, "08-1234-5678");
  expect("opening_hours", p.opening_hours, "08:00-18:00");
  expect("capacity.rooms", p.capacity?.rooms, "3");
  expect("capacity.guests_per_room", p.capacity?.guests_per_room, "1-3");
  expect("capacity.max_guests", p.capacity?.max_guests, "4-6");
  expect("capacity.beds", p.capacity?.beds, "3");
  expectTrue("capacity เป็น string ทั้งหมด", Object.values(p.capacity || {}).every((v) => v === null || typeof v === "string"));
  expect("rules (จาก restrictions)", p.rules, [
    "รับวันละ 1 กลุ่ม",
    "ทุกคนที่มาพักต้องช่วยกันทำกองไฟ",
  ]);
  expect("areas (โซนถูกถอดจากสายการ์ดแล้ว)", p.areas, []);
  expect(
    "facilities (ของในห้อง + บริการ รวมกัน สายเก่ามีคีย์เดียว)",
    p.facilities,
    ["มีเตาไฟ", "มีน้ำร้อน"]
  );
  expectTrue("otop_products เป็น array", Array.isArray(p.otop_products));
  expect("highlights", p.highlights, homeData.core.highlights);
  expect("tags", p.tags, homeData.core.tags);
  expect("confidence.overall_confidence", p.confidence?.overall_confidence, 0.82);
  expectTrue("confidence.source_used เป็น array", Array.isArray(p.confidence?.source_used));
  expectTrue("confidence.missing_info เป็น array", Array.isArray(p.confidence?.missing_info));
}

{
  // คีย์ที่ "แอป/Google" เป็นเจ้าของ → ห้ามถูกเขียนทับ
  const p = legacy.place!;
  expect("price_info.level ไม่ถูกแตะ", p.price_info.level, undefined);
  expect("contact.website ไม่ถูกแตะ", p.contact.website, undefined);
  expect("location.gps ไม่ถูกแตะ", p.location.gps, undefined);
  expect("google_candidates ไม่ถูกแตะ", p.google_candidates, undefined);
}

{
  // คลิปคาเฟ — otop/activity ไม่มี → ค่าว่าง ไม่ใช่ null ในคีย์ที่เป็น array
  const cafeData = validateExtraction(CAFE_RAW, { transcript: "คาเฟมะลิ 60 บาท" }).data;
  const cafeCard = buildPostCard(cafeData, null);
  const cafeLegacy = toLegacySummary(cafeData, cafeCard, INPUT);
  expect("คลิปคาเฟ: otop_products = []", cafeLegacy.place?.otop_products, []);
  expect("คลิปคาเฟ: areas = []", cafeLegacy.place?.areas, []);
  expect("คลิปคาเฟ: facilities = []", cafeLegacy.place?.facilities, []);
  expect("คลิปคาเฟ: capacity = null", cafeLegacy.place?.capacity, null);
  expect("คลิปคาเฟ: price_info.weekend = null", cafeLegacy.place?.price_info.weekend, null);
}

// ============================================================
//  7. ตรวจสะกดการ์ด (applyProofreadToCard) — ตรรกะบริสุทธิ์ ไม่ยิงโมเดล
// ============================================================
section("7. ตรวจสะกดการ์ด");
{
  const data = validateExtraction(HOMESTAY_RAW).data;
  const card = buildPostCard(
    data,
    {
      lat: 18.1,
      lon: 97.7,
      routeKm: 12.4,
      routeMinutes: 18,
      routeFrom: "ตัวอำเภอแมล่าน้อย",
      routeVia: "ทางหลวงชนบท 1081",
      credit: "ข้อมูลสถานที่ใกล้เคียงและเส้นทาง: Google Maps Platform",
    },
    GOOGLE_NEARBY
  );
  const knowIdx = card.blocks.findIndex((b) => b.title === "ต้องรู้ก่อนไป");
  const factsIdx = card.blocks.findIndex((b) => b.style === "facts");
  const nearbyIdx = card.blocks.findIndex(
    (b) => b.title === "สถานที่ที่อยู่ใกล้เคียง"
  );
  expectTrue("มีบล็อกที่จะตรวจครบ", knowIdx >= 0 && factsIdx >= 0 && nearbyIdx >= 0);

  // โมเดลแก้: สะกดผิด 1 คำ · เปลี่ยนตัวเลข · แตะบรรทัดจาก Google
  const corrections = {
    place_name: "โฮมสเตยบ้านน้ำไหลเขา",
    blocks: card.blocks.map((b, bi) => ({
      lines: b.lines.map((l, li) => {
        if (bi === knowIdx && li === 0) return l.text.replace("กลุ่ม", "กลุม");
        if (bi === factsIdx && li === 0) return l.text.replace("700/คน", "900/คน");
        if (bi === nearbyIdx) return "วัดป่าตาง · วัด · 2.4 กม. · ★4.6";
        return l.text;
      }),
    })),
  };
  const fixed = applyProofreadToCard(card, corrections);
  const text = renderPostText(fixed);

  expectTrue("แก้คำที่สะกดผิดได้", text.includes("รับวันละ 1 กลุม"));
  expectTrue("คำที่สะกดถูกต้องไม่ถูกแก้เพี้ย", !text.includes("รับวันละ 1 กลุ่ม"));
  expectTrue("ตัวเลขขยับ → ไม่ใช้คำที่แก้", !text.includes("900/คน"));
  expectTrue("ราคาเดิมยังอยู่", text.includes("700/คน"));
  expect(
    "บรรทัดจาก Google (สถานที่ใกล้เคียง) ไม่ถูกแก้",
    fixed.blocks[nearbyIdx]?.lines[0]?.text,
    "วัดป่าแตง · วัด · 2.4 กม. · ★4.6"
  );
  expect(
    "บรรทัดจาก Google (เส้นทาง) ไม่ถูกแก้",
    fixed.blocks
      .find((b) => b.title === "เดินทาง")
      ?.lines.find((l) => l.kind === "info")?.text,
    "จากตัวอำเภอแมล่าน้อย ประมาณ 12.4 กม. · 18 นาที"
  );
  expect("จำนวนบล็อกเท่าเดิม", fixed.blocks.length, card.blocks.length);
  expect("mapCredit ไม่หาย", fixed.mapCredit, card.mapCredit);
  expect("contact ไม่หาย", fixed.contact?.phone, card.contact?.phone);
}
{
  // โมเดลตอบจำนวนบรรทัดไม่ตรง → ใช้บล็อกเดิมทั้งก้อน
  const data = validateExtraction(HOMESTAY_RAW).data;
  const card = buildPostCard(data, null, GOOGLE_NEARBY);
  const fixed = applyProofreadToCard(card, {
    blocks: [{ lines: ["วัดป่าแตง"] }], // บล็อกน้อยกว่าเดิม
  });
  expect(
    "จำนวนบรรทัดไม่ตรง → ใช้ของเดิม",
    fixed.blocks.find((b) => b.title === "สถานที่ที่อยู่ใกล้เคียง")?.lines[0]?.text,
    "วัดป่าแตง · วัด · 2.4 กม. · ★4.6"
  );
  expect("บล็อกอื่นไม่หาย", fixed.blocks.length, card.blocks.length);
}
{
  // ชื่อสถานที่ที่เปลี่ยนไปคนละคำ → ปฏิเสธ
  const data = validateExtraction(HOMESTAY_RAW).data;
  const card = buildPostCard(data, null);
  const fixed = applyProofreadToCard(card, { place_name: "ร้านกาแฟมะลิ" });
  expect(
    "ชื่อที่เปลี่ยนคนละคำ → ใช้ของเดิม",
    fixed.place?.name,
    "โฮมสเตยบ้านน้ำไหลเขา"
  );
}
{
  // ชื่อสถานที่ที่สะกดผิด → แก้ได้ (และต้องไปถึงจุดที่ใช้ค้น Google)
  const data = validateExtraction(HOMESTAY_RAW).data;
  const card = buildPostCard(data, null);
  const fixed = applyProofreadToCard(card, {
    place_name: "โฮมสเตยบ้านน้ำไหลเขว",
  });
  expect("ชื่อที่สะกดผิด → แก้ได้", fixed.place?.name, "โฮมสเตยบ้านน้ำไหลเขว");
}

// ── สรุป ───────────────────────────────────────────────────────
console.log(
  failed === 0
    ? `\n✅ ผ่านทั้งหมด (${passed} ข้อ)`
    : `\n❌ พลาด ${failed} ข้อ (ผ่าน ${passed} ข้อ)`
);
process.exit(failed === 0 ? 0 : 1);
