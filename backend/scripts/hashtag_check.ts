/**
 * Offline check of the hashtag normalizer — no network, no keys.
 *
 * The caption route runs the model's hashtags through a deterministic
 * normalizer before the app ever sees them. That normalizer used to strip
 * every Thai vowel / tone mark (they are Unicode category Mn, not \p{L}),
 * so "#ที่พักริมนา" came out as "ทพกรมนา" and the broken string was
 * persisted to videos.hashtags.
 *
 * This script feeds the normalizer a set of values and prints what came
 * out, so the bug is visible without an app and without an API call.
 *
 *   cd backend
 *   npm run check:hashtag
 *
 * Exits with code 1 if any case fails, so it can be used as a gate.
 */

import { normalizeHashtag, pickHashtagSuggestions } from "../src/hashtagText";
import { planHashtagFix, legacyNormalizeHashtag } from "./fix_hashtags";

interface Case {
  name: string;
  input: unknown;
  expected: string;
}

const cases: Case[] = [
  {
    name: "ไทยมีสระครบ → ต้องรอดทุกตัว",
    input: "#ที่พักริมนา",
    expected: "ที่พักริมนา",
  },
  {
    name: "ไทยมีวรรณยุกต์ → ต้องรอด",
    input: "#คาเฟ่ริมน้ำ",
    expected: "คาเฟ่ริมน้ำ",
  },
  {
    name: "ไทยมีสระหลายตัว → ต้องรอด",
    input: "#บ้านไม้เชียงใหม่",
    expected: "บ้านไม้เชียงใหม่",
  },
  {
    name: "ไทยมีทัณฑฆาต → ต้องรอด",
    input: "#วัดดอยสุเทพ",
    expected: "วัดดอยสุเทพ",
  },
  {
    name: "ไทยมีไม้ไต่คู้ (ฺ) → ต้องรอด",
    input: "#ชิลล์",
    expected: "ชิลล์",
  },
  {
    name: "สระเอก (เ/แ เป็นตัวอักษร) → ต้องรอด",
    input: "#เก้า",
    expected: "เก้า",
  },
  {
    name: "อังกฤษ → ต้องรอด",
    input: "#CoffeeShop",
    expected: "CoffeeShop",
  },
  {
    name: "อังกฤษผสมไทย → ต้องรอด",
    input: "#MaeHongSon",
    expected: "MaeHongSon",
  },
  {
    name: "ไม่มี # นำหน้า → ต้องได้ค่าเดียวกับกรณีมี #",
    input: "ที่พักริมนา",
    expected: "ที่พักริมนา",
  },
  {
    name: "# นำหน้าหลายตัว → ต้องถูกตัดหมด",
    input: "##ที่พัก",
    expected: "ที่พัก",
  },
  {
    name: "ช่องว่าง → ต้องถูกลบ",
    input: "# Coffee Shop ",
    expected: "CoffeeShop",
  },
  {
    name: "สัญลักษณ์แปลกปลอม → ต้องถูกตัด",
    input: "#ที่+พัก",
    expected: "ที่พัก",
  },
  {
    name: "ค่าว่าง → ต้องได้ค่าว่าง",
    input: "",
    expected: "",
  },
  {
    name: "ค่าที่ไม่ใช่ข้อความ (null) → ต้องได้ค่าว่าง",
    input: null,
    expected: "",
  },
  {
    name: "ค่าที่ไม่ใช่ข้อความ (ตัวเลข) → ต้องได้ค่าว่าง",
    input: 123,
    expected: "",
  },
  {
    name: "ยาวเกิน 40 ตัว → ต้องถูกตัด",
    input: "#" + "กำ".repeat(30),
    expected: "กำ".repeat(20),
  },
  {
    name: "มาร์กหน้าคำโดยไม่มีตัวอักษรนำหน้า → ต้องถูกตัด",
    input: "#่ทด",
    expected: "ทด",
  },
  {
    name: "อีโมจิที่มี VS16 → ต้องเป็นค่าว่าง (ไม่ใช่มาร์กลอย)",
    input: "#❤️",
    expected: "",
  },
  {
    name: "คำไทยที่ไม่มีสระ/วรรณยุกต์ → ต้องไม่ถูกแก้",
    input: "#ไทย",
    expected: "ไทย",
  },
  {
    name: "คำไทยที่ไม่มีสระ/วรรณยุกต์ → ต้องไม่ถูกแก้",
    input: "#ปาย",
    expected: "ปาย",
  },
];

let failed = 0;

console.log("=== hashtag normalize check ===\n");

for (const c of cases) {
  const got = normalizeHashtag(c.input);
  const ok = got === c.expected;
  if (!ok) failed++;
  console.log(`— ${c.name}`);
  console.log(`   in:  ${JSON.stringify(c.input)}`);
  if (ok) {
    console.log(`   got: ${JSON.stringify(got)}`);
  } else {
    console.log(`   got: ${JSON.stringify(got)}  ← คาดว่า ${JSON.stringify(c.expected)}`);
  }
  console.log("");
}

