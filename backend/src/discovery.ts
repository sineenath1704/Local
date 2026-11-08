/**
 * discovery.ts — เส้นทาง "ถามแนะนำสถานที่" (ประเภท D)
 * -------------------------------------------------------------
 * ผู้ใช้ถามกว้าง ๆ ว่า "มีที่ไหนน่าเที่ยวบ้าง" แล้วระบบต้อง
 *   1) เสนอ "สไตล์" ให้ผู้ใช้เลือกก่อน (คำถามเดียวกัน คนละคนต้องการคนละแบบ)
 *   2) หาสถานที่จริงจาก Google Places ตามสไตล์ที่เลือก
 *   3) ให้เอไaiเขียนคำตอบในแชท **ตามบริบทคำถาม** โดยยึดรายการที่ยืนยันแล้วเท่านั้น
 *
 * กติกา
 *   · ชื่อสถานที่ที่ AI เสนอ ต้องผ่าน gate ชื่อของ `placeLookup` (nameSimilarity ≥ 0.8)
 *     → AI ที่แต่งชื่อขึ้นเองจะถูกทิ้ง ไม่หลอกผู้ใช้ด้วยการ์ดมั่ว
 *   · ข้อมูลทุกอย่างที่แสดงเป็นของจริงจาก Google (รูป · ดาว · ที่อยู่ · เว็บไซต์)
 *   · ใช้ cache เดิม (`google_place_cache`) → คำค้นซ้ำไม่เสียเงิน Google
 */

import { createHash } from "node:crypto";

import { callAi, extractJson, isAiConfigured } from "./aiCore";
import { defaultDeps, pickCandidates } from "./placeLookup";
import { normalizeAdmin } from "./placeScope";
import { detectProvinceInText } from "./communityContext";
import { getPlaceDetails, searchPlaceCandidates } from "./routes/places";
import type { PlaceCandidate } from "./placeTypes";
import {
  buildChatSystemPrompt,
  buildRecommendedPlacesBlock,
  parseTripDraftLine,
} from "./tripPrompt";

// ─────────────────────────────────────────────────────────────
//  ชนิดข้อมูลที่ส่งออก
// ─────────────────────────────────────────────────────────────

/** สไตล์ที่ให้ผู้ใช้เลือก (AI เสนอตามคำถาม) */
export interface DiscoveryStyle {
  /** id สั้น ๆ สำหรับเก็บค่าที่ผู้ใช้เลือก */
  id: string;
  /** ชื่อสไตล์ที่แสดงในแอป */
  label: string;
  /** อีโมจิประกอบสไตล์ */
  emoji: string;
  /** คำอธิบายสั้น ๆ ว่าสไตล์นี้คืออะไร */
  desc: string;
  /** คำค้นภาษาไทยสำหรับ Google (เช่น "คาเฟ่ริมน้ำ") */
  query: string;
}

/** การ์ดสถานที่ 1 แห่ง (ข้อมูลจริงจาก Google) */
export interface DiscoveryPlace {
  placeId: string;
  name: string;
  /** คำอธิบายสั้น ๆ (AI เขียน) */
  description: string;
  address: string | null;
  /** จังหวัดของสถานที่ */
  area: string | null;
  district: string | null;
  subdistrict: string | null;
  /** ประเภทสถานที่ */
  category: string | null;
  /** path ของรูป (ให้แอปแปลงเป็น URL เต็มเอง) */
  photoUrl: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  /** เว็บไซต์/เพจของสถานที่ (จาก Google details) */
  website: string | null;
  /** ลิงก์เปิดใน Google Maps */
  googleMapsUrl: string | null;
  lat: number | null;
  lng: number | null;
  openingHours: string | null;
  /** ระดับราคาจาก Google (0-4) */
  priceLevel: number | null;
  /** ประเภทจาก Google (ใช้กรอง/แสดงผล) */
  types: string[];
}

