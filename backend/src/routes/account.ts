import { Router, Request, Response } from "express";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { sendError } from "../middleware/errors";

/**
 * POST /account/delete
 * -------------------------------------------------------------
 * Permanently delete the calling user's account. Single transaction:
 *   1) JWT verify (admin.auth.getUser reads JWT signature directly
 *      via the project's JWT secret — no anon-key import needed).
 *   2) Pre-collect every storage path this user owns while the rows
 *      still exist (videos / thumbnails / avatar) — DB query only.
 *   3) Delete `auth.users` via the project's
 *      `account_hard_delete(target_uid uuid)` RPC instead of GoTrue's
 *      admin.auth.admin.deleteUser(). GoTrue's path returns
 *      "database error deleting user" in some environments and the
 *      actual FK cascade never runs. The SECURITY DEFINER function in
 *      supabase/migrations/add_account_hard_delete.sql performs the
 *      same delete directly, so when a constraint fails we see the
 *      real Postgres error instead of an opaque one.
 *   4) ตอบกลับผู้ใช้ทันที แล้วค่อยล้างไฟล์ใน Storage แบบเบื้องหลัง
 *      (Storage cleanup เดิมอยู่กลาง request → ผู้ใช้รอนานจน iOS
 *      ตัดการเชื่อมต่อที่ ~60 วินาที: "The request timed out.")
 *
 * Scope rule: this route removes ONLY the calling user's own rows.
 * Other people's data is never deleted — e.g. a like the user gave on
 * someone else's video disappears (that row is the user's), while the
 * video itself survives and its likes_count drops by exactly one
 * (the bump_video_likes trigger fires on the cascade delete).
 *
 * Rows that live in shared context (community_places.owner_id,
 * chats.created_by, chat_messages.sender_id, folder_items.added_by)
 * are ON DELETE SET NULL — they survive with a null pointer rather
 * than vanishing, because deleting them would delete other people's
 * data (a message in a shared room, an item in someone else's folder).
 *
 * Counter triggers (bump_video_likes etc.) are AFTER DELETE on each
 * child table, so they fire automatically when the cascade hits them.
 */

const router = Router();

/**
 * Extract (bucket, path) from a Supabase Storage object URL.
 * Returns null when the URL isn't shaped like one of ours. Used so a
 * stray google.com/external URL never reaches the storage client.
 */
const STORAGE_PATH_RE =
  /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/;

function parseStorageLocation(
  url: string | null | undefined
): { bucket: string; path: string } | null {
  if (!url) return null;
  const m = STORAGE_PATH_RE.exec(url);
  if (!m) return null;
  return { bucket: m[1], path: m[2] };
}

/**
 * Chunk an array into ≤`size`-element groups. Supabase's storage.remove
 * caps at 1000 paths per call.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Promise ที่มีเวลาติดตั้ง
 * -------------------------------------------------------------
 * ทุกขั้นที่คุยกับ Supabase ต้องมีเพดานเวลา ไม่งั้น request จะค้าง
 * ตลอดไปจน client ตัดการเชื่อมต่อ (iOS ตัดเองที่ ~60 วินาที) แล้วผู้ใช้
 * เห็นแค่ "หมดเวลา" โดยไม่รู้ว่าค้างที่ตรวจ token หรือที่ลบในฐานข้อมูล
 *
 * ฝั่ง express จะโพรต log ตอน "ตอบกลับแล้ว" เท่านั้น → request ที่ค้าง
 * จะไม่มี log เลย พอเกิดขึ้นจะดูไม่ออกว่าปัญหาอยู่ฝั่งเน็ตหรือฝั่ง DB
 */
