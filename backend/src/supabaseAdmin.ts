import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
import { config, isSupabaseConfigured } from "./config";

/**
 * ชนิดของ `transport` ที่ realtime-js รออยู่
 *
 * ดึงจากลายเซ็นของ `createClient` เอง เพื่อไม่ต้อง import ชนิดจาก
 * `@supabase/realtime-js` (แพ็กเกจที่มาแบบ transitive — ไม่ควรพึ่งมันตรง ๆ)
 */
type RealtimeTransport = NonNullable<
  NonNullable<Parameters<typeof createClient>[2]>["realtime"]
>["transport"];

/**
 * WebSocket สำหรับฝั่ง realtime ของ Supabase
 * -------------------------------------------------------------
 * `createClient()` สร้าง RealtimeClient ขึ้นมาทันทีที่ถูกเรียก และมัน
 * ต้องการ "ตัวสร้าง WebSocket" เสมอ — แต่ Node ยังไม่มี `globalThis.WebSocket`
 * จนถึง v22 (บน v20 มีให้ใช้แต่ต้องเปิด flag `--experimental-websocket`)
 * ถ้าไม่มี มันจะ **throw ตอนสร้าง client** เลย ซึ่งทำให้ทุก route ที่
 * แตะฐานข้อมูลพังทั้งเซิร์ฟเวอร์ ไม่ใช่แค่สคริปต์ที่รันบนเครื่อง
 *
 * ระบบเราไม่ได้ใช้ realtime เลย (ทุกอย่างเป็น REST) แต่ยังต้องส่งตัวไหน
 * ให้มัน เลยส่ง `ws` ซึ่งเป็น WebSocket สำหรับ Node โดยเฉพาะ
 *
 * ทางแก้ที่ถาวรกว่านี้คืออัปเกรดเป็น Node 22+ (แล้วบรรทัดนี้ไม่จำเป็น)
 */
const transport = WebSocket as unknown as RealtimeTransport;

/**
 * Supabase admin client (service_role) — SERVER ONLY.
 * The service_role key bypasses RLS so the backend can write AI summaries
 * into any user's video row. Never expose this key to the mobile app.
 *
 * Lazily created so the server still boots when Supabase isn't configured
 * (falls back to the in-memory store).
 */
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport },
  });
  return client;
}
