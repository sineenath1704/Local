/**
 * ทดสอบรอบ "แปลภาษา" (translateText) เดี่ยว ๆ — เทียบกับ prompt ปัจจุบันใน src/prompt.ts
 * -------------------------------------------------------------
 * เรียก `translateText` ตรงจาก src/aiClient.ts → ใช้ prompt ตัวที่แก้ล่าสุด
 * **ไม่ต้อง deploy** (แอปชี้ไป Vercel แต่สคริปต์นี้รันในเครื่อง)
 *
 * กระบวนการที่ทดสอบ (ฝั่ง backend ทำให้เอง ภายในคำขอเดียว):
 *   ตรวจภาษา + ค้นเว็บ → ความหมายกลาง (ไทยภาษากลาง) → ถ้าต้องแปลต่อก็แปลต่ออีกรอบ
 *
 * ─────────────────────────────────────────────────────────────────────────
 * รันเอง — ใช้คีย์ใน backend/.env (อ่านผ่าน src/config.ts ไม่มีการเอาคีย์มาใส่บรรทัดคำสั่ง):
 *
 *   cd backend
 *   npm run probe:translate
 *
 * ทุกอย่างในไฟล์นี้เป็น **read-only** — ยิงโมเดลอย่างเดียว ไม่เขียนฐานข้อมูล
 * ─────────────────────────────────────────────────────────────────────────
 */

import { translateText } from "../src/aiClient";
import { lookupLexicon, type TranslateInput } from "../src/prompt";

/** ป้ายเดียวกับฝั่งแอป (src/data/translateData.ts) */
const CENTRAL_TH = "ไทย (ภาษากลาง)";
const AUTO = "อัตโนมัติ — ตรวจหาให้";
const LANNA = "ล้านนา (ภาคเหนือ)";
const ISAN = "อีสาน (ภาคอีสาน)";
const PAKNAM = "ปักษ์ใต้ (ภาคใต้)";
const ENGLISH = "อังกฤษ";

interface Case {
  /** ป้ายเคสไว้ดูผล */
  name: string;
  text: string;
  /** ภาษาต้นทางที่ผู้ใช้เลือก (ค่าเริ่มต้น = auto) */
  sourceId?: string;
  sourceLabel?: string;
  /** ภาษาเป้าหมาย (ค่าเริ่มต้น = ไทยภาษากลาง) */
  targetId?: string;
  targetLabel?: string;
  /** ชื่อภาษาที่คาดว่าโมเดลจะตรวจเจอ */
  expectSource?: string;
  /** true = ต้องเป็น "ภาษาเดียวกันอยู่แล้ว" (เคสควบคุม) */
  expectSameLanguage?: boolean;
  /** ข้อความที่ต้องโผล่ในคำแปล (เช็คว่าแปลตรงความหมาย) */
  expectIn?: string[];
  /** ข้อความที่ห้ามโผล่ในคำแปล (กันโมเดลเติมคำเปล่า ๆ) */
  expectNot?: string[];
  /** ถ้า sameLanguage = false แล้วคำแปลต้องไม่เท่าต้นฉบับ */
  mustDiffer?: boolean;
  /** ความหมายกลางที่ต้องมี (ตอนปลายทางเป็นภาษาอื่น) */
  expectCentral?: string[];
  /** true = ปลายทางเป็นไทยกลาง → ต้องไม่มีความหมายกลางซ้ำ */
  expectNoCentral?: boolean;
}

/**
 * เคสหลัก = ภาษาถิ่น → ไทยภาษากลาง (สิ่งที่ผู้ใช้บ่นว่า "แปลไม่ตรง")
 * เคสควบคุม = ไทยภาษากลาง → ไทยภาษากลาง (ต้องตอบว่าเป็นภาษาเดียวกัน)
 * เคสปลายทาง = ภาษาถิ่น → ไทยกลาง → ภาษาต่างประเทศ (2 ขั้นในคำขอเดียว)
 */
