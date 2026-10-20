/**
 * Typed error for a failed upstream AI call.
 * -------------------------------------------------------------
 * Before this existed, a non-OK response from the AI provider was
 * squashed into `new Error("AI endpoint error 401: <first 300 chars>")`,
 * which meant the client could never tell *why* the AI failed — every
 * failure looked identical.
 *
 * This keeps the real status code AND the full upstream body so the
 * route layer can hand both back to the app (and to the diagnostics log).
 */

/** Cap the upstream body we keep, so a runaway HTML error page can't bloat logs. */
const MAX_BODY_CHARS = 4000;

export class AiUpstreamError extends Error {
  readonly upstreamStatus: number;
  readonly upstreamBody: string;

  constructor(upstreamStatus: number, upstreamBody: string) {
    const body = (upstreamBody || "").slice(0, MAX_BODY_CHARS);
    super(`AI endpoint error ${upstreamStatus}: ${body.slice(0, 300)}`);
    this.name = "AiUpstreamError";
    this.upstreamStatus = upstreamStatus;
    this.upstreamBody = body;
  }
}

/** Machine-readable failure code sent alongside every error response. */
export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_UPSTREAM_ERROR"
  | "AI_TIMEOUT"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "INTERNAL";

/** Best-effort classification of an arbitrary thrown value. */
export function classifyError(err: any): AiErrorCode {
  if (err instanceof AiUpstreamError) return "AI_UPSTREAM_ERROR";
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return "AI_TIMEOUT";
  const msg = String(err?.message ?? "");
  if (msg.includes("AI_NOT_CONFIGURED")) return "AI_NOT_CONFIGURED";
  return "INTERNAL";
}

/** Thai text that names the actual root cause instead of a generic apology. */
export function describeError(err: any): string {
  if (err instanceof AiUpstreamError) {
    const status = err.upstreamStatus;
    if (status === 401 || status === 403) {
      return `AI ปฏิเสธการเชื่อมต่อ (${status}) — ANTHROPIC_AUTH_TOKEN ไม่ถูกต้องหรือหมดอายุ`;
    }
    if (status === 404) {
      return `AI endpoint ไม่พบ (404) — ANTHROPIC_BASE_URL อาจผิดที่`;
    }
    if (status === 429) {
      return `AI ปฏิเสธเพราะโควตา/เรต (429) — ลองใหม่อีกครั้งในอีกสักครู่`;
    }
    if (status >= 500) {
      return `ปลายทาง AI มีปัญหา (${status})`;
    }
    return `เรียก AI ไม่สำเร็จ (${status})`;
  }
  if (err?.name === "AbortError" || err?.name === "TimeoutError") {
    return "AI ไม่ตอบในเวลาที่กำหนด (timeout)";
  }
  const msg = String(err?.message ?? "");
  if (msg.includes("AI_NOT_CONFIGURED")) {
    return "ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)";
  }
  return msg || "เรียก AI ไม่สำเร็จ";
}