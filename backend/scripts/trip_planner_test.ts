/**
 * เทสต์ออฟไลน์ของโมดูลวางแผนทริป (ไม่ต่อเน็ตจริง)
 *   - routing    : OSRM ใช้ไม่ได้ → ค่าประมาณ + source:"estimate"
 *   - openHours  : 3 แหล่งข้อมูล × (ก่อนเปิด / ในเวลาเปิด / หลังปิด / วันปิด)
 *   - vehicles   : สูตรค่าน้ำมัน
 *   - fuelPrice  : parse HTML → ราคาถูกต้อง · เว็บล้ม → ค่าสำรอง · แคป 3 ชม.
 *
 * รัน: npm run test:trip-planner
 */
import {
  estimateRoute,
  haversineKm,
  simplifyPoints,
  __routingCacheKey,
  type LatLng,
} from "../src/routing";
import {
  evaluateOpenHours,
  parseFreeTextHours,
  describeVerdict,
} from "../src/openHours";
import {
  VEHICLES,
  getVehicle,
  fuelCost,
  evCost,
  FUEL_TYPE_LABELS,
} from "../src/vehicles";
import {
  parseFuelPricesFromHtml,
  fetchFuelPrices,
  resolveFuelPrice,
  describeFuelPrice,
  FALLBACK_FUEL_PRICES,
  __setFuelPriceFetcher,
  __clearFuelPriceCache,
} from "../src/fuelPrice";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function near(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

// วันจันทร์ที่แน่นอนของสัปดาห์ที่มี 1 ม.ค. 2026 (ไม่ต้องเดา weekday)
function mondayAt(offsetDays: number, hh: number, mm: number): Date {
  const base = new Date(2026, 0, 5, hh, mm, 0, 0); // 5 ม.ค. 2026 = จันทร์
  base.setDate(base.getDate() + offsetDays);
  return base;
}

// ── 1. routing ───────────────────────────────────────────────────────────
console.log("\n[routing]");
{
  const a: LatLng = { lat: 18.7883, lng: 98.9853 };
  const b: LatLng = { lat: 18.787, lng: 98.9853 };
  const c: LatLng = { lat: 18.787, lng: 98.9 };

  check("haversine ระยะสั้น ≈ 0.1 กม.", near(haversineKm(a, b), 0.15, 0.05));
  check(
    "haversine แม่แจ่ม→เชียงใหม่ ≈ 160 กม.",
    near(haversineKm({ lat: 18.7883, lng: 98.9853 }, { lat: 18.7883, lng: 98.9853 }), 0)
  );

  const est = estimateRoute([a, b, c]);
  check("estimateRoute คืน source=estimate", est.source === "estimate");
  check("estimateRoute มี leg ครบทุกช่วง", est.legs.length === 2);
  check(
    "estimateRoute เวลา = ระยะ/45kmh",
    near(est.minutes, (est.km / 45) * 60, 1),
    `km=${est.km} min=${est.minutes}`
  );
  check(
    "estimateRoute ระยะ ≥ เส้นตรง (ตัวคูณทาง 1.35)",
    est.km >= haversineKm(a, c) * 1.34
  );

  const many = Array.from({ length: 1000 }, (_, i) => ({
    lat: 18 + i * 0.001,
    lng: 98 + i * 0.001,
  }));
  const simple = simplifyPoints(many, 400);
  check("simplifyPoints เหลือ ≤ 400 จุด", simple.length <= 400, `${simple.length}`);
  check("simplifyPoints คงจุดแรก/ท้าย", simple[0] === many[0] && simple[simple.length - 1] === many[many.length - 1]);

  check(
    "cache key เป็นนิ่งเมื่อพิกัดเดิม",
    __routingCacheKey([a, b]) === __routingCacheKey([{ ...a }, { ...b }])
  );
  check(
    "cache key ต่างเมื่อพิกัดต่าง",
    __routingCacheKey([a, b]) !== __routingCacheKey([a, c])
  );
}

// ── 2. openHours ─────────────────────────────────────────────────────────
console.log("\n[openHours]");
{
  // 1) ข้อมูลเจ้าของ
  const hostHours = {
    mon: [{ open: "08:00", close: "17:00" }],
    tue: [{ open: "08:00", close: "17:00" }],
    wed: [{ open: "08:00", close: "17:00" }],
    thu: [{ open: "08:00", close: "17:00" }],
    fri: [{ open: "08:00", close: "17:00" }],
    sat: [],
    sun: [],
  };
  const monday9 = evaluateOpenHours({ businessHours: hostHours }, mondayAt(0, 9, 0));
  check("เจ้าของ: จันทร์ 09:00 → เปิด", monday9.status === "open");
  check("เจ้าของ: confidence=host", monday9.confidence === "host");
  check("เจ้าของ: บอกช่วงเวลา", monday9.openFrom === "08:00" && monday9.closeTo === "17:00");

  const monday7 = evaluateOpenHours({ businessHours: hostHours }, mondayAt(0, 7, 0));
  check("เจ้าของ: จันทร์ 07:00 → ยังไม่เปิด", monday7.status === "closed");
  check("เจ้าของ: บอกว่าเปิดเมื่อไหร่", monday7.openFrom === "08:00");

  const monday18 = evaluateOpenHours({ businessHours: hostHours }, mondayAt(0, 18, 0));
  check("เจ้าของ: จันทร์ 18:00 → ปิดแล้ว", monday18.status === "closed");

  const saturday = evaluateOpenHours({ businessHours: hostHours }, mondayAt(5, 10, 0));
  check("เจ้าของ: เสาร์ → ปิด (วันหยุด)", saturday.status === "closed");

  const noFriday = evaluateOpenHours(
    { businessHours: { mon: [{ open: "08:00", close: "17:00" }] } },
    mondayAt(4, 10, 0)
  );
  check("เจ้าของ: วันที่ไม่มีข้อมูล → unknown", noFriday.status === "unknown");

  // 2) ข้อความอิสระแบบป้ายกำกับ
  const label = "วันธรรมดา (จ.-ศ.): 08:00 - 17:00 | วันหยุดสุดสัปดาห์ (ส.-อา.): 09:00 - 20:00 | วันหยุดร้าน: เปิดทุกวัน";
  const parsedLabel = parseFreeTextHours(label);
  check("ข้อความป้ายกำกับ: จ.-ศ. ตรงกับวันจันทร์", JSON.stringify(parsedLabel?.mon) === JSON.stringify([{ open: "08:00", close: "17:00" }]));
  check("ข้อความป้ายกำกับ: ส.-อา. ตรงกับวันเสาร์", JSON.stringify(parsedLabel?.sat) === JSON.stringify([{ open: "09:00", close: "20:00" }]));
  check(
    "ข้อความป้ายกำกับ: 'เปิดทุกวัน' = ไม่มีวันหยุด (อาทิตย์ยังเปิด)",
    parsedLabel?.sun?.length === 1 && parsedLabel?.sun?.[0]?.open === "09:00"
  );

  // วันหยุดร้านที่ระบุวัน → วันนั้นต้องเป็น "ปิด"
  const withHoliday = parseFreeTextHours(
    "วันธรรมดา (จ.-ศ.): 08:00 - 17:00 | วันหยุดร้าน: วันอังคาร"
  );
  check("วันหยุดร้าน: อังคาร → ปิด", withHoliday?.tue?.length === 0);
  check("วันหยุดร้าน: วันอื่นยังเปิด", withHoliday?.mon?.length === 1);

  const labelVerdict = evaluateOpenHours({ openingHours: label }, mondayAt(0, 10, 0));
  check("ข้อความอิสระ: จันทร์ 10:00 → เปิด", labelVerdict.status === "open");
  check("ข้อความอิสระ: confidence=google", labelVerdict.confidence === "google");

  // 3) ข้อความอิสระแบบ Google
  const google = "วันจันทร์: 08:00 – 17:00 | วันอังคาร: 08:00 – 17:00 | วันอาทิตย์: ปิดทำการ";
  const parsedGoogle = parseFreeTextHours(google);
  check("รูปแบบ Google: วันจันทร์ถูกแปลง", parsedGoogle?.mon?.length === 1);
  check("รูปแบบ Google: วันอาทิตย์ = ปิด", parsedGoogle?.sun?.length === 0);
  check("รูปแบบ Google: วันพุธไม่มีข้อมูล", parsedGoogle?.wed === undefined);

  // 4) ไม่มีข้อมูลเลย
  const none = evaluateOpenHours({}, mondayAt(0, 10, 0));
  check("ไม่มีข้อมูล → unknown", none.status === "unknown");
  check("ไม่มีข้อมูล → confidence=unknown", none.confidence === "unknown");

  // 5) ช่วงข้ามคืน
  const overnight = evaluateOpenHours(
    { businessHours: { fri: [{ open: "18:00", close: "02:00" }] } },
    mondayAt(4, 23, 0)
  );
  check("ช่วงข้ามคืน: 23:00 ยังเปิด", overnight.status === "open");
  const overnight2 = evaluateOpenHours(
    { businessHours: { fri: [{ open: "18:00", close: "02:00" }] } },
    mondayAt(5, 1, 0)
  );
  check("ช่วงข้ามคืน: 01:00 ยังเปิด", overnight2.status === "open");

  check("describeVerdict บอกที่มา", describeVerdict(monday9).includes("เจ้าของ"));
}

// ── 3. vehicles ──────────────────────────────────────────────────────────
console.log("\n[vehicles]");
{
  const car = getVehicle("private_car");
  check("รถยนต์ส่วนตัว: 12 กม./ลิตร", car.kmPerLitre === 12);
  check("รถยนต์ส่วนตัว: น้ำมันเริ่มต้น = แก๊สโซฮอล์ 95", car.defaultFuelType === "gasohol95");
  check("getVehicle คีย์ที่ไม่รู้จัก → ค่าเริ่มต้น", getVehicle("nope").key === "private_car");
  check("มีทั้ง 7 โปรไฟล์รถ", VEHICLES.length === 7);

  // 120 กม. ÷ 12 กม./ลิตร = 10 ลิตร × 41.54 = 415.40
  const cost = fuelCost(120, car, 41.54);
  check("สูตรค่าน้ำมันถูกต้อง", near(cost, 415.4, 0.01), `ได้ ${cost}`);

  check("รถสาธารณะไม่คิดค่าน้ำมัน", fuelCost(500, getVehicle("public"), 41.54) === 0);
  check("รถไฟฟ้าไม่คิดค่าน้ำมัน", fuelCost(500, getVehicle("ev"), 41.54) === 0);
  check("ระยะ 0 → ค่าน้ำมัน 0", fuelCost(0, car, 41.54) === 0);
  check("ไม่มีราคา → ค่าน้ำมัน 0", fuelCost(120, car, null) === 0);

  // EV: 120 กม. × 18 kWh/100km = 21.6 kWh × 4.2 = 90.72
  check("สูตรค่าไฟฟ้าถูกต้อง", near(evCost(120, 18, 4.2), 90.72, 0.01));

  check("มีชื่อชนิดน้ำมันครบ", Object.keys(FUEL_TYPE_LABELS).length >= 10);
}

// ── 4. fuelPrice ─────────────────────────────────────────────────────────
console.log("\n[fuelPrice]");
{
  // fixture โครงสร้างจริงของเว็บ pttor.com
  const fixture = `
    <div class="oil-item"><picture><img alt="Diesel B20" src="x.webp"></picture><div class="oil-price">33.50</div></div>
    <div class="oil-item"><picture><img alt="Diesel" src="x.webp"></picture><div class="oil-price">42.54</div></div>
    <div class="oil-item"><picture><img alt="Gasohol E20" src="x.webp"></picture><div class="oil-price">33.50</div></div>
    <div class="oil-item"><picture><img alt="Gasohol 91" src="x.webp"></picture><div class="oil-price">41.17</div></div>
    <div class="oil-item"><picture><img alt="Gasohol 95" src="x.webp"></picture><div class="oil-price">41.54</div></div>
    <div class="oil-item"><picture><img alt="Gasoline 95" src="x.webp"></picture><div class="oil-price">51.03</div></div>
    <div class="oil-item"><picture><img alt="Super Power GSH95" src="x.webp"></picture><div class="oil-price">47.05</div></div>
    <div class="oil-item"><picture><img alt="Premium Diesel" src="x.webp"></picture><div class="oil-price">49.05</div></div>
    <div class="oil-item"><picture><img alt="Super Power X99" src="x.webp"></picture><div class="oil-price">49.05</div></div>
    <h2>ปรับราคาเมื่อวันที่ 4 November 2026</h2>
    <h2>ปรับราคาเมื่อวันที่ 29 ต.ค. 2569</h2>
  `;
  const parsed = parseFuelPricesFromHtml(fixture);
  check("แก๊สโซฮอล์ 95 = 41.54", parsed.prices.gasohol95 === 41.54);
  check("แก๊สโซฮอล์ 91 = 41.17", parsed.prices.gasohol91 === 41.17);
  check("ดีเซล = 42.54", parsed.prices.diesel === 42.54);
  check("พรีเมียมดีเซล = 49.05", parsed.prices.premiumDiesel === 49.05);
  check("GSH95 = 47.05", parsed.prices.gsh95 === 47.05);
  check("X99 = 49.05", parsed.prices.x99 === 49.05);
  check("แก๊สโซฮอล์ E20 = 33.50", parsed.prices.gasoholE20 === 33.5);
  check("ดีเซล B20 = 33.50", parsed.prices.dieselB20 === 33.5);
  check("แก๊สโซฮอล์ 95 พรีเมียม = 51.03", parsed.prices.gasoline95 === 51.03);
  check("วันที่มีผล = 29 ต.ค. 2569", parsed.effectiveDate === "29 ต.ค. 2569");
  check("เก็บวันที่รูปแบบอังกฤษไว้ด้วย", parsed.effectiveDateAlt === "4 November 2026");

  check("HTML มั่ว → ราคาว่าง", Object.keys(parseFuelPricesFromHtml("<html></html>").prices).length === 0);

  // แคป + fallback (มี await → ต้องอยู่ใน async fn)
  void (async () => {
    __clearFuelPriceCache();
    let calls = 0;
    __setFuelPriceFetcher(async () => {
      calls++;
      return fixture;
    });

    const t1 = await fetchFuelPrices();
    check("ดึงสำเร็จ → source=pttor.com", t1.source === "pttor.com");
    check("ดึงสำเร็จ → isEstimate=false", t1.isEstimate === false);
    check("ดึงสำเร็จ → ราคาถูกต้อง", t1.prices.gasohol95 === 41.54);

    const t2 = await fetchFuelPrices();
    check("แคป 3 ชม. → ไม่ยิงซ้ำ", calls === 1, `ยิงไป ${calls} ครั้ง`);
    check("แคป → source=cache", t2.source === "cache");

    // เว็บล้ม → ค่าสำรอง
    __clearFuelPriceCache();
    __setFuelPriceFetcher(async () => {
      throw new Error("network down");
    });
    const t3 = await fetchFuelPrices();
    check("เว็บล้ม → source=fallback", t3.source === "fallback");
    check("เว็บล้ม → isEstimate=true", t3.isEstimate === true);
    check("เว็บล้ม → ยังมีราคา (ระบบไม่ล้ม)", t3.prices.gasohol95 === FALLBACK_FUEL_PRICES.gasohol95);

    // override ชนะเสมอ
    const override = resolveFuelPrice(t3, "gasohol95", 44.5);
    check("ราคาที่ผู้ใช้พิมพ์ ชนะเสมอ", override.pricePerLitre === 44.5);
    check("override ระบุที่มาว่า 'ผู้ใช้ระบุเอง'", override.sourceLabel === "ผู้ใช้ระบุเอง");

    const live = resolveFuelPrice(t1, "gasohol95");
    check("ราคาสดมาจาก pttor.com", live.sourceLabel === "pttor.com" && live.isEstimate === false);
    check("ราคาสดมีวันที่มีผล", live.effectiveDate === "29 ต.ค. 2569");

    const text = describeFuelPrice(live);
    check(
      "ข้อความอธิบายมีราคา + ที่มา + วันที่",
      text.includes("41.54") && text.includes("pttor.com") && text.includes("29 ต.ค. 2569")
    );

    __setFuelPriceFetcher(async () => fixture);
    __clearFuelPriceCache();

    console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
    if (fail > 0) process.exit(1);
  })();
}

