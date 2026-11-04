/**
 * เทสต์ "ค้นข้อมูลสถานที่จาก Google" — ตรรกะทั้งหมดที่ไม่ต้องต่อเน็ต
 * -------------------------------------------------------------
 * ครอบคลุม:
 *   1) การหาชื่อสถานที่จากข้อความ (ทะเบียน/โฟลเดอร์/"…"/ลิงก์แมพ/เดาจากประโยค)
 *   2) งบคำขอ (ไม่ยิงเกินจำเป็น)
 *   3) gate กันจับสถานที่ผิด (ชื่อไม่ตรง / ผิดจังหวัด / ปิดถาวร / ชื่อสั้น)
 *   4) กฎ merge (ของ host ชนะเสมอ · Google เติมช่องที่ว่าง)
 *   5) cache (ครั้งที่สองไม่คิดเงิน · TTL · ค้นที่ไม่เจอ · cache พัง)
 *   6) รายการให้เลือกเมื่อชื่อซ้ำ
 *   7) prompt (หัวบล็อกขึ้นกับที่มาของข้อมูล)
 *   8) แพลนทริป (จำกัดจำนวนจุดหมาย · จุดที่ไม่ผ่าน gate ไม่ถูกเอาไป)
 *
 * รัน
 *   cd backend
 *   npm run test:place-lookup
 *
 * ไม่ต่อเน็ต · ไม่ใช้คีย์ · ไม่เขียนฐานข้อมูล
 */

import {
  categoryFromTypes,
  communityNameFor,
  contextFromCandidate,
  enrichDestinations,
  enrichPlace,
  extractPlaceIntent,
  filterCandidatesWithTrace,
  findFolderPlace,
  findNameMatches,
  guessNameFromText,
  lookupPlace,
  mergePlaceContext,
  nameSimilarity,
  pickCandidates,
  priceLevelLabel,
} from "../src/placeLookup";
import type { PlaceCache, PlaceLookupDeps } from "../src/placeLookup";
import { buildChatSystemPrompt } from "../src/tripPrompt";
import type { PlaceContext } from "../src/tripPrompt";
import { buildGoogleBlock } from "../src/routes/trips";
import type { FolderPlace } from "../src/folderContext";
import type { PlaceCandidate } from "../src/placeTypes";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name}${detail ? `\n     ${detail}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `ได้ ${a} · ควรเป็น ${e}`);
}

/** ผู้สมัครปลอม ๆ */
function fake(
  placeId: string,
  name: string,
  opts: {
    subdistrict?: string | null;
    district?: string | null;
    province?: string | null;
    types?: string[];
    rating?: number | null;
    userRatingCount?: number | null;
    phone?: string | null;
    openingHours?: string | null;
    website?: string | null;
    priceLevel?: number | null;
    businessStatus?: string | null;
    primaryTypeDisplayName?: string | null;
  } = {}
): PlaceCandidate {
  const subdistrict = opts.subdistrict ?? "สุเทพ";
  const district = opts.district ?? "เมือง";
  const province = opts.province ?? "เชียงใหม่";
  return {
    name,
    address: `${name} ต.${subdistrict} อ.${district} จ.${province}`,
    placeId,
    latitude: 18.8,
    longitude: 98.9,
    province,
    district,
    subdistrict,
    types: opts.types ?? ["lodging"],
    phone: opts.phone ?? null,
    openingHours: opts.openingHours ?? null,
    rating: opts.rating ?? 4.5,
    userRatingCount: opts.userRatingCount ?? 120,
    website: opts.website ?? null,
    googleMapsUri: `https://www.google.com/maps?q=18.8,98.9&pid=${placeId}`,
    businessStatus: opts.businessStatus ?? "OPERATIONAL",
    primaryType: "lodging",
    primaryTypeDisplayName: opts.primaryTypeDisplayName ?? "ที่พัก",
    priceLevel: opts.priceLevel ?? 2,
  };
}

/** cache ปลอม ๆ (ในหน่วยความจำ) พร้อม TTL จำลอง */
function fakeCache(opts: { ttlDays?: number; failWrites?: boolean } = {}) {
  const ttl = opts.ttlDays ?? 30;
  const store = new Map<string, { at: number; value: any }>();
  const now = () => Date.now();
  const alive = (entry: { at: number } | undefined) =>
    Boolean(entry) && now() - entry!.at < ttl * 24 * 60 * 60 * 1000;

  const cache: PlaceCache = {
    async getSearch(key) {
      const e = store.get(key);
      return alive(e) ? e!.value : null;
    },
    async putSearch(key, _query, candidates) {
      if (opts.failWrites) throw new Error("cache เขียนไม่ได้");
      store.set(key, { at: now(), value: candidates });
    },
    async getDetails(placeId) {
      const e = store.get(`details:${placeId}`);
      return alive(e) ? e!.value : null;
    },
    async putDetails(place) {
      if (opts.failWrites) throw new Error("cache เขียนไม่ได้");
      store.set(`details:${place.placeId}`, { at: now(), value: place });
    },
  };
  return { cache, store };
}

/** deps ปลอม ๆ ที่นับคำขอเอง */
function fakeDeps(opts: {
  search?: (q: string) => Promise<PlaceCandidate[]>;
  details?: (id: string) => Promise<PlaceCandidate | null>;
  cache?: PlaceCache | null;
}) {
  const calls: string[] = [];
  const deps: PlaceLookupDeps = {
    search: async (q) => {
      calls.push(`search:${q}`);
      return opts.search ? opts.search(q) : [];
    },
    details: async (id) => {
      calls.push(`details:${id}`);
      return opts.details ? opts.details(id) : null;
    },
    cache: opts.cache ?? null,
  };
  return { deps, calls };
}

const SCOPE = {
  community: "บ้านปาย",
  subdistrict: "สุเทพ",
  district: "เมือง",
  province: "เชียงใหม่",
};

