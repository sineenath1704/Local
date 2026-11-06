/**
 * ============================================================
 *  ค้นข้อมูลท่องเที่ยวจริงจากเว็บ — Gemini + Google Search (Grounding)
 * ============================================================
 *
 * ทำไมต้องมีไฟล์นี้
 * -------------------------------------------------------------
 * เอไaiหลัก (Claude) ตอบจากข้อมูลในระบบ + ความรู้ทั่วไป
 * → ถ้าผู้ใช้ถามเรื่องที่ไม่มีในระบบ (เช่น "บ้านพักใกล้วัดนี้มีไหม")
 *   เอไaiเดิมตอบว่า "ยังไม่มีข้อมูลในระบบ" ซึ่งไม่ตรงกับที่ผู้ใช้ต้องการ
 *
 * ไฟล์นี้จึงเป็น "ผู้ช่วยค้นเว็บ" — ให้ Gemini ค้นเว็บจริง (Google Search)
 * แล้วเอาผลที่ได้ไปประกอบเป็นบล็อกข้อมูลให้เอไaiหลักเขียนคำตอบต่อ
 * → ผู้ใช้ได้คำตอบที่มีข้อมูลจริง + ดูแหล่งที่มาได้
 *
 * API ที่ใช้
 * -------------------------------------------------------------
 * `generateContent` + `tools: [{ google_search: {} }]` (Grounding)
 * → ข้อความตอบอยู่ที่ candidates[0].content.parts[].text
 * → ลิงก์อ้างอิงอยู่ที่ candidates[0].groundingMetadata.groundingChunks[].web
 * (ยังรองรับอยู่ ไม่ต้องย้ายไป Interactions API)
 *
 * ค่าใช้จ่าย
 * -------------------------------------------------------------
 * Google Search คิดเงินต่อคำค้น (โควตาฟรี 5,000 ครั้ง/เดือน แล้วคิดราคา)
 * → จึง "ค้นเมื่อจำเป็นจริง" เท่านั้น (ดู `shouldSearchTravel`)
 * → ปิดได้ทั้งระบบด้วย env `GEMINI_SEARCH=off`
 */

import { config, isGeminiConfigured } from "./config";

/** base เดียวกับที่ใช้ถอดเสียง (`geminiTranscribe.ts`) — เก็บแยกไฟล์เพราะคนละโมดูล */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * หมวดหมู่ที่เอไaiจะติดแท็กให้ผู้ใช้
 * -------------------------------------------------------------
 * คำคงที — ฝั่งแอป (`src/components/ChatTagChips.tsx`) ใช้ชุดเดียวกันนี้
 * ถ้าเพิ่ม/เปลี่ยนที่นี่ ต้องเปลี่ยนที่แอปด้วย
 */
export const TRAVEL_TOPIC_TAGS = [
  "แหล่งท่องเที่ยว",
  "ที่พัก",
  "ร้านอาหาร",
  "คาเฟ่",
  "กิจกรรม",
  "ธรรมชาติ",
  "วัด",
] as const;

export type TravelTopicTag = (typeof TRAVEL_TOPIC_TAGS)[number];

/** แหล่งที่มาของคำตอบ (จาก grounding metadata) */
export interface TravelSource {
  title: string;
  url: string;
}

