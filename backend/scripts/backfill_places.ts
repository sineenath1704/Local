/**
 * ขั้น 1.3 + 1.4 — backfill `community_id` / `business_place_id` / copy จาก `places`
 * ---------------------------------------------------------------------------
 * ตาม PLAN_PLACE_MATCHING.md §4.3 (B1–B6)
 *
 *   B1  users.community_id          ← users.otop_village_id → communities.otop_village_id
 *   B2  community_places.community_id ← ชุมชนของ host เจ้าของแถวนั้น
 *   B3  users.business_place_id     = NULL   เมื่อ place_id เป็น host-/otop- (ไม่ใช่ Google id)
 *   B4  users.business_place_id     = place_id เมื่อ place_id ขึ้นต้นด้วย ChIJ (Google id จริง)
 *   B5  community_places.community_id ที่ยังค้าง → หาจาก place_id ของ host
 *       ⚠️ ถ้ายังหาไม่ได้ = **เกตเตอร์**: ต้องจัดการก่อนจึงจะ set not null ได้
 *   B6  copy จากตาราง `places` (ที่ยืนยันแล้ว) เข้า `community_places` (D19)
 *       — copy ไม่ใช่ move: `places` ยังอยู่ เพราะ `videos.place_id` ชี้อยู่ (D25)
 *
 * ใช้
 *   cd backend
 *   npx ts-node --transpile-only scripts/backfill_places.ts          # dry-run (แนะนำ)
 *   npx ts-node --transpile-only scripts/backfill_places.ts --write  # เขียนจริง
 *   npx ts-node --transpile-only scripts/backfill_places.ts --write --only=b1,b4
 *
 * ต้องใช้ service-role key (backend/.env)
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../src/supabaseAdmin";
import { villageSearchKey } from "./lib/hierarchy";

interface CommunityRow {
  id: string;
  name: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  otop_village_id: string | null;
}

interface UserRow {
  id: string;
  role: string | null;
  otop_village_id: string | null;
  business_place_id: string | null;
  community_id: string | null;
}

interface CommunityPlaceRow {
  id: string;
  place_id: string | null;
  owner_id: string | null;
  place_name: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  village: string | null;
  community_id: string | null;
  community_match_level: string | null;
  recorded_by: string | null;
}

interface PlacesRow {
  id: string;
  name: string | null;
  community: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  verified_by: string | null;
  source: string | null;
}

const PAGE = 1000;
const BATCH = 200;

async function fetchAll<T>(
  sb: SupabaseClient,
  table: string,
  columns: string
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`อ่าน ${table} ไม่ได้: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** ทำให้ชื่อเทียบกันได้: ตัด "บ้าน"/"หมู่" + ช่องว่าง/เครื่องหมาย */
function norm(s: string | null | undefined): string {
  return villageSearchKey(s ?? "");
}

/** ป้ายที่ระบุว่า place_id เป็น Google Place ID จริงหรือไม่ */
function isGooglePlaceId(placeId: string | null | undefined): boolean {
  return Boolean(placeId && placeId.startsWith("ChIJ"));
}

function isSyntheticPlaceId(placeId: string | null | undefined): boolean {
  return Boolean(
    placeId && (placeId.startsWith("host-") || placeId.startsWith("otop-"))
  );
}

/** ดัชนีค้นชุมชนจากหลายระดับ (ยิ่งเจาะจงยิ่งมาก่อน) */
class CommunityIndex {
  byVillageId = new Map<string, CommunityRow>();
  byVillageName = new Map<string, CommunityRow>();
  bySubdistrict = new Map<string, CommunityRow>();
  byDistrict = new Map<string, CommunityRow>();