// ─────────────────────────────────────────────
//  1) การหาชื่อสถานที่จากข้อความ
// ─────────────────────────────────────────────
function testIntent() {
  console.log("\n=== 1) การหาชื่อสถานที่จากข้อความ ===");

  // ชื่อที่แอปส่งมา = ชัดเจนที่สุด
  eq(
    "ชื่อที่แอปส่งมา → ได้ชื่อนั้นเลย",
    extractPlaceIntent({ text: "เปิดกี่โมง", placeName: "บ้านปาย" }),
    { name: "บ้านปาย", source: "placeName", confidence: "exact" }
  );

  // ชื่อในทะเบียน — ชื่อยาวกว่าชนะ (บ้านปายใหม่ > บ้านปาย)
  eq(
    "ชื่อในทะเบียน → ชื่อยาวกว่าชนะ",
    extractPlaceIntent({
      text: "บ้านปายใหม่เปิดกี่โมง",
      registryNames: ["บ้านปาย", "บ้านปายใหม่"],
    }),
    { name: "บ้านปายใหม่", source: "registry", confidence: "high" }
  );

  // ชื่อในโฟลเดอร์
  eq(
    "ชื่อในโฟลเดอร์ → ได้ชื่อนั้น",
    extractPlaceIntent({
      text: "วิลลาสุเทพราคาเท่าไร",
      folderNames: ["วิลลาสุเทพ"],
    }),
    { name: "วิลลาสุเทพ", source: "folder", confidence: "high" }
  );

  // โฟลเดอร์สำคัญกว่าทะเบียน
  eq(
    "ชื่อในโฟลเดอร์มาก่อนทะเบียน",
    extractPlaceIntent({
      text: "บ้านปายเปิดกี่โมง",
      folderNames: ["บ้านปาย"],
      registryNames: ["บ้านปาย"],
    }).source,
    "folder"
  );

  // ชื่อในเครื่องหมายคำพูด
  eq(
    "ชื่อใน \"...\" → ได้ชื่อนั้น",
    extractPlaceIntent({ text: 'อยากรู้เรื่อง "วัดพระธาตุดอยสุเทพ" ครับ' }),
    { name: "วัดพระธาตุดอยสุเทพ", source: "quoted", confidence: "high" }
  );

  // ลิงก์ Google Maps
  eq(
    "ลิงก์ maps/place → ได้ชื่อจากลิงก์",
    extractPlaceIntent({
      text: `ดูที่นี่ https://www.google.com/maps/place/${encodeURIComponent("บ้านปาย")}`,
    }),
    { name: "บ้านปาย", source: "maps-url", confidence: "high" }
  );

  // เดาจากประโยค (ต้องมีจังหวัดในบริบท)
  eq(
    "เดาจากประโยค + มีจังหวัด → ได้ชื่อ",
    extractPlaceIntent({ text: "บ้านปายเปิดกี่โมง", hasProvince: true }),
    { name: "บ้านปาย", source: "heuristic", confidence: "low" }
  );
  eq(
    "เดาจากประโยค + ไม่มีจังหวัด → ยังเดาชื่อ (ไม่กรองจังหวัด แต่ให้ผู้ใช้เลือกตอนชื่อซ้ำ)",
    extractPlaceIntent({ text: "บ้านปายเปิดกี่โมง", hasProvince: false }),
    { name: "บ้านปาย", source: "heuristic", confidence: "low" }
  );
  eq(
    "ถามว่าอยู่ที่ไหน → ตัดคำถามออก ได้ชื่อสถานที่",
    extractPlaceIntent({ text: "แม่ยายโฮมเสตย์คิดที่ไหน", hasProvince: false }),
    { name: "แม่ยายโฮมเสตย์", source: "heuristic", confidence: "low" }
  );
  eq(
    "ขึ้นต้นด้วยคำถามเรื่องราคา → ไม่เดา",
    extractPlaceIntent({ text: "ราคาห้องพักเท่าไหร่", hasProvince: false }),
    {
      name: null,
      source: null,
      confidence: "low",
      reason:
        "ไม่พบชื่อในโฟลเดอร์/ทะเบียน/เครื่องหมายคำพูด/ลิงก์แมพ " +
        "และเดาชื่อจากข้อความไม่ได้ (ไม่ยิง Google)",
    }
  );

  // คำถามที่ไม่มีชื่อสถานที่
  eq(
    "คำถามวางแผนทริป → ไม่มีชื่อ",
    extractPlaceIntent({ text: "ช่วยวางแผนทริป 3 วัน", hasProvince: true }),
    {
      name: null,
      source: null,
      confidence: "low",
      reason:
        "ไม่พบชื่อในโฟลเดอร์/ทะเบียน/เครื่องหมายคำพูด/ลิงก์แมพ " +
        "และเดาชื่อจากข้อความไม่ได้ (ไม่ยิง Google)",
    }
  );
  eq(
    "คำถามทั่วไป → ไม่มีชื่อ",
    extractPlaceIntent({ text: "อยากเที่ยวที่ไหนดี", hasProvince: true }),
    {
      name: null,
      source: null,
      confidence: "low",
      reason:
        "ไม่พบชื่อในโฟลเดอร์/ทะเบียน/เครื่องหมายคำพูด/ลิงก์แมพ " +
        "และเดาชื่อจากข้อความไม่ได้ (ไม่ยิง Google)",
    }
  );
  eq("ข้อความว่าง → ไม่มีชื่อ", extractPlaceIntent({ text: "  " }), {
    name: null,
    source: null,
    confidence: "low",
    reason: "ไม่มีข้อความ",
  });

  // ตัดคำนำหน้า + ตัดท้ายคำถาม
  eq("ตัดคำนำหน้าที่พูดว่า", guessNameFromText("ขอบอกว่าที่นี่น่าเที่ยว"), null);
  eq("ตัดท้ายที่เป็นคำถาม", guessNameFromText("บ้านปายเปิดกี่โมง"), "บ้านปาย");
}

