/**
 * เทสต์ออฟไลน์สำหรับ helper ของ POST /trips/plan
 * -------------------------------------------------------------
 * ทดสอบส่วนที่ "ตัดสินใจ" โดยไม่ต้องต่อเน็ต:
 *   · อ่านจุดเริ่ม/จุดสิ้นสุด (ต้องมีพิกัด)
 *   · เดาประเภทจุดจากชื่อ
 *   · จับคู่ชื่อที่ AI เขียน → ตัดชื่อที่แต่งขึ้น
 *   · คำนวณแผน: ไป-กลับจุดเดิม / จุดสิ้นสุดคนละจุด / หลายวัน / จุดที่ปิด
 *
 * รัน: npm run test:trip-plan-route
 */

import {
  readPlanPoint,
  guessStopType,
  reconcileName,
  reconcileAiPlan,
  normalizeFuelType,
  inferFuelTypeFromVehicleModel,
  persistPlan,
} from "../src/routes/trips";
import { buildTripPlan, type CandidateStop } from "../src/tripPlanner";
import { getVehicle } from "../src/vehicles";
import type { FuelPriceTable } from "../src/fuelPrice";
import type { RouteResult, LatLng } from "../src/routing";

// ── ตัวช่วยเทสต์ ─────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `ได้ ${JSON.stringify(actual)} · คาดว่า ${JSON.stringify(expected)}`
  );
}

// ── ข้อมูลจำลอง ──────────────────────────────────────────────────────────
const START = { label: "บ้าน", address: "เชียงใหม่", coords: { lat: 18.79, lng: 98.98 } };
const AIRPORT = { label: "สนามบินเชียงใหม่", coords: { lat: 18.766, lng: 98.962 } };

function stop(
  id: string,
  name: string,
  lat: number,
  lng: number,
  extra: Partial<CandidateStop> = {}
): CandidateStop {
  return {
    id,
    name,
    type: "attraction",
    coordinates: { lat, lng },
    ...extra,
  };
}

const CANDIDATES: CandidateStop[] = [
  stop("r:1", "วัดพระแก้ว", 18.788, 98.992),
  stop("r:2", "ร้านกาแฟบ้านสวน", 18.795, 98.986, { type: "cafe" }),
  stop("r:3", "ตลาดวโรราช", 18.787, 98.995, { type: "food" }),
  stop(
    "r:4",
    "บ้านพักริมน้ำ",
    18.82,
    99.02,
    { type: "accommodation", price: "1200 บาท/คืน" }
  ),
];

// ── 1. readPlanPoint ─────────────────────────────────────────────────────
console.log("\n[readPlanPoint]");
{
  const p = readPlanPoint({
    label: "บ้าน",
    address: "เชียงใหม่",
    coords: { lat: 18.79, lng: 98.98 },
  });
  ok("อ่าน label/address/coords ได้", p?.label === "บ้าน" && p?.address === "เชียงใหม่");
  eq("พิกัดตรงเป๊ะ", p?.coords, { lat: 18.79, lng: 98.98 });

  const p2 = readPlanPoint({ name: "สนามบิน", lat: 18.766, lon: 98.962 });
  ok("รับรูปแบบ lat/lon และ name", p2?.label === "สนามบิน");

  const p3 = readPlanPoint({ label: "ไม่มีพิกัด" });
  ok("ไม่มีพิกัด → null", p3 === null);

  const p4 = readPlanPoint({ label: "พิกัดแปลก", coords: { lat: 999, lng: 0 } });
  ok("พิกัดนอกโลก → null", p4 === null);

  ok("null → null", readPlanPoint(null) === null);
  ok("undefined → null", readPlanPoint(undefined) === null);
  ok("string → null", readPlanPoint("บ้าน") === null);
}