  constructor(list: CommunityRow[]) {
    for (const c of list) {
      if (c.otop_village_id) this.byVillageId.set(c.otop_village_id, c);
      const vn = norm(c.name);
      if (vn && c.province) {
        const k = `${vn}|${norm(c.province)}`;
        if (!this.byVillageName.has(k)) this.byVillageName.set(k, c);
      }
      const sub = norm(c.subdistrict);
      const dist = norm(c.district);
      const prov = norm(c.province);
      if (sub && dist && prov) {
        const k = `${sub}|${dist}|${prov}`;
        if (!this.bySubdistrict.has(k)) this.bySubdistrict.set(k, c);
      }
      if (dist && prov) {
        const k = `${dist}|${prov}`;
        if (!this.byDistrict.has(k)) this.byDistrict.set(k, c);
      }
    }
  }

  byVillageNameOnly(village: string | null, province: string | null) {
    const v = norm(village);
    if (!v || !province) return undefined;
    return this.byVillageName.get(`${v}|${norm(province)}`);
  }

  bySubdistrictOnly(
    subdistrict: string | null,
    district: string | null,
    province: string | null
  ) {
    const s = norm(subdistrict);
    const d = norm(district);
    const p = norm(province);
    if (!s || !d || !p) return undefined;
    return this.bySubdistrict.get(`${s}|${d}|${p}`);
  }

  byDistrictOnly(district: string | null, province: string | null) {
    const d = norm(district);
    const p = norm(province);
    if (!d || !p) return undefined;
    return this.byDistrict.get(`${d}|${p}`);
  }
}

type MatchLevel = "village" | "subdistrict" | "district" | "manual" | null;

interface Resolved {
  community: CommunityRow | null | undefined;
  level: MatchLevel;
}