/** ผลการค้นหา 1 ครั้ง */
export interface TravelSearchResult {
  /** คำตอบที่ Gemini สรุปมาจากผลค้นหา */
  answer: string;
  /** ชื่อสถานที่ที่คำถามพูดถึง (ถ้ามี) */
  placeName: string | null;
  /** หมวดหมู่ที่ Gemini จัดให้ */
  tags: TravelTopicTag[];
  /** ลิงก์ที่มา */
  sources: TravelSource[];
  /** คำค้นที่ใช้จริง (ไว้ log / debug) */
  query: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  เครื่องมือช่วยเลือกแท็ก
// ─────────────────────────────────────────────────────────────────────────

/**
 * ป้ายประเภทสถานที่จาก Google → แท็กหมวดหมู่ของเรา
 * (คีย์คือป้ายใน `placeLookup.ts` → `GOOGLE_TYPE_LABELS`)
 */
const CATEGORY_TO_TAG: Record<string, TravelTopicTag> = {
  "ที่พัก": "ที่พัก",
  "โรงแรม": "ที่พัก",
  "โฮมสเตย์": "ที่พัก",
  "รีสอร์ท": "ที่พัก",
  "ร้านอาหาร": "ร้านอาหาร",
  "อาหาร": "ร้านอาหาร",
  "คาเฟ่": "คาเฟ่",
  "เบเกอรี่": "ร้านอาหาร",
  "บาร์": "ร้านอาหาร",
  "จุดท่องเที่ยว": "แหล่งท่องเที่ยว",
  "จุดท่องเที่ยวท้องถิ่น": "แหล่งท่องเที่ยว",
  "วัด": "วัด",
  "โบสถ์": "วัด",
  "มัสยิด": "วัด",
  "น้ำตก": "ธรรมชาติ",
  "ภูเขา": "ธรรมชาติ",
  "ชายหาด": "ธรรมชาติ",
  "ธรรมชาติ": "ธรรมชาติ",
  "เส้นทางเดินป่า": "กิจกรรม",
  "แคมป์ปิ้ง": "กิจกรรม",
  "อุทยานแห่งชาติ": "ธรรมชาติ",
  "สวนสาธารณะ": "กิจกรรม",
  "พิพิธภัณฑ์": "กิจกรรม",
  "ตลาด": "แหล่งท่องเที่ยว",
};

/** แปลงป้ายประเภทสถานที่ → แท็กหมวดหมู่ (null = ไม่เข้าพวกไหน) */
export function topicTagFromCategory(category?: string | null): TravelTopicTag | null {
  if (!category) return null;
  return CATEGORY_TO_TAG[category.trim()] ?? null;
}

/** กรองค่าที่ Gemini ส่งมาให้เหลือแต่แท็กที่เรารู้จัก */
export function normalizeTopicTags(raw: unknown): TravelTopicTag[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(TRAVEL_TOPIC_TAGS);
  const out: TravelTopicTag[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!allowed.has(v)) continue;
    if (!out.includes(v as TravelTopicTag)) out.push(v as TravelTopicTag);
  }
  return out.slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────
//  เกณฑ์ "ต้องค้นไหม"
// ─────────────────────────────────────────────────────────────────────────

/**
 * คำใบ้ว่าคำถามนี้ถามเรื่อง "รอบข้าง" (ข้อมูลที่ไม่มีในระบบของเรา)
 * -------------------------------------------------------------
 * เช่น "มีที่พักใกล้ๆไหม" "รอบนี้มีอะไรน่าไป" "คาเฟ่ใกล้ที่ไหน"
 * → ถึงสถานที่นั้นจะอยู่ในทะเบียนของเราแล้ว ก็ยังต้องค้นเว็บ
 */
const NEARBY_HINTS = [
  // รอบข้าง
  "ใกล้", "ใกล้เคียง", "ข้างเคียง", "รอบข้าง", "รอบๆ", "รอบ บริเวณ", "ใกล้บริเวณ",
  // ที่พัก
  "ที่พัก", "ที่นอน", "โรงแรม", "โฮมสเตย์", "รีสอร์ท", "ที่หลับนอน", "แนะนำที่พัก",
  // อาหาร
  "คาเฟ่", "ร้านอาหาร", "ร้านของ", "อาหาร", "กิน", "ชิม", "ตลาด", "ของฝาก",
  // กิจกรรม/ท่องเที่ยว
  "กิจกรรม", "ทำอะไร", "เล่น", "น่าไป", "แนะนำ", "ไหนบ้าง", "อะไรบ้าง", "มีอะไร",
  "เที่ยว", "ท่องเที่ยว", "สถานที่ท่องเที่ยว", "จุดต้องถ่ายรูป", "ถ่ายรูป",
  // english
  "near", "nearby", "around", "hotel", "hostel", "stay", "accommodation",
  "restaurant", "cafe", "food", "recommend", "activity", "activities",
  "attraction", "attractions", "where to", "things to do",
];

/** คำถามนี้ต้องค้นเว็บแน่นอนไหม (ถามเรื่องรอบข้าง) */
export function hasNearbyIntent(question: string): boolean {
  const q = (question ?? "").toLowerCase();
  if (!q.trim()) return false;
  return NEARBY_HINTS.some((h) => q.includes(h));
}

/**
 * ต้องค้นเว็บไหม?
 * -------------------------------------------------------------
 * กฎ:
 *   1. ถามเรื่องรอบข้าง (มีที่พักใกล้ๆ / อะไรน่าไป) → ค้นเสมอ
 *   2. มีข้อมูลสถานที่จากระบบของเราแล้ว (ทะเบียน/โฟลเดอร์/ชุมชน) → ไม่ต้องค้น
 *   3. ไม่มีข้อมูลในระบบเลย → ค้น (จะได้ตอบได้ทุกคำถาม)
 *
 * ปิดได้ด้วย env `GEMINI_SEARCH=off` (กลับไปใช้พฤติกรรมเดิมทั้งหมด)
 */
export function shouldSearchTravel(input: {
  question: string;
  /** มีข้อมูลสถานที่จากระบบของเรา (ทะเบียน/โฟลเดอร์/ชุมชน) หรือไม่ */
  hasInAppData: boolean;
}): boolean {
  if (!isGeminiConfigured()) return false;
  if (!config.gemini.searchEnabled) return false;
  const q = (input.question ?? "").trim();
  if (!q) return false;
  if (hasNearbyIntent(q)) return true;
  if (input.hasInAppData) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
//  แคชในหน่วยความจำ (ประหยัดโควตาค้นเว็บ)
// ─────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: TravelSearchResult;
  at: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 100;
const searchCache = new Map<string, CacheEntry>();

function cacheKey(placeName: string | null, question: string): string {
  return `${(placeName ?? "").trim().toLowerCase()}|${question.trim().toLowerCase()}`;
}

/** ล้างแคช (ใช้ตอนทดสอบ) */
export function clearTravelSearchCache(): void {
  searchCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────
//  ตัวเรียก Gemini
// ─────────────────────────────────────────────────────────────────────────

/** prompt ให้ Gemini — สั่งให้ค้นเว็บจริงแล้วสรุปเป็นภาษาไทย */
function buildSearchPrompt(question: string, placeName: string | null, placeAddress: string | null): string {
  const lines = [
    "คุณคือผู้ช่วยค้นข้อมูลท่องเที่ยว — ใช้ Google Search หาข้อมูลจริงจากเว็บ",
    "",
    "คำถามของผู้ใช้: " + question,
  ];
  if (placeName) lines.push("ชื่อสถานที่ที่เกี่ยวข้อง: " + placeName);
  if (placeAddress) lines.push("ที่ตั้ง: " + placeAddress);
  lines.push(
    "",
    "วิธีตอบ:",
    "- ค้นเว็บให้ครบ แล้วสรุปเป็นภาษาไทยสำหรับนักท่องเที่ยว",
    "- ตอบตรงคำถาม ครบ สั้น กระชับ (ไม่เกินประมาณ 600 ตัวอักษร)",
    "- ถ้าถามว่ามีที่พัก/ร้านอาหาร/คาเฟ่/สถานที่น่าไปใกล้ๆ ให้บอกชื่อสถานที่จริงที่พบ",
    "  พร้อมระยะทางโดยประมาณ (ถ้าหาได้) และบอกด้วยว่าอยู่ฝั่งไหน",
    "- ห้ามแต่งชื่อสถานที่ ราคา เบอร์โทร หรือเวลาเปิดที่ไม่พบในผลการค้นหา",
    "- ถ้าค้นแล้วไม่พบข้อมูลที่ยืนยันได้ ให้ตอบว่าไม่พบข้อมูล และอย่าเติมข้อมูลที่ไม่มี",
    "- ถ้าข้อมูลมาจากเว็บไซต์ทั่วไป (ไม่ใช่ร้านค้าของตัวเอง) ให้ระบุว่าเป็นข้อมูลจากการค้นหาเว็บ",
    "",
    'ตอบกลับเป็น JSON ตาม schema ที่กำหนดเท่านั้น: {"answer":"...","placeName":"...","tags":["..."]}',
    "- answer = คำตอบภาษาไทย",
    "- placeName = ชื่อสถานที่หลักที่คำถามพูดถึง (ถ้าไม่มีให้เป็นค่าว่าง)",
    "- tags = หมวดหมู่ที่เหมาะสม จากรายการนี้เท่านั้น: " + TRAVEL_TOPIC_TAGS.join(", ")
  );
  return lines.join("\n");
}

/** schema ที่บังคับให้ Gemini ตอบเป็น JSON */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "คำตอบภาษาไทยจากผลการค้นหาเว็บ",
    },
    placeName: {
      type: "string",
      description: "ชื่อสถานที่หลักที่คำถามพูดถึง (ค่าว่างได้)",
    },
    tags: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["answer", "tags"],
};

/** ดึง JSON ออกจากข้อความ (บางครั้งมี ```json ครอบ) */
function parseJsonLoose(text: string): any | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // ลองหาส่วนที่เป็น JSON จริง ๆ ในกรณีที่มีข้อความนำหน้า
    const first = body.indexOf("{");
    const last = body.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(body.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** ดึงลิงก์อ้างอิงจาก grounding metadata */
function parseSources(candidate: any): TravelSource[] {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const out: TravelSource[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const web = chunk?.web;
    const url = typeof web?.uri === "string" ? web.uri.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: typeof web?.title === "string" && web.title.trim() ? web.title.trim() : url,
      url,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * ยิงคำขอค้นเว็บ 1 ครั้ง
 * -------------------------------------------------------------
 * `mode` ใช้สลับวิธีบังคับรูปแบบคำตอบ เพราะไม่แน่ใจว่าเครื่องมือค้นเว็บ
 * กับ structured output ใช้พร้อมกันได้ทุกเวอร์ชัน:
 *   "schema" → บังคับ JSON พร้อม schema (ข้อมูลตรงที่สุด)
 *   "json"   → บังคับ JSON อย่างเดียว
 *   "text"   → ข้อความธรรมดา (ใช้เมื่อสองแบบแรกถูกปฏิเสธ)
 */
async function requestGroundedSearch(
  prompt: string,
  mode: "schema" | "json" | "text",
  signal: AbortSignal
): Promise<{ ok: boolean; text: string; candidate: any; status?: number }> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: 4096 };
  if (mode === "schema") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = RESPONSE_SCHEMA;
  } else if (mode === "json") {
    generationConfig.responseMimeType = "application/json";
  }

  const res = await fetch(
    `${GEMINI_BASE}/models/${encodeURIComponent(config.gemini.model)}:generateContent`,
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.gemini.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Grounding: ให้ Gemini ไปค้นเว็บจริง
        tools: [{ google_search: {} }],
        generationConfig,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[gemini-search] generateContent ไม่ผ่าน (${mode}):`,
      res.status,
      body.slice(0, 300)
    );
    return { ok: false, text: "", candidate: null, status: res.status };
  }

  const data: any = await res.json();
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  const text: string = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
    : "";
  return { ok: true, text, candidate };
}

/**
 * ค้นข้อมูลท่องเที่ยวจากเว็บ
 * -------------------------------------------------------------
 * คืน `null` เมื่อค้นไม่ได้ (ไม่มี key / โควตาหมด / เน็ตพัง / timeout)
 * → ผู้เรียกต้องถือว่า "ไม่มีข้อมูลจากเว็บ" แล้วถอยไปตอบด้วยข้อมูลในระบบ
 */
export async function searchTravelInfo(input: {
  question: string;
  placeName?: string | null;
  placeAddress?: string | null;
}): Promise<TravelSearchResult | null> {
  if (!isGeminiConfigured()) return null;
  const question = (input.question ?? "").trim();
  if (!question) return null;

  const placeName = input.placeName?.trim() || null;
  const key = cacheKey(placeName, question);

  // แคช: ถามซ้ำใน 15 นาที → ไม่เผาโควตาค้นเว็บซ้ำ
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.gemini.searchTimeoutMs);
  const prompt = buildSearchPrompt(question, placeName, input.placeAddress ?? null);

  try {
    // ลองจากเข้มสุดไปหลวมสุด — request ที่ถูกปฏิเสธ (400) ไม่เผาโควตาค้นเว็บ
    let rawText = "";
    let candidate: any = null;
    let got = false;
    for (const mode of ["schema", "json", "text"] as const) {
      const r = await requestGroundedSearch(prompt, mode, controller.signal);
      if (r.ok && r.text.trim()) {
        rawText = r.text;
        candidate = r.candidate;
        got = true;
        break;
      }
      if (r.ok && !r.text.trim()) {
        // ตอบมาแต่ไม่มีข้อความ (เช่นถูกบล็อกความปลอดภัย) → คงพฤติกรรมเดิม
        console.warn("[gemini-search] Gemini ไม่ได้ส่งข้อความกลับมา");
        return null;
      }
    }
    if (!got) {
      console.warn("[gemini-search] ค้นเว็บไม่สำเร็จทุกรูปแบบ");
      return null;
    }

    const parsed = parseJsonLoose(rawText);
    const answer =
      typeof parsed?.answer === "string" && parsed.answer.trim()
        ? parsed.answer.trim()
        : rawText.trim();
    const result: TravelSearchResult = {
      answer,
      placeName:
        typeof parsed?.placeName === "string" && parsed.placeName.trim()
          ? parsed.placeName.trim()
          : placeName,
      tags: normalizeTopicTags(parsed?.tags),
      sources: parseSources(candidate),
      query: question,
    };

    // แคช (จำกัดจำนวน ไม่ให้บวม)
    if (searchCache.size >= CACHE_MAX) {
      const oldest = searchCache.keys().next();
      if (!oldest.done) searchCache.delete(oldest.value);
    }
    searchCache.set(key, { result, at: Date.now() });

    return result;
  } catch (err: any) {
    console.warn("[gemini-search] ค้นเว็บไม่สำเร็จ:", err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
