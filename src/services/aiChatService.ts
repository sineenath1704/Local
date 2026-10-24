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
 *
 * `mode: "host-self"` switches the backend into a JWT-gated advisor mode that
 * reads the host's own business data. Caller must pass the JWT; a missing or
 * stale token will surface as a 401 from the backend.
 */
export interface SendChatOptions {
  folder?: FolderContext;
  /** "tourist" (default) is unauthenticated; "host-self" requires a Bearer token. */
  mode?: "tourist" | "host-self";
  /** Supabase access token. Required when mode === "host-self", unused otherwise. */
  token?: string;
}

export async function sendChat(
  messages: ChatTurn[],
  folderOrOpts?: FolderContext | SendChatOptions,
): Promise<string> {
  // Two call shapes accepted: (messages, folderCtx) — the legacy one — or
  // (messages, opts). The cleanest discriminator is `mode` and `token`,
  // which never existed on the legacy `FolderContext`.
  const opts: SendChatOptions =
    folderOrOpts === undefined
      ? {}
      : "mode" in (folderOrOpts as object) || "token" in (folderOrOpts as object)
        ? (folderOrOpts as SendChatOptions)
        : { folder: folderOrOpts as FolderContext };

  const headers: Record<string, string> = {};
  if (opts.mode === "host-self") {
    if (!opts.token) {
      // Surface the missing-credential case as an honest error instead of a
      // confusing 401 from the backend — saves a round-trip.
      throw new AiError({
        kind: "bad-request",
        status: 0,
        body: "ต้องล็อกอินเพื่อใช้โหมดผู้ประกอบการ (token หายไป)",
        requestId: null,
        label: "ai-chat",
        url: "",
        durationMs: 0,
        timeoutMs: API_TIMEOUT_MS * 3,
      });
    }
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const data = await withToast<{ reply?: unknown }>({
    label: "ai-chat",
    path: "/ai-chat",
    method: "POST",
    headers,
    body: {
      messages,
      folder: opts.folder,
      mode: opts.mode ?? "tourist",
    },
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