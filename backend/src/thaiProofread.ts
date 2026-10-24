/**
 * PROOFREAD PASS — แก้การสะกดไทยในสรุปและคำบรรยาย
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ทำไมต้องมี
 * โมเดลที่เขียนคำบรรยายมัก "เขียนใหม่" แทนที่จะ "คัดลอก" ผลลัพธ์จึงสะกดผิด
 * และค่าที่เป็นตัวเลข/ชื่อเฉพาะ (ราคา จำนวนห้อง ชื่อสถานที่) เพี้ยนไปบ้าง
 * งาน "คัดลอกข้อความเดิมแล้วแก้เฉพาะคำที่สะกดผิด" เชื่อถือได้กว่างานเขียนใหม่มาก
 * จึงเพิ่มขั้นนี้เป็นรอบแก้สะกดก่อนเอาข้อมูลไปใช้ต่อ
 *
 * ข้อปลอดภัยทั้งหมดอยู่ฝั่งเรา ไม่ได้ฝากไว้กับคำสั่งของโมเดลอย่างเดียว:
 *   · ตัวเลขต้องเหมือนเดิมทุกหลัก (ข้อมูลที่เพี้ยนจะถูกทิ้งทั้งก้อน)
 *   · ชื่อเฉพาะรับการแก้ได้เฉพาะที่ "ผิดแบบสะกด" ไม่ใช่คนละคำ
 *   · รายการต้องมีจำนวนเท่าเดิม
 *   · คำบรรยายต้องยังเป็น 2 ย่อหน้า และความยาวไม่ห่างเกิน 15%
 * ถ้าผิดเงื่อนไขใดข้อมูลเดิมจะถูกใช้แทนทั้งหมด (ไม่มีอะไรเสียหาย)
 */

import { config, isAiConfigured } from "./config";
import { AiUpstreamError } from "./aiErrors";
import { extractJson, type AiSummaryResult, type PlaceData } from "./aiClient";
import {
  PROOFREAD_SYSTEM_PROMPT,
  buildProofreadSummaryPrompt,
  buildProofreadNarrationPrompt,
} from "./prompt";

// ============================================================
//  ตัวช่วยตรวจค่าที่โมเดลส่งกลับ
// ============================================================

/** เลขไทย (๒) → เลขอารบิก (2) — ต้องเทียบตัวเลขให้เหมือนกันทั้งสองแบบ */
const THAI_DIGITS: Record<string, string> = {
  "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
  "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
};

/** เฉพาะตัวเลข — เอาไว้เทียบว่า "ตัวเลขเปลี่ยนไปหรือเปล่า" */
function digitsOnly(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] ?? d).replace(/\D/g, "");
}

/** ตัวเลขต้องตรงกันทุกหลัก — กันไม่ให้ราคา/จำนวนคนเพี้ยน */
function sameDigits(a: string, b: string): boolean {
  return digitsOnly(a) === digitsOnly(b);
}

/** ระยะแก้ไขแบบ Levenshtein (ใช้ตัดสินว่าผิดแค่ระดับ "สะกดผิด" หรือเปลี่ยนคำ) */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** ค่าที่เป็นข้อความอิสระ (บรรยาย) — รับได้ถ้าตัวเลขไม่เปลี่ยน */
function acceptProse(original: string | null | undefined, corrected: unknown): string | null {
  const c = typeof corrected === "string" ? corrected.trim() : "";
  if (!c) return null;
  const o = typeof original === "string" ? original.trim() : "";
  if (o && !sameDigits(o, c)) return null; // เลขขยับ = ทิ้งทั้งก้อน
  return c;
}

/** ค่าที่เป็นตัวเลข/ข้อเท็จจริง (ราคา ความจุ เบอร์) — รับได้ถ้าตัวเลขตรงกัน */
function acceptFact(original: string | null | undefined, corrected: unknown): string | null {
  const c = typeof corrected === "string" ? corrected.trim() : "";
  if (!c) return null;
  const o = typeof original === "string" ? original.trim() : "";
  if (!o) return null; // ห้ามเดาค่าที่เดิมไม่มี
  if (!sameDigits(o, c)) return null;
  return c;
}

/** ชื่อเฉพาะ — รับการแก้ได้เฉพาะที่ผิดระดับตัวสะกด ไม่ใช่คนละคำ */
function acceptName(original: string | null | undefined, corrected: unknown): string | null {
  const c = typeof corrected === "string" ? corrected.trim() : "";
  if (!c) return null;
  const o = typeof original === "string" ? original.trim() : "";
  if (!o) return null; // ห้ามเดาชื่อที่เดิมไม่มี
  if (c === o) return null;
  if (!sameDigits(o, c)) return null;
  const d = editDistance(o, c);
  const limit = Math.max(2, Math.ceil(o.length * 0.34));
  if (d > limit) return null; // เปลี่ยนคำ ไม่ใช่สะกดผิด
  return c;
}

