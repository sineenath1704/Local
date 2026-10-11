import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { Session } from "@supabase/supabase-js";
import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

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
// Expo Go: exp://<ip>:8081/... | dev/standalone build: locallocal://...
// ต้อง whitelist ค่านี้ใน Supabase → Authentication → URL Configuration
export const redirectTo = makeRedirectUri();

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
}

export interface OnboardingInput {
  username: string;
  displayName: string;
  phone?: string;
  avatarUri?: string | null;
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
}

const AuthContext = createContext<AuthState | null>(null);

/** Parse tokens from the OAuth redirect URL and create a Supabase session. */
async function createSessionFromUrl(url: string): Promise<Session | null> {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token) return null;

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
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
      if (res.type === "success") {
        await createSessionFromUrl(res.url);
        return { error: null };
      }
      // user closed the browser
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
      };
      if (input.phone?.trim()) patch.phone_number = input.phone.trim();
      if (avatarUrl) patch.avatar_url = avatarUrl;

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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (session?.user) await loadUserRow(session.user.id);
  }, [session, loadUserRow]);

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
    }),
    [loading, session, user, needsOnboarding, signInWithGoogle, signOut, refreshUser, isUsernameAvailable, completeOnboarding, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