const CASES: Case[] = [
  {
    name: "ล้านนา · คำห้าม (จะไปไป)",
    text: "จะไปไป",
    expectSource: "ล้านนา",
    expectIn: ["อย่าไป"],
    expectNot: ["ไปไปนะ", "กำลังจะไป"],
    mustDiffer: true,
  },
  {
    name: "ล้านนา · คำเดียว",
    text: "อะหยัง",
    expectSource: "ล้านนา",
    expectIn: ["อะไร"],
    expectNot: ["บ้าง", "อย่างไร"],
    mustDiffer: true,
  },
  {
    name: "ล้านนา · ประโยค (ไม่มีในพจนานุกรม)",
    text: "แปลงบ่ายหล่าแตง",
    expectSource: "ล้านนา",
    expectIn: ["ปลาย", "บ่าย"],
    mustDiffer: true,
  },
  {
    name: "อีสาน · คำเดียว",
    text: "อีหยัง",
    expectSource: "อีสาน",
    expectIn: ["อะไร"],
    expectNot: ["บ้าง", "อย่างไร"],
    mustDiffer: true,
  },
  {
    name: "อีสาน · ประโยค",
    text: "ตังอยู่จังหรี่",
    expectSource: "อีสาน",
    expectIn: ["ใคร", "ไหน"],
    mustDiffer: true,
  },
  {
    name: "ปักษ์ใต้ · ประโยค",
    text: "หวัดกินข้าวกับไข่",
    expectSource: "ปักษ์",
    expectIn: ["กำลัง", "กิน"],
    mustDiffer: true,
  },
  {
    name: "อังกฤษ → ไทย (ควบคุมฝั่งต่างประเทศ)",
    text: "How much is this?",
    expectSource: "อังกฤษ",
    expectIn: ["ราคา", "เท่าไร"],
    mustDiffer: true,
  },
  {
    name: "ไทยกลาง → ไทยกลาง (ควบคุม: ต้องเป็นภาษาเดียวกัน)",
    text: "สวัสดีครับ",
    expectSameLanguage: true,
    expectNoCentral: true,
  },
  {
    name: "ผู้ใช้เลือกต้นทาง = ล้านนาเอง (ต้องแปลจริง)",
    text: "จะไปไป",
    sourceId: "th-lanna",
    sourceLabel: LANNA,
    expectSource: "ล้านนา",
    expectIn: ["อย่าไป"],
    mustDiffer: true,
  },
  {
    name: "ล้านนา → อังกฤษ (2 ขั้นในคำขอเดียว)",
    text: "จะไปไป",
    targetId: "en",
    targetLabel: ENGLISH,
    expectSource: "ล้านนา",
    expectCentral: ["อย่าไป"],
    expectIn: ["don't", "do not"],
    mustDiffer: true,
  },
  // ---- เคสใหม่: กติกา "วลีก่อนคำเดี่ยว" + "หลายความหมาย" + "หลายรูปสะกด" ----
  {
    name: "ล้านนา · วลี (กิ๋นข้าวแล้วกา)",
    text: "กิ๋นข้าวแล้วกา",
    expectSource: "ล้านนา",
    expectIn: ["กินข้าว", "หรือยัง"],
    expectNot: ["กิ๋นข้าวแล้วกา"],
    mustDiffer: true,
  },
  {
    name: "ล้านนา · วลี (ไปตวยก่อ)",
    text: "ไปตวยก่อ",
    expectSource: "ล้านนา",
    expectIn: ["ไปด้วย", "ไหม"],
    expectNot: ["ไปตวย"],
    mustDiffer: true,
  },
  {
    name: "ล้านนา · วลี (บ่เป็นหยัง)",
    text: "บ่เป็นหยัง",
    expectSource: "ล้านนา",
    expectIn: ["ไม่เป็นไร"],
    mustDiffer: true,
  },
  {
    name: "อีสาน · รูปสะกดอื่น (จั่งใด๋)",
    text: "จั่งใด๋",
    expectSource: "อีสาน",
    expectIn: ["อย่างไร"],
    mustDiffer: true,
  },
  {
    name: "บ่ = ไหม (อยู่ท้ายคำถาม) · มาบ่",
    text: "มาบ่",
    expectIn: ["ไหม"],
    mustDiffer: true,
  },
  {
    name: "บ่ = ไม่ · บ่มี",
    text: "บ่มี",
    expectIn: ["ไม่มี"],
    mustDiffer: true,
  },
  {
    name: "ปักษ์ใต้ · อาหารหรอย",
    text: "อาหารหรอย",
    expectSource: "ปักษ์",
    expectIn: ["อร่อย"],
    mustDiffer: true,
  },
];

/**
 * เช็ค "ตัวค้นคำ" ในเครื่อง — ไม่ยิงโมเดล (ไม่เสียค่า API)
 * กติกาที่ต้องผ่าน: เจอ "วลี" ก่อน "คำเดี่ยว" และกินทั้งวลีทิ้
 * → คำย่อยข้างในวลี (เช่น "กา" ใน "กิ๋นข้าวแล้วกา") ต้องไม่โผล่ซ้ำ
 */
interface MatcherCase {
  name: string;
  text: string;
  /** คำ/วลีที่ต้องเจอ */
  expectWords: string[];
  /** คำ/วลีที่ต้องไม่เจอ (คำย่อยของวลีที่ถูกกินไปแล้ว) */
  expectMissing: string[];
  /** เจอผ่านรูปสะกดอื่น → ต้องได้ matched = รูปที่ผู้ใช้พิมพ์ */
  expectMatched?: { word: string; matched: string };
}