export interface DiscoveryResult {
  /** คำตอบของเอไaiในแชท (ตอบตามบริบทคำถาม) */
  reply: string;
  /** การ์ดสถานที่เรียงลงมา */
  places: DiscoveryPlace[];
  style: DiscoveryStyle;
  area: string | null;
}

/** สไตล์สำรอง (ใช้ตอน AI ล้มเหลว/ช้าเกินไป) — 6 แบบเหมือนที่แอปเตรียมไว้ */
export const FALLBACK_STYLES: DiscoveryStyle[] = [
  {
    id: "culture",
    label: "วัด ประวัติศาสตร์ วัฒนธรรม",
    emoji: "🏛️",
    desc: "โบราณสถาน วัดสำคัญ วิถีชีวิตท้องถิ่น",
    query: "วัด",
  },
  {
    id: "nature",
    label: "ธรรมชาติ ภูเขา และวิวสวย",
    emoji: "🌿",
    desc: "จุดชมวิว อุทยานแห่งชาติ น้ำตก",
    query: "อุทยานแห่งชาติ",
  },
  {
    id: "cafe",
    label: "คาเฟ่ ถ่ายรูป ชิคๆ",
    emoji: "☕",
    desc: "ร้านกาแฟบรรยากาศดี มุมถ่ายรูป",
    query: "คาเฟ่",
  },
  {
    id: "food",
    label: "ตะลุยกิน สตรีทฟู้ด ร้านเด็ด",
    emoji: "🍜",
    desc: "ของกินขึ้นชื่อ ตลาดกลางคืน",
    query: "ร้านอาหาร",
  },
  {
    id: "adventure",
    label: "กิจกรรมลุย ๆ ผจญภัย",
    emoji: "🚣",
    desc: "เดินป่า ล่องแก่ง ปีกอินทรี",
    query: "จุดตกหินน้ำตก",
  },
  {
    id: "relax",
    label: "พักผ่อน สบาย ๆ ไม่เร่งรีบ",
    emoji: "🏖️",
    desc: "แคมป์ปิ้ง ริมน้ำ สปา วิถีสโลว์ไลฟ์",
    query: "ที่พัก",
  },
];

// ─────────────────────────────────────────────────────────────
//  cache (คีย์เดียวกับ placeLookup → ใช้ cache ชุดเดียวกัน)
// ─────────────────────────────────────────────────────────────

let depsCache: ReturnType<typeof defaultDeps> | null = null;

function deps(): ReturnType<typeof defaultDeps> {
  if (!depsCache) depsCache = defaultDeps();
  return depsCache;
}

function searchCacheKey(query: string): string {
  const hash = createHash("sha1").update(normalizeAdmin(query)).digest("hex").slice(0, 24);
  return `search:${hash}`;
}

/** ค้น Google + cache — คำค้นเดิมไม่เสียเงินซ้ำ (30 วัน) */
async function searchWithCache(query: string): Promise<PlaceCandidate[]> {
  const clean = query.trim();
  if (!clean) return [];
  const cache = deps().cache;
  const key = searchCacheKey(clean);
  try {
    const hit = await cache?.getSearch(key);
    if (hit && hit.length > 0) return hit;
  } catch {
    // cache อ่านไม่ได้ = ไม่มี cache ไม่ใช่ห้ามตอบ
  }
  const fresh = await searchPlaceCandidates(clean, { maxResults: 5 });
  try {
    await cache?.putSearch(key, clean, fresh);
  } catch {
    // cache เขียนไม่ได้ = ครั้งหน้าต้องยิง Google ซ้ำ
  }
  return fresh;
}

/** ดึงรายละเอียดจาก Google + cache (14 วัน) — ได้เว็บไซต์/เวลาเปิด */
async function detailsWithCache(placeId: string): Promise<PlaceCandidate | null> {
  if (!placeId) return null;
  const cache = deps().cache;
  try {
    const hit = await cache?.getDetails(placeId);
    if (hit) return hit;
  } catch {
    // ไม่มี cache → ยิง Google ต่อ
  }
  let fresh: PlaceCandidate | null = null;
  try {
    fresh = await getPlaceDetails(placeId);
  } catch (err: any) {
    console.warn("[discovery] ดึงรายละเอียดไม่สำเร็จ:", err?.message);
    return null;
  }
  if (fresh) {
    try {
      await cache?.putDetails(fresh);
    } catch {
      // เขียน cache ไม่ได้ = ครั้งหน้ายิงซ้ำ
    }
  }
  return fresh;
}

