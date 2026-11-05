/**
 * เทสต์การหาพิกัดจากลิงก์/ชื่อสถานที่
 * -------------------------------------------------------------
 * ปัญหาที่ต้องกันไว้: ผู้ใช้วางลิงก์ Google Maps ในช่อง "เพิ่มสถานที่ที่บันทึกไว้"
 * แล้วบันทึกได้ แต่ได้พิกัด = null → แผนทริปบอกว่า "หาพิกัดไม่ได้"
 *
 * แยกเป็น 2 ส่วน
 *   · ออฟไลน์ (ค่าเริ่มต้น) — ตรรกะทั้งหมด ไม่ยิงเครือข่าย
 *   · ออนไลน์ (LIVE=1)      — ยิง Google Places จริง (กินโควตา + ต้องมีคีย์)
 *
 * รัน: npm run test:resolve-coords        (ออฟไลน์)
 *      LIVE=1 npm run test:resolve-coords  (ยิง Google จริงด้วย)
 */

import http from "http";
import type { Request, Response } from "express";
import router from "../src/routes/places";
import { pickCoordCandidate, resolveCoordsBySearch } from "../src/routes/places";
import { expandMapsUrl, parseMapsUrlCoords } from "../src/mapsUrl";
import type { PlaceCandidate } from "../src/placeTypes";

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

// ── ดึง handler ของ route ออกมา (ไม่ต้องเปิด HTTP server) ─────────────────
const layer: any = (router as any).stack?.find(
  (l: any) => l.route?.path === "/resolve-coords"
);
const handler: any = layer?.route?.stack?.[0]?.handle;

/** เรียก handler พร้อม req/res ปลอม แล้วคืน { status, body } */
async function callRoute(body: any): Promise<{ status: number; body: any }> {
  const out: any = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: any) {
      out.body = payload;
      return res;
    },
  };
  await handler({ body } as unknown as Request, res as unknown as Response, () => {});
  return out;
}

/** ผู้สมัครปลอม (ไม่ต้องยิง Google) */
function fakeCandidate(p: Partial<PlaceCandidate>): PlaceCandidate {
  return {
    name: "",
    address: "",
    placeId: "fake",
    latitude: null,
    longitude: null,
    province: null,
    district: null,
    subdistrict: null,
    types: [],
    ...p,
  } as PlaceCandidate;
}

const WAT_CHIANG_MAI = fakeCandidate({
  name: "วัดพระแก้ว",
  address: "ถนนท่าตอน ตำบลพระสิทธิ์ อำเภอเมือง จังหวัดเชียงใหม่ 50100",
  latitude: 18.7883,
  longitude: 98.9923,
  province: "เชียงใหม่",
  district: "เมือง",
  subdistrict: "พระสิทธิ์",
});

/** วัดชื่อเดียวกันแต่อยู่คนละจังหวัด */
const WAT_CHIANG_RAI = fakeCandidate({
  name: "วัดพระแก้ว",
  address: "หมู่ 3 ตำบลแม่จัน อำเภอแม่จัน จังหวัดเชียงราย 57150",
  latitude: 19.9117,
  longitude: 99.8277,
  province: "เชียงราย",
  district: "แม่จัน",
  subdistrict: "แม่จัน",
});

const DUANGPHAN = fakeCandidate({
  name: "พระบาทสมเด็จพระเจ้าอยู่หัว",
  address: "ถนนท่าตอน ตำบลพระสิทธิ์ อำเภอเมือง จังหวัดเชียงใหม่ 50100",
  latitude: 18.7883,
  longitude: 98.9863,
  province: "เชียงใหม่",
  district: "เมือง",
  subdistrict: "พระสิทธิ์",
});

