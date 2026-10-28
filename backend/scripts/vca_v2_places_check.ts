/**
 * ตรวจ Google Maps (Places + Routes) กับสถานที่จริง — ผู้ใช้รันเอง
 * ---------------------------------------------------------------------------
 * การ์ดหัวข้อ "สถานที่ที่อยู่ใกล้เคียง" ดึงข้อมูลสถานที่ใกล้เคียงจาก Google Places
 * และหัวข้อ "เดินทาง" ดึงระยะ/เวลา/ค่าผ่านจาก Google Routes
 * (ไม่ใช่จากโมเดล และไม่ใช่จาก OpenStreetMap แล้ว)
 * → สคริปต์นี้เช็กว่าเรียกจริงได้ไหม และได้อะไรคืนมา
 *
 *   1) มี API key ไหม            (ไม่พิมพ์ key ออกมา)
 *   2) TextSearch หาพิกัด        → status + ข้อความ error ตรง ๆ (เช่นบิลลิ่งปิด)
 *   3) Nearby Search รอบพิกัด    → รายการสถานที่ใกล้เคียง
 *   4) Routes API คำนวณเส้นทาง  → ระยะ/เวลา/ชื่อถนน/ค่าผ่าน/รถติด
 *   5) เรียกผ่านโมดูลจริง        → getMapInfo() + fetchNearbyAttractions()
 *
 * ใช้ Places Legacy API (textsearch / nearbysearch)
 *   — เพราะ Places (New) ปิดอยู่ในโปรเจกต์นี้
 *
 * ใช้
 *   cd backend
 *   npm run check:vca2:places
 *   npm run check:vca2:places -- "โฮมสเตยบ้านน้ำไหลเขา" "แมล่าน้อย" "แม่ฮ่องสอน"
 */

import { config, isPlacesConfigured } from "../src/config";
import { fetchNearbyAttractions, getMapInfo } from "../src/googleMaps";

const PLACE = process.argv[2]?.trim() || "ห้วยหอม แมล่าน้อย แม่ฮ่องสอน";
const DISTRICT = process.argv[3]?.trim() || "แมล่าน้อย";
const PROVINCE = process.argv[4]?.trim() || "แม่ฮ่องสอน";

function line(title: string) {
  console.log(`\n— ${title} —`);
}

