import { Router, Request, Response } from "express";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { sendError } from "../middleware/errors";

/**
 * POST /places/upsert-host-place
 * -------------------------------------------------------------
 * Single-transaction write for a host's business profile + their row in
 * `community_places` (the table the AI chat reads as ground truth).
 *
 * Why this goes through the backend at all: the app used to write both tables
 * itself with the anon key — two round-trips, the second fire-and-forget. A
 * rejected write left the profile looking saved while the AI had nothing to
 * read, and the host never found out. Here the JWT identifies the caller, and
 * one `host_save_business_profile` RPC (see
 * supabase/migrations/add_community_places_structured.sql) commits both rows
 * or neither, with the structured per-day hours / pricing attached.
 *
 * Body: {
 *   users?:  { businessPlaceName?, businessPhone?, ... },   // sparse patch
 *   place?:  { placeId, placeName, province, ..., businessHours?, businessPricing? }
 * }
 *
 * `place` is optional: a host who hasn't picked a location on the map yet
 * still saves their profile, exactly as before.
 */

const router = Router();

/** Map camelCase request fields onto the snake_case columns in the payload. */
const USER_FIELDS: Record<string, string> = {
  businessPlaceName: "business_place_name",
  businessPriceInfo: "business_price_info",
  businessOpeningHours: "business_opening_hours",
  businessPhone: "business_phone",
  businessLat: "business_lat",
  businessLng: "business_lng",
  businessAddress: "business_address",
  businessSubdistrict: "business_subdistrict",
  businessDistrict: "business_district",
  businessProvince: "business_province",
  // Google Place ID ของสถานที่ — id นี้คือกุญแจที่ผูก host กับสถานที่ของตัวเอง
  // (PLAN §5.5 · ขั้น 1.1 เพิ่มคอลัมน์ `users.business_place_id`)
  businessPlaceId: "business_place_id",
  // ชุมชนของ host — ย้ายความเป็นเจ้าของชุมชนมาจาก `communities.host_user_id`
  // (PLAN §1.1 ข้อ 2 · D1)
  communityId: "community_id",
};

const PLACE_FIELDS: Record<string, string> = {
  placeId: "place_id",
  placeName: "place_name",
  formattedAddress: "formatted_address",
  province: "province",
  district: "district",
  subdistrict: "subdistrict",
  village: "village",
  latitude: "latitude",
  longitude: "longitude",
  googleMapsUrl: "google_maps_url",
  phone: "phone",
  openingHours: "opening_hours",
  priceInfo: "price_info",
  rating: "rating",
  userRatingsTotal: "user_ratings_total",
  website: "website",
  source: "source",
  // ชุมชนที่สถานที่นี้อยู่ — เป็นแหล่งของชื่อ hierarchy (D18) และเป็นตัวตั้งของ
  // "สถานที่ใกล้ชุมชน" (PLAN §5.5 · ขั้น 1.1 เพิ่ม `community_places.community_id`)
  communityId: "community_id",
};

/**
 * ฟิลด์ของ `users` ที่มากับ add_place_matching.sql (ขั้น 1.1)
 *
 * ถ้ายังไม่ได้รัน migration → คอลัมน์ไม่มีในตาราง → RPC จะพังทั้งฟังก์ชัน
 * (ฟังก์ชันเขียนทั้งแถว `users` และทั้งแถว `community_places` ในทรานแซกชันเดียว)
 * → ต้องลองอีกครั้งโดยตัดฟิลด์ใหม่ออก ไม่งั้น host ที่เพิ่งแก้ข้อมูลร้าน
 * จะบันทึกไม่ได้เลยทั้งที่ระบบเดิมทำงานได้
 *
 * อีกกรณีคือ RPC ยังเป็นเวอร์ชันเก่า (ยังไม่รู้จักฟิลด์ใหม่) → จะตอบ
 * `unknown field business_place_id` → เจอข้อความนี้ต้องตัดฟิลด์นั้นออกแล้วลองใหม่
 */
const NEW_USER_FIELDS = ["business_place_id", "community_id"] as const;

/**
 * ชื่อฟิลด์ใหม่ที่ทำให้ RPC พัง — null = ไม่ใช่ปัญหาฟิลด์ใหม่ (พังจริง)
 */
function unsupportedNewField(message: string): string | null {
  const m = (message ?? "").toLowerCase();
  for (const key of NEW_USER_FIELDS) {
    if (m.includes(`unknown field ${key}`)) return key;
    if (m.includes("does not exist") && m.includes(key)) return key;
  }
  return null;
}

