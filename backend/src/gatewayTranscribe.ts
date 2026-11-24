/**
 * ถอดเสียงคลิปผ่านโมเดลของเกตเวย์ (MiniMax) — ทางสำรองเมื่อ Gemini ใช้ไม่ได้
 * ============================================================
 * ทำไมต้องมี
 *   · ปกติถอดเสียงด้วย Gemini (`geminiTranscribe.ts`) — เขาได้ยินจริง
 *   · แต่ถ้า Gemini ตาย / โควต้าเต็ม / ชื่อโมเดลไม่ถูกต้อง → คลิปนั้นจะถูกสรุด
 *     "จากภาพอย่างเดียว" เสียเสียงพูดไปทั้งก้อน
 *     (และรอบ "หาสถานที่" ก็เสียหลักฐานจากเสียงไปด้วย เพราะหลักฐานต้องมีใน transcript)
 *   → ไฟล์นี้คือทางสำรอง: ส่งวิดีโอให้โมเดลผ่านเกตเวย์ (MiniMax) ถอดเสียงแทน
 *     · **Gemini ยังอยู่ครบ ยังเป็นตัวหลัก** — ไม่ได้ถูกลบ ไม่ได้ถูกลดบทบาท
 *     · ทางสำรองนี้ทำงานเฉพาะตอนที่ Gemini ล้มเท่านั้น
 *
 * ข้อควรระวัง (สำคัญ)
 *   โมเดลผ่านเกตเวย์อาจ "ไม่ได้ยิน" เสียงในคลิป
 *   → ถ้ามันตอบว่า "คลิปนี้ไม่มีเสียงพูด" เราจะไม่เชื่อ
 *     (อาจเป็นเพราะมันหูดึง ไม่ใช่เพราะคลิปเงียบ — และคำตอบแบบนั้นย้อนกลับไม่ได้
 *      เพราะจะไปบังคับว่า "ไม่มีเสียงพูด" ในคลิปที่มีเสียงพูดอยู่จริง)
 *   → ใช้ผลจากทางสำรองก็ต่อเมื่อ "คัดข้อความออกมาได้จริง" เท่านั้น
 *     ถ้า transcript ว่าง → ถือว่าล้มเหลว → ปล่อยให้สรุดจากภาพอย่างเดียวเหมือนเดิม
 */

import { config } from "./config";
import { callAiText } from "./aiStream";
import { DiagLog } from "./summaryDiag";
import type { TranscriptResult } from "./geminiTranscribe";

/** งบ token ของรอบถอดเสียงสำรอง (คำตอบคือ transcript ล้วน ๆ) */
const GATEWAY_TRANSCRIBE_MAX_TOKENS = 4096;

/**
 * เพดานเวลาของรอบสำรอง
 * -------------------------------------------------------------
 * รอบหลัก (สรุดคลิป) ยังต้องใช้เวลาอีก → ทางสำรองต้องจบก่อน
 * ไม่งั้นรอบสรุดจะโดนตัดทิ้งเปล่า ๆ ตอนที่ยังไม่ได้ทำอะไรเสร็จ
 */
const GATEWAY_TRANSCRIBE_TIMEOUT_MS = 60_000;

/**
 * prompt ถอดเสียง — รูปแบบเดียวกับของ Gemini (`geminiTranscribe.ts`)
 * -------------------------------------------------------------
 * ต้องเหมือนกันเป๊ะ เพราะฝั่งเรียกใช้ (`routes/aiSummary.ts`) อ่านผลด้วย
 * สัญญาเดียวกัน: { hasSpeech, hasMusic, transcript, onScreenText }
 */
