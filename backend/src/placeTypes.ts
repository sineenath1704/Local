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
}