async function rawJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return { status: `HTTP_${resp.status}`, error_message: resp.statusText };
    return await resp.json();
  } catch (err: any) {
    return { status: "ERROR", error_message: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`สถานที่ที่ทดสอบ: ${PLACE} (${DISTRICT} / ${PROVINCE})`);

  // ── 1) มี key ไหม ─────────────────────────────────────────────
  line("1) API key");
  if (!isPlacesConfigured()) {
    console.log("   ❌ ไม่มี GOOGLE_PLACES_API_KEY → การ์ดจะไม่มีบล็อก 'สถานที่ที่อยู่ใกล้เคียง'");
    console.log("   (และจะไม่มีระยะทางในหัวข้อ 'เดินทาง')");
    return;
  }
  console.log("   ✅ มี GOOGLE_PLACES_API_KEY (ไม่แสดงค่า)");

  // ── 2) หาพิกัด ────────────────────────────────────────────────
  line("2) หาพิกัด (Legacy TextSearch)");
  const query = [PLACE, DISTRICT, PROVINCE].filter(Boolean).join(" ");
  const tsUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
    query
  )}&language=th&region=th&key=${config.places.googleKey}`;
  const ts = await rawJson(tsUrl);
  console.log(`   status: ${ts.status}`);
  if (ts.error_message) console.log(`   error_message: ${ts.error_message}`);
  const first = ts?.results?.[0];
  const lat = Number(first?.geometry?.location?.lat);
  const lon = Number(first?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.log("   ❌ หาพิกัดไม่ได้ → ข้ามการหาสถานที่ใกล้เคียง");
    console.log(`\nรวมทั้งหมด ${Date.now() - t0} ms`);
    return;
  }
  console.log(`   ✅ ${lat}, ${lon} — ${first?.name}`);

  // ── 3) สถานที่ใกล้เคียง ───────────────────────────────────────
  line("3) สถานที่ใกล้เคียง (Legacy Nearby Search)");
  const nbUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=15000&type=tourist_attraction&language=th&region=th&key=${config.places.googleKey}`;
  const nb = await rawJson(nbUrl);
  console.log(`   status: ${nb.status}`);
  if (nb.error_message) console.log(`   error_message: ${nb.error_message}`);
  const results: any[] = Array.isArray(nb?.results) ? nb.results : [];
  console.log(`   ได้ ${results.length} แห่ง`);
  for (const r of results.slice(0, 8)) {
    console.log(`   · ${r?.name} — ${(r?.types || []).join(", ")}`);
  }

  // ── 4) Routes API ─────────────────────────────────────────────
  line("4) เส้นทาง (Routes API v2)");
  const refQuery = DISTRICT ? `อำเภอ${DISTRICT} ${PROVINCE}` : PROVINCE;
  const refTs = await rawJson(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      refQuery
    )}&language=th&region=th&key=${config.places.googleKey}`
  );
  const refFirst = refTs?.results?.[0];
  const refLat = Number(refFirst?.geometry?.location?.lat);
  const refLon = Number(refFirst?.geometry?.location?.lng);
  if (!Number.isFinite(refLat) || !Number.isFinite(refLon)) {
    console.log("   ❌ หาพิกัดจุดอ้างอิงไม่ได้ → ข้ามการทดสอบ Routes");
  } else {
    console.log(`   จุดอ้างอิง: ${refFirst?.name} (${refLat}, ${refLon})`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": config.places.googleKey,
            "X-Goog-FieldMask":
              "routes.distanceMeters,routes.duration,routes.staticDuration,routes.description,routes.travelAdvisory.tollInfo",
          },
          body: JSON.stringify({
            origin: {
              location: { latLng: { latitude: refLat, longitude: refLon } },
            },
            destination: {
              location: { latLng: { latitude: lat, longitude: lon } },
            },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE_OPTIMAL",
            extraComputations: ["TOLLS"],
            language: "th",
            units: "METRIC",
          }),
        }
      );
      const data: any = await resp.json().catch(() => null);
      if (!resp.ok) {
        console.log(`   ❌ HTTP ${resp.status}`);
        console.log(`   error: ${JSON.stringify(data?.error ?? data).slice(0, 500)}`);
      } else {
        const route = data?.routes?.[0];
        if (!route) {
          console.log("   ❌ ไม่มีเส้นทางในคำตอบ");
          console.log(`   debug: ${JSON.stringify(data).slice(0, 500)}`);
        } else {
          console.log(`   ✅ ${route.distanceMeters} ม. · ${route.duration} · ${route.staticDuration}`);
          console.log(`   description: ${route.description}`);
          console.log(
            `   tollInfo: ${route.travelAdvisory?.tollInfo ? "มีค่าผ่าน" : "ไม่มีค่าผ่าน"}`
          );
        }
      }
    } catch (err: any) {
      console.log(`   ❌ เรียกไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── 5) เรียกตามที่การ์ดเรียกจริง ───────────────────────────────
  line("5) เรียกตามที่การ์ดเรียกจริง");
  const map = await getMapInfo({
    placeName: PLACE,
    district: DISTRICT,
    province: PROVINCE,
  });
  if (!map) {
    console.log("   ⚠️ getMapInfo() → null → การ์ดจะไม่มีระยะทาง");
  } else {
    console.log(`   พิกัด: ${map.lat}, ${map.lon}`);
    console.log(
      `   เส้นทาง: ${
        map.routeKm != null
          ? `${map.routeKm} กม. · ${map.routeMinutes} นาที (จาก${map.routeFrom})`
          : "ไม่มีข้อมูล"
      }`
    );
    console.log(`   เส้นทางผ่าน: ${map.routeVia ?? "-"}`);
    console.log(`   ค่าผ่าน: ${map.hasToll ? "มี" : "ไม่มี"} · รถติด: ${map.trafficDelaySec ?? 0} วิ`);
  }

  const items = await fetchNearbyAttractions({
    placeName: PLACE,
    district: DISTRICT,
    province: PROVINCE,
    fallbackLat: lat,
    fallbackLon: lon,
  });
  if (items.length === 0) {
    console.log("   ⚠️ สถานที่ใกล้เคียง → [] → การ์ดจะไม่มีบล็อก 'สถานที่ที่อยู่ใกล้เคียง'");
  } else {
    for (const n of items) {
      const bits = [
        n.name,
        n.label,
        n.distanceKm != null ? `${n.distanceKm} กม.` : null,
        n.rating != null ? `★${n.rating}` : null,
      ];
      console.log(`   · ${bits.filter(Boolean).join(" · ")}`);
    }
  }

  console.log(`\nรวมทั้งหมด ${Date.now() - t0} ms`);
}

main().catch((err) => {
  console.error("ล้ม:", err);
  process.exit(1);
});
