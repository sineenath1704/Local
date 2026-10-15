import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useAuth } from "./AuthContext";
import {
  loadMyInteractions,
  likeVideo,
  unlikeVideo,
  saveVideoRow,
  unsaveVideoRow,
} from "../services/interactionService";
import {
  getMyFolders,
  createFolder as dbCreateFolder,
  deleteFolder as dbDeleteFolder,
  renameFolder as dbRenameFolder,
  addClipToFolder as dbAddClipToFolder,
  removeClipFromFolder as dbRemoveClipFromFolder,
  getClipsInFolder,
  getFloatingClips,
  Folder,
} from "../services/folderService";

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
 *
 * **Folders & folder items are persisted in Supabase** via folderService.
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
  createFolder: (name: string) => string; // returns new folder id (optimistic)
  deleteFolder: (folderId: string) => void;
  renameFolder: (folderId: string, newName: string) => void;
  shareToChat: (friendId: string, videoId: string) => void;
  /** Reload folders from DB (call after external changes) */
  reloadFolders: () => void;

  // ---- derived counts ----
  followingCount: number;
  likedCount: number;
  savedCount: number;
}

const InteractionContext = createContext<InteractionState | null>(null);

export function InteractionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [followedProfileIds, setFollowed] = useState<string[]>([]);
  const [likedVideoIds, setLiked] = useState<string[]>([]);
  const [savedVideoIds, setSaved] = useState<string[]>([]);
  const [folders, setFolders] = useState<SaveFolder[]>([]);
  const [chatShares, setChatShares] = useState<ChatShare[]>([]);

  // ──────────────────────────────────────────────
  //  Load likes + saves + folders from Supabase
  // ──────────────────────────────────────────────
  const loadFoldersFromDb = useCallback(async () => {
    try {
      const dbFolders = await getMyFolders();
      // For each folder, load its clip list
      const enriched: SaveFolder[] = await Promise.all(
        dbFolders.map(async (f: Folder) => {
          const items = await getClipsInFolder(f.id);
          return {
            id: f.id,
            name: f.name,
            videoIds: items.map((i) => i.video_id),
          };
        })
      );
      setFolders(enriched);
    } catch (err) {
      console.warn("[interaction] loadFoldersFromDb error:", err);
    }
  }, []);

  useEffect(() => {
    console.log("[interaction] effect user =", user?.id ?? "null");
    if (!user) {
      setLiked([]);
      setSaved([]);
      setFolders([]);
      return;
    }
    let active = true;

    // Load likes + saves
    loadMyInteractions().then(({ likedIds, savedIds }) => {
      if (!active) return;
      console.log("[interaction] loaded likes =", likedIds.length, "saves =", savedIds.length);
      setLiked(likedIds);
      setSaved(savedIds);
    });

    // Load folders from DB
    loadFoldersFromDb();

    return () => {
      active = false;
    };
  }, [user, loadFoldersFromDb]);

  // ──────────────────────────────────────────────
  //  Queries
  // ──────────────────────────────────────────────
  const isFollowing = useCallback(
    (id: string) => followedProfileIds.includes(id),
    [followedProfileIds]
  );
  const isLiked = useCallback((id: string) => likedVideoIds.includes(id), [likedVideoIds]);
  const isSaved = useCallback((id: string) => savedVideoIds.includes(id), [savedVideoIds]);

  // ──────────────────────────────────────────────
  //  Mutations
  // ──────────────────────────────────────────────
  const toggleFollow = useCallback((profileId: string) => {
    setFollowed((prev) =>
      prev.includes(profileId) ? prev.filter((x) => x !== profileId) : [...prev, profileId]
    );
  }, []);

  const toggleLike = useCallback((videoId: string) => {
    // Optimistic update + persist to Supabase.
    setLiked((prev) => {
      const has = prev.includes(videoId);
      if (has) void unlikeVideo(videoId);
      else void likeVideo(videoId);
      return has ? prev.filter((x) => x !== videoId) : [...prev, videoId];
    });
  }, []);

  // Track in-flight folder creations to handle chaining (e.g. createFolder then immediately saveVideo)
  const pendingCreationsRef = useRef<Map<string, Promise<Folder>>>(new Map());

  const saveVideo = useCallback((videoId: string, folderId?: string) => {
    // 1. Persist to video_saves (floating save)
    setSaved((prev) => {
      if (!prev.includes(videoId)) {
        console.log("[save] saveVideoRow", videoId);
        saveVideoRow(videoId).then(() => {
          console.log("[save] saveVideoRow OK", videoId);
        }).catch((e) => {
          console.warn("[save] saveVideoRow FAIL", videoId, e?.message);
          Alert.alert("บันทึกคลิปไม่สำเร็จ", e?.message ?? String(e));
        });
      }
      return prev.includes(videoId) ? prev : [...prev, videoId];
    });

    // 2. If a folder is specified, also add to folder_items in DB
    if (folderId) {
      // Optimistic local update
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId && !f.videoIds.includes(videoId)
            ? { ...f, videoIds: [...f.videoIds, videoId] }
            : f
        )
      );

      // Check if this folderId is currently being created (in-flight optimistic ID)
      const pendingCreation = pendingCreationsRef.current.get(folderId);
      if (pendingCreation) {
        pendingCreation
          .then((realFolder: Folder) => dbAddClipToFolder(realFolder.id, videoId))
          .catch((err: unknown) => console.warn("[interaction] addClipToFolder after creation error:", err));
      } else {
        // Persist to Supabase directly
        dbAddClipToFolder(folderId, videoId).catch((err: unknown) =>
          console.warn("[interaction] addClipToFolder error:", err)
        );
      }
    }
  }, []);

  const unsaveVideo = useCallback((videoId: string) => {
    setSaved((prev) => {
      if (prev.includes(videoId)) void unsaveVideoRow(videoId);
      return prev.filter((x) => x !== videoId);
    });
    // Remove from all local folders + DB
    setFolders((prev) => {
      prev.forEach((f) => {
        if (f.videoIds.includes(videoId)) {
          dbRemoveClipFromFolder(f.id, videoId).catch((err) =>
            console.warn("[interaction] removeClipFromFolder error:", err)
          );
        }
      });
      return prev.map((f) => ({
        ...f,
        videoIds: f.videoIds.filter((v) => v !== videoId),
      }));
    });
  }, []);

  const createFolder = useCallback((name: string) => {
    // Optimistic ID so callers get an immediate response
    const optimisticId = `folder-${Date.now()}`;
    const trimmedName = name.trim() || "โฟลเดอร์ใหม่";

    // Optimistic local update
    setFolders((prev) => [...prev, { id: optimisticId, name: trimmedName, videoIds: [] }]);

    // Persist to Supabase & swap optimistic ID with real ID
    const creationPromise = dbCreateFolder(trimmedName);
    pendingCreationsRef.current.set(optimisticId, creationPromise);

    creationPromise
      .then((realFolder) => {
        setFolders((prev) =>
          prev.map((f) =>
            f.id === optimisticId
              ? { ...f, id: realFolder.id }
              : f
          )
        );
        console.log("[folder] created in DB:", realFolder.id, realFolder.name);
      })
      .catch((err: any) => {
        const msg = err?.message ?? String(err);
        console.warn("[folder] createFolder DB FAILED:", msg);
        // Show the real error so we can diagnose it.
        Alert.alert("สร้างโฟลเดอร์ไม่สำเร็จ", msg);
        setFolders((prev) => prev.filter((f) => f.id !== optimisticId));
      })
      .finally(() => {
        pendingCreationsRef.current.delete(optimisticId);
      });

    return optimisticId;
  }, []);

  const deleteFolderHandler = useCallback((folderId: string) => {
    // Optimistic local removal
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    // Persist to DB
    dbDeleteFolder(folderId).catch((err) =>
      console.warn("[interaction] deleteFolder DB error:", err)
    );
  }, []);

  const renameFolderHandler = useCallback((folderId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    // Optimistic local update
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f))
    );
    // Persist to DB
    dbRenameFolder(folderId, trimmed).catch((err) =>
      console.warn("[interaction] renameFolder DB error:", err)
    );
  }, []);

  const shareToChat = useCallback((friendId: string, videoId: string) => {
    setChatShares((prev) => [
      ...prev,
      { id: `share-${Date.now()}-${friendId}`, friendId, videoId, at: Date.now() },
    ]);
  }, []);

  const reloadFolders = useCallback(() => {
    loadFoldersFromDb();
  }, [loadFoldersFromDb]);

  // ──────────────────────────────────────────────
  //  Context value
  // ──────────────────────────────────────────────
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
      deleteFolder: deleteFolderHandler,
      renameFolder: renameFolderHandler,
      shareToChat,
      reloadFolders,
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
      deleteFolderHandler,
      renameFolderHandler,
      shareToChat,
      reloadFolders,
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