const MATCHER_CASES: MatcherCase[] = [
  {
    name: "วลีก่อนคำเดี่ยว · กิ๋นข้าวแล้วกา",
    text: "กิ๋นข้าวแล้วกา",
    expectWords: ["กิ๋นข้าวแล้วกา"],
    expectMissing: ["กา", "กิ๋น"],
  },
  {
    name: "วลีก่อนคำเดี่ยว · บ่เป็นหยัง",
    text: "บ่เป็นหยัง",
    expectWords: ["บ่เป็นหยัง"],
    expectMissing: ["บ่"],
  },
  {
    name: "วลีก่อนคำเดี่ยว · ไปตวยก่อ",
    text: "ไปตวยก่อ",
    expectWords: ["ไปตวยก่อ"],
    expectMissing: ["ไปตวย", "ก่อ"],
  },
  {
    name: "วลีก่อนคำเดี่ยว · หรอยแรง",
    text: "หรอยแรง",
    expectWords: ["หรอยแรง"],
    expectMissing: ["หรอย"],
  },
  {
    name: "รูปสะกดอื่น · จั่งใด๋ = จั่งได๋",
    text: "จั่งใด๋",
    expectWords: ["จั่งได๋"],
    expectMissing: ["จั่งใด๋"],
    expectMatched: { word: "จั่งได๋", matched: "จั่งใด๋" },
  },
  {
    name: "ไทยคั่นคำไม่สม่ำเสมอ · กิน ข้าว",
    text: "กิน ข้าว",
    expectWords: ["กินข้าว"],
    expectMissing: [],
  },
];

/** รันเช็คตัวค้นคำ (ออฟไลน์) → true = ผ่านทุกเคส */
function runMatcherChecks(): boolean {
  console.log("=== เช็คตัวค้นคำ (ออฟไลน์ — ไม่ยิงโมเดล) ===\n");
  let passed = 0;
  for (const c of MATCHER_CASES) {
    const input: TranslateInput = {
      text: c.text,
      sourceId: "auto",
      sourceLabel: AUTO,
      targetId: "th-central",
      targetLabel: CENTRAL_TH,
    };
    const hits = lookupLexicon(input);
    const words = hits.map((h) => h.word);
    const reasons: string[] = [];

    const missing = c.expectWords.filter((w) => !words.includes(w));
    if (missing.length) reasons.push(`ไม่เจอคำที่ต้องมี: ${missing.join(", ")}`);
    const unwanted = c.expectMissing.filter((w) => words.includes(w));
    if (unwanted.length) reasons.push(`เจอคำย่อยที่ต้องไม่มี: ${unwanted.join(", ")}`);
    if (c.expectMatched) {
      const hit = hits.find((h) => h.word === c.expectMatched!.word);
      if (!hit) {
        reasons.push(`ไม่เจอ hit ของ "${c.expectMatched!.word}"`);
      } else if (hit.matched !== c.expectMatched!.matched) {
        reasons.push(
          `matched ควรเป็น "${c.expectMatched!.matched}" แต่ได้ "${hit.matched ?? "-"}"`
        );
      }
    }

    const ok = reasons.length === 0;
    if (ok) passed += 1;
    console.log(`${ok ? "✅ ผ่าน" : "❌ ไม่ผ่าน"} — ${c.name}`);
    console.log(`   ข้อความ: ${c.text}`);
    const shown = hits
      .map((h) =>
        h.matched && h.matched !== h.word
          ? `"${h.word}" (พบเป็น "${h.matched}")`
          : `"${h.word}"`
      )
      .join(", ");
    console.log(`   เจอ: ${shown || "-"}`);
    reasons.forEach((x) => console.log(`   ⚠️  ${x}`));
    console.log("");
  }
  console.log(
    `=== สรุปตัวค้นคำ: ผ่าน ${passed}/${MATCHER_CASES.length} ===\n`
  );
  return passed === MATCHER_CASES.length;
}

