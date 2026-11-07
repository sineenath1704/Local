import { Router, Request, Response } from "express";
import { callAi, isAiConfigured, AiMessage } from "../aiCore";
import {
  buildChatSystemPrompt,
  buildClipContextBlock,
  buildPlanContextBlock,
  buildSearchContextBlock,
  buildTripDraftBlock,
  buildTripDraftResult,
  mergeTripSlots,
  normalizeTripSlots,
  parseTripDraftLine,
  FolderContext,
  HostSelfContext,
  PlaceContext,
  TripSlots,
} from "../tripPrompt";
import {
  searchTravelInfo,
  shouldSearchTravel,
  topicTagFromCategory,
  TravelSource,
  TravelTopicTag,
} from "../geminiSearch";
import {
  formatCommunityContext,
  loadCommunityBundle,
  loadNearbyCommunities,
  resolveCommunityByName,
} from "../communityContext";
import {
  loadFolderContext,
  formatFolderContextBlock,
  FolderAccessError,
} from "../folderContext";
import type { FolderPlace } from "../folderContext";
import { lookupPlace, findNameMatches } from "../placeLookup";
import type { PlaceChoice } from "../placeLookup";
import type { LocationScope } from "../placeScope";
import { detectProvinceInText } from "../communityContext";

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
 *   folder?: { folderName: string, places: string[] },   // optional folder context (legacy)
 *   folderId?: string,                                  // optional — ให้ backend โหลดโฟลเดอร์เอง
 *   place?: PlaceContext,                                // optional specific place context
 *   mode?:  "tourist" | "host-self",                     // host-self = JWT-gated advisor
 *   communityId?: string,                                // optional community context (D22)
 *   placeName?: string,                                  // ชื่อสถานที่ที่กำลังถาม (ค้นให้ตรงแห่ง)
 *   clipContext?: { ... },                               // บริบทจากคลิปที่ผู้ใช้กูลับมาแชท
 *   tripDraft?: { slots, missing?, planReady? },        // สถานะช่องข้อมูลแผนทริปที่สะสมไว้
 *   planContext?: { ... },                               // แผนเดิมที่ผู้ใช้กำลังจะแก้
 * }
 *
 * Response เพิ่ม `tripDraft: { slots, missing, planReady }`
 *   → มีเฉพาะตอนที่โมเดลส่งสัญญาณ `TRIP_DRAFT:` มา (คือผู้ใช้กำลังวางแผนทริปจริง ๆ)
 *   → ไม่มี = แอปไม่ต้องโชว์ปุ่มแผน (กันปุ่มขึ้นทุกครั้งที่เอไอตอบ)
 *
 * `folderId` คือ path ใหม่: ฝั่งแอปส่งแค่รหัสโฟลเดอร์ → backend ไปอ่านคลิปจริง
 * จับคู่กับทะเบียนสถานที่ แล้วเรียบเรียงเป็นบล็อกข้อมูลให้เอง
 * (ถ้าไม่มี token หรือโหลดไม่ได้ → ถอยไปใช้ `folder` แบบเดิมที่ client ส่งมา
 *  ถ้ามี → รักษาการทำงานของแชทแบบไม่ล็อกอินไว้)
 *
 * `mode: "host-self"` flips the handler into private advisor mode: the
 * caller's JWT identifies them, the backend pulls their own users row +
 * community_places row, and the prompt is rebuilt with their structured
 * business data. Tourist mode remains unauthenticated — anyone can ask
 * about a public place.
 *
 * `communityId` บอกว่าผู้ใช้กำลังถามเรื่องชุมชนไหน — ถ้าไม่ส่งมา ระบบจะ
 * หาชุมชนจากชื่อที่ผู้ใช้พิมพ์เอง (D22) แล้วแนบสถานที่ของชุมชนนั้น
 * รวมถึงชุมชนอื่นในจังหวัดเดียวกัน (D23) เข้า prompt
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

/**
 * เช็คว่าชื่อสถานที่นี้อยู่ในทะเบียน OTOP ของระบบไหม
 * -------------------------------------------------------------
 * กฎของผู้ใช้: "นำชื่อไปค้นว่าเป็นสถานที่ OTOP ไหมก่อบ
 * ถ้าใช่ก็ติดทะเบียน OTOP ถ้าไม่ใช่ก็ท่องเที่ยวทั่วไป"
 *
 * ทะเบียน OTOP ของระบบ = ตาราง `community_places`
 * → เจอ = ติดทะเบียน OTOP · ไม่เจอ = ท่องเที่ยวทั่วไป
 */
