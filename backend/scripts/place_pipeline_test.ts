/**
 * เทสต์สาย "หาสถานที่" — ตรรกะทั้งหมดที่ไม่ต้องต่อเน็ต
 * -------------------------------------------------------------
 * ครอบคลุม:
 *   1) การตรวจหลักฐาน (ชื่อ + พื้นที่) — `normalizePlaceResolution`
 *   2) การเรียงคำค้น (หลักฐานมาก่อน / ไม่ซ้ำ / เติม "ประเทศไทย")
 *      — `buildPlaceQueries`
 *   3) การค้นหลายคำ (ตัดซ้ำ / หยุดเร็ว / จำกัดจำนวน / ผิดพลาด≠ไม่เจอ)
 *      — `searchPlaceCandidatesMulti`
 *   4) การกรองขอบเขต + การเรียงลำดับ (ระดับขอบเขต → คะแนน AI)
 *      — `searchClipPlaceCandidates`
 *   5) การจับคู่ชื่อกับผลของ Google (กันพิกัดผิด)
 *      — `placeNameLooksRight`
 *
 * รัน
 *   cd backend
 *   npm run test:place
 *
 * ไม่ต่อเน็ต · ไม่ใช้คีย์ · ไม่เขียนฐานข้อมูล
 */

import { normalizePlaceResolution } from "../src/aiClient";
import {
  buildPlaceQueries,
  searchClipPlaceCandidates,
  searchPlaceCandidatesMulti,
  sortPlaceCandidates,
} from "../src/routes/places";
import { placeNameLooksRight } from "../src/googleMaps";
import type { PlaceCandidate } from "../src/placeTypes";
import type { VideoAnalysisInput } from "../src/prompt";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name}${detail ? `\n     ${detail}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `ได้ ${a} · ควรเป็น ${e}`);
}

/** ผู้สมัครปลอม ๆ สำหรับทดสอบตรรกะ */
function fake(
  placeId: string,
  name: string,
  subdistrict: string | null,
  district: string | null = "สันทิตย์",
  province: string | null = "เชียงใหม่"
): PlaceCandidate {
  return {
    name,
    address: `${name} ตำบล${subdistrict ?? "-"} อำเภอ${district ?? "-"} ${province ?? "-"}`,
    placeId,
    latitude: null,
    longitude: null,
    province,
    district,
    subdistrict,
    types: ["lodging"],
    primaryType: "lodging",
    primaryTypeDisplayName: "ที่พัก",
    rating: 4.5,
    userRatingCount: 10,
  };
}

// ─────────────────────────────────────────────
//  1) การตรวจหลักฐาน
// ─────────────────────────────────────────────
function testEvidence() {
  console.log("\n=== 1) การตรวจหลักฐาน (ชื่อ + พื้นที่) ===");

  const input: VideoAnalysisInput = {
    transcript:
      "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า อำเภอสันทิตย์ จังหวัดเชียงใหม่",
    audioType: "speech",
  };

  const base = {
    found: true,
    place_name: "บ้านสวนริมน้ำ",
    confidence: 0.9,
    evidence: [
      { source: "transcript", quote: "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า" },
    ],
    queries: [],
  };

  // พื้นที่ที่มีในคลิป → เก็บไว้
  const ok = normalizePlaceResolution(
    {
      ...base,
      admin: { province: "เชียงใหม่", district: "สันทิตย์", subdistrict: "บ้านป่า" },
    },
    input
  );
  eq("พื้นที่ที่มีในคลิป → เก็บครบ", ok.admin, {
    province: "เชียงใหม่",
    district: "สันทิตย์",
    subdistrict: "บ้านป่า",
    village: null,
  });

  // พื้นที่ที่โมเดลเดาขึ้นมา (ไม่มีในคลิป) → ตัดทิ้ง
  const hallucinated = normalizePlaceResolution(
    {
      ...base,
      admin: { province: "เชียงใหม่", district: "แม่ริม", subdistrict: "บ้านป่า" },
    },
    input
  );
  eq(
    "อำเภอที่ไม่มีในคลิป → ตัดทิ้ง (ค้นกว้างขึ้น ดีกว่าค้นผิด)",
    hallucinated.admin.district,
    null
  );
  check(
    "จังหวัดที่มีในคลิปยังอยู่",
    hallucinated.admin.province === "เชียงใหม่"
  );

  // พื้นที่ทั้งหมดที่โมเดลเดา → เหลือค่าว่างทั้งหมด
  const allFake = normalizePlaceResolution(
    { ...base, admin: { province: "กระบี่", district: "เมือง", subdistrict: "หัวลำโพง" } },
    input
  );
  eq("พื้นที่ที่เดาทั้งหมด → ไม่เหลือสักชั้น", allFake.admin, {
    province: null,
    district: null,
    subdistrict: null,
    village: null,
  });
  check(
    "คำค้นย่อยลงเหลือแค่ชื่อสถานที่",
    allFake.queries.every((q) => q.includes("บ้านสวนริมน้ำ")) &&
      !allFake.queries.some((q) => q.includes("กระบี่")),
    `ได้ ${allFake.queries.join(" | ")}`
  );

  // "จังหวัดเชียงใหม่" (มีคำนำหน้า) → ยังถือว่ามีที่มา
  const prefixed = normalizePlaceResolution(
    { ...base, admin: { province: "จังหวัดเชียงใหม่" } },
    input
  );
  eq("มีคำนำหน้า 'จังหวัด' → ยังเก็บ", prefixed.admin.province, "จังหวัดเชียงใหม่");

  // ชื่อที่ไม่มีในหลักฐาน → ทิ้งทั้งชื่อ
  const noName = normalizePlaceResolution(
    {
      ...base,
      place_name: "บ้านพักริมน้ำ",
    },
    input
  );
  check("ชื่อที่ไม่โผล่ในหลักฐาน → ไม่มีชื่อ", noName.found === false);
}

// ─────────────────────────────────────────────
//  2) การเรียงคำค้น
// ─────────────────────────────────────────────
function testQueries() {
  console.log("\n=== 2) การเรียงคำค้น ===");

  eq(
    "คำค้นหลักฐานมาก่อน + เติม 'ประเทศไทย'",
    buildPlaceQueries(["บ้านสวนริมน้ำ บ้านป่า"], ["บ้านสวนริมน้ำ", "เชียงใหม่"]),
    ["บ้านสวนริมน้ำ บ้านป่า ประเทศไทย", "บ้านสวนริมน้ำ เชียงใหม่ ประเทศไทย"]
  );

  eq(
    "คำค้นซ้ำ → เก็บครั้งเดียว",
    buildPlaceQueries(["บ้านสวนริมน้ำ"], ["บ้านสวนริมน้ำ"]),
    ["บ้านสวนริมน้ำ ประเทศไทย"]
  );

  eq(
    "คำค้นที่มี 'ประเทศไทย' อยู่แล้ว → ไม่เติมซ้ำ",
    buildPlaceQueries(["บ้านสวนริมน้ำ ประเทศไทย"], []),
    ["บ้านสวนริมน้ำ ประเทศไทย"]
  );

  eq("ไม่มีอะไรเลย → ไม่มีคำค้น", buildPlaceQueries([], []), []);

  eq(
    "ช่องว่าง/ค่าว่าง → ข้าม",
    buildPlaceQueries(["", "  "], ["", null, undefined, "บ้านป่า"]),
    ["บ้านป่า ประเทศไทย"]
  );
}

// ─────────────────────────────────────────────
//  3) การค้นหลายคำ
// ─────────────────────────────────────────────
async function testMultiSearch() {
  console.log("\n=== 3) การค้นหลายคำ ===");

  const a = fake("p1", "บ้านสวนริมน้ำ", "บ้านป่า");
  const b = fake("p2", "รีสอร์ตบ้านสวน", "บ้านป่วง");
  const c = fake("p3", "คาเฟ่ริมน้ำ", "บ้านป่า");

  // ตัดซ้ำข้ามคำค้น
  const dedup = await searchPlaceCandidatesMulti(["คำที่ 1", "คำที่ 2"], {
    search: async (q) => (q === "คำที่ 1" ? [a, b] : [a, c]),
  });
  eq("ผลซ้ำข้ามคำค้น → ตัดทิ้ง", dedup.candidates.map((x) => x.placeId), [
    "p1",
    "p2",
    "p3",
  ]);
  eq("นับจำนวนคำค้นที่ยิงจริง", dedup.queries.length, 2);

  // จำกัดจำนวนผู้สมัคร
  const capped = await searchPlaceCandidatesMulti(["คำที่ 1", "คำที่ 2"], {
    maxCandidates: 2,
    search: async (q) => (q === "คำที่ 1" ? [a, b, c] : [a]),
  });
  eq("เกิน maxCandidates → หยุดเก็บ", capped.candidates.length, 2);
  eq("ครบจำนวนแล้ว → ไม่ยิงคำค้นถัดไป", capped.queries.length, 1);

  // เจอผู้สมัครที่ตรงขอบเขต → หยุดเร็ว (ประหยัดค่าเรียก API)
  const early = await searchPlaceCandidatesMulti(["คำที่ 1", "คำที่ 2"], {
    scope: { subdistrict: "บ้านป่า", province: "เชียงใหม่" },
    search: async (q) => (q === "คำที่ 1" ? [a] : [b]),
  });
  eq("เจอผู้สมัครตรงตำบล → หยุดก่อนคำค้นถัดไป", early.queries.length, 1);

  // ไม่มีผู้สมัครตรงขอบเขต → ยิงต่อ
  const noScopeHit = await searchPlaceCandidatesMulti(["คำที่ 1", "คำที่ 2"], {
    scope: { subdistrict: "บ้านแฟน", province: "เชียงใหม่" },
    search: async (q) => (q === "คำที่ 1" ? [b] : [c]),
  });
  eq("ไม่มีผู้สมัครตรงขอบเขต → ยิงคำค้นถัดไป", noScopeHit.queries.length, 2);

  // คำค้นแรกล้มเหลว → ต้อง throw (ผิดพลาด ≠ ไม่เจอ)
  let threw = false;
  try {
    await searchPlaceCandidatesMulti(["คำที่ 1", "คำที่ 2"], {
      search: async () => {
        throw new Error("Google ล่ม");
      },
    });
  } catch {
    threw = true;
  }
  check("คำค้นแรกล้มเหลว → โยน error ออกไป (ไม่ใช่ 'ไม่เจอ')", threw);

  // คำค้นหลังล้มเหลว → เก็บผลที่ได้ไปต่อ
  const partial = await searchPlaceCandidatesMulti(["คำที่ 1", "คำที่ 2"], {
    search: async (q) => {
      if (q === "คำที่ 2") throw new Error("โควตาเต็ม");
      return [a];
    },
  });
  eq("คำค้นหลังล้มเหลว → ผลที่ได้ยังอยู่", partial.candidates.length, 1);
  eq("คำค้นหลังล้มเหลว → บันทึกไว้", partial.errors.length, 1);
}

// ─────────────────────────────────────────────
//  4) การกรองขอบเขต + การเรียงลำดับ
// ─────────────────────────────────────────────
async function testScopeAndOrder() {
  console.log("\n=== 4) การกรองขอบเขต + การเรียงลำดับ ===");

  const inSub = fake("p1", "บ้านสวนริมน้ำ", "บ้านป่า");
  const otherSub = fake("p2", "รีสอร์ตบ้านสวน", "บ้านป่วง");
  const otherProv = fake("p3", "บ้านสวนริมน้ำ", "บ้านป่า", "สันทิตย์", "ลำปาง");

  const scoped = await searchClipPlaceCandidates({
    evidenceQueries: ["บ้านสวนริมน้ำ"],
    fallbackParts: ["เชียงใหม่"],
    scope: { subdistrict: "บ้านป่า", district: "สันทิตย์", province: "เชียงใหม่" },
    search: async () => [inSub, otherSub, otherProv],
  });
  eq(
    "จังหวัดอื่น → ตัดทิ้ง (กรองแบบ strict)",
    scoped.candidates.map((c) => c.placeId),
    ["p1"]
  );
  eq("นับผู้สมัครดิบก่อนกรอง", scoped.rawCount, 3);

  // ไม่มีผู้สมัครในจังหวัดที่ขอเลย → เก็บไว้ให้ผู้ใช้ตัดสินใจ
  const wrongProvinceOnly = await searchClipPlaceCandidates({
    evidenceQueries: ["บ้านสวนริมน้ำ"],
    fallbackParts: [],
    scope: { subdistrict: "บ้านป่า", district: "สันทิตย์", province: "เชียงใหม่" },
    search: async () => [otherProv],
  });
  eq(
    "ไม่มีใครอยู่จังหวัดที่ขอ → ไม่ตัดทิ้งทั้งหมด",
    wrongProvinceOnly.candidates.map((c) => c.placeId),
    ["p3"]
  );

  // ไม่มีขอบเขต → ไม่กรอง
  const unscoped = await searchClipPlaceCandidates({
    evidenceQueries: ["บ้านสวนริมน้ำ"],
    fallbackParts: [],
    search: async () => [inSub, otherSub, otherProv],
  });
  eq("ไม่ส่งขอบเขต → ไม่กรอง", unscoped.candidates.length, 3);

  // ลำดับ: ระดับขอบเขตมาก่อน แล้วค่อยคะแนน AI
  const village = fake("v1", "บ้านของชุมชน", "บ้านป่า");
  village.matchLevel = "village";
  village.aiScore = 0.2;
  const subLow = fake("s1", "รีสอร์ตบ้านสวน", "บ้านป่า");
  subLow.matchLevel = "subdistrict";
  subLow.aiScore = 0.4;
  const subHigh = fake("s2", "โฮมสเตย์บ้านสวน", "บ้านป่า");
  subHigh.matchLevel = "subdistrict";
  subHigh.aiScore = 0.9;

  const ordered = sortPlaceCandidates([subLow, village, subHigh]);
  eq(
    "ระดับขอบเขต (หมู่บ้าน) มาก่อนระดับตำบล",
    ordered.map((c) => c.placeId),
    ["v1", "s2", "s1"]
  );

  const sameLevel = sortPlaceCandidates([subLow, subHigh]);
  eq(
    "ระดับเดียวกัน → คะแนน AI ตัดสิน",
    sameLevel.map((c) => c.placeId),
    ["s2", "s1"]
  );
}

// ─────────────────────────────────────────────
//  5) การจับคู่ชื่อกับผลของ Google
// ─────────────────────────────────────────────
function testNameMatch() {
  console.log("\n=== 5) การจับคู่ชื่อกับผลของ Google ===");

  check("ชื่อเดียวกัน → ตรง", placeNameLooksRight("บ้านสวนริมน้ำ", "บ้านสวนริมน้ำ"));
  check(
    "ชื่อที่ Google ใส่คำนำหน้า → ตรง",
    placeNameLooksRight("ดอยสุเทพ", "วัดพระธาตุดอยสุเทพราชวรวิหาร")
  );
  check(
    "มีช่องว่าง/ขีดคั่น → ตรง",
    placeNameLooksRight("ดอยสุเทพ", "อุทยานแห่งชาติดอยสุเทพ-ปุย")
  );
  check(
    "ชื่อคนละที่ → ไม่ตรง (ไม่เอาพิกัดผิด)",
    !placeNameLooksRight("ดอยสุเทพ", "ดอยตุง")
  );
  check(
    "ชื่อคนละที่แต่คำคล้าย → ไม่ตรง",
    !placeNameLooksRight("บ้านสวนริมน้ำ", "คาเฟ่ริมน้ำ")
  );
  check("ชื่อว่าง → ไม่ตรง", !placeNameLooksRight("", "บ้านสวนริมน้ำ"));
}

// ─────────────────────────────────────────────
//  6) การอ่านชื่อจากสองทาง (เสียงพูด / ตัวหนังสือบนจอ)
// ─────────────────────────────────────────────
function testReadings() {
  console.log("\n=== 6) การอ่านชื่อจากสองทาง ===");

  const input: VideoAnalysisInput = {
    transcript: "ที่นี่คือบ้านสวนริมน้ำนะครับ",
    audioType: "speech",
    onScreenText: ["บ้านสวนริมน้ำ", "ตำบลบ้านป่า"],
  };

  // ── ชื่อเดียวกันทั้งสองทาง → reading เดียว + คำค้นเดียว ──
  const same = normalizePlaceResolution(
    {
      found: true,
      place_name: "บ้านสวนริมน้ำ",
      confidence: 0.9,
      readings: [
        { source: "transcript", place_name: "บ้านสวนริมน้ำ", quote: "ที่นี่คือบ้านสวนริมน้ำนะครับ" },
        { source: "on_screen_text", place_name: "บ้านสวนริมน้ำ", quote: "บ้านสวนริมน้ำ" },
      ],
      evidence: [],
      queries: [],
    },
    input
  );
  eq("ชื่อเดียวกันทั้งสองทาง → เก็บ reading เดียว", same.readings.length, 1);
  eq("ชื่อเดียวกัน → คำค้นเดียว", same.queries.length, 1);
  check("ชื่อหลักมาจากเสียงพูด", same.placeName === "บ้านสวนริมน้ำ");

  // ── ชื่อต่างกัน → สอง reading + สองคำค้น (ผู้ใช้ต้องเลือกเอง) ──
  const diff = normalizePlaceResolution(
    {
      found: true,
      place_name: "บ้านสวนริมน้ำ",
      confidence: 0.8,
      readings: [
        { source: "transcript", place_name: "บ้านสวนริมน้ำ", quote: "ที่นี่คือบ้านสวนริมน้ำนะครับ" },
        { source: "on_screen_text", place_name: "รีสอร์ตบ้านสวน", quote: "รีสอร์ตบ้านสวน" },
      ],
      evidence: [],
      queries: [],
    },
    { ...input, onScreenText: ["รีสอร์ตบ้านสวน", "ตำบลบ้านป่า"] }
  );
  eq("ชื่อต่างกัน → เก็บสอง reading", diff.readings.length, 2);
  eq("ชื่อต่างกัน → ค้นสองคำค้น", diff.queries.length, 2);
  check(
    "คำค้นสองคำค้นคือชื่อที่ต่างกัน",
    diff.queries.some((q) => q.includes("บ้านสวนริมน้ำ")) &&
      diff.queries.some((q) => q.includes("รีสอร์ตบ้านสวน")),
    `ได้ ${diff.queries.join(" | ")}`
  );
  check("ชื่อหลักยังเป็นของเสียงพูด", diff.placeName === "บ้านสวนริมน้ำ");

  // ── quote ที่ไม่มีจริงในแหล่งนั้น → ทิ้ง reading นั้น ──
  const fakeQuote = normalizePlaceResolution(
    {
      found: true,
      place_name: "บ้านสวนริมน้ำ",
      confidence: 0.8,
      readings: [
        { source: "transcript", place_name: "บ้านสวนริมน้ำ", quote: "ที่นี่คือบ้านสวนริมน้ำนะครับ" },
        { source: "on_screen_text", place_name: "รีสอร์ตบ้านสวน", quote: "คำที่ไม่มีในคลิปเลย" },
      ],
      evidence: [],
      queries: [],
    },
    input
  );
  eq("quote ที่ไม่มีจริง → ทิ้ง reading", fakeQuote.readings.length, 1);

  // ── ชื่อที่ไม่ได้อยู่ใน quote → ทิ้ง ──
  const nameNotInQuote = normalizePlaceResolution(
    {
      found: true,
      place_name: "บ้านสวนริมน้ำ",
      confidence: 0.8,
      readings: [
        { source: "transcript", place_name: "บ้านพักริมน้ำ", quote: "ที่นี่คือบ้านสวนริมน้ำนะครับ" },
      ],
      evidence: [],
      queries: [],
    },
    input
  );
  eq("ชื่อที่ไม่ได้อยู่ใน quote → ทิ้ง reading", nameNotInQuote.readings.length, 0);
  check(
    "reading หลุด → ถอยไปใช้ชื่อที่มีในคลิป (สำรองของเดิม)",
    nameNotInQuote.found === true &&
      nameNotInQuote.placeName === "บ้านสวนริมน้ำ",
    `ได้ ${nameNotInQuote.placeName}`
  );

  // ── มี reading ที่ผ่าน แม้โมเดลจะตอบ found = false ──
  const foundAnyway = normalizePlaceResolution(
    {
      found: false,
      place_name: "บ้านสวนริมน้ำ",
      confidence: 0.8,
      readings: [
        { source: "on_screen_text", place_name: "บ้านสวนริมน้ำ", quote: "บ้านสวนริมน้ำ" },
      ],
      evidence: [],
      queries: [],
    },
    input
  );
  check("มี reading ที่ผ่าน → มีชื่อ (แม้โมเดลบอกว่าไม่เจอ)", foundAnyway.found);
  eq("ชื่อหลักมาจากป้ายบนจอ (ไม่มีเสียง)", foundAnyway.placeName, "บ้านสวนริมน้ำ");
}

// ─────────────────────────────────────────────
//  7) โหมด "ค้นทุกคำค้น" (มีชื่อ 2 ค่า)
// ─────────────────────────────────────────────
async function testSearchAll() {
  console.log("\n=== 7) ค้นทุกคำค้นเมื่อมีชื่อ 2 ค่า ===");

  const a = fake("p1", "บ้านสวนริมน้ำ", "บ้านป่า");
  const b = fake("p2", "รีสอร์ตบ้านสวน", "บ้านป่วง");
  const scope = {
    community: null,
    subdistrict: "บ้านป่า",
    district: "สันทิตย์",
    province: "เชียงใหม่",
  };

  // คำแรกเจอผู้สมัครตรงตำบล → โหมดปกติหยุดที่คำแรก (ไม่ยิงคำที่สอง)
  const stopped = await searchPlaceCandidatesMulti(
    ["บ้านสวนริมน้ำ", "รีสอร์ตบ้านสวน"],
    {
      scope,
      search: async (q) => (q.includes("ริมน้ำ") ? [a] : [b]),
    }
  );
  eq("โหมดปกติ → หยุดที่คำแรกที่ตรงขอบเขต", stopped.queries.length, 1);

  // โหมด "ค้นทุกคำ" → ต้องได้ผู้สมัครของทั้งสองชื่อ
  const all = await searchPlaceCandidatesMulti(
    ["บ้านสวนริมน้ำ", "รีสอร์ตบ้านสวน"],
    {
      scope,
      searchAll: true,
      search: async (q) => (q.includes("ริมน้ำ") ? [a] : [b]),
    }
  );
  eq("โหมดค้นทุกคำ → ยิงครบทั้งสองคำ", all.queries.length, 2);
  eq("โหมดค้นทุกคำ → ได้ผู้สมัครทั้งสองชื่อ", all.candidates.length, 2);
  check(
    "ผู้สมัครของชื่อที่สองไม่หายไป",
    all.candidates.some((c) => c.placeId === "p2"),
    `ได้ ${all.candidates.map((c) => c.placeId).join(", ")}`
  );
}

async function main() {
  console.log("=== เทสต์สาย 'หาสถานที่' (ไม่ต่อเน็ต) ===");
  testEvidence();
  testQueries();
  await testMultiSearch();
  await testScopeAndOrder();
  testNameMatch();
  testReadings();
  await testSearchAll();

  console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("เทสต์ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
