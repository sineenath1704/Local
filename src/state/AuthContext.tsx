import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { Session } from "@supabase/supabase-js";
import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { API_BASE_URL, API_TIMEOUT_MS } from "../services/apiConfig";

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
  business_price_info?: string | null;
  business_opening_hours?: string | null;
  business_phone?: string | null;
  business_lat?: number | null;
  business_lng?: number | null;
  business_address?: string | null;
  business_subdistrict?: string | null;
  business_district?: string | null;
  business_province?: string | null;
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
  /** Permanently delete the calling account and its data. */
  deleteAccount: () => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Parse tokens from the OAuth redirect URL and create a Supabase session. */
async function createSessionFromUrl(url: string): Promise<Session | null> {
  // Supabase/Google return the tokens in the URL fragment (#access_token=...),
  // but can also use query (?access_token=...). Read both.
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  let access_token: string | undefined = params.access_token;
  let refresh_token: string | undefined = params.refresh_token;

  // Fallback: parse the hash fragment manually when tokens aren't in the query.
  if (!access_token && url.includes("#")) {
    const hash = url.slice(url.indexOf("#") + 1);
    const hp = new URLSearchParams(hash);
    access_token = hp.get("access_token") ?? undefined;
    refresh_token = hp.get("refresh_token") ?? undefined;
  }

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

      const res = await WebBrowser.openAuthSessionAsync(data?.url ?? "", redirectTo);

      // On Expo Go / web the redirect scheme (exp:// or locallocal://) may not
      // be registered, so the browser returns type "cancel" even though the
      // token IS in the URL. Try to parse it regardless.
      const resultUrl =
        res.type === "success"
          ? res.url
          : (res as any).url ?? "";   // some versions put url on cancel too

      if (resultUrl && (resultUrl.includes("access_token") || resultUrl.includes("#"))) {
        await createSessionFromUrl(resultUrl);
        return { error: null };
      }

      if (res.type === "success") {
        return { error: null };
      }

      // Last resort: on web Supabase may have stored the session in localStorage
      // during the redirect even if we couldn't parse the URL. Poll once.
      const { data: sess } = await supabase.auth.getSession();
      if (sess?.session) return { error: null };

      return { error: null };
    } catch (e: any) {
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

      const { error } = await supabase.from("users").update(patch).eq("id", uid);
      if (error) {
        if (error.code === "23505") return { error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น" };
        return { error: error.message };
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
    try {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        return { error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง" };
      }
      const token = refreshed?.session?.access_token ?? session?.access_token;
      if (!token) {
        return { error: "ยังไม่ได้เข้าสู่ระบบ" };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
      try {
        const res = await fetch(`${API_BASE_URL}/account/delete`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 401) {
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
      if (e?.name === "AbortError") {
        return { error: "เซิร์ฟเวอร์ตอบช้า กรุณาลองอีกครั้ง" };
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
      deleteAccount,
    }),
    [loading, session, user, needsOnboarding, signInWithGoogle, signOut, refreshUser, isUsernameAvailable, completeOnboarding, updateProfile, updateBusinessProfile, deleteAccount]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
