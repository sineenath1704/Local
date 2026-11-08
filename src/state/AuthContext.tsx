import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { API_BASE_URL } from "../services/apiConfig";

/**
 * AuthContext — Supabase Google OAuth (via Expo deep linking).
 *
 * Flow (official Supabase + Expo pattern):
 *   1. signInWithGoogle() → signInWithOAuth({ provider: 'google', skipBrowserRedirect })
 *   2. open the returned URL in an in-app browser (WebBrowser.openAuthSessionAsync)
 *   3. Google redirects back to our app scheme → we parse tokens → setSession()
 *   4. session persists via AsyncStorage; onAuthStateChange keeps it fresh
 */

WebBrowser.maybeCompleteAuthSession(); // required for web

/**
 * ลบบัญชีถาวรเป็นงานหนัก (cascade ใน DB หลายสิบตาราง) → ต้องรอนานกว่า
 * API ปกติมาก แต่ iOS ตัดการเชื่อมต่อที่ราว 60 วินาที ("The request timed out.")
 * เซิร์ฟเวอร์จึงตอบกลับเร็วที่สุดเท่าที่ทำได้ (ลบแถวใน DB แล้วตอบเลย
 * ส่วนล้างไฟล์ใน Storage ทำต่อในเบื้องหลัง)
 */
const DELETE_TIMEOUT_MS = 120_000;

/**
 * หลัง request ถูกตัด (timeout/cancel) เซิร์ฟเวอร์อาจยังลบบัญชีเสร็จ
 * ในอีกไม่กี่วินาที → รอแล้วเช็คซ้ำก่อนบอกผู้ใช้ว่าลบไม่สำเร็จ
 */
const GONE_POLL_TIMEOUT_MS = 30_000;
const GONE_POLL_INTERVAL_MS = 2_000;

/**
 * Expo fetch (expo/src/winter/fetch) โยน FetchError เมื่อ request ถูกยกเลิกหรือ
 * หมดเวลา — message เป็น "fetch failed: fetch request has been canceled" (ยกเลิก)
 * หรือ "fetch failed: The request timed out." (iOS ตัดเองราว 60 วินาที)
 * และ `name` ยังเป็น "Error" (ไม่ใช่ "AbortError") → ต้องเช็คทั้ง name และข้อความ
 */
function isRequestCancelled(e: any): boolean {
  const msg = String(e?.message ?? "").toLowerCase();
  return (
    e?.name === "AbortError" ||
    msg.includes("has been canceled") ||
    msg.includes("aborted") ||
    msg.includes("canceled") ||
    msg.includes("timed out")
  );
}

/**
 * เช็คว่าเซิร์ฟเวอร์ตอบก่อนกดลบจริง
 * -------------------------------------------------------------
 * ถ้าเครื่องอยู่คนละเครือข่าย (เช่นสลับไปใช้เน็ตมือถือ) request จะค้าง
 * จน iOS ตัดการเชื่อมต่อเองที่ ~60 วินาที แล้วผู้ใช้เห็นแค่ "หมดเวลา"
 * โดยไม่รู้ว่าปัญหาคือคุยกับเซิร์ฟเวอร์ไม่ถึง → เช็ก /health ก่อน
 * (6 วินาที) แล้วบอกตรง ๆ ว่ายังเข้าไม่ถึง
 */
