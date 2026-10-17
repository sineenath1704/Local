import { Router, Request, Response } from "express";
import { callAi, isAiConfigured, AiMessage } from "../aiCore";
import { buildChatSystemPrompt, FolderContext, PlaceContext } from "../tripPrompt";

import { getSupabaseAdmin } from "../supabaseAdmin";

const router = Router();

/**
 * POST /ai-chat
 * -------------------------------------------------------------
 * General AI chat (trip-planning assistant). Stateless: the client sends
 * the running conversation each turn.
 *
 * Body: {
 *   messages: { role: "user" | "assistant", content: string }[],
 *   folder?: { folderName: string, places: string[] },   // optional folder context
 *   place?: PlaceContext                                 // optional specific place context
 * }
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const messages: AiMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const folder: FolderContext | undefined = body.folder;
  const place: PlaceContext | undefined = body.place;

  if (messages.length === 0) {
    return res.status(400).json({ error: "messages is required" });
  }

  // If no explicit place was passed, check if user mentions any registered community place
  let resolvedPlace = place;
  if (!resolvedPlace && messages.length > 0) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser?.content) {
      try {
        const admin = getSupabaseAdmin();
        if (admin) {
          const { data: places } = await admin
            .from("community_places")
            .select(
              "place_name, formatted_address, province, district, subdistrict, village, google_maps_url, phone, opening_hours, price_info, rating, user_ratings_total"
            )
            .limit(20);

          if (places && places.length > 0) {
            const matched = places.find(
              (p) =>
                p.place_name &&
                lastUser.content.toLowerCase().includes(p.place_name.toLowerCase())
            );
            if (matched) {
              resolvedPlace = {
                placeName: matched.place_name,
                address: matched.formatted_address,
                province: matched.province,
                district: matched.district,
                subdistrict: matched.subdistrict,
                village: matched.village,
                googleMapsUrl: matched.google_maps_url,
                phone: matched.phone,
                openingHours: matched.opening_hours,
                priceInfo: matched.price_info,
                rating: matched.rating,
                userRatingsTotal: matched.user_ratings_total,
              };
            }
          }
        }
      } catch {
        // Table may not be queried yet; ignore gracefully
      }
    }
  }

  const system = buildChatSystemPrompt(folder, resolvedPlace);

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
    const reply = await callAi({ system, messages, maxTokens: 2048 });
    return res.json({ reply });
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ AI" : err?.message || "AI ตอบกลับไม่สำเร็จ";
    return res.status(502).json({ error: message });
  }
});

export default router;
