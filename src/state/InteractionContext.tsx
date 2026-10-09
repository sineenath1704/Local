import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

/**
 * InteractionContext — single source of truth for ACTION-DRIVEN state.
 * -------------------------------------------------------------
 * Everything here reflects real user taps (no mock counts):
 *   • follows        → which profile ids the user follows
 *   • likes          → which video ids the user liked
 *   • saves/folders  → saved videos organized into folders (for AI trip planning)
 *   • chatShares     → videos shared into a friend's chat
 *
 * Screens derive their numbers from this (e.g. ProfileLocal "กำลังติดตาม"
 * = number of follows; the "liked" tab = liked video ids).
 */

export interface SaveFolder {
  id: string;
  name: string;
  videoIds: string[];
}

export interface ChatShare {
  id: string;
  friendId: string;
  videoId: string;
  at: number;
}

interface InteractionState {
  // ---- raw action state ----
  followedProfileIds: string[];
  likedVideoIds: string[];
  savedVideoIds: string[];
  folders: SaveFolder[];
  chatShares: ChatShare[];

  // ---- queries ----
  isFollowing: (profileId: string) => boolean;
  isLiked: (videoId: string) => boolean;
  isSaved: (videoId: string) => boolean;

  // ---- mutations ----
  toggleFollow: (profileId: string) => void;
  toggleLike: (videoId: string) => void;
  /** Save a video (optionally into a folder). Returns nothing; idempotent. */
  saveVideo: (videoId: string, folderId?: string) => void;
  unsaveVideo: (videoId: string) => void;
  createFolder: (name: string) => string; // returns new folder id
  shareToChat: (friendId: string, videoId: string) => void;

  // ---- derived counts ----
  followingCount: number;
  likedCount: number;
  savedCount: number;
}

const InteractionContext = createContext<InteractionState | null>(null);

export function InteractionProvider({ children }: { children: React.ReactNode }) {
  const [followedProfileIds, setFollowed] = useState<string[]>([]);
  const [likedVideoIds, setLiked] = useState<string[]>([]);
  const [savedVideoIds, setSaved] = useState<string[]>([]);
  const [folders, setFolders] = useState<SaveFolder[]>([]);
  const [chatShares, setChatShares] = useState<ChatShare[]>([]);

  const isFollowing = useCallback(
    (id: string) => followedProfileIds.includes(id),
    [followedProfileIds]
  );
  const isLiked = useCallback((id: string) => likedVideoIds.includes(id), [likedVideoIds]);
  const isSaved = useCallback((id: string) => savedVideoIds.includes(id), [savedVideoIds]);

  const toggleFollow = useCallback((profileId: string) => {
    setFollowed((prev) =>
      prev.includes(profileId) ? prev.filter((x) => x !== profileId) : [...prev, profileId]
    );
  }, []);

  const toggleLike = useCallback((videoId: string) => {
    setLiked((prev) =>
      prev.includes(videoId) ? prev.filter((x) => x !== videoId) : [...prev, videoId]
    );
  }, []);

  const saveVideo = useCallback((videoId: string, folderId?: string) => {
    setSaved((prev) => (prev.includes(videoId) ? prev : [...prev, videoId]));
    if (folderId) {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId && !f.videoIds.includes(videoId)
            ? { ...f, videoIds: [...f.videoIds, videoId] }
            : f
        )
      );
    }
  }, []);

  const unsaveVideo = useCallback((videoId: string) => {
    setSaved((prev) => prev.filter((x) => x !== videoId));
    setFolders((prev) =>
      prev.map((f) => ({ ...f, videoIds: f.videoIds.filter((v) => v !== videoId) }))
    );
  }, []);

  const createFolder = useCallback((name: string) => {
    const id = `folder-${Date.now()}`;
    setFolders((prev) => [...prev, { id, name: name.trim() || "โฟลเดอร์ใหม่", videoIds: [] }]);
    return id;
  }, []);

  const shareToChat = useCallback((friendId: string, videoId: string) => {
    setChatShares((prev) => [
      ...prev,
      { id: `share-${Date.now()}-${friendId}`, friendId, videoId, at: Date.now() },
    ]);
  }, []);

  const value = useMemo<InteractionState>(
    () => ({
      followedProfileIds,
      likedVideoIds,
      savedVideoIds,
      folders,
      chatShares,
      isFollowing,
      isLiked,
      isSaved,
      toggleFollow,
      toggleLike,
      saveVideo,
      unsaveVideo,
      createFolder,
      shareToChat,
      followingCount: followedProfileIds.length,
      likedCount: likedVideoIds.length,
      savedCount: savedVideoIds.length,
    }),
    [
      followedProfileIds,
      likedVideoIds,
      savedVideoIds,
      folders,
      chatShares,
      isFollowing,
      isLiked,
      isSaved,
      toggleFollow,
      toggleLike,
      saveVideo,
      unsaveVideo,
      createFolder,
      shareToChat,
    ]
  );

  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>;
}

export function useInteractions(): InteractionState {
  const ctx = useContext(InteractionContext);
  if (!ctx) {
    throw new Error("useInteractions must be used within an InteractionProvider");
  }
  return ctx;
}
