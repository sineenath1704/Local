/**
 * Phase 0 probe — เตรียมข้อมูลก่อนลงมือแก้โค้ด
 * ---------------------------------------------------------------------------
 * ตาม PLAN_PLACE_MATCHING.md ขั้น 0.1 / 0.5 / 0.7 — ทุกอย่างในไฟล์นี้เป็น
 * **read-only**: อ่านอย่างเดียว ไม่เขียนฐานข้อมูล ไม่แก้ไฟล์ข้อมูล
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/phase0_probe.ts
 *
 * ส่วน 1 — Google Places สด (ขั้น 0.1)
 *   ยิง Places (New) และ Legacy textsearch จริง แล้วรายงาน **status ดิบ**
 *   เพราะบั๊ก 2.6.2: Google ตอบ HTTP 200 + body `status: "REQUEST_DENIED"`
 *   เมื่อบิลลิ่มปิด → โค้ดเดิมเลยคืน [] โดยไม่มี error (ดู places.ts:255)
 *
 * ส่วน 2 — สถานะฐานข้อมูล (ขั้น 0.5 + เตรียม backfill)
 *   นับ host ที่มี/ไม่มี otop_village_id และดูสถานะตารางที่แผนจะแตะ
 *
 * ส่วน 3 — ค้นจริงที่ระดับตำบลของหมู่บ้าน OTOP (ขั้น 0.7)
 *   ยิง query แบบ scoped ตาม §2.2.2 แล้วดูว่า
 *   (ก) มี candidate กลับมาไหม
 *   (ข) ชื่อหมู่บ้านโผล่ในที่อยู่ไหม (ชั้นที่ 1 ของการกรอง)
 *
 * หมายเหตุเรื่องคีย์: ไฟล์นี้อ่าน `GOOGLE_PLACES_API_KEY` จาก backend/.env
 * ผ่าน `src/config.ts` เหมือนโค้ดจริง — ไม่มีการเอาคีย์มาใส่บรรทัดคำสั่ง
 */

import { config, isPlacesConfigured, isSupabaseConfigured } from "../src/config";
import { getSupabaseAdmin } from "../src/supabaseAdmin";
import {
  PlaceItem,
  isTooShortToMatch,
  loadHierarchy,
  parseSubdistrict,
  villageSearchKey,
} from "./lib/hierarchy";

// ─────────────────────────────────────────────
//  ส่วน 1 — Google Places สด (ขั้น 0.1)
// ─────────────────────────────────────────────

async function probePlacesNew(query: string): Promise<void> {
  console.log(`\n[Places (New)] v1/places:searchText`);
  console.log(`  query: ${query}`);
  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.places.googleKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "th",
        regionCode: "TH",
        maxResultCount: 5,
      }),
    });
    console.log(`  HTTP ${resp.status}`);
    const text = await resp.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      console.log(`  body: ${text.slice(0, 300)}`);
      return;
    }
    if (body?.error) {
      console.log(`  error.status: ${body.error.status}`);
      console.log(`  error.message: ${body.error.message}`);
      console.log(`  → ใช้เส้นทางนี้ไม่ได้ (ถ้าเป็น SERVICE_BLOCKED = ยังไม่ได้เปิด Places (New))`);
      return;
    }
    const places = body?.places ?? [];
    console.log(`  candidates: ${places.length}`);
    for (const p of places.slice(0, 5)) {
      console.log(`   - ${p?.displayName?.text} · ${p?.formattedAddress}`);
    }
  } catch (err: any) {
    console.log(`  error: ${err?.message ?? err}`);
  }
}

