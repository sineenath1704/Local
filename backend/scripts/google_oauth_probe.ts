/**
 * ตรวจ OAuth client ของ Google ที่ Supabase ใช้ (สำหรับ Google Sign-In)
 * -------------------------------------------------------------
 * อาการที่เจอ:
 *   • ขั้น authorize ผ่าน (Google ขึ้นหน้าให้เลือกบัญชี/ยืนยัน → กลับมาถึงแอป)
 *   • แต่ขั้นแลก token ล้ม → แอปขึ้น "Unable to exchange external code: 4/0A"
 *
 * ข้อความนั้นหลอก (โกหกไปนิด): "4/0A" ไม่ใช่ error ของ Google
 * แต่คือ **4 ตัวแรกของ authorization code** ที่ GoTrue ตัดไว้ในข้อความ
 * (ดูโค้ด: supabase/auth → internal/api/external_oauth.go
 *   → apierrors.NewInternalServerError("Unable to exchange external code: %s",
 *      oauthCode[:min(4, len(oauthCode))]))
 * → error จริงจาก Google ถูกซ่อนไว้ใน internal log ของ GoTrue
 *
 * สคริปต์นี้แยกให้ว่าปัญหาอยู่ฝั่งไหน โดยไม่ต้องล็อกอินจริง:
 *   ขั้น 1 — authorize : ยิง URL ของ Google ด้วย client id + redirect_uri
 *            200/302 = client id ถูก และ redirect_uri ลงทะเบียนไว้แล้ว
 *            400      = client id ผิด หรือ redirect_uri ไม่ได้ลงทะเบียน
 *   ขั้น 2 — token    : ส่ง code ปลอมไปขอ token
 *            invalid_client → Client ID + Client Secret ไม่ตรงกัน  ← แก้ secret
 *            invalid_grant  → คู่ credential ถูกแล้ว ปัญหาอยู่ที่ตัว code/flow
 *
 * วิธีใช้
 *   1) เพิ่ม 3 บรรทัดนี้ใน backend/.env (ไฟล์อยู่ใน .gitignore แล้ว):
 *        GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
 *        GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxx
 *        GOOGLE_OAUTH_REDIRECT_URI=https://<project-ref>.supabase.co/auth/v1/callback
 *   2) รัน:  cd backend && npm run probe:google-oauth
 *
 * ค่า secret ถูกอ่านจากไฟล์ตอนรันเท่านั้น ไม่ต้องพิมพ์ในคำสั่ง
 * และสคริปต์นี้ยิงเฉพาะ accounts.google.com กับ oauth2.googleapis.com
 */
import { config as loadEnv } from "dotenv";
import * as path from "path";

loadEnv({ path: path.resolve(__dirname, "../.env") });

const rawId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
const rawSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
const rawRedirect = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "";

const clientId = rawId.trim();
const clientSecret = rawSecret.trim();
const redirectUri = rawRedirect.trim();

function fingerprint(v: string): string {
  if (!v) return "(ว่าง)";
  // ไม่แสดงตัวอักษรใดๆ ของ secret ออกมา (แค่บอกความยาว + prefix ที่เป็นค่าคงที่สาธารณะ)
  const prefixOk = v.startsWith("GOCSPX-") ? "prefix GOCSPX- ถูกต้อง" : "prefix ไม่ใช่ GOCSPX- (ตรวจว่าคัดลอกมาครบไหม)";
  return `(ยาว ${v.length}, ${prefixOk})`;
}

function hasStrayWhitespace(raw: string): boolean {
  return raw !== raw.trim();
}

