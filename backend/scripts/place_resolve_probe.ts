/**
 * ทดสอบรอบ "หาสถานที่" (resolvePlace) เดี่ยว ๆ — ยังไม่ต่อ Google Places
 * -------------------------------------------------------------
 * รอบนี้ทำงานแยกจากรอบสรุป: มีหน้าที่เดียวคือหาชื่อสถานที่ **พร้อมหลักฐาน**
 * ที่ฝั่งโค้ดตรวจสอบได้ (ดู `resolvePlace` ใน `src/aiClient.ts`)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * รันเอง — ใช้คีย์ใน backend/.env และส่งคลิปไปให้ Gemini + AI endpoint:
 *
 *   cd backend
 *   npm run probe:place -- "<public-video-url>"
 *
 * ถ้าไม่มี URL ให้ลองด้วยแคปชัน/ถอดเสียงที่พิมพ์มา:
 *
 *   npm run probe:place -- "" "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า จังหวัดเชียงใหม่"
 *
 * ทุกอย่างในไฟล์นี้เป็น **read-only** — อ่านอย่างเดียว ไม่เขียนฐานข้อมูล /
 * ไม่มีการเอาคีย์มาใส่บรรทัดคำสั่ง (อ่านจาก backend/.env ผ่าน src/config.ts)
 * ─────────────────────────────────────────────────────────────────────────
 */

import { transcribeVideo } from "../src/geminiTranscribe";
import { resolvePlace, normalizePlaceResolution, rankPlaceCandidates } from "../src/aiClient";
import type { VideoAnalysisInput } from "../src/prompt";
import type { PlaceCandidate } from "../src/placeTypes";

/** ย่อข้อความแบบเดียวกับฝั่ง aiClient — ใช้ตรวจว่าหลักฐานอยู่จริงไหม */
function foldText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function appearsIn(quote: string, text: string): boolean {
  const n = foldText(quote);
  return !!n && foldText(text).includes(n);
}

/**
 * ผู้สมัครปลอม ๆ ทำหน้าที่แทนผลจาก Google
 * -------------------------------------------------------------
 * ตอนนี้ยังไม่ได้ต่อ Google Places (เป็นก้อนที่ 2) → ใช้ชุดนี้แทนเพื่อทดสอบ
 * ว่า "การจัดอันดับ" เลือกตัวที่ตรงกับหลักฐานที่สุดจริงไหม
 * ตัวที่ 1 คือคำตอบที่ถูก · ตัวที่ 2 ชื่อคล้ายแต่คนละตำบล · ตัวที่ 3 ชื่อกว้าง
 * · ตัวที่ 4 คนละประเภทแต่ตำบลเดียวกัน
 */
const FAKE_CANDIDATES: PlaceCandidate[] = [
  {
    name: "บ้านสวนริมน้ำ",
    address: "บ้านสวนริมน้ำ ตำบลบ้านป่า อำเภอสันทิตย์ จังหวัดเชียงใหม่",
    placeId: "fake-1",
    latitude: null,
    longitude: null,
    province: "เชียงใหม่",
    district: "สันทิตย์",
    subdistrict: "บ้านป่า",
    types: ["lodging"],
    primaryType: "lodging",
    primaryTypeDisplayName: "ที่พัก",
    rating: 4.5,
    userRatingCount: 120,
  },
  {
    name: "บ้านสวนริมน้ำ (บ้านป่วง)",
    address: "บ้านสวนริมน้ำ ตำบลบ้านป่วง อำเภอสันทิตย์ จังหวัดเชียงใหม่",
    placeId: "fake-2",
    latitude: null,
    longitude: null,
    province: "เชียงใหม่",
    district: "สันทิตย์",
    subdistrict: "บ้านป่วง",
    types: ["lodging"],
    primaryType: "lodging",
    primaryTypeDisplayName: "ที่พัก",
    rating: 4.1,
    userRatingCount: 30,
  },
  {
    name: "รีสอร์ตบ้านสวน",
    address: "รีสอร์ตบ้านสวน ตำบลแม่ริม อำเภอแม่ริม จังหวัดเชียงใหม่",
    placeId: "fake-3",
    latitude: null,
    longitude: null,
    province: "เชียงใหม่",
    district: "แม่ริม",
    subdistrict: "แม่ริม",
    types: ["lodging"],
    primaryType: "lodging",
    primaryTypeDisplayName: "รีสอร์ท",
    rating: 4.3,
    userRatingCount: 80,
  },
  {
    name: "คาเฟ่ริมน้ำ",
    address: "คาเฟ่ริมน้ำ ตำบลบ้านป่า อำเภอสันทิตย์ จังหวัดเชียงใหม่",
    placeId: "fake-4",
    latitude: null,
    longitude: null,
    province: "เชียงใหม่",
    district: "สันทิตย์",
    subdistrict: "บ้านป่า",
    types: ["cafe"],
    primaryType: "cafe",
    primaryTypeDisplayName: "คาเฟ่",
    rating: 4.6,
    userRatingCount: 200,
  },
];