const GATEWAY_TRANSCRIBE_PROMPT = `ถอดเสียงพูดในคลิปวิดีโอนี้ออกเป็นข้อความ

กติกา:
- คัดลอกเฉพาะ "เสียงพูดของมนุษย์" ตามที่พูดจริงทุกคำ ไม่ต้องเรียบเรียงใหม่
- ถ้ามีเสียงพูด ให้คัดตามลำดับที่พูดจริง แยกเป็นบรรทัดตามผู้พูด
- ถ้าไม่มีเสียงพูดเลย (มีแต่เพลง เสียงธรรมชาติ หรือเงียบ) ให้ transcript เป็นค่าว่าง
- ถ้าเสียงพูดอยู่ไกลหรือเบาจนฟังไม่ชัด ให้คัดเท่าที่ได้ยิน และถ้าไม่ได้ยินเลยให้ปล่อยว่าง
- ห้ามแต่งข้อความที่ไม่ได้พูด ห้ามเดา ห้ามสรุป
- สะกดทุกคำให้ถูกต้องตามภาษาไทย ห้ามตัดตัวสะกดทิ้ง ห้ามสลับลำดับพยัญชนะ
- ถ้าคำใดฟังไม่ชัด ให้คัดเป็นคำที่ใกล้เคียงที่สุดและมีอักษรครบทุกตัว
  (ห้ามเขียนคำไม่ครบ เช่น "เตียง" ต้องห้ามกลายเป็น "เตีย")
- ถ้ามีเพลงหรือเสียงประกอบอยู่ด้วย ให้ระบุ hasMusic = true

[ตัวหนังสือบนจอ — อ่านจากภาพในคลิป]
- คลิปนี้อยู่ในคำขอนี้อยู่แล้ว → ให้ดูมาด้วย แล้วคัด "ตัวหนังสือที่เขียนอยู่ในคลิป" มา
  (ชื่อสถานที่บนป้าย · ป้ายบอกทาง · ซับไทย · ข้อความบนจอ · ชื่อร้าน/โฮมสเตย์บนป้าย)
- คัดแบบตรงตัว ห้ามแก้คำ ห้ามเดา ห้ามเติมคำที่ไม่มีในภาพ
- เก็บเฉพาะที่ "อ่านออกชัด" — ไม่ต้องครบทุกบรรทัด แต่ถ้าเห็นชื่อสถานที่ให้เก็บไว้
- ห้ามใส่คำบรรยายภาพลงใน onScreenText — onScreenText คือ "ตัวอักษรที่เห็น" เท่านั้น
- ถ้าไม่มีตัวหนังสือบนจอเลย → ให้ onScreenText เป็น []

ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:
{ "hasSpeech": true หรือ false, "hasMusic": true หรือ false, "transcript": "ข้อความที่ถอดได้ทั้งหมด", "onScreenText": ["ตัวหนังสือที่เห็นในคลิป"] }

- hasSpeech = true เมื่อมีเสียงพูดของมนุษย์ที่ถอดได้จริงอย่างน้อยหนึ่งคำ
- transcript = "" เมื่อไม่มีเสียงพูดให้ถอด
- ถ้าคุณไม่สามารถถอดเสียงพูดได้เลย (ไม่มีเสียงให้ฟัง หรือคุณไม่ได้ยินเสียงในคลิป)
  → ตอบ hasSpeech = false และ transcript = "" · ห้ามเดาข้อความที่ไม่ได้ยิน`;

