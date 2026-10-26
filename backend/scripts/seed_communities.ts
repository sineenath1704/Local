/**
 * ขั้น 1.2 — seed ตาราง `communities` จาก OTOP hierarchy
 * ---------------------------------------------------------------------------
 * ตาม PLAN_PLACE_MATCHING.md §4.2
 *
 * ทำไม
 *   ตาราง `communities` เดิมบังคับ `host_user_id not null` → ชุมชน OTOP
 *   ที่ยังไม่มี host ลงทะเบียนเลย **สร้างไม่ได้** (ตารางว่างเปล่า 0 แถว)
 *   การ seed ให้ `communities` เป็น "ทะเบียนชุมชน" อ่านได้อย่างเดียว
 *   แล้วค่อยผูก host เข้ามาทีหลัง (ดู migration `add_place_matching.sql` ข้อ 1)
 *
 * ข้อมูลที่ seed
 *   name        = ชื่อหมู่บ้านจาก hierarchy
 *   region      = ภาค
 *   province    = จังหวัด
 *   district    = อำเภอ
 *   subdistrict = **parse** จาก "ต.สุเทพ, หมู่ 11" → "สุเทพ"
 *   otop_village_id = CDD Village_ID จากไฟล์แมปขั้น 0.4 (ถ้ายังไม่มี = NULL)
 *   is_verified = true
 *   latitude / longitude / capacity_per_day = NULL (ไม่มีแหล่งข้อมูล — §2.1)
 *
 * รันซ้ำได้ (idempotent)
 *   • แถวเดิม → อัปเดตเฉพาะฟิลด์ที่ต่าง
 *   • `host_user_id` **ไม่ถูกแตะ** (ถ้ามี host มาจองชุมชนไว้แล้ว ห้ามหาย)
 *   • จับคู่แถวเดิมด้วย `otop_village_id` ก่อน → ถ้ายังไม่มี (ขั้น 0.6 ยังไม่เสร็จ)
 *     ใช้ name+province+district+subdistrict แทน — ชื่อหมู่บ้านซ้ำในตำบลเดียวกัน
 *     มีจริง (159 ชุด) → จับคู่แบบคิว ไม่ให้แถวเดิมหนึ่งแถวถูกใช้สองครั้ง
 *   • ถ้าชื่อหมู่บ้านเปลี่ยนใน hierarchy → จะกลายเป็นแถวใหม่ (ไม่มี key ที่นิ่ง
 *     จนกว่าจะเติม `otop_village_id` ในขั้น 0.6)
 *
 * ใช้
 *   cd backend
 *   npx ts-node --transpile-only scripts/seed_communities.ts            # dry-run
 *   npx ts-node --transpile-only scripts/seed_communities.ts --write    # เขียนจริง
 *   npx ts-node --transpile-only scripts/seed_communities.ts --write --limit=50
 *
 * ต้องใช้ service-role key (backend/.env) — RLS ไม่ให้ anon เขียนได้
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../src/supabaseAdmin";
import {
  PlaceItem,
  loadHierarchy,
  loadVillageMapping,
  parseSubdistrict,
} from "./lib/hierarchy";

interface SeedRow {
  hierarchyId: string;
  name: string;
  region: string;
  province: string;
  district: string;
  subdistrict: string;
  otop_village_id: string | null;
}

interface ExistingCommunity {
  id: string;
  name: string | null;
  region: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  otop_village_id: string | null;
  is_verified: boolean | null;
}

const PAGE = 1000;
const BATCH = 200;

/** อ่านทั้งตารางแบบมีเพจ (PostgREST ตัดที่ 1,000 แถวต่อครั้ง) */
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

/** คีย์ธรรมชาติของชุมชน — ใช้จับคู่แถวเดิมที่ยังไม่มี otop_village_id */
function naturalKey(r: {
  name: string;
  province: string;
  district: string;
  subdistrict: string;
}): string {
  return [r.name, r.province, r.district, r.subdistrict].join("|");
}

/** ค่าที่จะเขียนลงแถว (เว้น host_user_id / lat / lng / capacity ไว้เดิม) */
function payloadOf(r: SeedRow, id: string) {
  return {
    id,
    name: r.name,
    region: r.region,
    province: r.province,
    district: r.district,
    subdistrict: r.subdistrict,
    otop_village_id: r.otop_village_id,
    is_verified: true,
  };
}

