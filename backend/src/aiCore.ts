import { config, isAiConfigured } from "./config";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Low-level call to the Anthropic-compatible AI endpoint.
 * Returns the plain text reply. Throws on network/HTTP errors.
 * Credentials come from config (env), never from the client app.
 */
export async function callAi(params: {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}): Promise<string> {
  if (!isAiConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

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
        max_tokens: params.maxTokens ?? config.ai.maxTokens,
        system: params.system,
        messages: params.messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`AI endpoint error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data: any = await res.json();
    return Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content
      : "";
  } finally {
    clearTimeout(timer);
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
