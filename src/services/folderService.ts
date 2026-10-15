import { supabase, isSupabaseConfigured } from "../lib/supabase";

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────
export interface Folder {
  id: string;
  owner_id: string;
  name: string;
  is_public: boolean;
  created_at: string;
  /** Runtime: number of clips inside */
  clip_count?: number;
  /** Runtime: first video thumbnail for cover */
  cover_url?: string;
}

export interface FolderItem {
  id: string;
  folder_id: string;
  video_id: string;
  added_by: string | null;
  created_at: string;
}

export interface SavedClipInfo {
  video_id: string;
  folder_id: string | null;   // null = floating (ไม่อยู่ในโฟลเดอร์)
  created_at: string;
}

// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────
async function currentUid(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function guard(uid: string | null): asserts uid is string {
  if (!uid) throw new Error("NOT_AUTHENTICATED");
}

// ============================================================
//  A) FOLDER CRUD  —  แต่ละ user มีโฟลเดอร์ของตัวเองแยกกัน
// ============================================================

/** สร้างโฟลเดอร์ใหม่สำหรับ user ปัจจุบัน */
export async function createFolder(name: string, isPublic = false): Promise<Folder> {
  const uid = await currentUid();
  guard(uid);

  const { data, error } = await supabase
    .from("folders")
    .insert({ owner_id: uid, name, is_public: isPublic })
    .select()
    .single();

  if (error) throw new Error(`createFolder: ${error.message}`);
  return data as Folder;
}

/** ดึงรายการโฟลเดอร์ทั้งหมดของ user ปัจจุบัน (รวม clip_count + cover) */
export async function getMyFolders(): Promise<Folder[]> {
  const uid = await currentUid();
  if (!uid) return [];

  // 1. Fetch folders owned by this user
  const { data: folders, error } = await supabase
    .from("folders")
    .select("*")
    .eq("owner_id", uid)
    .order("created_at", { ascending: false });

  if (error || !folders) return [];

  // 2. For each folder, get clip count + first thumbnail for cover
  const enriched: Folder[] = await Promise.all(
    folders.map(async (f: any) => {
      const { count } = await supabase
        .from("folder_items")
        .select("id", { count: "exact", head: true })
        .eq("folder_id", f.id);

      // Get the first item's video thumbnail as cover
      let cover_url: string | undefined;
      const { data: firstItem } = await supabase
        .from("folder_items")
        .select("video_id")
        .eq("folder_id", f.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (firstItem) {
        const { data: vid } = await supabase
          .from("videos")
          .select("thumbnail_url")
          .eq("id", firstItem.video_id)
          .single();
        cover_url = vid?.thumbnail_url ?? undefined;
      }

      return { ...f, clip_count: count ?? 0, cover_url } as Folder;
    })
  );

  return enriched;
}

/** เปลี่ยนชื่อโฟลเดอร์ (ตรวจสอบ ownership ผ่าน RLS) */
export async function renameFolder(folderId: string, newName: string): Promise<void> {
  const uid = await currentUid();
  guard(uid);
  const { error } = await supabase
    .from("folders")
    .update({ name: newName })
    .eq("id", folderId)
    .eq("owner_id", uid);
  if (error) throw new Error(`renameFolder: ${error.message}`);
}

/** ลบโฟลเดอร์ (cascade จะลบ folder_items ด้วย) */
export async function deleteFolder(folderId: string): Promise<void> {
  const uid = await currentUid();
  guard(uid);
  const { error } = await supabase
    .from("folders")
    .delete()
    .eq("id", folderId)
    .eq("owner_id", uid);
  if (error) throw new Error(`deleteFolder: ${error.message}`);
}

// ============================================================
//  B) FOLDER ITEMS  —  เพิ่ม/ลบคลิปในโฟลเดอร์
// ============================================================

/** เพิ่มคลิปลงโฟลเดอร์ (ป้องกัน duplicate ด้วย unique constraint) */
export async function addClipToFolder(folderId: string, videoId: string): Promise<void> {
  const uid = await currentUid();
  guard(uid);

  // Also ensure the video is in video_saves (the "save" action)
  await supabase
    .from("video_saves")
    .upsert({ user_id: uid, video_id: videoId }, { onConflict: "user_id,video_id" });

  const { error } = await supabase
    .from("folder_items")
    .insert({ folder_id: folderId, video_id: videoId, added_by: uid });

  // Ignore duplicate error (23505 = unique_violation)
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`addClipToFolder: ${error.message}`);
  }
}

