import { Router, Request, Response } from "express";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { requestId } from "../middleware/requestContext";
import { sendError } from "../middleware/errors";
import {
  loadFolderContext,
  FolderAccessError,
  folderPlaceSourceLabel,
} from "../folderContext";

/**
 * GET /folders/:folderId/context
 * -------------------------------------------------------------
 * คืน "บริบทโฟลเดอร์" = คลิปทั้งโฟลเดอร์ + รายชื่อสถานที่ที่โฟลเดอร์นี้ไป
 * (จับคู่กับทะเบียน `community_places` ก่อน ถ้าไม่เจอใช้ข้อความในคลิปแทน)
 *
 * เป็นที่เดียวที่คำนวณรายการสถานที่ → หน้าโฟลเดอร์ / แชท / แพลนทริป
 * ใช้ endpoint นี้เหมือนกันหมด (ไม่ให้แต่ละหน้าคำนวณเองแล้วต่างกันเงียบ ๆ)
 *
 * สิทธิ์: ต้องมี Bearer token → เจ้าของ / ผู้ร่วม / โฟลเดอร์สาธารณะ
 *   ไม่มี token → 401 · ไม่มีสิทธิ์ → 403 · ไม่พบโฟลเดอร์ → 404
 */
const router = Router();

router.get("/:folderId/context", async (req: Request, res: Response) => {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(503).json({
      error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Supabase",
      code: "NOT_CONFIGURED",
      requestId: requestId(req),
    });
  }

  const token = /^Bearer\s+(.+)$/i
    .exec(req.header("authorization") ?? "")?.[1]
    ?.trim();
  if (!token) {
    return res.status(401).json({
      error: "ต้องล็อกอินเพื่อดูข้อมูลโฟลเดอร์",
      code: "UNAUTHORIZED",
      requestId: requestId(req),
    });
  }

  let uid: string;
  try {
    const { data: verified, error: verifyErr } = await admin.auth.getUser(token);
    if (verifyErr || !verified?.user?.id) {
      return res.status(401).json({
        error: "โทเค็นไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
        code: "UNAUTHORIZED",
        requestId: requestId(req),
      });
    }
    uid = verified.user.id;
  } catch (e: any) {
    return sendError(res, e, req, 401);
  }

  const folderId = String(req.params.folderId ?? "").trim();
  if (!folderId) {
    return res.status(400).json({
      error: "ไม่ระบุรหัสโฟลเดอร์",
      code: "BAD_REQUEST",
      requestId: requestId(req),
    });
  }

  try {
    const ctx = await loadFolderContext(admin, folderId, uid);
    return res.json({
      folderId: ctx.folderId,
      folderName: ctx.folderName,
      clipCount: ctx.clipCount,
      clips: ctx.clips,
      places: ctx.places.map((p) => ({
        ...p,
        sourceLabel: folderPlaceSourceLabel(p),
      })),
      registryHits: ctx.registryHits,
      aiFallbacks: ctx.aiFallbacks,
      partial: ctx.partial,
    });
  } catch (e: any) {
    if (e instanceof FolderAccessError) {
      return res.status(e.status).json({
        error: e.message,
        code: e.code,
        requestId: requestId(req),
      });
    }
    return sendError(res, e, req, 500);
  }
});

export default router;
