/**
 * ขั้น 0.4 + 0.5 — ทำ mapping file "หมู่บ้านใน hierarchy → CDD Village_ID"
 * ───────────────────────────────────────────────────────────────────────────
 * ทำไมต้องมี
 *   `users.otop_village_id` เก็บ CDD `Village_ID` (เช่น "1234")
 *   `src/data/thailand_hierarchy.json` เก็บ id ของ dataset (เช่น
 *   "place-เชียงใหม่-เมืองเชียงใหม่-1") → **คนละ id space**
 *   ต้องมีไฟล์แมปเพื่อเชื่อม `users.community_id` → `communities.id` (D13)
 *
 * ทำไมใช้ anon key
 *   service-role key ใน backend/.env ตอนนี้ **อ่านตารางไม่ได้เลย**
 *   (permission denied ทุกตาราง) — แต่ `users` มี policy
 *   "users readable by all" จึงอ่านผ่าน anon key ของแอปได้
 *   ขั้นนี้ต้องการแค่ `users.otop_*` กับ hierarchy ซึ่งอ่านได้ทั้งคู่
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/otop_village_map.ts          # ดูสถิติ
 *   npx ts-node --transpile-only scripts/otop_village_map.ts --write  # เขียนไฟล์แมป
 *
 * เอาต์พุต: จำนวน/เหตุผลที่จับคู่ไม่ได้เท่านั้น — **ไม่พิมพ์ id หรือข้อมูลผู้ใช้**
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
import {
  PlaceItem,
  ROOT,
  VILLAGE_MAPPING_FILE,
  loadHierarchy,
  parseSubdistrict,
  tambolKey,
  villageSearchKey,
} from "./lib/hierarchy";

const transport = WebSocket as any;

const OUT_FILE = VILLAGE_MAPPING_FILE;

function readAppEnv(): Record<string, string> {
  const file = path.join(ROOT, ".env");
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const ln of fs.readFileSync(file, "utf8").split("\n")) {
    const m = ln.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

type Fail = "no_otop_id" | "village_not_in_hierarchy" | "ambiguous" | "no_village_name";

async function main() {
  const write = process.argv.includes("--write");
  const env = readAppEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error("ไม่พบ EXPO_PUBLIC_SUPABASE_URL / ANON_KEY ใน .env ของแอป");
    process.exit(1);
  }
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport },
  });

  const hierarchy = loadHierarchy();
  console.log("════════ ขั้น 0.4 — mapping หมู่บ้าน → CDD Village_ID ════════");
  console.log(`hierarchy: ${hierarchy.length} ชุมชน`);

  // ── ขั้น 0.5: นับ host ที่ไม่มี otop_village_id ──
  const { data: allUsers, error: uErr } = await sb
    .from("users")
    .select("role, otop_village_id, otop_village, otop_tambol, otop_amphur, otop_province")
    .limit(1000);
  if (uErr) {
    console.error(`❌ อ่าน users ไม่ได้: ${uErr.message}`);
    process.exit(1);
  }
  const users = (allUsers ?? []) as any[];
  const roleCount: Record<string, number> = {};
  for (const u of users) roleCount[u.role ?? "(null)"] = (roleCount[u.role ?? "(null)"] ?? 0) + 1;
  console.log(`users ทั้งหมด: ${users.length} → ${JSON.stringify(roleCount)}`);

  const hosts = users.filter((u) => u.role === "host");
  const hostsWithId = hosts.filter((u) => u.otop_village_id);
  const hostsWithoutId = hosts.filter((u) => !u.otop_village_id);
  console.log(`host: ${hosts.length} · มี otop_village_id: ${hostsWithId.length} · ไม่มี: ${hostsWithoutId.length}`);

  // ── จับคู่ ──
  // index: ตำบล → รายการชุมชนในตำบลนั้น
  const byTambol = new Map<string, PlaceItem[]>();
  for (const p of hierarchy) {
    const key = tambolKey(p.provinceName, p.districtName, parseSubdistrict(p.subdistrict));
    const arr = byTambol.get(key) ?? [];
    arr.push(p);
    byTambol.set(key, arr);
  }

  const mapping: Record<string, any> = {};
  const fails: Record<Fail, number> = {
    no_otop_id: 0,
    village_not_in_hierarchy: 0,
    ambiguous: 0,
    no_village_name: 0,
  };
  const distinctVillages = new Set<string>();

  for (const h of hostsWithId) {
    const vKey = villageSearchKey(h.otop_village ?? "");
    if (!h.otop_village) {
      fails.no_village_name += 1;
      continue;
    }
    const tambolKeyOfUser = tambolKey(
      h.otop_province ?? "",
      h.otop_amphur ?? "",
      h.otop_tambol ?? ""
    );
    const candidates = (byTambol.get(tambolKeyOfUser) ?? []).filter(
      (c) => villageSearchKey(c.name) === vKey
    );
    if (candidates.length === 0) {
      fails.village_not_in_hierarchy += 1;
      continue;
    }
    if (candidates.length > 1) {
      fails.ambiguous += 1;
      continue;
    }
    const hit = candidates[0];
    distinctVillages.add(hit.id);
    mapping[hit.id] = {
      otop_village_id: h.otop_village_id,
      village_name: hit.name,
      subdistrict: parseSubdistrict(hit.subdistrict),
      district: hit.districtName,
      province: hit.provinceName,
    };
  }

  console.log(`\nจับคู่ได้: ${Object.keys(mapping).length} ชุมชน (จาก ${hostsWithId.length} host ที่มี otop_village_id)`);
  console.log(`  หมู่บ้านที่ไม่ซ้ำ: ${distinctVillages.size}`);
  console.log(`  ไม่ผ่าน: ${JSON.stringify(fails)}`);

  if (write && Object.keys(mapping).length > 0) {
    const payload = {
      _note:
        "mapping หมู่บ้านใน hierarchy → CDD Village_ID (ขั้น 0.4) — สร้างโดย " +
        "backend/scripts/otop_village_map.ts — key = id ใน thailand_hierarchy.json",
      _generated: new Date().toISOString().slice(0, 10),
      communities: mapping,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log(`\nเขียนไฟล์แมปแล้ว: ${path.relative(ROOT, OUT_FILE)}`);
  } else if (!write) {
    console.log("\n(ยังไม่เขียนไฟล์ — ใส่ --write เพื่อเขียน)");
  }
}

main().catch((err) => {
  console.error("ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
