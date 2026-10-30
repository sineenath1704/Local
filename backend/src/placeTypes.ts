/**
 * Shared Google Places types.
 * -------------------------------------------------------------
 * Lives in its own module because BOTH the AI client (which describes the
 * place block we return to the app) and the places router (which fetches
 * these records from Google) need it — putting it in either one would make
 * the other import across a boundary it shouldn't.
 */
/**
 * ประเภทสถานที่ที่ระบบรู้จัก — คำคงที่ชุดเดียวกับที่ prompt สั่งโมเดล
 * -------------------------------------------------------------
 * `prompt.ts` ให้โมเดลเติม `category` มาในชุดคำพวกนี้ (ดูตัวอย่างใน
 * schema ของ prompt และคีย์ใน `PARAGRAPH2_MODULES` ซึ่งใช้เลือกลำดับ
 * เนื้อหาย่อหน้า 2) — ที่นี่คือ "คำเดียวกัน" ในรูปแบบที่โค้ดเอาไป
 * ตรวจได้
 *
 * ทำไมต้องมีคำคงที่: ประเภทที่ไม่รู้จักคือประเภทที่ค้นหาไม่ได้
 * ตัวกรองใน `summarySchema.ts` จะตัดค่าที่ไม่อยู่ในรายการนี้ทิ้ง
 * (แล้วบันทึกไว้ใน log) แทนที่จะเก็บคำที่ไม่มีใครใช้ได้
 *
 * รายการนี้อยู่ตรงนี้ (ไม่ใช่ใน prompt.ts) เพราะเป็น "ข้อมูลของระบบ"
 * ไม่ใช่คำสั่งให้โมเดล — prompt เป็นแค่ผู้บอกโมเดลว่าใช้คำจากชุดไหน
 */
export const PLACE_CATEGORIES = [
  // ที่พัก
  "โฮมสเตย์",
  "ที่พัก",
  "รีสอร์ท",
  "รีสอร์ต",
  "แคมป์",
  "บ้านพัก",
  // อาหาร / กาแฟ
  "ร้านอาหาร",
  "อาหาร",
  "ครัว",
  "คาเฟ่",
  "ร้านกาแฟ",
  "กาแฟ",
  // กิจกรรม / หัตถกรรม
  "Workshop",
  "เวิร์กช็อป",
  "เวิร์คช็อป",
  "กิจกรรม",
  "หัตถกรรม",
  "เรียนรู้",
  // ธรรมชาติ / ท่องเที่ยว
  "ธรรมชาติ",
  "จุดชมวิว",
  "น้ำตก",
  "ภูเขา",
  "เดินป่า",
  "ทะเล",
  "ถ้ำ",
  // ศาสนา
  "วัด",
] as const;

/** ประเภทสถานที่หนึ่งค่า — ได้จากรายการคำคงทีข้างบนเท่านั้น */
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

/**
 * ระดับที่สถานที่หนึ่งจับคู่กับชุมชนได้
 * -------------------------------------------------------------
 * PLAN_PLACE_MATCHING.md §2.2.2 — การกรอง 3 ชั้น
 *   village    = อยู่ตำบลเดียวกัน และชื่อหมู่บ้านปรากฏในที่อยู่
 *   subdistrict = อยู่ตำบลเดียวกัน แต่ยังไม่เจอชื่อหมู่บ้าน
 *   district   = อยู่อำเภอเดียวกัน (หรือ parse ตำบลไม่ได้ → ให้ผู้ใช้ตัดสิน)
 *
 * ค่านี้เป็น "คำเดา" ของระบบ ไม่ใช่การยืนยัน — ผู้ใช้ต้องกดยืนยันเสมอ
 */
export type CommunityMatchLevel = "village" | "subdistrict" | "district";

/**
 * ที่มาของหลักฐานที่ยืนยันชื่อสถานที่
 * -------------------------------------------------------------
 * บอกว่า "ชื่อนี้มาจากร่องไหนของคลิป" — เพื่อให้ตรวจได้ว่าเป็นคำพูดจริง
 * ไม่ใช่ของที่โมเดลแต่งขึ้น และให้ผู้ใช้เห็นว่าชื่อมาจากไหนก่อนติ๊กยืนยัน
 */
