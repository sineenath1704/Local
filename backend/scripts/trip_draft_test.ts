/**
 * เทสต์ออฟไลน์สำหรับสัญญาณแผนทริป (TRIP_DRAFT) ในแชท
 * -------------------------------------------------------------
 *   · โมเดลเขียนบรรทัด TRIP_DRAFT:{...} → ต้องถูกถอดออกจากข้อความที่ผู้ใช้เห็น
 *   · merge กับสถานะที่แอปส่งกลับมา (null = "ไม่รู้" → ห้ามทับค่าเดิม)
 *   · คำนวณว่า "ขาดอะไร" แบบ deterministic ในโค้ด
 *   · ค่าแปลก ๆ ต้องไม่ทำให้แชทพัง
 *
 * รัน: npm run test:trip-draft
 */

import {
  normalizeTripSlots,
  mergeTripSlots,
  computeTripMissing,
  buildTripDraftResult,
  parseTripDraftLine,
  buildTripDraftBlock,
  buildPlanContextBlock,
} from "../src/tripPrompt";

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

// ── 1. normalizeTripSlots ────────────────────────────────────────────────
console.log("\n[normalizeTripSlots]");
{
  const s = normalizeTripSlots({
    startPoint: { label: "บ้าน", address: "เชียงใหม่", coords: { lat: 18.79, lng: 98.98 } },
    returnMode: "custom",
    endPoint: { label: "สนามบิน", coords: { lat: 18.766, lon: 98.962 } },
    date: "2026-11-08",
    startTime: "8:00",
    days: 2,
    vehicle: "private_car",
    fuelType: "gasohol95",
    travelers: 2,
    budgetPerPerson: 3000,
    style: "ธรรมชาติ",
  });
  eq("label จุดเริ่ม", s.startPoint?.label, "บ้าน");
  eq("address จุดเริ่ม", s.startPoint?.address, "เชียงใหม่");
  eq("พิกัดจุดเริ่ม", s.startPoint?.coords, { lat: 18.79, lng: 98.98 });
  eq("อ่าน lon แทน lng ได้", s.endPoint?.coords, { lat: 18.766, lng: 98.962 });
  eq("returnMode", s.returnMode, "custom");
  eq("วันที่", s.date, "2026-11-08");
  eq("เวลาเติมศูนย์ข้างหน้า", s.startTime, "08:00");
  eq("จำนวนวัน", s.days, 2);
  eq("รถ", s.vehicle, "private_car");
  eq("ชนิดน้ำมัน", s.fuelType, "gasohol95");
  eq("จำนวนคน", s.travelers, 2);
  eq("งบต่อคน", s.budgetPerPerson, 3000);
  eq("สไตล์", s.style, "ธรรมชาติ");

  eq("ค่าที่ไม่รู้ → ไม่มี key", normalizeTripSlots({ date: null }).date, undefined);

  const bad = normalizeTripSlots({
    date: "8 พ.ย.",
    startTime: "25:99",
    days: 30,
    travelers: 0,
    budgetPerPerson: -5,
    returnMode: "ที่ไหนก็ได้",
  });
  eq("วันที่ผิดรูปแบบ → ทิ้ง", bad.date, undefined);
  eq("เวลาผิดรูปแบบ → ทิ้ง", bad.startTime, undefined);
  eq("จำนวนวันเกิน 7 → ทิ้ง", bad.days, undefined);
  eq("จำนวนคน 0 → ทิ้ง", bad.travelers, undefined);
  eq("งบติดลบ → ทิ้ง", bad.budgetPerPerson, undefined);
  eq("returnMode ผิดค่า → ทิ้ง", bad.returnMode, undefined);

  eq("null → {}", normalizeTripSlots(null), {});
  eq("string → {}", normalizeTripSlots("บ้าน"), {});
  eq("array → {}", normalizeTripSlots([]), {});

  const noCoords = normalizeTripSlots({ startPoint: { label: "บ้าน" } });
  eq("จุดเริ่มไม่มีพิกัด → coords null", noCoords.startPoint?.coords, null);

  const badCoords = normalizeTripSlots({
    startPoint: { label: "บ้าน", coords: { lat: 999, lng: 0 } },
  });
  eq("พิกัดนอกโลก → coords null", badCoords.startPoint?.coords, null);

  eq("จุดไม่มีชื่อ → ทิ้ง", normalizeTripSlots({ startPoint: { coords: { lat: 1, lng: 1 } } }).startPoint, undefined);
}

