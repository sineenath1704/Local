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

interface AuthState {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: AppUser | null;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
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
    const { data } = await supabase.from("users").select("*").eq("id", userId).single();
    if (data) setUser(data as AppUser);
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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (session?.user) await loadUserRow(session.user.id);
  }, [session, loadUserRow]);

  const value = useMemo<AuthState>(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      session,
      user,
      signInWithGoogle,
      signOut,
      refreshUser,
    }),
    [loading, session, user, signInWithGoogle, signOut, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