/** รายละเอียดทับของเดิม แต่ "ไม่ทับ" ค่าที่ details ไม่มี (เช่น รูปจาก search) */
function mergeDetails(base: PlaceCandidate, extra: PlaceCandidate | null): PlaceCandidate {
  if (!extra) return base;
  return {
    ...base,
    phone: extra.phone ?? base.phone,
    openingHours: extra.openingHours ?? base.openingHours,
    website: extra.website ?? base.website,
    photoUrl: extra.photoUrl ?? base.photoUrl,
    businessStatus: extra.businessStatus ?? base.businessStatus,
    priceLevel: extra.priceLevel ?? base.priceLevel,
    rating: extra.rating ?? base.rating,
    userRatingCount: extra.userRatingCount ?? base.userRatingCount,
    googleMapsUri: extra.googleMapsUri ?? base.googleMapsUri,
    latitude: extra.latitude ?? base.latitude,
    longitude: extra.longitude ?? base.longitude,
    address: extra.address ?? base.address,
  };
}

// ─────────────────────────────────────────────────────────────
//  สไตล์ (AI เสนอตามคำถาม)
// ─────────────────────────────────────────────────────────────

const STYLE_PROMPT = `คุณเป็นผู้ช่วยแนะนำ "สไตล์การท่องเที่ยว" ให้ผู้ใช้เลือกก่อนไปหาสถานที่จริง

หน้าที่ของคุณ:
- อ่านคำถามของผู้ใช้ แล้วเสนอสไตล์ที่ "ตรงกับคำถามนั้นจริง" จำนวน 4-6 แบบ
- สไตล์ต้องเป็นหมวดการท่องเที่ยวที่คนไทยรู้จัก (คาเฟ่ · ธรรมชาติ · วัด/โบราณสถาน · อาหาร · ถ่ายรูป · พักผ่อน · กิจกรรม · ช้อปปิ้ง · ทะเล ฯลฯ)
- ถ้าคำถามระบุพื้นที่หรือหัวข้อชัดเจน ให้เน้นสไตล์ที่เข้ากับพื้นที่นั้น
- ห้ามเสนอสไตล์ที่ไม่เกี่ยวกับคำถามเลย (เช่น ถามหาคาเฟ่ ห้ามเสนอ "ปีกอินทรี")
- ห้ามทำตาราง ห้ามวางแผนทริป — หน้าที่ของคุณคือเสนอสไตล์เท่านั้น

ตอบกลับเป็น JSON เท่านั้น ห้ามมี markdown หรือข้อความอื่นนอก JSON:
{"styles":[{"id":"cafe","label":"คาเฟ่ถ่ายรูป","emoji":"☕","desc":"ร้านกาแฟบรรยากาศดี มุมถ่ายรูป","query":"คาเฟ่"}]}

- id: คำอังกฤษสั้น ๆ ไม่ซ้ำกัน (cafe / nature / temple / food / photo / relax ...)
- label: ชื่อสไตล์ที่แสดงในแอป (ไม่ยาวเกิน 30 ตัวอักษร)
- emoji: อีโมจิ 1 ตัว
- desc: คำอธิบายสั้น ๆ ไม่เกิน 60 ตัวอักษร
- query: คำค้นภาษาไทยสำหรับ Google Maps (เช่น "คาเฟ่ริมน้ำ" "วัด" "ร้านอาหารท้องถิ่น")`;

