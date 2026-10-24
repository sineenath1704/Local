/**
 * Probe the live Gemini transcription path.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Run it yourself. It reads GEMINI_API_KEY from backend/.env and sends the
 * clip to Google's Gemini endpoint — which is why it is a script you run,
 * not a command an agent runs.
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/gem_probe.ts <public-video-url> [...]
 *
 * The URL must be a PUBLIC video URL. The app's own storage works:
 * the draft copy lands in the public `videos` bucket
 * (`supabase.storage.from("videos").getPublicUrl(path)`), and the same
 * bucket holds every posted clip.
 *
 * Do NOT use Google's gtv-videos-bucket samples — that bucket answers 403
 * to a plain GET, so a probe pointed at it only tests the download, never
 * Gemini.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { transcribeVideo, checkGeminiModel } from "../src/geminiTranscribe";

/** HEAD the clip so we can see whether the server can reach it at all. */
async function head(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const len = res.headers.get("content-length");
    return `HTTP ${res.status}${len ? ` · ${(Number(len) / 1024 / 1024).toFixed(1)} MB` : ""}`;
  } catch (err: any) {
    return `ยังติดต่อไม่ได้: ${err?.message ?? err}`;
  }
}

async function main() {
  const urls = process.argv.slice(2).filter((u) => u.trim());
  if (urls.length === 0) {
    console.error(
      "ใช้: npx ts-node --transpile-only scripts/gem_probe.ts <video-url> [...]"
    );
    process.exit(1);
  }

  const check = await checkGeminiModel();
  console.log("=== โมเดล ===");
  console.log(JSON.stringify(check, null, 2));
  if (!check.ok) {
    console.error("โมเดลเรียกไม่ได้ — หยุดที่นี่");
    process.exit(1);
  }

  for (const url of urls) {
    console.log(`\n=== ${url}`);
    console.log(`[reachable] ${await head(url)}`);
    const started = Date.now();
    const result = await transcribeVideo(url);
    console.log(`[took] ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log("RESULT:", JSON.stringify(result, null, 2));
    if (!result) {
      console.log(
        "→ ถอดเสียงไม่สำเร็จ ดูบรรทัด [gemini] ด้านบนว่าตกที่ transport ไหน"
      );
    } else {
      console.log(
        `→ สำเร็จ ผ่าน ${result.transport}` +
          (result.bytes ? ` · ${(result.bytes / 1024 / 1024).toFixed(1)} MB` : "")
      );
      console.log(`→ audioType = ${result.audioType}`);
    }
  }
}

main().catch((err) => {
  console.error("probe ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
