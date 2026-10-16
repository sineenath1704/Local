import { config, isAiConfigured } from "./config";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Low-level call to the Anthropic-compatible AI endpoint.
 * Returns the plain text reply. Throws on network/HTTP errors.
 * Supports auto-continuation if the response is cut off by max_tokens limit.
 */
export async function callAi(params: {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}): Promise<string> {
  if (!isAiConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const tokenLimit = params.maxTokens ?? config.ai.maxTokens;
  let fullReply = "";
  let currentMessages = [...params.messages];
  // Allow more continuation attempts (up to 10) to ensure full answer
  const MAX_CONTINUE_ROUNDS = 10;

  // Continuously request continuation until the response is complete (no artificial round limit)
  let round = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
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
        throw new Error(`AI endpoint error ${res.status}: ${errText.slice(0, 300)}`);
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

      // Stitching: avoid duplicate first character and ensure words aren't glued together
      if (fullReply) {
        const lastChar = fullReply.slice(-1);
        const firstChar = rawText.charAt(0);
        if (lastChar && firstChar && lastChar === firstChar) {
          fullReply += rawText.slice(1);
        } else if (/[\p{L}]/u.test(lastChar) && /[\p{L}]/u.test(firstChar) && !/\s/.test(fullReply.slice(-1))) {
          // Both are letters and there is no whitespace, insert a space
          fullReply += " " + rawText;
        } else {
          fullReply += rawText;
        }
      } else {
        fullReply = rawText;
      }

      // Continue only when the model was genuinely cut off by the token limit.
      // Checking punctuation is unreliable for Thai (Thai doesn't use sentence-ending
      // punctuation like . or !) and was causing infinite continuation loops on Vercel.
      const isIncomplete = stopReason === "max_tokens" || stopReason === "length";

      if (!isIncomplete || round >= MAX_CONTINUE_ROUNDS - 1) {
        break;
      }

      // Prepare continuation prompt
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
  // Loop exited because response is complete
  return fullReply.trim();
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