// ── 1b. ชนิดน้ำมันจากชื่อ/รุ่นรถ ──────────────────────────────────────────
console.log("\n[ชนิดน้ำมัน]");
{
  eq("normalizeFuelType: key", normalizeFuelType("gasohol95"), "gasohol95");
  eq("normalizeFuelType: ชื่อที่แสดง", normalizeFuelType("แก๊สโซฮอล์ 95"), "gasohol95");
  eq("normalizeFuelType: ไม่รู้จัก", normalizeFuelType("น้ำมันพืช"), null);
  eq("normalizeFuelType: ว่าง", normalizeFuelType(""), null);

  // เดาจากชื่อ/รุ่นรถ (ใช้เป็นค่าเริ่มต้นตอนที่เอไaiยังไม่ได้ระบุ)
  eq("D-Max → ดีเซล", inferFuelTypeFromVehicleModel("Isuzu D-Max"), "dieselB20");
  eq("Fortuner → ดีเซล", inferFuelTypeFromVehicleModel("Toyota Fortuner"), "dieselB20");
  eq("ดีเซล (ไทย) → ดีเซล", inferFuelTypeFromVehicleModel("รถดีเซล"), "dieselB20");
  eq("BYD → ไฟฟ้า", inferFuelTypeFromVehicleModel("BYD Atto 3"), "electric");
  eq("ไฟฟ้า (ไทย) → ไฟฟ้า", inferFuelTypeFromVehicleModel("รถไฟฟ้า"), "electric");
  eq("E20 → แก๊สโซฮอล์ E20", inferFuelTypeFromVehicleModel("Toyota Corolla E20"), "gasoholE20");
  eq("hybrid → แก๊สโซฮอล์ 95", inferFuelTypeFromVehicleModel("Corolla Hybrid"), "gasohol95");
  eq("ชื่อที่ไม่มีข้อมูล → null", inferFuelTypeFromVehicleModel("Toyota Corolla Altis"), null);
  eq("ว่าง → null", inferFuelTypeFromVehicleModel(""), null);
  eq("null → null", inferFuelTypeFromVehicleModel(null), null);
}

// ── 2. guessStopType ─────────────────────────────────────────────────────
console.log("\n[guessStopType]");
{
  eq("บ้านพัก → accommodation", guessStopType("บ้านพักริมน้ำ"), "accommodation");
  eq("โรงแรม → accommodation", guessStopType("โรงแรมสวนดอก"), "accommodation");
  eq("คาเฟ่ → cafe", guessStopType("คาเฟ่ริมน้ำปิง"), "cafe");
  eq("ร้านอาหาร → food", guessStopType("ร้านอาหารบ้านสวน"), "food");
  eq("วัด → community", guessStopType("วัดพระแก้ว"), "community");
  eq("อื่น ๆ → attraction", guessStopType("น้ำตก"), "attraction");
}

// ── 3. reconcileName ─────────────────────────────────────────────────────
console.log("\n[reconcileName]");
{
  eq("ชื่อตรงเป๊ะ → จับได้", reconcileName("วัดพระแก้ว", CANDIDATES)?.id, "r:1");
  eq(
    "ต่างแต่ช่องว่าง → จับได้",
    reconcileName("  วัดพระแก้ว  ", CANDIDATES)?.id,
    "r:1"
  );
  eq(
    "เกือบตรง (คำขยายนิดเดียว) → จับได้",
    reconcileName("วัดพระแก้ว จังหวัดเชียงใหม่", CANDIDATES)?.id,
    "r:1"
  );
  eq(
    "ชื่อที่แต่งขึ้น → null",
    reconcileName("วัดประตูฟ้าแหวนอมรณ์", CANDIDATES),
    null
  );
  eq("ชื่อว่าง → null", reconcileName("", CANDIDATES), null);
  eq("ไม่มีจุดให้จับ → null", reconcileName("วัดพระแก้ว", []), null);
}