export type PlaceEvidenceSource =
  | "transcript"
  | "on_screen_text"
  | "visual"
  | "caption"
  | "user_location";

/**
 * หลักฐานหนึ่งชิ้นที่ยืนยันชื่อสถานที่
 * -------------------------------------------------------------
 * `quote` ต้องเป็นข้อความจริงจากคลิป (คัดตรงตัว) — ฝั่งโค้ดตรวจได้ว่า
 * ข้อความนี้อยู่ใน transcript / ตัวหนังสือบนจอ / แคปชันจริงหรือไม่
 * ถ้าไม่ตรง → หลักฐานนั้นถูกทิ้ง (ดู `resolvePlace` ใน `aiClient.ts`)
 */
export interface PlaceEvidence {
  source: PlaceEvidenceSource;
  /** ข้อความจริงจากคลิปที่มีชื่อสถานที่อยู่ */
  quote: string;
  /** คำอธิบายสั้น ๆ ว่าหลักฐานนี้บอกอะไร */
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
 * ผลการ "หาสถานที่" จากรอบ AI ที่ทำงานหน้าที่เดียว
 * -------------------------------------------------------------
 * แยกจาก `PlaceData` (ผลสรุปทั้งคลิป) เพราะอันนี้คือ "คำตอบเดียว"
 * คือ "คลิปนี้ถ่ายที่ไหน" พร้อมหลักฐานที่ตรวจสอบได้
 *
 * `found = false` = ไม่มีหลักฐานพอจะระบุชื่อ (ไม่ใช่ "ไม่รู้จริง ๆ")
 * → ระบบจะถอยไปใช้วิธีเดิม (ค้นด้วยชื่อที่สรุปได้) แทนที่จะเดา
 */
export interface PlaceResolution {
  /** true = มีชื่อที่มีหลักฐานรองรับพอจะค้นได้ */
  found: boolean;
  /** ชื่อสถานที่เฉพาะ (ชื่อที่ไปค้นบน Google) */
  placeName: string | null;
  /** ชื่อชุมชน/หมู่บ้าน */
  community: string | null;
  /** พื้นที่บริหารที่มีหลักฐานรองรับ */
  admin: {
    province: string | null;
    district: string | null;
    subdistrict: string | null;
    village: string | null;
  };
  /** ประเภทสถานที่ (จาก PLACE_CATEGORIES) */
  category: string | null;
  /** 0–1 ความมั่นใจของโมเดล (ถูกจำกัดช่วงในโค้ด) */
  confidence: number;
  /** เหตุผลสั้น ๆ ว่าชื่อนี้มาจากหลักฐานอะไร */
  reason: string | null;
  /** หลักฐานที่ผ่านการตรวจแล้ว (คัดมาแบบตรงตัว) */
  evidence: PlaceEvidence[];
  /** ชื่อที่อ่านได้จากแต่ละแหล่ง (เสียงพูด / ตัวหนังสือบนจอ) */
  readings: PlaceReading[];
  /** คำค้นที่ควรลองบน Google (1–2 คำ) */
  queries: string[];
}

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
  matchLevel?: CommunityMatchLevel | null;
  /**
   * คะแนนความเข้ากับหลักฐาน 0–1 ที่ AI ให้ (0–1) — ยิ่งสูงยิ่งตรงกับที่พูดในคลิป
   * มีเฉพาะตอนที่รอบจัดอันดับทำงานสำเร็จ
   */
  aiScore?: number | null;
  /** เหตุผลสั้น ๆ ว่าทำไมตัวนี้ถึงตรง (จาก AI) */
  aiReason?: string | null;
  /** ระดับที่ตรงกับหลักฐาน เช่น "ชื่อ+ตำบล" / "ชื่ออย่างเดียว" / "ไม่ตรง" */
  evidenceMatch?: string | null;
  /** อันดับที่ AI ให้ (1 = ตรงที่สุด) — null = ยังไม่ได้จัดอันดับ */
  aiRank?: number | null;
}
