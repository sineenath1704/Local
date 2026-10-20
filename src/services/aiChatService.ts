import { API_TIMEOUT_MS } from "./apiConfig";
import { aiFetch, AiError, AiFetchOptions, toastAiError } from "./aiHttp";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface FolderContext {
  folderName: string;
  places: string[];
}

/** Every call raises a toast on failure, then rethrows for the caller to render. */
function withToast<T>(opts: AiFetchOptions): Promise<T> {
  return aiFetch<T>({
    ...opts,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });
}

/**
 * Send the running conversation to the backend AI chat endpoint.
 *
 * Throws `AiError` on failure. This used to return a fixed Thai sentence
 * ("ระบบ AI ขัดข้องชั่วคราว") which the chat screen appended as if it were a
 * real assistant reply — so a 401, a timeout and a dead backend were
 * indistinguishable. The screen now catches and styles it separately.
 */
export async function sendChat(messages: ChatTurn[], folder?: FolderContext): Promise<string> {
  const data = await withToast<{ reply?: unknown }>({
    label: "ai-chat",
    path: "/ai-chat",
    method: "POST",
    body: { messages, folder },
    timeoutMs: API_TIMEOUT_MS * 3,
  });
  if (typeof data?.reply !== "string") {
    // 2xx but the payload isn't what we expect — record it rather than guess.
    throw new AiError({
      kind: "bad-shape",
      status: 200,
      body: JSON.stringify(data ?? null),
      requestId: null,
      label: "ai-chat",
      url: "",
      durationMs: 0,
      timeoutMs: API_TIMEOUT_MS * 3,
    });
  }
  return data.reply;
}