/**
 * ตรวจสภาพจริงของ "โฟลเดอร์คลิป → รายชื่อสถานที่" — ใช้ service_role อ่านอย่างเดียว
 * ---------------------------------------------------------------------------
 * รันก่อน/หลังเฟส 1 เพื่อดูว่า:
 *   1. ตาราง `folders` / `folder_items` / `folder_collaborators` / `trip_plans`
 *      มีอยู่จริงไหม (มีแค่ใน schema.sql แต่ไม่มี migration → อาจยังไม่มี)
 *   2. ตารางไหนถูก grant ให้ service_role แล้ว (ไม่ grant = 42501 = ฟีเจอร์ตายเงียบ)
 *   3. คอลัมน์ที่โค้ดอ่านมีจริงไหม (เช่น `videos.place_name` — ไม่มีใน schema.sql
 *      แต่แอปเขียนจริง)
 *   4. คลิปในโฟลเดอร์มี `ai_summary` พร้อม `place` กี่คลิป (ตัดสินใจ cap จากตัวเลขนี้)
 *   5. ทะเบียน `community_places` มีกี่แถว (ถ้าน้อย → คลิปส่วนใหญ่จะตกไปทาง "จากคลิป")
 *
 * ใช้
 *   cd backend
 *   npm run check:folder                       # ตรวจภาพรวม
 *   npm run check:folder -- "<folderId>"       # + พิมพ์สถานที่ที่ resolve ได้ของโฟลเดอร์นั้น
 *
 * ⚠️ ไม่พิมพ์คีย์ ไม่แก้ฐานข้อมูล — read-only ทั้งหมด
 */

import { config, isSupabaseConfigured } from "../src/config";
import { getSupabaseAdmin } from "../src/supabaseAdmin";
import { loadFolderContext, folderPlaceSourceLabel } from "../src/folderContext";

const TABLES = [
  "folders",
  "folder_items",
  "folder_collaborators",
  "trip_plans",
  "community_places",
  "communities",
  "videos",
] as const;

type TableName = (typeof TABLES)[number];

function line(char = "─", n = 60) {
  return char.repeat(n);
}

function section(title: string) {
  console.log(`\n${line()}`);
  console.log(title);
  console.log(line());
}

/** ดึงรายชื่อคอลัมน์จาก OpenAPI ของ PostgREST (ตาราง/คอลัมน์ที่ DB มีจริง)
 *  คืน `ok:false` ถ้าอ่าน schema ไม่สำเร็จ — เพราะตอนนั้น "ไม่เห็นคอลัมน์"
 *  แปลว่าอ่านไม่ได้ ไม่ใช่ "ตารางไม่มี" (สองเรื่องคนละเรื่อง) */