function check(c: Case, r: {
  detectedSource: string | null;
  translation: string | null;
  centralMeaning: string | null;
  sameLanguage: boolean;
  note: string | null;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (c.expectSameLanguage !== undefined && r.sameLanguage !== c.expectSameLanguage) {
    reasons.push(
      `sameLanguage ควรเป็น ${c.expectSameLanguage} แต่ได้ ${r.sameLanguage}`
    );
  }
  if (c.mustDiffer && r.translation === c.text) {
    reasons.push("คำแปลเท่าต้นฉบับ (ไม่ได้แปล)");
  }
  if (c.expectIn && r.translation) {
    const translation = r.translation.toLowerCase();
    const missing = c.expectIn.filter((k) => !translation.includes(k.toLowerCase()));
    if (missing.length) {
      reasons.push(`คำแปลไม่มีคำสำคัญ: ${missing.join(", ")}`);
    }
  }
  if (c.expectNot && r.translation) {
    const found = c.expectNot.filter((k) => r.translation!.includes(k));
    if (found.length) {
      reasons.push(`คำแปลมีคำที่ไม่ควรมี: ${found.join(", ")}`);
    }
  }
  if (c.expectCentral) {
    const central = r.centralMeaning ?? "";
    const missing = c.expectCentral.filter((k) => !central.includes(k));
    if (missing.length) {
      reasons.push(`ความหมายกลางไม่มีคำสำคัญ: ${missing.join(", ")}`);
    }
  }
  if (c.expectNoCentral && r.centralMeaning) {
    reasons.push(`ปลายทางเป็นไทยกลาง แต่มีความหมายกลาง: ${r.centralMeaning}`);
  }
  if (c.expectSource && r.detectedSource && !r.detectedSource.includes(c.expectSource)) {
    reasons.push(`ตรวจภาษาได้ "${r.detectedSource}" ไม่ตรง "${c.expectSource}"`);
  }
  if (!r.translation) {
    reasons.push("ไม่มีคำแปล");
  }
  return { ok: reasons.length === 0, reasons };
}

async function runCase(c: Case) {
  const started = Date.now();
  const r = await translateText({
    text: c.text,
    sourceId: c.sourceId ?? "auto",
    sourceLabel: c.sourceLabel ?? AUTO,
    targetId: c.targetId ?? "th-central",
    targetLabel: c.targetLabel ?? CENTRAL_TH,
  });
  const verdict = check(c, r);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`${verdict.ok ? "✅ ผ่าน" : "❌ ไม่ผ่าน"} — ${c.name}  (${secs}s)`);
  console.log(`   ต้นฉบับ : ${c.text}`);
  console.log(`   ตรวจพบ : ${r.detectedSource ?? "-"}`);
  if (r.centralMeaning) console.log(`   ความหมายกลาง: ${r.centralMeaning}`);
  console.log(`   คำแปล  : ${r.translation ?? "-"}`);
  console.log(`   ออกเสียง: ${r.pronunciation ?? "-"}`);
  if (r.note) console.log(`   หมายเหตุ: ${r.note}`);
  console.log(
    `   เดียวกัน: ${r.sameLanguage ? "ใช่" : "ไม่"} · มั่นใจ ${Math.round(
      r.confidence * 100
    )}%`
  );
  if (!verdict.ok) {
    verdict.reasons.forEach((x) => console.log(`   ⚠️  ${x}`));
  }
  console.log("");
  return verdict.ok;
}

/**
 * เป้าหมาย = ภาษาถิ่น (ล้านนา) — ต้องได้คำภาษาล้านนาจริง ไม่ใช่ไทยกลางใส่สำเนียง
 */
async function runDialectTarget(text: string) {
  console.log(`— เป้าหมาย = ล้านนา: "${text}"`);
  const r = await translateText({
    text,
    sourceId: "auto",
    sourceLabel: AUTO,
    targetId: "th-lanna",
    targetLabel: LANNA,
  });
  console.log(`   ตรวจพบ : ${r.detectedSource ?? "-"}`);
  console.log(`   ความหมายกลาง: ${r.centralMeaning ?? "-"}`);
  console.log(`   คำแปล (ล้านนา): ${r.translation ?? "-"}`);
  if (r.note) console.log(`   หมายเหตุ: ${r.note}`);
  console.log("");
}

async function main() {
  console.log("=== ทดสอบรอบแปลภาษา (prompt ปัจจุบันใน src/prompt.ts) ===\n");

  // เช็คตัวค้นคำก่อน (ออฟไลน์ — ไม่ยิงโมเดล ไม่เสียค่า API)
  const matcherOk = runMatcherChecks();

  let passed = 0;
  for (const c of CASES) {
    try {
      const ok = await runCase(c);
      if (ok) passed += 1;
    } catch (e) {
      console.log(`❌ ไม่ผ่าน — ${c.name}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  console.log("=== เป้าหมาย = ภาษาถิ่น (ต้องเป็นภาษาถิ่นจริง) ===\n");
  try {
    await runDialectTarget("จะไปไป");
    await runDialectTarget("อะหยัง");
  } catch (e) {
    console.log(`เป้าหมายภาษาถิ่นรันไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  console.log(
    `=== สรุป: ผ่าน ${passed}/${CASES.length} เคส · ตัวค้นคำ ${
      matcherOk ? "ผ่าน" : "ไม่ผ่าน"
    } ===`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