async function main() {
  if (typeof handler !== "function") {
    console.error("ไม่พบ route POST /resolve-coords");
    process.exit(1);
  }

  // ── 1. พิกัดในตัวลิงก์เอง (ออฟไลน์) ────────────────────────────────────
  console.log("\n[พิกัดในตัวลิงก์]");

  {
    const r = await callRoute({
      url: "https://www.google.com/maps/place/วัดพระแก้ว/@18.7883,98.9923,17z/data=!4m8!3d18.7883!4d98.9923",
    });
    eq("สถานะ 200", r.status, 200);
    eq("ok", r.body?.ok, true);
    eq("source", r.body?.source, "url");
    eq("lat", r.body?.lat, 18.7883);
    eq("lng", r.body?.lng, 98.9923);
  }

  {
    const r = await callRoute({
      url: "https://www.google.com/maps/place/Some+Place/data=!4m8!3d13.7563!4d100.5018!16s%2Fg%2F11c3",
    });
    eq("รูปแบบ !3d/!4d → source=url", r.body?.source, "url");
    eq("lat", r.body?.lat, 13.7563);
    eq("lng", r.body?.lng, 100.5018);
  }

  {
    const r = await callRoute({});
    eq("ไม่ใส่อะไร → 400", r.status, 400);
    eq("reason", r.body?.reason, "empty_input");
  }

  // ── 2. ตาม redirect ของลิงก์สั้น (ออฟไลน์ — เซิร์ฟเวอร์จำลองในเครื่อง) ────
  console.log("\n[ลิงก์สั้น → ตาม redirect]");

  {
    // เปิดเซิร์ฟเวอร์จำลองที่ 302 ไปยัง URL แผนที่ที่มีพิกัด
    // (จำลองพฤติกรรมของ maps.app.goo.gl โดยไม่ต้องต่อเน็ตจริง)
    const target =
      "https://www.google.com/maps/place/%E0%B8%A7%E0%B8%B1%E0%B8%94%E0%B8%9E%E0%B8%A3%E0%B8%B0%E0%B9%81%E0%B8%81%E0%B9%89%E0%B8%A7/@18.7883,98.9923,17z";
    const server = http.createServer((req, res) => {
      res.writeHead(302, { Location: target });
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const port = (server.address() as any).port;

    const expanded = await expandMapsUrl(`http://127.0.0.1:${port}/short`);
    ok("กางลิงก์ได้ URL ปลายทาง", !!expanded, `ได้ ${expanded}`);
    const coords = expanded ? parseMapsUrlCoords(expanded) : null;
    ok(
      "URL ที่กางแล้วมีพิกัด",
      coords?.lat === 18.7883 && coords?.lng === 98.9923,
      `ได้ ${coords?.lat}, ${coords?.lng}`
    );

    server.close();
  }

  // ── 3. เลือกผลลัพธ์ให้ตรงจังหวัด (ออฟไลน์ — ผลลัพธ์ปลอม) ───────────────
  console.log("\n[เลือกผลลัพธ์ให้ตรงที่ถาม]");

  {
    const picked = pickCoordCandidate(
      [WAT_CHIANG_RAI, WAT_CHIANG_MAI],
      "วัดพระแก้ว เชียงใหม่"
    );
    eq(
      'คำค้น "วัดพระแก้ว เชียงใหม่" → วัดในเชียงใหม่ (ไม่ใช่จังหวัดอื่นที่ชื่อเหมือนกัน)',
      picked?.province,
      "เชียงใหม่"
    );
  }

  {
    // ชื่อในลิงก์คือ "ที่ธีอารามหลวงเชียงใหม่" แต่ชื่อที่ Google ใช้คือ
    // "พระบาทสมเด็จพระเจ้าอยู่หัว" → ต้องเดาจากจังหวัดที่อยู่ในชื่อ
    const picked = pickCoordCandidate(
      [WAT_CHIANG_RAI, DUANGPHAN],
      "ที่ธีอารามหลวงเชียงใหม่"
    );
    eq(
      'ชื่อคนละแบบแต่มีจังหวัดกำกับ → เลือกตัวที่อยู่ในจังหวัดนั้น',
      picked?.province,
      "เชียงใหม่"
    );
  }

  {
    // คำค้นมั่ว ๆ ที่ไม่มีอะไรตรงกับผลลัพธ์เลย → ต้องไม่ตอบพิกัดมั่ว
    const picked = pickCoordCandidate(
      [WAT_CHIANG_MAI, WAT_CHIANG_RAI],
      "zzzไม่มีที่อยู่นี้จริงzzz12345"
    );
    eq("คำค้นที่ไม่มีอะไรตรง → null (ไม่ตอบพิกัดมั่ว)", picked, null);
  }

  {
    // ไม่มีชื่อจังหวัดในคำค้น → เอาที่ชื่อตรงที่สุด (ผลแรกที่ชื่อตรง)
    const picked = pickCoordCandidate(
      [WAT_CHIANG_RAI, WAT_CHIANG_MAI],
      "วัดพระแก้ว"
    );
    ok("คำค้นไม่มีจังหวัด → ได้ผลลัพธ์ที่ชื่อตรง", picked?.name === "วัดพระแก้ว");
  }

  {
    // ผลลัพธ์อยู่คนละจังหวัดอย่างชัดเจน → ต้องไม่ตอบพิกัดมั่ว
    // (ผิดจังหวัด = เส้นทาง/ค่าน้ำมันผิดทั้งแผน แย่กว่าบอกว่าไม่เจอ)
    const picked = pickCoordCandidate(
      [WAT_CHIANG_RAI],
      "วัดพระแก้ว เชียงใหม่"
    );
    eq("มีแต่ผลลัพธ์คนละจังหวัด → null (ไม่ตอบพิกัดผิด)", picked, null);
  }

  {
    // "กรุงเทพ" กับ "กรุงเทพมหานคร" คือจังหวัดเดียวกัน
    const bangkok = fakeCandidate({
      name: "ห้างสรรพสินค้าเซ็นทรัลเวิลด์",
      address: "ถนนเจริญกรุง แขวงสี่พระยา เขตบางรัก กรุงเทพมหานคร 10100",
      latitude: 13.746,
      longitude: 100.539,
      province: "กรุงเทพ",
      district: "บางรัก",
      subdistrict: "สี่พระยา",
    });
    const picked = pickCoordCandidate([bangkok], "ห้างเซ็นทรัลเวิลด์ กรุงเทพ");
    ok(
      'คำค้น "กรุงเทพ" ต้องจับคู่กับที่อยู่ "กรุงเทพมหานคร"',
      picked?.latitude === 13.746
    );
  }

  // ── 3.1 จำลองสถานการณ์จริงที่เจอใน production ──────────────────────────
  console.log("\n[จำลองผลลัพธ์จาก Google]");

  {
    // ของจริง: ค้น "วัดพระแก้ว เชียงใหม่" ได้วัดในเชียงรายมาก่อน
    // และวัดในเชียงใหม่อยู่อันดับที่ 6 → ถ้าตัดที่ 5 รายการ จะเลือกผิดจังหวัด
    const search = async (query: string, opts?: { maxResults?: number }) => {
      const all = [WAT_CHIANG_RAI, WAT_CHIANG_RAI, WAT_CHIANG_RAI, WAT_CHIANG_RAI, WAT_CHIANG_RAI, WAT_CHIANG_MAI];
      return all.slice(0, opts?.maxResults ?? 5);
    };
    const picked = await resolveCoordsBySearch(
      "วัดพระแก้ว เชียงใหม่",
      search
    );
    eq(
      "ของจริงอยู่อันดับที่ 6 → ต้องดึงมาให้ครบ 20 รายการ แล้วเลือกตัวที่อยู่ในจังหวัดที่ถาม",
      picked?.province,
      "เชียงใหม่"
    );
  }

  {
    // ถ้าค้นแล้วไม่มีตัวที่อยู่ในจังหวัดที่ถามเลย → ไม่ตอบพิกัด
    const search = async () => [WAT_CHIANG_RAI];
    const picked = await resolveCoordsBySearch("วัดพระแก้ว เชียงใหม่", search);
    eq("ไม่มีตัวไหนอยู่ในจังหวัดที่ถาม → null", picked, null);
  }

  {
    // ค้นรอบแรกได้ผิดจังหวัด → ต้องค้นใหม่แบบเจาะจงจังหวัด
    const queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      if (query.includes("จังหวัด")) return [WAT_CHIANG_MAI];
      return [WAT_CHIANG_RAI];
    };
    const picked = await resolveCoordsBySearch("วัดพระแก้ว เชียงใหม่", search);
    eq("ค้นรอบสองแบบเจาะจงจังหวัด → ได้วัดในเชียงใหม่", picked?.province, "เชียงใหม่");
    ok(
      'คำค้นรอบสองต้องเป็น "วัดพระแก้ว จังหวัดเชียงใหม่"',
      queries[1] === "วัดพระแก้ว จังหวัดเชียงใหม่",
      `ได้ "${queries[1]}"`
    );
  }

  {
    // ชื่อที่มีจังหวัดอยู่ในตัวชื่อเอง (โรงแรมเชียงใหม่) → คำค้นรอบสองต้องไม่ตัดชื่อทิ้ง
    const queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      // รอบแรกได้ผล (ผิดจังหวัด) → จึงไปค้นรอบสองแบบเจาะจงจังหวัด
      return query.includes("จังหวัด") ? [] : [WAT_CHIANG_RAI];
    };
    await resolveCoordsBySearch("โรงแรมเชียงใหม่", search);
    ok(
      'คำค้นรอบสองต้องยังมีชื่อสถานที่ ("โรงแรมเชียงใหม่ จังหวัดเชียงใหม่")',
      queries[queries.length - 1] === "โรงแรมเชียงใหม่ จังหวัดเชียงใหม่",
      `ได้ "${queries[queries.length - 1]}"`
    );
  }

  // ── 4. ส่วนที่ยิง Google จริง (ต้องเปิดด้วย LIVE=1) ─────────────────────
  if (process.env.LIVE === "1") {
    console.log("\n[ยิง Google Places จริง]");

    {
      const r = await callRoute({ text: "วัดพระแก้ว เชียงใหม่" });
      if (r.body?.ok) {
        eq("source", r.body?.source, "places");
        ok(
          "พิกัดอยู่ในเชียงใหม่",
          Math.abs(Number(r.body?.lat) - 18.7883) < 0.02 &&
            Math.abs(Number(r.body?.lng) - 98.9923) < 0.02,
          `ได้ ${r.body?.lat}, ${r.body?.lng}`
        );
      } else {
        ok(
          "ค้นชื่อสถานที่ได้ (ต้องมี GOOGLE_PLACES_API_KEY ใน .env)",
          false,
          `ได้ ${JSON.stringify(r.body)}`
        );
      }
    }

    {
      const placeName = "ที่ธีอารามหลวงเชียงใหม่";
      const r = await callRoute({
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          placeName
        )}`,
      });
      if (r.body?.ok) {
        eq("ลิงก์ที่มีแต่ชื่อ → source=places", r.body?.source, "places");
        ok(
          "พิกัดอยู่ในเชียงใหม่",
          Math.abs(Number(r.body?.lat) - 18.79) < 0.05 &&
            Math.abs(Number(r.body?.lng) - 98.99) < 0.05,
          `ได้ ${r.body?.lat}, ${r.body?.lng}`
        );
      } else {
        ok(
          "ลิงก์ที่มีแต่ชื่อ → หาพิกัดได้",
          false,
          `ได้ ${JSON.stringify(r.body)}`
        );
      }
    }

    {
      const r = await callRoute({ text: "zzzไม่มีที่อยู่นี้จริงzzz12345" });
      eq("ชื่อที่ไม่มีจริง → ok:false", r.body?.ok, false);
      eq("reason", r.body?.reason, "not_found");
    }
  } else {
    console.log(
      "\n[ข้ามส่วนที่ยิง Google จริง — รันด้วย LIVE=1 เพื่อเช็กของจริง]"
    );
  }

  // ── สรุป ───────────────────────────────────────────────────────────────
  console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
