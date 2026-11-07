import { config, isAiConfigured } from "./config";
import { AiUpstreamError } from "./aiErrors";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * เรียก Google Gemini โดยตรงสำหรับแชทและวางแผนทริป (ใช้เมื่อ MiniMax มีปัญหาหรือโควต้าหมด)
 * ส่ง systemInstruction + contents สลับ user/model เหมือนกับโมเดลหลัก
 */
export async function callGemini(params: {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}): Promise<string> {
  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");
  }

  const tokenLimit = params.maxTokens ?? config.ai.maxTokens;

  // แปลงประวัติแชทเป็นรูปแบบ Gemini: [{ role: "user" | "model", parts: [{ text }] }]
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const m of params.messages) {
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    const text = (m.content || "").trim();
    if (!text) continue;

    // Gemini ไม่อนุญาตให้บทบาทเดียวกันติดกัน → รวมข้อความเป็นข้อความเดียว
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += "\n\n" + text;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // Gemini บังคับให้ข้อความแรกต้องเป็น role: "user"
  if (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "สวัสดี" }] });
  }

  // รายชื่อโมเดล Gemini ที่จะลองตามลำดับ (ถ้าโมเดลแรกไม่พร้อม ให้ลองโมเดลถัดไปทันที)
  const candidateModels = Array.from(
    new Set(
      [
        config.gemini.chatModel,
        "gemini-2.0-flash",
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        config.gemini.model,
      ].filter(Boolean)
    )
  );

  let lastErr: any = null;

  for (const model of candidateModels) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.gemini.timeoutMs);

    try {
      const bodyPayload: any = {
        contents,
        generationConfig: {
          maxOutputTokens: Math.min(tokenLimit, 8192),
          temperature: 0.7,
        },
      };

      if (params.system && params.system.trim()) {
        bodyPayload.systemInstruction = {
          parts: [{ text: params.system.trim() }],
        };
      }

      const res = await fetch(
        `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.gemini.apiKey,
          },
          body: JSON.stringify(bodyPayload),
        }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn(`[gemini-chat] Model ${model} ตอบกลับ ${res.status}: ${errText.slice(0, 200)}`);
        lastErr = new AiUpstreamError(res.status, errText);
        continue;
      }

      const data: any = await res.json();
      const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
      const text: string = Array.isArray(candidate?.content?.parts)
        ? candidate.content.parts
            .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
            .join("")
        : typeof candidate?.content?.parts?.[0]?.text === "string"
        ? candidate.content.parts[0].text
        : "";

      if (text.trim()) {
        return text.trim();
      }
    } catch (err: any) {
      console.warn(`[gemini-chat] Model ${model} ส่งคำขอไม่สำเร็จ: ${err?.message ?? err}`);
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr || new Error("GEMINI_ALL_MODELS_FAILED");
}

/**
 * เรียกโมเดล Anthropic / MiniMax พร้อมระบบต่อข้อความถ้าคำตอบโดนตัด
 */
async function callAnthropicWithContinuation(params: {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}): Promise<string> {
  const tokenLimit = params.maxTokens ?? config.ai.maxTokens;
  let fullReply = "";
  let currentMessages = [...params.messages];
  const MAX_CONTINUE_ROUNDS = 10;

  let round = 0;
  while (true) {
    const controller = new AbortController();
    // ถ้ามี Gemini เป็นตัวสำรอง ให้รอ MiniMax ไม่เกิน 20 วินาที เพื่อให้สลับไป Gemini ได้ทันก่อนที่มือถือจะตัดสาย (Timeout)
    const hasGemini = Boolean(config.gemini.apiKey);
    const timeout = hasGemini ? Math.min(config.ai.timeoutMs, 20_000) : config.ai.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${config.ai.baseUrl}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.ai.authToken,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.ai.model,
          max_tokens: tokenLimit,
          system: params.system,
          messages: currentMessages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new AiUpstreamError(res.status, errText);
      }

      const data: any = await res.json();
      const rawText: string = Array.isArray(data?.content)
        ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
        : typeof data?.content === "string"
        ? data.content
        : "";

      const stopReason = data?.stop_reason;

      if (!rawText) {
        break;
      }

      if (fullReply) {
        const lastChar = fullReply.slice(-1);
        const firstChar = rawText.charAt(0);
        if (lastChar && firstChar && lastChar === firstChar) {
          fullReply += rawText.slice(1);
        } else if (/[\p{L}]/u.test(lastChar) && /[\p{L}]/u.test(firstChar) && !/\s/.test(fullReply.slice(-1))) {
          fullReply += " " + rawText;
        } else {
          fullReply += rawText;
        }
      } else {
        fullReply = rawText;
      }

      const isIncomplete = stopReason === "max_tokens" || stopReason === "length";

      if (!isIncomplete || round >= MAX_CONTINUE_ROUNDS - 1) {
        break;
      }

      currentMessages = [
        ...params.messages,
        { role: "assistant", content: fullReply },
        {
          role: "user",
          content: "พิมพ์ต่อจากข้อความเดิมให้ครบสมบูรณ์ทุกวันจนจบทริป (ไม่ต้องซ้ำข้อความเดิม ให้ต่อทันที)",
        },
      ];
    } finally {
      clearTimeout(timer);
    }
    round++;
  }
  return fullReply.trim();
}

/**
 * เรียกใช้งานโมเดล AI (MiniMax-m3 เป็นตัวหลัก พร้อมสลับไปใช้ Gemini อัตโนมัติเมื่อโควต้าหมดหรือเกิดปัญหา)
 */
export async function callAi(params: {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}): Promise<string> {
  if (!isAiConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const hasAnthropic = Boolean(config.ai.baseUrl && config.ai.authToken);
  const hasGemini = Boolean(config.gemini.apiKey);

  // 1. ลองเรียก MiniMax-m3 ก่อนถ้ามีการตั้งค่าไว้
  if (hasAnthropic) {
    try {
      return await callAnthropicWithContinuation(params);
    } catch (err: any) {
      console.warn(
        `[aiCore] ⚠️ MiniMax-m3 ตอบกลับไม่สำเร็จ (HTTP ${err?.status ?? "ERR"}: ${err?.message ?? err})`
      );

      // 2. ถ้า MiniMax ล้มเหลว (เช่น 429 quota, 5xx server error, timeout) และมี Gemini → สลับไป Gemini อัตโนมัติ
      if (hasGemini) {
        console.warn(
          `[aiCore] 🔄 สลับไปใช้ Gemini (${config.gemini.chatModel}) อัตโนมัติ (Fallback)`
        );
        try {
          return await callGemini(params);
        } catch (geminiErr: any) {
          console.error(
            `[aiCore] ❌ Gemini fallback ตอบกลับไม่สำเร็จเช่นกัน:`,
            geminiErr?.message ?? geminiErr
          );
          throw err;
        }
      }

      throw err;
    }
  }

  // 3. ถ้าไม่มี MiniMax แต่มี Gemini ให้เรียก Gemini โดยตรง
  if (hasGemini) {
    return await callGemini(params);
  }

  throw new Error("NO_AI_PROVIDER_AVAILABLE");
}

export interface PingResult {
  ok: boolean;
  reason: string;
  upstreamStatus: number | null;
  upstreamBody: string | null;
  elapsedMs: number;
  model: string;
  baseUrlHost: string;
  tokenLength: number;
}

/**
 * Fire the smallest possible real request at the AI provider.
 * -------------------------------------------------------------
 * `/health` only proves the process is alive; it says nothing about whether the
 * token is valid. This does — it answers "is the AI actually reachable with the
 * credentials we have" without needing the phone app at all.
 */
export async function pingAi(): Promise<PingResult> {
  const base: Omit<PingResult, "ok" | "reason" | "elapsedMs"> = {
    upstreamStatus: null,
    upstreamBody: null,
    model: config.ai.model,
    baseUrlHost: config.ai.baseUrl ? hostOf(config.ai.baseUrl) : "(ไม่ได้ตั้งค่า)",
    tokenLength: config.ai.authToken.length,
  };

  if (!isAiConfigured()) {
    return {
      ...base,
      ok: false,
      reason: "ยังไม่ได้ตั้งค่า API Key (ทั้ง ANTHROPIC_AUTH_TOKEN และ GEMINI_API_KEY)",
      elapsedMs: 0,
    };
  }

  // ถ้าไม่ได้ตั้งค่า Anthropic/MiniMax แต่ตั้งค่า Gemini ไว้
  if (!config.ai.baseUrl || !config.ai.authToken) {
    return {
      ...base,
      ok: true,
      model: config.gemini.chatModel,
      baseUrlHost: "generativelanguage.googleapis.com",
      tokenLength: config.gemini.apiKey.length,
      elapsedMs: 0,
      reason: `ใช้ Gemini (${config.gemini.chatModel}) เป็นโมเดลหลัก (ไม่ได้ตั้ง MiniMax)`,
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${config.ai.baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.ai.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const text = await res.text().catch(() => "");
    const elapsedMs = Date.now() - startedAt;
    const geminiNote = config.gemini.apiKey ? " + มี Gemini สำรอง" : "";
    return {
      ...base,
      ok: res.ok,
      upstreamStatus: res.status,
      upstreamBody: res.ok ? null : text.slice(0, 1000),
      elapsedMs,
      reason: res.ok
        ? `เชื่อมต่อ MiniMax สำเร็จ — token ใช้งานได้${geminiNote}`
        : res.status === 401 || res.status === 403
        ? `token MiniMax ไม่ถูกต้องหรือหมดอายุ${geminiNote}`
        : `ปลายทาง MiniMax ตอบกลับ ${res.status}${geminiNote}`,
    };
  } catch (err: any) {
    const geminiNote = config.gemini.apiKey ? " (แต่มี Gemini สแตนด์บายสำรอง)" : "";
    return {
      ...base,
      ok: false,
      upstreamStatus: null,
      upstreamBody: null,
      elapsedMs: Date.now() - startedAt,
      reason:
        err?.name === "AbortError"
          ? `ต่อปลายทาง MiniMax ไม่ทัน 15 วินาที${geminiNote}`
          : `ต่อปลายทาง MiniMax ไม่ได้: ${err?.message ?? "unknown error"}${geminiNote}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Pull a JSON object out of a model reply (handles code fences / extra text). */
export function extractJson(raw: string): any | null {
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

export { isAiConfigured };
