import { config, isGeminiConfigured } from "./config";

/**
 * Gemini transcription — Pillar 1 of the AI Summary flow.
 * ---------------------------------------------------------
 * The summary has to come from what the uploader SAYS *and* what the camera
 * SEES. M3 reads the picture but is deaf; Gemini hears but is a general
 * model. So Gemini does the listening and hands us the words, and M3 folds
 * those words into the structured summary.
 *
 * Why Gemini and not Cloud Speech-to-Text:
 *   - Gemini takes `video/mp4` directly → no ffmpeg, no GCS bucket, no
 *     service-account JSON, and none of the Cloud Speech API's billing/
 *     enablement foot-guns.
 *   - ~$0.009 per 120-second clip (≈100 tokens/sec at low media resolution).
 *
 * Two ways to get the bytes to Gemini:
 *   1. external URL  — we hand Gemini the public video URL and it fetches it
 *                      itself. One request, zero server memory. Capped at
 *                      15 MB by Google.
 *   2. Files API     — we stream the video up ourselves. Needed for the big
 *                      clips an iPhone produces.
 *
 * Every failure path here is NON-FATAL: the caller keeps the summary we can
 * build from pictures alone and logs why the audio is missing. The previous
 * Gemini 1.5 Flash attempt died silently on every call (Google retired the
 * model on 2025-09-29) and that silence is exactly what this module exists
 * to prevent — see `checkGeminiModel()`.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";

/** Google caps external-URL file inputs at 15 MB. */
const EXTERNAL_URL_MAX_BYTES = 15 * 1024 * 1024;

/** MIME type we tell Gemini the clip is. */
const CLIP_MIME = "video/mp4";

export type ClipAudioType = "speech" | "music" | "mixed" | "none";

/** How the clip's bytes reached Gemini. */
type Transport = "external-url" | "files-api";

export interface TranscriptResult {
  /** The spoken words, verbatim. Empty when the clip has no speech. */
  transcript: string;
  /** What kind of audio the clip actually carries. */
  audioType: ClipAudioType;
  model: string;
  /** Which path the bytes took to Gemini. */
  transport: Transport;
  /** Clip size in bytes, when known. */
  bytes?: number;
}

export interface GeminiModelCheck {
  ok: boolean;
  model: string;
  /** Why the model is unusable — safe to log, never contains the key. */
  reason?: string;
}

/**
 * Ask Gemini to transcribe the clip.
 *
 * Returns `null` when the clip could not be transcribed (no key, model
 * disabled, network failure…). It never throws, so a transcription outage
 * can never take the whole summary down with it.
 */