function differs(existing: ExistingCommunity, r: SeedRow): boolean {
  return (
    existing.name !== r.name ||
    existing.region !== r.region ||
    existing.province !== r.province ||
    existing.district !== r.district ||
    existing.subdistrict !== r.subdistrict ||
    (existing.otop_village_id ?? null) !== (r.otop_village_id ?? null) ||
    existing.is_verified !== true
  );
}

export interface SeedPlan {
  inserts: SeedRow[];
  updates: { existing: ExistingCommunity; row: SeedRow }[];
  /** ข้อมูล seed ที่มี otop_village_id ซ้ำกันเอง (ข้ามไป เพราะ unique index) */
  duplicateVillageIds: SeedRow[];
}

/**
 * เทียบ seed กับของเดิม → ตัดสินใจ insert / update
 * ---------------------------------------------------------------------------
 * แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้ทดสอบได้โดยไม่ต้องต่อฐานข้อมูล
 *
 * กฎจับคู่
 *   1. otop_village_id ตรงกัน        → แถวเดิมคือแถวนั้น (key ที่เสถียรที่สุด)
 *   2. name+province+district+subdistrict ตรงกัน → แถวเดิมที่ยังไม่มี village id
 *   3. ไม่เจอ → insert
 * หนึ่งแถวเดิมถูกใช้ได้ครั้งเดียว (usedIds) — กันสองแถว seed ไปทับกัน
 */
export function planSeed(
  rows: SeedRow[],
  existing: ExistingCommunity[]
): SeedPlan {
  const byVillage = new Map<string, ExistingCommunity>();
  // ชื่อ+ตำบลซ้ำได้จริง (159 ชุดใน hierarchy → รวม 177 แถวเกิน)
  // → เก็บเป็น "คิว" เพื่อให้แต่ละแถวเดิมถูกใช้ได้ครั้งเดียว
  const byNatural = new Map<string, ExistingCommunity[]>();
  for (const e of existing) {
    if (e.otop_village_id) byVillage.set(e.otop_village_id, e);
    const k = naturalKey({
      name: e.name ?? "",
      province: e.province ?? "",
      district: e.district ?? "",
      subdistrict: e.subdistrict ?? "",
    });
    const arr = byNatural.get(k) ?? [];
    arr.push(e);
    byNatural.set(k, arr);
  }

  // กันซ้ำในข้อมูล seed เอง (otop_village_id มี unique index)
  const seenVillage = new Set<string>();
  const duplicateVillageIds: SeedRow[] = [];
  const clean: SeedRow[] = [];
  for (const r of rows) {
    if (r.otop_village_id) {
      if (seenVillage.has(r.otop_village_id)) {
        duplicateVillageIds.push(r);
        continue;
      }
      seenVillage.add(r.otop_village_id);
    }
    clean.push(r);
  }

  const usedIds = new Set<string>();
  const inserts: SeedRow[] = [];
  const updates: { existing: ExistingCommunity; row: SeedRow }[] = [];

  for (const r of clean) {
    let match: ExistingCommunity | undefined;
    if (r.otop_village_id) {
      const m = byVillage.get(r.otop_village_id);
      if (m && !usedIds.has(m.id)) match = m;
    }
    if (!match) {
      const queue = byNatural.get(
        naturalKey({
          name: r.name,
          province: r.province,
          district: r.district,
          subdistrict: r.subdistrict,
        })
      );
      if (queue) {
        const m = queue.find((e) => !usedIds.has(e.id));
        if (m) match = m;
      }
    }

    if (match) {
      usedIds.add(match.id);
      if (differs(match, r)) updates.push({ existing: match, row: r });
    } else {
      inserts.push(r);
    }
  }

  return { inserts, updates, duplicateVillageIds };
}

