import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import { supabase } from "../lib/supabase";
import type { StructuredHours, StructuredPricing } from "../lib/businessProfile";

/**
 * Writes a host's business profile and their `community_places` row through
 * the backend, in one transaction.
 *
 * The app used to do this itself with the anon key: `public.users` awaited,
 * `community_places` fire-and-forget with a `console.warn` on failure. A
 * rejected second write left the host looking saved while the AI — which only
 * ever reads `community_places` — had nothing to work with, and nobody was
 * told. Going through the backend means the two rows commit together and any
 * failure surfaces as a message the host actually sees.
 *
 * Auth comes from the live Supabase session, so a caller doesn't have to
 * thread a token through.
 */

export interface HostPlaceWrite {
  /** Sparse patch for `public.users.business_*`. Omitted keys aren't touched. */
  users?: {
    businessPlaceName?: string | null;
    businessPriceInfo?: string | null;
    businessOpeningHours?: string | null;
    businessPhone?: string | null;
    businessLat?: number | null;
    businessLng?: number | null;
    businessAddress?: string | null;
    businessSubdistrict?: string | null;
    businessDistrict?: string | null;
    businessProvince?: string | null;
    /**
     * Google Place ID ของสถานที่ที่ host เลือกบนแผนที่ — กุญแจที่ผูก
     * host กับสถานที่ของตัวเอง (PLAN §6.10) — ต้องเป็น id จริงเท่านั้น
     * ถ้ายังไม่มี migration คอลัมน์นี้ แอปยังทำงานได้ตามเดิม
     */
    businessPlaceId?: string | null;
    /** ชุมชนที่ host สังกัด (PLAN §1.1 ข้อ 2 · D1) */
    communityId?: string | null;
  };
  /** Omit when the host hasn't picked a location on the map yet. */
  place?: {
    placeId: string;
    placeName: string;
    /** Required by the DB (NOT NULL). */
    province: string;
    formattedAddress?: string | null;
    district?: string | null;
    subdistrict?: string | null;
    village?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    googleMapsUrl?: string | null;
    phone?: string | null;
    openingHours?: string | null;
    priceInfo?: string | null;
    rating?: number | null;
    userRatingsTotal?: number | null;
    website?: string | null;
    /** Machine-readable hours/pricing — what the AI reads. */
    businessHours?: StructuredHours | null;
    businessPricing?: StructuredPricing | null;
    /** ชุมชนที่สถานที่นี้อยู่ (D4) */
    communityId?: string | null;
  };
}

export class HostPlaceError extends Error {}

export async function upsertMyPlace(write: HostPlaceWrite): Promise<void> {
  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sess?.session?.access_token) {
    throw new HostPlaceError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
  }

  const controller = new AbortController();
  // Two row-writes plus a JWT verification — give it longer than a plain GET.
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 2);
  try {
    const res = await fetch(`${API_BASE_URL}/places/upsert-host-place`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sess.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(write),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      if (res.status === 401) {
        throw new HostPlaceError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
      }
      throw new HostPlaceError(body?.error ?? "บันทึกข้อมูลสถานที่ประกอบการไม่สำเร็จ");
    }
  } catch (e: any) {
    if (e instanceof HostPlaceError) throw e;
    if (e?.name === "AbortError") {
      throw new HostPlaceError("เซิร์ฟเวอร์ตอบช้า กรุณาลองอีกครั้ง");
    }
    throw new HostPlaceError(e?.message ?? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A stable id for a host's listing when Google gave us no place_id.
 *
 * Must NOT contain a timestamp: `onConflict(place_id)` would then insert a
 * fresh row on every save, leaving the AI to pick between a current listing
 * and a stale duplicate. Keyed to the user instead, so the same host always
 * updates the same row.
 */
export function syntheticPlaceId(userId: string): string {
  return `host-${userId}`;
}

/** Google Maps deep link, or a coordinate query when the place has no URI. */
export function mapsUrlFor(
  googleMapsUri: string | null | undefined,
  latitude: number | null | undefined,
  longitude: number | null | undefined
): string | null {
  if (googleMapsUri) return googleMapsUri;
  if (latitude != null && longitude != null) {
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }
  return null;
}