// ─────────────────────────────────────────────
//  2) งบคำขอ
// ─────────────────────────────────────────────
async function testBudget() {
  console.log("\n=== 2) งบคำขอ ===");

  const full = fake("p1", "บ้านปาย", {
    phone: "081-234-5678",
    openingHours: "จันทร์: 08:00-17:00",
    website: "https://example.com",
  });

  // ทะเบียนครบข้อมูล → ไม่ยิงเลย
  {
    const { deps, calls } = fakeDeps({});
    const base: PlaceContext = {
      placeName: "บ้านปาย",
      phone: "081-234-5678",
      openingHours: "จันทร์: 08:00-17:00",
      website: "https://example.com",
    };
    const r = await lookupPlace({
      text: "บ้านปายเปิดกี่โมง",
      base,
      basePlaceId: "p1",
      scope: SCOPE,
      deps,
    });
    eq("ทะเบียนครบข้อมูล → 0 คำขอ", calls.length, 0);
    check("ทะเบียนครบข้อมูล → ยังได้ข้อมูลเดิม", r.context?.placeName === "บ้านปาย");
  }

  // ทะเบียนมี place_id แต่ขาดเบอร์ → details 1 ครั้ง ไม่ค้นชื่อ
  {
    const { deps, calls } = fakeDeps({ details: async () => full });
    const base: PlaceContext = { placeName: "บ้านปาย", openingHours: "08:00-17:00" };
    const r = await lookupPlace({
      text: "บ้านปายโทรได้ที่ไหน",
      base,
      basePlaceId: "p1",
      scope: SCOPE,
      deps,
    });
    eq("ทะเบียนขาดเบอร์ → details 1 ครั้ง (ไม่ค้นชื่อ)", calls, ["details:p1"]);
    eq("เติมเบอร์จาก Google", r.context?.phone, "081-234-5678");
    check("ข้อมูลที่มีอยู่แล้วไม่หาย", r.context?.openingHours === "08:00-17:00");
  }

  // ไม่มีทะเบียน → search 1 + details 1
  {
    const { deps, calls } = fakeDeps({
      search: async () => [fake("p1", "บ้านปาย")],
      details: async () => full,
    });
    const r = await lookupPlace({
      text: "บ้านปายเปิดกี่โมง",
      scope: SCOPE,
      deps,
    });
    eq("ไม่มีทะเบียน → search 1 + details 1", calls.length, 2);
    check("ได้ข้อมูลจาก Google", r.context?.phone === "081-234-5678");
    eq("ที่มาของข้อมูล = google", r.source, "google");
  }

  // ไม่มีชื่อ → 0 คำขอ
  {
    const { deps, calls } = fakeDeps({});
    const r = await lookupPlace({ text: "อยากเที่ยวที่ไหนดี", scope: SCOPE, deps });
    eq("ไม่มีชื่อ → 0 คำขอ", calls.length, 0);
    check("ไม่มีชื่อ → ไม่มีข้อมูล", r.context === null);
  }

  // ผู้ใช้เลือกสถานที่จากรายการ → details ตรง ไม่ค้นชื่อ
  {
    const { deps, calls } = fakeDeps({ details: async () => full });
    const r = await lookupPlace({
      text: "เปิดกี่โมง",
      placeId: "p9",
      scope: SCOPE,
      deps,
    });
    eq("เลือกจากรายการ → details 1 ครั้ง ไม่ค้นชื่อ", calls, ["details:p9"]);
    eq("เลือกจากรายการ → ที่มาของข้อมูล = google", r.source, "google");
  }

  // ปิดด้วย env → ไม่ยิงเลย
  {
    const { deps, calls } = fakeDeps({ search: async () => [fake("p1", "บ้านปาย")] });
    const prev = process.env.PLACES_LOOKUP;
    process.env.PLACES_LOOKUP = "off";
    const r = await lookupPlace({ text: "บ้านปายเปิดกี่โมง", scope: SCOPE, deps });
    process.env.PLACES_LOOKUP = prev;
    eq("ปิดด้วย PLACES_LOOKUP=off → 0 คำขอ", calls.length, 0);
    check("ปิดด้วย env → ไม่มีข้อมูล", r.context === null);
  }
}

// ─────────────────────────────────────────────
//  3) gate กันจับสถานที่ผิด
// ─────────────────────────────────────────────
function testGate() {
  console.log("\n=== 3) gate กันจับสถานที่ผิด ===");

  const right = fake("p1", "บ้านปาย");

  eq("ชื่อตรง → ผ่าน", pickCandidates("บ้านปาย", [right], SCOPE).length, 1);
  eq(
    "ชื่อไม่ตรง → ตก",
    pickCandidates("บ้านปาย", [fake("p2", "คาเฟ่ริมน้ำ")], SCOPE).length,
    0
  );
  eq(
    "ผิดจังหวัด → ตก",
    pickCandidates("บ้านปาย", [fake("p3", "บ้านปาย", { province: "ลำปาง" })], SCOPE).length,
    0
  );
  eq(
    "ปิดถาวร → ตก",
    pickCandidates(
      "บ้านปาย",
      [fake("p4", "บ้านปาย", { businessStatus: "CLOSED_PERMANENTLY" })],
      SCOPE
    ).length,
    0
  );
  eq("ชื่อสั้นเกิน → ไม่ค้นเลย", pickCandidates("ป้า", [right], SCOPE).length, 0);
  eq(
    "ไม่มีอันไหนผ่าน → ไม่มีผู้มีคัดเลย",
    pickCandidates("บ้านปาย", [fake("p5", "ร้านกาแฟ")], SCOPE).length,
    0
  );

  // ต่างตำบล → ถ้ามีอันที่ตรงตำบลอยู่ ให้ตัดอันต่างตำบลออก
  const sameProvinceOtherSub = fake("p6", "บ้านปาย", { subdistrict: "บ้านป่า" });
  eq(
    "ต่างตำบล + มีอันตรงตำบล → เหลืออันที่ตรง",
    pickCandidates("บ้านปาย", [sameProvinceOtherSub, right], SCOPE).map((c) => c.placeId),
    ["p1"]
  );

  // ไม่มีขอบเขต → ไม่กรอง
  eq(
    "ไม่มีขอบเขต → ไม่ตัดอะไร",
    pickCandidates("บ้านปาย", [right], null).length,
    1
  );

  // ปิดชั่วคราว → ยังผ่าน (ไม่ใช่ปิดถาวร)
  eq(
    "ปิดชั่วคราว → ยังเอามาใช้",
    pickCandidates(
      "บ้านปาย",
      [fake("p7", "บ้านปาย", { businessStatus: "CLOSED_TEMPORARILY" })],
      SCOPE
    ).length,
    1
  );

  // ชื่อที่คนพิมพ์/พูด มักไม่ตรงกับชื่อที่ Google มีเป๊ะ
  eq(
    "สะกดต่าง + มีชื่อหมู่บ้านต่อท้าย → ผ่าน",
    pickCandidates("แม่ยายโฮมเสตย์", [fake("p8", "แม่ยาย โฮมสเตย์ ห้วยห้อม")], null).length,
    1
  );
  eq(
    "สะกดต่างเล็กน้อย → ผ่าน",
    pickCandidates("โรงแรมแม่ยาย", [fake("p9", "โรงแรมแม่ยาย ปาย")], null).length,
    1
  );
  eq(
    "ชื่อคนละแห่งที่คล้ายกัน → ตก",
    pickCandidates("โรงแรมแม่ยาย", [fake("p10", "โรงแรมแม่นา")], null).length,
    0
  );
  eq(
    "ชื่อไม่เกี่ยวกันเลย → ตก",
    pickCandidates("แม่ยายโฮมเสตย์", [fake("p11", "คาเฟ่ริมน้ำ")], null).length,
    0
  );
  eq(
    "ชื่อสั้น → ไม่ยอมใกล้เคียง",
    pickCandidates("ปาย", [fake("p12", "ปายหมู่บ้าน")], null).length,
    0
  );
}