async function isRegisteredOtopPlace(placeName: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  const name = placeName.trim();
  if (!name) return false;
  try {
    // `_` และ `%` ในชื่อจะกลายเป็น wildcard ของ SQL → ตัดออกจากรูปแบบค้น
    const pattern = name.replace(/[%_]/g, " ").trim();
    if (!pattern) return false;
    const { data, error } = await admin
      .from("community_places")
      .select("place_name")
      .ilike("place_name", `%${pattern}%`)
      .limit(20);
    if (error || !data?.length) return false;

    const rows = data as { place_name?: string | null }[];
    return rows.some((r) => {
      const rn = (r.place_name ?? "").trim();
      if (!rn) return false;
      const a = foldPlaceName(name);
      const b = foldPlaceName(rn);
      if (!a || !b) return false;
      if (a === b) return true;
      // ชื่อคล้ายกัน (บ้านปาย vs บ้านปายใหม่) → ถือว่าคนละที่
      // แต่ต้องยาวพอสมควร ไม่งั้น "บ้าน" จะไปโดนทุกชื่อที่มีคำว่า บ้าน
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length <= b.length ? b : a;
      return longer.includes(shorter) && shorter.length >= longer.length * 0.6;
    });
  } catch {
    return false;
  }
}

/** ตัดช่องว่าง/เครื่องหมายออก เพื่อเทียบชื่อสถานที่ */
function foldPlaceName(value: string): string {
  return value.toLowerCase().replace(/[\s\-_/()ฯๆ.,"'`]/g, "");
}

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const messages: AiMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const folder: FolderContext | undefined = body.folder;
  const folderId: string | null =
    typeof body.folderId === "string" && body.folderId.trim()
      ? body.folderId.trim()
      : null;
  const place: PlaceContext | undefined = body.place;
  // ผู้ใช้เลือกสถานที่จากรายการ (ตอนชื่อซ้ำหลายแห่ง) → ส่ง place_id กลับมา
  // เป็นตัวระบุเท่านั้น ไม่ใช่ข้อมูลที่ฝั่งแอปควรส่งมาเอง
  const chosenPlaceId: string | null =
    typeof body.placeId === "string" && body.placeId.trim() ? body.placeId.trim() : null;
  const chosenPlaceName: string | null =
    typeof body.placeName === "string" && body.placeName.trim() ? body.placeName.trim() : null;
  const mode: "tourist" | "host-self" = body.mode === "host-self" ? "host-self" : "tourist";
  /**
   * บริบทจากคลิปที่ผู้ใช้กูลับมาแชท (ปุ่ม "คุยต่อกับ AI เรื่องนี้")
   * → แทรกเป็นบล็อกแยกใน system prompt ให้โมเดลยึดข้อมูลคลิปเป็นหลัก
   * (ค่าที่ส่งมาถูก sanitize ใน buildClipContextBlock — ข้อมูลฝั่งแอป = ไม่ใช่คำสั่ง)
   */
  const clipBlock = buildClipContextBlock(body.clipContext);
  /**
   * สถานะช่องข้อมูลแผนทริปที่แอปส่งกลับมา (สะสมจากรอบก่อน ๆ)
   * -------------------------------------------------------------
   * แอปส่งมาได้ 2 รูปแบบ: ทั้งออบเจกต์ `{slots, missing, planReady}` หรือสล็อตตรง ๆ
   * → รับได้ทั้งสองแบบ แล้ว normalize ให้เป็นรูปแบบเดียวก่อนใช้
   */
  const rawDraft = body.tripDraft;
  const rawSlots =
    rawDraft && typeof rawDraft === "object" && "slots" in (rawDraft as any)
      ? (rawDraft as any).slots
      : rawDraft;
  const clientSlots: TripSlots = normalizeTripSlots(rawSlots);
  /**
   * แผนเดิมที่ผู้ใช้กำลังจะแก้ (ปุ่ม "ส่งกลับให้เอไอแก้" ในหน้าไทม์ไลน์)
   * → แทรกเป็นบล็อกข้อมูลใน system prompt (sanitize ใน buildPlanContextBlock)
   */
  const planBlock = buildPlanContextBlock(body.planContext);
  /**
   * ชื่อสถานที่ในคลิป = "สมอ" ของแชทนี้
   * -------------------------------------------------------------
   * ข้อความแรกของแชทมีชื่อนี้อยู่แล้ว แต่ข้อความตามมา ("ราคาเท่าไหร่",
   * "มีที่จอดรถไหม") มักไม่พูดถึงชื่อสถานที่เลย → ให้ยึดชื่อนี้ต่อ แล้วดึง
   * ข้อมูลจากทะเบียน/Google ให้ครบทุกข้อความในแชท (ไม่ใช่เฉพาะข้อแรก)
   */
  const clipCtx = (body.clipContext ?? {}) as { placeName?: unknown };
  const clipPlaceName =
    typeof clipCtx.placeName === "string"
      ? clipCtx.placeName.trim().slice(0, 200) || null
      : null;

  if (messages.length === 0) {
    return res.status(400).json({
      error: "ต้องส่ง messages อย่างน้อย 1 ข้อความ",
      code: "BAD_REQUEST",
      requestId: requestId(req),
    });
  }

  let resolvedPlace: PlaceContext | undefined = place;
  let resolvedHostSelf: HostSelfContext | undefined;
  // ข้อมูลที่ใช้ต่อในขั้นตอน "เติมข้อมูลสถานที่จาก Google" (ไม่เปลี่ยนพฤติกรรมเดิมของข้างบน)
  let registryPlaceId: string | null = null;
  let registryPlaceNames: string[] = [];
  let folderPlaces: FolderPlace[] = [];
  let communityArea: {
    community?: string | null;
    province?: string | null;
    district?: string | null;
    subdistrict?: string | null;
  } = {};
  // ชุมชนที่จะใช้เป็นบริบท (D22) — host ได้จากบัญชีตัวเอง, tourist มาจาก
  // ที่ผู้ใช้ระบุ / ชื่อที่พิมพ์ / สถานที่ที่เจอ
  let communityId: string | null =
    typeof body.communityId === "string" ? body.communityId.trim() || null : null;

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
    //
    // `community_id` มาจาก add_place_matching.sql — ถ้ายังไม่รัน migration
    // คอลัมน์จะไม่มี → ทั้ง statement ล้ม → ต้องถอยไปอ่านชุดพื้นฐาน
    const USER_COLUMNS =
      "display_name, bio, avatar_url, role, business_place_name, business_address, business_subdistrict, business_district, business_province, business_phone, business_price_info, business_lat, business_lng, otop_village_id, otop_village, otop_tambol, otop_amphur, otop_province, otop_nawatwithi, otop_for_tourism, otop_cbt_village, otop_verified, total_likes_received, followers_count, videos(count)";
    const readUser = async (columns: string) =>
      admin.from("users").select(columns).eq("id", userId).single();
    let userRow: any = null;
    let userErr: any = null;
    {
      const first = await readUser(`${USER_COLUMNS}, community_id`);
      userRow = first.data;
      userErr = first.error;
      if (userErr) {
        const retry = await readUser(USER_COLUMNS);
        userRow = retry.data;
        userErr = retry.error;
      }
    }

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

    // ชุมชนของ host — ถ้ายังไม่มีคอลัมน์ (migration ยังไม่รัน) จะเป็น null
    // → ไม่มีบริบทชุมชน แต่โหมด host ยังทำงานได้ตามปกติ
    communityId = (userRow as any).community_id ?? communityId;

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
            // Google place id — ใช้ดึงรายละเอียดที่ขาดโดยไม่ต้องค้นชื่อใหม่
            "place_id",
            // ชุมชนของสถานที่นี้ (D22) — คอลัมน์ของ add_place_matching.sql
            "community_id",
            // The four clip-derived facts — they need their migration.
            "capacity", "house_rules", "areas", "facilities",
            "users:owner_id (display_name, bio, avatar_url, total_likes_received, business_phone, business_address, business_subdistrict, business_district, business_province, otop_village_id, otop_village, otop_province, otop_nawatwithi, otop_verified, videos(count))",
          ];
          const withoutFacts = placeColumns.filter(
            (c) => !["capacity", "house_rules", "areas", "facilities"].includes(c)
          );
          const withoutCommunity = withoutFacts.filter((c) => c !== "community_id");
          const withoutPlaceId = withoutCommunity.filter((c) => c !== "place_id");
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
              .limit(50)).data as any[] | null) ??
            ((await admin
              .from("community_places")
              .select(withoutCommunity.join(", "))
              .limit(50)).data as any[] | null) ??
            ((await admin
              .from("community_places")
              .select(withoutPlaceId.join(", "))
              .limit(50)).data as any[] | null);

          if (places && places.length > 0) {
            // ชื่อสถานที่ในทะเบียนทั้งหมด (ไว้หาว่าผู้ใช้ถามถึงชื่อไหน)
            registryPlaceNames = places
              .map((p) => p.place_name)
              .filter((n): n is string => typeof n === "string" && n.length > 0);
            // Rank instead of take-the-first-hit. Querying "บ้านปายเปิดกี่โมง"
            // matches both "บ้านปาย" and "บ้านปายใหม่", and the old `.find()`
            // returned whichever row Postgres happened to order first. The
            // longer name is the more specific one the traveller wrote, so it
            // wins; rating only breaks a genuine tie.
            //
            // Matching is done by name similarity, not a raw substring: the
            // old `query.includes(place_name)` compared the raw text, so
            // "แม่ยายโฮมสเตย์" never matched the registry row
            // "แม่ยาย โฮมสเตย์" — the traveller had to type the name
            // character-for-character. `findNameMatches` ignores spacing and
            // tolerates typos, using the same threshold as the Google gate.
            let registryMatches = findNameMatches(
              lastUser.content ?? "",
              places,
              (p) => p.place_name
            );
            // ข้อความตามมาในแชทคลิปมักไม่พูดถึงชื่อสถานที่ ("ราคาเท่าไหร่")
            // → ถ้าไม่เจอในข้อความ ลองชื่อสถานที่ในคลิปแทน
            if (registryMatches.length === 0 && clipPlaceName) {
              registryMatches = findNameMatches(clipPlaceName, places, (p) => p.place_name);
            }
            const matched = registryMatches
              .sort((a, b) => {
                const lenDiff =
                  (b.item.place_name?.length ?? 0) - (a.item.place_name?.length ?? 0);
                if (lenDiff !== 0) return lenDiff;
                return (Number(b.item.rating) || 0) - (Number(a.item.rating) || 0);
              })[0]?.item;
            if (matched) {
              // Google place id ของแถวนี้ (ถ้ามี) → ใช้ดึงข้อมูลที่ขาดโดยไม่ต้องค้นชื่อใหม่
              registryPlaceId = matched.place_id ?? null;
              // owner_id is nullable (ON DELETE SET NULL), so a place whose
              // host deleted their account comes back with no embed at all.
              const host = Array.isArray(matched.users) ? matched.users[0] : matched.users;
              // สถานที่ที่เจอ = ชุมชนของมัน (ถ้าผูกไว้แล้ว) → ใช้เป็นบริบทชุมชน (D22)
              if (!communityId && matched.community_id) {
                communityId = String(matched.community_id);
              }
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

  // ── โฟลเดอร์ที่เลือกจากแอป (path ใหม่) ─────────────────────────────
  // ฝั่งแอปส่งรหัสโฟลเดอร์ → backend ไปอ่านคลิปจริงจาก DB + จับคู่ทะเบียนสถานที่
  // แล้วเรียบเรียงเป็นบล็อกข้อมูลเต็มเอง (หน้าโฟลเดอร์ / แชท / แพลนทริป ใช้ที่เดียวกัน)
  //
  // ถ้าโหลดไม่ได้ (ไม่มี token / ไม่มีสิทธิ์) → ถอยไปใช้ `folder` แบบเดิมที่ client ส่งมา
  // เพื่อไม่ให้แชทที่ใช้ได้อยู่แล้วพัง (แชทแบบไม่ล็อกอินยังทำงานได้)
  let resolvedFolder: FolderContext | undefined = folder;
  if (folderId) {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({
        error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
        code: "NOT_CONFIGURED",
        requestId: requestId(req),
      });
    }

    const token = /^Bearer\s+(.+)$/i
      .exec(req.header("authorization") ?? "")?.[1]
      ?.trim();

    let folderUid: string | null = null;
    if (token) {
      try {
        const { data: verified } = await admin.auth.getUser(token);
        folderUid = verified?.user?.id ?? null;
      } catch {
        folderUid = null;
      }
    }

    if (!folderUid) {
      if (!folder) {
        return res.status(401).json({
          error: "ต้องล็อกอินเพื่อใช้ข้อมูลโฟลเดอร์",
          code: "UNAUTHORIZED",
          requestId: requestId(req),
        });
      }
      console.warn("[ai-chat] ไม่มีโทเค็น — ใช้บริบทโฟลเดอร์จาก client แทน");
    } else {
      try {
        const ctx = await loadFolderContext(admin, folderId, folderUid);
        // เก็บสถานที่ในโฟลเดอร์ไว้ (มีข้อมูลที่สรุปไว้แล้ว + registryPlaceId)
        folderPlaces = ctx.places ?? [];
        resolvedFolder = {
          folderName: ctx.folderName,
          places: ctx.places.map((p) => p.name),
          detail: formatFolderContextBlock(ctx),
        };
      } catch (e: any) {
        const status = e instanceof FolderAccessError ? e.status : 500;
        const code = e instanceof FolderAccessError ? e.code : "READ_FAILED";
        const message =
          e instanceof FolderAccessError ? e.message : "โหลดข้อมูลโฟลเดอร์ไม่สำเร็จ";
        console.warn(`[ai-chat] โหลดโฟลเดอร์ ${folderId} ไม่ได้ (${code}) — ใช้บริบทจาก client แทน`);
        if (!folder) {
          return res.status(status).json({
            error: message,
            code,
            requestId: requestId(req),
          });
        }
      }
    }
  }

  // ── บริบทชุมชน (D22 + D23) ────────────────────────────────────────
  // ไฟล์นี้อ่าน "ทุกที่ในหมู่บ้าน" ของชุมชนนั้น + ชุมชนอื่นในจังหวัดเดียวกัน
  // มาแนบท้าย system prompt (ไม่แตะ tripPrompt.ts — PLAN §8)
  let communityBlock = "";
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      // tourist ที่ยังไม่รู้ชุมชน → หาจากชื่อที่พิมพ์ (ต้องมีจังหวัดในข้อความ
      // ไม่งั้นชุมชนชื่อซ้ำกันทั้งประเทศ → เดาแล้วผิด worse than ไม่ตอบ)
      //
      // ลำดับสำคัญ: **ชื่อที่พิมพ์มาชนะ** communityId ที่ client ส่งมา
      // เพราะ client ส่ง "ชุมชนของฉัน" เป็นค่าเริ่มต้น แต่ถ้าผู้ใช้ถาม
      // ชุมชนอื่นด้วยชื่อ + จังหวัด → ต้องตอบชุมชนนั้น ไม่ใช่ชุมชนของผู้ใช้
      if (mode === "tourist" && lastUser?.content) {
        const byName = await resolveCommunityByName(admin, lastUser.content);
        if (byName) communityId = byName.id;
      }
      if (communityId) {
        const bundle = await loadCommunityBundle(admin, communityId);
        const nearby = bundle.community?.province
          ? await loadNearbyCommunities(admin, bundle.community.province, communityId)
          : [];
        communityArea = {
          community: bundle.community?.name ?? null,
          province: bundle.community?.province ?? null,
          district: bundle.community?.district ?? null,
          subdistrict: bundle.community?.subdistrict ?? null,
        };
        communityBlock = formatCommunityContext(bundle, nearby, mode === "host-self" ? "host" : "tourist");
      }
    }
  } catch {
    // บริบทชุมชนเป็นส่วนเสริม — ล้มเหลวไม่ได้ทำให้แชทใช้ไม่ได้
  }

  // ── เติมข้อมูล "สถานที่เจาะจง" จาก Google Places ────────────────────
  // เป็นขั้นตอนเสริม: ล้มเหลวก็แชทเดินต่อได้เหมือนเดิมทุกประการ
  // ลำดับแหล่งข้อมูล: ที่ผู้ใช้เลือก → ทะเบียน → โฟลเดอร์ → ค้นชื่อใหม่
  let placeCandidates: PlaceChoice[] | undefined;
  /** หมายเหตุให้โมเดลตอบตรง ๆ เมื่อ "ค้นแล้วไม่เจอ" (แยนจาก "ยังไม่มีข้อมูล") */
  let placeLookupNote = "";
  /** ชื่อที่ backend ไปค้นจริง (ใช้ตัดสินว่าเป็น OTOP ไหม + ให้ Gemini ค้นต่อ) */
  let lookupQueriedName: string | null = null;
  if (mode === "tourist") {
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text = lastUser?.content ?? "";
      const detectedProvince = detectProvinceInText(text);
      const scope: LocationScope = {
        community: communityArea.community ?? null,
        province: communityArea.province ?? detectedProvince,
        district: communityArea.district ?? null,
        subdistrict: communityArea.subdistrict ?? null,
      };
      console.log(
        `[ai-chat] บริบทที่ใช้ · โหมด=${mode} · โฟลเดอร์=${folderId ? "มี" : "ไม่มี"} · ` +
          `ชุมชน=${communityArea.community ?? "-"} · จังหวัดจากชุมชน=${communityArea.province ?? "-"} · ` +
          `จังหวัดที่อ่านจากข้อความ=${detectedProvince ?? "-"} · จังหวัดที่ใช้=${scope.province ?? "-"} · ` +
          `placeId=${chosenPlaceId ?? "-"} · ข้อความ="${text.slice(0, 80)}"`
      );
      const lookup = await lookupPlace({
        text,
        base: resolvedPlace,
        basePlaceId: registryPlaceId,
        folderPlaces,
        registryNames: registryPlaceNames,
        placeId: chosenPlaceId,
        placeName: chosenPlaceName,
        // ชื่อสถานที่ของแชท (จากคลิป) → ใช้ต่อเมื่อข้อความไม่ได้พูดถึงที่ไหนเลย
        anchorPlaceName: clipPlaceName,
        scope,
      });
      if (lookup.context) resolvedPlace = lookup.context;
      if (lookup.candidates.length > 0) placeCandidates = lookup.candidates;
      lookupQueriedName = lookup.queriedName ?? null;
      // ค้นชื่อแล้วไม่เจอ → บอกโมเดลให้ตอบตรง ๆ ว่าไม่พบ
      // (เดิมโมเดลตอบกว้าง ๆ ว่า "ยังไม่มีข้อมูล" → แยกไม่ออกว่าไม่เคยค้นหรือค้นแล้วไม่เจอ)
      if (!lookup.context && lookup.queriedName && lookup.candidates.length === 0) {
        placeLookupNote =
          `\n\n[ข้อมูลสถานที่] ค้นชื่อ "${lookup.queriedName}" ในทะเบียนสถานที่และ Google Maps แล้วไม่พบ — ` +
          `ตอบผู้ใช้ตรง ๆ ว่าไม่พบสถานที่ชื่อนี้ และขอชื่อที่ตรงกว่านี้ หรือจังหวัด/อำเภอ เพื่อค้นต่อ`;
      }
      console.log(
        `[ai-chat] ผลลัพธ์สถานที่ · มีข้อมูล=${lookup.context ? "มี" : "ไม่มี"} · ` +
          `ที่มา=${lookup.source ?? "-"} · ผู้มีคัด=${lookup.candidates.length} · ` +
          `คำขอที่คิดเงิน=${lookup.billableCalls} · ผู้มีคัดในข้อความ=${placeCandidates?.length ?? 0}`
      );
    } catch (err: any) {
      console.warn("[ai-chat] เติมข้อมูลสถานที่จาก Google ไม่สำเร็จ:", err?.message);
    }
  } else {
    console.log("[ai-chat] ข้ามการค้นสถานที่ (โหมด host-self)");
  }

  // ── แท็กสถานที่ (OTOP / ท่องเที่ยวทั่วไป) + ค้นเว็บเพิ่ม ─────────────────
  /**
   * กฎของผู้ใช้: นำชื่อไปค้นว่าเป็นสถานที่ OTOP ไหมก่อบ
   * ถ้าใช่ก็ติดทะเบียน OTOP · ถ้าไม่ใช่ก็ท่องเที่ยวทั่วไป
   * → เช็คกับทะเบียนสถานที่ของระบบ (community_places) ก่อนเสมอ
   */
  const tagPlaceName =
    resolvedPlace?.placeName?.trim() ||
    lookupQueriedName?.trim() ||
    clipPlaceName?.trim() ||
    chosenPlaceName?.trim() ||
    resolvedHostSelf?.businessPlaceName?.trim() ||
    null;

  /**
   * ค้นเว็บจริง (Gemini + Google Search) — อุดช่องว่างที่เอไaiเดิมตอบไม่ได้
   * เช่น "มีที่พักใกล้ๆไหม" "อะไรน่าไปบ้าง" "วัดนี้อยู่ที่ไหน"
   */
  const lastUserText =
    [...messages].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";
  /** มีข้อมูลที่เชื่อถือได้จากระบบของเราแล้วหรือยัง (ทะเบียน/โฟลเดอร์/ชุมชน) */
  const hasInAppData =
    (!!resolvedPlace && resolvedPlace.source !== "google") ||
    !!resolvedFolder?.detail?.trim() ||
    (resolvedFolder?.places?.length ?? 0) > 0 ||
    !!communityBlock.trim();

  let searchBlock = "";
  let sources: TravelSource[] = [];
  let topicTags: TravelTopicTag[] = [];
  /** ชื่อสถานที่ที่ Gemini สรุปว่าเป็น "สถานที่หลัก" ของคำถาม (ถ้ามี) */
  let searchPlaceName: string | null = null;

  if (
    mode === "tourist" &&
    shouldSearchTravel({ question: lastUserText, hasInAppData })
  ) {
    try {
      const search = await searchTravelInfo({
        question: lastUserText,
        placeName: tagPlaceName,
        placeAddress: resolvedPlace?.address ?? null,
      });
      if (search) {
        searchBlock = buildSearchContextBlock({
          answer: search.answer,
          placeName: search.placeName,
          sources: search.sources,
        });
        sources = search.sources;
        topicTags = search.tags;
        searchPlaceName = search.placeName?.trim() || null;
        console.log(
          `[ai-chat] ค้นเว็บแล้ว · คำค้น="${lastUserText.slice(0, 80)}" · ` +
            `แหล่งที่มา=${sources.length} · แท็ก=${topicTags.join(",") || "-"}`
        );
      }
    } catch (err: any) {
      console.warn("[ai-chat] ค้นเว็บไม่สำเร็จ:", err?.message);
    }
  }

  // ไม่ได้ค้นเว็บ → เดาแท็กหมวดหมู่จากประเภทสถานที่ที่มีอยู่แล้ว (ข้อมูลจริง)
  if (topicTags.length === 0) {
    const tag = topicTagFromCategory(resolvedPlace?.category);
    if (tag) topicTags = [tag];
  }

  /**
   * กรองชื่อจังหวัด และคำทั่วไปออก ไม่ให้ติดแท็กสถานที่บนคำพวกนี้
   * เช่น ผู้ใช้ถาม "แนะนำที่เที่ยวน่าน" หรือตอบว่า "จุดเดิม / หอพัก" ห้ามเอาคำพวกนี้ไปติดแท็ก [OTOP]/[ท่องเที่ยวทั่วไป]
   */
  const IGNORED_TAG_WORDS = new Set([
    "จุดเดิม",
    "ที่เดิม",
    "หอพัก",
    "บ้าน",
    "จุดเริ่มต้น",
    "จุดสิ้นสุด",
    "ที่พัก",
    "โรงแรม",
    "สนามบิน",
    "สถานี",
    "ตัวเมือง",
    "ตำบล",
    "อำเภอ",
    "จังหวัด",
    "ประเทศไทย",
    "google maps",
    "google map",
  ]);

  const isIgnoredTagTarget = (name?: string | null): boolean => {
    if (!name) return true;
    const trimmed = name.trim();
    if (trimmed.length <= 2) return true;
    const lower = trimmed.toLowerCase();
    if (IGNORED_TAG_WORDS.has(lower)) return true;
    const detected = detectProvinceInText(trimmed);
    if (detected) {
      const clean = trimmed.replace(/^(จังหวัด|จ\.)\s*/, "").trim();
      if (clean === detected) return true;
    }
    return false;
  };

  /**
   * ชื่อสถานที่ที่จะติดแท็ก
   * (กรองออกหากตรงกับชื่อจังหวัดหรือคำทั่วไป)
   */
  const rawTargetName = searchPlaceName || tagPlaceName;
  const tagTargetName = isIgnoredTagTarget(rawTargetName) ? null : rawTargetName;

  /**
   * กฎของผู้ใช้: นำชื่อไปค้นว่าเป็นสถานที่ OTOP ไหมก่อน
   * ถ้าใช่ก็ติดทะเบียน OTOP · ถ้าไม่ใช่ก็ท่องเที่ยวทั่วไป
   * → เช็คกับทะเบียนสถานที่ของระบบ (community_places) ก่อนเสมอ
   */
  let placeTag: "otop" | "tourism" | undefined;
  if (tagTargetName) {
    placeTag = (await isRegisteredOtopPlace(tagTargetName)) ? "otop" : "tourism";
  }

  const system =
    buildChatSystemPrompt(resolvedFolder, resolvedPlace, resolvedHostSelf) +
    communityBlock +
    clipBlock +
    planBlock +
    searchBlock +
    buildTripDraftBlock(clientSlots) +
    // ถ้าค้นเว็บเจอข้อมูลแล้ว ห้ามบอกผู้ใช้ว่า "ไม่พบสถานที่" (สองบล็อกขัดกัน)
    (searchBlock ? "" : placeLookupNote);

  /**
   * ข้อมูลแท็กที่ส่งกลับฝั่งแอป
   * -------------------------------------------------------------
   * กฎของผู้ใช้: **แท็กเฉพาะตอนที่คำตอบเอ่ยชื่อสถานที่จริง และแยกตามแต่ละสถานที่ ไม่ใช่ติดที่จังหวัด**
   */
  const mentionsPlaceName = (text: string, name: string | null): boolean => {
    if (!name) return false;
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const target = norm(name);
    return !!target && norm(text).includes(target);
  };

  const buildReplyMeta = async (replyText: string): Promise<Record<string, unknown>> => {
    const meta: Record<string, unknown> = {};
    if (sources.length > 0) meta.sources = sources;

    // รวบรวมรายชื่อสถานที่ที่เป็นไปได้ทั้งหมดในบทสนทนานี้ เพื่อสแกนหาในคำตอบ
    const candidateNames = new Set<string>();
    if (tagTargetName && !isIgnoredTagTarget(tagTargetName)) candidateNames.add(tagTargetName);
    if (resolvedPlace?.placeName && !isIgnoredTagTarget(resolvedPlace.placeName)) candidateNames.add(resolvedPlace.placeName);
    if (clipPlaceName && !isIgnoredTagTarget(clipPlaceName)) candidateNames.add(clipPlaceName);
    if (chosenPlaceName && !isIgnoredTagTarget(chosenPlaceName)) candidateNames.add(chosenPlaceName);
    (resolvedFolder?.places ?? []).forEach((p) => {
      if (p && !isIgnoredTagTarget(p)) candidateNames.add(p);
    });
    (registryPlaceNames ?? []).slice(0, 30).forEach((p) => {
      if (p && !isIgnoredTagTarget(p)) candidateNames.add(p);
    });

    const placeTags: Array<{ name: string; placeTag: "otop" | "tourism"; tags?: string[] }> = [];
    for (const name of candidateNames) {
      if (mentionsPlaceName(replyText, name)) {
        const isOtop = await isRegisteredOtopPlace(name);
        placeTags.push({
          name,
          placeTag: isOtop ? "otop" : "tourism",
          tags: topicTags.length > 0 ? topicTags : undefined,
        });
      }
    }

    if (placeTags.length > 0) {
      meta.placeTags = placeTags;
      meta.placeTag = placeTags[0].placeTag;
      meta.tagPlace = placeTags[0].name;
      if (topicTags.length > 0) meta.tags = topicTags;
    } else if (placeTag && tagTargetName && mentionsPlaceName(replyText, tagTargetName)) {
      meta.placeTag = placeTag;
      if (topicTags.length > 0) meta.tags = topicTags;
      meta.tagPlace = tagTargetName;
    }

    return meta;
  };

  if (!isAiConfigured()) {
    // Graceful stub so the app works before the token is set.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return res.json({
      reply:
        "ยังไม่ได้ตั้งค่า AI บนเซิร์ฟเวอร์ (ANTHROPIC_AUTH_TOKEN) — นี่คือข้อความตัวอย่าง\n\n" +
        (resolvedFolder
          ? `ถ้าตั้งค่าแล้ว ผมจะช่วยวางแผนทริปจากคลิปในโฟลเดอร์ "${resolvedFolder.folderName}" ให้ครับ`
          : `คุณถามว่า: "${lastUser?.content ?? ""}"`),
    });
  }

  try {
    // ชื่อซ้ำหลายแห่ง → ให้ผู้ใช้เลือกก่อน (ยังไม่ต้องให้โมเดลตอบ)
    if (placeCandidates && placeCandidates.length > 0) {
      const stub =
        "เจอสถานที่ชื่อเหมือนกันหลายแห่ง — เลือกอันที่ถูกที่สุดได้เลยครับ";
      const replyMeta = await buildReplyMeta(stub);
      return res.json({
        reply: stub,
        placeCandidates,
        ...replyMeta,
      });
    }
    // งบ 4096: บล็อกข้อมูลโฟลเดอร์ยาวกว่าเดิม (รายชื่อ + ราคา + ที่อยู่ + คลิปย่อ)
    const reply = await callAi({ system, messages, maxTokens: 4096 });

    // ── สัญญาณแผนทริป ───────────────────────────────────────────────
    // โมเดลเขียนบรรทัด TRIP_DRAFT:{...} ต่อท้ายคำตอบเมื่อผู้ใช้กำลังวางแผนทริป
    // → ตัดบรรทัดนั้นออก (ผู้ใช้ไม่ต้องเห็นสัญญาณของระบบ) แล้ว merge กับสถานะที่แอปส่งมา
    //   → คำนวณ "ขาดอะไร" แบบ deterministic ในโค้ด (ไม่ให้โมเดลตัดสิน)
    // ถ้าโมเดลไม่เขียน TRIP_DRAFT → ไม่มี tripDraft → แอปไม่โชว์ปุ่มแผน
    const parsed = parseTripDraftLine(reply);
    let cleanReply = parsed.reply.trim() || "ได้ค่ะ อยากให้ช่วยเรื่องอะไรต่อคะ";

    let showFolderPicker = false;
    if (/SHOW_FOLDER_PICKER(?::\s*true)?/i.test(cleanReply)) {
      showFolderPicker = true;
      cleanReply = cleanReply.replace(/SHOW_FOLDER_PICKER(?::\s*true)?/gi, "").trim();
    }

    const replyMeta = await buildReplyMeta(cleanReply);
    if (showFolderPicker) {
      replyMeta.showFolderPicker = true;
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastUserAsk = (lastUser?.content ?? "").trim();

    // ตรวจสอบว่าผู้ใช้กำลังต้องการวางแผนทริป หรือมี slots อยู่แล้ว
    const isPlanningIntent =
      Boolean(parsed.slots) ||
      Boolean(clientSlots && Object.keys(clientSlots).length > 0) ||
      /(?:แพลน|วางแผน|จัดทริป|ทริป|เที่ยว|itinerary|plan)/i.test(lastUserAsk);

    if (isPlanningIntent) {
      let merged = mergeTripSlots(clientSlots, parsed.slots ?? {});

      // ถ้าผู้ใช้ระบุจำนวนวันแต่ slots ยังไม่มี ให้ดึงจากข้อความอัตโนมัติ
      if (!merged.days) {
        const dayMatch = lastUserAsk.match(/(\d+)\s*(?:วัน|days?)/i);
        if (dayMatch) {
          merged = { ...merged, days: parseInt(dayMatch[1], 10) };
        }
      }

      // ส่ง tripDraft กลับไปเสมอ เพื่อให้แอปเปิดการ์ด TripQuestionFlow ขึ้นมาให้ผู้ใช้กรอก/เลือกทันที
      return res.json({
        reply: cleanReply,
        tripDraft: buildTripDraftResult(merged),
        ...replyMeta,
      });
    }

    if (!parsed.slots) {
      return res.json({ reply: cleanReply, ...replyMeta });
    }

    const merged = mergeTripSlots(clientSlots, parsed.slots);
    return res.json({
      reply: cleanReply,
      tripDraft: buildTripDraftResult(merged),
      ...replyMeta,
    });
  } catch (err: any) {
    return sendError(res, err, req);
  }
});

export default router;
