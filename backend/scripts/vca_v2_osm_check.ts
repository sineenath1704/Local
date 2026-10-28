/**
 * ตรวจข้อมูลแผนที่ OpenStreetMap กับสถานที่จริง — ผู้ใช้รันเอง
 * ---------------------------------------------------------------------------
 * ตรวจว่า OSM มีข้อมูลที่การ์ดต้องใช้ได้จริงไหม สำหรับพื้นที่ชนบทไทย
 *   · หาพิกัด (Nominatim)      → หาได้ไหม / กำกวมไหม
 *   · ผิวถนนรอบพิกัด (Overpass) → มีครบไหม  (ความเสี่ยงข้อ 4 ในแผน)
 *   · สถานที่ใกล้เคียง (Overpass)
 *   · ระยะทางจากตัวอำเภอ (OSRM) → กี่ กม. / กี่ นาที
 *
 * ยิง API สาธารณะของ OSM (ไม่มี key) → มีนโยบาย ≤ 1 req/s อยู่ในโค้ดแล้ว
 *
 * ใช้
 *   cd backend
 *   npm run check:vca2
 *   npm run check:vca2 -- "ห้วยหอม แมล่าน้อย แม่ฮ่องสอน"
 */

import {
  geocodePlace,
  geocodeReference,
  fetchRoadSurface,
  fetchNearby,
  fetchRoute,
  getOsmInfo,
  surfaceToThai,
  mergeSurfaces,
} from "../src/osmClient";

const PLACE = process.argv[2]?.trim() || "ห้วยหอม แมล่าน้อย แม่ฮ่องสอน";
const DISTRICT = process.argv[3]?.trim() || "แมล่าน้อย";
const PROVINCE = process.argv[4]?.trim() || "แม่ฮ่องสอน";

function line(title: string) {
  console.log(`\n— ${title} —`);
}

async function main() {
  const t0 = Date.now();
  console.log(`สถานที่ที่ทดสอบ: ${PLACE} (${DISTRICT} / ${PROVINCE})`);

  // ── 1) หาพิกัด ───────────────────────────────────────────────
  line("1) หาพิกัด (Nominatim)");
  const t1 = Date.now();
  const geo = await geocodePlace(PLACE, PROVINCE, DISTRICT);
  console.log(`   ใช้เวลา ${Date.now() - t1} ms`);
  if (!geo) {
    console.log("   ❌ หาพิกัดไม่ได้ (หรือกำกวมเกินไป → ระบบจะข้ามหัวข้อเดินทาง)");
  } else {
    console.log(`   ✅ ${geo.lat}, ${geo.lon} (${geo.label})`);
  }

  // ── 2) ผิวถนน + ใกล้เคียง ────────────────────────────────────
  if (geo) {
    const budget = { left: 6000 };

    line("2) ผิวถนนรอบพิกัด (Overpass)");
    const t2 = Date.now();
    const surface = await fetchRoadSurface(geo.lat, geo.lon, budget);
    console.log(`   ใช้เวลา ${Date.now() - t2} ms`);
    console.log(
      surface
        ? `   ✅ ${surface}`
        : "   ⚠️ ไม่มีข้อมูลผิวถนนที่ Overpass ระบุ (ถนนไม่ได้ tag surface)"
    );

    line("3) สถานที่ใกล้เคียง (Overpass)");
    const t3 = Date.now();
    const nearby = await fetchNearby(geo.lat, geo.lon, budget);
    console.log(`   ใช้เวลา ${Date.now() - t3} ms`);
    console.log(
      nearby.length
        ? `   ✅ ${nearby.length} แห่ง: ${nearby.join(" · ")}`
        : "   ⚠️ ไม่พบสถานที่ใกล้เคียงในรัศมี 2.5 กม."
    );

    line("4) เส้นทางจากตัวอำเภอ (OSRM)");
    const t4 = Date.now();
    const ref = await geocodeReference(DISTRICT, PROVINCE);
    if (!ref) {
      console.log("   ⚠️ หาพิกัดตัวอำเภอไม่ได้ → ข้ามการคำนวณเส้นทาง");
    } else {
      const route = await fetchRoute(ref, { lat: geo.lat, lon: geo.lon }, budget);
      console.log(`   ใช้เวลา ${Date.now() - t4} ms`);
      console.log(
        route
          ? `   ✅ จาก${ref.label} ประมาณ ${route.km.toFixed(1)} กม. · ${Math.round(route.minutes)} นาที`
          : "   ⚠️ คำนวณเส้นทางไม่สำเร็จ"
      );
    }
  }

  // ── 5) รวมทั้งหมดเท่าที่สายสรุปจะเรียกจริง ───────────────────
  line("5) รวมทั้งหมด (เหมือนที่สายสรุปเรียกจริง)");
  const t5 = Date.now();
  const info = await getOsmInfo({
    placeName: PLACE,
    province: PROVINCE,
    district: DISTRICT,
  });
  console.log(`   ใช้เวลา ${Date.now() - t5} ms (งบรวมของทั้งระบบ = 6 วินาที)`);
  if (!info) {
    console.log("   ⚠️ ไม่ได้ข้อมูลที่มีประโยชน์ → การ์ดจะไม่มีหัวข้อเดินทาง");
  } else {
    console.log(`   พิกัด: ${info.lat}, ${info.lon}`);
    console.log(`   ผิวถนน: ${info.roadSurface ?? "(ไม่มี)"}`);
    console.log(`   ใกล้เคียง: ${(info.nearby || []).join(" · ") || "(ไม่มี)"}`);
    console.log(
      `   เส้นทาง: ${
        info.routeKm != null
          ? `จาก${info.routeFrom} ${info.routeKm.toFixed(1)} กม. · ${Math.round(info.routeMinutes || 0)} นาที`
          : "(ไม่มี)"
      }`
    );
    console.log(`   เครดิต: ${info.credit}`);
  }

  console.log(`\nรวมทั้งหมด ${Date.now() - t0} ms`);
}

main()
  .catch((err) => {
    console.error("ล้ม:", err);
    process.exit(1);
  });