function pick(source: Record<string, unknown> | undefined, map: Record<string, string>) {
  const out: Record<string, unknown> = {};
  if (!source || typeof source !== "object") return out;
  for (const [key, column] of Object.entries(map)) {
    if (!(key in source)) continue;
    const value = (source as any)[key];
    // null/undefined would become SQL NULL and blank a column the host never
    // touched; "" clears a field on purpose, so it's kept.
    if (value === undefined) continue;
    out[column] = value;
  }
  return out;
}

/** Postgres messages the app shouldn't leak raw — they're our own guards. */
function humanizeRpcError(message: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("missing place_id")) return "ยังไม่ได้ระบุสถานที่บน Google Maps กรุณาเลือกสถานที่ก่อนบันทึก";
  if (m.includes("missing province")) return "ยังไม่ได้ระบุจังหวัดของสถานที่ กรุณาตรวจสอบข้อมูลอีกครั้ง";
  if (m.includes("missing place_name")) return "ยังไม่ได้กรอกชื่อสถานที่ประกอบการ";
  if (m.includes("missing user id")) return "ยังไม่ได้เข้าสู่ระบบ";
  if (m.includes("unknown field")) return "มีข้อมูลบางส่วนที่ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง";
  // ฟิลด์ใหม่ของ add_place_matching.sql ยังไม่ได้รัน → อธิบายให้ชัด
  if (
    (m.includes("does not exist") && (m.includes("community_id") || m.includes("business_place_id"))) ||
    m.includes("migration required")
  ) {
    return "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration add_place_matching.sql";
  }
  if (m.includes("host_save_business_profile") && m.includes("does not exist")) {
    return "ยังไม่ได้อัปเดตฐานข้อมูล — กรุณาแจ้งทีมงานให้รัน migration add_community_places_structured.sql";
  }
  return message;
}

router.post("/upsert-host-place", async (req: Request, res: Response) => {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
      code: "NOT_CONFIGURED",
      requestId: (req as any).requestId,
    });
  }

  // ---- JWT verify ---------------------------------------------------
  // Same call account/delete uses: reads the signature directly via the
  // project's JWT secret, so no anon-key import is needed here.
  const token = /^Bearer\s+(.+)$/i.exec(req.header("authorization") ?? "")?.[1]?.trim();
  if (!token) {
    return res.status(401).json({
      error: "ต้องส่ง Authorization: Bearer <token>",
      code: "UNAUTHORIZED",
      requestId: (req as any).requestId,
    });
  }

  let uid: string;
  try {
    const { data: verified, error: verifyErr } = await admin.auth.getUser(token);
    if (verifyErr || !verified?.user?.id) {
      return res.status(401).json({
        error: "โทเค็นไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
        code: "UNAUTHORIZED",
        requestId: (req as any).requestId,
      });
    }
    uid = verified.user.id;
  } catch (e: any) {
    return sendError(res, e, req, 401);
  }

  const body = req.body ?? {};
  const usersPayload = pick(body.users, USER_FIELDS);
  const placePayload = pick(body.place, PLACE_FIELDS);

  // Structured JSONB rides along with the place row, unflattened.
  if (body.place && typeof body.place === "object") {
    if (body.place.businessHours !== undefined) {
      placePayload.business_hours = body.place.businessHours;
    }
    if (body.place.businessPricing !== undefined) {
      placePayload.business_pricing = body.place.businessPricing;
    }
  }

  if (Object.keys(usersPayload).length === 0 && Object.keys(placePayload).length === 0) {
    return res.status(400).json({
      error: "ไม่มีข้อมูลให้บันทึก",
      code: "BAD_REQUEST",
      requestId: (req as any).requestId,
    });
  }

  try {
    const runRpc = async () => {
      const { error } = await admin.rpc("host_save_business_profile", {
        p_user_id: uid,
        p_users_payload: usersPayload,
        p_place_payload: Object.keys(placePayload).length > 0 ? placePayload : null,
      });
      return error;
    };

    let error = await runRpc();

    // ฟิลด์ใหม่ยังไม่มีใน DB/RPC → ตัดออกแล้วลองใหม่
    // (ระบบเดิมต้องยังบันทึกได้ แม้ migration ยังไม่ได้รัน)
    if (error) {
      const bad = unsupportedNewField(error.message);
      if (bad && bad in usersPayload) {
        delete usersPayload[bad];
        console.warn(`[hostPlace ${uid}] "${bad}" not supported yet — retrying without it`);
        error = await runRpc();
      }
    }

    if (error) {
      console.error(`[hostPlace ${uid}] rpc failed:`, error.message);
      return sendError(res, new Error(humanizeRpcError(error.message)), req, 400);
    }
    return res.json({ ok: true });
  } catch (e: any) {
    return sendError(res, e, req, 500);
  }
});

export default router;