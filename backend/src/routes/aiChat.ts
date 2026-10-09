import { Router, Request, Response } from "express";
import { callAi, isAiConfigured, AiMessage } from "../aiCore";
import { buildChatSystemPrompt, FolderContext } from "../tripPrompt";

const router = Router();

/**
 * POST /ai-chat
 * -------------------------------------------------------------
 * General AI chat (trip-planning assistant). Stateless: the client sends
 * the running conversation each turn.
 *
 * Body: {
 *   messages: { role: "user" | "assistant", content: string }[],
 *   folder?: { folderName: string, places: string[] }   // optional folder context
 * }
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const messages: AiMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const folder: FolderContext | undefined = body.folder;

  if (messages.length === 0) {
    return res.status(400).json({ error: "messages is required" });
  }

  const system = buildChatSystemPrompt(folder);

  if (!isAiConfigured()) {
    // Graceful stub so the app works before the token is set.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return res.json({
      reply:
        "ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (ANTHROPIC_AUTH_TOKEN) — นี่คือข้อความตัวอย่าง\n\n" +
        (folder
          ? `ถ้าตั้งค่าแล้ว ผมจะช่วยวางแผนทริปจากคลิปในโฟลเดอร์ "${folder.folderName}" ให้ครับ`
          : `คุณถามว่า: "${lastUser?.content ?? ""}"`),
    });
  }

  try {
    const reply = await callAi({ system, messages, maxTokens: 1024 });
    return res.json({ reply });
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ AI" : err?.message || "AI ตอบกลับไม่สำเร็จ";
    return res.status(502).json({ error: message });
  }
});

export default router;