/** รายการ — ต้องมีจำนวนเท่าเดิม และแต่ละบรรทัดตัวเลขต้องตรง */
function acceptList(original: string[] | undefined, corrected: unknown): string[] | null {
  if (!Array.isArray(corrected)) return null;
  const items = corrected
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  if (!items.length) return null;
  const orig = Array.isArray(original) ? original : [];
  if (orig.length && items.length !== orig.length) return null; // ห้ามตัด/เพิ่มรายการ
  return items.map((item, i) => {
    const o = orig[i];
    return o && !sameDigits(o, item) ? o : item;
  });
}

// ============================================================
//  เรียกโมเดล
// ============================================================

/** ยิงไปหนึ่งรอบ — คืนข้อความดิบ หรือ null เมื่อเรียกไม่ได้/ไม่ได้ตั้งค่า */
async function callModel(userPrompt: string, maxTokens: number): Promise<string | null> {
  if (!isAiConfigured() || !config.ai.proofreadEnabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const res = await fetch(`${config.ai.baseUrl}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ai.authToken,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.ai.proofreadModel || config.ai.model,
        max_tokens: maxTokens,
        // Copy task — keep it as close to the source wording as possible.
        temperature: 0,
        system: PROOFREAD_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AiUpstreamError(res.status, errText);
    }

    const data: any = await res.json();
    const rawText: string = Array.isArray(data?.content)
      ? data.content.map((c: any) => c?.text ?? "").join("\n").trim()
      : typeof data?.content === "string"
      ? data.content.trim()
      : "";
    return rawText || null;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
//  ข้อมูลที่โมเดลแก้กลับมา (ทุกคีย์เป็น string หรือ null / string[])
// ============================================================

export interface ProofreadCorrections {
  summary?: string | null;
  visual_description?: string | null;
  place_name?: string | null;
  community?: string | null;
  atmosphere?: string | null;
  province?: string | null;
  district?: string | null;
  subdistrict?: string | null;
  price_weekday?: string | null;
  price_weekend?: string | null;
  currency?: string | null;
  phone?: string | null;
  facebook?: string | null;
  line?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  capacity_rooms?: string | null;
  capacity_guests_per_room?: string | null;
  capacity_max_guests?: string | null;
  capacity_beds?: string | null;
  rules?: string[];
  areas?: string[];
  facilities?: string[];
  highlights?: string[];
  category?: string[];
  activities?: string[];
  otop_products?: string[];
}

/**
 * ตรวจสะกดข้อมูลสรุปทั้งก้อน (บรรยาย + ข้อมูลเชิงโครงสร้าง)
 * คืน null เมื่อทำไม่ได้ — ผู้เรียกใช้ข้อมูลเดิมต่อ
 */
export async function proofreadSummary(
  summary: AiSummaryResult,
  transcript?: string | null
): Promise<ProofreadCorrections | null> {
  if (!summary.place) return null;
  try {
    const raw = await callModel(
      buildProofreadSummaryPrompt({
        summary: summary.text ?? null,
        visualDescription: summary.visualDescription ?? null,
        place: summary.place,
        transcript,
      }),
      4096
    );
    if (!raw) return null;
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ProofreadCorrections;
  } catch (err) {
    console.warn("[proofread] summary ไม่สำเร็จ — ใช้ข้อมูลเดิม:", (err as any)?.message);
    return null;
  }
}

/**
 * ตรวจสะกดคำบรรยาย — คืนคำบรรยายที่แก้แล้ว หรือ null เมื่อทำไม่ได้/ไม่ผ่านเงื่อนไขกันพลาด
 */
export async function proofreadNarration(
  narration: string,
  facts: Record<string, unknown>,
  transcript?: string | null
): Promise<string | null> {
  if (!narration.trim()) return null;
  try {
    const raw = await callModel(
      buildProofreadNarrationPrompt({ narration, facts, transcript }),
      // The narration is written at maximum detail (paragraph 1 alone can run
      // past 4k tokens) — the copy-edit has to fit the whole thing back out.
      8192
    );
    if (!raw) return null;
    const parsed = extractJson(raw);
    const corrected =
      typeof parsed?.narration === "string" ? String(parsed.narration).trim() : "";
    if (!corrected) return null;

    // กันพลาด: เลขขยับ / ย่อหน้าเพี้ยน / ถูกเขียนใหม่ทั้งย่อหน้า
    if (!sameDigits(narration, corrected)) return null;
    const before = narration.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const after = corrected.split(/\n\s*\n/).filter((p) => p.trim()).length;
    if (before !== after) return null;
    const ratio = corrected.length / Math.max(1, narration.trim().length);
    if (ratio < 0.85 || ratio > 1.15) return null;
    return corrected;
  } catch (err) {
    console.warn("[proofread] narration ไม่สำเร็จ — ใช้ข้อความเดิม:", (err as any)?.message);
    return null;
  }
}

// ============================================================
//  ผสมค่าที่แก้แล้วกลับเข้าสรุป
// ============================================================

/**
 * เอาค่าที่ตรวจแก้แล้วกลับเข้าไปในสรุป โดยผ่าน guard ทุกช่อง
 * ค่าที่ไม่ผ่าน guard จะคงค่าเดิมไว้เสมอ
 */
export function applyProofreadToSummary(
  summary: AiSummaryResult,
  c: ProofreadCorrections
): AiSummaryResult {
  const next: AiSummaryResult = { ...summary };

  const text = acceptProse(summary.text, c.summary);
  if (text) next.text = text;
  const visual = acceptProse(summary.visualDescription ?? null, c.visual_description);
  if (visual) next.visualDescription = visual;

  const place = summary.place;
  if (place) {
    const p: PlaceData = {
      ...place,
      location: { ...(place.location ?? { province: null, district: null }) },
      price_info: { ...(place.price_info ?? { weekday: null, weekend: null }) },
      contact: { ...(place.contact ?? {}) },
      capacity: place.capacity ? { ...place.capacity } : null,
    };

    const name = acceptName(place.place_name, c.place_name);
    if (name) p.place_name = name;
    const community = acceptName(place.community, c.community);
    if (community) p.community = community;
    const atmosphere = acceptProse(place.atmosphere ?? null, c.atmosphere);
    if (atmosphere) p.atmosphere = atmosphere;

    const province = acceptName(p.location.province, c.province);
    if (province) p.location.province = province;
    const district = acceptName(p.location.district, c.district);
    if (district) p.location.district = district;
    const subdistrict = acceptName(p.location.subdistrict, c.subdistrict);
    if (subdistrict) p.location.subdistrict = subdistrict;

    const weekday = acceptFact(place.price_info?.weekday, c.price_weekday);
    if (weekday) p.price_info.weekday = weekday;
    const weekend = acceptFact(place.price_info?.weekend, c.price_weekend);
    if (weekend) p.price_info.weekend = weekend;

    const phone = acceptFact(place.contact?.phone, c.phone);
    if (phone) p.contact.phone = phone;
    const facebook = acceptName(place.contact?.facebook, c.facebook);
    if (facebook) p.contact.facebook = facebook;
    const line = acceptName(place.contact?.line, c.line);
    if (line) p.contact.line = line;
    const website = acceptName(place.contact?.website, c.website);
    if (website) p.contact.website = website;

    const hours = acceptProse(place.opening_hours ?? null, c.opening_hours);
    if (hours) p.opening_hours = hours;

    if (p.capacity) {
      const rooms = acceptFact(p.capacity.rooms, c.capacity_rooms);
      if (rooms) p.capacity.rooms = rooms;
      const perRoom = acceptFact(p.capacity.guests_per_room, c.capacity_guests_per_room);
      if (perRoom) p.capacity.guests_per_room = perRoom;
      const maxGuests = acceptFact(p.capacity.max_guests, c.capacity_max_guests);
      if (maxGuests) p.capacity.max_guests = maxGuests;
      const beds = acceptFact(p.capacity.beds, c.capacity_beds);
      if (beds) p.capacity.beds = beds;
    }

    const rules = acceptList(place.rules, c.rules);
    if (rules) p.rules = rules;
    const areas = acceptList(place.areas, c.areas);
    if (areas) p.areas = areas;
    const facilities = acceptList(place.facilities, c.facilities);
    if (facilities) p.facilities = facilities;
    const highlights = acceptList(place.highlights, c.highlights);
    if (highlights) p.highlights = highlights;
    const category = acceptList(place.category, c.category);
    if (category) p.category = category;
    const activities = acceptList(place.activities, c.activities);
    if (activities) p.activities = activities;
    const otop = acceptList(place.otop_products, c.otop_products);
    if (otop) p.otop_products = otop;

    next.place = p;
    next.highlights = p.highlights;
    next.tags = p.tags;
  }

  return next;
}

/** ข้อเท็จจริงที่คำบรรยายต้องตรงตาม — ใช้เป็นเบาะแสตอนตรวจสะกดคำบรรยาย */
export function narrationFacts(summary: AiSummaryResult): Record<string, unknown> {
  const place: Partial<PlaceData> = summary.place ?? {};
  return {
    place_name: place.place_name ?? null,
    community: place.community ?? null,
    price_info: place.price_info ?? null,
    capacity: place.capacity ?? null,
    rules: place.rules ?? [],
    areas: place.areas ?? [],
    facilities: place.facilities ?? [],
    opening_hours: place.opening_hours ?? null,
  };
}
