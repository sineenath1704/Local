import { supabase, isSupabaseConfigured } from "../lib/supabase";
import type { CommentItem, CommentReply } from "../data/commentsData";

/**
 * Comments service — คอมเมนต์จริงจาก Supabase
 * -------------------------------------------------------------
 * ก่อนหน้านี้แอปไม่เคยเขียนคอมเมนต์ลงฐานข้อมูลเลย — `CommentSheet` แค่
 * เก็บไว้ใน state ของ React → พอคอมโพเนนต์ถูก unmount (เลื่อนฟีด หรือ
 * ปิดหน้า) คอมเมนต์ก็หายไปเงียบ ๆ
 *
 * ตาราง `comments` พร้อมแล้วใน schema.sql (มี policy insert own / update own /
 * delete own) — ขาดแค่ GRANT ระดับตารางให้ role ฝั่งแอป
 * (ดู `supabase/migrations/fix_app_role_grants.sql`)
 */

/** id ของคลิปจริงเป็น uuid · id ของโพสต์จำลองเป็นคำอย่าง "p1" */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** คลิปนี้มีอยู่จริงในฐานข้อมูลหรือไม่ (คลิปจำลองใช้ข้อมูลจาก JSON) */
export function isRealVideoId(videoId: string): boolean {
  return UUID_RE.test(videoId);
}

interface CommentRow {
  id: string;
  video_id: string;
  user_id: string;
  parent_comment_id: string | null;
  comment_type: string | null;
  content: string;
  rating: number | null;
  likes_count: number | null;
  created_at: string;
}

const COMMENT_SELECT =
  "id, video_id, user_id, parent_comment_id, comment_type, content, rating, likes_count, created_at";

async function currentUid(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** "เมื่อสักครู่" / "5 นาทีที่แล้ว" / "3 ชั่วโมงที่แล้ว" / "2 วันที่แล้ว" */
export function timeAgoFrom(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then || Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "เมื่อสักครู่";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;
  return `${Math.floor(months / 12)} ปีที่แล้ว`;
}

/** ข้อมูลผู้เขียน (ชื่อ + รูป) ของผู้ใช้ปัจจุบัน */
async function myAuthorInfo(): Promise<{ name: string; avatarUri: string | null }> {
  const uid = await currentUid();
  if (!uid) return { name: "คุณ", avatarUri: null };
  const { data } = await supabase
    .from("users")
    .select("id, display_name, username, avatar_url")
    .eq("id", uid)
    .maybeSingle();
  return {
    name: data?.display_name ?? data?.username ?? "คุณ",
    avatarUri: data?.avatar_url ?? null,
  };
}

/** โหลดคอมเมนต์ทั้งหมดของคลิป (รวมคำตอบกลับ) เรียงตามเวลา */
export async function loadVideoComments(videoId: string): Promise<CommentItem[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("video_id", videoId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`โหลดความคิดเห็นไม่สำเร็จ: ${error.message}`);

  const rows: CommentRow[] = (data ?? []) as CommentRow[];
  if (rows.length === 0) return [];

  // โหลดผู้เขียนทั้งหมดในคำขอเดียว (แยก query ไม่ join กับ users
  // เพื่อไม่ต้องพึ่งความสัมพันธ์ FK ของ PostgREST)
  const authorIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
  const { data: users } = await supabase
    .from("users")
    .select("id, display_name, username, avatar_url")
    .in("id", authorIds);
  const userById = new Map((users ?? []).map((u: any) => [u.id, u]));

  const authorName = (userId: string) => {
    const u: any = userById.get(userId);
    return u?.display_name ?? u?.username ?? "ผู้ใช้";
  };
  const authorAvatar = (userId: string) => {
    const u: any = userById.get(userId);
    return u?.avatar_url ?? null;
  };

  const byId = new Map<string, CommentItem>();
  const order: string[] = [];

  // คอมเมนต์ระดับบนสุด
  for (const r of rows) {
    if (r.parent_comment_id) continue;
    byId.set(r.id, {
      id: r.id,
      authorName: authorName(r.user_id),
      avatarUri: authorAvatar(r.user_id),
      timeAgo: timeAgoFrom(r.created_at),
      text: r.content,
      likes: r.likes_count ?? 0,
      replies: [],
    });
    order.push(r.id);
  }

  // คำตอบกลับ
  for (const r of rows) {
    if (!r.parent_comment_id) continue;
    const parent = byId.get(r.parent_comment_id);
    const reply: CommentReply = {
      id: r.id,
      authorName: authorName(r.user_id),
      avatarUri: authorAvatar(r.user_id),
      timeAgo: timeAgoFrom(r.created_at),
      text: r.content,
      likes: r.likes_count ?? 0,
    };
    if (parent) {
      parent.replies.push(reply);
    } else {
      // พ่อที่หายไป (เช่น ถูกลบ) → เก็บคำตอบกลับไว้ข้างบนแทน
      byId.set(r.id, { ...reply, replies: [] });
      order.push(r.id);
    }
  }

  return order.map((id) => byId.get(id)!).filter(Boolean);
}

/** ผลลัพธ์ที่บันทึกลงฐานข้อมูลแล้ว (ใช้แทนคอมเมนต์ชั่วคราวบนหน้าจอ) */
export interface SavedComment {
  id: string;
  authorName: string;
  avatarUri: string | null;
  timeAgo: string;
  text: string;
  likes: number;
}

/**
 * เขียนคอมเมนต์ (หรือคำตอบกลับ) ลงฐานข้อมูล
 * — โยน error เมื่อบันทึกไม่สำเร็จ (ผู้เรียกต้องแจ้งผู้ใช้)
 */
export async function addVideoComment(
  videoId: string,
  content: string,
  parentCommentId?: string | null
): Promise<SavedComment> {
  const uid = await currentUid();
  if (!uid) throw new Error("กรุณาเข้าสู่ระบบก่อนแสดงความคิดเห็น");

  const { data, error } = await supabase
    .from("comments")
    .insert({
      video_id: videoId,
      user_id: uid,
      parent_comment_id: parentCommentId ?? null,
      content,
    })
    .select(COMMENT_SELECT)
    .single();

  if (error) throw new Error(`ส่งความคิดเห็นไม่สำเร็จ: ${error.message}`);

  const row = data as CommentRow;
  const me = await myAuthorInfo();
  return {
    id: row.id,
    authorName: me.name,
    avatarUri: me.avatarUri,
    timeAgo: timeAgoFrom(row.created_at),
    text: row.content,
    likes: row.likes_count ?? 0,
  };
}