function withTimeout<T>(
  p: PromiseLike<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} (เกิน ${Math.round(ms / 1000)} วินาที)`)),
      ms
    );
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** เพดานเวลาตรวจ token (เรียก auth server ครั้งเดียว) */
const VERIFY_TIMEOUT_MS = 15_000;
/** เพดานเวลาลบในฐานข้อมูล (cascade หลายตาราง) */
const DELETE_TIMEOUT_MS = 45_000;

/**
 * Recursively list every object path under `${prefix}` in the named
 * bucket. Used so we can sweep the user's drafts folder (no DB row
 * points at those files). Supabase's `list` is folder-scoped; we
 * recurse one level to cover `${prefix}/drafts/`.
 */
async function listAllPathsUnder(
  bucketName: string,
  prefix: string
): Promise<string[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const out: string[] = [];
  const limit = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage
      .from(bucketName)
      .list(prefix, { limit, offset });
    if (error) {
      console.warn(`[account] storage.list ${bucketName}/${prefix} failed:`, error.message);
      return out;
    }
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const childPrefix = `${prefix}/${entry.name}`;
      if (entry.id == null) {
        // Folder (no id) — recurse one level.
        const sub = await listAllPathsUnder(bucketName, childPrefix);
        out.push(...sub);
      } else {
        // File.
        out.push(childPrefix);
      }
    }
    if (data.length < limit) break;
    offset += data.length;
  }
  return out;
}

/**
 * ล้างไฟล์ใน Storage แบบ "เบื้องหลัง" — ทำหลังตอบกลับผู้ใช้แล้ว
 * -------------------------------------------------------------
 * เดิมขั้นตอนนี้อยู่ระหว่าง request → ผู้ใช้รอกวาดโฟลเดอร์ + ลบไฟล์
 * ทั้งหมดก่อนถึงจะได้ response และบน iOS ตัดการเชื่อมต่อที่ ~60 วินาที
 * ("The request timed out.") แม้การลบบัญชีใน DB จะทำงานปกติ
 *
 * ย้ายมาทำหลังตอบกลับแล้ว เพราะ:
 *   • DB cascade เป็นตัวที่ลบ "ข้อมูล" จริง (หน้าตาของระบบ)
 *   • Supabase ก็ cascade `storage.objects.owner → auth.users` อยู่แล้ว
 *     → ไฟล์ที่ค้างเป็นแค่ขยะ ลบทีหลังได้ ล้มเหลวก็ไม่กระทบผู้ใช้
 */
async function cleanupStorageInBackground(
  uid: string,
  trackedVideoPaths: string[],
  trackedAvatarPaths: string[]
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  const startedAt = Date.now();
  const mark = (label: string) =>
    console.log(
      `[account ${uid}] (เบื้องหลัง) ${label} · ${Date.now() - startedAt}ms`
    );

  try {
    // Sweep the user's full folder in the `videos` bucket — covers
    // draft objects that never became a videos row. Same for `avatars`
    // (old avatars replaced via updateProfile).
    const videoPaths = [...trackedVideoPaths];
    const avatarPaths = [...trackedAvatarPaths];

    try {
      const orphanVideoPaths = await listAllPathsUnder("videos", uid);
      for (const path of orphanVideoPaths) videoPaths.push(path);
    } catch (e: any) {
      console.warn(`[account ${uid}] orphan video sweep failed:`, e?.message ?? e);
    }
    try {
      const orphanAvatarPaths = await listAllPathsUnder("avatars", uid);
      for (const path of orphanAvatarPaths) avatarPaths.push(path);
    } catch (e: any) {
      console.warn(`[account ${uid}] orphan avatar sweep failed:`, e?.message ?? e);
    }

    const uniqueVideoPaths = Array.from(new Set(videoPaths));
    const uniqueAvatarPaths = Array.from(new Set(avatarPaths));

    for (const group of chunk(uniqueVideoPaths, 1000)) {
      const { error: rmErr } = await admin.storage.from("videos").remove(group);
      if (rmErr) {
        console.warn(
          `[account] storage.remove videos failed (${group.length} items):`,
          rmErr.message
        );
      }
    }
    if (uniqueAvatarPaths.length > 0) {
      // Supabase รับได้ไม่เกิน 1000 path ต่อครั้ง — แบ่งเหมือนฝั่งวิดีโอ
      for (const group of chunk(uniqueAvatarPaths, 1000)) {
        const { error: rmErr } = await admin.storage.from("avatars").remove(group);
        if (rmErr) {
          console.warn(
            `[account] storage.remove avatars failed (${group.length} items):`,
            rmErr.message
          );
        }
      }
    }
    mark(
      `ลบไฟล์ใน Storage แล้ว · วิดีโอ ${uniqueVideoPaths.length} · รูป ${uniqueAvatarPaths.length}`
    );
  } catch (e: any) {
    console.warn(
      `[account ${uid}] ล้างไฟล์เบื้องหลังไม่สำเร็จ:`,
      e?.message ?? e
    );
  }
}

router.post("/delete", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase — ไม่สามารถลบบัญชีได้",
      code: "NOT_CONFIGURED",
      requestId: (req as any).requestId,
    });
  }

  // เวลาแต่ละช่วง — ลบบัญชีเป็นงานหนัก (Storage + cascade หลายตาราง) ต้องเห็นว่า
  // ช้าที่ช่วงไหน ไม่ใช่แค่ "ไม่สำเร็จ"
  // (uid ยังไม่รู้ตอน request แรกมาถึง → ใช้ "-" แล้วเติมทีหลัง)
  let uidForLog = "-";
  const mark = (label: string) =>
    console.log(`[account ${uidForLog}] ${label} · ${Date.now() - startedAt}ms`);

  // พิมพ์ตอน "request มาถึงแล้ว" — log ปกติของ express พิมพ์หลังตอบกลับเสร็จ
  // เท่านั้น ถ้าค้างกลางคันจะไม่มี log เลย → เดาไม่ออกว่าปัญหาอยู่ฝั่งเน็ต
  // (ไม่ถึงเซิร์ฟเวอร์) หรือฝั่ง DB
  mark("ได้รับ request · เริ่มตรวจ token");

  // ---- 1) JWT verify ------------------------------------------------
  const authHeader = req.header("authorization") ?? "";
  const tokenMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = tokenMatch?.[1]?.trim();
  if (!token) {
    return res.status(401).json({
      error: "ต้องส่ง Authorization: Bearer <token>",
      code: "UNAUTHORIZED",
      requestId: (req as any).requestId,
    });
  }

  let uid: string;
  try {
    const { data: verified, error: verifyErr } = await withTimeout(
      admin.auth.getUser(token),
      VERIFY_TIMEOUT_MS,
      "ตรวจสอบ token ไม่ทัน"
    );
    if (verifyErr || !verified?.user?.id) {
      return res.status(401).json({
        error: "โทเค็นไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
        code: "UNAUTHORIZED",
        requestId: (req as any).requestId,
      });
    }
    uid = verified.user.id;
  } catch (e: any) {
    const timedOut = String(e?.message ?? "").includes("ไม่ทัน");
    mark(timedOut ? "ตรวจ token ไม่ทัน" : "ตรวจ token ล้มเหลว");
    return sendError(res, e, req, timedOut ? 504 : 401);
  }
  mark(`ยืนยัน token แล้ว · uid ${uid}`);
  uidForLog = uid;

  try {
    // ---- 2) Collect DB-tracked storage paths ------------------------
    //
    // เก็บเฉพาะ path ที่ "ชี้" มาจากแถวใน DB (คิวรีเร็ว) — ไม่กวาดโฟลเดอร์
    // Storage ตอนนี้ เพราะการกวาด/ลบไฟล์คือส่วนที่ช้าที่สุด และไม่จำเป็น
    // ต่อผลลัพธ์ของผู้ใช้ (DB cascade ลบข้อมูลจริงอยู่แล้ว)
    //
    // Reads here are best-effort: we only need them to clean up
    // Storage after the cascade wipes the DB rows. If a query
    // fails (transient PostgREST hiccup, schema drift, RLS surprise)
    // we log it and keep going — the hard delete is authoritative
    // and the user still disappears.
    const videosByLocation = new Map<string, true>();
    const avatarsByLocation = new Map<string, true>();

    // videos: video_url + thumbnail_url for every clip owned by uid
    const { data: videoRows, error: vidErr } = await admin
      .from("videos")
      .select("video_url, thumbnail_url")
      .eq("user_id", uid);
    if (vidErr) {
      console.warn(
        `[account ${uid}] videos select failed (continuing without DB-tracked paths):`,
        vidErr.message
      );
    } else {
      for (const row of videoRows ?? []) {
        for (const loc of [
          parseStorageLocation(row.video_url),
          parseStorageLocation(row.thumbnail_url),
        ]) {
          if (!loc) continue;
          const key = `${loc.bucket}/${loc.path}`;
          if (loc.bucket === "videos") videosByLocation.set(key, true);
          else if (loc.bucket === "avatars") avatarsByLocation.set(key, true);
        }
      }
    }

    // profile avatar
    const { data: userRow, error: userErr } = await admin
      .from("users")
      .select("avatar_url")
      .eq("id", uid)
      .maybeSingle();
    if (userErr) {
      console.warn(
        `[account ${uid}] users select failed (continuing):`,
        userErr.message
      );
    } else {
      const avatarLoc = parseStorageLocation(userRow?.avatar_url);
      if (avatarLoc?.bucket === "avatars") {
        avatarsByLocation.set(`${avatarLoc.bucket}/${avatarLoc.path}`, true);
      }
    }

    const trackedVideoPaths = Array.from(videosByLocation.keys());
    const trackedAvatarPaths = Array.from(avatarsByLocation.keys());
    mark(
      `เก็บรายการไฟล์แล้ว · วิดีโอ ${trackedVideoPaths.length} · รูป ${trackedAvatarPaths.length}`
    );

    // ---- 3) Cascade-delete via raw SQL RPC ----------------------------
    //
    // GoTrue's admin.auth.admin.deleteUser() returns a generic
    // "database error deleting user" in some Supabase environments
    // before the cascade ever runs. We call our own SECURITY DEFINER
    // RPC (supabase/migrations/add_account_hard_delete.sql) so the
    // real Postgres error surfaces when something is wrong.
    //
    // ทำก่อนตอบกลับ — นี่คือส่วนที่ "ลบบัญชี" จริง · เสร็จในไม่กี่วินาที
    //
    // มีเพดานเวลา: ถ้า DB ค้าง (เช่น รอล็อกจาก transaction อื่น) ให้ล้มเหลว
    // พร้อมข้อความชัด ๆ แทนที่จะค้างจน client ตัดการเชื่อมต่อ
    const { error: delErr } = await withTimeout(
      admin.rpc("account_hard_delete", { target_uid: uid }),
      DELETE_TIMEOUT_MS,
      "ลบในฐานข้อมูลไม่ทัน"
    );
    if (delErr) {
      console.error(`[account ${uid}] hard delete RPC failed:`, delErr);
      const msg = (delErr.message ?? "").toLowerCase();
      const alreadyGone =
        msg.includes("not found") ||
        msg.includes("does not exist") ||
        msg.includes("user does not") ||
        msg.includes("0 rows") ||
        // Supabase wraps PGRES empty as `code = PGRST116` sometimes.
        (delErr as any)?.code === "PGRST116";
      if (!alreadyGone) {
        return sendError(
          res,
          new Error(`ลบบัญชีไม่สำเร็จ: ${delErr.message}`),
          req,
          500
        );
      }
      // Already gone — treat as success (idempotent retry path).
      mark("ลบบัญชีสำเร็จ (บัญชีหายไปอยู่แล้ว)");
      res.json({ ok: true, alreadyDeleted: true });
      // รอบก่อนอาจถูกตัดกลางทางหลัง DB ลบเสร็จแต่ Storage ยังไม่ว่าง
      // → กวาดทิ้งให้ครบ (เบื้องหลัง)
      void cleanupStorageInBackground(uid, trackedVideoPaths, trackedAvatarPaths);
      return;
    }

    mark("ลบบัญชีสำเร็จ");

    // ตอบผู้ใช้ก่อน — iOS ตัดการเชื่อมต่อที่ ~60 วินาที ถ้ารอล้าง
    // Storage ก่อนตอบ ผู้ใช้จะเจอ "The request timed out." ทั้งที่
    // บัญชีถูกลบสำเร็จไปแล้ว
    res.json({ ok: true });

    // ค่อยล้างไฟล์ใน Storage ทีหลัง (ไม่รอผล) — ล้มเหลวได้โดยไม่กระทบ
    // เพราะ DB cascade เป็นตัวลบข้อมูลจริง และ Supabase ก็ cascade
    // storage.objects.owner → auth.users อยู่แล้ว
    //
    // หมายเหตุ (Vercel): serverless อาจหยุดงานหลังตอบ response → งานล้าง
    // ไฟล์อาจไม่ได้ทำต่อ แต่ไม่กระทบผลลัพธ์ เพราะข้อมูลใน DB ถูกลบ
    // เรียบร้อยแล้ว และไฟล์ค้างเป็นแค่ขยะ (เก็บกวาดทีหลังได้)
    void cleanupStorageInBackground(
      uid,
      trackedVideoPaths,
      trackedAvatarPaths
    );
    return;
  } catch (e: any) {
    mark(`ล้มเหลว: ${e?.message ?? e}`);
    return sendError(res, e, req, 500);
  }
});

export default router;
