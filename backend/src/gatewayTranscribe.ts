/**
 * ถอดเสียงคลิปผ่านโมเดลของเกตเวย์ (MiniMax) — ทางสำรองเมื่อ Gemini ใช้ไม่ได้
 * ============================================================
 * ทำไมต้องมี
 *   · ปกติถอดเสียงด้วย Gemini (`geminiTranscribe.ts`) — เขาได้ยินจริง
 *   · แต่ถ้า Gemini หมดโควตา / ตาย / ชื่อโมเดลไม่ถูกต้อง → คลิปนั้นจะถูกสรุด
 *     "จากภาพอย่างเดียว" เสียเสียงพูดไปทั้งก้อน
 *     (และรอบ "หาสถานที่" ก็เสียหลักฐานจากเสียงไปด้วย เพราะหลักฐานต้องมีใน transcript)
 *   → ไฟล์นี้คือทางสำรอง: ส่งวิดีโอให้โมเดลผ่านเกตเวย์ (MiniMax) ถอดเสียงแทน
 *     · **Gemini ยังอยู่ครบ ยังเป็นตัวหลัก** — ไม่ได้ถูกลบ ไม่ได้ถูกลดบทบาท
 *     · ทางสำรองนี้ทำงานเฉพาะตอนที่ Gemini ล้มเท่านั้น
 *
 * วิธีทำให้โมเดล "ได้ยิน" ได้มากที่สุด
 *   · **ไม่บังคับ JSON** — โมเดลหลายตัวตอบ JSON ไม่เก่ง (และคีย์เวย์นี้เคยตอบ
 *     JSON มาแต่ transcript ว่าง → ถือว่าไม่ได้ผล) → รอบนี้ถามเป็นภาษาพูด
 *     แล้วเอาข้อความดิบมาใช้ ถ้ามี JSON ค่อยแกะออกมาให้
 *   · **ลองสองคำถาม** — คำถามแรก "ถอดเสียง" · ถ้าไม่ได้ผล ค่อยถามตรง ๆ ว่า
 *     "คลิปนี้มีเสียงพูดไหม" (บางโมเดลตอบดีกว่าเมื่อถามแบบนี้)
 *   · **เชื่อได้ก็เชื่อ** — ใช้คำตอบก็ต่อเมื่อมีข้อความจริง
 *     (ถ้าโมเดลบอกว่า "ไม่มีเสียงพูด" → ไม่กล้าตีความว่าคลิปเงียบ
 *      เพราะตอบแบบนั้นย้อนกลับไม่ได้ → แต่ก็ไม่ต้องทำอะไรต่อ เพราะสรุดจากภาพได้)
 */

import { config } from "./config";
import { callAiText } from "./aiStream";
import { DiagLog } from "./summaryDiag";
import type { TranscriptResult } from "./geminiTranscribe";

/** งบ token ของรอบถอดเสียงสำรอง (คำตอบคือ transcript ล้วน ๆ) */
const GATEWAY_TRANSCRIBE_MAX_TOKENS = 4096;

/**
 * เพดานเวลาต่อคำถาม
 * -------------------------------------------------------------
 * ทางสำรองลองได้ 2 คำถาม → ต้องจบก่อนที่รอบสรุดจะโดนตัดทิ้งเปล่า ๆ
 */
const GATEWAY_ATTEMPT_TIMEOUT_MS = 40_000;

/** คำถามที่ 1 — สั่งถอดเสียงตรง ๆ (ไม่บังคับรูปแบบ JSON) */
const ASK_TRANSCRIBE = `ถอดเสียงพูดในคลิปวิดีโอนี้ออกเป็นข้อความ

- เขียนเฉพาะคำที่มนุษย์พูดจริงในคลิป เรียงตามลำดับที่พูด
- ถ้าได้ยินแค่บางส่วน ให้เขียนเฉพาะที่ได้ยิน
- ห้ามย่อ ห้ามสรุป ห้ามแต่งเพิ่ม ห้ามใส่คำอธิบาย
- ถ้าคลิปนี้ไม่มีเสียงพูดของมนุษย์เลย ให้ตอบว่า "ไม่มีเสียงพูด" พอดี ไม่ต้องเขียนอะไรอื่น`;