// ── 4. reconcileAiPlan ───────────────────────────────────────────────────
console.log("\n[reconcileAiPlan]");
{
  const ai = {
    title: "ทริปเชียงใหม่ 1 วัน",
    summary: "ไปวัด กิน ถ่ายรูป",
    days: [
      {
        day: 1,
        title: "เชียงใหม่วันเดียว",
        theme: "วัฒนธรรม",
        stops: [
          { name: "วัดพระแก้ว", type: "attraction", activity: "ไหว้พระ", stayHours: 1 },
          { name: "ร้านกาแฟบ้านสวน", type: "cafe", activity: "กินขนม" },
          { name: "วัดประตูฟ้าแหวนอมรณ์", activity: "เที่ยว" },
        ],
      },
    ],
    budget: { food: 400, activities: 200, other: 100 },
    tips: ["ไปเช้าเพื่อเลี่ยงคนเยอะ"],
    warnings: ["เช็คเวลาเปิดของตลาดวโรราชก่อน"],
  };

  const r = reconcileAiPlan(ai, CANDIDATES, 1);
  eq("ชื่อที่แต่งขึ้นถูกตัดทิ้ง", r.droppedNames, ["วัดประตูฟ้าแหวนอมรณ์"]);
  eq("เลือกได้ 2 จุด", r.selection?.days[0].stops.length, 2);
  eq(
    "ชื่อถูกเขียนกลับเป็นชื่อจริง",
    r.selection?.days[0].stops[0].name,
    "วัดพระแก้ว"
  );
  eq("กิจกรรมจาก AI ถูกเก็บ", r.selection?.days[0].stops[0].activity, "ไหว้พระ");
  eq("stayHours ถูกเก็บ", r.selection?.days[0].stops[0].stayHours, 1);
  eq("ไม่มีจุดที่ AI แต่ง", r.usedIds.size, 2);
  eq("งบอาหาร", r.budget?.food, 400);
  eq("tips", r.tips, ["ไปเช้าเพื่อเลี่ยงคนเยอะ"]);
  eq("warnings", r.warnings?.length, 1);

  // ชื่อซ้ำ → เก็บแค่ครั้งเดียว
  const dup = reconcileAiPlan(
    {
      days: [
        {
          day: 1,
          stops: [
            { name: "วัดพระแก้ว" },
            { name: "วัดพระแก้ว" },
          ],
        },
      ],
    },
    CANDIDATES,
    1
  );
  eq("ชื่อซ้ำ → เก็บครั้งเดียว", dup.selection?.days[0].stops.length, 1);

  // ไม่มี AI → selection = null
  const none = reconcileAiPlan(null, CANDIDATES, 1);
  eq("ไม่มี AI → selection null", none.selection, null);

  // AI คืนรูปแบบแปลก → ไม่ล้ม
  const weird = reconcileAiPlan({ days: "ไม่ใช่ array" }, CANDIDATES, 1);
  eq("รูปแบบแปลก → selection null", weird.selection, null);
}

// ── 5. buildTripPlan (ต่อวงจรปิดจริง) ────────────────────────────────────
console.log("\n[buildTripPlan]");

const FUEL_TABLE: FuelPriceTable = {
  prices: { gasohol95: 41.54, gasohol91: 41.17, diesel: 42.54 },
  fetchedAt: "2026-11-04T09:00:00.000Z",
  effectiveDate: "4 November 2026",
  source: "pttor.com",
  origin: "pttor.com",
  isEstimate: false,
  url: "https://www.pttor.com/",
};

/** เส้นทางจำลอง: ระยะ = 40 กม./ขา เวลา = 45 นาที/ขา */
function fakeRoute(points: LatLng[]): Promise<RouteResult> {
  const legs = points.slice(1).map((_, i) => ({
    fromIndex: i,
    toIndex: i + 1,
    km: 40,
    minutes: 45,
  }));
  return Promise.resolve({
    ok: true,
    km: legs.reduce((s, l) => s + l.km, 0),
    minutes: legs.reduce((s, l) => s + l.minutes, 0),
    legs,
    geometry: points,
    snapped: points,
    source: "osrm" as const,
  });
}

