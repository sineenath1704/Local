/**
 * ตรวจกติกา "โฟลเดอร์คลิป → รายชื่อสถานที่" — รันแบบออฟไลน์ ไม่ต้องมี credential
 * ---------------------------------------------------------------------------
 * ตรรกะใน `src/folderContext.ts` เป็นตรรกะบริสุทธิ์ (normalize / จับคู่ / dedupe)
 * ไม่แตะ Google / ฐานข้อมูล → ทดสอบได้ตรง ๆ โดยไม่ต้องเปิดบิลลิ่มป์
 *
 * ใช้
 *   cd backend
 *   npm run test:folder
 */

import {
  normalizePlaceName,
  matchClipToRegistry,
  dedupePlaces,
  resolvePlaces,
  haversineMeters,
  folderPlaceSourceLabel,
  type FolderClip,
  type FolderPlace,
  type RegistryRow,
} from "../src/folderContext";

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

function section(title: string) {
  console.log(`\n— ${title} —`);
}

// ── ข้อมูลตัวอย่าง ──────────────────────────────────────────────
const REGISTRY: RegistryRow[] = [
  {
    id: "row-1",
    place_id: "gp-1",
    place_name: "บ้านปาย",
    province: "เชียงราย",
    district: "แม่สาย",
    latitude: 20.0265,
    longitude: 99.8621,
    formatted_address: "99 หมู่ 2 บ้านปาย จ.เชียงราย",
    price_info: "ฟรี",
    phone: "081-234-5678",
    rating: 4.5,
    community_id: "com-1",
  },
  {
    id: "row-2",
    place_id: "gp-2",
    place_name: "บ้านปายใหม่",
    province: "เชียงราย",
    district: "แม่สาย",
    latitude: 20.0301,
    longitude: 99.8700,
    formatted_address: "10 หมู่ 3 บ้านปายใหม่ จ.เชียงราย",
    rating: 4.1,
  },
  {
    id: "row-3",
    place_id: "gp-3",
    place_name: "ร้านกาแฟมะลิ",
    province: "เชียงใหม่",
    district: "เมืองเชียงใหม่",
    latitude: 18.7883,
    longitude: 98.9853,
    formatted_address: "5 ถนนถนนช้างเผือก จ.เชียงใหม่",
    price_info: "60-120 บาท",
    opening_hours: "08:00 - 18:00",
  },
  {
    id: "row-4",
    place_id: "gp-4",
    place_name: "บ้านห้วยห้อม",
    province: "แม่ฮ่องสอน",
    district: "แม่ลาน้อย",
    latitude: 18.1250,
    longitude: 97.7400,
    formatted_address: "บ้านห้วยห้อม จ.แม่ฮ่องสอน",
  },
];

function clip(over: Partial<FolderClip> = {}): FolderClip {
  return {
    videoId: over.videoId ?? "v1",
    caption: null,
    hashtags: [],
    placeName: null,
    locationName: null,
    province: null,
    district: null,
    latitude: null,
    longitude: null,
    thumbnailUrl: null,
    summary: null,
    ...over,
  };
}

function summaryPlace(placeName: string | null, extra: Record<string, unknown> = {}) {
  return {
    text: null,
    visualDescription: null,
    place: {
      place_name: placeName,
      community: null,
      location: null,
      price_info: null,
      contact: null,
      opening_hours: null,
      capacity: null,
      rules: [],
      areas: [],
      facilities: [],
      highlights: [],
      category: [],
      activities: [],
      confidence: null,
      ...extra,
    } as never,
  };
}

// ════════════════════════════════════════════════════════════════
console.log("════════ ตรวจกติกา: โฟลเดอร์คลิป → รายชื่อสถานที่ ════════\n");

// ── 1. normalize ───────────────────────────────────────────────
section("normalize ชื่อสถานที่");

expect("ตัดคำนำหน้าจังหวัดแบบย่อ", normalizePlaceName("จ.เชียงใหม่"), "เชียงใหม่");
expect("ตัดคำนำหน้าจังหวัดแบบเต็ม", normalizePlaceName("จังหวัดเชียงใหม่"), "เชียงใหม่");
expect("ตัดคำนำหน้าอำเภอ/ตำบล", normalizePlaceName("อ.เมือง ต.สุเทพ"), "เมืองสุเทพ");
expect("ตัดช่องว่างและเครื่องหมาย", normalizePlaceName("บ้าน ปาย-ใหม่"), "บ้านปายใหม่");
expect("ตัดคำนำหน้าทั่วไป", normalizePlaceName("ร้านกาแฟมะลิ"), "กาแฟมะลิ");
expect("ตัดคำนำหน้าทั่วไปแบบอังกฤษ", normalizePlaceName("Cafe มะลิ"), "มะลิ");
expect("ตัดคำนำหน้าซ้ำ", normalizePlaceName("ร้านร้านกาแฟมะลิ"), "กาแฟมะลิ");
expect("ตัดช่องว่างก่อนตัดคำนำหน้า", normalizePlaceName("ร้าน กาแฟ มะลิ"), "กาแฟมะลิ");

