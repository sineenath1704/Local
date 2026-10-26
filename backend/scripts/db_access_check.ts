/**
 * ตรวจว่า service_role key ใช้ได้กับ PostgREST ไหม — ดู HTTP status ดิบ
 *
 * อาการ: ทุกตารางได้ "permission denied" แม้ role claim = service_role
 * และ SUPABASE_URL ชี้ project เดียวกับแอป → ต้องดู status ดิบว่า
 * 401 (token ใช้ไม่ได้) หรือ 403 (สิทธิ์ schema ไม่พอ) หรือ 404 (โค้ดผิด)
 *
 * ไม่พิมพ์ key ไม่พิมพ์ข้อมูลในแถว — เฉพาะ status + code + message
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/db_access_check.ts
 */

import { config } from "../src/config";

async function main() {
  const base = config.supabase.url.replace(/\/$/, "");
  const key = config.supabase.serviceRoleKey;

  console.log("════════ raw PostgREST / auth status ════════");
  console.log(`key format: ${key.startsWith("sb_secret_") ? "sb_secret_* (ใหม่)" : key.startsWith("eyJ") ? "JWT (เก่า)" : "อื่น ๆ"}`);

  // 1) PostgREST — เลือกคอลัมน์คงที่ + limit=0 เพื่อไม่ให้มีแถวกลับมา
  const restUrl = `${base}/rest/v1/users?select=role&limit=0`;
  try {
    const resp = await fetch(restUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const text = await resp.text();
    console.log(`\n[PostgREST] GET /rest/v1/users?select=role&limit=0`);
    console.log(`  HTTP ${resp.status} ${resp.statusText}`);
    console.log(`  body: ${text.slice(0, 400)}`);
  } catch (err: any) {
    console.log(`  error: ${err?.message ?? err}`);
  }

  // 2) Auth server — ใช้ key เป็น bearer ดูว่า token นี้ผ่านการตรวจสอบไหม
  try {
    const resp = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const text = await resp.text();
    console.log(`\n[Auth] GET /auth/v1/user`);
    console.log(`  HTTP ${resp.status} ${resp.statusText}`);
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      console.log(`  body: ${text.slice(0, 300)}`);
    }
    if (body) {
      // พิมพ์เฉพาะสรุป ไม่พิมพ์ id/email
      console.log(
        `  keys: ${Object.keys(body).join(", ")}` +
          (body.id ? ` · (มี id · ${body.id})` : "") +
          (body.email ? ` · (มี email)` : "") +
          (body.msg ? ` · msg=${body.msg}` : "") +
          (body.error_code ? ` · error_code=${body.error_code}` : "")
      );
    }
  } catch (err: any) {
    console.log(`  error: ${err?.message ?? err}`);
  }

  // 3) PostgREST root — ดูว่า service ให้บริการอยู่ไหม
  try {
    const resp = await fetch(`${base}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    console.log(`\n[PostgREST] GET /rest/v1/ → HTTP ${resp.status}`);
  } catch (err: any) {
    console.log(`  error: ${err?.message ?? err}`);
  }
}

main().catch((err) => {
  console.error("ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