// ─────────────────────────────────────────────
//  4) กฎ merge
// ─────────────────────────────────────────────
function testMerge() {
  console.log("\n=== 4) กฎ merge (host ชนะเสมอ) ===");

  const base: PlaceContext = {
    placeName: "บ้านปาย",
    priceInfo: "วันธรรมดา 800 / วันหยุด 1,200",
    businessPricing: { weekday: { amount: "800" }, weekend: { amount: "1200" } },
    businessHours: { mon: [{ open: "08:00", close: "17:00" }] },
    capacity: { rooms: "3" },
    rules: ["รับวันละ 1 กลุ่ม"],
    areas: ["โซนเจ้าบ้าน"],
    facilities: ["ระเบียง"],
    priceLevel: "฿฿",
    phone: "081-111-1111",
  };
  const google = contextFromCandidate(
    fake("p1", "บ้านปาย", {
      phone: "081-999-9999",
      openingHours: "จันทร์: 09:00-18:00",
      website: "https://example.com",
      priceLevel: 1,
      rating: 4.8,
      userRatingCount: 300,
      primaryTypeDisplayName: "ที่พัก",
      businessStatus: "CLOSED_TEMPORARILY",
    })
  );

  const merged = mergePlaceContext(base, google, "mixed");
  check("merge ได้ผลลัพธ์", merged !== null);
  const m = merged as PlaceContext;

  eq("เบอร์ของ host ไม่ถูกทับ", m.phone, "081-111-1111");
  eq("ราคาของ host ไม่ถูกทับ", m.priceInfo, "วันธรรมดา 800 / วันหยุด 1,200");
  eq("ระดับราคาของ host ไม่ถูกทับ", m.priceLevel, "฿฿");
  eq("เวลาเปิดแยกรายวันของ host ไม่ถูกแตะ", m.businessHours, base.businessHours);
  eq("ความจุของ host ไม่ถูกแตะ", m.capacity, base.capacity);
  eq("กติกาของ host ไม่ถูกแตะ", m.rules, base.rules);
  eq("โซนของ host ไม่ถูกแตะ", m.areas, base.areas);
  eq("สิ่งอำนวยความสะดวกของ host ไม่ถูกแตะ", m.facilities, base.facilities);

  eq("เวลาเปิดของ Google เติมช่องที่ว่าง", m.openingHours, "จันทร์: 09:00-18:00");
  eq("เว็บไซต์ของ Google เติมช่องที่ว่าง", m.website, "https://example.com");
  eq("เรตติงมาจาก Google", m.rating, 4.8);
  eq("จำนวนรีวิวมาจาก Google", m.userRatingsTotal, 300);
  eq("ประเภทมาจาก Google", m.category, "ที่พัก");
  eq("สถานะมาจาก Google", m.businessStatus, "ปิดชั่วคราว");
  eq("google place id มาจาก Google", m.googlePlaceId, "p1");
  eq("ที่มาของข้อมูล = mixed", m.source, "mixed");

  // Google ต้องไม่มีโอกาสเขียนทับ businessHours
  check(
    "เวลาเปิดของ Google ไม่หลุดไป businessHours",
    m.businessHours === base.businessHours &&
      JSON.stringify(m.businessHours).indexOf("09:00") === -1
  );

  // เว้นว่าง → เติมจาก Google ได้
  const emptyBase: PlaceContext = { placeName: "บ้านปาย" };
  const m2 = mergePlaceContext(emptyBase, google, "mixed") as PlaceContext;
  eq("ช่องที่ว่าง → เติมจาก Google", m2.phone, "081-999-9999");
  eq("ระดับราคาที่ว่าง → เติมจาก Google", m2.priceLevel, "฿");

  // มีแต่ Google
  const onlyGoogle = mergePlaceContext(null, google, "google") as PlaceContext;
  eq("ไม่มีข้อมูล host → ใช้ของ Google", onlyGoogle.phone, "081-999-9999");
  eq("ไม่มีข้อมูล host → ที่มา = google", onlyGoogle.source, "google");

  // ระดับราคา
  eq("ระดับราคา 0 = ฟรี", priceLevelLabel(0), "ฟรี");
  eq("ระดับราคา 2 = ฿฿", priceLevelLabel(2), "฿฿");
  eq("ระดับราคา 4 = ฿฿฿฿", priceLevelLabel(4), "฿฿฿฿");
  eq("ไม่มีระดับราคา = null", priceLevelLabel(null), null);
}

// ─────────────────────────────────────────────
//  5) cache
// ─────────────────────────────────────────────
async function testCache() {
  console.log("\n=== 5) cache ===");

  const full = fake("p1", "บ้านปาย", {
    phone: "081-234-5678",
    openingHours: "จันทร์: 08:00-17:00",
    website: "https://example.com",
  });

  // ครั้งที่สอง → ไม่คิดเงินอีก
  {
    const { cache } = fakeCache();
    const { deps, calls } = fakeDeps({
      search: async () => [fake("p1", "บ้านปาย")],
      details: async () => full,
      cache,
    });
    const first = await enrichPlace({ name: "บ้านปาย", scope: SCOPE, deps });
    eq("ครั้งแรก → search + details", calls.length, 2);
    check("ครั้งแรก → ได้ข้อมูล", first.context?.phone === "081-234-5678");

    const second = await enrichPlace({ name: "บ้านปาย", scope: SCOPE, deps });
    eq("ครั้งที่สอง → 0 คำขอ (ติด cache)", calls.length, 2);
    check("ครั้งที่สอง → ข้อมูลเหมือนเดิม", second.context?.phone === "081-234-5678");
  }

  // หมด TTL → ดึงใหม่
  {
    const { cache } = fakeCache({ ttlDays: 0 });
    const { deps, calls } = fakeDeps({
      search: async () => [fake("p1", "บ้านปาย")],
      details: async () => full,
      cache,
    });
    await enrichPlace({ name: "บ้านปาย", scope: SCOPE, deps });
    await enrichPlace({ name: "บ้านปาย", scope: SCOPE, deps });
    eq("หลัง cache หมดอายุ → ยิงใหม่", calls.length, 4);
  }

  // ค้นที่ไม่เจอ → ถูก cache (ไม่ยิงซ้ำ)
  {
    const { cache } = fakeCache();
    const { deps, calls } = fakeDeps({ search: async () => [], cache });
    const first = await enrichPlace({ name: "บ้านไม่มีอยู่จริง", scope: SCOPE, deps });
    eq("ค้นไม่เจอ → ยิง 1 ครั้ง", calls.length, 1);
    check("ค้นไม่เจอ → ไม่มีข้อมูล", first.context === null);
    const second = await enrichPlace({ name: "บ้านไม่มีอยู่จริง", scope: SCOPE, deps });
    eq("ค้นไม่เจอครั้งที่สอง → ไม่ยิงซ้ำ", calls.length, 1);
  }

  // cache เขียนพัง → ยังตอบได้
  {
    const { cache } = fakeCache({ failWrites: true });
    const { deps, calls } = fakeDeps({
      search: async () => [fake("p1", "บ้านปาย")],
      details: async () => full,
      cache,
    });
    const r = await enrichPlace({ name: "บ้านปาย", scope: SCOPE, deps });
    eq("cache เขียนพัง → ยังยิงและได้ข้อมูล", calls.length, 2);
    check("cache เขียนพัง → ได้ข้อมูลครบ", r.context?.phone === "081-234-5678");
  }
}