// ⚠️ สระ/วรรณยุกต์ไทยต้องอยู่ — ถ้าหลุด "บ้าน" จะกลายเป็น "บาน" แล้วไปตรงกับที่อื่น
expect("เก็บสระไทยไว้ (บ้าน ≠ บาน)", normalizePlaceName("บ้าน") !== normalizePlaceName("บาน"), true);
expect("เก็บวรรณยุกต์ไทยไว้", normalizePlaceName("กาแฟ") !== normalizePlaceName("กาเฟ"), true);
expect("NFKC ทำให้เทียบได้", normalizePlaceName("café"), normalizePlaceName("café"));
expect("ตัวพิมพ์เล็ก/ใหญ่ไม่มีผล", normalizePlaceName("บ้านปาย"), normalizePlaceName("บ้านปาย"));
expect("ชื่อสั้นเกินไป → เก็บชื่อเดิมไว้", normalizePlaceName("ร้าน"), "ร้าน");
expect("คำว่าง → คืนค่าว่าง", normalizePlaceName("   "), "");

// ── 2. จับคู่ชื่อ ──────────────────────────────────────────────
section("จับคู่กับทะเบียน");

{
  const m = matchClipToRegistry(
    { province: "เชียงราย", summary: summaryPlace("บ้านปาย") },
    REGISTRY
  );
  expect("ชื่อตรงเป๊ะ → registry-exact", m?.kind, "registry-exact");
  expect("ชื่อตรงเป๊ะ → ได้ place_id ที่ถูก", m?.row.place_id, "gp-1");
}

{
  // "บ้านปาย" ครอบ "บ้านปายใหม่" → ชื่อที่ยาวกว่าต้องชนะ
  const m = matchClipToRegistry(
    { province: "เชียงราย", summary: summaryPlace("บ้านปายใหม่") },
    REGISTRY
  );
  expect("ชื่อยาวกว่าชนะ (บ้านปายใหม่ ไม่ใช่ บ้านปาย)", m?.row.place_id, "gp-2");
  expect("ชื่อตรงเป๊ะกับชื่อที่ยาวกว่า → registry-exact", m?.kind, "registry-exact");
}

{
  // "บ้านปาย" ถูกครอบด้วย "บ้านปายใหม่" แต่มีแถวชื่อตรงอยู่แล้ว
  // → ชื่อตรงเป๊ะแรงกว่า (บ้านปาย ≠ บ้านปายใหม่ คนละหมู่บ้าน)
  const m = matchClipToRegistry(
    { province: "เชียงราย", summary: summaryPlace("บ้านปาย") },
    REGISTRY
  );
  expect("มีชื่อตรงเป๊ะ → ชื่อตรงชนะ (ไม่ใช่ชื่อที่ยาวกว่า)", m?.row.place_id, "gp-1");
  expect("ชื่อตรงเป๊ะ → registry-exact", m?.kind, "registry-exact");
}

{
  // ไม่มีแถวชื่อตรง → ต้องเลือกชื่อที่ยาวกว่าในกลุ่มที่ชื่อครอบกัน
  const m = matchClipToRegistry(
    { province: "เชียงราย", summary: summaryPlace("บ้านปาย") },
    REGISTRY.filter((r) => r.place_id !== "gp-1")
  );
  expect("ไม่มีชื่อตรง → ชื่อที่ยาวกว่าชนะ", m?.row.place_id, "gp-2");
  expect("ไม่มีชื่อตรง → registry-name", m?.kind, "registry-name");
}

{
  // จังหวัดต่างกัน → ห้ามจับคู่ด้วยชื่อ
  const m = matchClipToRegistry(
    { province: "เชียงใหม่", summary: summaryPlace("บ้านปาย") },
    REGISTRY
  );
  expect("จังหวัดต่างกัน → ไม่จับคู่", m, null);
}

{
  // ไม่มีจังหวัดในคลิป → ใช้ชื่ออย่างเดียว (ยังจับคู่ได้)
  const m = matchClipToRegistry(
    { summary: summaryPlace("ร้านกาแฟมะลิ") },
    REGISTRY
  );
  expect("ไม่มีจังหวัด → จับคู่ด้วยชื่อ", m?.row.place_id, "gp-3");
}

