import { API_BASE_URL } from "./apiConfig";
import {
  AiErrorKind,
  describeError,
  newId,
  record,
  showAiToast,
  truncate,
} from "./aiDiagnostics";

/**
 * The single way the app talks to the AI backend.
 * =============================================================
 * Every AI service used to hand-roll its own `fetch` + `if (!res.ok) return
 * null`, which meant the response body — where the backend puts the actual
 * reason — was never read. This wrapper does the opposite:
 *
 *   - always reads the body (even on failure)
 *   - always writes one record into the diagnostics log
 *   - throws a typed `AiError` instead of returning null, so a failed call
 *     can never be mistaken for "not ready yet"
 */

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | null;
  readonly body: string;
  readonly requestId: string | null;
  readonly label: string;
  readonly url: string;
  readonly durationMs: number;

  constructor(params: {
    kind: AiErrorKind;
    status: number | null;
    body: string;
    requestId: string | null;
    label: string;
    url: string;
    durationMs: number;
    timeoutMs: number;
    raw?: unknown;
  }) {
    super(
      describeError(params.kind, params.status, params.body, params.url, params.timeoutMs)
    );
    this.name = "AiError";
    this.kind = params.kind;
    this.status = params.status;
    this.body = params.body;
    this.requestId = params.requestId;
    this.label = params.label;
    this.url = params.url;
    this.durationMs = params.durationMs;
  }
}

/** Narrow an unknown catch binding back to AiError, or null if it's ours-not. */
export function asAiError(err: unknown): AiError | null {
  return err instanceof AiError ? err : null;
}

/** Turn a failed call into the toast the user actually sees. */
export function toastAiError(err: AiError): void {
  const metaParts = [
    err.status !== null ? `HTTP ${err.status}` : null,
    err.requestId ? `req ${err.requestId}` : null,
    `${Math.round(err.durationMs)}ms`,
  ].filter(Boolean);

  showAiToast({
    id: `${err.label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: err.kind === "timeout" ? "AI หมดเวลารอ" : "AI เรียกไม่สำเร็จ",
    detail: err.message || "เรียก AI ไม่สำเร็จ",
    kind: err.kind,
    meta: metaParts.join(" · "),
  });
}

/** Pull the backend's machine-readable code + upstream detail out of a body. */
function readBackendMeta(body: string): {
  code: string | null;
  requestId: string | null;
  upstreamStatus: number | null;
  upstreamBody: string | null;
} {
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== "object") {
      return { code: null, requestId: null, upstreamStatus: null, upstreamBody: null };
    }
    return {
      code: typeof data.code === "string" ? data.code : null,
      requestId: typeof data.requestId === "string" ? data.requestId : null,
      upstreamStatus:
        typeof data.upstream?.status === "number" ? data.upstream.status : null,
      upstreamBody:
        typeof data.upstream?.body === "string" ? data.upstream.body : null,
    };
  } catch {
    return { code: null, requestId: null, upstreamStatus: null, upstreamBody: null };
  }
}

function kindFromStatus(status: number, upstreamStatus: number | null): AiErrorKind {
  // The backend forwards the AI provider's status in `upstream.status`, so a
  // 502 wrapping a 401 is really an auth problem — not a server problem.
  const effective = upstreamStatus ?? status;
  if (effective === 401 || effective === 403) return "upstream-auth";
  if (effective === 429) return "rate-limit";
  if (effective >= 500) return "server";
  if (effective >= 400) return "bad-request";
  return "server";
}

export interface AiFetchOptions {
  /** Short name shown in diagnostics, e.g. "ai-chat". */
  label: string;
  /** Path on our backend, e.g. "/ai-chat". */
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs: number;
  /**
   * Called on every finished request with the diagnostics record. The toast
   * host uses this to decide whether to interrupt the user — success stays
   * silent.
   */
  onSettled?: (ok: boolean, error: AiError | null) => void;
}

export async function aiFetch<T>(opts: AiFetchOptions): Promise<T> {
  const { label, path, method = "POST", body, timeoutMs } = opts;
  const url = `${API_BASE_URL}${path}`;
  const startedAt = Date.now();
  const requestPreview = body === undefined ? "" : truncate(JSON.stringify(body), 500);

  const finish = (
    status: number | null,
    outcome: "ok" | "error",
    responsePreview: string,
    requestId: string | null,
    errorKind: AiErrorKind | null,
    errorMessage: string | null
  ): AiCallRecordShape => ({
    id: newId(),
    label,
    method,
    url,
    startedAt,
    durationMs: Date.now() - startedAt,
    status,
    outcome,
    requestPreview,
    responsePreview,
    requestId,
    errorKind,
    errorMessage,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Read the body FIRST — this is the part every old call site skipped.
    const text = await res.text().catch(() => "");
    const requestId = res.headers?.get?.("x-request-id") ?? null;
    const meta = readBackendMeta(text);

    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const kind = kindFromStatus(res.status, meta.upstreamStatus);
      // Prefer the backend's own Thai sentence; fall back to our classifier.
      const backendMessage =
        typeof (parsed as any)?.error === "string"
          ? (parsed as any).error
          : typeof (parsed as any)?.message === "string"
          ? (parsed as any).message
          : null;
      const errorMessage = backendMessage ?? describeError(kind, res.status, text, url, timeoutMs);

      record(finish(res.status, "error", truncate(text, 2000), requestId ?? meta.requestId, kind, errorMessage));

      const err = new AiError({
        kind,
        status: res.status,
        body: meta.upstreamBody ?? text,
        requestId: requestId ?? meta.requestId,
        label,
        url,
        durationMs: Date.now() - startedAt,
        timeoutMs,
      });
      // Carry the backend's wording onto the error so the UI can show it verbatim.
      err.message = errorMessage;
      opts.onSettled?.(false, err);
      throw err;
    }

    record(finish(res.status, "ok", truncate(text, 2000), requestId ?? meta.requestId, null, null));
    opts.onSettled?.(true, null);
    return parsed as T;
  } catch (err: any) {
    if (err instanceof AiError) throw err; // already recorded above

    // AbortError = our timeout; anything else = the request never landed
    // (wrong host, backend down, CORS, DNS).
    const isAbort = err?.name === "AbortError" || err?.name === "TimeoutError";
    const kind: AiErrorKind = isAbort ? "timeout" : "network";
    const message = describeError(kind, null, String(err?.message ?? ""), url, timeoutMs);

    record(finish(null, "error", truncate(String(err?.message ?? ""), 2000), null, kind, message));

    const wrapped = new AiError({
      kind,
      status: null,
      body: String(err?.message ?? ""),
      requestId: null,
      label,
      url,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      raw: err,
    });
    wrapped.message = message;
    opts.onSettled?.(false, wrapped);
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

/** Local mirror of the record shape, kept private to avoid a circular import. */
type AiCallRecordShape = Parameters<typeof record>[0];