// ── 2. mergeTripSlots ────────────────────────────────────────────────────
console.log("\n[mergeTripSlots]");
{
  const base = {
    startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
    date: "2026-11-08",
    days: 2,
  };
  const merged = mergeTripSlots(base, {
    startTime: "09:00",
    date: null,
    days: 3,
  });
  eq("ค่าที่โมเดลรู้ → ทับ", merged.startTime, "09:00");
  eq("null = ไม่รู้ → ไม่ทับค่าเดิม", merged.date, "2026-11-08");
  eq("ตัวเลขใหม่ → ทับ", merged.days, 3);
  eq("จุดเริ่มเดิมยังอยู่", merged.startPoint?.label, "บ้าน");

  eq("ไม่มี incoming → คืนค่าเดิม", mergeTripSlots(base, null).days, 2);
  eq("ไม่มี base → ใช้ค่าใหม่", mergeTripSlots(null, { days: 5 }).days, 5);

  // พิกัดที่ผู้ใช้เลือกเอง → จุดที่โมเดลส่งมาโดยไม่มีพิกัด ทับไม่ได้
  // (เคยเจอจริง: กดสร้างแพลนไม่ได้ ทั้งที่กรอกครบแล้ว เพราะพิกัดหายระหว่างทาง)
  const keepCoords = mergeTripSlots(
    { startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } } },
    { startPoint: { label: "บ้าน", address: null, coords: null } }
  );
  ok(
    "จุดที่ไม่มีพิกัด → ไม่ลบพิกัดที่ผู้ใช้เลือก",
    keepCoords.startPoint?.coords?.lat === 18.79 &&
      keepCoords.startPoint?.coords?.lng === 98.98
  );
  eq("ชื่อจุดเดิมยังอยู่", keepCoords.startPoint?.label, "บ้าน");

  // จุดเดิมไม่มีพิกัด แต่ของใหม่มี → ใช้พิกัดของใหม่
  const takeCoords = mergeTripSlots(
    { startPoint: { label: "บ้าน", coords: null } },
    { startPoint: { label: "วัดพระแก้ว", coords: { lat: 18.78, lng: 98.97 } } }
  );
  ok(
    "ของใหม่มีพิกัด → ใช้พิกัดของใหม่",
    takeCoords.startPoint?.coords?.lng === 98.97 &&
      takeCoords.startPoint?.label === "วัดพระแก้ว"
  );

  // กลับจุดเดิม → ต้องล้างจุดสิ้นสุดทิ้ง ไม่ให้ค้างเป็นจุดคนละจุด
  const backToStart = mergeTripSlots(
    {
      returnMode: "custom",
      endPoint: { label: "สนามบิน", coords: { lat: 18.76, lng: 98.96 } },
    },
    { returnMode: "same_as_start" }
  );
  eq("กลับจุดเดิม → ล้างจุดสิ้นสุด", backToStart.endPoint, null);
  eq("กลับจุดเดิม → returnMode", backToStart.returnMode, "same_as_start");

  // เส้นทางจริงตามที่ production ทำ: แอปส่งจุดที่มีพิกัด → normalize → merge กับจุดที่โมเดลส่งมา
  const fromApp = normalizeTripSlots({
    startPoint: {
      label: "บ้าน",
      address: "เชียงใหม่",
      coords: { lat: 18.79, lng: 98.98 },
    },
    date: "2026-11-08",
  });
  const afterModel = mergeTripSlots(
    fromApp,
    normalizeTripSlots({
      startPoint: { label: "บ้าน", address: null, coords: null },
      date: null,
    })
  );
  ok(
    "รอบจริง: พิกัดที่ผู้ใช้เลือกรอดจากการ merge",
    afterModel.startPoint?.coords?.lat === 18.79 &&
      afterModel.startPoint?.coords?.lng === 98.98
  );
  ok(
    "รอบจริง: ไม่ขาดพิกัดจุดเริ่มต้น",
    !computeTripMissing(afterModel).includes("พิกัดจุดเริ่มต้น")
  );
}