/**
 * ตัวแปลงเดิม (ก่อนแก้บั๊ก) — เอาไว้เทียบว่าของใหม่ดีกว่ายังไง
 * ต้องตรงกับที่เคยอยู่ใน aiClient.ts เป๊ะ ๆ ไม่งั้นการกู้ข้อมูลเก่าจะเทียบผิด
 */
console.log("=== ตัวแปลงเดิม (ก่อนแก้บั๊ก) ===\n");
const legacySamples: [string, string][] = [
  ["#ที่พักริมนา", "ทพกรมนา"],
  ["#คาเฟ่ริมน้ำ", "คาเฟรมนำ"],
  ["#ชิลล์", "ชลล"],
];
for (const [input, expected] of legacySamples) {
  const got = legacyNormalizeHashtag(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ผ่าน" : "ไม่ผ่าน"} — ${input} → ${JSON.stringify(got)}`);
  if (!ok) console.log(`   ← คาดว่า ${JSON.stringify(expected)}`);
}
console.log("");

/**
 * การกันแฮชแท็กซ้ำ — logic เดียวกับที่ generateCaptions ใช้
 *
 * ผู้ใช้ที่พิมพ์แฮชแท็กเอง "#ที่พักริมนา" ต้องกันไม่ให้ AI เสนอซ้ำ
 * ทั้งสองฝั่งถูก normalize ด้วยโค้ดเดียวกัน → ผลลัพธ์ตรงกันเสมอ
 */
console.log("=== dedupe (กันแฮชแท็กซ้ำ) ===\n");

const picked = pickHashtagSuggestions(
  ["#ที่พักริมนา", "#คาเฟ่ริมน้ำ", "#คาเฟ่ริมน้ำ", "#วัดดอยสุเทพ"],
  ["#ที่พักริมนา", "คาเฟ่"]
);
const expectedPicked = ["คาเฟ่ริมน้ำ", "วัดดอยสุเทพ"];
const dedupeOk = JSON.stringify(picked) === JSON.stringify(expectedPicked);
if (!dedupeOk) failed++;
console.log(`— ไม่เสนอซ้ำกับของผู้ใช้ + ไม่เสนอซ้ำกันเอง`);
console.log(`   เหลือ: ${JSON.stringify(picked)}`);
if (!dedupeOk) console.log(`   ← คาดว่า ${JSON.stringify(expectedPicked)}`);
console.log("");

const capped = pickHashtagSuggestions(
  Array.from({ length: 20 }, (_, i) => `#แท็ก${i}`),
  []
);
const capOk = capped.length === 8;
if (!capOk) failed++;
console.log(`${capOk ? "ผ่าน" : "ไม่ผ่าน"} — เสนอไม่เกิน 8 อัน (ได้ ${capped.length})`);
console.log("");

/**
 * การกู้แฮชแท็กที่สระหาย — logic เดียวกับที่ scripts/fix_hashtags.ts ใช้ตอนรันจริง
 *
 * กู้ได้ก็ต่อเมื่อเจอ "ต้นฉบับ" ที่พอดีหนึ่งค่า — ถ้ากำกวมหรือไม่มี ต้องไม่กู้
 */
console.log("=== การกู้แฮชแท็ก (match logic) ===\n");

const fixCases: {
  name: string;
  video: { id: string; hashtags: unknown; ai_summary: unknown };
  analysesTags?: string[];
  analysesPlace?: string[];
  expectedNext: string[];
  expectedFixes: number;
  expectedReview: number;
}[] = [
  {
    name: "เสียสระ + มีต้นฉบับใน summary → กู้ได้เฉพาะตัวที่มีต้นฉบับ (อีกตัวขึ้นรายการตรวจ)",
    video: {
      id: "v1",
      hashtags: ["#ทพกรมนา", "#คาเฟ"],
      ai_summary: { place: { tags: ["ที่พักริมนา"] } },
    },
    expectedNext: ["#ที่พักริมนา", "#คาเฟ"],
    expectedFixes: 1,
    expectedReview: 1,
  },
  {
    name: "เสียสระ + มีต้นฉบับใน video_ai_analyses → ต้องกู้ได้",
    video: { id: "v2", hashtags: ["#วดดอยสเทพ"], ai_summary: null },
    analysesTags: ["วัดดอยสุเทพ"],
    expectedNext: ["#วัดดอยสุเทพ"],
    expectedFixes: 1,
    expectedReview: 0,
  },
  {
    name: "เสียสระ + ไม่มีต้นฉบับ → ต้องไม่กู้ แต่ต้องขึ้นรายการตรวจ",
    video: {
      id: "v3",
      hashtags: ["#คาเฟรมนำ"],
      ai_summary: { place: { tags: ["คาเฟ่"] } },
    },
    expectedNext: ["#คาเฟรมนำ"],
    expectedFixes: 0,
    expectedReview: 1,
  },
  {
    name: "แฮชแท็กที่ปกติ → ต้องไม่ถูกแตะ",
    video: {
      id: "v4",
      hashtags: ["#ที่พักริมนา", "#CoffeeShop"],
      ai_summary: { place: { tags: ["ที่พักริมนา"] } },
    },
    expectedNext: ["#ที่พักริมนา", "#CoffeeShop"],
    expectedFixes: 0,
    expectedReview: 0,
  },
  {
    name: "ต้นฉบับกำกวม (สองค่าต่างกันแต่พยัญชนะเดียวกัน) → ต้องไม่กู้",
    video: {
      id: "v5",
      hashtags: ["#ทพกรมนา"],
      ai_summary: { place: { tags: ["ที่พักริมนา"], place_name: "ทีพักริมนา" } },
    },
    expectedNext: ["#ทพกรมนา"],
    expectedFixes: 0,
    expectedReview: 1,
  },
  {
    name: "ต้นฉบับมี # นำหน้า (โมเดลส่งมาแบบนี้) → ต้องกู้ได้",
    video: {
      id: "v6",
      hashtags: ["#ทพกรมนา"],
      ai_summary: { place: { tags: ["#ที่พักริมนา"] } },
    },
    expectedNext: ["#ที่พักริมนา"],
    expectedFixes: 1,
    expectedReview: 0,
  },
  {
    name: "ต้นฉบับมีช่องว่าง → ต้องกู้ได้ (กุญแจคือตัวแปลงเดิม)",
    video: {
      id: "v7",
      hashtags: ["#ทพกรมนำ"],
      ai_summary: { place: { tags: ["ที่พัก ริมน้ำ"] } },
    },
    expectedNext: ["#ที่พักริมน้ำ"],
    expectedFixes: 1,
    expectedReview: 0,
  },
  {
    name: "ค่าที่เก็บอยู่ถูกต้องอยู่แล้ว → ต้องไม่ถูกเขียนทับ",
    video: {
      id: "v8",
      hashtags: ["#ที่พักริมนา"],
      ai_summary: { place: { tags: ["ที่พักริมนา"] } },
    },
    expectedNext: ["#ที่พักริมนา"],
    expectedFixes: 0,
    expectedReview: 0,
  },
  {
    name: "ค่าที่เก็บอยู่มีสระอยู่แล้ว → ต้องไม่ถูกแตะแม้จะมีต้นฉบับที่พยัญชนะเดียวกัน",
    video: {
      id: "v9",
      hashtags: ["#ทีพักริมนา"],
      ai_summary: { place: { tags: ["ที่พักริมนา"] } },
    },
    expectedNext: ["#ทีพักริมนา"],
    expectedFixes: 0,
    expectedReview: 0,
  },
  {
    name: "ต้นฉบับที่ไม่มีสระต้องไม่ทำให้เกิดความกำกวมปลอม → ต้องกู้ได้",
    video: {
      id: "v10",
      hashtags: ["#ทพกรมนา"],
      ai_summary: { place: { tags: ["ที่พักริมนา", "ทพกรมนา"] } },
    },
    expectedNext: ["#ที่พักริมนา"],
    expectedFixes: 1,
    expectedReview: 0,
  },
];

for (const c of fixCases) {
  const plan = planHashtagFix(c.video, c.analysesTags ?? [], c.analysesPlace ?? []);
  const nextOk = JSON.stringify(plan.next) === JSON.stringify(c.expectedNext);
  const fixesOk = plan.fixes.length === c.expectedFixes;
  const reviewOk = plan.needsReview.length === c.expectedReview;
  const ok = nextOk && fixesOk && reviewOk;
  if (!ok) failed++;
  console.log(`— ${c.name}`);
  console.log(`   next:   ${JSON.stringify(plan.next)}`);
  if (!nextOk) console.log(`   ← คาดว่า ${JSON.stringify(c.expectedNext)}`);
  console.log(`   กู้ได้ ${plan.fixes.length} · ต้องตรวจ ${plan.needsReview.length}`);
  if (!fixesOk) console.log(`   ← คาดว่า กู้ได้ ${c.expectedFixes}`);
  if (!reviewOk) console.log(`   ← คาดว่า ต้องตรวจ ${c.expectedReview}`);
  console.log("");
}

const total = cases.length + 1 + fixCases.length;

if (failed === 0) {
  console.log(`ผ่านทั้งหมด ${total} เคส`);
} else {
  console.log(`ไม่ผ่าน ${failed} จาก ${total} เคส`);
  process.exitCode = 1;
}