async function isBackendReachable(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * สัญญาณว่า "บัญชีไม่มีอยู่แล้ว" จากข้อความ error ของ Supabase Auth
 * -------------------------------------------------------------
 * - ลบผู้ใช้แล้ว → GET /user ตอบ 422 "User from sub claim in JWT does not exist"
 * - refresh token หายไปพร้อมแถว auth.users → "Refresh Token Not Found"
 * - error_code จาก API คือ user_not_found
 *
 * เจาะจงเฉพาะข้อความเหล่านี้ — ข้อความกว้าง ๆ แบบ "invalid jwt" หรือ
 * "not found" ใช้ไม่ได้ เพราะ token หมดอายุก็ให้ผลลัพธ์คล้ายกัน
 * (แต่บัญชียังอยู่) → ถ้าจับผิดจะทำให้ผู้ใช้โดนดีออกโดยไม่ได้ลบ
 */
function errorLooksLikeAccountGone(e: any): boolean {
  if (!e) return false;
  const msg = String(e?.message ?? "").toLowerCase();
  const code = String(e?.code ?? "").toLowerCase();
  const status = typeof e?.status === "number" ? e.status : undefined;
  if (status === 404) return true;
  if (code === "user_not_found" || code === "refresh_token_not_found") return true;
  return (
    msg.includes("does not exist") ||
    msg.includes("user from sub claim") ||
    msg.includes("user_not_found") ||
    msg.includes("refresh token not found") ||
    msg.includes("refresh_token_not_found")
  );
}

/**
 * บัญชีถูกลบไปแล้วหรือยัง — เช็คด้วย JWT ที่มีอยู่
 * (ใช้ getUser(token) แบบระบุ token เพราะตอนบัญชีหาย auth-js
 *  จะล้าง session ท้องถิ่นออก → getUser() แบบไม่ระบุ token จะได้
 *  "Auth session missing!" ซึ่งมองไม่ออกว่าบัญชีหายจริงหรือเปล่า)
 * true = หายไปแล้ว · false = ยังอยู่ (หรือเช็คไม่ได้ → ปลอดภัย)
 */
async function isAccountAlreadyGone(token?: string): Promise<boolean> {
  try {
    const { data, error } = token
      ? await supabase.auth.getUser(token)
      : await supabase.auth.getUser();
    if (!error && data?.user) return false;
    return errorLooksLikeAccountGone(error);
  } catch {
    return false;
  }
}

/**
 * รอจนกว่าบัญชีจะหายไปจริง (หรือหมดเวลารอ) — ใช้หลัง request ถูกตัด
 * เพราะเซิร์ฟเวอร์อาจกำลังลบแถวใน DB อยู่ ตอนที่แอปเลิกรอแล้ว
 * true = หายไปแล้ว (ถือว่าสำเร็จ) · false = ยังอยู่จริง
 */
async function waitUntilAccountGone(token?: string): Promise<boolean> {
  const deadline = Date.now() + GONE_POLL_TIMEOUT_MS;
  for (;;) {
    if (await isAccountAlreadyGone(token)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, GONE_POLL_INTERVAL_MS));
  }
}

// URL ที่ Google/Supabase จะ redirect กลับหลังล็อกอิน
// ใช้ custom scheme ที่ลงทะเบียนไว้ (app.json → "scheme": "locallocal")
// เพื่อให้ OS เปิดกลับเข้าแอปได้ → locallocal://auth-callback
//   • Dev build / standalone: ทำงาน 100%
//   • Expo Go: custom scheme เปิดไม่ได้ (ข้อจำกัดของ Expo Go) — ต้องใช้ dev build
// ต้อง whitelist ค่านี้ใน Supabase → Authentication → URL Configuration
export const redirectTo = makeRedirectUri({ scheme: "locallocal", path: "auth-callback" });

export interface AppUser {
  id: string;
  role: "tourist" | "host";
  display_name: string;
  username: string | null;
  bio: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  followers_count: number;
  following_count: number;
  total_likes_received: number;
  // OTOP community verification (host role)
  otop_verified?: boolean;
  otop_village_id?: string | null;
  otop_region?: string | null;
  otop_province?: string | null;
  otop_amphur?: string | null;
  otop_tambol?: string | null;
  otop_village?: string | null;
  otop_nawatwithi?: string | null;
  otop_for_tourism?: string | null;
  otop_cbt_village?: string | null;
  // Host business profile (Ground truth for posts)
  business_place_name?: string | null;
  /**
   * Google Place ID ของสถานที่ที่ host ลงทะเบียนไว้ — ตัวตนของสถานที่
   * ใช้เทียบกับ candidate จาก Google เพื่อบอกว่า "ตรงกับที่ลงทะเบียน"
   */
  business_place_id?: string | null;
  business_price_info?: string | null;
  business_opening_hours?: string | null;
  business_phone?: string | null;
  business_lat?: number | null;
  business_lng?: number | null;
  business_address?: string | null;
  business_subdistrict?: string | null;
  business_district?: string | null;
  business_province?: string | null;
  /**
   * ชุมชนที่ผู้ใช้สังกัด — host ใช้ชุมชนนี้เป็นขอบเขตตอนค้นสถานที่
   * (คอลัมน์นี้มากับ add_place_matching.sql — ถ้ายังไม่รัน migration
   * ค่าจะเป็น undefined และระบบทำงานแบบเดิมได้)
   */
  community_id?: string | null;
}

export interface OtopRegInfo {
  idNumber: string | null;
  region: string | null;
  province: string | null;
  amphur: string | null;
  tambol: string | null;
  village: string | null;
  otopNawatwithi: string | null;
  otopForTourism: string | null;
  cbtVillage: string | null;
  raw?: any;
}