// ── 3. computeTripMissing ────────────────────────────────────────────────
console.log("\n[computeTripMissing]");
{
  const missing = computeTripMissing({});
  ok("ไม่มีข้อมูลเลย → ขาด 5 ช่อง", missing.length === 5, missing.join(" | "));
  ok("ขาดจุดเริ่มต้น", missing.includes("จุดเริ่มต้น"));
  ok("ขาดวันที่", missing.includes("วันที่"));
  ok("ขาดเวลาเริ่มต้น", missing.includes("เวลาเริ่มต้น"));
  ok("ขาดรถ", missing.includes("รถที่ใช้"));
  ok("ขาดจำนวนวัน", missing.includes("จำนวนวัน"));
  ok(
    "กลับจุดเดิม → ไม่ต้องมีจุดสิ้นสุด",
    !missing.includes("จุดสิ้นสุดตอนกลับ")
  );

  const withLabelOnly = computeTripMissing({
    startPoint: { label: "บ้าน" },
  });
  ok(
    "จุดเริ่มมีชื่อแต่ไม่มีพิกัด → ขาดพิกัด",
    withLabelOnly.includes("พิกัดจุดเริ่มต้น"),
    withLabelOnly.join(" | ")
  );

  const custom = computeTripMissing({
    startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
    returnMode: "custom",
  });
  ok(
    "กลับคนละจุด → ต้องมีจุดสิ้นสุด",
    custom.includes("จุดสิ้นสุดตอนกลับ"),
    custom.join(" | ")
  );

  const complete = {
    startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
    returnMode: "same_as_start" as const,
    date: "2026-11-08",
    startTime: "08:00",
    days: 1,
    vehicle: "private_car",
  };
  eq("ข้อมูลครบ → ไม่ขาดอะไร", computeTripMissing(complete), []);

  const customComplete = {
    ...complete,
    returnMode: "custom" as const,
    endPoint: { label: "สนามบิน", coords: { lat: 18.76, lng: 98.96 } },
  };
  eq("กลับคนละจุด + มีพิกัด → ครบ", computeTripMissing(customComplete), []);

  // งบ/คน/สไตล์/น้ำมัน ไม่บังคับ (มีค่าเริ่มต้นของระบบ)
  const minimal = computeTripMissing(complete);
  ok("งบไม่บังคับ", !minimal.includes("งบต่อคน"));
  ok("จำนวนคนไม่บังคับ", !minimal.includes("จำนวนผู้เดินทาง"));
}

// ── 4. buildTripDraftResult ──────────────────────────────────────────────
console.log("\n[buildTripDraftResult]");
{
  const r1 = buildTripDraftResult({});
  eq("ยังไม่ครบ → planReady false", r1.planReady, false);
  ok("ยังไม่ครบ → มีรายการขาด", r1.missing.length > 0);

  const r2 = buildTripDraftResult({
    startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
    returnMode: "same_as_start",
    date: "2026-11-08",
    startTime: "08:00",
    days: 1,
    vehicle: "private_car",
  });
  eq("ครบ → planReady true", r2.planReady, true);
  eq("ครบ → ไม่มีอะไรขาด", r2.missing, []);
}

// ── 5. parseTripDraftLine ────────────────────────────────────────────────
console.log("\n[parseTripDraftLine]");
{
  const r1 = parseTripDraftLine("สวัสดีค่ะ ช่วยวางแผนให้หน่อย");
  eq("ไม่มีสัญญาณ → slots null", r1.slots, null);
  eq("ไม่มีสัญญาณ → ข้อความเดิม", r1.reply, "สวัสดีค่ะ ช่วยวางแผนให้หน่อย");

  const r2 = parseTripDraftLine(
    'ได้ค่ะ จะวางให้นะคะ\nTRIP_DRAFT:{"startPoint":{"label":"บ้าน","coords":{"lat":18.79,"lng":98.98}},"days":2,"date":"2026-11-08"}'
  );
  eq("มีสัญญาณ → ตัดบรรทัดออก", r2.reply, "ได้ค่ะ จะวางให้นะคะ");
  eq("มีสัญญาณ → อ่านจุดเริ่มได้", r2.slots?.startPoint?.label, "บ้าน");
  eq("มีสัญญาณ → อ่านจำนวนวันได้", r2.slots?.days, 2);
  ok("ไม่มีบรรทัด TRIP_DRAFT เหลือ", !r2.reply.includes("TRIP_DRAFT"));

  const r3 = parseTripDraftLine(
    'ข้อความ\nTRIP_DRAFT:{"days":3,"note":}'
  );
  eq("JSON เสียรูปแบบ → ทิ้งทั้งบรรทัด", r3.reply, "ข้อความ");
  eq("JSON เสียรูปแบบ → slots null", r3.slots, null);

  const r4 = parseTripDraftLine(
    'TRIP_DRAFT:{"startPoint":{"label":"บ้าน {ใหม่}","coords":{"lat":18.79,"lng":98.98}}}'
  );
  eq(
    "ชื่อที่มีวงเล็บปีกกา → ยัง parse ได้",
    r4.slots?.startPoint?.label,
    "บ้าน {ใหม่}"
  );

  const r5 = parseTripDraftLine(
    'คำตอบปกติ TRIP_DRAFT:{"days":2} ต่อท้ายไปด้วย'
  );
  eq("สัญญาณอยู่กลางบรรทัด → ตัดเฉพาะสัญญาณ", r5.reply, "คำตอบปกติ  ต่อท้ายไปด้วย");
  eq("สัญญาณอยู่กลางบรรทัด → ยังอ่านค่าได้", r5.slots?.days, 2);

  const r6 = parseTripDraftLine(
    'ได้ค่ะ\n```json\nTRIP_DRAFT:{"days":2}\n```'
  );
  ok("code fence ถูกเก็บกวาด", !r6.reply.includes("```"), r6.reply);
  ok("ไม่เหลือบรรทัดว่างเยอะ", !/\n{3,}/.test(r6.reply), r6.reply);
  eq("code fence → ยังอ่านค่าได้", r6.slots?.days, 2);

  const r7 = parseTripDraftLine('TRIP_DRAFT:{"startPoint":{"label":"บ้าน"');
  eq("JSON ไม่ปิด → ทิ้งบรรทัด", r7.reply, "");
  eq("JSON ไม่ปิด → slots null", r7.slots, null);

  const r8 = parseTripDraftLine("ทดสอบ\r\nบรรทัดสอง");
  eq("CRLF ต้องอ่านได้", r8.reply, "ทดสอบ\nบรรทัดสอง");
}