{
  // ชื่อไม่ตรงเลย + ไม่มีพิกัด → ไม่จับคู่
  const m = matchClipToRegistry(
    { province: "เชียงใหม่", summary: summaryPlace("ร้านข้าวต้มสุดพิเศษ") },
    REGISTRY
  );
  expect("ไม่มีในทะเบียน → ไม่จับคู่", m, null);
}

{
  // ชื่อไม่ตรง แต่พิกัดใกล้ ≤ 150 ม. → registry-proximity
  const m = matchClipToRegistry(
    {
      province: "แม่ฮ่องสอน",
      summary: summaryPlace("ที่พักห้วยห้อมแห่งใหม่"),
      latitude: 18.1251,
      longitude: 97.7401,
    },
    REGISTRY
  );
  expect("พิกัดใกล้ → registry-proximity", m?.kind, "registry-proximity");
  expect("พิกัดใกล้ → ได้ place_id ที่ถูก", m?.row.place_id, "gp-4");
}

{
  // พิกัดไกลเกิน 150 ม. → ไม่จับคู่
  const m = matchClipToRegistry(
    {
      province: "แม่ฮ่องสอน",
      summary: summaryPlace("ที่พักห้วยห้อมแห่งใหม่"),
      latitude: 18.1300,
      longitude: 97.7500,
    },
    REGISTRY
  );
  expect("พิกัดไกลเกิน 150 ม. → ไม่จับคู่", m, null);
}

{
  // คลิปไม่มีพิกัด → ใช้พิกัดจับคู่ไม่ได้
  const m = matchClipToRegistry(
    { summary: summaryPlace("ที่พักห้วยห้อมแห่งใหม่") },
    REGISTRY
  );
  expect("คลิปไม่มีพิกัด → จับคู้ด้วยพิกัดไม่ได้", m, null);
}

{
  // ทะเบียนไม่มีพิกัด → ใช้พิกัดจับคู้ไม่ได้
  const m = matchClipToRegistry(
    { latitude: 18.1251, longitude: 97.7401, summary: summaryPlace("ห้วยห้อมแห่งใหม่") },
    REGISTRY.filter((r) => r.place_id === "gp-3")
  );
  expect("ทะเบียนไม่มีพิกัด → จับคู้ด้วยพิกัดไม่ได้", m, null);
}

{
  // ชื่อมาจาก `videos.place_name` ได้ด้วย (ไม่ต้องมี ai_summary)
  const m = matchClipToRegistry(
    { placeName: "บ้านห้วยห้อม", province: "แม่ฮ่องสอน" },
    REGISTRY
  );
  expect("อ่านชื่อจาก videos.place_name ได้", m?.row.place_id, "gp-4");
}

{
  // ชื่อมาจาก `videos.location_name` (อันดับสุดท้าย)
  const m = matchClipToRegistry(
    { locationName: "ร้านกาแฟมะลิ", province: "เชียงใหม่" },
    REGISTRY
  );
  expect("อ่านชื่อจาก videos.location_name ได้", m?.row.place_id, "gp-3");
}

// ── 3. haversine ───────────────────────────────────────────────
section("คำนวณระยะทาง");
expect("0 เมตรเมื่อพิกัดเดียวกัน", Math.round(haversineMeters(18.7883, 98.9853, 18.7883, 98.9853)), 0);
expect("~111 กม. ต่อองศา latitude", Math.round(haversineMeters(0, 0, 1, 0) / 1000), 111);

// ── 4. resolvePlaces + dedupe ───────────────────────────────────
section("รวมสถานที่เดียวกัน (dedupe)");