// ─────────────────────────────────────────────
//  6) รายการให้เลือกเมื่อชื่อซ้ำ
// ─────────────────────────────────────────────
async function testChoiceList() {
  console.log("\n=== 6) รายการให้เลือกเมื่อชื่อซ้ำ ===");

  const a = fake("p1", "บ้านปาย", { subdistrict: "สุเทพ", district: "เมือง" });
  const b = fake("p2", "บ้านปาย", { subdistrict: "บ้านป่า", district: "สันทิตย์" });

  const { deps, calls } = fakeDeps({ search: async () => [a, b] });
  const r = await enrichPlace({ name: "บ้านปาย", deps });
  eq("ชื่อซ้ำ 2 อัน → คืน 2 รายการ", r.candidates.length, 2);
  eq("ชื่อซ้ำ 2 อัน → ยังไม่ยิง details (ประหยัดเงิน)", calls.length, 1);
  check("รายการมีจังหวัด/อำเภอ/ตำบล", Boolean(r.candidates[0]?.province && r.candidates[0]?.district && r.candidates[0]?.subdistrict));
  check("รายการมีเรตติง", r.candidates[0]?.rating === 4.5);
  check("รายการมีลิงก์แมพ", Boolean(r.candidates[0]?.googleMapsUrl));

  // ชื่อเดียว → ไม่คืนรายการ
  const one = fakeDeps({
    search: async () => [a],
    details: async () => fake("p1", "บ้านปาย", { phone: "081-234-5678" }),
  });
  const r2 = await enrichPlace({ name: "บ้านปาย", deps: one.deps });
  eq("ชื่อเดียว → ไม่คืนรายการให้เลือก", r2.candidates.length, 0);
  check("ชื่อเดียว → ได้ข้อมูลตรง ๆ", Boolean(r2.context));
}

// ─────────────────────────────────────────────
//  7) prompt
// ─────────────────────────────────────────────
function testPrompt() {
  console.log("\n=== 7) prompt (หัวบล็อกขึ้นกับที่มาของข้อมูล) ===");

  const place: PlaceContext = {
    placeName: "บ้านปาย",
    phone: "081-234-5678",
    source: "google",
    category: "ที่พัก",
  };

  const googlePrompt = buildChatSystemPrompt(undefined, place);
  check(
    "source=google → ไม่ใช่หัวข้อ 'ยืนยันจากชุมชนและ Google Maps'",
    googlePrompt.indexOf("ยืนยันจากชุมชนและ Google Maps") === -1
  );
  check(
    "source=google → มีคำเตือนให้เช็กซ้ำ",
    googlePrompt.indexOf("คำเตือน") !== -1
  );
  check(
    "source=google → บอกว่ายังไม่มีเจ้าของยืนยัน",
    googlePrompt.indexOf("ยังไม่มีเจ้าของหรือชุมชนยืนยัน") !== -1
  );
  check("แสดงประเภทสถานที่", googlePrompt.indexOf("ประเภทสถานที่: ที่พัก") !== -1);

  const communityPrompt = buildChatSystemPrompt(undefined, {
    placeName: "บ้านปาย",
    source: "community",
  });
  check(
    "source=community → หัวข้อเดิม (ยืนยันจากชุมชนและ Google Maps)",
    communityPrompt.indexOf("ยืนยันจากชุมชนและ Google Maps") !== -1
  );
  check(
    "source=community → ไม่มีคำเตือน",
    communityPrompt.indexOf("คำเตือน: ข้อมูลชุดนี้มาจาก Google Maps") === -1
  );

  const legacyPrompt = buildChatSystemPrompt(undefined, { placeName: "บ้านปาย" });
  check(
    "ไม่ระบุที่มา (ของเดิม) → หัวข้อเดิมเหมือนเดิมทุกประการ",
    legacyPrompt.indexOf("[ข้อมูลสถานที่ยืนยันจากชุมชนและ Google Maps (Verified Ground Truth - ใช้ตอบคำถามได้ทันที)]:") !== -1
  );
  check(
    "ไม่ระบุที่มา → ไม่มีคำเตือนใหม่",
    legacyPrompt.indexOf("คำเตือน: ข้อมูลชุดนี้มาจาก Google Maps") === -1
  );

  const mixedPrompt = buildChatSystemPrompt(undefined, {
    placeName: "บ้านปาย",
    source: "mixed",
  });
  check("source=mixed → มีคำเตือน", mixedPrompt.indexOf("คำเตือน") !== -1);
}

// ─────────────────────────────────────────────
//  8) แพลนทริป
// ─────────────────────────────────────────────
async function testTripDestinations() {
  console.log("\n=== 8) แพลนทริป (จุดหมาย) ===");

  const names = ["ดอยสุเทพ", "บ้านปาย", "วัดพระธาตุ", "ปางอุ๋ง", "หมู่บ้านสันทิตย์"];
  const { deps, calls } = fakeDeps({
    search: async (q) => [fake(`id-${q}`, q)],
    details: async (id) => fake(id, id.replace(/^id-/, ""), { phone: "081-000-0000" }),
  });

  const r = await enrichDestinations({ names, max: 4, deps });
  check("5 จุดหมาย + ลิมิต 4 → เติมไม่เกิน 4", r.contexts.length <= 4, `ได้ ${r.contexts.length}`);
  check("จุดหมายที่เติมได้มีชื่อ", r.contexts.every((c) => Boolean(c.placeName)));

  // จุดหมายที่ไม่ผ่าน gate → ไม่ถูกเอาไป
  const bad = fakeDeps({
    search: async () => [fake("p1", "คาเฟ่ริมน้ำ")],
    details: async () => fake("p1", "คาเฟ่ริมน้ำ"),
  });
  const r2 = await enrichDestinations({ names: ["บ้านปาย"], deps: bad.deps });
  eq("จุดหมายที่ไม่ผ่าน gate → ไม่อยู่ในบล็อก", r2.contexts.length, 0);
}