export async function transcribeVideo(videoUrl: string): Promise<TranscriptResult | null> {
  if (!videoUrl) return null;

  const check = await checkGeminiModel();
  if (!check.ok) {
    console.warn("[gemini] transcription skipped:", check.reason);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.gemini.timeoutMs);

  try {
    const bytes = await remoteSize(videoUrl);
    const preferExternal = bytes != null && bytes <= EXTERNAL_URL_MAX_BYTES;

    // Small clip → let Google fetch the URL itself (one request, no bytes
    // through our server). Big clip → we upload it. And if the external path
    // fails anyway (Google can't reach our URL, the size was misreported),
    // fall back to the upload rather than losing the audio entirely.
    const order: Transport[] = preferExternal
      ? ["external-url", "files-api"]
      : ["files-api"];

    for (const transport of order) {
      const result = await transcribeVia(transport, videoUrl, controller.signal);
      if (result) {
        return {
          ...result,
          model: config.gemini.model,
          transport,
          bytes: bytes ?? undefined,
        };
      }
      if (transport === "external-url") {
        console.warn(
          "[gemini] ให้ Gemini ดึง URL เองไม่สำเร็จ — ลองอัปโหลดผ่าน Files API แทน"
        );
      }
    }
    return null;
  } catch (err: any) {
    const reason =
      err?.name === "AbortError"
        ? `หมดเวลา ${config.gemini.timeoutMs}ms`
        : err?.message ?? "ไม่ทราบสาเหตุ";
    console.warn("[gemini] transcription failed:", reason);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one transport end to end. Returns `null` when that transport failed.
 */
async function transcribeVia(
  transport: Transport,
  videoUrl: string,
  signal: AbortSignal
): Promise<{ transcript: string; audioType: ClipAudioType } | null> {
  if (transport === "external-url") {
    return requestTranscription(videoUrl, signal);
  }

  const uploaded = await uploadClip(videoUrl, signal);
  if (!uploaded) {
    console.warn("[gemini] upload to Files API failed — skipping transcription");
    return null;
  }
  try {
    return await requestTranscription(uploaded.uri, signal);
  } finally {
    await uploaded.cleanup();
  }
}

/**
 * Check that the configured model actually exists and is reachable.
 *
 * Only SUCCESSES are cached. A failure is retried after a short cooldown:
 * caching a failure would let one network blip switch transcription off for
 * the whole life of the process — the exact silent death this guard exists to
 * prevent.
 */
let modelCheck: Promise<GeminiModelCheck> | null = null;
let modelCheckFailedAt = 0;
const MODEL_CHECK_COOLDOWN_MS = 60_000;

export function checkGeminiModel(): Promise<GeminiModelCheck> {
  if (modelCheck) return modelCheck;

  if (Date.now() - modelCheckFailedAt < MODEL_CHECK_COOLDOWN_MS) {
    return Promise.resolve({
      ok: false,
      model: config.gemini.model,
      reason: "เพิ่งตรวจสอบโมเดลไม่ผ่าน — รอสักครู่แล้วลองใหม่",
    });
  }

  modelCheck = probeModel().then((result) => {
    if (!result.ok) {
      modelCheckFailedAt = Date.now();
      modelCheck = null; // let a later call probe again
    }
    return result;
  });
  return modelCheck;
}

async function probeModel(): Promise<GeminiModelCheck> {
  const model = config.gemini.model;
  if (!isGeminiConfigured()) {
    return { ok: false, model, reason: "GEMINI_API_KEY ไม่ได้ตั้งค่าบนเซิร์ฟเวอร์" };
  }
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}`, {
      headers: { "x-goog-api-key": config.gemini.apiKey },
    });
    if (res.ok) return { ok: true, model };
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      model,
      reason: `โมเดลเรียกไม่ได้ (HTTP ${res.status}): ${body.slice(0, 300)}`,
    };
  } catch (err: any) {
    return { ok: false, model, reason: `เชื่อมต่อ Gemini ไม่สำเร็จ: ${err?.message ?? ""}` };
  }
}

/** Size of the clip in bytes, or `null` when the server doesn't say. */
async function remoteSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    const n = len ? Number(len) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Push the clip to the Gemini Files API and wait until it is usable.
 *
 * The download is streamed straight into the upload so a 100 MB clip never
 * sits in memory all at once.
 */
async function uploadClip(
  videoUrl: string,
  signal: AbortSignal
): Promise<{ uri: string; cleanup: () => Promise<void> } | null> {
  let uploadUrl: string | null = null;
  let fileName: string | null = null;

  try {
    const head = await fetch(videoUrl, { method: "HEAD", signal });
    const len = Number(head.headers.get("content-length") || 0);

    const startRes = await fetch(`${UPLOAD_BASE}/files`, {
      method: "POST",
      signal,
      headers: {
        "x-goog-api-key": config.gemini.apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(len || 0),
        "X-Goog-Upload-Header-Content-Type": CLIP_MIME,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "clip.mp4" } }),
    });
    if (!startRes.ok) {
      const body = await startRes.text().catch(() => "");
      console.warn("[gemini] Files API start failed:", startRes.status, body.slice(0, 300));
      return null;
    }
    uploadUrl = startRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      console.warn("[gemini] Files API ไม่คืน x-goog-upload-url");
      return null;
    }

    const src = await fetch(videoUrl, { signal });
    if (!src.ok || !src.body) {
      console.warn("[gemini] ดาวน์โหลดคลิปไม่สำเร็จ:", src.status);
      return null;
    }

    // Stream the download straight into the upload — no full-file buffer.
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      signal,
      headers: {
        "Content-Length": String(len || 0),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: src.body as any,
      duplex: "half",
    } as any);
    if (!upRes.ok) {
      const body = await upRes.text().catch(() => "");
      console.warn("[gemini] Files API upload failed:", upRes.status, body.slice(0, 300));
      return null;
    }

    const uploaded: any = await upRes.json();
    const file = uploaded?.file ?? uploaded;
    fileName = file?.name ?? null;
    const uri = file?.uri ?? null;
    if (!uri || !fileName) {
      console.warn("[gemini] Files API ไม่คืน uri ของไฟล์");
      return null;
    }

    // Gemini processes the clip in the background — wait until it's ACTIVE.
    const active = await waitForActive(fileName, signal);
    if (!active) {
      console.warn("[gemini] ไฟล์ไม่พร้อมใช้งานหลังรอ 60 วินาที");
      await deleteGeminiFile(fileName);
      return null;
    }

    return {
      uri,
      cleanup: async () => {
        await deleteGeminiFile(fileName!);
      },
    };
  } catch (err: any) {
    console.warn("[gemini] uploadClip error:", err?.message ?? err);
    if (fileName) await deleteGeminiFile(fileName);
    return null;
  }
}

/** Poll the file until Gemini says ACTIVE (or it fails). */
async function waitForActive(fileName: string, signal: AbortSignal): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${GEMINI_BASE}/${fileName}`, {
      signal,
      headers: { "x-goog-api-key": config.gemini.apiKey },
    });
    if (res.ok) {
      const data: any = await res.json();
      const state = data?.state;
      if (state === "ACTIVE") return true;
      if (state === "FAILED") {
        console.warn("[gemini] ไฟล์ประมวลผลไม่สำเร็จ:", data?.status?.message ?? "FAILED");
        return false;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Best-effort cleanup — Gemini keeps files for 48h, we don't need them. */
async function deleteGeminiFile(fileName: string): Promise<void> {
  try {
    await fetch(`${GEMINI_BASE}/${fileName}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": config.gemini.apiKey },
    });
  } catch {
    // ignore
  }
}

/** The transcription prompt + response parsing. */
const TRANSCRIBE_PROMPT = `ถอดเสียงพูดในคลิปวิดีโอนี้ออกเป็นข้อความ

กติกา:
- คัดลอกเฉพาะ "เสียงพูดของมนุษย์" ตามที่พูดจริงทุกคำ ไม่ต้องเรียบเรียงใหม่
- ถ้ามีเสียงพูด ให้คัดลอกตามลำดับที่พูดจริง แยกเป็นบรรทัดตามผู้พูด
- ถ้าไม่มีเสียงพูดเลย (มีแต่เพลง เสียงธรรมชาติ หรือเงียบ) ให้ transcript เป็นค่าว่าง
- เสียงพูดที่อยู่ไกลหรือเบาจนฟังไม่ชัด ให้คัดลอกเท่าที่ได้ยิน ถ้าไม่ได้ยินเลยให้ปล่อยว่าง
- ห้ามแต่งข้อความที่ไม่ได้พูด ห้ามเดา ห้ามสรุป
- สะกดทุกคำให้ถูกต้องตามหลักภาษาไทย ห้ามตัดตัวสะกดทิ้ง ห้ามสลับลำดับพยัญชนะ
- ถ้าคำใดฟังไม่ชัด ให้คัดเป็นคำที่ใกล้เคียงที่สุดและมีอักษรครบทุกตัว
  (ห้ามเขียนคำไม่ครบ เช่น "เตียง" ต้องไม่กลายเป็น "เตีย")
- ถ้ามีเพลงหรือเสียงประกอบอยู่ด้วย ให้ระบุ hasMusic = true

ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:
{ "hasSpeech": true หรือ false, "hasMusic": true หรือ false, "transcript": "ข้อความที่ถอดได้ทั้งหมด" }

- hasMusic = true เมื่อมีเพลงหรือเสียงประกอบอยู่ในคลิป
- hasSpeech = true เมื่อมีเสียงพูดของมนุษย์ที่ถอดได้จริงอย่างน้อยหนึ่งคำ
- transcript = "" เมื่อไม่มีเสียงพูดให้ถอด`;

async function requestTranscription(
  fileUri: string,
  signal: AbortSignal
): Promise<{ transcript: string; audioType: ClipAudioType } | null> {
  const res = await fetch(
    `${GEMINI_BASE}/models/${encodeURIComponent(config.gemini.model)}:generateContent`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.gemini.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: TRANSCRIBE_PROMPT },
              { file_data: { mime_type: CLIP_MIME, file_uri: fileUri } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          // Low temperature = stick to the words that were actually said.
          temperature: 0,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[gemini] generateContent failed:", res.status, body.slice(0, 300));
    return null;
  }

  const data: any = await res.json();
  const rawText: string = Array.isArray(data?.candidates)
    ? data.candidates
        .map((c: any) => (c?.content?.parts ?? []).map((p: any) => p?.text ?? "").join(""))
        .join("\n")
        .trim()
    : "";
  if (!rawText) {
    console.warn("[gemini] ไม่ได้เนื้อหากลับมา:", JSON.stringify(data).slice(0, 300));
    return null;
  }

  const parsed = parseJson(rawText);
  if (!parsed || typeof parsed !== "object") {
    // A prose answer means the model did NOT follow the contract. Report it
    // as a failure — never as "this clip has no speech", which is the silent
    // lie that made the retired Gemini 1.5 Flash look like it worked.
    console.warn(
      "[gemini] ตอบกลับไม่ใช่ JSON — ถือว่าถอดเสียงไม่สำเร็จ:",
      rawText.slice(0, 200)
    );
    return null;
  }

  // The prompt asks for `transcript`, but a model can name the key its own way.
  // Take whichever one carries the words.
  const rawTranscript =
    parsed.transcript ?? parsed.text ?? parsed.transcription ?? parsed.content;
  const transcript = typeof rawTranscript === "string" ? rawTranscript.trim() : "";
  const hasSpeech =
    typeof parsed?.hasSpeech === "boolean"
      ? parsed.hasSpeech
      : parsed?.hasSpeech === "true"
      ? true
      : transcript.length > 0;
  const hasMusic = parsed?.hasMusic === true || parsed?.hasMusic === "true";

  if (!hasSpeech || transcript === "") {
    // Gemini said there is no usable speech. Be honest about the audio type
    // instead of pretending the clip is silent.
    return { transcript: "", audioType: hasMusic ? "music" : "none" };
  }
  return { transcript, audioType: hasMusic ? "mixed" : "speech" };
}

/** Pull a JSON object out of a model reply that may be wrapped in prose. */
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