// ── 6. buildTripDraftBlock ───────────────────────────────────────────────
console.log("\n[buildTripDraftBlock]");
{
  eq("ไม่มี slot → คืนค่าว่าง", buildTripDraftBlock(null), "");
  eq("slot ว่าง → คืนค่าว่าง", buildTripDraftBlock({}), "");

  const block = buildTripDraftBlock({
    startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
    returnMode: "same_as_start",
    date: "2026-11-08",
    startTime: "08:00",
    days: 2,
    vehicle: "private_car",
  });
  ok("มีจุดเริ่ม", block.includes("บ้าน"));
  ok("มีวันที่", block.includes("2026-11-08"));
  ok("มีเวลา", block.includes("08:00"));
  ok("มีจำนวนวัน", block.includes("2 วัน") || block.includes("จำนวนวัน: 2"));
  ok("บอกว่ากลับจุดเดิม", block.includes("กลับจุดเริ่มต้นเดิม"));
  ok("บอกว่าห้ามถามซ้ำ", block.includes("ห้ามถามซ้ำ"));

  const customBlock = buildTripDraftBlock({
    startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
    returnMode: "custom",
    endPoint: { label: "สนามบิน", coords: { lat: 18.76, lng: 98.96 } },
  });
  ok("กลับคนละจุด → บอกว่าเป็นคนละจุด", customBlock.includes("กลับคนละจุด"));

  const noCoordsBlock = buildTripDraftBlock({
    startPoint: { label: "บ้าน" },
  });
  ok("ยังไม่มีพิกัด → บอกว่ายังไม่มีพิกัด", noCoordsBlock.includes("ยังไม่มีพิกัด"));
}