async function probeAuthorize(): Promise<void> {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", `probe-${Date.now()}`);

  console.log("\n=== ขั้น 1: authorize (เช็ค Client ID + redirect_uri) ===");
  const res = await fetch(url.toString(), { redirect: "manual" });
  const body = await res.text();
  const loc = res.headers.get("location") ?? "";

  console.log("HTTP", res.status);
  if (res.status === 302 || res.status === 303 || res.status === 200) {
    const target = loc.slice(0, 120);
    console.log("✓ ผ่าน — Google รับ client id + redirect_uri (ตอบกลับไปที่:", target || "หน้า sign-in", ")");
    if (/accounts\.google\.com\/signin/i.test(loc)) {
      console.log("  (หน้าเลือกบัญชีจะเปิดต่อได้ = redirect_uri ลงทะเบียนถูกต้อง)");
    }
    return;
  }

  console.log("✗ ไม่ผ่าน — Google ปฏิเสธคำขอนี้");
  const markers = [
    "redirect_uri_mismatch",
    "invalid_client",
    "invalid_request",
    "unauthorized_client",
    "The OAuth client was not found",
    "Access blocked",
  ];
  for (const m of markers) {
    if (body.includes(m)) console.log(`  พบ: ${m}`);
  }
  const snippet = body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  console.log("  ข้อความ:", snippet);
}

async function probeToken(): Promise<void> {
  console.log("\n=== ขั้น 2: token (เช็ค Client Secret) ===");
  console.log("client_id :", clientId || "(ว่าง)");
  console.log("secret    :", fingerprint(clientSecret));
  console.log("redirect  :", redirectUri || "(ว่าง)");

  if (!clientId || !clientSecret || !redirectUri) {
    console.log("\n✗ ข้อมูลไม่ครบ — ใส่ GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REDIRECT_URI ใน backend/.env");
    return;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "probe-invalid-code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });
  const body = await res.text();

  console.log("\nHTTP", res.status);
  console.log("ตอบกลับ:", body.slice(0, 400));

  if (/invalid_client/i.test(body)) {
    console.log(
      "\n✗ Client ID + Client Secret ไม่ตรงกัน (หรือ secret ผิด/ว่าง)\n" +
        "  → แก้ที่ Google Cloud Console → Credentials → client ตัวเดียวกัน\n" +
        "    copy Client ID + Client Secret ใหม่ → วางลง Supabase → Authentication → Providers → Google"
    );
  } else if (/invalid_grant/i.test(body)) {
    console.log(
      "\n✓ Client ID + Client Secret ถูกต้องแล้ว (Google รับคู่ credential)\n" +
        "  → ปัญหาอยู่ที่ authorization code / flow ไม่ใช่ที่ secret\n" +
        "    (เช่น code ถูกใช้ไปแล้ว หรือ state ไม่ตรง)"
    );
  } else if (res.ok) {
    console.log("\n? ได้ token (แปลว่า code ปลอมผ่าน?) — แปลว่า probe ต้องทบทวน");
  } else {
    console.log("\n? ไม่รู้จัก error นี้ — ดูข้อความข้างบน");
  }
}

async function main() {
  console.log("=== ตรวจ OAuth client ของ Google (สำหรับ Supabase) ===");
  if (!clientId || !clientSecret) {
    console.log(
      "\nยังไม่ได้ตั้งค่า — เพิ่มใน backend/.env:\n" +
        "  GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com\n" +
        "  GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxx\n" +
        "  GOOGLE_OAUTH_REDIRECT_URI=https://<project-ref>.supabase.co/auth/v1/callback"
    );
    return;
  }

  if (hasStrayWhitespace(rawSecret) || hasStrayWhitespace(rawId) || hasStrayWhitespace(rawRedirect)) {
    console.log(
      "\n⚠ ค่าในไฟล์มีช่องว่างหรือขึ้นบรรทัดท้าย/หัว (ตัดออกให้แล้วก่อนใช้)\n" +
        "  → ถ้า copy ไปวางใน Supabase แบบไม่ตัด จะทำให้ secret ใช้ไม่ได้"
    );
  }

  await probeAuthorize();
  await probeToken();
}

main().catch((e) => {
  console.error("probe ล้มเหลว:", e?.message ?? e);
  process.exit(1);
});