/** ลบคลิปออกจากโฟลเดอร์ (ไม่ลบออกจาก video_saves ทั้งหมด) */
export async function removeClipFromFolder(folderId: string, videoId: string): Promise<void> {
  const { error } = await supabase
    .from("folder_items")
    .delete()
    .eq("folder_id", folderId)
    .eq("video_id", videoId);
  if (error) throw new Error(`removeClipFromFolder: ${error.message}`);
}

/** ย้ายคลิปจากโฟลเดอร์หนึ่งไปอีกโฟลเดอร์หนึ่ง */
export async function moveClipToFolder(
  videoId: string,
  fromFolderId: string | null,
  toFolderId: string
): Promise<void> {
  const uid = await currentUid();
  guard(uid);

  // Remove from old folder if applicable
  if (fromFolderId) {
    await supabase
      .from("folder_items")
      .delete()
      .eq("folder_id", fromFolderId)
      .eq("video_id", videoId);
  }

  // Insert into new folder
  const { error } = await supabase
    .from("folder_items")
    .upsert(
      { folder_id: toFolderId, video_id: videoId, added_by: uid },
      { onConflict: "folder_id,video_id" }
    );

  if (error) throw new Error(`moveClipToFolder: ${error.message}`);
}

/** ดึงรายการ video_id ทั้งหมดในโฟลเดอร์ (เรียงจากใหม่ไปเก่า) */
export async function getClipsInFolder(folderId: string): Promise<FolderItem[]> {
  const { data, error } = await supabase
    .from("folder_items")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getClipsInFolder: ${error.message}`);
  return (data ?? []) as FolderItem[];
}

// ============================================================
//  C) FLOATING SAVES  —  คลิปที่บันทึกแบบลอยๆ ไม่ลงโฟลเดอร์
// ============================================================

/**
 * บันทึกคลิปแบบลอยๆ (ไม่ใส่โฟลเดอร์)
 * — เพิ่มเข้า video_saves เท่านั้น, ไม่ใส่ folder_items
 */
export async function saveClipFloating(videoId: string): Promise<void> {
  const uid = await currentUid();
  guard(uid);

  const { error } = await supabase
    .from("video_saves")
    .upsert({ user_id: uid, video_id: videoId }, { onConflict: "user_id,video_id" });

  if (error) throw new Error(`saveClipFloating: ${error.message}`);
}

/** ลบคลิปที่บันทึกลอยๆ ออก (ลบจาก video_saves ทั้งหมด + ลบจาก folder_items ทุกโฟลเดอร์ด้วย) */
export async function unsaveClipCompletely(videoId: string): Promise<void> {
  const uid = await currentUid();
  guard(uid);

  // ลบจากทุกโฟลเดอร์ของ user นี้ (ผ่าน RLS จะป้องกันลบของคนอื่น)
  const { data: myFolders } = await supabase
    .from("folders")
    .select("id")
    .eq("owner_id", uid);

  if (myFolders && myFolders.length > 0) {
    const folderIds = myFolders.map((f: any) => f.id);
    await supabase
      .from("folder_items")
      .delete()
      .in("folder_id", folderIds)
      .eq("video_id", videoId);
  }

  // ลบจาก video_saves
  await supabase
    .from("video_saves")
    .delete()
    .eq("user_id", uid)
    .eq("video_id", videoId);
}

/**
 * ดึงคลิปที่บันทึกแบบลอยๆ (อยู่ใน video_saves แต่ไม่อยู่ใน folder_items ใดๆ ของ user นี้)
 * — เฉพาะ user ปัจจุบันเท่านั้น
 */
export async function getFloatingClips(): Promise<string[]> {
  const uid = await currentUid();
  if (!uid) return [];

  // 1. All saved video IDs for this user
  const { data: saves } = await supabase
    .from("video_saves")
    .select("video_id")
    .eq("user_id", uid);

  if (!saves || saves.length === 0) return [];
  const allSavedIds = saves.map((s: any) => s.video_id as string);

  // 2. All video IDs in user's folders
  const { data: myFolders } = await supabase
    .from("folders")
    .select("id")
    .eq("owner_id", uid);

  const folderIds = (myFolders ?? []).map((f: any) => f.id as string);

  let folderedVideoIds: Set<string> = new Set();
  if (folderIds.length > 0) {
    const { data: items } = await supabase
      .from("folder_items")
      .select("video_id")
      .in("folder_id", folderIds);

    (items ?? []).forEach((i: any) => folderedVideoIds.add(i.video_id));
  }

  // 3. Floating = saved but NOT in any folder
  return allSavedIds.filter((vid) => !folderedVideoIds.has(vid));
}

// ============================================================
//  D) COMBINED VIEW  —  ดึงข้อมูลรวมสำหรับหน้า "คลิปที่บันทึก"
// ============================================================

export interface SavedClipsOverview {
  folders: Folder[];
  floatingVideoIds: string[];
  totalSaved: number;
}

/**
 * ดึงข้อมูลรวมทั้งหมดของ user ปัจจุบัน:
 * - folders (พร้อม clip_count + cover)
 * - floating clips (บันทึกลอยๆ)
 * - total saved count
 */
export async function getSavedClipsOverview(): Promise<SavedClipsOverview> {
  const uid = await currentUid();
  if (!uid) return { folders: [], floatingVideoIds: [], totalSaved: 0 };

  const [folders, floatingVideoIds] = await Promise.all([
    getMyFolders(),
    getFloatingClips(),
  ]);

  const totalInFolders = folders.reduce((sum, f) => sum + (f.clip_count ?? 0), 0);

  return {
    folders,
    floatingVideoIds,
    totalSaved: totalInFolders + floatingVideoIds.length,
  };
}

// ============================================================
//  E) AI CONTEXT  —  สรุปข้อมูลโฟลเดอร์สำหรับส่งให้ AI Chat
// ============================================================

export interface FolderAiContext {
  folder_id: string;
  folder_name: string;
  clips: {
    video_id: string;
    caption: string | null;
    location_name: string | null;
    province: string | null;
    hashtags: string[];
  }[];
}

/**
 * ดึงข้อมูลโฟลเดอร์ + คลิปพร้อม metadata ที่ AI ต้องการ
 * — ใช้ส่งให้ AI Chat เป็น context เพื่อวางแผนทริป
 */
export async function getFolderContextForAi(folderId: string): Promise<FolderAiContext | null> {
  // Get folder info
  const { data: folder } = await supabase
    .from("folders")
    .select("id, name")
    .eq("id", folderId)
    .single();

  if (!folder) return null;

  // Get items
  const { data: items } = await supabase
    .from("folder_items")
    .select("video_id")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: true });

  const videoIds = (items ?? []).map((i: any) => i.video_id as string);
  if (videoIds.length === 0) {
    return { folder_id: folder.id, folder_name: folder.name, clips: [] };
  }

  // Get video details
  const { data: videos } = await supabase
    .from("videos")
    .select("id, caption, location_name, province, hashtags")
    .in("id", videoIds);

  return {
    folder_id: folder.id,
    folder_name: folder.name,
    clips: (videos ?? []).map((v: any) => ({
      video_id: v.id,
      caption: v.caption,
      location_name: v.location_name,
      province: v.province,
      hashtags: Array.isArray(v.hashtags) ? v.hashtags : [],
    })),
  };
}

/** ดึงข้อมูลทุกโฟลเดอร์ + คลิปลอยๆ สำหรับ AI context */
export async function getAllFoldersContextForAi(): Promise<{
  folders: FolderAiContext[];
  floating_clips: { video_id: string; caption: string | null; location_name: string | null; province: string | null }[];
}> {
  const uid = await currentUid();
  if (!uid) return { folders: [], floating_clips: [] };

  const overview = await getSavedClipsOverview();

  // Fetch folder contexts in parallel
  const folderContexts = await Promise.all(
    overview.folders.map((f) => getFolderContextForAi(f.id))
  );

  // Fetch floating clip details
  let floating_clips: any[] = [];
  if (overview.floatingVideoIds.length > 0) {
    const { data } = await supabase
      .from("videos")
      .select("id, caption, location_name, province")
      .in("id", overview.floatingVideoIds);
    floating_clips = (data ?? []).map((v: any) => ({
      video_id: v.id,
      caption: v.caption,
      location_name: v.location_name,
      province: v.province,
    }));
  }

  return {
    folders: folderContexts.filter(Boolean) as FolderAiContext[],
    floating_clips,
  };
}