/**
 * PostgREST บอกว่าคอลัมน์ไม่มีในตารางหรือเปล่า
 *
 * คอลัมน์ของขั้น 1.1 (`community_id`, `business_place_id`) มากับ
 * `add_place_matching.sql` — ถ้ายังไม่ได้รัน migration การอัปเดตแถวผู้ใช้
 * จะพังทั้งแถว ต้องตัดคอลัมน์นั้นออกแล้วลองใหม่ ไม่งั้นฟีเจอร์อื่นที่
 * ใช้งานได้อยู่แล้วจะพังตามไปด้วย
 */
function isMissingColumn(message: string | undefined, column: string): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes(column.toLowerCase()) && m.includes("does not exist");
}

export interface OnboardingInput {
  username: string;
  displayName: string;
  phone?: string;
  avatarUri?: string | null;
  /** "tourist" (default) or "host" (OTOP community). */
  role?: "tourist" | "host";
  /** Verified OTOP community info (only for host role). */
  otop?: OtopRegInfo | null;
  /** Host business info */
  businessPlaceName?: string;
  businessPriceInfo?: string;
  businessOpeningHours?: string;
  businessPhone?: string;
  businessLat?: number | null;
  businessLng?: number | null;
  businessAddress?: string | null;
  businessSubdistrict?: string | null;
  businessDistrict?: string | null;
  businessProvince?: string | null;
}

interface AuthState {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: AppUser | null;
  /** True when signed in but the profile hasn't been completed (no username). */
  needsOnboarding: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Check if a username is still free (true = available). */
  isUsernameAvailable: (username: string) => Promise<boolean>;
  /** Finish registration: upload avatar + fill the users row. */
  completeOnboarding: (input: OnboardingInput) => Promise<{ error: string | null }>;
  /** Update editable profile fields (name/bio/avatar) back to Supabase. */
  updateProfile: (patch: { displayName?: string; bio?: string; avatarUri?: string }) => Promise<{ error: string | null }>;
  /** Update host business profile */
  updateBusinessProfile: (patch: {
    businessPlaceName?: string;
    businessPriceInfo?: string;
    businessOpeningHours?: string;
    businessPhone?: string;
    businessLat?: number | null;
    businessLng?: number | null;
    businessAddress?: string | null;
    businessSubdistrict?: string | null;
    businessDistrict?: string | null;
    businessProvince?: string | null;
  }) => Promise<{ error: string | null }>;
  /**
   * D16 — เลื่อนบทบาทเป็น host หลังยืนยันเลขทะเบียน OTOP
   *
   * คนที่สมัครเป็นนักท่องเที่ยวแต่เป็นเจ้าของชุมชนจริง ต้องมีทางกลับมา
   * ไม่งั้นการยืนยันตัวตนครั้งแรก = การตัดทางออกจากระบบถาวร
   */
  claimHostRole: (input: {
    otop: OtopRegInfo;
    /** ชุมชนที่ host สังกัด (ถ้าหาเจอในทะเบียน) */
    communityId?: string | null;
  }) => Promise<{ error: string | null }>;
  /** Permanently delete the calling account and its data. */
  deleteAccount: () => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * log URL ที่กลับมาจาก OAuth แบบไม่เผย token (ปิดค่าไว้ก่อน)
 * ใช้ตอน debug เท่านั้น — ห้าม log access_token/refresh_token/code จริง
 * (error_code / error_description ไม่ใช่ความลับ → ให้เห็นได้ เพราะช่วยหาสาเหตุ)
 */
function redactUrl(url?: string | null): string {
  if (!url) return "(ไม่มี URL)";
  return url.replace(
    /(^|[?&#\s])((?:access_token|refresh_token|code_verifier|code)=)([^&\s#]+)/gi,
    "$1$2***"
  );
}

/**
 * ดึง query params ออกจาก URL ที่ OAuth ส่งกลับมา
 * -----------------------------------------------------------------
 * เดิมใช้ `QueryParams` ของ expo-auth-session แต่แพ็กเกจไม่ได้ export
 * path นั้นไว้ใน "exports" map → Metro ขึ้น warning ทุกครั้งที่ bundle
 * ("not listed in the exports") และ tsc ขึ้น TS2307 → เขียน parser เองสั้นๆ แทน
 *
 * รองรับทั้ง query string (?a=1) และ fragment (#a=1)
 * (โหมด implicit ของ Supabase วาง token ไว้ใน fragment)
 */
function parseAuthParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  const put = (chunk: string) => {
    for (const pair of chunk.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const rawKey = eq < 0 ? pair : pair.slice(0, eq);
      const rawVal = eq < 0 ? "" : pair.slice(eq + 1);
      const decode = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, " "));
        } catch {
          return s;
        }
      };
      params[decode(rawKey)] = decode(rawVal);
    }
  };

  // fragment ก่อน → แล้วค่อยให้ query string ทับ
  // (GoTrue ส่ง error มาทั้ง 2 ที่ แต่ฝั่ง query เข้ารหัสถูกต้องกว่า
  //  ฝั่ง fragment ถูกเข้ารหัสซ้ำ → ถ้าให้ fragment ทับ ข้อความจะเพี้ยน)
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = beforeHash.indexOf("?");
  if (hashAt >= 0) put(url.slice(hashAt + 1));
  if (queryAt >= 0) put(beforeHash.slice(queryAt + 1));

  return params;
}