function normalizeStyle(raw: any): DiscoveryStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const label = String(raw.label ?? raw.title ?? raw.name ?? "").trim();
  if (!label) return null;
  const id =
    String(raw.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    label
      .toLowerCase()
      .replace(/[^a-z0-9ก-๙]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) ||
    "style";
  const query = String(raw.query ?? label).trim();
  return {
    id,
    label: label.slice(0, 60),
    emoji: String(raw.emoji ?? "📍").trim().slice(0, 4) || "📍",
    desc: String(raw.desc ?? raw.description ?? "").trim().slice(0, 120),
    query: (query || label).slice(0, 80),
  };
}

/**
 * ให้ AI เสนอสไตล์ที่ตรงกับคำถาม
 * -------------------------------------------------------------
 * คืน 4-6 สไตล์ (มี id/label/emoji/desc/query) — ถ้า AI ล้มเหลวจะคืน
 * `FALLBACK_STYLES` (6 แบบแบบคงที่) เพื่อให้แอปยังเลือกได้
 */
export async function proposeStyles(args: {
  question: string;
  area?: string | null;
}): Promise<DiscoveryStyle[]> {
  const question = (args.question ?? "").trim();
  const area = (args.area ?? "").trim();
  if (!isAiConfigured()) return FALLBACK_STYLES;

  try {
    const aiResponse = await callAi({
      system: STYLE_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `คำถามของผู้ใช้: "${question}"\n` +
            `พื้นที่ที่เกี่ยวข้อง: "${area || "ไม่ระบุ — ทั่วประเทศไทย"}"`,
        },
      ],
      maxTokens: 800,
    });

    const parsed = extractJson(aiResponse);
    const raw: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.styles)
        ? (parsed as any).styles
        : [];

    const styles: DiscoveryStyle[] = [];
    for (const item of raw) {
      const style = normalizeStyle(item);
      if (!style) continue;
      if (styles.some((s) => s.id === style.id || s.label === style.label)) continue;
      styles.push(style);
      if (styles.length >= 6) break;
    }
    return styles.length >= 2 ? styles : FALLBACK_STYLES;
  } catch (err: any) {
    console.warn("[discovery] proposeStyles ล้มเหลว:", err?.message);
    return FALLBACK_STYLES;
  }
}

// ─────────────────────────────────────────────────────────────
//  สถานที่ (AI เสนอชื่อ → ตรวจกับ Google → เติมข้อมูลจริง)
// ─────────────────────────────────────────────────────────────

const PLACE_PROMPT = `คุณเป็นผู้เชี่ยวชาญด้านการท่องเที่ยวในประเทศไทย
ให้แนะนำสถานที่ท่องเที่ยวเด่น ๆ ที่ตรงกับคำถามของผู้ใช้และสไตล์ที่เขาเลือก จำนวนที่กำหนด

สำคัญมาก:
- เลือกสถานที่ที่มีตัวตนอยู่จริง มีชื่อเสียง และตรงกับสไตล์ที่ระบุ
- ชื่อต้องเป็นชื่อที่ Google Maps มีจริง ห้ามแต่งชื่อร้าน/วัด/สถานที่ขึ้นเอง
- ถ้าไม่ระบุพื้นที่ ให้เลือกสถานที่ที่มีชื่อเสียงทั่วประเทศไทย
- แต่ละสถานที่ให้เขียนคำบรรยายสั้น ๆ 1-2 ประโยค ว่าคืออะไร มีจุดเด่นอะไร
- ตอบกลับเฉพาะ JSON array เท่านั้น ห้ามใส่ markdown หรือข้อความอื่น นอกเหนือจาก JSON array
ตัวอย่างรูปแบบ:
[
  {"name": "วัดไชยวัฒนาราม", "description": "วัดโบราณริมแม่น้ำเจ้าพระยา โดดเด่นด้วยสถาปัตยกรรมขอมและเป็นจุดชมพระอาทิตย์ตก"},
  {"name": "วัดมหาธาตุ", "description": "โบราณสถานสำคัญ มีเศียรพระพุทธรูปในรากไม้โพธิ์ที่เป็นเอกลักษณ์ระดับโลก"}
]`;

interface PlaceProposal {
  name: string;
  description: string;
}