async function probeLegacy(query: string): Promise<any[]> {
  console.log(`\n[Legacy] maps textsearch/json`);
  console.log(`  query: ${query}`);
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query
    )}&language=th&region=th&key=${config.places.googleKey}`;
    const resp = await fetch(url);
    console.log(`  HTTP ${resp.status}`);
    const data: any = await resp.json();
    console.log(`  status: ${data?.status}`);
    if (data?.error_message) console.log(`  error_message: ${data.error_message}`);
    const results = data?.results ?? [];
    console.log(`  results: ${results.length}`);
    for (const r of results.slice(0, 5)) {
      console.log(`   - ${r?.name} · ${r?.formatted_address}`);
    }
    return results;
  } catch (err: any) {
    console.log(`  error: ${err?.message ?? err}`);
    return [];
  }
}

// ─────────────────────────────────────────────
//  ส่วน 3 — ค้น scoped ระดับตำบล (ขั้น 0.7)
// ─────────────────────────────────────────────

/**
 * ค้นแบบ scoped ตาม §2.2.2 แล้วรายงานระดับการจับคู่ของแต่ละ candidate
 * คืนระดับ: village | subdistrict | district
 */
export function classifyMatch(
  candidate: { name?: string; address?: string; subdistrict?: string | null; district?: string | null },
  scope: { subdistrict: string; district: string; villageKey: string }
): "village" | "subdistrict" | "district" {
  const norm = (s: string) => (s ?? "").replace(/[\s.,-]+/g, "").trim();
  const haystack = norm(`${candidate.name ?? ""} ${candidate.address ?? ""}`);
  if (
    scope.villageKey.length >= 5 &&
    haystack.includes(norm(scope.villageKey))
  ) {
    return "village";
  }
  if (
    scope.subdistrict &&
    norm(candidate.subdistrict ?? "") === norm(scope.subdistrict)
  ) {
    return "subdistrict";
  }
  if (scope.district && norm(candidate.district ?? "") === norm(scope.district)) {
    return "district";
  }
  return "district";
}

async function probeScoped(place: PlaceItem): Promise<void> {
  const subdistrict = parseSubdistrict(place.subdistrict);
  // เลขหมู่คือส่วนหลังจุลภาค เช่น "ต.สุเทพ, หมู่ 11" → "หมู่ 11"
  const villageNo = place.subdistrict.split(",").slice(1).join(", ").trim() || null;
  const villageKey = villageSearchKey(place.name);
  console.log(`\n──────── ${place.name}`);
  console.log(`  ตำบล: ${subdistrict}   อำเภอ: ${place.districtName}   จังหวัด: ${place.provinceName}`);
  console.log(`  หมู่: ${villageNo ?? "-"}   (คำค้นชื่อหมู่บ้าน: "${villageKey}")`);
  if (isTooShortToMatch(place.name)) {
    console.log(`  ⚠️ ชื่อหมู่บ้านสั้นเกินไป → ข้ามชั้นที่ 1 (จะ match ทั้งจังหวัด)`);
  }

  const query = `${place.name} ${subdistrict} ${place.districtName} ${place.provinceName} ประเทศไทย`;
  const results = await probeLegacy(query);
  if (results.length === 0) {
    console.log("  → ไม่มี candidate เลย");
    return;
  }

  const counts: Record<string, number> = { village: 0, subdistrict: 0, district: 0 };
  for (const r of results) {
    const addr = r?.formatted_address ?? "";
    const sub = addr.match(/(?:ตำบล|ต\.|แขวง)\s*([^\s,]+)/);
    const dist = addr.match(/(?:อำเภอ|อ\.|เขต)\s*([^\s,]+)/);
    const level = classifyMatch(
      {
        name: r?.name,
        address: addr,
        subdistrict: sub ? sub[1] : null,
        district: dist ? dist[1] : null,
      },
      { subdistrict, district: place.districtName, villageKey }
    );
    counts[level] = (counts[level] ?? 0) + 1;
    console.log(`   [${level}] ${r?.name}`);
    console.log(`        ${addr}`);
  }
  console.log(
    `  → สรุป: village=${counts.village} subdistrict=${counts.subdistrict} district=${counts.district}`
  );
}

// ─────────────────────────────────────────────
//  ส่วน 2 — สถานะฐานข้อมูล (ขั้น 0.5)
// ─────────────────────────────────────────────

async function probeDb(): Promise<void> {
  console.log("\n[Supabase] สถานะฐานข้อมูล (รายงานเป็นยอดรวมเท่านั้น — ไม่พิมพ์ id/ชื่อ/ที่อยู่ของผู้ใช้)");
  if (!isSupabaseConfigured()) {
    console.log("  ⚠️ ไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — ข้าม");
    return;
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    console.log("  ⚠️ สร้าง client ไม่ได้ — ข้าม");
    return;
  }

  // users ตาม role
  const { data: byRole, error: e1 } = await sb
    .from("users")
    .select("role")
    .limit(10000);
  if (e1) {
    console.log(`  ❌ อ่าน users ไม่ได้: ${e1.message}`);
    return;
  }
  const roleCount: Record<string, number> = {};
  for (const u of byRole ?? []) {
    const r = (u as any).role ?? "(null)";
    roleCount[r] = (roleCount[r] ?? 0) + 1;
  }
  console.log(`  users ทั้งหมด: ${(byRole ?? []).length}`);
  for (const [r, n] of Object.entries(roleCount)) console.log(`    role=${r}: ${n}`);

  // host ที่มี/ไม่มี otop_village_id (ขั้น 0.5) — นับอย่างเดียว
  const { data: hosts, error: e2 } = await sb
    .from("users")
    .select("otop_village_id, otop_village, otop_tambol, otop_amphur, otop_province")
    .eq("role", "host")
    .limit(500);
  if (e2) {
    console.log(`  ❌ อ่าน host ไม่ได้: ${e2.message}`);
  } else {
    const list = (hosts ?? []) as any[];
    const withId = list.filter((h) => h.otop_village_id);
    const withVillage = list.filter((h) => h.otop_village);
    const withTambol = list.filter((h) => h.otop_tambol);
    const distinctVillageId = new Set(withId.map((h) => h.otop_village_id)).size;
    const distinctVillageName = new Set(withVillage.map((h) => h.otop_village)).size;
    console.log(`  host ทั้งหมด: ${list.length}`);
    console.log(`    มี otop_village_id: ${withId.length}   ไม่มี: ${list.length - withId.length}`);
    console.log(`    มี otop_village: ${withVillage.length}   มี otop_tambol: ${withTambol.length}`);
    console.log(`    otop_village_id ที่ไม่ซ้ำ: ${distinctVillageId}`);
    console.log(`    ชื่อหมู่บ้านที่ไม่ซ้ำ: ${distinctVillageName}`);
    console.log(`    (ค่า id/ชื่อ/ที่อยู่ไม่ถูกพิมพ์ออกไป — ใช้ในสคริปต์ mapping แทน)`);
  }

  // ตารางที่แผนจะแตะ
  for (const table of ["communities", "community_places", "places"]) {
    const { count, error } = await sb
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) console.log(`  ${table}: ❌ ${error.message}`);
    else console.log(`  ${table}: ${count ?? 0} แถว`);
  }

  // คอลัมน์ของ community_places ตอนนี้ (ชื่อคอลัมน์เท่านั้น ไม่พิมพ์ค่า)
  const { data: cpCols } = await sb.from("community_places").select("*").limit(1);
  if (cpCols && cpCols.length > 0) {
    console.log(`  community_places.columns: ${Object.keys(cpCols[0]).join(", ")}`);
  } else {
    console.log("  community_places: ว่างเปล่า — เช็ค schema.sql / migrations");
  }

  // รูปแบบ place_id ที่มีอยู่ (นับตามรูปแบบ ไม่พิมพ์ค่า)
  const { data: cpIds } = await sb
    .from("community_places")
    .select("place_id, owner_id, recorded_by, province, district, subdistrict, village")
    .limit(1000);
  const buckets: Record<string, number> = {};
  let withOwner = 0;
  let withHierarchy = 0;
  for (const r of cpIds ?? []) {
    const x = r as any;
    const id = String(x.place_id ?? "");
    const kind = id.startsWith("ChIJ")
      ? "ChIJ (google)"
      : id.startsWith("host-")
      ? "host-*"
      : id.startsWith("otop-fallback-")
      ? "otop-fallback-*"
      : id.startsWith("otop-")
      ? "otop-*"
      : id
      ? "อื่น ๆ"
      : "(null)";
    buckets[kind] = (buckets[kind] ?? 0) + 1;
    if (x.owner_id) withOwner += 1;
    if (x.province || x.district || x.subdistrict || x.village) withHierarchy += 1;
  }
  if (Object.keys(buckets).length) {
    console.log(`  community_places.place_id: ${JSON.stringify(buckets)}`);
    console.log(`    มี owner_id: ${withOwner}   มีชื่อ hierarchy: ${withHierarchy} / ${(cpIds ?? []).length}`);
  }

  // places (cache) — นับรูปแบบ google_place_id และความครบของ hierarchy
  const { data: pl } = await sb
    .from("places")
    .select("google_place_id, community, subdistrict, district, province, verified_by")
    .limit(1000);
  const pBuckets: Record<string, number> = {};
  let pWithCommunity = 0;
  let pWithProvince = 0;
  let pWithSub = 0;
  for (const r of pl ?? []) {
    const x = r as any;
    const id = String(x.google_place_id ?? "");
    const kind = id.startsWith("ChIJ")
      ? "ChIJ (google)"
      : id
      ? "อื่น ๆ"
      : "(null)";
    pBuckets[kind] = (pBuckets[kind] ?? 0) + 1;
    if (x.community) pWithCommunity += 1;
    if (x.province) pWithProvince += 1;
    if (x.subdistrict) pWithSub += 1;
  }
  console.log(`  places.google_place_id: ${JSON.stringify(pBuckets)}`);
  console.log(
    `    มี community: ${pWithCommunity} · มี province: ${pWithProvince} · มี subdistrict: ${pWithSub} / ${(pl ?? []).length}`
  );
  console.log(`    มี verified_by: ${(pl ?? []).filter((r: any) => (r as any).verified_by).length}`);
}

// ─────────────────────────────────────────────
//  main
// ─────────────────────────────────────────────

async function main() {
  console.log("════════ Phase 0 probe ════════");
  console.log(`Places configured: ${isPlacesConfigured()}`);
  console.log(`Supabase configured: ${isSupabaseConfigured()}`);

  const hierarchy = loadHierarchy();
  console.log(`hierarchy: ${hierarchy.length} ชุมชน`);

  // ── ขั้น 0.1: Google Places สด ──
  if (isPlacesConfigured()) {
    await probePlacesNew("บ้านดอยปุย ต.สุเทพ อ.เมือง จ.เชียงใหม่ ประเทศไทย");
    await probeLegacy("บ้านดอยปุย ต.สุเทพ อ.เมือง จ.เชียงใหม่ ประเทศไทย");
  } else {
    console.log("\n⚠️ ไม่ได้ตั้ง GOOGLE_PLACES_API_KEY — ข้ามการ probe");
  }

  // ── ขั้น 0.5: ฐานข้อมูล ──
  await probeDb();

  // ── ขั้น 0.7: ค้น scoped ระดับตำบล ──
  if (isPlacesConfigured()) {
    console.log("\n════════ ขั้น 0.7 — ค้น scoped ระดับตำบล (3 ชุมชนตัวอย่าง) ════════");
    const samples = [
      hierarchy.find((p) => p.name.includes("ดอยปุย")),
      hierarchy.find((p) => p.provinceName === "เชียงใหม่"),
      hierarchy.find((p) => p.provinceName === "กรุงเทพมหานคร"),
    ].filter(Boolean) as PlaceItem[];
    for (const s of samples) await probeScoped(s);
  }
}

main().catch((err) => {
  console.error("probe ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