const baseInput = {
  days: 1,
  date: "2026-11-08",
  startTime: "08:00",
  startPoint: START,
  endPoint: START,
  returnMode: "same_as_start" as const,
  vehicle: getVehicle("private_car"),
  fuelType: "gasohol95" as const,
  travelers: 2,
  budgetPerPerson: 3000,
  style: "ธรรมชาติ",
  candidates: CANDIDATES,
};

// ── 7. persistPlan: บันทึกใหม่ vs อัปเดตทับแถวเดิม ───────────────────────

/**
 * ตัวแทน client ของ Supabase (service_role) ที่จดทุกคำสั่งที่ถูกเรียก
 * → ทดสอบ logic การบันทึกได้โดยไม่ต้องต่อฐานข้อมูลจริง
 */
function fakeAdmin(opts?: {
  existing?: any;
  updateError?: any;
  insertError?: any;
}) {
  const calls: { insert?: any; update?: any } = {};

  // chain เป็น thenable เพื่อให้รองรับทั้ง `await query` และ `.maybeSingle()`
  const chain = (result: any) => {
    const c: any = {
      eq: () => c,
      select: () => c,
      maybeSingle: async () => result,
      single: async () => result,
      then: (resolve: any, reject: any) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return c;
  };

  const admin: any = {
    calls,
    from: () => ({
      select: () => chain({ data: opts?.existing ?? null, error: null }),
      update: (payload: any) => {
        calls.update = payload;
        return chain({ error: opts?.updateError ?? null });
      },
      insert: (payload: any) => {
        calls.insert = payload;
        return chain({
          data: { id: "new-plan-id" },
          error: opts?.insertError ?? null,
        });
      },
    }),
  };
  return admin;
}

const PERSIST_REQ: any = {
  startPoint: "บ้าน",
  destinations: ["วัดพระแก้ว"],
  days: 1,
  nights: 0,
  budgetPerPerson: 3000,
  style: "โร้ดทริปธรรมชาติ",
  departDate: "2026-11-08",
  endPoint: "บ้าน",
};

const PERSIST_PLAN: any = {
  title: "ทริปเชียงใหม่ 1 วัน",
  summary: "แผนทดสอบ",
  days: [],
};

async function testPersistPlan() {
  {
    // ยังไม่มีแผนเดิม → สร้างแถวใหม่
    const admin = fakeAdmin();
    const res = await persistPlan({
      admin,
      creatorId: "u1",
      folderId: null,
      folderName: null,
      tripReq: PERSIST_REQ,
      plan: PERSIST_PLAN,
      source: "planner",
      existingPlanId: null,
    });
    ok("บันทึกครั้งแรก = insert", Boolean(admin.calls.insert) && !admin.calls.update);
    eq("ได้รหัสแผนใหม่", res.planId, "new-plan-id");
    ok("บันทึกสำเร็จ", res.persisted === true);
    eq("สถานะแถวใหม่ = draft", admin.calls.insert?.status, "draft");
    eq(
      "สถานะของแอปใน meta = draft",
      admin.calls.insert?.itinerary_data?.__meta?.appStatus,
      "draft"
    );
  }

  {
    // มีแผนเดิมของผู้ใช้คนเดียวกัน → อัปเดตทับ ไม่สร้างซ้ำ
    const admin = fakeAdmin({
      existing: {
        id: "plan-1",
        creator_id: "u1",
        itinerary_data: { __meta: { appStatus: "planned" } },
      },
    });
    const res = await persistPlan({
      admin,
      creatorId: "u1",
      folderId: null,
      folderName: null,
      tripReq: PERSIST_REQ,
      plan: PERSIST_PLAN,
      source: "planner",
      existingPlanId: "plan-1",
    });
    ok("มีแผนเดิม = update ไม่ insert", Boolean(admin.calls.update) && !admin.calls.insert);
    eq("ได้รหัสแผนเดิม", res.planId, "plan-1");
    ok("อัปเดตสำเร็จ", res.persisted === true);
    eq(
      "คงสถานะของแอปไว้",
      admin.calls.update?.itinerary_data?.__meta?.appStatus,
      "planned"
    );
    ok(
      "ไม่ทับคอลัมน์ status ของ DB",
      admin.calls.update?.status === undefined,
      String(admin.calls.update?.status)
    );
  }

  {
    // planId ที่ส่งมาไม่มีจริง (แถวหาย/ไม่ใช่ของผู้ใช้คนนี้) → สร้างใหม่
    const admin = fakeAdmin({ existing: null });
    const res = await persistPlan({
      admin,
      creatorId: "u1",
      folderId: null,
      folderName: null,
      tripReq: PERSIST_REQ,
      plan: PERSIST_PLAN,
      source: "planner",
      existingPlanId: "plan-x",
    });
    ok("ไม่พบแผนเดิม = insert ใหม่", Boolean(admin.calls.insert) && !admin.calls.update);
    eq("ได้รหัสแผนใหม่", res.planId, "new-plan-id");
  }

  {
    // อัปเดตไม่สำเร็จ → ยังต้องบันทึกแผนให้ผู้ใช้ได้ (insert ใหม่แทน)
    const admin = fakeAdmin({
      existing: {
        id: "plan-1",
        creator_id: "u1",
        itinerary_data: { __meta: { appStatus: "planned" } },
      },
      updateError: { message: "อัปเดตไม่ได้" },
    });
    const res = await persistPlan({
      admin,
      creatorId: "u1",
      folderId: null,
      folderName: null,
      tripReq: PERSIST_REQ,
      plan: PERSIST_PLAN,
      source: "planner",
      existingPlanId: "plan-1",
    });
    ok("update ไม่สำเร็จ = insert ใหม่", Boolean(admin.calls.insert));
    ok("ยังบันทึกสำเร็จ", res.persisted === true);
    eq("ได้รหัสแผนใหม่", res.planId, "new-plan-id");
  }
}

async function main() {
  {
    // ไป-กลับจุดเดิม
    const plan = await buildTripPlan(
      { ...baseInput },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("วันเดียว → 1 วัน", plan.days.length, 1);
    eq("ปิดลูปที่จุดเริ่ม", plan.returnMode, "same_as_start");
    eq(
      "จุดสิ้นสุด = จุดเริ่ม",
      plan.days[0].endPoint.coords,
      START.coords
    );
    eq("มีจุดสิ้นสุดแยกจากจุดเริ่ม", plan.endPoint.coords, START.coords);
    ok("เส้นทางมาจาก OSRM", plan.routeSource === "osrm", plan.routeSource);
    ok("ค่าน้ำมันคำนวณแล้ว", plan.budget.fuel > 0, String(plan.budget.fuel));
    eq(
      "ราคาน้ำมันตรงกับตาราง",
      plan.vehicle.fuelPricePerLitre,
      41.54
    );
    eq("ที่มาของราคา", plan.vehicle.fuelPriceSource, "pttor.com");
    eq("วันที่ราคามีผล", plan.vehicle.fuelPriceEffectiveDate, "4 November 2026");
    ok("มีเวลาที่ดึงราคา", Boolean(plan.vehicle.fuelPriceFetchedAt));
    eq("ราคาไม่ใช่ค่าประมาณ", plan.vehicle.fuelPriceIsEstimate, false);
    ok(
      "มีคำเตือนเรื่องสภาพจราจร",
      plan.warnings.some((w) => w.includes("จราจร"))
    );
  }

  {
    // จุดสิ้นสุดคนละจุด
    const plan = await buildTripPlan(
      { ...baseInput, endPoint: AIRPORT, returnMode: "custom" },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("โหมดกลับ = custom", plan.returnMode, "custom");
    eq("จุดสิ้นสุดต่างจากจุดเริ่ม", plan.endPoint.coords, AIRPORT.coords);
    ok(
      "วันจบคนละจุดกับวันเริ่ม",
      plan.days[0].endPoint.coords.lat !== plan.days[0].startPoint.coords.lat
    );
    eq(
      "จุดสิ้นสุดของวัน = จุดสิ้นสุดรวม",
      plan.days[0].endPoint.coords,
      AIRPORT.coords
    );
  }

  {
    // หลายวัน + จุดสิ้นสุดต่อวัน
    const plan = await buildTripPlan(
      {
        ...baseInput,
        days: 2,
        endPoint: AIRPORT,
        returnMode: "custom",
        dayEndPoints: [START],
      },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("สองวัน → 2 วัน", plan.days.length, 2);
    eq(
      "วันสุดท้ายเป็นจุดสิ้นสุดตอนกลับ",
      plan.days[1].endPoint.coords,
      AIRPORT.coords
    );
    eq(
      "วันกลางเป็นจุดสิ้นสุดของวัน",
      plan.days[0].endPoint.coords,
      START.coords
    );
    eq("วันกลางจบแบบค้างคืน", plan.days[0].endPointType, "lodging");
    eq("วันสุดท้ายจบแบบกลับ", plan.days[1].endPointType, "return");
  }

  {
    // จุดที่ปิด ณ เวลาที่จะถึง → ย้ายวัน (วันอื่นที่เปิด) หรือตัดทิ้งพร้อมเหตุผล
    const closedStop = stop("r:9", "ร้านปิดวันจันทร์", 18.79, 98.99, {
      openingHours: "วันจันทร์: ปิด | วันอังคาร: 08:00 - 17:00",
    });
    const plan = await buildTripPlan(
      {
        ...baseInput,
        days: 2,
        date: "2026-11-09", // วันจันทร์
        candidates: [...CANDIDATES, closedStop],
        aiSelection: {
          days: [
            { day: 1, stops: [{ name: "ร้านปิดวันจันทร์" }] },
            { day: 2, stops: [] },
          ],
        },
      },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    ok(
      "จุดที่ปิดวันจันทร์ถูกย้ายไปวันอังคาร (ไม่ใช่ตัดทิ้ง)",
      plan.days[1].stops.some((s) => s.name === "ร้านปิดวันจันทร์"),
      JSON.stringify(plan.days.map((d) => d.stops.map((s) => s.name)))
    );
    eq("ไม่มีการตัดทิ้ง (เพราะมีวันที่เปิด)", plan.droppedStops.length, 0);
  }

  {
    // จุดที่ปิดทุกวัน → ตัดทิ้งพร้อมเหตุผล
    const alwaysClosed = stop("r:10", "ร้านปิดทุกวัน", 18.79, 98.99, {
      businessHours: {
        mon: [],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
    });
    const plan = await buildTripPlan(
      {
        ...baseInput,
        days: 2,
        candidates: [...CANDIDATES, alwaysClosed],
        aiSelection: {
          days: [
            { day: 1, stops: [{ name: "ร้านปิดทุกวัน" }] },
            { day: 2, stops: [] },
          ],
        },
      },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("จุดที่ปิดทุกวันถูกตัดออก", plan.droppedStops.length, 1);
    eq("บอกชื่อจุดที่ตัด", plan.droppedStops[0]?.name, "ร้านปิดทุกวัน");
    ok(
      "เหตุผลระบุว่าปิด",
      (plan.droppedStops[0]?.reason ?? "").includes("ปิด"),
      plan.droppedStops[0]?.reason
    );
    ok(
      "มีคำเตือนเรื่องจุดที่ถูกตัด",
      plan.warnings.some((w) => w.includes("ร้านปิดทุกวัน")),
      plan.warnings.join(" | ")
    );
  }

  {
    // งบเกิน → เตือน
    const plan = await buildTripPlan(
      { ...baseInput, budgetPerPerson: 10 },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("งบเกิน → withinBudget false", plan.budget.withinBudget, false);
    ok(
      "มีคำเตือนเรื่องงบ",
      plan.warnings.some((w) => w.includes("งบที่วางไว้")),
      plan.warnings.join(" | ")
    );
  }

  {
    // ราคาที่ผู้ใช้พิมพ์เอง → ชนะเสมอ
    const plan = await buildTripPlan(
      { ...baseInput, fuelPriceOverride: 45 },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("override ชนะราคาสด", plan.vehicle.fuelPricePerLitre, 45);
    eq("ที่มา = ผู้ใช้ระบุเอง", plan.vehicle.fuelPriceSource, "ผู้ใช้ระบุเอง");
  }

  {
    // รถสาธารณะ → ไม่มีชนิดน้ำมัน ไม่มีราคาน้ำมัน ไม่มีค่าน้ำมันในงบ
    const plan = await buildTripPlan(
      { ...baseInput, vehicle: getVehicle("public"), fuelType: null },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("รถสาธารณะ → ไม่มีชนิดน้ำมัน", plan.vehicle.fuelType, null);
    eq("รถสาธารณะ → ไม่มีราคาน้ำมัน", plan.vehicle.fuelPricePerLitre, null);
    eq("รถสาธารณะ → ค่าน้ำมันในงบ = 0", plan.budget.fuel, 0);
    eq("รถสาธารณะ → ไม่มีข้อมูลราคาน้ำมันในแผน", plan.fuel, undefined);
    ok(
      "รถสาธารณะ → ไม่มีบรรทัดราคาน้ำมันในสมมติฐาน",
      !plan.assumptions.some((a) => a.includes("ราคาน้ำมัน")),
      plan.assumptions.join(" | ")
    );
    ok(
      "รถสาธารณะ → ไม่มีคำเตือนให้ไปกรอกราคาน้ำมัน",
      !plan.warnings.some((w) => w.includes("ราคาน้ำมัน")),
      plan.warnings.join(" | ")
    );
  }

  {
    // รถไฟฟ้า → มีชนิดพลังงาน แต่ไม่มีราคาน้ำมัน (และไม่ควรเตือนให้กรอกราคาน้ำมัน)
    const plan = await buildTripPlan(
      { ...baseInput, vehicle: getVehicle("ev"), fuelType: "electric" },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    eq("รถไฟฟ้า → ชนิดพลังงาน = electric", plan.vehicle.fuelType, "electric");
    eq("รถไฟฟ้า → ไม่มีราคาน้ำมัน", plan.vehicle.fuelPricePerLitre, null);
    eq("รถไฟฟ้า → ค่าน้ำมันในงบ = 0", plan.budget.fuel, 0);
    ok(
      "รถไฟฟ้า → ไม่มีคำเตือนให้ไปกรอกราคาน้ำมัน",
      !plan.warnings.some((w) => w.includes("ราคาน้ำมัน")),
      plan.warnings.join(" | ")
    );
  }

  {
    // จุดที่ผู้ใช้เพิ่มเอง → ต้องอยู่ในแผนเสมอ (แม้ AI ไม่ได้เลือก)
    const userStop = stop("u:0", "จุดที่ผู้ใช้เพิ่ม", 18.8, 99.0, {
      userAdded: true,
    });
    const plan = await buildTripPlan(
      {
        ...baseInput,
        candidates: [...CANDIDATES, userStop],
        aiSelection: {
          days: [{ day: 1, stops: [{ name: "วัดพระแก้ว" }] }],
        },
      },
      { route: fakeRoute, fuelPrices: async () => FUEL_TABLE }
    );
    ok(
      "จุดที่ผู้ใช้เพิ่มอยู่ในแผน",
      plan.days.some((d) => d.stops.some((s) => s.id === "u:0"))
    );
  }

  // บันทึก/อัปเดตทับแถวเดิม
  await testPersistPlan();
}

// ── สรุป ─────────────────────────────────────────────────────────────────
main()
  .then(() => {
    console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    if (fail > 0) process.exit(1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