/** คำถามที่ 2 — ถามตรง ๆ ว่ามีเสียงพูดไหม (บางโมเดลตอบดีกว่าแบบนี้) */
const ASK_IS_THERE_SPEECH = `คลิปวิดีโอนี้มีเสียงพูดของมนุษย์อยู่ไหม?

- ถ้ามี ให้เขียนเสียงพูดนั้นออกมาทั้งหมด เรียงตามลำดับที่พูด (เขียนแค่คำที่พูดจริง ไม่ต้องอธิบาย)
- ถ้าไม่มีเสียงพูด ให้ตอบว่า "ไม่มีเสียงพูด" พอดี ไม่ต้องเขียนอะไรอื่น`;

/** ลายเซ็นที่แปลว่าโมเดลบอกว่า "ไม่มีเสียงพูด" (ไม่ใช่คำตอบที่ใช้ได้) */
const NO_SPEECH_PATTERN =
  /ไม่มีเสียงพูด|ไม่พบเสียงพูด|ไม่มีเสียง|ไม่มีคำพูด|no\s+speech|ไม่ได้ยินเสียง|ไม่พบเสียง/i;

/**
 * ถอดเสียงคลิปผ่านเกตเวย์ — คืน `null` เมื่อทำไม่ได้
 * -------------------------------------------------------------
 * คืน `null` เมื่อ: ไม่มี URL · ไม่ได้ตั้งค่าเกตเวย์ · ปลายทางตอบไม่ OK
 * · ตอบมาไม่มีเนื้อหา · **โมเดลตอบว่าไม่มีเสียงพูด** (แปลว่ามันไม่ได้ยิน
 *   → ไม่กล้าตีความว่าคลิปเงียบ → ปล่อยให้สรุดจากภาพอย่างเดียวเหมือนเดิม)
 */
export async function transcribeVideoViaGateway(
  videoUrl: string,
  diag?: DiagLog
): Promise<TranscriptResult | null> {
  if (!videoUrl) return null;
  if (!config.ai.baseUrl || !config.ai.authToken) {
    if (diag) {
      diag.skip(
        "transcribe-fallback",
        "ถอดเสียง (MiniMax สำรอง)",
        "ยังไม่ได้ตั้งค่าเกตเวย์ (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)"
      );
    }
    return null;
  }

  const t0 = Date.now();
  const attempts: { label: string; prompt: string }[] = [
    { label: "ข้อความตรง", prompt: ASK_TRANSCRIBE },
    { label: "ถามว่ามีเสียงพูดไหม", prompt: ASK_IS_THERE_SPEECH },
  ];

  let lastReason = "โมเดลไม่ได้ตอบอะไรที่ใช้ได้";

  for (const attempt of attempts) {
    const raw = await askGateway(videoUrl, attempt.prompt);
    if (!raw) {
      lastReason = "โมเดลสำรองเรียกไม่สำเร็จ";
      continue;
    }

    const speech = extractSpeech(raw);
    if (!speech) {
      lastReason = "โมเดลตอบว่าไม่มีเสียงพูด (อาจไม่ได้ยินเสียงในคลิป)";
      console.warn(
        `[gemini-fallback] คำถามแบบ${attempt.label}: โมเดลไม่ได้คัดข้อความออกมา`
      );
      continue;
    }

    console.log(
      `[gemini-fallback] ถอดเสียงผ่านโมเดลสำรองได้ (${attempt.label}): ${speech.length} ตัวอักษร`
    );
    if (diag) {
      diag.add({
        id: "transcribe-fallback",
        label: "ถอดเสียง (MiniMax สำรอง)",
        status: "ok",
        ms: Date.now() - t0,
        detail: `ได้ข้อความ ${speech.length} ตัวอักษร (Gemini ใช้ไม่ได้ → ใช้โมเดลสำรอง)`,
        data: { chars: speech.length },
      });
    }

    return {
      transcript: speech,
      // มีคำพูดจริง → "speech" (ไม่มีทางรู้ว่ามีเพลงประกอบหรือไม่ → ไม่เดา)
      audioType: "speech",
      onScreenText: [],
      model: config.ai.model,
      transport: "gateway",
    };
  }

  if (diag) {
    diag.add({
      id: "transcribe-fallback",
      label: "ถอดเสียง (MiniMax สำรอง)",
      status: "failed",
      ms: Date.now() - t0,
      detail: `${lastReason} — ไม่กล้าตีความว่าคลิปไม่มีเสียงพูด`,
      data: {},
    });
  }
  return null;
}

