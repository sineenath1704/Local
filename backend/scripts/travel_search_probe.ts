/**
 * Probe the live "ค้นเว็บ" path (Gemini + Google Search grounding).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Run it yourself. It reads GEMINI_API_KEY from backend/.env and sends the
 * question to Google's Gemini endpoint — which is why it is a script you run,
 * not a command an agent runs.
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/travel_search_probe.ts "คำถามที่อยากลอง"
 *
 * ทำไมต้องมี probe นี้
 *   เพราะ path นี้ใช้ `generateContent` + `tools: [{google_search:{}}]` + `responseSchema`
 *   พร้อมกัน — ถ้าเครื่องมือค้นเว็บกับการบังคับ JSON ใช้ด้วยกันไม่ได้
 *   API จะตอบ 400 แล้วฟีเจอร์จะกลายเป็น "ค้นไม่ได้" เงียบ ๆ
 *   probe นี้ช่วยยืนยันว่าใช้ได้จริง + เห็น shape ของคำตอบ/แหล่งที่มา
 *
 * หมายเหตุ: การค้นเว็บ (Google Search) นับคิวโควตาต่อคำค้น
 *   → อย่ารันซ้ำเยอะเกินไป
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  searchTravelInfo,
  shouldSearchTravel,
  hasNearbyIntent,
} from "../src/geminiSearch";

async function main() {
  const question =
    process.argv.slice(2).find((a) => a.trim()) ??
    "บ้านพักใกล้วัดประดิษฐานิยม จ.นครปฐม มีที่ไหนบ้าง";

  console.log("คำถาม:", question);
  console.log("intent รอบข้าง:", hasNearbyIntent(question));
  console.log(
    "ควรค้น (ไม่มีข้อมูลในระบบ):",
    shouldSearchTravel({ question, hasInAppData: false })
  );
  console.log("ควรค้น (มีข้อมูลในระบบ):", shouldSearchTravel({ question, hasInAppData: true }));
  console.log("---");

  const started = Date.now();
  const result = await searchTravelInfo({ question });
  const ms = Date.now() - started;

  if (!result) {
    console.log(`❌ ค้นไม่สำเร็จ (${ms} มิลลิวินาที) — ดู log ของ backend ด้านบน`);
    process.exitCode = 1;
    return;
  }

  console.log(`✅ ค้นได้ (${ms} มิลลิวินาที)`);
  console.log("ชื่อสถานที่:", result.placeName);
  console.log("แท็ก:", result.tags.join(", ") || "-");
  console.log("แหล่งที่มา:", result.sources.length, "แหล่ง");
  for (const s of result.sources) console.log("  -", s.title, "→", s.url);
  console.log("--- คำตอบ ---");
  console.log(result.answer);
}

main().catch((err) => {
  console.error("probe ล้มเหลว:", err?.message ?? err);
  process.exitCode = 1;
});