// ─────────────────────────────────────────────
//  9) ชื่อชุมชน
// ─────────────────────────────────────────────
async function testCommunityName() {
  console.log("\n=== 9) ชื่อชุมชน ===");
  // ไม่มี Supabase ในเทสต์ → คืน null โดยไม่พัง
  const name = await communityNameFor({ subdistrict: "สุเทพ", province: "เชียงใหม่" });
  check("ไม่มีฐานข้อมูล → คืน null โดยไม่พัง", name === null);
}

// ─────────────────────────────────────────────
//  10) โฟลเดอร์ — ใช้ข้อมูลที่สรุปไว้ในโฟลเดอร์เลย
// ─────────────────────────────────────────────
async function testFolderPath() {
  console.log("\n=== 10) โฟลเดอร์ ===");

  const folderPlace: FolderPlace = {
    key: "a:วิลลาสุเทพ|เชียงใหม่",
    name: "วิลลาสุเทพ",
    source: "clip",
    matchKind: "clip-text",
    registryPlaceId: null,
    communityId: null,
    communityName: "สุเทพ",
    address: "สุเทพ เมือง เชียงใหม่",
    province: "เชียงใหม่",
    district: "เมือง",
    latitude: null,
    longitude: null,
    clipCount: 2,
    videoIds: [],
    facts: { price: "1,200", openingHours: "ทุกวัน 08:00-18:00", phone: "081-000-0000" },
  };

  // ชื่อที่พิมพ์ตรงกับสถานที่ในโฟลเดอร์ → ไม่ยิง Google
  {
    const { deps, calls } = fakeDeps({});
    const r = await lookupPlace({
      text: "วิลลาสุเทพเปิดกี่โมง",
      folderPlaces: [folderPlace],
      scope: SCOPE,
      deps,
    });
    eq("โฟลเดอร์ → ไม่ยิง Google เลย", calls.length, 0);
    eq("โฟลเดอร์ → ได้ชื่อสถานที่", r.context?.placeName, "วิลลาสุเทพ");
    eq("โฟลเดอร์ → ได้เวลาเปิดจากโฟลเดอร์", r.context?.openingHours, "ทุกวัน 08:00-18:00");
    eq("โฟลเดอร์ → ได้ราคาจากโฟลเดอร์", r.context?.priceInfo, "1,200");
  }

  // ชื่อที่พิมพ์ไม่ตรงกับโฟลเดอร์ → ต้องไปค้นชื่อ
  {
    const { deps, calls } = fakeDeps({
      search: async () => [fake("p1", "บ้านปาย")],
      details: async () => fake("p1", "บ้านปาย", { phone: "081-234-5678" }),
    });
    const r = await lookupPlace({
      text: "บ้านปายเปิดกี่โมง",
      folderPlaces: [folderPlace],
      scope: SCOPE,
      deps,
    });
    eq("ชื่อไม่ตรงกับโฟลเดอร์ → ค้นชื่อ", calls.length, 2);
    eq("ชื่อไม่ตรงกับโฟลเดอร์ → ได้ข้อมูลจาก Google", r.context?.phone, "081-234-5678");
  }

  // มีทะเบียนอยู่แล้ว → ทะเบียนชนะโฟลเดอร์ (ข้อมูล host แน่นกว่า)
  {
    const { deps, calls } = fakeDeps({});
    const base: PlaceContext = {
      placeName: "บ้านปาย",
      priceInfo: "วันธรรมดา 800",
      phone: "081-111-1111",
      openingHours: "08:00-17:00",
      website: "https://example.com",
    };
    const r = await lookupPlace({
      text: "วิลลาสุเทพเปิดกี่โมง",
      base,
      basePlaceId: "p1",
      folderPlaces: [folderPlace],
      scope: SCOPE,
      deps,
    });
    eq("มีทะเบียนแล้ว → ไม่ยิง Google", calls.length, 0);
    eq("มีทะเบียนแล้ว → ใช้ข้อมูลทะเบียน", r.context?.priceInfo, "วันธรรมดา 800");
  }
}

// ─────────────────────────────────────────────
//  11) บล็อกข้อมูล Google สำหรับแผนทริป
// ─────────────────────────────────────────────
function testTripGoogleBlock() {
  console.log("\n=== 11) บล็อกข้อมูล Google (แผนทริป) ===");

  // ไม่มีข้อมูลเลย → ไม่เพิ่มบล็อก
  eq("ไม่มีข้อมูล → บล็อกว่าง", buildGoogleBlock([], [], ""), "");

  const block = buildGoogleBlock(
    [
      {
        placeName: "บ้านปาย",
        subdistrict: "ป่าแดง",
        district: "เมือง",
        province: "เชียงใหม่",
        phone: "081-234-5678",
        openingHours: "จันทร์ 08:00-18:00",
        priceLevel: "฿฿",
        rating: 4.5,
        userRatingsTotal: 120,
        category: "ที่พัก",
        businessStatus: "เปิดทำการ",
        googleMapsUrl: "https://maps.google.com/?cid=1",
      },
    ],
    [
      {
        name: "วัดพระธาตุดอยสุเทพ",
        label: "วัด",
        distanceKm: 2.14,
        rating: 4.6,
      },
    ],
    "บ้านปาย"
  );

  check("บล็อกมีชื่อสถานที่", block.includes("บ้านปาย"));
  check("บล็อกมีเบอร์", block.includes("081-234-5678"));
  check("บล็อกมีเวลาเปิด", block.includes("08:00-18:00"));
  check("บล็อกมีเรตติง", block.includes("4.5"));
  check("บล็อกมีประเภท", block.includes("ที่พัก"));
  check("บล็อกมีลิงก์แมพ", block.includes("maps.google.com"));
  check("บล็อกมีจุดใกล้เคียง", block.includes("วัดพระธาตุดอยสุเทพ"));
  check("บล็อกมีกฎห้ามเดา", block.includes("ห้ามเดา"));
  check("บล็อกบอกที่มาว่าเป็น Google", block.includes("Google Maps"));

  // จุดใกล้เคียงไม่เกิน 6 รายการ
  const many = Array.from({ length: 10 }, (_, i) => ({
    name: `จุดที่ ${i + 1}`,
    label: null,
    distanceKm: 1,
    rating: 4,
  }));
  const block2 = buildGoogleBlock([], many, "บ้านปาย");
  check("จุดใกล้เคียงไม่เกิน 6 รายการ", !block2.includes("จุดที่ 7"));
}