/**
 * แปลง URL ที่ OAuth ส่งกลับมา → session
 * -------------------------------------------------------------
 * รองรับ 2 แบบ:
 *   • implicit — token อยู่ใน fragment (#access_token=...&refresh_token=...)
 *   • PKCE     — Supabase ส่ง ?code=... กลับมา (code_verifier เก็บไว้ใน
 *                storage ของ supabase-js แล้ว → เอาไปแลกเป็น session ได้)
 * ถ้า Supabase ส่ง error กลับมา (เช่น redirect_to ไม่ได้อยู่ใน whitelist)
 * → โยน error พร้อมข้อความจริง ไม่กลืนทิ้ง (เดิมกลืน → ผู้ใช้เห็นแค่หน้าเข้าสู่ระบบ)
 */
async function createSessionFromUrl(url: string): Promise<Session | null> {
  const params = parseAuthParams(url);

  const errCode = params.error_code || params.errorCode || params.error;
  if (errCode) {
    const desc = params.error_description;
    throw new Error(desc ? `${errCode}: ${desc}` : String(errCode));
  }

  // PKCE — ต้องแลก code เป็น session (ไม่ใช่อ่าน token จาก URL)
  const code = params.code;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session;
  }

  const access_token: string | undefined = params.access_token;
  const refresh_token: string | undefined = params.refresh_token;
  if (!access_token) return null;

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token: refresh_token ?? "",
  });
  if (error) throw error;
  return data.session;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUserRow = useCallback(async (userId: string) => {
    // maybeSingle() → no error when the row doesn't exist yet.
    const { data } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
    setUser((data as AppUser) ?? null);
  }, []);

  // Bootstrap session + subscribe to changes.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) loadUserRow(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadUserRow(newSession.user.id);
      } else {
        setUser(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadUserRow]);

  // Handle a cold-start / resumed deep link that carries the OAuth tokens.
  const incomingUrl = Linking.useLinkingURL();
  useEffect(() => {
    if (incomingUrl) {
      createSessionFromUrl(incomingUrl).catch(() => {
        /* not an auth link, ignore */
      });
    }
  }, [incomingUrl]);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) return { error: "ยังไม่ได้ตั้งค่า Supabase" };
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) return { error: error.message };
      if (!data?.url) return { error: "Supabase ไม่ได้ส่ง URL สำหรับเข้าสู่ระบบ" };

      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      // log แบบไม่เผย token — ต้องรู้ว่า redirect กลับมาจริงไหม/มีอะไรใน URL
      console.log("[auth] redirectTo =", redirectTo);
      console.log("[auth] เบราว์เซอร์ตอบ =", res.type, redactUrl((res as any).url));

      // On Expo Go / web the redirect scheme (exp:// or locallocal://) may not
      // be registered, so the browser returns type "cancel" even though the
      // token IS in the URL. Try to parse it regardless.
      const resultUrl =
        res.type === "success"
          ? res.url
          : (res as any).url ?? "";   // some versions put url on cancel too

      if (resultUrl) {
        const s = await createSessionFromUrl(resultUrl);
        if (s) return { error: null };
      }

      // บางครั้งเบราว์เซอร์ไม่คืน URL มา แต่ deep link กลับเข้าแอปตรงๆ ผ่าน Linking
      // (handler ฝั่งแอปจะตั้ง session ให้เอง) → รอสักครู่แล้วเช็คซ้ำก่อนสรุปว่าพัง
      for (let i = 0; i < 4; i++) {
        const { data: sess } = await supabase.auth.getSession();
        if (sess?.session) return { error: null };
        await new Promise((r) => setTimeout(r, 500));
      }

      // เบราว์เซอร์ไม่ได้ส่งกลับมาที่แอป (หรือส่งมาแต่ไม่มี token)
      // → สาเหตุที่พบบ่อยที่สุด: Redirect URL ของแอปไม่ได้อยู่ใน whitelist
      //   ของ Supabase → Authentication → URL Configuration
      return {
        error:
          "เข้าสู่ระบบไม่สำเร็จ — เบราว์เซอร์ไม่ได้ส่งกลับมาที่แอป\n\n" +
          `ผลจากเบราว์เซอร์: ${res.type}\n` +
          `redirect ที่แอปขอ: ${redirectTo}\n\n` +
          "ดูข้อความในหน้าเบราว์เซอร์แล้วแก้ตามข้อนี้:\n" +
          "• 'The OAuth client was not found' (401 invalid_client)\n" +
          "  → Supabase → Authentication → Providers → Google\n" +
          "    ใส่ Client ID + Client Secret ของ OAuth client ประเภท 'Web application'\n" +
          "    (client ของ iOS/Android ใช้กับ Supabase ไม่ได้)\n" +
          "• redirect ไม่ถูกต้อง\n" +
          "  → Supabase → Authentication → URL Configuration → Redirect URLs ต้องมี:\n" +
          "    • exp://**\n" +
          "    • locallocal://**\n\n" +
          "แล้วลองกดเข้าสู่ระบบอีกครั้ง",
      };
    } catch (e: any) {
      console.warn("[auth] เข้าสู่ระบบไม่สำเร็จ:", e?.message ?? e);
      const msg = String(e?.message ?? "");

      // GoTrue แลก authorization code กับ Google ไม่สำเร็จ
      // → จุดที่พังอยู่ฝั่งเซิร์ฟเวอร์ (ไม่ใช่เรื่อง redirect ของแอป)
      //   ข้อความ "Unable to exchange external code: xxxx" ที่ GoTrue ส่งมา
      //   ไม่บอกสาเหตุจริง — xxxx คือ 4 ตัวแรกของ authorization code
      //   (supabase/auth → internal/api/external_oauth.go)
      //   error จริงจาก Google ถูกซ่อนใน internal log → ต้อง probe ฝั่ง credential
      if (msg.includes("exchange external code")) {
        const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
        return {
          error:
            "เข้าสู่ระบบไม่สำเร็จ — Google ให้สิทธิ์แล้ว แต่ Supabase เอา code ไปแลก token ไม่ได้\n\n" +
            "สาเหตุที่เป็นไปได้ (ฝั่ง credential ใน Supabase → Authentication → Providers → Google):\n" +
            "• Client ID + Client Secret ไม่ตรงกัน (หรือ secret พิมพ์ผิด / มีช่องว่างท้าย / ว่าง)\n" +
            "• OAuth client ไม่ได้ลงทะเบียน redirect URI นี้ไว้\n" +
            `  (ต้องมี ${supabaseUrl}/auth/v1/callback)\n\n` +
            "แก้ที่ Google Cloud Console → Credentials → OAuth client ประเภท 'Web application' ตัวเดียวกัน",
        };
      }
      return { error: e?.message ?? "เข้าสู่ระบบด้วย Google ไม่สำเร็จ" };
    }
  }, []);

  const isUsernameAvailable = useCallback(async (username: string) => {
    const u = username.trim().toLowerCase();
    if (!u) return false;
    const { data } = await supabase
      .from("users")
      .select("id")
      .eq("username", u)
      .maybeSingle();
    // Available when no row, or the only row is me.
    return !data || data.id === session?.user?.id;
  }, [session]);

  const completeOnboarding = useCallback(
    async (input: OnboardingInput): Promise<{ error: string | null }> => {
      const uid = session?.user?.id;
      if (!uid) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

      const username = input.username.trim().toLowerCase();
      const displayName = input.displayName.trim();
      if (!username) return { error: "กรุณาตั้งชื่อผู้ใช้ (username)" };
      if (!displayName) return { error: "กรุณากรอกชื่อที่แสดง" };

      // D9 — host ต้องมีทะเบียน OTOP ที่ยืนยันแล้ว ถึงจะเป็น host ได้
      // ไม่งั้น "ชุมชน" ของเขาจะผูกกับหมู่บ้านไหนไม่ได้เลย
      // และการค้นหาสถานที่ในชุมชนจะไม่มีขอบเขตให้กรอง
      if (input.role === "host" && !input.otop?.idNumber?.trim()) {
        return { error: "ยังยืนยันตัวตนเป็น host ไม่ได้ — กรุณากรอกเลขทะเบียน OTOP ให้ครบก่อน" };
      }

      // Final uniqueness guard (race-safe-ish; the DB unique constraint is the real guard).
      if (!(await isUsernameAvailable(username))) {
        return { error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น" };
      }

      // Upload avatar (optional) to the `avatars` bucket.
      let avatarUrl: string | null = null;
      if (input.avatarUri) {
        try {
          const resp = await fetch(input.avatarUri);
          const arrayBuffer = await resp.arrayBuffer();
          const ext = input.avatarUri.split("?")[0].match(/\.(\w+)$/)?.[1]?.toLowerCase() || "jpg";
          const path = `${uid}/${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("avatars")
            .upload(path, arrayBuffer, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: true });
          if (!upErr) {
            avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
          }
        } catch {
          /* non-fatal: continue without avatar */
        }
      }

      const patch: Record<string, any> = {
        username,
        display_name: displayName,
        role: input.role === "host" ? "host" : "tourist",
      };
      if (input.phone?.trim()) patch.phone_number = input.phone.trim();
      if (avatarUrl) patch.avatar_url = avatarUrl;

      // OTOP community info (host role, verified via CDD API).
      if (input.role === "host" && input.otop) {
        const o = input.otop;
        patch.otop_verified = true;
        patch.otop_village_id = o.idNumber;
        patch.otop_region = o.region;
        patch.otop_province = o.province;
        patch.otop_amphur = o.amphur;
        patch.otop_tambol = o.tambol;
        patch.otop_village = o.village;
        patch.otop_nawatwithi = o.otopNawatwithi;
        patch.otop_for_tourism = o.otopForTourism;
        patch.otop_cbt_village = o.cbtVillage;
        patch.otop_raw = o.raw ?? null;

        // Host business profile
        if (input.businessPlaceName?.trim()) patch.business_place_name = input.businessPlaceName.trim();
        if (input.businessPriceInfo?.trim()) patch.business_price_info = input.businessPriceInfo.trim();
        if (input.businessOpeningHours?.trim()) patch.business_opening_hours = input.businessOpeningHours.trim();
        if (input.businessPhone?.trim()) patch.business_phone = input.businessPhone.trim();
        if (input.businessLat != null) patch.business_lat = input.businessLat;
        if (input.businessLng != null) patch.business_lng = input.businessLng;
        if (input.businessAddress?.trim()) patch.business_address = input.businessAddress.trim();
        if (input.businessSubdistrict?.trim()) patch.business_subdistrict = input.businessSubdistrict.trim();
        if (input.businessDistrict?.trim()) patch.business_district = input.businessDistrict.trim();
        if (input.businessProvince?.trim()) patch.business_province = input.businessProvince.trim();
      }

      // .select("id") → ให้ PostgREST ส่งแถวที่อัปเดตกลับมา
      // (default ของ update() คือ return=minimal → body ว่าง → ถ้าอัปเดตได้ 0 แถว
      //  ก็ไม่มี error → หน้าจอบอกว่าบันทึกสำเร็จทั้งที่ข้อมูลไม่ถูกบันทึกจริง)
      const { data, error } = await supabase.from("users").update(patch).eq("id", uid).select("id");
      if (error) {
        if (error.code === "23505") return { error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น" };
        return { error: error.message };
      }
      // ไม่มีแถว = ไม่มี users row ของผู้ใช้นี้ (หรือ RLS มองไม่เห็น)
      if (!data || data.length === 0) {
        return { error: "ไม่พบข้อมูลผู้ใช้ของคุณ — ลองออกจากระบบแล้วเข้าสู่ระบบใหม่ แล้วบันทึกอีกครั้ง" };
      }

      await loadUserRow(uid);
      return { error: null };
    },
    [session, isUsernameAvailable, loadUserRow]
  );

  const updateProfile = useCallback(
    async (patch: { displayName?: string; bio?: string; avatarUri?: string }): Promise<{ error: string | null }> => {
      const uid = session?.user?.id;
      if (!uid) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

      const row: Record<string, any> = {};
      if (patch.displayName !== undefined) row.display_name = patch.displayName.trim();
      if (patch.bio !== undefined) row.bio = patch.bio;

      // Upload a new avatar if a local uri was provided.
      if (patch.avatarUri && !patch.avatarUri.startsWith("http")) {
        try {
          const resp = await fetch(patch.avatarUri);
          const arrayBuffer = await resp.arrayBuffer();
          const ext = patch.avatarUri.split("?")[0].match(/\.(\w+)$/)?.[1]?.toLowerCase() || "jpg";
          const path = `${uid}/${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("avatars")
            .upload(path, arrayBuffer, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: true });
          if (!upErr) {
            row.avatar_url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
          }
        } catch {
          /* non-fatal */
        }
      }

      if (Object.keys(row).length === 0) return { error: null };

      const { error } = await supabase.from("users").update(row).eq("id", uid);
      if (error) return { error: error.message };
      await loadUserRow(uid);
      return { error: null };
    },
    [session, loadUserRow]
  );

  const updateBusinessProfile = useCallback(
    async (patch: {
      businessPlaceName?: string;
      businessPriceInfo?: string;
      businessOpeningHours?: string;
      businessPhone?: string;
      businessLat?: number | null;
      businessLng?: number | null;
      businessAddress?: string | null;
      businessSubdistrict?: string | null;
      businessDistrict?: string | null;
      businessProvince?: string | null;
    }): Promise<{ error: string | null }> => {
      const uid = session?.user?.id;
      if (!uid) return { error: "ยังไม่ได้เข้าสู่ระบบ" };

      const row: Record<string, any> = {};
      if (patch.businessPlaceName !== undefined) row.business_place_name = patch.businessPlaceName.trim();
      if (patch.businessPriceInfo !== undefined) row.business_price_info = patch.businessPriceInfo.trim();
      if (patch.businessOpeningHours !== undefined) row.business_opening_hours = patch.businessOpeningHours.trim();
      if (patch.businessPhone !== undefined) row.business_phone = patch.businessPhone.trim();
      if (patch.businessLat !== undefined) row.business_lat = patch.businessLat;
      if (patch.businessLng !== undefined) row.business_lng = patch.businessLng;
      if (patch.businessAddress !== undefined) row.business_address = patch.businessAddress?.trim() ?? null;
      if (patch.businessSubdistrict !== undefined) row.business_subdistrict = patch.businessSubdistrict?.trim() ?? null;
      if (patch.businessDistrict !== undefined) row.business_district = patch.businessDistrict?.trim() ?? null;
      if (patch.businessProvince !== undefined) row.business_province = patch.businessProvince?.trim() ?? null;

      if (Object.keys(row).length === 0) return { error: null };

      const { error } = await supabase.from("users").update(row).eq("id", uid);
      if (error) return { error: error.message };
      await loadUserRow(uid);
      return { error: null };
    },
    [session, loadUserRow]
  );

  /**
   * D16 — เลื่อนบทบาทเป็น host หลังยืนยันเลขทะเบียน OTOP
   *
   * เขียนทั้งบทบาทและข้อมูลทะเบียน OTOP ในครั้งเดียว เพื่อให้ host ที่ยืนยัน
   * ได้มีขอบเขตชุมชนให้ค้นหาสถานที่ต่อได้ทันที (D9)
   */
  const claimHostRole = useCallback(
    async (input: { otop: OtopRegInfo; communityId?: string | null }): Promise<{ error: string | null }> => {
      const uid = session?.user?.id;
      if (!uid) return { error: "ยังไม่ได้เข้าสู่ระบบ" };
      const o = input.otop;
      if (!o.idNumber?.trim()) {
        return { error: "กรุณากรอกเลขทะเบียน OTOP ให้ครบก่อน" };
      }

      const row: Record<string, any> = {
        role: "host",
        otop_verified: true,
        otop_village_id: o.idNumber,
        otop_region: o.region,
        otop_province: o.province,
        otop_amphur: o.amphur,
        otop_tambol: o.tambol,
        otop_village: o.village,
        otop_nawatwithi: o.otopNawatwithi,
        otop_for_tourism: o.otopForTourism,
        otop_cbt_village: o.cbtVillage,
        otop_raw: o.raw ?? null,
      };
      if (input.communityId) row.community_id = input.communityId;

      const { error } = await supabase.from("users").update(row).eq("id", uid);
      // คอลัมน์ community_id มากับ add_place_matching.sql — ถ้ายังไม่ได้รัน
      // migration การอัปเดตทั้งแถวจะพัง → ตัดคอลัมน์นั้นแล้วลองใหม่
      // (การเป็น host ต้องได้เสมอ แม้ยังผูกชุมชนไม่ได้)
      if (error && input.communityId && isMissingColumn(error.message, "community_id")) {
        const { community_id, ...rest } = row;
        const retry = await supabase.from("users").update(rest).eq("id", uid);
        if (retry.error) return { error: retry.error.message };
        await loadUserRow(uid);
        return { error: null };
      }
      if (error) return { error: error.message };
      await loadUserRow(uid);
      return { error: null };
    },
    [session, loadUserRow]
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (session?.user) await loadUserRow(session.user.id);
  }, [session, loadUserRow]);

  /**
   * Permanently delete the calling account. Backend cascade covers all
   * data tables; mobile session is signed out so the AuthGate flips
   * back to the login screen. Refreshes the session first so a
   * long-idle token (gap F in the validation review) doesn't fail
   * with an opaque 401 right at the destructive moment.
   */
  const deleteAccount = useCallback(async (): Promise<{ error: string | null }> => {
    // token ไว้นอก try เพื่อให้ catch ใช้เช็คว่าบัญชีหายจริงหรือยัง
    let token = session?.access_token ?? "";
    try {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        // ถ้าบัญชีถูกลบไปแล้ว refresh จะ fail → ถือว่าสำเร็จ (ลบซ้ำไม่ต้องทำ)
        if (errorLooksLikeAccountGone(refreshErr) || (await waitUntilAccountGone(token))) {
          await signOut();
          return { error: null };
        }
        return { error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง" };
      }
      token = refreshed?.session?.access_token ?? token;
      if (!token) {
        return { error: "ยังไม่ได้เข้าสู่ระบบ" };
      }

      // เช็คก่อนว่าเซิร์ฟเวอร์ตอบ — ถ้าเข้าไม่ถึง ให้บอกตรง ๆ พร้อม URL
      // แทนที่จะรอจน iOS ตัดการเชื่อมต่อ (~60 วินาที) แล้วขึ้นว่า "หมดเวลา"
      const reachable = await isBackendReachable(API_BASE_URL);
      if (!reachable) {
        console.warn(`[delete] เข้าไม่ถึงเซิร์ฟเวอร์ที่ ${API_BASE_URL}`);
        return {
          error: `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (${API_BASE_URL}) — เช็คว่า backend กำลังรันอยู่ และเครื่องอยู่ในเครือข่ายเดียวกัน แล้วลองอีกครั้ง`,
        };
      }

      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
      console.log(`[delete] ยิงไปที่ ${API_BASE_URL}/account/delete`);
      try {
        const res = await fetch(`${API_BASE_URL}/account/delete`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          signal: controller.signal,
        });
        console.log(
          `[delete] เซิร์ฟเวอร์ตอบ ${res.status} · ${Date.now() - startedAt}ms · requestId ${
            res.headers.get("x-request-id") ?? "-"
          }`
        );
        if (!res.ok) {
          if (res.status === 401) {
            // เซิร์ฟเวอร์ตอบ 401 เพราะ token ใช้ไม่ได้แล้ว — ถ้าบัญชีถูก
            // ลบไปแล้ว (รอบก่อนลบสำเร็จแต่ตอบไม่ทัน) ให้ถือว่าสำเร็จ
            if (await isAccountAlreadyGone(token)) {
              await signOut();
              return { error: null };
            }
            return { error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง" };
          }
          const body = await res.json().catch(() => ({} as any));
          return { error: body.error ?? "ลบบัญชีไม่สำเร็จ" };
        }
      } finally {
        clearTimeout(timer);
      }

      // Backend already wiped the row — signOut clears local state.
      await signOut();
      return { error: null };
    } catch (e: any) {
      if (isRequestCancelled(e)) {
        // ถูกตัดเพราะรอนานเกิน → เซิร์ฟเวอร์อาจลบเสร็จแล้วแต่ตอบไม่ทัน
        // รอแล้วเช็คว่าบัญชีหายจริงหรือยัง ก่อนบอกผู้ใช้ว่าลบไม่สำเร็จ
        if (await waitUntilAccountGone(token)) {
          await signOut();
          return { error: null };
        }
        return {
          error: `การลบบัญชีใช้เวลานานกว่าที่คาด หรือเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (${API_BASE_URL}) กรุณาลองอีกครั้ง`,
        };
      }
      return { error: e?.message ?? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์" };
    }
  }, [session, signOut]);

  // Signed in, but no username yet → must finish onboarding.
  const needsOnboarding = Boolean(session?.user && (!user || !user.username));

  const value = useMemo<AuthState>(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      session,
      user,
      needsOnboarding,
      signInWithGoogle,
      signOut,
      refreshUser,
      isUsernameAvailable,
      completeOnboarding,
      updateProfile,
      updateBusinessProfile,
      claimHostRole,
      deleteAccount,
    }),
    [loading, session, user, needsOnboarding, signInWithGoogle, signOut, refreshUser, isUsernameAvailable, completeOnboarding, updateProfile, updateBusinessProfile, claimHostRole, deleteAccount]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
