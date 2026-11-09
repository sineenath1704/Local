import { config, isGeminiConfigured } from "./config";

/**
 * ถอดเสียงพูดสั้น ๆ ด้วย Gemini (สำหรับปุ่มไมค์ในหน้าแปลภาษา)
 * -------------------------------------------------------------
 * ทำไมต้องมีไฟล์นี้ แล้วไม่ใช้ `geminiTranscribe.ts` ต่อ:
 *   - `geminiTranscribe.ts` รับ **คลิปวิดีโอจาก URL** (สรุปอัตโนมัติของโพสต์)
 *     เส้นทางนั้นถอดเสียงพร้อมกับการอ่านป้ายในภาพ และถ้าพังจะไม่ทำให้สรุปตาย
 *   - ที่นี่คือ "ผู้ใช้กดพูดคำเดียว" → ต้องการแค่ข้อความ ไม่ต้องอ่านป้าย ไม่ต้องกลัวพัง
 *     และไฟล์เสียงที่มาเป็น **base64 ในตัวคำขอ** ไม่ใช่ URL
 *   → แยกไฟล์ไว้ = เส้นทางสรุปคลิปยังทำงานเหมือนเดิมทุกประการ
 *
 * วิธีส่งไฟล์: `inline_data` (base64 อยู่ในคำขอเลย)
 *   เสียงสั้น ๆ ที่อัดจากมือถือมีขนาดไม่กี่ร้อย KB → ไม่ต้องใช้ Files API
 *   (ไม่ต้องเริ่มอัปโหลด ไม่ต้อง poll ไม่ต้องลบไฟล์ทิ้ง)
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** ผลลัพธ์ของการถอดเสียง — แยก "ไม่มีเสียงพูด" ออกจาก "เรียกไม่สำเร็จ" */
export type AudioTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/** prompt ถอดเสียง — เขียนแยกจากของคลิปวิดีโอเพราะงานต่างกันจริง */
const TRANSCRIBE_AUDIO_PROMPT = `ถอดเสียงพูดในไฟล์เสียงนี้ออกเป็นข้อความ

กติกา:
- คัดลอกเฉพาะ "เสียงพูดของมนุษย์" ตามที่พูดจริงทุกคำ ไม่ต้องเรียบเรียงใหม่
- ถ้ามีเสียงพูด ให้คัดตามลำดับที่พูดจริง แยกเป็นบรรทัดตามผู้พูด
- ถ้าไม่มีเสียงพูดเลย (มีแต่เพลง เสียงธรรมชาติ หรือเงียบ) ให้ transcript เป็นค่าว่าง
- เสียงพูดที่อยู่ไกลหรือเบาจนฟังไม่ชัด ให้คัดเท่าที่ได้ยิน ถ้าไม่ได้ยินเลยให้ปล่อยว่าง
- ห้ามแต่งข้อความที่ไม่ได้พูด ห้ามเดา ห้ามสรุป ห้ามแปลภาษา
- สะกดทุกคำให้ถูกต้องตามหลักภาษาไทย ห้ามตัดตัวสะกดทิ้ง ห้ามสลับลำดับพยัญชนะ
- ถ้าคำใดฟังไม่ชัด ให้คัดเป็นคำที่ใกล้เคียงที่สุดและมีอักษรครบทุกตัว
  (ห้ามเขียนคำไม่ครบ เช่น "เตียง" ต้องไม่กลายเป็น "เตีย")
- ถ้าพูดเป็นภาษาถิ่นหรือภาษาต่างประเทศ ให้คัดตามที่พูดจริง ห้ามแปลเป็นภาษากลาง

ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:
{ "hasSpeech": true หรือ false, "transcript": "ข้อความที่ถอดได้ทั้งหมด" }

- hasSpeech = true เมื่อมีเสียงพูดของมนุษย์ที่ถอดได้จริงอย่างน้อยหนึ่งคำ
- transcript = "" เมื่อไม่มีเสียงพูดให้ถอด`;