async function main() {
  const write = process.argv.includes("--write");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

  console.log("════════ ขั้น 1.2 — seed ชุมชน OTOP ════════");
  console.log(write ? "โหมด: เขียนจริง (--write)" : "โหมด: dry-run (ยังไม่เขียน — ใส่ --write เพื่อเขียน)");

  // ── 1) อ่าน hierarchy + ไฟล์แมป ──────────────────────────────
  const hierarchy = loadHierarchy() as PlaceItem[];
  const mapping = loadVillageMapping();
  console.log(`hierarchy: ${hierarchy.length} ชุมชน`);
  console.log(
    `ไฟล์แมป OTOP: ${Object.keys(mapping).length} รายการ` +
      (Object.keys(mapping).length === 0
        ? "  ← ยังไม่ได้ทำขั้น 0.4 → otop_village_id จะเป็น NULL ทั้งหมด"
        : "")
  );

  const rows: SeedRow[] = hierarchy.map((p) => ({
    hierarchyId: p.id,
    name: p.name,
    region: p.regionName,
    province: p.provinceName,
    district: p.districtName,
    subdistrict: parseSubdistrict(p.subdistrict),
    otop_village_id: mapping[p.id]?.otop_village_id ?? null,
  }));

  const target = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
  const withVillageId = target.filter((r) => r.otop_village_id).length;
  console.log(
    `จะ seed ${target.length} แถว (มี otop_village_id: ${withVillageId} · ไม่มี: ${target.length - withVillageId})`
  );

  const sb = getSupabaseAdmin();
  if (!sb) {
    console.error(
      "❌ สร้าง Supabase admin client ไม่ได้ — ตรวจ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน backend/.env"
    );
    process.exit(1);
  }

  // ── 3) อ่านแถวเดิม ─────────────────────────────────────────────
  const existing = await fetchAll<ExistingCommunity>(
    sb,
    "communities",
    "id, name, region, province, district, subdistrict, otop_village_id, is_verified"
  );
  console.log(`communities ที่มีอยู่แล้ว: ${existing.length} แถว`);

  // ── 4) เทียบ seed กับของเดิม → ตัดสินใจ insert / update ────────
  const { inserts, updates, duplicateVillageIds } = planSeed(target, existing);
  if (duplicateVillageIds.length) {
    console.log(
      `⚠️  ข้อมูล seed มี otop_village_id ซ้ำ ${duplicateVillageIds.length} รายการ — ข้ามรายการหลัง (unique index จะ error ถ้าไม่ข้าม)`
    );
  }

  console.log(
    `\nสรุป: insert ${inserts.length} · update ${updates.length} · ไม่ต้องแก้ ${target.length - inserts.length - updates.length}`
  );

  if (!write) {
    console.log("\n(dry-run — ใส่ --write เพื่อเขียนจริง)");
    if (inserts.length) {
      console.log("ตัวอย่างที่จะ insert:");
      for (const r of inserts.slice(0, 5)) {
        console.log(
          `   • ${r.name} | ${r.subdistrict} | ${r.district} | ${r.province} | otop=${r.otop_village_id ?? "-"}`
        );
      }
    }
    if (updates.length) {
      console.log("ตัวอย่างที่จะ update:");
      for (const u of updates.slice(0, 5)) {
        console.log(
          `   • ${u.existing.name} → ${u.row.name} | otop=${u.existing.otop_village_id ?? "-"} → ${u.row.otop_village_id ?? "-"}`
        );
      }
    }
    return;
  }

  // ── 5) เขียน ───────────────────────────────────────────────────
  // upsert บน id (PK) — insert ก็ได้ เพราะคอลัมน์ NOT NULL ของ communities
  // ถูกป้อนครบ และ host_user_id/lat/lng/capacity เป็น nullable หลัง migration
  let written = 0;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const chunk = inserts.slice(i, i + BATCH).map((r) => payloadOf(r, crypto.randomUUID()));
    const { error } = await sb.from("communities").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`insert ไม่สำเร็จ: ${error.message}`);
    written += chunk.length;
  }

  let updated = 0;
  for (const u of updates) {
    const { error } = await sb
      .from("communities")
      .update(payloadOf(u.row, u.existing.id))
      .eq("id", u.existing.id);
    if (error) throw new Error(`update ไม่สำเร็จ: ${error.message}`);
    updated += 1;
  }

  console.log(`\n✅ เขียนแล้ว: insert ${written} · update ${updated}`);

  // ── 6) ตรวจหลังเขียน ───────────────────────────────────────────
  const { count } = await sb
    .from("communities")
    .select("*", { count: "exact", head: true });
  console.log(`communities ตอนนี้: ${count ?? 0} แถว`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("ล้มเหลว:", err?.message ?? err);
    process.exit(1);
  });
}