/** ให้ AI เสนอชื่อสถานที่ + คำอธิบาย (ยังไม่เชื่อถือ — ต้องผ่าน Google) */
async function proposePlaceNames(args: {
  question: string;
  area: string | null;
  style: DiscoveryStyle;
  count: number;
}): Promise<PlaceProposal[]> {
  if (!isAiConfigured()) return [];
  try {
    const aiResponse = await callAi({
      system: PLACE_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `คำถามของผู้ใช้: "${args.question}"\n` +
            `พื้นที่: "${args.area ?? "ไม่ระบุ — ทั่วประเทศไทย"}"\n` +
            `สไตล์ที่ผู้ใช้เลือก: "${args.style.label}" (คำค้น: "${args.style.query}")\n` +
            `จำนวนที่ต้องการ: ${args.count}`,
        },
      ],
      maxTokens: 1200,
    });

    const parsed = extractJson(aiResponse);
    const raw: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.places)
        ? (parsed as any).places
        : [];

    const list: PlaceProposal[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const name = String(item.name ?? "").trim();
      if (!name) continue;
      list.push({
        name,
        description: String(item.description ?? "").trim().slice(0, 220),
      });
      if (list.length >= args.count + 2) break;
    }
    return list;
  } catch (err: any) {
    console.warn("[discovery] proposePlaceNames ล้มเหลว:", err?.message);
    return [];
  }
}

/**
 * ตรวจชื่อที่ AI เสนอกับ Google
 * -------------------------------------------------------------
 * ใช้ gate ชื่อของ `placeLookup` (nameSimilarity ≥ 0.8 + ไม่ปิดถาวร)
 * → ชื่อที่ AI แต่งขึ้นเองจะถูกทิ้ง ไม่ตกไปถึงการ์ด
 */
