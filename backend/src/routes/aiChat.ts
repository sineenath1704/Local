import { Router, Request, Response } from "express";
import { callAi, isAiConfigured, AiMessage } from "../aiCore";
import { buildChatSystemPrompt, FolderContext, PlaceContext } from "../tripPrompt";

import { getSupabaseAdmin } from "../supabaseAdmin";
import { requestId } from "../middleware/requestContext";
import { sendError } from "../middleware/errors";

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
    return res.status(400).json({
      error: "ต้องส่ง messages อย่างน้อย 1 ข้อความ",
      code: "BAD_REQUEST",
      requestId: requestId(req),
    });
  }

  // If no explicit place was passed, check if user mentions any registered community place
  let resolvedPlace = place;
  if (!resolvedPlace && messages.length > 0) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser?.content) {
      try {
        const admin = getSupabaseAdmin();
        if (admin) {
          // business_hours / business_pricing are the structured twins of the
          // free-text opening_hours / price_info — the AI can answer "เปิดวัน
          // อาทิตย์ไหม" from them without re-parsing prose on every prompt.
          // The users embed adds who runs the place, for "ใครเป็นเจ้าของ".
          const { data: places } = await admin
            .from("community_places")
            .select(
              "place_name, formatted_address, province, district, subdistrict, village, google_maps_url, phone, opening_hours, price_info, rating, user_ratings_total, business_hours, business_pricing, users:owner_id (display_name, bio, avatar_url, total_likes_received, videos(count))"
            )
            .limit(50);

          if (places && places.length > 0) {
            // Rank instead of take-the-first-hit. Querying "บ้านปายเปิดกี่โมง"
            // matches both "บ้านปาย" and "บ้านปายใหม่", and the old `.find()`
            // returned whichever row Postgres happened to order first. The
            // longer name is the more specific one the traveller wrote, so it
            // wins; rating only breaks a genuine tie.
            const query = lastUser.content.toLowerCase();
            const matched = places
              .filter((p) => p.place_name && query.includes(p.place_name.toLowerCase()))
              .sort((a, b) => {
                const lenDiff = (b.place_name?.length ?? 0) - (a.place_name?.length ?? 0);
                if (lenDiff !== 0) return lenDiff;
                return (Number(b.rating) || 0) - (Number(a.rating) || 0);
              })[0];
            if (matched) {
              // owner_id is nullable (ON DELETE SET NULL), so a place whose
              // host deleted their account comes back with no embed at all.
              const host = Array.isArray(matched.users) ? matched.users[0] : matched.users;
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
                businessHours: matched.business_hours ?? undefined,
                businessPricing: matched.business_pricing ?? undefined,
                hostProfile: host
                  ? {
                      displayName: host.display_name ?? undefined,
                      bio: host.bio ?? undefined,
                      avatarUrl: host.avatar_url ?? undefined,
                      videoCount: host.videos?.[0]?.count ?? 0,
                      likesReceived: host.total_likes_received ?? 0,
                    }
                  : undefined,
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
    return sendError(res, err, req);
  }
});

export default router;