/** mime type ที่ Gemini รับได้ — map จากสิ่งที่แอปส่งมาให้เป็นแบบมาตรฐาน */
const AUDIO_MIME: Record<string, string> = {
  "audio/mp4": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/aac": "audio/aac",
  "audio/mpeg": "audio/mp3",
  "audio/mp3": "audio/mp3",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/ogg": "audio/ogg",
  "audio/3gpp": "audio/3gpp",
  "audio/3gp": "audio/3gpp",
  "audio/flac": "audio/flac",
  "audio/webm": "audio/webm",
};

/** ขนาด base64 สูงสุดที่รับได้ (ประมาณ 2.25 MB ไฟล์เสียง) */
export const MAX_AUDIO_BASE64_CHARS = 3 * 1024 * 1024;

/** ปรับ mime type ให้เป็นแบบที่ Gemini รู้จัก (ค่าเริ่มต้น = mp4 = m4a จาก iOS) */
export function normalizeAudioMime(mimeType?: string): string {
  if (!mimeType) return "audio/mp4";
  return AUDIO_MIME[mimeType.trim().toLowerCase()] ?? "audio/mp4";
}

/**
 * ถอดเสียงจากไฟล์เสียงที่เข้ารหัสเป็น base64
 *
 * คืน `ok: false` เมื่อเรียกไม่สำเร็จ (ไม่มีคีย์ / เน็ตล่ม / โมเดลตอบไม่ใช่ JSON)
 * และ `ok: true` พร้อม text = "" เมื่อไฟล์นั้นไม่มีเสียงพูดจริง ๆ
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType?: string
): Promise<AudioTranscribeResult> {
  if (!audioBase64) {
    return { ok: false, reason: "ไม่มีไฟล์เสียง" };
  }
  if (!isGeminiConfigured()) {
    return { ok: false, reason: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY บนเซิร์ฟเวอร์" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.gemini.timeoutMs);

  try {
    const res = await fetch(
      `${GEMINI_BASE}/models/${encodeURIComponent(config.gemini.model)}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.gemini.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: TRANSCRIBE_AUDIO_PROMPT },
                {
                  inline_data: {
                    mime_type: normalizeAudioMime(mimeType),
                    data: audioBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            // ต่ำ = ยึดคำที่พูดจริง ไม่แต่งเพิ่ม
            temperature: 0,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[gemini-audio] generateContent failed:", res.status, body.slice(0, 300));
      return { ok: false, reason: `เรียก Gemini ไม่สำเร็จ (HTTP ${res.status})` };
    }

    const data: any = await res.json();
    const rawText: string = Array.isArray(data?.candidates)
      ? data.candidates
          .map((c: any) => (c?.content?.parts ?? []).map((p: any) => p?.text ?? "").join(""))
          .join("\n")
          .trim()
      : "";
    if (!rawText) {
      console.warn("[gemini-audio] ไม่ได้เนื้อหากลับมา:", JSON.stringify(data).slice(0, 300));
      return { ok: false, reason: "โมเดลไม่ตอบกลับ" };
    }

    const parsed = parseJson(rawText);
    if (!parsed || typeof parsed !== "object") {
      // คำตอบที่เป็นบทความ = โมเดลไม่ทำตามสัญญา → ถือว่าล้มเหลว
      // (ไม่ใช่ "ไฟล์นี้ไม่มีเสียงพูด" — อันนั้นต้องมาจาก transcript ว่าง)
      console.warn("[gemini-audio] ตอบกลับไม่ใช่ JSON:", rawText.slice(0, 200));
      return { ok: false, reason: "โมเดลตอบมาไม่ใช่ JSON ที่อ่านได้" };
    }

    // โมเดลอาจตั้งชื่อคีย์เองได้ → รับได้หลายแบบ แต่ต้องเป็นข้อความจริง
    const rawTranscript =
      parsed.transcript ?? parsed.text ?? parsed.transcription ?? parsed.content;
    const text = typeof rawTranscript === "string" ? rawTranscript.trim() : "";

    return { ok: true, text };
  } catch (err: any) {
    const reason =
      err?.name === "AbortError"
        ? `หมดเวลา ${config.gemini.timeoutMs}ms`
        : err?.message ?? "ไม่ทราบเหตุผล";
    console.warn("[gemini-audio] transcription failed:", reason);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

/** ดึง JSON object ออกจากคำตอบที่อาจมีบทความห่อหุ้ม */
function parseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
