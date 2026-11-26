/**
 * Probe: โมเดลเกตเวย์ (MiniMax) อ่านเสียงในคลิปได้ไหม
 * ─────────────────────────────────────────────────────────────────────────
 * รันเอง (Bash ฝั่งผมถูกบล็อก และคีย์ไม่ควรไปอยู่บนบรรทัดคำสั่ง):
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/probe_transcribe.ts <public-video-url>
 *
 * URL ต้องเป็นวิดีโอที่เข้าถึงจากเน็ตได้ (เช่นใน Supabase bucket `videos`)
 *
 * สคริปต์นี้ยิงปลายทางจริงแล้วพิมพ์ "คำตอบดิบ" ทุกแบบ เพื่อดูว่า
 *   · ปลายทางมีโมเดลอะไรให้ใช้บ้าง (อาจมีโมเดลถอดเสียงโดยเฉพาะ)
 *   · โมเดล "ได้ยิน" เสียงในคลิปหรือไม่ (ตอบว่าไม่มีเสียงพูด = ไม่ได้ยิน)
 *   · รูปแบบไหนของคำสั่งทำให้ได้ผล (ข้อความตรง / JSON / ถามว่ามีเสียงพูดไหม)
 *
 * ไม่แตะไฟล์อื่น ไม่เขียนอะไรลงฐานข้อมูล — ยิงอย่างเดียว
 */

import { config } from "../src/config";

/** โมเดลที่จะลอง (ถ้า env ไม่ได้ตั้ง ใช้ค่าเริ่มต้นของระบบ) */
const MODEL = config.ai.model || "minimax-m3";

const VIDEO_PROMPT_PLAIN = `ถอดเสียงพูดในคลิปวิดีโอนี้ออกเป็นข้อความ

- เขียนเฉพาะคำที่มนุษย์พูดจริงในคลิป เรียงตามลำดับที่พูด
- ห้ามย่อ ห้ามสรุป ห้ามแต่งเพิ่ม ห้ามใส่คำอธิบาย
- ถ้าคลิปนี้ไม่มีเสียงพูดของมนุษย์เลย ให้ตอบว่า "ไม่มีเสียงพูด" พอดี ไม่ต้องเขียนอะไรอื่น`;

const VIDEO_PROMPT_JSON = `ถอดเสียงพูดในคลิปวิดีโอนี้ออกเป็นข้อความ
ตอบกลับเป็น JSON เท่านั้น: { "hasSpeech": true หรือ false, "hasMusic": true หรือ false, "transcript": "ข้อความที่ถอดได้ทั้งหมด" }`;

const VIDEO_PROMPT_ASK = `คลิปวิดีโอนี้มีเสียงพูดของมนุษย์อยู่ไหม?

- ถ้ามี ให้เขียนเสียงพูดนั้นออกมาทั้งหมด เรียงตามลำดับที่พูด
- ถ้าไม่มีเสียงพูด ให้ตอบว่า "ไม่มีเสียงพูด" พอดี`;

const VIDEO_PROMPT_SUMMARY = `คลิปวิดีโอนี้มีอะไรบ้าง?

ตอบ 3 บรรทัด:
1) มีเสียงพูดของมนุษย์หรือไม่ (ถ้ามี เขียนเป็นคำพูดจริง)
2) มีเสียงอื่น (เพลง · เสียงธรรมชาติ) หรือไม่
3) เห็นอะไรบ้างในเฟรม`;

/** บอกให้โมเดล "ฟัง" เสียงในคลิปโดยเฉพาะ (บางโมเดลต้องสั่งตรง ๆ) */
const VIDEO_PROMPT_LISTEN = `ฟังเสียงในคลิปวิดีโอนี้ให้ฟัง

- ถ้าได้ยินเสียงพูดของมนุษย์ ให้เขียนเป็นคำพูดจริงทุกคำ เรียงตามลำดับ
- ถ้าได้ยินแต่เสียงอื่น (เพลง เสียงธรรมชาติ) ให้บอกว่าเป็นเสียงอะไร
- ถ้าไม่ได้ยินอะไรเลย ให้ตอบว่า "ไม่ได้ยินเสียงในคลิป"`;