// ─────────────────────────────────────────────
//  12) ประเภทสถานที่ (Legacy ไม่คืนชื่อประเภท)
// ─────────────────────────────────────────────
function testCategory() {
  console.log("\n=== 12) ประเภทสถานที่ ===");

  eq(
    "types ทั่วไป → ข้ามไปหาประเภทจริง",
    categoryFromTypes(["point_of_interest", "establishment", "tourist_attraction"]),
    "จุดท่องเที่ยว"
  );
  eq("lodging → ที่พัก", categoryFromTypes(["lodging"]), "ที่พัก");
  eq("natural_feature → ธรรมชาติ", categoryFromTypes(["establishment", "natural_feature"]), "ธรรมชาติ");
  eq("cafe → คาเฟ่", categoryFromTypes(["cafe", "food", "restaurant"]), "คาเฟ่");
  eq("primaryType มาก่อน types", categoryFromTypes(["cafe"], "restaurant"), "ร้านอาหาร");
  eq("ไม่รู้จัก → null", categoryFromTypes(["some_unknown_type"]), null);
  eq("ไม่มี type เลย → null", categoryFromTypes([]), null);

  // PlaceContext ต้องมีประเภทจาก types ตอนที่ Legacy ไม่คืน display name
  const ctx = contextFromCandidate({
    name: "ดอยสุเทพ",
    address: "ดอยสุเทพ สุเทพ เมืองเชียงใหม่ เชียงใหม่",
    placeId: "p1",
    latitude: null,
    longitude: null,
    province: "เชียงใหม่",
    district: "เมืองเชียงใหม่",
    subdistrict: "สุเทพ",
    types: ["tourist_attraction", "point_of_interest"],
    primaryType: "tourist_attraction",
    primaryTypeDisplayName: null,
  });
  eq("PlaceContext มีประเภท", ctx.category, "จุดท่องเที่ยว");
}

// ─────────────────────────────────────────────
//  13) ชื่อจังหวัดที่ Google ใช้คนละชื่อ
// ─────────────────────────────────────────────
function testProvinceAlias() {
  console.log("\n=== 13) ชื่อจังหวัดคนละชื่อ (Google ใช้ชื่อเก่า) ===");

  // ขอบเขตแค่จังหวัด (ไม่มีตำบล/อำเภอ) → ให้ทดสอบแค่เรื่องจังหวัด
  const cmScope = {
    community: null,
    subdistrict: null,
    district: null,
    province: "เชียงใหม่",
  };

  eq(
    "แม่ฮ่องสอน (ชื่อเก่าของเชียงใหม่) → ผ่าน",
    pickCandidates(
      "บ้านปาย",
      [fake("p1", "บ้านปาย", { province: "แม่ฮ่องสอน" })],
      cmScope
    ).length,
    1
  );
  eq(
    "จ.แม่ฮ่องสอน (มีคำนำหน้า) → ผ่าน",
    pickCandidates(
      "บ้านปาย",
      [fake("p2", "บ้านปาย", { province: "จ.แม่ฮ่องสอน" })],
      cmScope
    ).length,
    1
  );
  eq(
    "จังหวัดเชียงใหม่ (มีคำนำหน้า) → ผ่าน",
    pickCandidates(
      "บ้านปาย",
      [fake("p3", "บ้านปาย", { province: "จังหวัดเชียงใหม่" })],
      cmScope
    ).length,
    1
  );
  eq(
    "จังหวัดอื่น → ตก",
    pickCandidates(
      "บ้านปาย",
      [fake("p4", "บ้านปาย", { province: "นครปฐม" })],
      cmScope
    ).length,
    0
  );
  eq(
    "กรุงเทพฯ = กรุงเทพมหานคร",
    pickCandidates(
      "บ้านปาย",
      [fake("p5", "บ้านปาย", { province: "กรุงเทพมหานคร" })],
      { community: null, subdistrict: null, district: null, province: "กรุงเทพฯ" }
    ).length,
    1
  );
  eq(
    "Google ไม่บอกจังหวัด → ไม่ตัด",
    pickCandidates(
      "บ้านปาย",
      [fake("p6", "บ้านปาย", { province: "" })],
      cmScope
    ).length,
    1
  );
}

