import { useSyncExternalStore } from "react";
import { API_BASE_URL } from "./apiConfig";

/**
 * AI call diagnostics.
 * =============================================================
 * Every AI call used to swallow its failure and hand the UI one of two
 * values: `null` or a fixed Thai apology string. That made "why is the AI
 * broken?" unanswerable — a 401 from the upstream provider, a DNS failure,
 * an 8-second timeout and a genuinely-not-ready summary all looked
 * identical to the person holding the phone.
 *
 * This module keeps a rolling history of every call (success and failure)
 * so the Diagnostics screen can show what actually happened: which URL was
 * hit, which status came back, how long it took, and what the server said.
 */

export type AiErrorKind =
  | "network" // couldn't reach the host at all — usually a wrong base URL
  | "timeout" // AbortController fired
  | "not-configured" // backend answered 200 but has no AI token
  | "upstream-auth" // 401/403 from the AI provider
  | "rate-limit" // 429
  | "server" // 5xx
  | "bad-request" // 400 / 404 / other 4xx
  | "bad-shape"; // 2xx but the JSON wasn't what we expected

export type AiCallOutcome = "ok" | "error";

export interface AiCallRecord {
  id: string;
  label: string;
  method: "GET" | "POST";
  url: string;
  startedAt: number;
  durationMs: number;
  /** null when the request never produced a response (network / timeout). */
  status: number | null;
  outcome: AiCallOutcome;
  requestPreview: string;
  responsePreview: string;
  /** From the backend's `x-request-id` — grep this in the backend terminal. */
  requestId: string | null;
  errorKind: AiErrorKind | null;
  errorMessage: string | null;
}

/* ── ring buffer ────────────────────────────────────────────────────────── */

const MAX_RECORDS = 50;
let records: AiCallRecord[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function record(entry: AiCallRecord): void {
  // Newest first, capped — a long session must not grow without bound.
  records = [entry, ...records].slice(0, MAX_RECORDS);
  emit();
}

export function clearRecords(): void {
  records = [];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => records;

export function useAiDiagnostics(): AiCallRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* ── error classification ───────────────────────────────────────────────── */

/** Map a finished request into a UI colour + label. */
export function kindColor(kind: AiErrorKind | null): string {
  switch (kind) {
    case "network":
      return "#DC2626"; // red — nothing listening / wrong URL
    case "timeout":
      return "#EA580C"; // orange
    case "not-configured":
      return "#CA8A04"; // amber
    case "upstream-auth":
      return "#B91C1C"; // dark red
    case "rate-limit":
      return "#7C3AED"; // violet
    case "server":
      return "#DC2626";
    case "bad-request":
      return "#0891B2"; // cyan
    case "bad-shape":
      return "#CA8A04";
    default:
      return "#16A34A"; // green (ok)
  }
}

export function kindLabel(kind: AiErrorKind | null): string {
  switch (kind) {
    case "network":
      return "ต่อเซิร์ฟเวอร์ไม่ได้";
    case "timeout":
      return "หมดเวลารอ";
    case "not-configured":
      return "ยังไม่ได้ตั้งค่า AI";
    case "upstream-auth":
      return "token AI ไม่ถูกต้อง";
    case "rate-limit":
      return "โควตาเต็ม (429)";
    case "server":
      return "เซิร์ฟเวอร์มีปัญหา";
    case "bad-request":
      return "คำขอไม่ถูกต้อง";
    case "bad-shape":
      return "ข้อมูลตอบกลับผิดรูป";
    default:
      return "สำเร็จ";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "(ไม่ทราบ)";
  }
}

/**
 * Turn a failure into a sentence that names the cause, so the toast tells
 * the user something actionable instead of "AI ขัดข้องชั่วคราว".
 */
export function describeError(
  kind: AiErrorKind,
  status: number | null,
  body: string,
  url: string,
  timeoutMs?: number
): string {
  const host = hostOf(url);
  switch (kind) {
    case "network":
      return `ต่อ ${host} ไม่ได้ — backend ไม่ได้รัน หรือ EXPO_PUBLIC_API_BASE_URL ชี้ผิดที่`;
    case "timeout":
      return `AI ไม่ตอบใน ${Math.round((timeoutMs ?? 0) / 1000)} วินาที (timeout)`;
    case "not-configured":
      return "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า AI (ANTHROPIC_AUTH_TOKEN) — กำลังใช้คำตอบตัวอย่าง";
    case "upstream-auth":
      return `AI ปฏิเสธการเชื่อมต่อ (${status}) — ต้องตั้ง ANTHROPIC_AUTH_TOKEN ใหม่บน backend`;
    case "rate-limit":
      return "AI ปฏิเสธเพราะโควตาเต็ม (429) — ลองอีกครั้งในอีกสักครู่";
    case "server":
      return `ปลายทาง AI มีปัญหา (${status})`;
    case "bad-request":
      return `คำขอถูกปฏิเสธ (${status})`;
    case "bad-shape":
      return "ข้อมูลที่ backend ส่งกลับไม่ตรงกับที่แอปคาด";
    default:
      return body ? body.slice(0, 200) : "เรียก AI ไม่สำเร็จ";
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

let counter = 0;
export function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (+${text.length - max})` : text;
}

/** The base URL every AI call is actually hitting — surfaced in Settings. */
export function describeBaseUrl(): string {
  return API_BASE_URL || "(ว่าง — จะใช้ localhost ตามแพลตฟอร์ม)";
}

/* ── toast bus ──────────────────────────────────────────────────────────── */

/**
 * Kept here rather than in the toast component so services can raise a toast
 * without importing any UI module.
 */
export interface AiToastPayload {
  id: string;
  title: string;
  detail: string;
  kind: AiErrorKind;
  meta?: string;
}

type ToastListener = (t: AiToastPayload) => void;
const toastListeners = new Set<ToastListener>();

export function showAiToast(payload: AiToastPayload): void {
  toastListeners.forEach((l) => l(payload));
}

export function subscribeToasts(listener: ToastListener): () => void {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}