async function fetchSchemaColumns(): Promise<{
  columns: Record<string, string[]>;
  ok: boolean;
}> {
  const base = config.supabase.url.replace(/\/$/, "");
  const key = config.supabase.serviceRoleKey;
  const out: Record<string, string[]> = {};
  try {
    const resp = await fetch(`${base}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) {
      console.log(`  (อ่าน schema จาก PostgREST ไม่สำเร็จ: HTTP ${resp.status})`);
      return { columns: out, ok: false };
    }
    const spec: any = await resp.json();
    for (const table of TABLES) {
      const def = spec?.definitions?.[table];
      if (!def?.properties) continue;
      out[table] = Object.keys(def.properties);
    }
    return { columns: out, ok: true };
  } catch (e: any) {
    console.log(`  (อ่าน schema จาก PostgREST ไม่สำเร็จ: ${e?.message ?? e})`);
    return { columns: out, ok: false };
  }
}

/** ยิง select เพื่อดูว่า service_role เข้าถึงตารางได้ไหม */
async function probeAccess(
  admin: any,
  table: TableName
): Promise<{ ok: boolean; code?: string; message?: string; count?: number }> {
  const { data, error, count } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .limit(1);
  if (error) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: true, count: count ?? (Array.isArray(data) ? data.length : undefined) };
}

async function main() {
  const folderArg = process.argv[2]?.trim();

  console.log("════════ ตรวจสภาพ: โฟลเดอร์คลิป → รายชื่อสถานที่ ════════");
  console.log(`supabase url: ${config.supabase.url}`);
  console.log(`service key : ${config.supabase.serviceRoleKey ? "มี (ไม่พิมพ์ค่า)" : "ไม่มี"}`);

  if (!isSupabaseConfigured()) {
    console.log("\n❌ ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน backend/.env");
    process.exit(1);
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    console.log("\n❌ สร้าง Supabase admin client ไม่ได้");
    process.exit(1);
  }

  // ── 1. ตาราง + grant ────────────────────────────────────────
  section("1) ตารางและสิทธิ์ (service_role)");
  const schema = await fetchSchemaColumns();
  const schemaColumns = schema.columns;
  const missingTables: string[] = [];
  const noAccessTables: string[] = [];
  for (const table of TABLES) {
    const access = await probeAccess(admin, table);
    const cols = schemaColumns[table];
    const mark = access.ok ? "✅" : "❌";
    const extra = access.ok
      ? `แถว ≈ ${access.count ?? "?"}`
      : `${access.code ?? "?"} ${access.message ?? ""}`;
    console.log(
      `${mark} ${table.padEnd(24)} ${extra}${cols ? ` · คอลัมน์ ${cols.length}` : " · (อ่าน schema ไม่ได้)"}`
    );
    if (!access.ok) noAccessTables.push(table);
    if (!cols) missingTables.push(table);
  }

  // ถ้าตารางของโฟลเดอร์หายไป → บอกวิธีแก้ให้จบในคำสั่งเดียว
  // (ข้ามการเดาเมื่ออ่าน schema ไม่สำเร็จ — จะไม่มีตารางไหนขึ้นมาเลย)
  const FOLDER_TABLES = ["folders", "folder_items", "folder_collaborators", "trip_plans"];
  const missingFolderTables = schema.ok
    ? FOLDER_TABLES.filter((t) => missingTables.includes(t))
    : [];
  const deniedFolderTables = schema.ok
    ? FOLDER_TABLES.filter(
        (t) => !missingTables.includes(t) && noAccessTables.includes(t)
      )
    : [];
  if (missingFolderTables.length) {
    console.log(
      `\n❌ ยังไม่มีตาราง: ${missingFolderTables.join(", ")}`
    );
    console.log("   → รันไฟล์นี้ใน Supabase SQL Editor (รันซ้ำได้):");
    console.log("     supabase/migrations/add_folders.sql");
  } else if (deniedFolderTables.length) {
    console.log(
      `\n❌ service_role เข้าถึงไม่ได้: ${deniedFolderTables.join(", ")} (ตารางมีแต่ไม่มี grant)`
    );
    console.log("   → รัน supabase/migrations/add_folders.sql ใน Supabase SQL Editor อีกครั้ง");
  }

  // ── 2. คอลัมน์สำคัญ ─────────────────────────────────────────
  section("2) คอลัมน์ที่โค้ดอ่าน");
  const REQUIRED: Record<string, string[]> = {
    folders: ["id", "name", "owner_id", "is_public"],
    folder_items: ["video_id", "folder_id"],
    folder_collaborators: ["folder_id", "user_id"],
    videos: ["id", "caption", "hashtags", "ai_summary", "location_name", "province", "latitude", "longitude"],
    community_places: ["id", "place_name", "province", "latitude", "longitude"],
    trip_plans: ["id", "creator_id", "source_folder_id", "plan_name", "start_location", "itinerary_data", "status"],
  };
  for (const [table, wanted] of Object.entries(REQUIRED)) {
    const have = schemaColumns[table];
    if (!have) {
      console.log(`⚠️  ${table}: อ่านรายชื่อคอลัมน์ไม่ได้ (ตารางอาจไม่มี) — ข้ามการเช็ค`);
      continue;
    }
    const missing = wanted.filter((c) => !have.includes(c));
    console.log(
      `${missing.length === 0 ? "✅" : "❌"} ${table}: ${missing.length === 0 ? "ครบ" : `ขาด ${missing.join(", ")}`}`
    );
  }
  console.log(
    `ℹ️  videos.place_name — ${schemaColumns["videos"]?.includes("place_name") ? "มี (โค้ดจะอ่านได้)" : "ไม่มี (โค้ดถอยไปอ่านชุดพื้นฐาน)"}`
  );

  // ── 3. ข้อมูลจริง ───────────────────────────────────────────
  section("3) ข้อมูลจริง");
  const { count: folderCount } = await admin
    .from("folders")
    .select("*", { count: "exact", head: true });
  const { count: registryCount } = await admin
    .from("community_places")
    .select("*", { count: "exact", head: true });
  const { count: planCount } = await admin
    .from("trip_plans")
    .select("*", { count: "exact", head: true });
  console.log(`โฟลเดอร์ทั้งหมด      : ${folderCount ?? "?"}`);
  console.log(`แถวในทะเบียนสถานที่ : ${registryCount ?? "?"}`);
  console.log(`แผนทริปที่บันทึกไว้  : ${planCount ?? "?"}`);

  // หาโฟลเดอร์ที่มีคลิปจริง เพื่อดูว่า ai_summary พร้อมใช้ไหม
  const { data: someFolder } = await admin
    .from("folders")
    .select("id, name")
    .order("created_at", { ascending: false })
    .limit(10);
  const folders = (someFolder ?? []) as any[];

  if (folders.length) {
    const { data: items } = await admin
      .from("folder_items")
      .select("video_id, folder_id")
      .in("folder_id", folders.map((f) => f.id))
      .limit(200);
    const videoIds = [...new Set((items ?? []).map((i: any) => i.video_id).filter(Boolean))];
    console.log(`\nโฟลเดอร์ล่าสุด ${folders.length} อัน รวม ${videoIds.length} คลิป`);

    if (videoIds.length) {
      const { data: vids } = await admin
        .from("videos")
        .select("id, ai_summary, place_name, location_name, province")
        .in("id", videoIds)
        .limit(200);
      const rows = (vids ?? []) as any[];
      const withSummary = rows.filter((r) => r.ai_summary && typeof r.ai_summary === "object");
      const withPlace = withSummary.filter((r) => r.ai_summary?.place);
      const withPlaceName = rows.filter((r) => r.place_name);
      const withLocation = rows.filter((r) => r.location_name);
      console.log(`  คลิปที่อ่านได้            : ${rows.length}`);
      console.log(`  มี ai_summary             : ${withSummary.length}`);
      console.log(`  มี ai_summary.place       : ${withPlace.length}  ← ใช้ได้จริง`);
      console.log(`  มี videos.place_name      : ${withPlaceName.length}`);
      console.log(`  มี videos.location_name   : ${withLocation.length}`);
      console.log(
        `  → สรุปได้ว่ารายชื่อสถานที่จะมาจาก "ข้อความในคลิป" ได้ประมาณ ${withPlace.length} คลิป`
      );
    } else {
      console.log("  (ยังไม่มีคลิปในโฟลเดอร์ใด ๆ — ยังพิสูจน์อะไรไม่ได้)");
    }
  } else {
    console.log("(ยังไม่มีโฟลเดอร์ในระบบ)");
  }

  // ── 4. พิมพ์สถานที่ที่ resolve ได้ ───────────────────────────
  if (folderArg) {
    section(`4) รายชื่อสถานที่ของโฟลเดอร์ ${folderArg}`);
    const { data: f } = await admin
      .from("folders")
      .select("id, name, owner_id")
      .eq("id", folderArg)
      .maybeSingle();
    if (!f) {
      console.log("❌ ไม่พบโฟลเดอร์นี้");
    } else {
      // ใช้ owner_id เป็น uid (สคริปต์นี้ใช้ service_role อ่านอย่างเดียวอยู่แล้ว)
      const ctx = await loadFolderContext(admin, folderArg, String(f.owner_id ?? ""));
      console.log(
        `โฟลเดอร์: ${ctx.folderName} (${ctx.clipCount} คลิป → ${ctx.places.length} สถานที่: ยืนยันในทะเบียน ${ctx.registryHits} / จากคลิป ${ctx.aiFallbacks})`
      );
      ctx.places.forEach((p, i) => {
        const bits: string[] = [`${p.clipCount} คลิป`];
        if (p.communityName) bits.push(`ชุมชน: ${p.communityName}`);
        if (p.address) bits.push(`ที่อยู่: ${p.address}`);
        if (p.facts.price) bits.push(`ราคา: ${p.facts.price}`);
        if (p.facts.openingHours) bits.push(`เปิด: ${p.facts.openingHours}`);
        if (p.facts.phone) bits.push(`โทร: ${p.facts.phone}`);
        console.log(`${i + 1}. ${p.name} — ${folderPlaceSourceLabel(p)} — ${bits.join(" — ")}`);
      });
      if (!ctx.places.length) {
        console.log("   (ยังไม่มีข้อมูลสถานที่ในโฟลเดอร์นี้)");
      }
      if (ctx.partial) {
        console.log("   ⚠️ ข้อมูลบางส่วนอ่านไม่ครบ (partial = true)");
      }
    }
  }

  console.log(`\n${line("═")}`);
  console.log("เสร็จแล้ว");
}

main().catch((e: any) => {
  console.error("\n❌ ตรวจไม่สำเร็จ:", e?.message ?? e);
  process.exit(1);
});