// ─────────────────────────────────────────────
//  14) จับคู่ชื่อแบบยืดหยุ่น (เว้นวรรค/สะกดผิด/สลับลำดับคำ)
// ─────────────────────────────────────────────
function testNameSimilarity() {
  console.log("\n=== 14) จับคู่ชื่อแบบยืดหยุ่น ===");

  // คะแนนของชื่อที่ "เป็นชื่อเดียวกัน" ต้องสูง
  const sameName: [string, string][] = [
    ["แม่ยายโฮมสเตย์", "แม่ยาย โฮมสเตย์"], // เว้นวรรค
    ["แม่ยายโฮมเสดย์", "แม่ยายโฮมสเตย์"], // สะกดผิด
    ["แม่ยายโฮมเสตย์", "แม่ยายโฮมสเตย์"], // สลับตัวอักษร
    ["แม่ยายโฮมเสตย์", "แม่ยาย โฮมสเตย์ ห้วยห้อม"], // สะกดผิด + หางเป็นชื่อหมู่บ้าน
    ["แม่ยายโฮมเสดย์", "แม่ยาย โฮมสเตย์ ห้วยห้อม"], // สะกดผิด + หางเป็นชื่อหมู่บ้าน
    ["โฮมสเตย์แม่ยาย", "แม่ยาย โฮมสเตย์"], // สลับลำดับคำ
    ["โฮมสเตย์ แม่ยาย", "แม่ยาย โฮมสเตย์"], // สลับลำดับคำ (มีเวรรรค)
    ["บ้านปาย", "ร้านอาหารบ้านปาย"], // เป็นส่วนหนึ่งของอีกอัน
    ["โรงแรมแม่ยาย", "โรงแรมแม่ยาย ปาย"], // หางเป็นชื่อหมู่บ้าน
  ];
  for (const [a, b] of sameName) {
    check(
      `ชื่อเดียวกัน → ผ่าน: ${a} ↔ ${b}`,
      nameSimilarity(a, b) >= 0.8,
      `คะแนน ${nameSimilarity(a, b).toFixed(3)}`
    );
  }

  // คนละสถานที่ → ต้องไม่ผ่าน
  const otherName: [string, string][] = [
    ["โรงแรมแม่ยาย", "โรงแรมแม่นา"], // คล้ายกันแต่คนละแห่ง
    ["แม่ยายโฮมเสตย์", "คาเฟ่ริมน้ำ"], // ไม่เกี่ยวกันเลย
    ["ดอยสุเทพ", "ดอยตุง"], // คนละดอย
    ["บ้านปาย", "คาเฟ่ริมน้ำ"], // ไม่เกี่ยวกันเลย
    ["ปาย", "ปายหมู่บ้าน"], // ชื่อสั้น → ไม่ยอมใกล้เคียง
  ];
  for (const [a, b] of otherName) {
    check(
      `คนละแห่ง → ไม่ผ่าน: ${a} ↔ ${b}`,
      nameSimilarity(a, b) < 0.8,
      `คะแนน ${nameSimilarity(a, b).toFixed(3)}`
    );
  }

  // gate ของ Google ใช้เกณฑ์เดียวกัน
  eq(
    "gate: เว้นวรรค → ผ่าน",
    pickCandidates("แม่ยายโฮมสเตย์", [fake("p1", "แม่ยาย โฮมสเตย์ ห้วยห้อม")], null).length,
    1
  );
  eq(
    "gate: สะกดผิด → ผ่าน",
    pickCandidates("แม่ยายโฮมเสดย์", [fake("p1", "แม่ยาย โฮมสเตย์ ห้วยห้อม")], null).length,
    1
  );
  eq(
    "gate: สลับลำดับคำ → ผ่าน",
    pickCandidates("โฮมสเตย์แม่ยาย", [fake("p1", "แม่ยาย โฮมสเตย์")], null).length,
    1
  );
  eq(
    "gate: คนละแห่ง → ตก",
    pickCandidates("โรงแรมแม่ยาย", [fake("p1", "โรงแรมแม่นา")], null).length,
    0
  );

  // log ต้องบอกความจริง: ที่ "ผ่านแบบใกล้เคียง" ห้ามโผล่ในรายการ "ตก"
  const fuzzyTrace = filterCandidatesWithTrace(
    "แม่ยายโฮมเสดย์",
    [fake("p1", "แม่ยาย โฮมสเตย์ ห้วยห้อม")],
    null
  ).trace;
  check(
    "log: ที่ผ่านแบบใกล้เคียง → ไม่อยู่ในรายการตก",
    fuzzyTrace.dropped.length === 0 && fuzzyTrace.fuzzy.length === 1,
    `ตก ${fuzzyTrace.dropped.length} · ใกล้เคียง ${fuzzyTrace.fuzzy.length}`
  );
  const missTrace = filterCandidatesWithTrace(
    "โรงแรมแม่ยาย",
    [fake("p1", "โรงแรมแม่นา")],
    null
  ).trace;
  check(
    "log: ที่ไม่ผ่าน → อยู่ในรายการตกพร้อมคะแนน",
    missTrace.dropped.length === 1 && missTrace.fuzzy.length === 0,
    `ตก ${missTrace.dropped.length} · ใกล้เคียง ${missTrace.fuzzy.length}`
  );

  // ทะเบียน: สะกดผิด → จับคู่ชื่อในทะเบียนได้
  const registry = [{ place_name: "แม่ยาย โฮมสเตย์" }, { place_name: "บ้านปาย" }];
  const matched = findNameMatches("แม่ยายโฮมสเตย์เปิดกี่โมง", registry, (p) => p.place_name);
  eq("ทะเบียน: เว้นวรรค → จับคู่ได้", matched.map((m) => m.item.place_name), [
    "แม่ยาย โฮมสเตย์",
  ]);
  const matchedTypo = findNameMatches("แม่ยายโฮมเสดย์", registry, (p) => p.place_name);
  eq("ทะเบียน: สะกดผิด → จับคู่ได้", matchedTypo.map((m) => m.item.place_name), [
    "แม่ยาย โฮมสเตย์",
  ]);
  const matchedNone = findNameMatches("คาเฟ่ริมน้ำอยู่ที่ไหน", registry, (p) => p.place_name);
  eq("ทะเบียน: ชื่อไม่เกี่ยว → ไม่จับคู่", matchedNone.length, 0);

  // เดาชื่อจากข้อความ → จับคู่ทะเบียนแบบยืดหยุ่น (ก่อนไปค้น Google)
  eq(
    "intent: สะกดผิด → ใช้ชื่อในทะเบียน",
    extractPlaceIntent({
      text: "แม่ยายโฮมเสดย์เปิดกี่โมง",
      registryNames: ["แม่ยาย โฮมสเตย์"],
    }),
    { name: "แม่ยาย โฮมสเตย์", source: "registry", confidence: "high" }
  );
  eq(
    "intent: ชื่อคนละแห่ง → ไม่จับกับทะเบียน",
    extractPlaceIntent({
      text: "โรงแรมแม่นาเปิดกี่โมง",
      registryNames: ["โรงแรมแม่ยาย"],
    }).source,
    "heuristic"
  );

  // โฟลเดอร์: สะกดผิด → ยังจับคู่ได้
  const folderPlace: FolderPlace = {
    key: "a:แม่ยาย|เชียงใหม่",
    name: "แม่ยาย โฮมสเตย์",
    source: "clip",
    matchKind: "clip-text",
    registryPlaceId: null,
    communityId: null,
    communityName: "ห้วยห้อม",
    address: "ห้วยห้อม ปาย เชียงใหม่",
    province: "เชียงใหม่",
    district: "ปาย",
    latitude: null,
    longitude: null,
    clipCount: 1,
    videoIds: [],
    facts: {},
  };
  eq(
    "โฟลเดอร์: สะกดผิด → จับคู่ได้",
    findFolderPlace("แม่ยายโฮมเสดย์เปิดกี่โมง", [folderPlace])?.name,
    "แม่ยาย โฮมสเตย์"
  );
  eq(
    "โฟลเดอร์: ชื่อคนละแห่ง → ไม่จับคู่",
    findFolderPlace("โรงแรมแม่นาเปิดกี่โมง", [folderPlace]),
    null
  );
}

async function main() {
  console.log("=== เทสต์ 'ค้นข้อมูลสถานที่จาก Google' (ไม่ต่อเน็ต) ===");
  testIntent();
  await testBudget();
  testGate();
  testMerge();
  await testCache();
  await testChoiceList();
  testPrompt();
  await testTripDestinations();
  await testCommunityName();
  await testFolderPath();
  testTripGoogleBlock();
  testCategory();
  testProvinceAlias();
  testNameSimilarity();

  console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("เทสต์ล้มเหลว:", err?.message ?? err);
  process.exit(1);
});
