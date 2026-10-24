import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { PROFILE_LOCAL_SEED, MyVideo } from "../data/profileLocalData";
import { useAuth } from "./AuthContext";

/**
 * MyProfileContext — the current user's EDITABLE profile + owned videos.
 * -------------------------------------------------------------
 * Editable: name, bio, avatar (uri from image picker), owned-video captions,
 * and deleting owned videos.
 * Read-only: username (comes from OTOP registration).
 */
interface MyProfileState {
  location: string;
  name: string;
  username: string; // read-only
  bio: string;
  /** Either a bundled asset (number) or { uri } when the user picked a photo. */
  avatar: any;
  ownedVideos: MyVideo[];

  updateName: (name: string) => void;
  updateBio: (bio: string) => void;
  updateAvatarUri: (uri: string) => void;
  updateVideoCaption: (videoId: string, caption: string) => void;
  deleteVideo: (videoId: string) => void;
}

const MyProfileContext = createContext<MyProfileState | null>(null);

export function MyProfileProvider({ children }: { children: React.ReactNode }) {
  // Pull the real signed-in user (name/username/avatar/bio) from Supabase.
  const { user } = useAuth();

  const [name, setName] = useState(PROFILE_LOCAL_SEED.name);
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<any>(null);
  const [username, setUsername] = useState(PROFILE_LOCAL_SEED.username);
  const [ownedVideos, setOwnedVideos] = useState<MyVideo[]>([]);

  // Sync profile fields from the real user row whenever it loads/changes.
  // bio + avatar are written unconditionally so a NULL/cleared real value can
  // overwrite the prior state — the earlier `if (user.bio)` guard meant a
  // newly-registered account kept showing the bundled mock forever.
  useEffect(() => {
    if (!user) return;
    if (user.display_name) setName(user.display_name);
    if (user.username) setUsername(user.username);
    setBio(user.bio ?? "");
    setAvatar(user.avatar_url ? { uri: user.avatar_url } : null);
  }, [user]);

  const updateName = useCallback((v: string) => setName(v), []);
  const updateBio = useCallback((v: string) => setBio(v), []);
  const updateAvatarUri = useCallback((uri: string) => setAvatar({ uri }), []);

  const updateVideoCaption = useCallback((videoId: string, caption: string) => {
    setOwnedVideos((prev) => prev.map((v) => (v.id === videoId ? { ...v, caption } : v)));
  }, []);

  const deleteVideo = useCallback((videoId: string) => {
    setOwnedVideos((prev) => prev.filter((v) => v.id !== videoId));
  }, []);

  // Derived from the real user row — OTOP data is authoritative for hosts,
  // business_* is the fallback for any host whose place has no village yet.
  const location = useMemo(() => {
    if (!user) return "";
    const otop = [
      user.otop_village,
      user.otop_tambol && `ต.${user.otop_tambol}`,
      user.otop_amphur && `อ.${user.otop_amphur}`,
      user.otop_province && `จ.${user.otop_province}`,
    ].filter(Boolean);
    if (otop.length > 0) return otop.join(" • ");
    return [user.business_subdistrict, user.business_district, user.business_province]
      .filter(Boolean)
      .join(" • ");
  }, [user]);

  const value = useMemo<MyProfileState>(
    () => ({
      location,
      name,
      username,
      bio,
      avatar,
      ownedVideos,
      updateName,
      updateBio,
      updateAvatarUri,
      updateVideoCaption,
      deleteVideo,
    }),
    [location, name, username, bio, avatar, ownedVideos, updateName, updateBio, updateAvatarUri, updateVideoCaption, deleteVideo]
  );

  return <MyProfileContext.Provider value={value}>{children}</MyProfileContext.Provider>;
}

export function useMyProfile(): MyProfileState {
  const ctx = useContext(MyProfileContext);
  if (!ctx) throw new Error("useMyProfile must be used within a MyProfileProvider");
  return ctx;
}