/**
 * เทสต์ "การ์ดความแม่น" ของฝั่งโค้ด — ไม่ต้องต่อเน็ต
 * -------------------------------------------------------------
 * กฎที่ต้องพิสูจน์ว่า "ทำงานจริง":
 *   1) quote ที่ไม่มีในคลิป → ทิ้ง
 *   2) ไม่เหลือหลักฐาน → ไม่มีชื่อ (found = false)
 *   3) ชื่อที่ไม่โผล่ในหลักฐานแบบตรวจได้ → ทิ้งชื่อ
 *   4) ชื่อที่ถูกต้องแต่โมเดลลืมใส่ quote → กู้หลักฐานให้เอง
 */
function selfTest() {
  const input: VideoAnalysisInput = {
    transcript:
      "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า อำเภอสันทิตย์ จังหวัดเชียงใหม่",
    audioType: "speech",
  };

  const cases: {
    name: string;
    raw: any;
    expectFound: boolean;
    expectPlace: string | null;
  }[] = [
    {
      name: "ชื่อถูก + quote ตรงเป๊ะ → ใช้ได้",
      raw: {
        found: true,
        place_name: "บ้านสวนริมน้ำ",
        admin: { province: "เชียงใหม่", district: "สันทิตย์", subdistrict: "บ้านป่า" },
        confidence: 0.9,
        evidence: [
          { source: "transcript", quote: "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า" },
        ],
        queries: ["บ้านสวนริมน้ำ ตำบลบ้านป่า จังหวัดเชียงใหม่"],
      },
      expectFound: true,
      expectPlace: "บ้านสวนริมน้ำ",
    },
    {
      name: "ชื่อหลอก + quote ที่ไม่มีในคลิป → ทิ้งทั้งชื่อ",
      raw: {
        found: true,
        place_name: "รีสอร์ตวาดกรุงเทพ",
        admin: {},
        confidence: 0.95,
        evidence: [{ source: "transcript", quote: "ที่นี่คือรีสอร์ตวาดกรุงเทพ" }],
        queries: ["รีสอร์ตวาดกรุงเทพ"],
      },
      expectFound: false,
      expectPlace: null,
    },
    {
      name: "quote หลอก แต่ชื่อโผล่ในคลิป → กู้หลักฐานให้เอง",
      raw: {
        found: true,
        place_name: "บ้านสวนริมน้ำ",
        admin: {},
        confidence: 0.8,
        evidence: [],
        queries: [],
      },
      expectFound: true,
      expectPlace: "บ้านสวนริมน้ำ",
    },
    {
      name: "ชื่อไม่อยู่ใน quote ที่ตรวจได้ → ทิ้งชื่อ",
      raw: {
        found: true,
        place_name: "บ้านพักริมน้ำ",
        admin: {},
        confidence: 0.8,
        evidence: [
          { source: "transcript", quote: "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า" },
        ],
        queries: [],
      },
      expectFound: false,
      expectPlace: null,
    },
    {
      name: "โมเดลบอกว่าไม่เจอ → ไม่มีชื่อ",
      raw: {
        found: false,
        place_name: "บ้านสวนริมน้ำ",
        admin: {},
        confidence: 0,
        evidence: [],
        queries: [],
      },
      expectFound: false,
      expectPlace: null,
    },
    {
      name: "คำค้นที่ไม่มีชื่อสถานที่ → ตัดทิ้ง",
      raw: {
        found: true,
        place_name: "บ้านสวนริมน้ำ",
        admin: { province: "เชียงใหม่" },
        confidence: 0.9,
        evidence: [
          { source: "transcript", quote: "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า" },
        ],
        queries: ["ตำบลบ้านป่า จังหวัดเชียงใหม่"],
      },
      expectFound: true,
      expectPlace: "บ้านสวนริมน้ำ",
    },
    {
      name: "source เป็นคำพวกนี้ (audio_transcript) → ยังตรวจได้",
      raw: {
        found: true,
        place_name: "บ้านสวนริมน้ำ",
        admin: {},
        confidence: 0.9,
        evidence: [
          {
            source: "audio_transcript",
            quote: "วันนี้พาไปที่บ้านสวนริมน้ำ ตำบลบ้านป่า",
          },
        ],
        queries: [],
      },
      expectFound: true,
      expectPlace: "บ้านสวนริมน้ำ",
    },
    {
      name: "source ที่ไม่รู้จัก → ทิ้งหลักฐาน (ไม่ใช่หลักฐานที่ตรวจได้)",
      raw: {
        found: true,
        // ชื่อนี้ไม่มีใน transcript → กู้หลักฐานไม่ได้ → ต้องทิ้ง
        place_name: "บ้านหวานริมน้ำ",
        admin: {},
        confidence: 0.9,
        evidence: [
          {
            source: "แหล่งที่ไม่มีอยู่จริง",
            quote: "วันนี้พาไปที่บ้านหวานริมน้ำ ตำบลบ้านป่า",
          },
        ],
        queries: [],
      },
      expectFound: false,
      expectPlace: null,
    },
  ];

  let pass = 0;
  for (const c of cases) {
    const out = normalizePlaceResolution(c.raw, input);
    const ok = out.found === c.expectFound && out.placeName === c.expectPlace;
    if (ok) pass++;
    console.log(
      `${ok ? "✅" : "❌"} ${c.name}\n     found=${out.found} place=${out.placeName ?? "-"} queries=${
        out.queries.join(" | ") || "-"
      }`
    );
  }
  console.log(`\nผ่าน ${pass}/${cases.length} เคส`);
  if (pass !== cases.length) process.exit(1);
}

