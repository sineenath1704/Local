/**
 * เรียกโมเดลแบบสตรีม (SSE) — กัน proxy ข้างหน้าปลายทางตัดสาย
 * ============================================================
 * ปลายทาง AI ที่ใช้อยู่ (nrrai2-model.sit.kmutt.ac.th) มี reverse proxy
 * ข้างหน้า ซึ่งตัดการเชื่อมต่อถ้า "ไม่มีข้อมูลไหลมา" นานเกิน ~60 วินาที
 * (nginx proxy_read_timeout) → ตอบ 504 กลางทาง
 *
 * เดิมเรียกแบบไม่สตรีม (รอ JSON ทั้งก้อน) → ตอนที่โมเดลกำลังเขียนคำตอบ
 * ยาว ๆ (สรุปโครงสร้าง JSON) จะเงียบไปนาน → ตายเงียบ 504
 * (เคยเห็น 61.6 วินาที แล้วขั้นตอน "สรุปโครงสร้าง (M3)" ล้มเหลว)
 *
 * การสตรีมทำให้มี chunk ไหลมาตลอด → proxy ไม่มีเหตุผลที่จะตัดสาย
 *
 * ถ้าปลายทางไม่รับสตรีม (400/404/405/415/422) หรือส่งมาแต่ไม่มีข้อความ
 * → ถอยไปเรียกแบบไม่สตรีมเอง โดยไม่ให้ผู้เรียกต้องรู้
 */

/** ผลลัพธ์ของการอ่านสตรีม */
export interface StreamResult {
  text: string;
  stopReason: string | null;
  outputTokens: number | null;
}

/**
 * อ่านคำตอบแบบสตรีม (SSE) ของ endpoint ที่เข้ากับ Anthropic Messages API
 * -------------------------------------------------------------
 * เขียนให้ทนทาน: รับได้ทั้งรูปแบบ Anthropic (delta.text), OpenAI
 * (choices[0].delta.content) และรูปแบบที่ส่งข้อความเต็มก้อนมาใน
 * content_block — เพราะปลายทางที่ใช้อยู่เป็น gateway คนละเจ้า
 */
export async function readEventStream(res: Response): Promise<StreamResult> {
  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason: string | null = null;
  let outputTokens: number | null = null;

  const handlePayload = (payload: any) => {
    if (!payload || typeof payload !== "object") return;
    const deltaText =
      typeof payload?.delta?.text === "string"
        ? payload.delta.text
        : typeof payload?.delta?.content === "string"
        ? payload.delta.content
        : typeof payload?.choices?.[0]?.delta?.content === "string"
        ? payload.choices[0].delta.content
        : typeof payload?.content_block?.text === "string"
        ? payload.content_block.text
        : "";
    if (deltaText) text += deltaText;

    const reason =
      payload?.delta?.stop_reason ??
      payload?.stop_reason ??
      payload?.choices?.[0]?.finish_reason ??
      null;
    if (typeof reason === "string" && reason) stopReason = reason;

    const tokens =
      typeof payload?.usage?.output_tokens === "number"
        ? payload.usage.output_tokens
        : typeof payload?.message?.usage?.output_tokens === "number"
        ? payload.message.usage.output_tokens
        : null;
    if (tokens != null) outputTokens = tokens;
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      handlePayload(JSON.parse(data));
    } catch {
      // เก็บข้ามบรรทัดที่แปลง JSON ไม่ได้ — บาง gateway ส่ง keep-alive
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  return { text: text.trim(), stopReason, outputTokens };
}

/** ผลลัพธ์ของ callAiText */
export type AiTextResult =
  | {
      ok: true;
      status: number;
      text: string;
      stopReason: string | null;
      outputTokens: number | null;
      /** true = คำตอบมาทางสตรีม, false = ถอยไปแบบไม่สตรีม */
      streamed: boolean;
    }
  | { ok: false; status: number; body: string };

/** ตัวเลขสถานะที่แปลว่า "ปลายทางไม่รับสตรีม" → ถอยไปแบบไม่สตรีม */
const NO_STREAM_STATUSES = [400, 404, 405, 415, 422];

type SendResult =
  | { kind: "ok"; status: number; text: string; stopReason: string | null; outputTokens: number | null; streamed: boolean }
  | { kind: "http-error"; status: number; body: string }
  | { kind: "stream-empty" };

/**
 * เรียกโมเดลหนึ่งครั้ง — สตรีมก่อนเสมอ ถอยเป็นแบบไม่สตรีมอัตโนมัติ
 * -------------------------------------------------------------
 * `body` คือ payload ของ Anthropic Messages API (model / max_tokens /
 * system / messages) — ฟังก์ชันนี้จะเติม `stream` ให้เอง
 */
export async function callAiText(opts: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<AiTextResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const send = async (stream: boolean): Promise<SendResult> => {
    const res = await fetch(opts.url, {
      method: "POST",
      signal: controller.signal,
      headers: opts.headers,
      body: JSON.stringify({ ...opts.body, stream }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { kind: "http-error", status: res.status, body };
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (stream && res.body && contentType.includes("text/event-stream")) {
      const s = await readEventStream(res);
      if (s.text) {
        return {
          kind: "ok",
          status: res.status,
          text: s.text,
          stopReason: s.stopReason,
          outputTokens: s.outputTokens,
          streamed: true,
        };
      }
      // กิน body ไปแล้ว → ต้องยิงใหม่แบบไม่สตรีม
      return { kind: "stream-empty" };
    }

    const data: any = await res.json();
    const text: string = Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content.trim()
      : "";
    return {
      kind: "ok",
      status: res.status,
      text,
      stopReason: typeof data?.stop_reason === "string" ? data.stop_reason : null,
      outputTokens:
        typeof data?.usage?.output_tokens === "number"
          ? data.usage.output_tokens
          : null,
      streamed: false,
    };
  };

  try {
    let r = await send(true);
    if (r.kind === "stream-empty") {
      r = await send(false);
    } else if (r.kind === "http-error" && NO_STREAM_STATUSES.includes(r.status)) {
      r = await send(false);
    }

    if (r.kind === "http-error") {
      return { ok: false, status: r.status, body: r.body };
    }
    if (r.kind === "stream-empty") {
      return {
        ok: false,
        status: 502,
        body: "สตรีมไม่ได้ส่งข้อความกลับมา (และแบบไม่สตรีมก็ไม่ได้ผล)",
      };
    }
    return { ok: true, ...r };
  } finally {
    clearTimeout(timer);
  }
}