function cut(text: string, max = 1200): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}… (+${t.length - max} ตัวอักษร)` : t;
}

/** ยิงหนึ่งคำถาม → พิมพ์คำตอบดิบ */
async function ask(
  label: string,
  videoUrl: string,
  prompt: string,
  opts?: { withVideo?: boolean; withSystem?: boolean; shape?: "video" | "document" }
): Promise<void> {
  const withVideo = opts?.withVideo !== false;
  const withSystem = opts?.withSystem !== false;
  const shape = opts?.shape ?? "video";
  const content: any[] = [];
  if (withVideo) {
    if (shape === "document") {
      // ทางสำรองของการส่งไฟล์: ให้เกตเวย์ไปดึงไฟล์เองแบบ document
      content.push({
        type: "document",
        source: { type: "url", url: videoUrl },
      });
      content.push({ type: "text", text: prompt });
    } else {
      content.push({ type: "text", text: prompt });
      content.push({
        type: "video",
        source: { type: "url", url: videoUrl, fps: 1 },
      });
    }
  } else {
    content.push({ type: "text", text: prompt });
  }

  const started = Date.now();
  try {
    const res = await fetch(`${config.ai.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0,
        ...(withSystem ? { system: prompt } : {}),
        messages: [{ role: "user", content }],
      }),
    });
    const body = await res.text().catch(() => "");
    console.log(
      `\n=== ${label} → HTTP ${res.status} (${((Date.now() - started) / 1000).toFixed(1)}s)`
    );
    console.log(cut(body));
  } catch (err: any) {
    console.log(
      `\n=== ${label} → ยิงไม่สำเร็จ: ${err?.message ?? err} (${((Date.now() - started) / 1000).toFixed(1)}s)`
    );
  }
}

async function main() {
  const videoUrl = process.argv.slice(2).filter((u) => u.trim())[0];
  if (!videoUrl) {
    console.error("ใช้: npx ts-node --transpile-only scripts/probe_transcribe.ts <public-video-url>");
    process.exit(1);
  }

  console.log(`โมเดล: ${MODEL}`);
  console.log(`ปลายทาง: ${config.ai.baseUrl}`);
  console.log(`คลิป: ${videoUrl}`);

  // ── 0) ปลายทางมีโมเดลอะไรให้ใช้บ้าง (อาจมีโมเดลถอดเสียงโดยเฉพาะ) ──
  console.log("\n=== รายชื่อโมเดลที่ปลายทางมี ===");
  try {
    const res = await fetch(`${config.ai.baseUrl}/v1/models`, {
      headers: { "x-api-key": config.ai.authToken },
    });
    const body = await res.text().catch(() => "");
    console.log(`HTTP ${res.status}`);
    console.log(cut(body, 2000));
  } catch (err: any) {
    console.log(`ยิงไม่สำเร็จ: ${err?.message ?? err}`);
  }

  // ── 1) ถามแบบข้อความตรง (ไม่บังคับ JSON) ──
  await ask("1) ถอดเสียง · ข้อความตรง", videoUrl, VIDEO_PROMPT_PLAIN);

  // ── 2) ถามแบบบังคับ JSON ──
  await ask("2) ถอดเสียง · บังคับ JSON", videoUrl, VIDEO_PROMPT_JSON);

  // ── 3) ถามว่ามีเสียงพูดไหม ──
  await ask("3) มีเสียงพูดไหม", videoUrl, VIDEO_PROMPT_ASK);

  // ── 4) ถามว่าเห็นอะไร (เช็คว่าวิดีโอไปถึงโมเดลจริงไหม) ──
  await ask("4) เห็นอะไรในเฟรม", videoUrl, VIDEO_PROMPT_SUMMARY);

  // ── 5) ถามแบบข้อความตรง แต่ไม่ใส่ system prompt ──
  await ask("5) ถอดเสียง · ไม่มี system prompt", videoUrl, VIDEO_PROMPT_PLAIN, {
    withSystem: false,
  });

  // ── 6) ส่งวิดีโอผ่าน document/URL block (อีกแบบหนึ่งของการส่งไฟล์) ──
  await ask("6) ถอดเสียง · ส่งผ่าน document block", videoUrl, VIDEO_PROMPT_PLAIN, {
    shape: "document",
  });

  // ── 7) บอกให้โมเดล "ฟัง" เสียงในคลิปโดยเฉพาะ ──
  await ask("7) ฟังเสียงในคลิป", videoUrl, VIDEO_PROMPT_LISTEN);

  console.log(
    "\n--- สรุป: ถ้าข้อ 1–3 ตอบว่า 'ไม่มีเสียงพูด' แต่ข้อ 4 เห็นภาพได้ → โมเดลอ่านวิดีโอได้ แต่ไม่ได้ยินเสียง"
  );
  console.log(
    "--- ถ้าข้อ 1–3 มีข้อความพูดจริง → ใช้แบบนั้นในโค้ด (แก้ prompt ใน src/gatewayTranscribe.ts)"
  );
}

main().catch((err) => {
  console.error("probe ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