/**
 * ถอดเสียงคลิปผ่านเกตเวย์ — คืน `null` เมื่อทำไม่ได้
 * -------------------------------------------------------------
 * คืน `null` เมื่อ: ไม่มี URL · ไม่ได้ตั้งค่าเกตเวย์ · ปลายทางตอบไม่ OK
 * · ตอบมาไม่ใช่ JSON · **คัดข้อความออกมาไม่ได้เลย** (ว่างเปล่า)
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
  const timeoutMs = Math.min(
    config.ai.timeoutMs,
    GATEWAY_TRANSCRIBE_TIMEOUT_MS
  );

  // ส่งวิดีโอไปให้โมเดลดูเหมือนรอบสรุปคลิป (บล็อก video แบบเดียวกัน)
  const messageContent: any = [
    { type: "text", text: GATEWAY_TRANSCRIBE_PROMPT },
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
        system: GATEWAY_TRANSCRIBE_PROMPT,
        messages: [{ role: "user", content: messageContent }],
      },
      timeoutMs,
    });

    if (!res.ok) {
      if (diag) {
        diag.add({
          id: "transcribe-fallback",
          label: "ถอดเสียง (MiniMax สำรอง)",
          status: "failed",
          ms: Date.now() - t0,
          detail: `ปลายทางตอบ ${res.status}`,
          data: { status: res.status },
        });
      }
      return null;
    }

    const parsed = parseJsonLoose(res.text);
    if (!parsed || typeof parsed !== "object") {
      if (diag) {
        diag.add({
          id: "transcribe-fallback",
          label: "ถอดเสียง (MiniMax สำรอง)",
          status: "failed",
          ms: Date.now() - t0,
          detail: "โมเดลตอบมาไม่ใช่ JSON ที่อ่านได้",
          data: { chars: res.text.length },
        });
      }
      return null;
    }

    // โมเดลอาจตั้งชื่อคีย์เองได้ → รับได้หลายแบบ (เหมือนฝั่ง Gemini)
    const rawTranscript =
      parsed.transcript ?? parsed.text ?? parsed.transcription ?? parsed.content;
    const transcript =
      typeof rawTranscript === "string" ? rawTranscript.trim() : "";

    const onScreenText: string[] = Array.isArray(parsed.onScreenText)
      ? parsed.onScreenText
          .map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
          .filter((t: string) => t.length > 0)
          .slice(0, 40)
      : [];

    // ── กันการโกหก: ไม่มี transcript = ไม่รู้ว่าคลิปมีเสียงพูดหรือไม่ ──
    // โมเดลผ่านเกตเวย์อาจไม่ได้ยินเสียง → "ว่าง" ไม่ได้แปลว่า "คลิปนี้เงียบ"
    // ถ้าเราตีความว่า "ไม่มีเสียงพูด" → สรุดจะไปใช้แค่ภาพ ทั้งที่คลิปมีคำพูดจริง
    if (!transcript) {
      if (diag) {
        diag.add({
          id: "transcribe-fallback",
          label: "ถอดเสียง (MiniMax สำรอง)",
          status: "failed",
          ms: Date.now() - t0,
          detail:
            "โมเดลไม่ได้คัดข้อความออกมาเลย (อาจไม่ได้ยินเสียงในคลิป) — ไม่กล้าตีความว่าคลิปไม่มีเสียงพูด",
          data: { onScreenLines: onScreenText.length },
        });
      }
      return null;
    }

    const hasMusic =
      parsed.hasMusic === true || parsed.hasMusic === "true" ? true : false;

    if (diag) {
      diag.add({
        id: "transcribe-fallback",
        label: "ถอดเสียง (MiniMax สำรอง)",
        status: "ok",
        ms: Date.now() - t0,
        detail: `ได้ข้อความ ${transcript.length} ตัวอักษร (Gemini ใช้ไม่ได้ → ใช้โมเดลสำรอง)`,
        data: {
          chars: transcript.length,
          onScreenLines: onScreenText.length,
          hasMusic,
        },
      });
    }

    return {
      transcript,
      // มีคำพูดจริง → "speech" (มีเพลงประกอบ = "mixed")
      audioType: hasMusic ? "mixed" : "speech",
      onScreenText,
      model: config.ai.model,
      transport: "gateway",
    };
  } catch (err: any) {
    if (diag) {
      diag.add({
        id: "transcribe-fallback",
        label: "ถอดเสียง (MiniMax สำรอง)",
        status: "failed",
        ms: Date.now() - t0,
        detail: err?.message ?? "เรียกโมเดลสำรองไม่สำเร็จ",
        data: {},
      });
    }
    return null;
  }
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
