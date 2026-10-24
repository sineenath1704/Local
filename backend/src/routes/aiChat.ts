import { Router, Request, Response } from "express";
import { callAi, isAiConfigured, AiMessage } from "../aiCore";
import { buildChatSystemPrompt, FolderContext, HostSelfContext, PlaceContext } from "../tripPrompt";

import { getSupabaseAdmin } from "../supabaseAdmin";
import { requestId } from "../middleware/requestContext";
import { sendError } from "../middleware/errors";

/**
 * POST /ai-chat
 * -------------------------------------------------------------
 * General AI chat (trip-planning assistant). Stateless: the client sends
 * the running conversation each turn.
 *
 * Body: {
 *   messages: { role: "user" | "assistant", content: string }[],
 *   folder?: { folderName: string, places: string[] },   // optional folder context
 *   place?: PlaceContext,                                // optional specific place context
 *   mode?:  "tourist" | "host-self"                      // host-self = JWT-gated advisor
 * }
 *
 * `mode: "host-self"` flips the handler into private advisor mode: the
 * caller's JWT identifies them, the backend pulls their own users row +
 * community_places row, and the prompt is rebuilt with their structured
 * business data. Tourist mode remains unauthenticated — anyone can ask
 * about a public place.
 */
function toHostSelfContext(
  userRow: any,
  placeRow: any,
): HostSelfContext {
  return {
    displayName: userRow.display_name ?? "",
    bio: userRow.bio ?? null,
    avatarUrl: userRow.avatar_url ?? null,
    otopVillageId: userRow.otop_village_id ?? null,
    otopVillage: userRow.otop_village ?? null,
    otopTambol: userRow.otop_tambol ?? null,
    otopAmphur: userRow.otop_amphur ?? null,
    otopProvince: userRow.otop_province ?? null,
    otopNawatwithi: userRow.otop_nawatwithi ?? null,
    otopForTourism: userRow.otop_for_tourism ?? null,
    otopCbtVillage: userRow.otop_cbt_village ?? null,
    otopVerified: Boolean(userRow.otop_verified),
    businessPlaceName: userRow.business_place_name ?? null,
    businessAddress: userRow.business_address ?? null,
    businessSubdistrict: userRow.business_subdistrict ?? null,
    businessDistrict: userRow.business_district ?? null,
    businessProvince: userRow.business_province ?? null,
    businessPhone: userRow.business_phone ?? null,
    businessPriceInfo: userRow.business_price_info ?? null,
    businessPriceLevel: placeRow?.price_level ?? null,
    businessWebsite: placeRow?.website ?? null,
    businessCapacity: placeRow?.capacity ?? null,
    businessRules: placeRow?.house_rules ?? null,
    businessAreas: placeRow?.areas ?? null,
    businessFacilities: placeRow?.facilities ?? null,
    businessLat: userRow.business_lat ?? null,
    businessLng: userRow.business_lng ?? null,
    businessHours: placeRow?.business_hours ?? undefined,
    businessPricing: placeRow?.business_pricing ?? undefined,
    // videos(count) embed → array with one object; tolerate either shape.
    videoCount:
      Array.isArray(userRow.videos) && userRow.videos[0]?.count != null
        ? Number(userRow.videos[0].count)
        : 0,
    likesReceived: Number(userRow.total_likes_received ?? 0),
    followersCount: Number(userRow.followers_count ?? 0),
  };
}

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const messages: AiMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const folder: FolderContext | undefined = body.folder;
  const place: PlaceContext | undefined = body.place;
  const mode: "tourist" | "host-self" = body.mode === "host-self" ? "host-self" : "tourist";

  if (messages.length === 0) {
    return res.status(400).json({
      error: "ต้องส่ง messages อย่างน้อย 1 ข้อความ",
      code: "BAD_REQUEST",
      requestId: requestId(req),
    });
  }

  let resolvedPlace: PlaceContext | undefined = place;
  let resolvedHostSelf: HostSelfContext | undefined;

  if (mode === "host-self") {
    // ---- host-self: JWT-gated advisor mode ------------------------------
    // The whole conversation stays private to the host. We never use this
    // mode for anyone except the JWT-identified caller, and only when their
    // role is "host" (the supabaseAdmin client bypasses RLS, so the role
    // check happens here, not at the DB).
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({
        error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
        code: "NOT_CONFIGURED",
        requestId: requestId(req),
      });
    }

    const token = /^Bearer\s+(.+)$/i.exec(req.header("authorization") ?? "")?.[1]?.trim();
    if (!token) {
      return res.status(401).json({
        error: "ต้องล็อกอินเพื่อใช้โหมดผู้ประกอบการ",
        code: "UNAUTHORIZED",
        requestId: requestId(req),
      });
    }

    let userId: string;
    try {
      const { data: verified, error: verifyErr } = await admin.auth.getUser(token);
      if (verifyErr || !verified?.user?.id) {
        return res.status(401).json({
          error: "โทเค็นไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
          code: "UNAUTHORIZED",
          requestId: requestId(req),
        });
      }
      userId = verified.user.id;
    } catch (e: any) {
      return sendError(res, e, req, 401);
    }

    // The users row carries everything editable + OTOP; videos(count) gives
    // the host's own video total without a second round-trip. community_places
    // holds the structured JSONB twins — fetched separately because the embed
    // could land on any of the host's rows (a homestay + a cafe, etc.).
    const { data: userRow, error: userErr } = await admin
      .from("users")
      .select(
        "display_name, bio, avatar_url, role, business_place_name, business_address, business_subdistrict, business_district, business_province, business_phone, business_price_info, business_lat, business_lng, otop_village_id, otop_village, otop_tambol, otop_amphur, otop_province, otop_nawatwithi, otop_for_tourism, otop_cbt_village, otop_verified, total_likes_received, followers_count, videos(count)"
      )
      .eq("id", userId)
      .single();

    if (userErr || !userRow) {
      return res.status(404).json({
        error: "ไม่พบบัญชีผู้ใช้",
        code: "USER_NOT_FOUND",
        requestId: requestId(req),
      });
    }
    if (userRow.role !== "host") {
      return res.status(403).json({
        error: "โหมดนี้สำหรับ host เท่านั้น",
        code: "FORBIDDEN",
        requestId: requestId(req),
      });
    }

    // Latest place the host owns. maybeSingle because a host may have saved
    // their profile but not yet picked a place on the map.
    const hostPlaceQuery = (columns: string) =>
      admin
        .from("community_places")
        .select(columns)
        .eq("owner_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    const { data: placeRow } = await hostPlaceQuery(
      "business_hours, business_pricing, place_name, google_maps_url, price_level, website, capacity, house_rules, areas, facilities"
    );
    // The four fact columns need their migration. Without it the wide select
    // fails and the host's own place disappears from their advisor — ask
    // again without them.
    const { data: placeRowFallback } = placeRow
      ? { data: null }
      : await hostPlaceQuery(
          "business_hours, business_pricing, place_name, google_maps_url, price_level, website"
        );
    resolvedHostSelf = toHostSelfContext(userRow, placeRow ?? placeRowFallback);
  } else if (!resolvedPlace && messages.length > 0) {
    // If no explicit place was passed, check if user mentions any registered community place
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser?.content) {
      try {
        const admin = getSupabaseAdmin();
        if (admin) {
          // business_hours / business_pricing are the structured twins of the
          // free-text opening_hours / price_info — the AI can answer "เปิดวัน
          // อาทิตย์ไหม" from them without re-parsing prose on every prompt.
          // The users embed adds who runs the place, for "ใครเป็นเจ้าของ".
          // business_phone / OTOP fields are host-edited overrides that win
          // over whatever Google scraped.
          const placeColumns = [
            "place_name", "formatted_address", "province", "district",
            "subdistrict", "village", "google_maps_url", "phone",
            "opening_hours", "price_info", "price_level", "website",
            "rating", "user_ratings_total", "business_hours",
            "business_pricing",
            // The four clip-derived facts — they need their migration.
            "capacity", "house_rules", "areas", "facilities",
            "users:owner_id (display_name, bio, avatar_url, total_likes_received, business_phone, business_address, business_subdistrict, business_district, business_province, otop_village_id, otop_village, otop_province, otop_nawatwithi, otop_verified, videos(count))",
          ];
          const withoutFacts = placeColumns.filter(
            (c) => !["capacity", "house_rules", "areas", "facilities"].includes(c)
          );
          const widePlaces = (await admin
            .from("community_places")
            .select(placeColumns.join(", "))
            .limit(50)).data as any[] | null;
          // Without the migration the wide select fails and the place context
          // disappears entirely — worse than missing four facts. Ask again
          // without them so the chat still knows the place.
          const places: any[] | null =
            widePlaces ??
            ((await admin
              .from("community_places")
              .select(withoutFacts.join(", "))
              .limit(50)).data as any[] | null);

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
                priceLevel: matched.price_level ?? undefined,
                website: matched.website ?? undefined,
                capacity: matched.capacity ?? undefined,
                rules: matched.house_rules ?? undefined,
                areas: matched.areas ?? undefined,
                facilities: matched.facilities ?? undefined,
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
                      otopVerified: Boolean(host.otop_verified),
                      otopVillage: host.otop_village ?? undefined,
                      otopProvince: host.otop_province ?? undefined,
                      otopNawatwithi: host.otop_nawatwithi ?? undefined,
                      phone: host.business_phone ?? undefined,
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

  const system = buildChatSystemPrompt(folder, resolvedPlace, resolvedHostSelf);

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
