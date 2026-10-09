import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface FolderContext {
  folderName: string;
  places: string[];
}

async function postJson(path: string, body: any, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send the running conversation to the backend AI chat endpoint.
 * Returns the assistant's reply text, or a friendly fallback on failure.
 */
export async function sendChat(
  messages: ChatTurn[],
  folder?: FolderContext
): Promise<string> {
  try {
    const res = await postJson("/ai-chat", { messages, folder }, API_TIMEOUT_MS * 3);
    if (!res.ok) {
      return "ขออภัย ระบบ AI ขัดข้องชั่วคราว ลองใหม่อีกครั้งนะครับ";
    }
    const data = await res.json();
    return typeof data.reply === "string" ? data.reply : "ขออภัย ไม่สามารถตอบได้ในตอนนี้";
  } catch {
    return "เชื่อมต่อเซิร์ฟเวอร์ AI ไม่ได้ ตรวจสอบว่า backend กำลังรันอยู่หรือไม่";
  }
}
