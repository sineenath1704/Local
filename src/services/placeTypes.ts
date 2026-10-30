/**
 * ชนิดข้อมูลสถานที่ — บ้านเดียวของแอป
 * -------------------------------------------------------------
 * ย้ายมาจาก `placesService.ts` (PlaceCandidate) และ `placeMatchService.ts`
 * (MatchLevel) เพื่อไม่ให้มีชนิดข้อมูลชื่อซ้ำสองชุดที่ต่างกันแต่ใช้แทนกัน
 *
 * ไฟล์นี้ไม่ import อะไรเลย → ไม่มี import cycle
 */

/**
 * ระดับที่สถานที่อยู่ในชุมชน/ตำบล/อำเภอของ scope ที่ส่งมา
 * ตรงกับ `CommunityMatchLevel` ของ backend
 */
export type MatchLevel = "village" | "subdistrict" | "district";

/**
 * ผู้สมัครสถานที่จาก Google Places — ผู้ใช้ติ๊กยืนยันเองเสมอ
 * ระบบไม่เลือกให้
 */
export interface PlaceCandidate {
  name: string;
  address: string;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  types: string[];
  phone?: string | null;
  openingHours?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  website?: string | null;
  googleMapsUri?: string | null;
  businessStatus?: string | null;
  /** Google's single best-fit type, e.g. "lodging". Authoritative when present. */
  primaryType?: string | null;
  /** Google's own Thai label for that type, e.g. "ที่พัก". */
  primaryTypeDisplayName?: string | null;
  /** 0-4, Google's guess at price band. Context only — never the real price. */
  priceLevel?: number | null;
  /**
   * ระดับที่สถานที่นี้อยู่ในชุมชน/ตำบล/อำเภอของ scope ที่ส่งมา
   * มีเฉพาะตอนที่คำขอมี scope — ไม่มี scope = ยังไม่รู้ว่าอยู่ที่ไหน
   */
  matchLevel?: MatchLevel | null;

  // ── ส่วนที่ AI จัดอันดับเพิ่ม ──
  /**
   * อันดับที่ AI ให้ (1 = ตรงกับคลิปที่สุด)
   * null = ตัวนี้ไม่ได้ผ่านรอบจัดอันดับ → "AI ไม่มีความเห็น" ไม่ใช่ "อันดับสุดท้าย"
   */
  aiRank?: number | null;
  /** คะแนนความตรงกับคลิป 0–1 */
  aiScore?: number | null;
  /** เหตุผลที่ AI ให้ว่าทำไมตัวนี้ตรง */
  aiReason?: string | null;
  /** หลักฐานในคลิปที่ match กับสถานที่นี้ */
  evidenceMatch?: string | null;
}

/** ที่มาของหลักฐานที่ใช้ระบุชื่อสถานที่ */
export type PlaceEvidenceSource =
  | "transcript"
  | "on_screen_text"
  | "visual"
  | "caption"
  | "user_location";

/** หลักฐานหนึ่งชิ้น — คัดมาจากคลิปจริง (backend ตรวจให้แล้ว) */
export interface PlaceEvidence {
  source: PlaceEvidenceSource;
  quote: string;
  note?: string | null;
}

/**
 * การ "อ่านชื่อสถานที่" หนึ่งครั้ง จากแหล่งเดียว
 * -------------------------------------------------------------
 * รอบหาสถานที่อ่านชื่อจาก **สองทาง** แยกกัน: เสียงพูดในคลิป กับ
 * ตัวหนังสือบนจอ (ป้าย/ซับไตเติล) — เพราะคลิปหนึ่งอาจพูดชื่ออย่างเดียว
 * แต่ป้ายบนจอบอกอีกชื่อ (หรือกลับกัน)
 *
 * ถ้าทั้งสองทางได้ชื่อเดียวกัน → คำค้นเดียว
 * ถ้าต่างกัน → ค้นทั้งสองชื่อ แล้วให้ผู้ใช้ติ๊กเองว่าชื่อไหนถูก
 */
export interface PlaceReading {
  /** เสียงพูดในคลิป หรือ ตัวหนังสือบนจอ */
  source: "transcript" | "on_screen_text";
  /** ชื่อสถานที่ที่อ่านได้จากแหล่งนี้ */
  placeName: string;
  /** ข้อความจริงจากแหล่งนั้นที่มีชื่อนี้อยู่ (คัดตรงตัว) */
  quote: string;
  /** คำอธิบายสั้น ๆ */
  note?: string | null;
}

/**
 * ผลของรอบ AI ที่หน้าที่เดียวคือ "หาสถานที่"
 * อยู่ที่ระดับ root ของ summary (พี่น้องกับ `place` ไม่ใช่ข้างใน)
 */
export interface PlaceResolution {
  found: boolean;
  placeName: string | null;
  community: string | null;
  admin: {
    province: string | null;
    district: string | null;
    subdistrict: string | null;
    village: string | null;
  };
  category: string | null;
  /** 0–1 */
  confidence: number;
  reason: string | null;
  evidence: PlaceEvidence[];
  /** ชื่อที่อ่านได้จากแต่ละแหล่ง (เสียงพูด / ตัวหนังสือบนจอ) */
  readings?: PlaceReading[];
  /** คำค้นที่ใช้กับ Google Places */
  queries: string[];
}