async function main() {
  const write = process.argv.includes("--write");
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = new Set(
    onlyArg
      ? onlyArg
          .split("=")[1]!
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []
  );
  /** ขั้นที่จะทำ — ไม่ระบุ = ทั้งหมด */
  const enabled = (step: string) => only.size === 0 || only.has(step);

  console.log("════════ ขั้น 1.3/1.4 — backfill สถานที่ ↔ ชุมชน ════════");
  console.log(write ? "โหมด: เขียนจริง (--write)" : "โหมด: dry-run (ยังไม่เขียน)");
  if (only.size) console.log(`ทำเฉพาะ: ${[...only].join(", ")}`);

  const sb = getSupabaseAdmin();
  if (!sb) {
    console.error(
      "❌ สร้าง Supabase admin client ไม่ได้ — ตรวจ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน backend/.env"
    );
    process.exit(1);
  }

  // ── อ่านข้อมูลทั้งหมด ─────────────────────────────────────────
  const communities = await fetchAll<CommunityRow>(
    sb,
    "communities",
    "id, name, province, district, subdistrict, otop_village_id"
  );
  const users = await fetchAll<UserRow>(
    sb,
    "users",
    "id, role, otop_village_id, business_place_id, community_id"
  );
  const cpRows = await fetchAll<CommunityPlaceRow>(
    sb,
    "community_places",
    "id, place_id, owner_id, place_name, province, district, subdistrict, village, community_id, community_match_level, recorded_by"
  );
  const placesRows = await fetchAll<PlacesRow>(
    sb,
    "places",
    "id, name, community, subdistrict, district, province, latitude, longitude, google_place_id, verified_by, source"
  );

  const index = new CommunityIndex(communities);
  console.log(
    `communities ${communities.length} · users ${users.length} · community_places ${cpRows.length} · places ${placesRows.length}`
  );

  const userById = new Map(users.map((u) => [u.id, u]));
  const cpById = new Map(cpRows.map((c) => [c.id, c]));

  /** ผลลัพธ์ที่จะเขียน */
  const userCommunity = new Map<string, string>(); // userId → communityId
  const userBusinessPlace = new Map<string, string | null>(); // userId → google id | null
  const cpCommunity = new Map<string, string>(); // cpId → communityId
  const cpLevel = new Map<string, MatchLevel>(); // cpId → ระดับที่จับคู่ได้
  const cpRecordedBy = new Map<string, string | null>(); // cpId → recorded_by

  // ── B1: users.community_id ← otop_village_id ──────────────────
  if (enabled("b1")) {
    let hit = 0;
    for (const u of users) {
      if (!u.otop_village_id) continue;
      const c = index.byVillageId.get(u.otop_village_id);
      if (!c) continue;
      userCommunity.set(u.id, c.id);
      hit += 1;
    }
    console.log(
      `B1: users.community_id — จับคู่ได้ ${hit} คน ` +
        `(host ที่มี otop_village_id แต่หาไม่พบชุมชน = ข้าม)`
    );
  }

  // ── B3 + B4: users.business_place_id ─────────────────────────
  // เงื่อนไข: business_place_id เก็บ "Google Place ID" เท่านั้น
  //   → ถ้ามีแถว ChIJ → ใช้ตัวนั้น (B4)
  //   → ถ้ามีแต่ host-/otop- → NULL (B3) เพราะไม่ใช่ id ของ Google
  if (enabled("b3") || enabled("b4")) {
    const byOwner = new Map<string, CommunityPlaceRow[]>();
    for (const cp of cpRows) {
      if (!cp.owner_id) continue;
      const arr = byOwner.get(cp.owner_id) ?? [];
      arr.push(cp);
      byOwner.set(cp.owner_id, arr);
    }

    let setGoogle = 0;
    let setNull = 0;
    for (const [ownerId, list] of byOwner) {
      const googleId = list.find((c) => isGooglePlaceId(c.place_id))?.place_id ?? null;
      const hasSynthetic = list.some((c) => isSyntheticPlaceId(c.place_id));
      if (googleId) {
        userBusinessPlace.set(ownerId, googleId);
        setGoogle += 1;
      } else if (hasSynthetic) {
        userBusinessPlace.set(ownerId, null);
        setNull += 1;
      }
    }
    console.log(
      `B4: users.business_place_id = Google id → ${setGoogle} คน · B3: = NULL (host-/otop- เท่านั้น) → ${setNull} คน`
    );
  }

  // ── B2: community_places.community_id ← ชุมชนของ host ──────────
  if (enabled("b2")) {
    let hit = 0;
    let miss = 0;
    for (const cp of cpRows) {
      if (!cp.owner_id) continue;
      const owner = userById.get(cp.owner_id);
      if (!owner) continue;
      const communityId =
        userCommunity.get(owner.id) ??
        (owner.community_id ?? null);
      if (communityId) {
        cpCommunity.set(cp.id, communityId);
        hit += 1;
      } else {
        miss += 1;
      }
    }
    console.log(`B2: community_places.community_id จาก host — ได้ ${hit} แถว · หา host ไม่พบ ${miss} แถว`);
  }

  // ── B6: copy จาก `places` → `community_places` ─────────────────
  const b6Inserts: any[] = [];
  if (enabled("b6")) {
    let copied = 0;
    let skipped = 0;
    for (const p of placesRows) {
      if (!isGooglePlaceId(p.google_place_id)) {
        skipped += 1;
        continue;
      }
      if (!p.name) {
        skipped += 1;
        continue;
      }
      // หาชุมชนจากข้อมูลใน `places` (ชื่อหมู่บ้าน → ตำบล → อำเภอ)
      let resolved: Resolved = { community: null, level: null };
      resolved.community = index.byVillageNameOnly(p.community, p.province);
      if (resolved.community) resolved.level = "village";
      if (!resolved.community) {
        resolved.community = index.bySubdistrictOnly(
          p.subdistrict,
          p.district,
          p.province
        );
        if (resolved.community) resolved.level = "subdistrict";
      }
      if (!resolved.community) {
        resolved.community = index.byDistrictOnly(p.district, p.province);
        if (resolved.community) resolved.level = "district";
      }

      b6Inserts.push({
        place_id: p.google_place_id,
        place_name: p.name,
        formatted_address: null,
        province: p.province,
        district: p.district,
        subdistrict: p.subdistrict,
        village: p.community,
        latitude: p.latitude,
        longitude: p.longitude,
        source: "google",
        owner_id: null,
        recorded_by: p.verified_by ?? null,
        community_id: resolved.community?.id ?? null,
        community_match_level: resolved.level,
      });
      copied += 1;
    }
    console.log(
      `B6: copy จาก places → community_places — เตรียม ${copied} แถว · ข้าม ${skipped} แถว (ไม่มี Google id / ไม่มีชื่อ)`
    );
  }

  // ── B5: เติม community_id ที่ยังค้าง + รายงานเกตเตอร์ ────────
  // หลัง B6 (ถ้าเปิด) เพราะแถวใหม่จะเข้ามาในรอบนี้
  const unresolved: CommunityPlaceRow[] = [];
  if (enabled("b5")) {
    // map: place_id (Google) → communityId ของเจ้าของ
    const placeIdToCommunity = new Map<string, string>();
    for (const [userId, businessPlaceId] of userBusinessPlace) {
      if (!businessPlaceId) continue;
      const communityId = userCommunity.get(userId);
      if (communityId) placeIdToCommunity.set(businessPlaceId, communityId);
    }

    let resolvedCount = 0;
    for (const cp of cpRows) {
      if (cpCommunity.has(cp.id)) continue;
      if (cp.community_id) {
        cpCommunity.set(cp.id, cp.community_id);
        continue;
      }

      // (ก) ผูกจาก place_id ของ host
      let resolved: Resolved = { community: null, level: null };
      const owner = cp.owner_id ? userById.get(cp.owner_id) : undefined;
      if (owner) {
        const businessPlaceId = userBusinessPlace.get(owner.id) ?? owner.business_place_id;
        if (businessPlaceId && placeIdToCommunity.has(businessPlaceId)) {
          resolved.community = communities.find(
            (c) => c.id === placeIdToCommunity.get(businessPlaceId)
          ) ?? null;
          resolved.level = "manual";
        }
      }
      // (ข) ผูกจากชื่อหมู่บ้านในแถวเอง
      if (!resolved.community) {
        resolved.community = index.byVillageNameOnly(cp.village, cp.province);
        if (resolved.community) resolved.level = "village";
      }
      // (ค) ผูกจากตำบล
      if (!resolved.community) {
        resolved.community = index.bySubdistrictOnly(
          cp.subdistrict,
          cp.district,
          cp.province
        );
        if (resolved.community) resolved.level = "subdistrict";
      }
      // (ง) ผูกจากอำเภอ
      if (!resolved.community) {
        resolved.community = index.byDistrictOnly(cp.district, cp.province);
        if (resolved.community) resolved.level = "district";
      }

      if (resolved.community) {
        cpCommunity.set(cp.id, resolved.community.id);
        cpLevel.set(cp.id, resolved.level);
        resolvedCount += 1;
      } else {
        unresolved.push(cp);
      }
    }
    console.log(
      `B5: community_places ที่ค้าง — เติมได้ ${resolvedCount} แถว · **ค้าง ${unresolved.length} แถว**` +
        (unresolved.length ? "  ← ต้องจัดการก่อน set not null" : "")
    );
  }

  // ── สรุปแผนการเขียน ──────────────────────────────────────────
  const userWrites: { id: string; patch: Record<string, unknown> }[] = [];
  for (const [userId, communityId] of userCommunity) {
    const u = userById.get(userId);
    if (u && u.community_id !== communityId) {
      userWrites.push({ id: userId, patch: { community_id: communityId } });
    }
  }
  for (const [userId, businessPlaceId] of userBusinessPlace) {
    const u = userById.get(userId);
    if (u && (u.business_place_id ?? null) !== businessPlaceId) {
      userWrites.push({ id: userId, patch: { business_place_id: businessPlaceId } });
    }
  }
  // รวม patch ของ user เดียวกันให้เป็นอันเดียว
  const userPatch = new Map<string, Record<string, unknown>>();
  for (const w of userWrites) {
    const prev = userPatch.get(w.id) ?? {};
    userPatch.set(w.id, { ...prev, ...w.patch });
  }

  const cpWrites: { id: string; patch: Record<string, unknown> }[] = [];
  for (const [cpId, communityId] of cpCommunity) {
    const cp = cpById.get(cpId);
    if (!cp) continue;
    const patch: Record<string, unknown> = {};
    if ((cp.community_id ?? null) !== communityId) patch.community_id = communityId;
    const level = cpLevel.get(cpId);
    if (level !== undefined && cp.community_match_level !== level) {
      patch.community_match_level = level;
    }
    if (Object.keys(patch).length) cpWrites.push({ id: cpId, patch });
  }
  for (const [cpId, recordedBy] of cpRecordedBy) {
    const cp = cpById.get(cpId);
    if (cp && (cp.recorded_by ?? null) !== recordedBy) {
      cpWrites.push({ id: cpId, patch: { recorded_by: recordedBy } });
    }
  }

  console.log(
    `\nสรุปการเขียน: users ${userPatch.size} แถว · community_places ${cpWrites.length} แถว · insert จาก places ${b6Inserts.length} แถว`
  );

  if (unresolved.length) {
    console.log("\n── แถวที่ยังหาชุมชนไม่ได้ (B5 gate) ──");
    for (const cp of unresolved.slice(0, 20)) {
      console.log(
        `   • ${cp.place_name ?? "(ไม่มีชื่อ)"} · place_id=${cp.place_id ?? "-"} · ${cp.subdistrict ?? "-"} / ${cp.district ?? "-"} / ${cp.province ?? "-"}`
      );
    }
    if (unresolved.length > 20) console.log(`   … อีก ${unresolved.length - 20} แถว`);
  }

  if (!write) {
    console.log("\n(dry-run — ใส่ --write เพื่อเขียนจริง)");
    return;
  }

  // ── เขียนจริง ────────────────────────────────────────────────
  for (const [userId, patch] of userPatch) {
    const { error } = await sb.from("users").update(patch).eq("id", userId);
    if (error) throw new Error(`อัปเดต users ไม่สำเร็จ: ${error.message}`);
  }
  console.log(`✅ users: อัปเดต ${userPatch.size} แถว`);

  for (let i = 0; i < cpWrites.length; i += BATCH) {
    for (const w of cpWrites.slice(i, i + BATCH)) {
      const { error } = await sb
        .from("community_places")
        .update(w.patch)
        .eq("id", w.id);
      if (error) throw new Error(`อัปเดต community_places ไม่สำเร็จ: ${error.message}`);
    }
  }
  console.log(`✅ community_places: อัปเดต ${cpWrites.length} แถว`);

  if (b6Inserts.length) {
    for (let i = 0; i < b6Inserts.length; i += BATCH) {
      const chunk = b6Inserts.slice(i, i + BATCH);
      // ignoreDuplicates: ไม่ทับแถวเดิมที่ยืนยันไว้แล้ว
      const { error } = await sb
        .from("community_places")
        .upsert(chunk, { onConflict: "place_id", ignoreDuplicates: true });
      if (error) throw new Error(`copy จาก places ไม่สำเร็จ: ${error.message}`);
    }
    console.log(`✅ community_places: copy จาก places ${b6Inserts.length} แถว`);
  }

  // ── ตรวจหลังเขียน ────────────────────────────────────────────
  const { count: cpCount } = await sb
    .from("community_places")
    .select("*", { count: "exact", head: true });
  const { count: nullCommunity } = await sb
    .from("community_places")
    .select("*", { count: "exact", head: true })
    .is("community_id", null);
  console.log(
    `\nตรวจหลังเขียน: community_places ${cpCount ?? 0} แถว · ยังไม่มี community_id ${nullCommunity ?? 0} แถว`
  );
  if ((nullCommunity ?? 0) > 0) {
    console.log(
      "⚠️  ยังมีแถวที่ community_id = NULL → **ห้าม set not null** จนกว่าจะจัดการครบ (PLAN §4.3 B5)"
    );
  }
}

main().catch((err) => {
  console.error("ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