async function main() {
  const arg1 = process.argv[2]?.trim() ?? "";

  // โหมดเทสต์กฎความแม่น — ไม่ต่อเน็ต ไม่ใช้คีย์
  if (arg1 === "--test" || arg1 === "-t") {
    console.log("=== เทสต์กฎความแม่น (ไม่ต่อเน็ต) ===");
    selfTest();
    return;
  }

  const url = arg1;
  const forcedTranscript = process.argv[3]?.trim();

  if (!url && !forcedTranscript) {
    console.error("ใช้: npm run probe:place -- <public-video-url> [transcript]");
    console.error("     หรือ: npm run probe:place -- --test   (เทสต์กฎความแม่น)");
    process.exit(1);
  }

  // ── 1. ถอดเสียง (Gemini) — ถ้ามี URL ──────────────────────────────────
  let transcript = forcedTranscript ?? "";
  let audioType: "speech" | "music" | "mixed" | "none" = "speech";
  if (url) {
    console.log("=== 1. ถอดเสียง (Gemini) ===");
    const t0 = Date.now();
    const result = await transcribeVideo(url);
    console.log(`[took] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (result?.transcript) {
      transcript = result.transcript;
      audioType = result.audioType ?? "speech";
      console.log(`transport=${result.transport} audioType=${result.audioType}`);
      console.log(`transcript: ${transcript}`);
    } else {
      console.warn("ถอดเสียงไม่สำเร็จ — จะรันรอบหาสถานที่โดยไม่มี transcript");
    }
  } else {
    console.log("=== 1. ใช้ transcript ที่ส่งมา ===");
    console.log(`transcript: ${transcript}`);
  }

  // ── 2. รอบหาสถานที่ ────────────────────────────────────────────────────
  console.log("\n=== 2. หาสถานที่ (AI — หน้าที่เดียว) ===");
  const t1 = Date.now();
  let raw: any = null;
  const resolution = await resolvePlace(
    { transcript: transcript || undefined, audioType, videoUrl: url || undefined },
    undefined,
    (r) => {
      raw = r;
    }
  );
  console.log(`[took] ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  if (raw) {
    console.log("\n--- คำตอบดิบจากโมเดล ---");
    console.log(JSON.stringify(raw, null, 2));
  }

  // ── 3. ผลลัพธ์หลังผ่านการตรวจหลักฐาน ────────────────────────────────
  console.log("\n--- ผลลัพธ์ที่ระบบจะใช้ ---");
  console.log(`found: ${resolution.found}`);
  console.log(`place_name: ${resolution.placeName ?? "-"}`);
  console.log(`community: ${resolution.community ?? "-"}`);
  console.log(
    `admin: ${[
      resolution.admin.village,
      resolution.admin.subdistrict,
      resolution.admin.district,
      resolution.admin.province,
    ]
      .filter(Boolean)
      .join(" / ") || "-"}`
  );
  console.log(`category: ${resolution.category ?? "-"}`);
  console.log(`confidence: ${resolution.confidence}`);
  console.log(`reason: ${resolution.reason ?? "-"}`);
  console.log(`queries: ${resolution.queries.length ? resolution.queries.join(" | ") : "-"}`);

  console.log(`\nหลักฐาน ${resolution.evidence.length} ชิ้น:`);
  if (!resolution.evidence.length) {
    console.log("  (ไม่มี — ระบบจะถอยไปใช้วิธีเดิม)");
  }
  for (const ev of resolution.evidence) {
    const inTranscript = transcript ? appearsIn(ev.quote, transcript) : null;
    const mark =
      ev.source === "visual"
        ? "หลักฐานอ่อน (อ่านจากภาพ — ตรวจสตริงไม่ได้)"
        : inTranscript
        ? "พบใน transcript"
        : "ไม่พบใน transcript (มาจากแคปชัน/ตัวหนังสือ/ที่อยู่ที่ผู้ใช้กรอก)";
    console.log(`  · (${ev.source}) "${ev.quote}"`);
    console.log(`      ${mark}${ev.note ? ` · ${ev.note}` : ""}`);
  }

  console.log(
    resolution.found
      ? "\n✅ มีชื่อที่มีหลักฐานรองรับ — เอา queries ไปค้น Google ได้"
      : "\n⚠️ ไม่มีชื่อที่มีหลักฐานรองรับ — ระบบจะถอยไปใช้ชื่อจากรอบสรุปแบบเดิม"
  );

  // ── 4. จัดอันดับผู้สมัคร (ใช้ผู้สมัครปลอม — Google จะต่อในก้อนที่ 2) ──
  if (!resolution.found) return;
  console.log("\n=== 3. จัดอันดับผู้สมัคร (AI) ===");
  const t2 = Date.now();
  const ranked = await rankPlaceCandidates(resolution, FAKE_CANDIDATES);
  console.log(`[took] ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  ranked.forEach((c, i) => {
    console.log(
      `  ${i + 1}. ${c.name} — ${c.address ?? ""}`
    );
    console.log(
      `     aiRank=${c.aiRank ?? "-"} aiScore=${c.aiScore ?? "-"} match=${
        c.evidenceMatch ?? "-"
      }`
    );
    console.log(`     เหตุผล: ${c.aiReason ?? "-"}`);
  });
  const top = ranked.find((c) => c.aiRank === 1);
  console.log(
    top?.placeId === "fake-1"
      ? `\n✅ อันดับ 1 คือผู้สมัครที่ตรงกับหลักฐานที่สุด`
      : `\n⚠️ อันดับ 1 คือ "${top?.name ?? "-"}" — ควรเป็น "บ้านสวนริมน้ำ" (ตำบลบ้านป่า)`
  );
}

main().catch((err) => {
  console.error("probe ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
