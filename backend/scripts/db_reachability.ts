/**
 * ตรวจว่าโปรเจกต์ Supabase ยังเข้าถึงได้อยู่ไหม (ทางเส้นทางของแอปเอง)
 *
 * บริบท: ขั้น 0.5 อ่าน `users` ด้วย service-role key แล้วโดน "permission denied"
 * ทุกตาราง → ต้องแยกว่าเป็น (ก) โปรเจกต์/ชื่อตารางผิด หรือ (ข) คีย์ service-role
 * ตัวนี้ใช้ไม่ได้
 *
 * วิธีนี้ใช้ **anon key ของแอป** (EXPO_PUBLIC_* — อยู่ใน bundle ของแอปอยู่แล้ว
 * เป็นคีย์สาธารณะ) อ่านตารางสาธารณะ เหมือนที่แอปทำตอนรันจริง
 *
 * ไม่พิมพ์คีย์ ไม่พิมพ์แถวข้อมูล — เฉพาะจำนวนแถว + ข้อความ error
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/db_reachability.ts
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";

/**
 * Node 20 ยังไม่มี `globalThis.WebSocket` → ต้องส่ง `ws` เข้าไปเป็น transport
 * (ดูแบบเดียวกับที่ src/supabaseAdmin.ts ใช้)
 */
const transport = WebSocket as any;

/** อ่าน .env ของแอป (ไฟล์รากโปรเจกต์) แบบไม่พิมพ์ค่าออกมา */
function readAppEnv(): Record<string, string> {
  const file = path.resolve(__dirname, "../../.env");
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const ln of fs.readFileSync(file, "utf8").split("\n")) {
    const m = ln.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function main() {
  const env = readAppEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  console.log("════════ ความสามารถเข้าถึงของโปรเจกต์ (ทาง anon key ของแอป) ════════");
  if (!url || !anon) {
    console.log("ไม่พบ EXPO_PUBLIC_SUPABASE_URL / ANON_KEY ใน .env ของแอป");
    return;
  }
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport },
  });

  for (const table of ["users", "communities", "community_places", "places", "videos"]) {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
    if (error) console.log(`  ${table.padEnd(18)} ❌ ${error.message}`);
    else console.log(`  ${table.padEnd(18)} ✅ ${count ?? 0} แถว`);
  }

  // คอลัมน์ของ users ตอนนี้ (ชื่อคอลัมน์เท่านั้น)
  const { data: u, error: ue } = await sb.from("users").select("*").limit(1);
  if (!ue && u && u.length) {
    console.log(`\n  users.columns: ${Object.keys(u[0]).join(", ")}`);
  } else if (ue) {
    console.log(`\n  users: ${ue.message}`);
  }
}

main().catch((err) => {
  console.error("ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