{
  const clips: FolderClip[] = [
    clip({ videoId: "v1", province: "เชียงราย", summary: summaryPlace("บ้านปาย") }),
    clip({ videoId: "v2", province: "เชียงราย", summary: summaryPlace("บ้านปาย") }),
    clip({ videoId: "v3", province: "เชียงราย", summary: summaryPlace("บ้านปายใหม่") }),
    clip({
      videoId: "v4",
      province: "เชียงใหม่",
      summary: summaryPlace("ร้านข้าวต้มสุดพิเศษ", {
        price_info: { weekday: "30-50 บาท" },
        contact: { phone: "080-000-0000" },
        facilities: ["ที่จอดรถ"],
      }),
    }),
  ];
  const places = resolvePlaces(clips, REGISTRY);

  expect("รวมแล้วเหลือ 3 สถานที่", places.length, 3);
  expect("สถานที่จากทะเบียนมาก่อน", places[0].source, "registry");
  expect("นับคลิปถูก (บ้านปาย = 2 คลิป)", places.find((p) => p.name === "บ้านปาย")?.clipCount, 2);
  expect("คลิปของสถานที่เดียวกันถูกรวม", places.find((p) => p.name === "บ้านปาย")?.videoIds.length, 2);
  expect("ชื่อคนละแห่งไม่ถูกรวม", places.find((p) => p.name === "บ้านปายใหม่")?.clipCount, 1);
  expect("สถานที่ที่ไม่มีในทะเบียน → มาจากคลิป", places.find((p) => p.name === "ร้านข้าวต้มสุดพิเศษ")?.source, "clip");
  expect("matchKind ของที่มาจากคลิป = clip-text", places.find((p) => p.name === "ร้านข้าวต้มสุดพิเศษ")?.matchKind, "clip-text");
  expect("ราคาจากคลิปถูกเก็บ", places.find((p) => p.name === "ร้านข้าวต้มสุดพิเศษ")?.facts.price, "30-50 บาท");
  expect("เบอร์โทรจากคลิปถูกเก็บ", places.find((p) => p.name === "ร้านข้าวต้มสุดพิเศษ")?.facts.phone, "080-000-0000");
  expect("สิ่งอำนวยความสะดวกจากคลิปถูกเก็บ", places.find((p) => p.name === "ร้านข้าวต้มสุดพิเศษ")?.facts.facilities, ["ที่จอดรถ"]);
}

{
  // ข้อมูลทะเบียนต้องชนะข้อมูลจากคลิป
  const merged = dedupePlaces([
    {
      key: "r:gp-1",
      name: "บ้านปาย",
      source: "registry",
      matchKind: "registry-exact",
      registryPlaceId: "gp-1",
      communityId: null,
      communityName: null,
      address: "ที่อยู่จริง",
      province: "เชียงราย",
      district: null,
      latitude: null,
      longitude: null,
      clipCount: 1,
      videoIds: ["v1"],
      facts: { price: "ฟรี", phone: "081-234-5678" },
    },
    {
      key: "r:gp-1",
      name: "บ้านปาย",
      source: "registry",
      matchKind: "registry-exact",
      registryPlaceId: "gp-1",
      communityId: null,
      communityName: null,
      address: "ที่อยู่จริง",
      province: "เชียงราย",
      district: null,
      latitude: null,
      longitude: null,
      clipCount: 1,
      videoIds: ["v2"],
      facts: { price: "ไม่มีข้อมูล", phone: null },
    },
  ]);
  expect("dedupe รวมเป็นแห่งเดียว", merged.length, 1);
  expect("dedupe รวมจำนวนคลิป", merged[0].clipCount, 2);
  expect("ราคาที่มีค่าจริงชนะ", merged[0].facts.price, "ฟรี");
}

{
  // คลิปที่ไม่มีชื่อสถานที่เลย → ไม่ต้องสร้างรายการปลอม
  const places = resolvePlaces([clip({ videoId: "v9" })], REGISTRY);
  expect("คลิปไม่มีชื่อสถานที่ → ไม่สร้างรายการ", places.length, 0);
}

// ── 5. ป้ายแหล่งที่มา ───────────────────────────────────────────
section("ป้ายแหล่งที่มา");
expect("ตรงชื่อ", folderPlaceSourceLabel({ source: "registry", matchKind: "registry-exact" }), "ยืนยันในทะเบียนแล้ว (ตรงชื่อ)");
expect("ชื่อใกล้เคียง", folderPlaceSourceLabel({ source: "registry", matchKind: "registry-name" }), "ยืนยันในทะเบียนแล้ว (ชื่อใกล้เคียง)");
expect("พิกัดตรง", folderPlaceSourceLabel({ source: "registry", matchKind: "registry-proximity" }), "ยืนยันในทะเบียนแล้ว (พิกัดตรงกัน)");
expect("ยังไม่ยืนยัน", folderPlaceSourceLabel({ source: "clip", matchKind: "clip-text" }), "จากคลิป (ยังไม่ยืนยันในทะเบียน)");

// ── สรุป ───────────────────────────────────────────────────────
console.log(
  failed === 0
    ? `\n✅ ผ่านทั้งหมด (${passed} ข้อ)`
    : `\n❌ พลาด ${failed} ข้อ (ผ่าน ${passed} ข้อ)`
);
process.exit(failed === 0 ? 0 : 1);