// ── 7. buildPlanContextBlock ────────────────────────────────────────────
console.log("\n[buildPlanContextBlock]");
{
  eq("ข้อมูลแปลก → คืนค่าว่าง", buildPlanContextBlock(null), "");
  eq("string → คืนค่าว่าง", buildPlanContextBlock("แผน"), "");
  eq("วัตถุว่าง → คืนค่าว่าง", buildPlanContextBlock({}), "");

  const block = buildPlanContextBlock({
    title: "ทริปเชียงใหม่ 2 วัน",
    startPoint: "บ้าน",
    startPointCoords: { lat: 18.79, lng: 98.98 },
    endPoint: "สนามบิน",
    endPointCoords: { lat: 18.766, lng: 98.962 },
    returnMode: "custom",
    date: "2026-11-08",
    startTime: "08:00",
    days: 2,
    vehicle: { label: "รถยนต์ส่วนตัว", fuelType: "แก๊สโซฮอล์ 95" },
    travelers: 2,
    budgetPerPerson: 3000,
    style: "ธรรมชาติ",
    itinerary: [
      {
        day: 1,
        date: "2026-11-08",
        title: "ตัวเมือง",
        endPoint: "บ้าน",
        endPointType: "lodging",
        stops: [
          {
            name: "วัดพระแก้ว",
            startTime: "09:30",
            endTime: "10:30",
            stayHours: 1,
            driveToNextMins: 28,
            activity: "ไหว้พระ",
          },
        ],
      },
    ],
    budget: { fuel: 128.5, food: 900, total: 1028.5, perPerson: 514 },
    warnings: ["เวลาเดินทางไม่รวมสภาพจราจร"],
  });

  ok("มีชื่อแผน", block.includes("ทริปเชียงใหม่ 2 วัน"));
  ok("มีจุดเริ่ม", block.includes("บ้าน"));
  ok("มีพิกัดจุดเริ่ม", block.includes("18.79000"));
  ok("บอกว่ากลับคนละจุด", block.includes("กลับคนละจุด"));
  ok("มีรถ", block.includes("รถยนต์ส่วนตัว"));
  ok("มีจำนวนวัน", block.includes("2 วัน"));
  ok("มีวันที่ 1", block.includes("วันที่ 1"));
  ok("มีชื่อจุดหยุด", block.includes("วัดพระแก้ว"));
  ok("มีกิจกรรม", block.includes("ไหว้พระ"));
  ok("มีงบ", block.includes("1028.5"));
  ok("มีข้อควรระวัง", block.includes("เวลาเดินทางไม่รวมสภาพจราจร"));
  ok("บอกว่าเปลี่ยนเฉพาะที่ขอ", block.includes("เปลี่ยนเฉพาะส่วนที่ผู้ใช้ขอ"));

  // รูปแบบของ backend (BuiltPlan) — จุดเป็นออบเจกต์ + วันเป็น array
  const backendBlock = buildPlanContextBlock({
    title: "แพลนจาก backend",
    startPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
    endPoint: { label: "สนามบิน", coords: { lat: 18.766, lng: 98.962 } },
    returnMode: "custom",
    vehicle: {
      label: "รถยนต์ส่วนตัว",
      fuelType: "แก๊สโซฮอล์ 95",
      fuelPricePerLitre: 41.54,
      fuelPriceSource: "pttor.com",
      fuelPriceEffectiveDate: "4 November 2026",
    },
    days: [
      {
        day: 1,
        date: "2026-11-08",
        title: "ตัวเมือง",
        endPoint: { label: "บ้าน", coords: { lat: 18.79, lng: 98.98 } },
        endPointType: "lodging",
        stops: [
          {
            name: "วัดพระแก้ว",
            arriveTime: "09:30",
            leaveTime: "10:30",
            stayHours: 1,
            openHours: { status: "open", openFrom: "08:00", openTo: "17:00" },
            driveToNextMins: 28,
            distanceFromPrevKm: 12.4,
            activity: "ไหว้พระ",
          },
        ],
      },
    ],
    lodgingSuggestions: [
      { name: "บ้านพักริมน้ำ", price: 1200, priceUnit: "คืน", distanceKm: 3.2 },
    ],
    droppedStops: [{ name: "ร้านปิดวันจันทร์", day: 1, reason: "ปิดทุกวัน" }],
    budget: { fuel: 128.5, lodging: 1200, food: 900, total: 2228.5, perPerson: 1114.25 },
    warnings: ["เวลาเดินทางไม่รวมสภาพจราจร"],
    assumptions: ["ราคาน้ำมัน 41.54 บาท/ลิตร"],
  });
  ok("backend: มีจุดเริ่ม", backendBlock.includes("บ้าน"));
  ok("backend: มีเวลาเปิด-ปิด", backendBlock.includes("08:00-17:00"));
  ok("backend: มีระยะจากจุดก่อน", backendBlock.includes("12.4 กม."));
  ok("backend: มีราคาน้ำมัน", backendBlock.includes("41.54"));
  ok("backend: บอกที่มาของราคา", backendBlock.includes("pttor.com"));
  ok("backend: บอกวันที่ราคามีผล", backendBlock.includes("4 November 2026"));
  ok("backend: มีที่พักที่เสนอ", backendBlock.includes("บ้านพักริมน้ำ"));
  ok("backend: ที่พักมีราคา", backendBlock.includes("1200"));
  ok("backend: ที่พักมีระยะ", backendBlock.includes("3.2 กม."));
  ok("backend: มีจุดที่ถูกตัด", backendBlock.includes("ร้านปิดวันจันทร์"));
  ok("backend: มีสมมติฐาน", backendBlock.includes("ราคาน้ำมัน 41.54"));

  // ข้อความยาวมากต้องถูกตัด
  const longBlock = buildPlanContextBlock({
    title: "x".repeat(500),
    itinerary: [{ day: 1, stops: [{ name: "y".repeat(500) }] }],
  });
  ok("ข้อความยาวถูกตัด", longBlock.includes("…"));
}

// ── สรุป ─────────────────────────────────────────────────────────────────
console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
if (fail > 0) process.exit(1);
