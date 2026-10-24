/**
 * Probe the FULL AI-summary chain on one real clip.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Run it yourself — it uses the keys in backend/.env and sends the clip to
 * Gemini and to the AI endpoint:
 *
 *   cd backend
 *   npm run probe:summary -- "<public-video-url>"
 *
 * This walks exactly the path the backend takes at upload time:
 *   Gemini transcribes → M3 summarizes (video + transcript) →
 *   Google Places returns candidates → the narration writes 3 paragraphs.
 *
 * It prints the parts worth eyeballing: the transcript, what the model read
 * out of the clip (visual_description), the structured place block, the
 * candidate places, and the final narration.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { transcribeVideo } from "../src/geminiTranscribe";
import { generateSummary, generateNarration } from "../src/aiClient";
import {
  proofreadSummary,
  proofreadNarration,
  applyProofreadToSummary,
  narrationFacts,
} from "../src/thaiProofread";
import { enrichWithGooglePlaces } from "../src/routes/places";

async function main() {
  const url = process.argv[2]?.trim();
  if (!url) {
    console.error("ใช้: npm run probe:summary -- <public-video-url>");
    process.exit(1);
  }

  // ── 1. Gemini transcribes ───────────────────────────────────────────────
  console.log("=== 1. ถอดเสียง (Gemini) ===");
  const t0 = Date.now();
  const transcript = await transcribeVideo(url);
  console.log(`[took] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!transcript) {
    console.error("ถอดเสียงไม่สำเร็จ — ดูบรรทัด [gemini] ด้านบน");
    process.exit(1);
  }
  console.log(`transport=${transcript.transport} audioType=${transcript.audioType}`);
  console.log(`transcript: ${transcript.transcript || "(ว่าง)"}`);

  // ── 2. M3 summarizes: the clip + what was said ──────────────────────────
  console.log("\n=== 2. สรุปโครงสร้าง (M3) ===");
  const t1 = Date.now();
  const raw = await generateSummary({
    transcript: transcript.transcript || undefined,
    audioType: transcript.audioType,
    videoUrl: url,
  });
  console.log(`[took] ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log("visual_description:", (raw as any).visualDescription ?? "(ไม่มี)");
  console.log(
    `scene_inventory: ${(raw as any).sceneInventory?.length ?? 0} รายการ`
  );
  ((raw as any).sceneInventory ?? []).forEach((row: any) => {
    console.log(
      `  · ${row.item} | วัสดุ: ${row.material ?? "-"} | จำนวน: ${row.count ?? "-"} | สภาพ: ${row.condition ?? "-"} | ที่: ${row.position ?? "-"}`
    );
  });
  console.log("place_name:", raw.place?.place_name);
  console.log("price_info:", JSON.stringify(raw.place?.price_info));
  console.log("contact:", JSON.stringify(raw.place?.contact));
  console.log("opening_hours:", raw.place?.opening_hours);
  console.log("capacity:", JSON.stringify(raw.place?.capacity));
  console.log("rules:", JSON.stringify(raw.place?.rules));
  console.log("areas:", JSON.stringify(raw.place?.areas));
  console.log("facilities:", JSON.stringify(raw.place?.facilities));
  console.log("atmosphere:", raw.place?.atmosphere);

  // ── 2b. Proofread pass — copy-edit the Thai, then Google (the place name
  //        goes into the search query, so it has to be spelled right first).
  console.log("\n=== 2b. แก้สะกด (ก่อน → หลัง) ===");
  const corrections = await proofreadSummary(raw, transcript.transcript);
  const clean = corrections ? applyProofreadToSummary(raw, corrections) : raw;
  if (!corrections) {
    console.log("(ไม่ได้เรียกโมเดล หรือเรียกไม่สำเร็จ — ใช้ข้อมูลเดิม)");
  } else {
    const rows: [string, unknown, unknown][] = [
      ["place_name", raw.place?.place_name, clean.place?.place_name],
      ["community", raw.place?.community, clean.place?.community],
      ["atmosphere", raw.place?.atmosphere, clean.place?.atmosphere],
      ["province", raw.place?.location?.province, clean.place?.location?.province],
      ["price_weekday", raw.place?.price_info?.weekday, clean.place?.price_info?.weekday],
      ["price_weekend", raw.place?.price_info?.weekend, clean.place?.price_info?.weekend],
      ["phone", raw.place?.contact?.phone, clean.place?.contact?.phone],
      ["opening_hours", raw.place?.opening_hours, clean.place?.opening_hours],
      ["capacity", JSON.stringify(raw.place?.capacity), JSON.stringify(clean.place?.capacity)],
      ["rules", JSON.stringify(raw.place?.rules), JSON.stringify(clean.place?.rules)],
      ["areas", JSON.stringify(raw.place?.areas), JSON.stringify(clean.place?.areas)],
      ["facilities", JSON.stringify(raw.place?.facilities), JSON.stringify(clean.place?.facilities)],
      ["visual_description", raw.visualDescription, clean.visualDescription],
    ];
    rows.forEach(([key, before, after]) => {
      const mark = before === after ? "  " : "→ ";
      console.log(`${mark}${key}: ${before ?? "-"} ${before === after ? "" : `→ ${after ?? "-"}`}`);
    });
  }

  // ── 3. Google Places candidates (the user ticks one in the app) ─────────
  console.log("\n=== 3. สถานที่จาก Google (ให้ผู้ใช้ติ๊กเอง) ===");
  const t2 = Date.now();
  const enriched = await enrichWithGooglePlaces({
    ...clean,
    _transcript: transcript.transcript,
    _onScreenText: [],
  } as any).catch((err: any) => {
    console.warn("enrich ไม่สำเร็จ:", err?.message);
    return clean;
  });
  console.log(`[took] ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  const candidates = (enriched as any).place?.google_candidates ?? [];
  console.log(`ผู้สมัคร ${candidates.length} แห่ง`);
  candidates.slice(0, 5).forEach((c: any, i: number) => {
    console.log(`  ${i + 1}. ${c.name} — ${c.address ?? ""}`);
    console.log(
      `     priceLevel=${c.priceLevel ?? "-"} phone=${c.phone ?? "-"} website=${c.website ?? "-"}`
    );
  });

  // ── 4. The narration — 2 paragraphs ─────────────────────────────────────
  console.log("\n=== 4. คำบรรยาย (2 ย่อหน้า) ===");
  const t3 = Date.now();
  const narration = await generateNarration(enriched).catch((err: any) => {
    console.warn("narration ไม่สำเร็จ:", err?.message);
    return enriched.text;
  });
  console.log(`[took] ${((Date.now() - t3) / 1000).toFixed(1)}s`);

  // ── 4b. Proofread the narration — this is what the reader finally sees.
  console.log("\n=== 4b. แก้สะกดคำบรรยาย ===");
  const t4 = Date.now();
  const cleanNarration = await proofreadNarration(
    String(narration),
    narrationFacts(enriched),
    transcript.transcript
  );
  console.log(`[took] ${((Date.now() - t4) / 1000).toFixed(1)}s`);
  if (!cleanNarration) {
    console.log("(ไม่ได้แก้ — ใช้ข้อความเดิม หรือผ่านเงื่อนไขกันพลาด)");
  }

  const printParagraphs = (text: string, title: string) => {
    console.log(`\n--- ${title} ---`);
    const paragraphs = String(text).split(/\n\s*\n/).filter((p) => p.trim());
    console.log(`ย่อหน้า: ${paragraphs.length}`);
    paragraphs.forEach((p, i) => {
      console.log(`\n[${i + 1}] ${p.trim()}`);
    });
  };
  printParagraphs(String(narration), "คำบรรยายก่อนแก้สะกด");
  printParagraphs(cleanNarration || String(narration), "คำบรรยายหลังแก้สะกด (ของที่บันทึกจริง)");
}

main().catch((err) => {
  console.error("probe ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
