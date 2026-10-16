/**
 * Gemini-powered video transcription + visual analysis.
 * ----------------------------------------------------------
 * Uses Gemini 1.5 Flash (via Google AI API) to:
 *   1. Extract speech/dialogue from the video's audio track → Thai transcript
 *   2. Describe visual content (scenes, on-screen text, signage)
 * Both results feed into the M3 summary as primary + secondary sources.
 *
 * Why Gemini instead of Google STT:
 *   - Gemini accepts a public video URL directly (no ffmpeg / GCS needed)
 *   - Works on Vercel serverless without extra infrastructure
 *   - Returns both audio AND visual context in one call
 */

import { config } from "./config";

export interface TranscriptionResult {
  transcript: string | null;      // เสียงพูดที่ถอดมาได้ (ภาษาไทย)
  visualDescription: string | null; // คำอธิบายภาพ/ข้อความบนจอ
  onScreenText: string[];         // ตัวหนังสือที่เห็นชัดในคลิป
  hasAudio: boolean;              // มีเสียงพูดในคลิปหรือเปล่า
  error?: string;
}

const TRANSCRIBE_PROMPT = `วิเคราะห์คลิปวิดีโอนี้ให้ครบทั้งเสียงและภาพ แล้วตอบกลับเป็น JSON ตามรูปแบบที่กำหนด

งานของคุณ:
1. ถอดเสียงพูด/บทบรรยาย/คำพูดทั้งหมดในคลิปเป็นภาษาไทย (ถ้าพูดภาษาอื่นให้แปลเป็นไทย)
2. อธิบายสิ่งที่เห็นในภาพ: สถานที่, กิจกรรม, บรรยากาศ, ผู้คน
3. รวบรวมตัวหนังสือ/ป้าย/ชื่อสถานที่ที่เห็นในคลิป

กฎ:
- ถ้าไม่มีเสียงพูด/บทบรรยาย ให้ transcript = null และ has_audio = false
- ห้ามแต่งข้อมูลที่ไม่มีจริงในคลิป
- ถ้าเสียงเป็นเพลงล้วน ไม่ใช่การพูด ให้ transcript = null
- on_screen_text ให้ระบุข้อความที่อ่านออกชัดเจนเท่านั้น

ตอบกลับเป็น JSON เท่านั้น:
{
  "transcript": "ข้อความที่ถอดจากเสียงพูด หรือ null ถ้าไม่มีเสียงพูด",
  "visual_description": "คำอธิบายสิ่งที่เห็นในภาพ บรรยากาศ กิจกรรม สถานที่",
  "on_screen_text": ["ตัวอักษร/ป้าย/ชื่อที่เห็นชัดในคลิป"],
  "has_audio": true
}`;

/** Call Gemini 1.5 Flash to transcribe + describe a video. */
export async function transcribeVideo(videoUrl: string): Promise<TranscriptionResult> {
  const key = config.places.googleKey; // reuse the same Google API key
  if (!key) {
    return { transcript: null, visualDescription: null, onScreenText: [], hasAudio: false, error: "NO_GOOGLE_KEY" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // 60s timeout

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: TRANSCRIBE_PROMPT },
                {
                  file_data: {
                    mime_type: "video/mp4",
                    file_uri: videoUrl,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.log("[transcribe] Gemini error", resp.status, errText.slice(0, 200));
      return { transcript: null, visualDescription: null, onScreenText: [], hasAudio: false, error: `GEMINI_${resp.status}` };
    }

    const data: any = await resp.json();
    const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    // eslint-disable-next-line no-console
    console.log("[transcribe] raw =", rawText.slice(0, 200));

    // Parse JSON from Gemini response
    let parsed: any = null;
    try {
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}");
      if (start !== -1 && end !== -1) parsed = JSON.parse(rawText.slice(start, end + 1));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return { transcript: null, visualDescription: rawText || null, onScreenText: [], hasAudio: false };
    }

    return {
      transcript: typeof parsed.transcript === "string" ? parsed.transcript.trim() || null : null,
      visualDescription: typeof parsed.visual_description === "string" ? parsed.visual_description.trim() || null : null,
      onScreenText: Array.isArray(parsed.on_screen_text)
        ? parsed.on_screen_text.filter((t: unknown) => typeof t === "string")
        : [],
      hasAudio: Boolean(parsed.has_audio),
    };
  } catch (err: any) {
    const message = err?.name === "AbortError" ? "TIMEOUT" : err?.message || "UNKNOWN";
    // eslint-disable-next-line no-console
    console.log("[transcribe] error =", message);
    return { transcript: null, visualDescription: null, onScreenText: [], hasAudio: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
