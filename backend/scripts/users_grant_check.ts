/**
 * ตรวจสิทธิ์ (GRANT) ระดับตารางของ public.users — ดูว่า role ไหน "แตะ" ตารางนี้ได้
 *
 * อาการที่เจอ (หน้าลงทะเบียน):
 *   บันทึกไม่สำเร็จ → "permission denied for table users"  (Postgres 42501)
 *
 * ข้อสังเกตสำคัญ: 42501 รูปนี้ = "ไม่มี GRANT" ไม่ใช่ RLS
 *   • ไม่มี GRANT          → 403 "permission denied for table <ชื่อ>"
 *   • RLS ไม่ให้ผ่าน       → 403 "new row violates row-level security policy"
 *   → RLS policy ที่เขียนไว้ถูกต้องก็ช่วยไม่ได้ ถ้าไม่มี GRANT ก่อน
 *
 * วิธีวัด (ไม่แตะข้อมูลจริงเลย):
 *   • GET  /rest/v1/users?select=id&limit=0   → ทดสอบสิทธิ์ SELECT
 *   • PATCH /rest/v1/users?id=eq.0000...0000   → ทดสอบสิทธิ์ UPDATE
 *     (เป้า id ที่ไม่มีอยู่จริง → ถ้ามีสิทธิ์จะได้ 200 กับ [] แถว · ถ้าไม่มีจะได้ 403)
 *   • GET  /rest/v1/                          → PostgREST ซ่อนตารางที่ role แตะไม่ได้
 *     (เช็คว่า "users" อยู่ในรายการของ role นั้นไหม)
 *
 * ไม่พิมพ์ key · ไม่พิมพ์ข้อมูลในแถว (ใช้ limit=0 / select=id เท่านั้น)
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/users_grant_check.ts
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config();
// ไฟล์ .env ของแอปอยู่ที่รากโปรเจกต์ (มี EXPO_PUBLIC_SUPABASE_ANON_KEY)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const PROBE_UUID = "00000000-0000-0000-0000-000000000000";

type KeyKind = "anon" | "service_role";

function headersFor(kind: KeyKind): Record<string, string> {
  const key = kind === "anon" ? ANON_KEY : SERVICE_ROLE;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rest(
  kind: KeyKind,
  pathAndQuery: string,
  init: RequestInit = {}
): Promise<{ status: number; body: string }> {
  const resp = await fetch(`${BASE}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...headersFor(kind), ...(init.headers as Record<string, string>) },
  });
  const body = await resp.text();
  return { status: resp.status, body: body.slice(0, 300) };
}

/** ย่อข้อความ error ให้สั้น — ไม่ต้องเห็นทั้งหมด */
function summarize(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const code = parsed.code ? ` [${parsed.code}]` : "";
      const msg = parsed.message ?? parsed.error ?? parsed.hint ?? "";
      return `${code} ${msg}`.trim() || "(ว่าง)";
    }
  } catch {
    /* ไม่ใช่ JSON → คืนค่าดิบ */
  }
  return body || "(ว่าง)";
}

async function checkTablesVisible(kind: KeyKind) {
  const { status, body } = await rest(kind, "");
  console.log(`\n── GET /rest/v1/ (${kind}) → HTTP ${status}`);
  if (status !== 200) {
    console.log(`   body: ${summarize(body)}`);
    return;
  }
  try {
    const spec = JSON.parse(body);
    const defs = spec?.definitions ?? {};
    const names = Object.keys(defs)
      .map((k) => k.replace(/^\//, ""))
      .filter((n) => !n.includes("/"));
    const interesting = names.filter((n) =>
      ["users", "communities", "community_places", "videos", "places", "folders"].includes(n)
    );
    console.log(`   ตารางที่ role นี้ "แตะ" ได้: ${names.length} ตาราง`);
    console.log(`   ตรงกับที่เช็ค: ${interesting.length ? interesting.join(", ") : "(ไม่มีของที่เช็คเลย)"}`);
  } catch {
    console.log(`   body: ${body.slice(0, 200)}`);
  }
}

async function main() {
  if (!BASE || !SERVICE_ROLE || !ANON_KEY) {
    console.log("ขาด env: ต้องมี SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + EXPO_PUBLIC_SUPABASE_ANON_KEY");
    return;
  }

  console.log("════════ public.users — สิทธิ์ระดับตาราง ════════");

  for (const kind of ["anon", "service_role"] as KeyKind[]) {
    const get = await rest(kind, "users?select=id&limit=0");
    console.log(`\n[${kind}] GET /rest/v1/users?select=id&limit=0 → HTTP ${get.status}`);
    console.log(`   ${summarize(get.body)}`);

    const patch = await rest(kind, `users?id=eq.${PROBE_UUID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "__grant_probe__" }),
    });
    console.log(`[${kind}] PATCH /rest/v1/users?id=eq.0000… → HTTP ${patch.status}`);
    console.log(`   ${summarize(patch.body)}`);

    await checkTablesVisible(kind);
  }

  console.log("\n════════ สรุป ════════");
  console.log("HTTP 200 = มีสิทธิ์ระดับตาราง (ถ้าไม่มี → 403 permission denied)");
  console.log("HTTP 403 + 'permission denied for table users' = ไม่มี GRANT → ต้อง GRANT");
  console.log("HTTP 403 + 'row-level security' = มี GRANT แต่ policy ไม่ให้ผ่าน");
}

main().catch((err) => {
  console.error("ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
