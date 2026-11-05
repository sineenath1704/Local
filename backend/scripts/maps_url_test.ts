/**
 * เทสต์ออฟไลน์สำหรับการแปลงลิงก์ Google Maps → พิกัด
 * -------------------------------------------------------------
 * ปัญหาที่ต้องกันไว้: ผู้ใช้วางลิงก์แผนที่แล้วบันทึกเป็นที่อยู่ประจำ
 * แต่ได้พิกัด = null → แผนทริปบอกว่า "หาพิกัดไม่ได้"
 *
 * รัน: npm run test:maps-url
 */

import {
  parseMapsUrlCoords,
  mapsUrlPlaceName,
  isShortMapsLink,
} from "../src/mapsUrl";

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

// ── 1. พิกัดที่อยู่ในตัวลิงก์ ─────────────────────────────────────────────
console.log("\n[parseMapsUrlCoords]");

{
  // ลิงก์ place ทั่วไป — มี @lat,lng
  const p = parseMapsUrlCoords(
    "https://www.google.com/maps/place/วัดพระแก้ว/@18.7883,98.9923,17z/data=!4m8!3d18.7883!4d98.9923"
  );
  eq("ลิงก์ place มี @lat,lng", [p?.lat, p?.lng], [18.7883, 98.9923]);
  eq("ชื่อสถานที่", p?.name, "วัดพระแก้ว");
}

{
  // ลิงก์ place แบบ ?data=!4m8!3d…!4d… — ไม่มี @ แต่มี !3d/!4d
  const p = parseMapsUrlCoords(
    "https://www.google.com/maps/place/Some+Place/data=!4m8!3d13.7563!4d100.5018!16s%2Fg%2F11c3"
  );
  eq("ลิงก์แบบ data=!3d!4d", [p?.lat, p?.lng], [13.7563, 100.5018]);
}

{
  // ลิงก์ค้นหาพิกัดตรง ๆ
  eq(
    "maps.google.com/?q=lat,lng",
    (() => {
      const p = parseMapsUrlCoords("https://maps.google.com/?q=13.7563,100.5018");
      return [p?.lat, p?.lng];
    })(),
    [13.7563, 100.5018]
  );

  eq(
    "comma ที่ถูก encode (%2C)",
    (() => {
      const p = parseMapsUrlCoords(
        "https://www.google.com/maps?q=13.7563%2C100.5018"
      );
      return [p?.lat, p?.lng];
    })(),
    [13.7563, 100.5018]
  );

  eq(
    "ll=lat,lng",
    (() => {
      const p = parseMapsUrlCoords(
        "https://www.google.com/maps?ll=13.7563,100.5018&z=12"
      );
      return [p?.lat, p?.lng];
    })(),
    [13.7563, 100.5018]
  );

  eq(
    "/maps/dir/lat,lng",
    (() => {
      const p = parseMapsUrlCoords(
        "https://www.google.com/maps/dir/13.7563,100.5018/เชียงใหม่"
      );
      return [p?.lat, p?.lng];
    })(),
    [13.7563, 100.5018]
  );
}

{
  // พิกัดนอกโลก → ต้องไม่รับ
  eq(
    "พิกัดนอกโลก → null",
    parseMapsUrlCoords("https://www.google.com/maps?q=999,999"),
    null
  );
  eq("ลิงก์ว่าง → null", parseMapsUrlCoords(""), null);
}

{
  // ลิงก์ที่มีแต่ชื่อ → ยังหาพิกัดจากลิงก์ไม่ได้ (ต้องถาม Google ต่อ)
  eq(
    "ลิงก์ที่มีแต่ชื่อ → ไม่มีพิกัด",
    parseMapsUrlCoords("https://www.google.com/maps/place/วัดพระแก้ว"),
    null
  );
}

// ── 2. ชื่อสถานที่ในลิงก์ ───────────────────────────────────────────────
console.log("\n[mapsUrlPlaceName]");

eq("ชื่อจาก /place/", mapsUrlPlaceName("https://www.google.com/maps/place/วัด+พระแก้ว/data=x"), "วัด พระแก้ว");
eq(
  "ชื่อจาก ?q= (encode ไว้)",
  mapsUrlPlaceName(
    "https://www.google.com/maps/search/?api=1&query=%E0%B8%A7%E0%B8%B1%E0%B8%94%E0%B8%9E%E0%B8%A3%E0%B8%B0%E0%B9%81%E0%B8%81%E0%B9%89%E0%B8%A7"
  ),
  "วัดพระแก้ว"
);
eq(
  "q= ที่เป็นพิกัด → ไม่ใช่ชื่อ",
  mapsUrlPlaceName("https://maps.google.com/?q=13.7563,100.5018"),
  null
);
eq("ไม่มีชื่อในลิงก์", mapsUrlPlaceName("https://maps.app.goo.gl/AbCdEf"), null);

// ── 3. ลิงก์สั้น ───────────────────────────────────────────────────────
console.log("\n[isShortMapsLink]");

ok("maps.app.goo.gl เป็นลิงก์สั้น", isShortMapsLink("https://maps.app.goo.gl/AbCdEf"));
ok("goo.gl/maps เป็นลิงก์สั้น", isShortMapsLink("https://goo.gl/maps/xyz"));
ok(
  "ลิงก์ปกติไม่ใช่ลิงก์สั้น",
  !isShortMapsLink("https://www.google.com/maps/place/X/@18.7883,98.9923,17z")
);

// ── สรุป ─────────────────────────────────────────────────────────────────
console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
if (fail > 0) process.exit(1);