/**
 * ยิงคำถามไปหาโมเดลเกตเวย์พร้อมวิดีโอ → คืนข้อความดิบ (null = ล้มเหลว)
 */
async function askGateway(
  videoUrl: string,
  prompt: string
): Promise<string | null> {
  // ส่งวิดีโอไปให้โมเดลดูแบบเดียวกับรอบสรุปคลิป (บล็อก video แบบเดียวกัน)
  const messageContent: any = [
    { type: "text", text: prompt },
    { type: "video", source: { type: "url", url: videoUrl, fps: 1 } },
  ];

  try {
    const res = await callAiText({
      url: `${config.ai.baseUrl}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: config.ai.model,
        max_tokens: GATEWAY_TRANSCRIBE_MAX_TOKENS,
        temperature: 0,
        system: prompt,
        messages: [{ role: "user", content: messageContent }],
      },
      timeoutMs: GATEWAY_ATTEMPT_TIMEOUT_MS,
    });

    if (!res.ok) {
      console.warn(
        `[gemini-fallback] โมเดลสำรองตอบกลับ ${res.status} — ยังถอดเสียงไม่ได้`
      );
      return null;
    }
    return res.text?.trim() || null;
  } catch (err: any) {
    console.warn(
      "[gemini-fallback] โมเดลสำรองเรียกไม่สำเร็จ:",
      err?.message ?? err
    );
    return null;
  }
}

/**
 * ดึง "คำที่พูด" ออกจากคำตอบของโมเดล
 * -------------------------------------------------------------
 * · ถ้าเป็น JSON (หรือมีบล็อก JSON ซ่อนอยู่) → เอาคีย์ transcript / text ออกมา
 * · ถ้าโมเดลบอกว่า "ไม่มีเสียงพูด" → null (ไม่เอาไปใช้)
 * · อื่น ๆ → เอาข้อความดิบมาใช้เป็น transcript (ตัดบรรทัด "ข้อความบนจอ" ทิ้งถ้ามี)
 */
function extractSpeech(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // 1) JSON (อาจมีโค้ดฟองคลุม หรือมีบรรทัดนำหน้า)
  const parsed = parseJsonLoose(text);
  if (parsed && typeof parsed === "object") {
    const value =
      parsed.transcript ?? parsed.text ?? parsed.transcription ?? parsed.content;
    const speech =
      typeof value === "string"
        ? value.trim()
        : Array.isArray(value)
        ? value.join(" ").trim()
        : "";
    // JSON มาแต่ไม่มีคำพูด → ไม่เอา JSON ไปเป็น transcript (จะเป็นขยะ)
    if (!speech) return null;
    return NO_SPEECH_PATTERN.test(speech) ? null : speech;
  }

  // 2) ข้อความดิบ — ตัดส่วน "ข้อความบนจอ" ออก (ไม่ใช่เสียงพูด)
  const lines = text.split("\n");
  const speechLines: string[] = [];
  for (const line of lines) {
    if (/^\s*ข้อความบนจอ\s*[:：]/.test(line)) break;
    speechLines.push(line);
  }
  const speech = speechLines.join("\n").trim();
  if (!speech) return null;
  if (NO_SPEECH_PATTERN.test(speech)) return null;
  return speech;
}

/** ดึง JSON ออกจากคำตอบ (บางครั้งมี ```json หรือข้อความนำหน้า) */
function parseJsonLoose(text: string): any | null {
  const trimmed = (text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const first = body.indexOf("{");
    const last = body.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(body.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