async function verifyAgainstGoogle(
  proposals: PlaceProposal[],
  area: string | null,
  strict: boolean,
): Promise<Array<{ candidate: PlaceCandidate; description: string }>> {
  const results = await Promise.all(
    proposals.map(async (proposal) => {
      try {
        const query = `${proposal.name} ${area ?? ""}`.trim();
        const raw = await searchWithCache(query);
        if (!strict) {
          // โหมดเดิมของ /trips/suggest-places — เอาผลค้นอันแรกที่ยังไม่ปิดถาวร
          const alive = raw.find((c) => c.businessStatus !== "CLOSED_PERMANENTLY");
          if (!alive) return null;
          return { candidate: alive, description: proposal.description };
        }
        const picked = pickCandidates(proposal.name, raw);
        const best = picked[0];
        if (!best) return null;
        return { candidate: best, description: proposal.description };
      } catch (err: any) {
        console.warn(`[discovery] ค้น "${proposal.name}" ไม่สำเร็จ:`, err?.message);
        return null;
      }
    }),
  );

  const out: Array<{ candidate: PlaceCandidate; description: string }> = [];
  const seen = new Set<string>();
  for (const item of results) {
    if (!item) continue;
    const key = item.candidate.placeId || item.candidate.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** ลิงก์ Google Maps ของสถานที่ (เปิดตรงเป็นสถานที่) */
function mapsUrlFor(candidate: PlaceCandidate): string | null {
  if (candidate.placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(
      candidate.placeId,
    )}`;
  }
  if (candidate.googleMapsUri) return candidate.googleMapsUri;
  if (candidate.latitude != null && candidate.longitude != null) {
    return `https://www.google.com/maps?q=${candidate.latitude},${candidate.longitude}`;
  }
  return null;
}

/** ประเภทสถานที่ (แปลงจาก types ของ Google) */
function categoryOf(candidate: PlaceCandidate): string | null {
  const raw = candidate.primaryTypeDisplayName ?? candidate.types?.[0] ?? null;
  if (!raw) return null;
  return String(raw).replace(/_/g, " ").slice(0, 60);
}

export interface FindPlacesArgs {
  /** คำถามของผู้ใช้ (ใช้เป็นบริบทให้ AI เลือกสถานที่) */
  question: string;
  /** พื้นที่ (ถ้าไม่ระบุ → เดาจากคำถาม → ทั่วประเทศไทย) */
  area?: string | null;
  /** สไตล์ที่ผู้ใช้เลือก */
  style?: Partial<DiscoveryStyle> | null;
  /** จำนวนการ์ด */
  count?: number;
  /**
   * ดึงรายละเอียดเพิ่มจาก Google (เว็บไซต์/เวลาเปิด) — เปิดเมื่อต้องการลิงก์ "เพจ"
   * ปิดไว้ได้ถ้าไม่ต้องการเว็บไซต์ (ประหยัดค่า Google)
   */
  withDetails?: boolean;
  /**
   * ใช้ gate ชื่อแบบเข้มงวด (ค่าเริ่มต้น) — ชื่อที่ Google ไม่มีจริงจะถูกทิ้ง
   * ปิด = เอาผลค้นอันแรกที่ยังไม่ปิดถาวร (โหมดเดิมของ `/trips/suggest-places`)
   */
  strictNameMatch?: boolean;
  /**
   * ข้อเสนอสำรองกรณี AI ไม่คืนชื่อ — ใช้คำค้นกว้างกับ Google
   */
  fallbackProposals?: Array<{ name: string; description: string }>;
}

export interface FindPlacesResult {
  places: DiscoveryPlace[];
  style: DiscoveryStyle;
  area: string | null;
}

/**
 * หาสถานที่ตามสไตล์ที่ผู้ใช้เลือก (ยังไม่เขียนคำตอบในแชท)
 * -------------------------------------------------------------
 * 1) AI เสนอชื่อ → 2) ตรวจกับ Google (ทิ้งชื่อที่ไม่มีจริง)
 * → 3) ดึงรายละเอียดจริง (รูป/เว็บไซต์/ดาว)
 */
export async function findPlacesForStyle(args: FindPlacesArgs): Promise<FindPlacesResult> {
  const question = (args.question ?? "").trim();
  const count = Math.max(1, Math.min(args.count ?? 6, 8));
  const style = normalizeStyle(args.style ?? {}) ?? FALLBACK_STYLES[0];
  const area = (args.area ?? "").trim() || detectProvinceInText(question) || null;

  // 1) AI เสนอชื่อสถานที่
  const aiProposals = await proposePlaceNames({ question, area, style, count });
  const proposals =
    aiProposals.length > 0 ? aiProposals : (args.fallbackProposals ?? []);

  // 2) ตรวจชื่อกับ Google
  const strict = args.strictNameMatch !== false;
  let verified = await verifyAgainstGoogle(proposals, area, strict);

  // เจอน้อยเกินไป → ค้น Google ตรง ๆ ด้วยคำค้นของสไตล์ (กันการ์ดว่าง)
  if (verified.length < 2) {
    try {
      const query = `${style.query} ${area ?? "ประเทศไทย"}`.trim();
      const raw = await searchWithCache(query);
      const fallback = raw
        .filter((c) => c.businessStatus !== "CLOSED_PERMANENTLY")
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      for (const candidate of fallback) {
        if (verified.length >= count) break;
        const key = candidate.placeId || candidate.name;
        if (!key) continue;
        if (verified.some((v) => (v.candidate.placeId || v.candidate.name) === key)) continue;
        verified.push({ candidate, description: "" });
      }
    } catch (err: any) {
      console.warn("[discovery] ค้นสำรองไม่สำเร็จ:", err?.message);
    }
  }

  verified = verified.slice(0, count);

  // 3) ดึงรายละเอียดจริง (เว็บไซต์/รูป/เวลาเปิด) — ขนานกัน
  const detailed = await Promise.all(
    verified.map(async (item) => {
      if (!args.withDetails) return item;
      const details = await detailsWithCache(item.candidate.placeId);
      return { ...item, candidate: mergeDetails(item.candidate, details) };
    }),
  );

  const places: DiscoveryPlace[] = detailed.map((item) => {
    const c = item.candidate;
    return {
      placeId: c.placeId,
      name: c.name || "ไม่ทราบชื่อ",
      description:
        item.description ||
        (categoryOf(c)
          ? `${categoryOf(c)}ที่แนะนำ${area ? `ใน${area}` : ""}`
          : `สถานที่ท่องเที่ยวที่แนะนำ${area ? `ใน${area}` : ""}`),
      address: c.address ?? null,
      area: c.province ?? area ?? null,
      district: c.district ?? null,
      subdistrict: c.subdistrict ?? null,
      category: categoryOf(c),
      photoUrl: c.photoUrl ?? null,
      rating: c.rating ?? null,
      userRatingsTotal: c.userRatingCount ?? null,
      website: c.website ?? null,
      googleMapsUrl: mapsUrlFor(c),
      lat: c.latitude ?? null,
      lng: c.longitude ?? null,
      openingHours: c.openingHours ?? null,
      priceLevel: c.priceLevel ?? null,
      types: c.types ?? [],
    };
  });

  return { places, style, area };
}

/**
 * หาสถานที่ + ให้เอไaiเขียนคำตอบตามบริบทคำถาม
 * -------------------------------------------------------------
 * ใช้ในแชท: คำตอบข้อความ + การ์ดสถานที่เรียงลงมา
 */
export async function discoverPlaces(args: FindPlacesArgs): Promise<DiscoveryResult> {
  const question = (args.question ?? "").trim();
  const found = await findPlacesForStyle({ ...args, withDetails: true });
  const reply = await writeReply({
    question,
    area: found.area,
    style: found.style,
    places: found.places,
  });
  return {
    reply,
    places: found.places,
    style: found.style,
    area: found.area,
  };
}

/** ให้เอไaiเขียนคำตอบตามบริบทคำถาม โดยยึดรายการที่ยืนยันกับ Google แล้ว */
async function writeReply(args: {
  question: string;
  area: string | null;
  style: DiscoveryStyle;
  places: DiscoveryPlace[];
}): Promise<string> {
  const fallback =
    args.places.length > 0
      ? `ได้เลยค่ะ นี่คือสถานที่สไตล์${args.style.label}` +
        (args.area ? `ใน${args.area}` : "") +
        ` ที่หาเจอจาก Google Maps ทั้งหมด ${args.places.length} แห่ง ` +
        `ติ๊กที่อยากไปได้เลยค่ะ`
      : "ขอโทษค่ะ ตอนนี้ยังหาสถานที่ที่ตรงกับสไตล์นี้ไม่เจอใน Google Maps " +
        "ลองเปลี่ยนสไตล์หรือพื้นที่ดูอีกครั้งนะคะ";

  if (!isAiConfigured() || args.places.length === 0) return fallback;

  try {
    const system =
      buildChatSystemPrompt() +
      buildRecommendedPlacesBlock(
        args.places.map((p) => ({
          name: p.name,
          description: p.description || null,
          address: p.address,
          category: p.category,
          rating: p.rating,
          userRatingsTotal: p.userRatingsTotal,
        })),
      );

    const aiReply = await callAi({
      system,
      messages: [
        {
          role: "user",
          content:
            `คำถามของผู้ใช้: "${args.question}"\n` +
            `สไตล์ที่ผู้ใช้เลือก: ${args.style.label}\n` +
            `พื้นที่: ${args.area ?? "ไม่ระบุ — ทั่วประเทศไทย"}\n\n` +
            "ตอบผู้ใช้สั้น ๆ ตามคำถาม และบอกว่าด้านล่างมีการ์ดสถานที่ให้ติ๊กเลือก",
        },
      ],
      maxTokens: 700,
    });

    // โมเดลอาจแถมบรรทัด TRIP_DRAFT มา (ไม่ควรเกิด) → ตัดออกก่อนส่งให้แอป
    const parsed = parseTripDraftLine(aiReply);
    const clean = parsed.reply.trim();
    return clean || fallback;
  } catch (err: any) {
    console.warn("[discovery] เขียนคำตอบไม่สำเร็จ:", err?.message);
    return fallback;
  }
}
