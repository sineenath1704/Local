/**
 * ทดสอบสาย "หาสถานที่" ตั้งแต่ต้นจนจบ — ต่อ Google จริง
 * -------------------------------------------------------------
 * ไหลของงานจริง:
 *   1) AI หาสถานที่ (พร้อมหลักฐานที่ตรวจสอบได้) → `resolvePlace`
 *   2) เอาคำค้นจากหลักฐานไปค้น Google Places → `searchClipPlaceCandidates`
 *   3) ให้ AI จัดอันดับผู้สมัครเทียบกับหลักฐาน → `rankPlaceCandidates`
 *
 * ใช้
 *   cd backend
 *   npm run check:place-e2e -- "วันนี้พาไปที่ดอยสุเทพ ตำบลสุเทพ อำเภอเมือง จังหวัดเชียงใหม่"
 *   npm run check:place-e2e -- "<public-video-url>"          (ถอดเสียงให้เอง)
 *
 * ทุกอย่างในไฟล์นี้เป็น **read-only** — ไม่เขียนฐานข้อมูล /
 * ไม่มีการเอาคีย์มาใส่บรรทัดคำสั่ง (อ่านจาก backend/.env ผ่าน src/config.ts)
 */

import { resolvePlace, rankPlaceCandidates } from "../src/aiClient";
import { searchClipPlaceCandidates } from "../src/routes/places";
import { transcribeVideo } from "../src/geminiTranscribe";

async function main() {
  const arg = process.argv[2]?.trim() ?? "";
  const looksLikeUrl = /^https?:\/\//i.test(arg);

  // ── 1) หาสถานที่ ─────────────────────────────────────────────────────
  console.log("=== 1) หาสถานที่ (AI — หน้าที่เดียว) ===");
  const t0 = Date.now();

  let transcript = "";
  let audioType: "speech" | "music" | "mixed" | "none" = "speech";
  if (looksLikeUrl) {
    const result = await transcribeVideo(arg);
    transcript = result?.transcript ?? "";
    audioType = result?.audioType ?? "speech";
    console.log(`ถอดเสียง: ${transcript || "(ไม่ได้ข้อความ)"}`);
  } else {
    transcript = arg;
    console.log(`ใช้ transcript: ${transcript}`);
  }

  const resolution = await resolvePlace({
    transcript: transcript || undefined,
    audioType,
    videoUrl: looksLikeUrl ? arg : undefined,
  });
  console.log(`[took] ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log(`\nfound: ${resolution.found}`);
  console.log(`place_name: ${resolution.placeName ?? "-"}`);
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
  console.log(`confidence: ${resolution.confidence}`);
  console.log(`queries: ${resolution.queries.join(" | ") || "-"}`);
  console.log(`หลักฐาน ${resolution.evidence.length} ชิ้น:`);
  for (const ev of resolution.evidence) {
    console.log(`  · (${ev.source}) "${ev.quote}"`);
  }

  if (!resolution.found) {
    console.log(
      "\n⚠️ ไม่มีชื่อที่มีหลักฐานรองรับ — ระบบจะถอยไปใช้วิธีเดิม (รอบสรุปตั้งชื่อเอง)"
    );
    return;
  }

  // ── 2) ค้น Google ด้วยคำค้นจากหลักฐาน ───────────────────────────────
  console.log("\n=== 2) ค้น Google Places ===");
  const t1 = Date.now();
  const outcome = await searchClipPlaceCandidates({
    evidenceQueries: resolution.queries,
    fallbackParts: [
      resolution.placeName,
      resolution.community,
      resolution.admin.subdistrict,
      resolution.admin.district,
      resolution.admin.province,
    ],
  });
  console.log(`[took] ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`คำค้นที่ยิงจริง: ${outcome.queries.join(" | ")}`);
  console.log(`ผู้สมัครดิบ ${outcome.rawCount} → เหลือ ${outcome.candidates.length}`);
  if (outcome.errors.length) {
    console.log(`คำค้นที่ล้มเหลว: ${outcome.errors.join(" / ")}`);
  }
  if (!outcome.candidates.length) {
    console.log("  (ไม่เจอ)");
    return;
  }

  // ── 3) ให้ AI จัดอันดับ ─────────────────────────────────────────────
  console.log("\n=== 3) จัดอันดับผู้สมัคร (AI) ===");
  const t2 = Date.now();
  const ranked = await rankPlaceCandidates(resolution, outcome.candidates);
  console.log(`[took] ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  ranked.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} — ${c.address ?? ""}`);
    console.log(
      `     aiRank=${c.aiRank ?? "-"} aiScore=${c.aiScore ?? "-"} matchLevel=${
        c.matchLevel ?? "-"
      }`
    );
    console.log(`     เหตุผล: ${c.aiReason ?? "-"}`);
    if (c.evidenceMatch) console.log(`     หลักฐานที่ตรง: ${c.evidenceMatch}`);
  });
}

main().catch((err) => {
  console.error("ทดสอบล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
