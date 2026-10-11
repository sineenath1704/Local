import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { PROFILE_LOCAL_SEED, MyVideo, RegisteredCommunityInfo } from "../data/profileLocalData";
import { useAuth } from "./AuthContext";

/**
 * MyProfileContext — the current user's EDITABLE profile + owned videos.
 * -------------------------------------------------------------
 * Editable: name, bio, avatar (uri from image picker), owned-video captions,
 * and deleting owned videos.
 * Read-only: username, registration info (comes from OTOP registration).
 */
interface MyProfileState {
  location: string;
  name: string;
  username: string; // read-only
  bio: string;
  /** Either a bundled asset (number) or { uri } when the user picked a photo. */
  avatar: any;
  registeredInfo: RegisteredCommunityInfo; // read-only
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
  const [bio, setBio] = useState(PROFILE_LOCAL_SEED.bio);
  const [avatar, setAvatar] = useState<any>(PROFILE_LOCAL_SEED.avatar);
  const [username, setUsername] = useState(PROFILE_LOCAL_SEED.username);
  const [ownedVideos, setOwnedVideos] = useState<MyVideo[]>([]);

  // Sync profile fields from the real user row whenever it loads/changes.
  useEffect(() => {
    if (!user) return;
    if (user.display_name) setName(user.display_name);
    if (user.username) setUsername(user.username);
    if (user.bio) setBio(user.bio);
    if (user.avatar_url) setAvatar({ uri: user.avatar_url });
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

  const value = useMemo<MyProfileState>(
    () => ({
      location: PROFILE_LOCAL_SEED.location,
      name,
      username,
      bio,
      avatar,
      registeredInfo: PROFILE_LOCAL_SEED.registeredInfo,
      ownedVideos,
      updateName,
      updateBio,
      updateAvatarUri,
      updateVideoCaption,
      deleteVideo,
    }),
    [name, username, bio, avatar, ownedVideos, updateName, updateBio, updateAvatarUri, updateVideoCaption, deleteVideo]
  );

  return <MyProfileContext.Provider value={value}>{children}</MyProfileContext.Provider>;
}

export function useMyProfile(): MyProfileState {
  const ctx = useContext(MyProfileContext);
  if (!ctx) throw new Error("useMyProfile must be used within a MyProfileProvider");
  return ctx;
}
