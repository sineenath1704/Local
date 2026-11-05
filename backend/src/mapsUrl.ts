/**
 * ลิงก์ Google Maps → พิกัด + ชื่อสถานที่
 * -------------------------------------------------------------
 * ใช้ที่ route `POST /places/resolve-coords` (ฝั่ง backend)
 * ฝั่งแอปมีสำเนาแบบเดียวกันอยู่ใน `src/services/savedPlacesService.ts`
 * (แอปกับ backend เป็นคนละแพ็กเกจ → import ข้ามกันไม่ได้)
 *
 * ทำไมต้องมี
 *   ลิงก์ที่ผู้ใช้วางมีหลายรูปแบบ และหลายรูปแบบ "ไม่มีพิกัดอยู่ในตัวข้อความ"
 *     · ลิงก์สั้น  `https://maps.app.goo.gl/XXXX`  → ต้องกาง redirect ก่อน
 *     · ลิงก์ชื่อ `.../maps/place/ชื่อสถานที่/...` → มีแต่ชื่อ ต้องถาม Google
 *     · `?q=ชื่อสถานที่` → มีแต่ชื่อ ต้องถาม Google
 *   ถ้าปล่อยไว้ → จุดที่บันทึกไว้จะไม่มีพิกัด → แผนทริปบอกว่า "หาพิกัดไม่ได้"
 */

/** ตัวเลขพิกัด (ละเลยเครื่องหมายลบ/ทศนิยมได้) */
const NUM = "(-?\\d+(?:\\.\\d+)?)";

/**
 * รูปแบบที่มีพิกัดอยู่ในตัวลิงก์
 * -------------------------------------------------------------
 * เรียงตามความแน่นอน: รูปแบบที่ "เจาะจง" กว่าต้องอยู่ข้างหน้า
 */
const COORD_PATTERNS: RegExp[] = [
  // ?data=!4m8!3d18.7883!4d98.9923 — พิกัดอยู่ในพารามิเตอร์ของ place
  new RegExp(`!3d${NUM}!4d${NUM}`),
  // @18.7883,98.9923,17z
  new RegExp(`@${NUM},${NUM}`),
  // ?q= / ?query= / ?ll= / ?center=
  new RegExp(`[?&](?:q|query|ll|center)=${NUM},${NUM}`),
  // /maps/dir/18.7883,98.9923/...
  new RegExp(`/maps/dir/${NUM},${NUM}`),
];

/** decode แบบไม่โยน error (URL ที่ผิดรูปแบบ) */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** แปลงลิงก์ให้อ่านง่ายขึ้น: แทนที่ comma ที่ถูก encode + decode ครั้งเดียว */
function normalizeUrl(url: string): string {
  const replaced = url.replace(/%2C/gi, ",");
  return safeDecode(replaced);
}

/** ตรวจว่าคู่ตัวเลขนี้เป็นพิกัดที่ใช้ได้จริง */
function validCoords(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** ค่าที่เขียนเป็น "lat,lng" หรือเปล่า */
function isCoordPair(value: string): boolean {
  const m = value.match(new RegExp(`^${NUM},${NUM}$`));
  if (!m) return false;
  return validCoords(parseFloat(m[1]), parseFloat(m[2]));
}

export interface MapsUrlCoords {
  lat: number;
  lng: number;
  /** ชื่อสถานที่ที่เจอในลิงก์ (ถ้ามี) */
  name?: string;
}

/**
 * ดึงพิกัดออกจากลิงก์ Google Maps
 * -------------------------------------------------------------
 * คืน null ถ้าลิงก์ไม่มีพิกัดในตัว (เช่น ลิงก์สั้น หรือลิงก์ที่มีแต่ชื่อ)
 */
export function parseMapsUrlCoords(raw: string): MapsUrlCoords | null {
  const url = normalizeUrl(String(raw ?? "").trim());
  if (!url) return null;

  const name = mapsUrlPlaceName(url) ?? undefined;

  for (const pattern of COORD_PATTERNS) {
    const m = url.match(pattern);
    if (!m) continue;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!validCoords(lat, lng)) continue;
    return { lat, lng, name };
  }

  return null;
}

/**
 * ชื่อสถานที่ที่อยู่ในลิงก์ (ถ้ามี)
 * -------------------------------------------------------------
 * รองรับ `/place/<ชื่อ>` · `/search/<ชื่อ>` · `?q=<ชื่อ>` · `?query=<ชื่อ>`
 * ค่า `q=13.7563,100.5018` เป็นพิกัด ไม่ใช่ชื่อ → คืน null
 */
export function mapsUrlPlaceName(raw: string): string | null {
  const url = normalizeUrl(String(raw ?? "").trim());
  if (!url) return null;

  const patterns = [
    /\/place\/([^/@?&#]+)/,
    /\/search\/([^/@?&#]+)/,
    /\/maps\/place\/([^/@?&#]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (!m?.[1]) continue;
    const name = decodeName(m[1]);
    if (name) return name;
  }

  const q = url.match(/[?&](?:q|query)=([^&#]+)/);
  if (q?.[1]) {
    const value = decodeName(q[1]);
    if (value && !isCoordPair(value)) return value;
  }

  return null;
}

/** ชื่อที่อ่านออกจาก URL — `+` คือช่องว่าง */
function decodeName(value: string): string | null {
  const name = safeDecode(value.replace(/\+/g, " ")).trim();
  return name.length > 0 ? name : null;
}

/** ลิงก์สั้นของ Google Maps — ต้องกาง redirect ก่อนจึงจะเห็นพิกัด */
export function isShortMapsLink(raw: string): boolean {
  const url = String(raw ?? "").trim().toLowerCase();
  return url.includes("maps.app.goo.gl") || url.includes("goo.gl/maps");
}

/**
 * กางลิงก์สั้นให้เป็น URL เต็ม (ตาม redirect ของ Google)
 * -------------------------------------------------------------
 * ทำที่ฝั่งเซิร์ฟเวอร์ เพราะ React Native ตาม redirect ให้แล้วแต่ไม่เห็น
 * URL ปลายทาง (`response.url` ว่างเปล่า) → ฝั่งแอปกางลิงก์ไม่ได้
 */
export async function expandMapsUrl(
  raw: string,
  timeoutMs = 5000
): Promise<string | null> {
  const url = String(raw ?? "").trim();
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Google ตอบ 302 ให้เฉพาะกับ UA ที่เหมือนเบราว์เซอร์
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "th,en;q=0.8",
      },
    });
    const finalUrl = res.url || "";
    return finalUrl && finalUrl !== url ? finalUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
