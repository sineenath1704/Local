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
 *      still exist (videos / thumbnails / avatar / drafts).
 *   3) Storage remove (best-effort — DB cascade is authoritative).
 *      Supabase also cascades `storage.objects.owner → auth.users`
 *      so manual cleanup is defense-in-depth — it lets us surface
 *      a Thai error when a binary sits stuck, instead of waiting
 *      for an opaque storage auth row to fail.
 *   4) Delete `auth.users` via the project's
 *      `account_hard_delete(target_uid uuid)` RPC instead of GoTrue's
 *      admin.auth.admin.deleteUser(). GoTrue's path returns
 *      "database error deleting user" in some environments and the
 *      actual FK cascade never runs. The SECURITY DEFINER function in
 *      supabase/migrations/add_account_hard_delete.sql performs the
 *      same delete directly, so when a constraint fails we see the
 *      real Postgres error instead of an opaque one.
 *
 * Community_places.owner_id and chats.created_by are ON DELETE SET
 * NULL in the schema, so the rows survive with a null pointer rather
 * than vanishing — that's the documented behaviour the user agreed to.
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

router.post("/delete", async (req: Request, res: Response) => {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase — ไม่สามารถลบบัญชีได้",
      code: "NOT_CONFIGURED",
      requestId: (req as any).requestId,
    });
  }

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
    const { data: verified, error: verifyErr } = await admin.auth.getUser(token);
    if (verifyErr || !verified?.user?.id) {
      return res.status(401).json({
        error: "โทเค็นไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
        code: "UNAUTHORIZED",
        requestId: (req as any).requestId,
      });
    }
    uid = verified.user.id;
  } catch (e: any) {
    return sendError(res, e, req, 401);
  }

  try {
    // ---- 2) Collect every storage path this user owns --------------
    //
    // Reads here are best-effort: we only need them to clean up
    // Storage before the cascade wipes the DB rows. If a query
    // fails (transient PostgREST hiccup, schema drift, RLS surprise)
    // we log it and keep going — admin.auth.deleteUser() does the
    // authoritative work and the user still disappears.
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

    const videoPaths = Array.from(videosByLocation.keys());
    const avatarPaths = Array.from(avatarsByLocation.keys());

    // Sweep the user's full folder in the `videos` bucket — covers
    // draft objects that never became a videos row.
    try {
      const orphanVideoPaths = await listAllPathsUnder("videos", uid);
      for (const path of orphanVideoPaths) {
        videoPaths.push(path);
      }
    } catch (e: any) {
      console.warn(`[account ${uid}] orphan video sweep failed:`, e?.message ?? e);
    }

    // Same for the `avatars` bucket — old avatars that the user
    // replaced via updateProfile get uploaded under `${uid}/...`
    // but only the most recent path is stored in users.avatar_url.
    try {
      const orphanAvatarPaths = await listAllPathsUnder("avatars", uid);
      for (const path of orphanAvatarPaths) {
        avatarPaths.push(path);
      }
    } catch (e: any) {
      console.warn(`[account ${uid}] orphan avatar sweep failed:`, e?.message ?? e);
    }

    // Dedupe — `videos/` and `avatars/` share no namespaces but be safe.
    const uniqueVideoPaths = Array.from(new Set(videoPaths));
    const uniqueAvatarPaths = Array.from(new Set(avatarPaths));

    // ---- 3) Storage remove (best-effort) ---------------------------
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
      const { error: rmErr } = await admin.storage.from("avatars").remove(uniqueAvatarPaths);
      if (rmErr) {
        console.warn(
          `[account] storage.remove avatars failed (${uniqueAvatarPaths.length} items):`,
          rmErr.message
        );
      }
    }

    // ---- 4) Cascade-delete via raw SQL RPC ----------------------------
    //
    // GoTrue's admin.auth.admin.deleteUser() returns a generic
    // "database error deleting user" in some Supabase environments
    // before the cascade ever runs. We call our own SECURITY DEFINER
    // RPC (supabase/migrations/add_account_hard_delete.sql) so the
    // real Postgres error surfaces when something is wrong.
    const { error: delErr } = await admin.rpc("account_hard_delete", {
      target_uid: uid,
    });
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
      return res.json({ ok: true, alreadyDeleted: true });
    }

    return res.json({ ok: true });
  } catch (e: any) {
    return sendError(res, e, req, 500);
  }
});

export default router;
