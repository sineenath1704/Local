/**
 * เช็ค Google Routes API v2 ว่าใช้ได้ไหม (เรียกตรง เพื่อดูสถานะจริง)
 * -------------------------------------------------------------
 * ทำไมต้องมี: `googleMaps.fetchJson()` กลืน error ทิ้ง (คืน null) → เวลา
 * "เดินทาง" หายไป เราไม่รู้ว่าเพราะ key ไม่มีสิทธิ์ หรือ field mask ผิด
 * → สคริปต์นี้ยิงตรงแล้วพิมพ์ status + body จริง
 *
 * ใช้
 *   cd backend
 *   npm run check:routes
 *
 * ไม่มีคีย์บนบรรทัดคำสั่ง (อ่านจาก backend/.env ผ่าน src/config.ts)
 */

import { config } from "../src/config";

const ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";

async function main() {
  const key = config.places.googleKey;
  if (!key) {
    console.log("ไม่พบ GOOGLE_PLACES_API_KEY ใน .env");
    return;
  }

  const body = {
    origin: { location: { latLng: { latitude: 18.7883, longitude: 98.9853 } } },
    destination: { location: { latLng: { latitude: 18.7892, longitude: 98.9861 } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    language: "th",
    units: "METRIC",
  };

  const resp = await fetch(ROUTES, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  console.log(`status: ${resp.status} ${resp.statusText}`);
  console.log(text.slice(0, 800));
}

main().catch((err) => {
  console.error("ยิงไม่สำเร็จ:", err?.message ?? err);
});
