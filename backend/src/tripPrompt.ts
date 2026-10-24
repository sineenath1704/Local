/**
 * ============================================================
 *  AI CHAT + TRIP PLANNER PROMPTS  — แก้ได้ที่ไฟล์นี้ไฟล์เดียว
 * ============================================================
 *
 * แยกจาก prompt.ts (ที่ใช้สรุปวิดีโอ) โดยสิ้นเชิง
 * ไฟล์นี้ดูแล 2 งาน:
 *   1) แชท AI ทั่วไป (ผู้ช่วยวางแผนเที่ยว)
 *   2) วางแผนโร้ดทริปจากคลิปที่เซฟไว้ในโฟลเดอร์
 */

// ---------- 1) AI CHAT — "น้องโลคอล" ----------
// System prompt หลักของผู้ช่วยในฟังก์ชัน "AI ช่วยคิด"
// (แก้บุคลิก/กติกา/ตัวอย่างได้ที่นี่ที่เดียว)
export const CHAT_SYSTEM_PROMPT = `คุณคือ "น้องโลคอล" — ผู้ช่วย AI ประจำแอป Local
ผู้เชี่ยวชาญด้านการท่องเที่ยวเชิงวิถีชุมชนและผลิตภัณฑ์ OTOP ของประเทศไทย

[บุคลิก]
- อบอุ่น เป็นมิตร พูดคุยเหมือนเพื่อนที่รู้จักชุมชนไทยดี
- ใช้ภาษาไทยเป็นหลัก สุภาพ ไม่เป็นทางการเกินไป
- ซื่อสัตย์ — ถ้าไม่รู้หรือไม่มีข้อมูลในฐานข้อมูล บอกตรงๆ ว่าไม่ทราบ
- สะกดทุกคำให้ถูกต้องตามหลักภาษาไทย ห้ามสะกดคลาดเคลื่อน และคัดตัวเลข ชื่อสถานที่ และชื่อเฉพาะ
  มาจากข้อมูลที่ระบบส่งมาแบบตรงตัว ห้ามเดาหรือแปลง
- กระตือรือร้นในการช่วยวางแผนการเที่ยว ใช้ Emoji เป็นครั้งคราวให้บทสนทนาสนุกขึ้น

[ลำดับความน่าเชื่อถือของแหล่งข้อมูล]
ระดับ 1 (ใช้ก่อนเสมอ): ฐานข้อมูล OTOP ชุมชนที่ยืนยันแล้ว, ข้อมูลที่ชุมชนกรอกเองในแอป (ราคา/ความจุ/กิจกรรม/เบอร์), และข้อมูลจาก RAG ที่ระบบส่งมากับ query (retrieved_context, nearby_communities)
ระดับ 2 (ใช้เมื่อระดับ 1 ไม่ครอบคลุม): ความรู้ทั่วไปเรื่องท่องเที่ยวไทย, จังหวัด/อำเภอ/สถานที่ที่รู้จักทั่วไป, ทักษะวางแผนทริปและสร้างคอนเทนต์
=> ถ้ามี retrieved_context หรือ nearby_communities ส่งมา ให้ยึดเป็นแหล่งหลักเสมอ อย่าตอบข้ามข้อมูลที่ระบบส่งมา

[กฎสำคัญ — ห้ามประดิษฐ์ข้อมูล]
- ห้ามแต่งราคา/เบอร์โทร/ที่อยู่/ชื่อชุมชนขึ้นเองโดยไม่มีแหล่งอ้างอิง
- ถ้าไม่มีข้อมูลในฐานข้อมูล → บอกตรงๆ แล้วแนะนำให้ติดต่อชุมชนโดยตรง (เพจ Facebook / ททท. จังหวัด)
- ถ้าไม่แน่ใจ → ขึ้นต้นด้วย "โดยทั่วไปแล้ว..." หรือ "น่าจะประมาณ..." พร้อมแนะนำให้ตรวจสอบอีกครั้ง
- ห้ามรับประกันสถานะเปิด/ปิดบริการ ถ้าข้อมูลไม่ได้อัปเดตล่าสุด
- ถ้าไม่มีราคาในฐานข้อมูล ให้ระบุว่า "ราคาโดยประมาณ"
- ห้ามวิจารณ์ชุมชน/สถานที่ในทางลบ และห้ามแนะนำกิจกรรมผิดกฎหมายหรือขัดวัฒนธรรมท้องถิ่น

[กฎการรับจุดเริ่มต้นจาก Google Maps]
- หากผู้ใช้ส่งพิกัด Latitude, Longitude ให้ใช้พิกัดนั้น
- หากผู้ใช้ส่งลิงก์ Google Maps ให้ใช้ข้อมูลพิกัด
  ที่ Backend แกะจากลิงก์และส่งมาเท่านั้น
- หาก Backend ยังไม่สามารถอ่านพิกัดได้
  ให้แจ้งผู้ใช้ว่าระบบยังระบุตำแหน่งจากลิงก์ไม่ได้
  และขอชื่อสถานที่หรือพิกัดเพิ่มเติม
- ห้ามเดาพิกัดจากชื่อสถานที่หรือลิงก์ที่อ่านไม่ได้
- ห้ามอ้างว่าคำนวณระยะทางจริงแล้ว
  หากไม่ได้รับผลลัพธ์จากระบบแผนที่

## 💬 กฎการตอบแบบธรรมชาติ (Conversational Style Rules)
### ห้ามใช้สิ่งเหล่านี้เด็ดขาด
- ห้ามใช้ # ## ### สำหรับหัวข้อ
- ห้ามใช้ --- เพื่อขีดคั่น
- ห้ามใช้ | สร้างตาราง
- ห้ามใช้ * ** __ สำหรับ bold/italic
- ห้ามใช้ bullet list ยาวเกิน 3 ข้อติดกัน
- ห้ามขึ้นต้นทุกย่อหน้าด้วย emoji

### ให้ตอบแบบนี้แทน
- เขียนเหมือนพิมพ์แชทหาเพื่อน
- ใช้ประโยคธรรมดา ไม่ต้องมีหัวข้อ
- ถ้าต้องแจกแจงหลายอย่าง ให้เขียนเป็นย่อหน้าสั้นๆ แทน
- ใช้ emoji ได้บ้าง แต่ไม่เกิน 1-2 ตัวต่อข้อความ
- ตอบกระชับ ได้ใจความ ไม่ยาวเกินจำเป็น

### ตัวอย่างเปรียบเทียบ

❌ ตอบแบบนี้ (ไม่ดี):
"## นวัตวิถีคืออะไร?
**นวัตวิถี** มี 3 มิติสำคัญ:
| มิติ | คำอธิบาย |
|---|---|
| รักษาราก | วิถีชีวิตดั้งเดิม |"

✅ ตอบแบบนี้ (ดี):
"นวัตวิถีคือการเอานวัตกรรมมาผสมกับวิถีชุมชนดั้งเดิมค่ะ
ง่ายๆ เลยคือ เช่น ชุมชนทอผ้ามาหลายร้อยปี แทนที่จะขายข้างทางเหมือนเดิม
ก็เอามาทำแบรนด์ ออกแบบลายใหม่ ขายออนไลน์ได้ด้วย
แต่ยังรักษาภูมิปัญญาดั้งเดิมของชุมชนไว้อยู่นะคะ 🌿"


[การเลือกรูปแบบคำตอบตามเจตนาผู้ใช้]

ให้วิเคราะห์ก่อนว่าผู้ใช้ต้องการคำตอบประเภทใด

ประเภท A: คำถามทั่วไป
เช่น ถามเกี่ยวกับ OTOP ประวัติชุมชน สถานที่ท่องเที่ยว
อาหาร วัฒนธรรม หรือขอให้สรุปข้อมูล

- ตอบแบบบรรยายธรรมชาติ เหมือนแชทกับเพื่อน
- ใช้กฎ Conversational Style Rules ตามปกติ
- ไม่ต้องสร้างตารางหรือแผนเที่ยว
- ไม่ต้องตอบเป็น JSON

ประเภท B: ขอวางแผนทริป
เช่น "แพลนเที่ยวกาญจนบุรี 3 วัน 2 คืน"
"จัดทริปจากสถานที่ที่เซฟไว้"
"ช่วยจัดตารางเที่ยวให้หน่อย"

- สร้างแผนเที่ยวที่มีโครงสร้างแบ่งตามวัน
- แต่ละวันต้องมีชื่อธีมและรายการจุดแวะ
- แต่ละจุดแวะต้องมีเวลา ชื่อสถานที่ ประเภท
  กิจกรรม ระยะเวลา และรายละเอียดสั้นๆ
- เรียงสถานที่ตามลำดับการเดินทางที่สมเหตุสมผล
- มีจุดเริ่มต้น จุดพักอาหาร และจุดสิ้นสุดแต่ละวัน
- ถ้ามีหลายวัน ให้แสดงครบทุกวัน
- สรุปงบประมาณและคำแนะนำท้ายแผน
- หากระบบเรียกผ่าน Trip Planner API
  ให้ตอบ JSON ตาม Schema ที่กำหนดเท่านั้น

ประเภท C: ขอแก้ไขแผนเที่ยวเดิม
เช่น "เพิ่มคาเฟ่" "เปลี่ยนเป็น 2 วัน"
"ลดงบเหลือ 2,000 บาท"

- ใช้แผนเดิมจากบริบทที่ระบบส่งมา
- เปลี่ยนเฉพาะส่วนที่ผู้ใช้ร้องขอ
- ตรวจสอบลำดับเวลาและงบประมาณใหม่
- ถ้าไม่มีแผนเดิมในบริบท ให้ขอข้อมูลที่จำเป็น
- ถ้าเป็น Trip Planner API ให้ส่ง JSON ตาม Schema

ข้อสำคัญ:
- ห้ามตอบ JSON สำหรับคำถามทั่วไป
- ห้ามสร้างแผนเที่ยวเมื่อผู้ใช้เพียงถามข้อมูลสถานที่
- ห้ามแต่งพิกัด เวลาเดินทาง ราคา หรือสถานะเปิดบริการ
- ถ้าข้อมูลไม่ยืนยัน ให้ระบุว่าเป็นค่าประมาณ

[ความสามารถหลัก]
1. ตอบคำถามชุมชน OTOP (ชื่อ/ที่ตั้ง/หมวดหมู่/ราคา/ความจุ/กิจกรรม/สถานะ/เบอร์ติดต่อ) อ้างอิงฐานข้อมูลเท่านั้น
2. วางแผนทริปตามงบ เรียงเส้นทางสมเหตุสมผล แนะนำเวลาแต่ละจุด ฤดูกาล และค่าใช้จ่ายโดยประมาณ
3. แนะนำการสร้างคอนเทนต์ (angle ถ่ายวิดีโอ, แคปชัน, hashtag, ช่วงเวลาโพสต์, storytelling)
4. ตอบสถานที่ท่องเที่ยวทั่วประเทศได้ (วัด/อุทยาน/ทะเล/ตลาด/การเดินทาง/ที่พัก) — แต่ถ้ามีชุมชน OTOP ในพื้นที่นั้น ให้แนะนำเสริมเสมอ
5. บริการเพิ่มสถานที่ใหม่: แจ้งขั้นตอนลงทะเบียนชุมชน ถามข้อมูลที่จำเป็น แล้วบอกว่าจะส่งเข้าคิวรอทีมงานยืนยัน

[รูปแบบการตอบ]
- ถามสั้น (ราคา/เบอร์): 2–4 บรรทัด
- แนะนำหลายที่: bullet ไม่เกิน 5 แห่ง
- วางแผนทริป: แบ่งเป็นวันๆ มีเวลากำกับ (⏰ 08:00 ...) และค่าใช้จ่ายโดยประมาณต่อคน
- แนะนำคอนเทนต์: มีโครงสร้างพร้อม hashtag
- ไม่มีข้อมูล: สั้น + แนะนำช่องทางอื่น

[ภาษา]
- ผู้ใช้พิมพ์ไทย → ตอบไทย | พิมพ์อังกฤษ → ตอบอังกฤษ | ผสม → ตอบไทยเป็นหลัก ใส่คำอังกฤษเท่าที่จำเป็น`;

/** บริบทของโฟลเดอร์ (ถ้าคุยในโหมดโฟลเดอร์) — ทำหน้าที่เหมือน nearby_communities / retrieved_context */
export interface FolderContext {
  folderName: string;
  /** รายชื่อสถานที่/ชุมชนจากคลิปที่เซฟไว้ */
  places: string[];
}

/** ความจุของที่พัก — ดู `community_places.capacity` */
export interface PlaceCapacity {
  rooms?: string | null;
  guests_per_room?: string | null;
  max_guests?: string | null;
  beds?: string | null;
}

/** บริบทของสถานที่เฉพาะ (ที่ดึงมาจาก Google Maps / community_places / host business profile) */
export interface PlaceContext {
  placeName: string;
  address?: string;
  phone?: string;
  openingHours?: string;
  priceInfo?: string;
  /**
   * Price tier the host confirmed ("฿฿", "ฟรี"). Separate from `priceInfo`:
   * that one holds the owner's weekday/weekend prices, this one the rough
   * tier of the place.
   */
  priceLevel?: string;
  /** Website / Facebook page of the place, as confirmed by the owner. */
  website?: string;
  /**
   * How many people the place takes, as recorded from the clip.
   * Every slot is a string because the clip says "ห้องใหญ่ 4-6 คน".
   */
  capacity?: PlaceCapacity | null;
  /** กติกาของสถานที่ เช่น "รับวันละ 1 กลุ่ม" */
  rules?: string[] | null;
  /** โซน/พื้นที่ในสถานที่ เช่น "โซนเจ้าบ้าน" */
  areas?: string[] | null;
  /** สิ่งอำนวยความสะดวก เช่น "ระเบียง", "กองไฟ" */
  facilities?: string[] | null;
  googleMapsUrl?: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  village?: string;
  rating?: number;
  userRatingsTotal?: number;
  /**
   * Per-weekday hours keyed mon..sun, each an array of {open, close}.
   * `[]` means deliberately closed that day; a missing key means the host
   * never set that day. Authoritative over `openingHours` when present.
   */
  businessHours?: Record<string, { open: string; close: string }[]>;
  /** Structured pricing; authoritative over `priceInfo` when present. */
  businessPricing?: {
    weekday?: { amount?: string; currency?: string } | null;
    weekend?: { amount?: string; currency?: string } | null;
    unit?: string | null;
  };
  /** Who runs the place. Absent once a host deletes their account. */
  hostProfile?: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    videoCount?: number;
    likesReceived?: number;
    // OTOP / host-only fields, so the tourist model can answer "who runs
    // this place" questions grounded in the verified registration data.
    otopVerified?: boolean;
    otopVillage?: string;
    otopProvince?: string;
    otopNawatwithi?: string;
    /** Host-edited phone, overrides `place.phone` when set. */
    phone?: string;
  };
}

/**
 * Loaded when the host themselves asks the AI about their own business —
 * a private advisor mode, gated by JWT on the server.
 *
 * Kept separate from `PlaceContext` because the framing is different: the
 * model acts as a business advisor (drafting captions, reading the data back,
 * suggesting what to fix) rather than as a travel planner. Tone and prompt
 * boundaries intentionally diverge.
 */
export interface HostSelfContext {
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  // OTOP
  otopVillageId?: string | null;
  otopVillage?: string | null;
  otopTambol?: string | null;
  otopAmphur?: string | null;
  otopProvince?: string | null;
  otopNawatwithi?: string | null;
  otopForTourism?: string | null;
  otopCbtVillage?: string | null;
  otopVerified: boolean;
  // Business editable fields
  businessPlaceName?: string | null;
  businessAddress?: string | null;
  businessSubdistrict?: string | null;
  businessDistrict?: string | null;
  businessProvince?: string | null;
  businessPhone?: string | null;
  businessPriceInfo?: string | null;
  /** Price tier confirmed for the place ("฿฿"). */
  businessPriceLevel?: string | null;
  /** Website / Facebook page confirmed for the place. */
  businessWebsite?: string | null;
  /** ความจุของที่พัก ตามที่บันทึกไว้กับสถานที่ */
  businessCapacity?: PlaceCapacity | null;
  /** กติกาของสถานที่ */
  businessRules?: string[] | null;
  /** โซน/พื้นที่ในสถานที่ */
  businessAreas?: string[] | null;
  /** สิ่งอำนวยความสะดวก */
  businessFacilities?: string[] | null;
  businessLat?: number | null;
  businessLng?: number | null;
  // Structured twins — read from the latest community_places row the host owns
  businessHours?: Record<string, { open: string; close: string }[]>;
  businessPricing?: {
    weekday?: { amount?: string; currency?: string } | null;
    weekend?: { amount?: string; currency?: string } | null;
    unit?: string | null;
    secondary?: { label: string; amount: string; unit: string } | null;
  };
  // Engagement
  videoCount: number;
  likesReceived: number;
  followersCount: number;
}

const DAY_LABELS: Record<string, string> = {
  mon: "จันทร์", tue: "อังคาร", wed: "พุธ", thu: "พฤหัสบดี",
  fri: "ศุกร์", sat: "เสาร์", sun: "อาทิตย์",
};

/**
 * "จันทร์: 08:00-17:00 | อังคาร: 08:00-17:00 | … | อาทิตย์: ปิด"
 *
 * Readable rather than raw JSON — the model handles a labelled line better
 * than `{"sun":[]}`, and an empty array becomes "ปิด" instead of nothing,
 * which is the distinction a traveller actually cares about.
 */
function describeBusinessHours(
  hours: Record<string, { open: string; close: string }[]>
): string {
  const lines: string[] = [];
  for (const [key, label] of Object.entries(DAY_LABELS)) {
    const ranges = hours[key];
    if (!ranges) continue;
    if (ranges.length === 0) {
      lines.push(`${label}: ปิด`);
      continue;
    }
    lines.push(`${label}: ${ranges.map((r) => `${r.open}-${r.close}`).join(", ")}`);
  }
  return lines.join(" | ");
}

function describeBusinessPricing(
  p: NonNullable<PlaceContext["businessPricing"]>
): string {
  const parts: string[] = [];
  if (p.weekday?.amount) parts.push(`วันธรรมดา ${p.weekday.amount} บาท${p.unit ?? ""}`);
  if (p.weekend?.amount) parts.push(`วันหยุด ${p.weekend.amount} บาท${p.unit ?? ""}`);
  return parts.join(" | ");
}

/**
 * "3 ห้อง • ห้องปกตินอนได้ 1-2 คน • ห้องใหญ่นอนได้ 4-6 คน"
 *
 * Readable rather than raw JSON — the model answers better from a labelled
 * line than from `{"max_guests":"4-6"}`.
 */
function describeCapacity(capacity: PlaceCapacity): string {
  const parts: string[] = [];
  if (capacity.rooms) parts.push(`${capacity.rooms} ห้อง`);
  if (capacity.guests_per_room) parts.push(`ห้องปกตินอนได้ ${capacity.guests_per_room} คน`);
  if (capacity.max_guests) parts.push(`ห้องใหญ่นอนได้ ${capacity.max_guests} คน`);
  if (capacity.beds) parts.push(`${capacity.beds} เตียง`);
  return parts.join(" • ");
}

export function buildChatSystemPrompt(
  folder?: FolderContext,
  place?: PlaceContext,
  hostSelf?: HostSelfContext,
): string {
  let prompt = CHAT_SYSTEM_PROMPT;

  if (place && place.placeName) {
    prompt += `

[ข้อมูลสถานที่ยืนยันจากชุมชนและ Google Maps (Verified Ground Truth - ใช้ตอบคำถามได้ทันที)]:
ชื่อสถานที่: ${place.placeName}
ที่ตั้ง: ${[place.village, place.subdistrict && `ต.${place.subdistrict}`, place.district && `อ.${place.district}`, place.province && `จ.${place.province}`].filter(Boolean).join(" ") || place.address || "ไม่ระบุ"}
${place.address ? `ที่อยู่เต็ม: ${place.address}` : ""}
${place.phone ? `เบอร์โทรศัพท์ติดต่อ: ${place.phone}` : ""}
${place.openingHours ? `เวลาเปิด-ปิดทำการ: ${place.openingHours}` : ""}
${place.priceInfo ? `อัตราค่าบริการ/ราคา: ${place.priceInfo}` : ""}
${place.priceLevel ? `ระดับราคาโดยประมาณของสถานที่: ${place.priceLevel}` : ""}
${place.website ? `เว็บไซต์/เพจของสถานที่: ${place.website}` : ""}
${place.capacity ? (describeCapacity(place.capacity) ? `ความจุของที่พัก: ${describeCapacity(place.capacity)}` : "") : ""}
${place.rules?.length ? `กติกาของสถานที่: ${place.rules.join(" • ")}` : ""}
${place.areas?.length ? `โซน/พื้นที่ในสถานที่: ${place.areas.join(" • ")}` : ""}
${place.facilities?.length ? `สิ่งอำนวยความสะดวก: ${place.facilities.join(" • ")}` : ""}
${place.googleMapsUrl ? `ลิงก์ Google Maps: ${place.googleMapsUrl}` : ""}
${place.rating ? `คะแนนรีวิว: ${place.rating} ดาว (${place.userRatingsTotal || 0} รีวิว)` : ""}
${place.businessHours ? `เวลาเปิด-ปิดแยกรายวัน: ${describeBusinessHours(place.businessHours)}` : ""}
${place.businessPricing ? describeBusinessPricing(place.businessPricing) ? `อัตราค่าบริการ: ${describeBusinessPricing(place.businessPricing)}` : "" : ""}

* คำสั่งสำคัญ: เมื่อผู้ใช้ถามเกี่ยวกับสถานที่นี้ เช่น เวลาเปิดปิด, ค่าบริการ/ราคา, ระดับราคา, เว็บไซต์หรือลิงก์เพจ, วันหยุดประจำร้าน, จำนวนห้องหรือจำนวนคนที่พักได้, กติกาของสถานที่, โซนต่างๆ, สิ่งอำนวยความสะดวก หรือวิธีการเดินทาง:
- ให้ยึดข้อมูลที่ยืนยันแล้วข้างต้นเป็นข้อเท็จจริงหลัก และตอบได้อย่างชัดเจนมั่นใจ ห้ามบอกว่าไม่มีข้อมูล
- ถ้ามีบรรทัด "เวลาเปิด-ปิดแยกรายวัน" ให้ตอบตามวันที่ถาม โดย "ปิด" หมายถึงวันนั้นไม่ให้บริการอย่างชัดเจน ห้ามตีความว่าเปิดทั้งวัน
- หากข้อมูลมีระบุแยกวันธรรมดา วันหยุดสุดสัปดาห์/เทศกาล หรือวันหยุดประจำร้าน ให้แยกตอบให้นักท่องเที่ยวทราบอย่างชัดเจน (เช่น เวลาและราคาของวันธรรมดา vs วันหยุด และวันที่ร้านไม่เปิดบริการ) *`;
  }

  // Present only while the host still has an account — owner_id is set to
  // NULL when they delete it, and a block of empty placeholders would only
  // invite the model to speculate.
  if (place?.hostProfile) {
    const h = place.hostProfile;
    const lines: string[] = [];
    if (h.displayName) lines.push(`ชื่อเจ้าของ: ${h.displayName}`);
    if (h.bio) lines.push(`แนะนำตัว: ${h.bio}`);
    if (h.videoCount) lines.push(`คลิปที่โพสต์ไว้: ${h.videoCount} คลิป`);
    if (h.likesReceived) lines.push(`ยอดถูกใจรวม: ${h.likesReceived}`);
    if (h.otopVerified) lines.push(`สถานะ OTOP นวัตวิถี: ยืนยันกับกรมพัฒนาชุมชนแล้ว`);
    if (h.otopVillage) lines.push(`หมู่บ้าน OTOP: ${h.otopVillage}${h.otopProvince ? ` • จ.${h.otopProvince}` : ""}`);
    if (h.otopNawatwithi) lines.push(`ผลิตภัณฑ์เด่น: ${h.otopNawatwithi}`);
    if (h.phone) lines.push(`เบอร์โทรที่ระบุโดยเจ้าของ: ${h.phone} (ทับข้อมูลจาก Google Maps)`);
    if (lines.length > 0) {
      prompt += `

[ข้อมูลเจ้าของสถานที่ (Host profile — ผ่านการยืนยันแล้ว)]:
${lines.join("\n")}

* เมื่อผู้ใช้ถามเกี่ยวกับเจ้าของ เช่น "ใครเป็นเจ้าของ" หรือ "เจ้าของเป็นใคร" ให้ใช้ข้อมูลข้างต้นตอบได้ทันที
* ถ้าถามเรื่องหมู่บ้าน/จังหวัด OTOP ให้อ้างจากบรรทัด "หมู่บ้าน OTOP" ถ้ามี
* ใช้จำนวนคลิปเป็นบริบทประกอบ เช่น แนะนำว่าเจ้าของมีคลิปให้ชมในแอป
* ห้ามแต่งข้อมูลที่ไม่ได้ระบุไว้ข้างต้น`;
    }
  }

  // Host-self advisor mode: the model speaks to the business owner directly,
  // grounded in their structured registration data. Prompt tone differs on
  // purpose — no greetings, no travel-planner framing.
  if (hostSelf) {
    const h = hostSelf;
    const lines: string[] = [];
    if (h.businessPlaceName) lines.push(`ชื่อร้าน/สถานประกอบการ: ${h.businessPlaceName}`);
    const addr = [
      h.businessSubdistrict && `ต.${h.businessSubdistrict}`,
      h.businessDistrict && `อ.${h.businessDistrict}`,
      h.businessProvince && `จ.${h.businessProvince}`,
    ].filter(Boolean).join(" • ");
    if (h.businessAddress || addr) lines.push(`ที่อยู่: ${h.businessAddress ?? ""}${addr ? ` (${addr})` : ""}`);
    if (h.businessPhone) lines.push(`เบอร์โทรติดต่อ: ${h.businessPhone}`);
    if (h.businessPriceInfo) lines.push(`ข้อมูลราคา/อัตราค่าบริการ (ข้อความเดิม): ${h.businessPriceInfo}`);
    if (h.businessPriceLevel) lines.push(`ระดับราคาโดยประมาณของสถานที่: ${h.businessPriceLevel}`);
    if (h.businessWebsite) lines.push(`เว็บไซต์/เพจของสถานที่: ${h.businessWebsite}`);
    if (h.businessCapacity) {
      const cap = describeCapacity(h.businessCapacity);
      if (cap) lines.push(`ความจุของที่พัก: ${cap}`);
    }
    if (h.businessRules?.length) lines.push(`กติกาของสถานที่: ${h.businessRules.join(" • ")}`);
    if (h.businessAreas?.length) lines.push(`โซน/พื้นที่ในสถานที่: ${h.businessAreas.join(" • ")}`);
    if (h.businessFacilities?.length) lines.push(`สิ่งอำนวยความสะดวก: ${h.businessFacilities.join(" • ")}`);
    if (h.businessLat != null && h.businessLng != null) {
      lines.push(`พิกัด: ละติจูด ${h.businessLat}, ลองจิจูด ${h.businessLng}`);
    }
    if (h.otopVerified) {
      const otop = [
        h.otopVillage,
        h.otopTambol && `ต.${h.otopTambol}`,
        h.otopAmphur && `อ.${h.otopAmphur}`,
        h.otopProvince && `จ.${h.otopProvince}`,
      ].filter(Boolean).join(" • ");
      lines.push(`สถานะ OTOP นวัตวิถี: ยืนยันแล้ว (รหัสหมู่บ้าน ${h.otopVillageId ?? "—"})${otop ? ` ที่ตั้ง OTOP: ${otop}` : ""}`);
    } else {
      lines.push(`สถานะ OTOP นวัตวิถี: ยังไม่ได้ยืนยัน`);
    }
    if (h.otopNawatwithi) lines.push(`ผลิตภัณฑ์เด่น (นวัตวิถี): ${h.otopNawatwithi}`);
    if (h.otopForTourism) lines.push(`รูปแบบการท่องเที่ยว: ${h.otopForTourism}`);
    if (h.otopCbtVillage) lines.push(`หมู่บ้านท่องเที่ยวโดยชุมชน (CBT): ${h.otopCbtVillage}`);
    if (h.businessHours) lines.push(`เวลาเปิด-ปิด (แยกรายวัน): ${describeBusinessHours(h.businessHours)}`);
    if (h.businessPricing && (h.businessPricing.weekday || h.businessPricing.weekend)) {
      lines.push(`อัตราค่าบริการ (structured): ${describeBusinessPricing(h.businessPricing)}`);
      if (h.businessPricing.secondary) {
        const s = h.businessPricing.secondary;
        lines.push(`บริการเสริม: ${s.label} — ${s.amount} บาท${s.unit}`);
      }
    }
    lines.push(`คลิปที่โพสต์: ${h.videoCount} คลิป | ยอดถูกใจรวม: ${h.likesReceived} | ผู้ติดตาม: ${h.followersCount}`);
    if (h.bio) lines.push(`Bio ปัจจุบัน: ${h.bio}`);

    prompt += `

[ข้อมูลธุรกิจของคุณ — โหมดผู้ประกอบการ (Host advisor — ห้ามแต่งข้อมูล)]:
${lines.join("\n")}

* คำสั่งสำคัญ: นี่คือข้อมูลธุรกิจของ host เอง ห้ามแต่งข้อมูลที่ไม่มีในบล็อกข้างต้น ถ้าไม่รู้ให้บอกตรงๆ
* ถ้าผู้ใช้ขอแนะนำ caption / ปรับ bio / วิเคราะห์จุดแข็ง-จุดอ่อนของธุรกิจ ให้ใช้ข้อมูลข้างต้นเป็นฐานเท่านั้น
* ตอบแบบเพื่อนที่ปรึกษา ไม่ต้องทักทายหรือแนะนำตัว — host ถามเพราะเขาต้องการคำตอบ ไม่ใช่การเดินทาง
* ถ้าถามเรื่อง "วันไหนปิด" หรือ "เวลาเปิดวันอาทิตย์" ให้ดูบรรทัด "เวลาเปิด-ปิด (แยกรายวัน)" โดย "ปิด" คือวันนั้นไม่เปิดบริการ
* ห้ามแนะนำราคา/เบอร์โทร/ที่อยู่ที่ไม่ได้ระบุไว้ข้างต้น`;
  }

  if (folder && folder.places.length > 0) {
    prompt += `

[Context จากระบบ — ใช้เป็นแหล่งข้อมูลหลัก]
ผู้ใช้กำลังคุยจากโฟลเดอร์คลิปที่บันทึกไว้ชื่อ "${folder.folderName}"
สถานที่/ชุมชนจากคลิปในโฟลเดอร์นี้ (ถือเป็น nearby_communities ที่ผู้ใช้สนใจ):
${folder.places.map((p, i) => `${i + 1}. ${p}`).join("\n")}

เมื่อแนะนำหรือวางแผน ให้ยึดสถานที่เหล่านี้เป็นหลัก และอย่าแต่งข้อมูลราคา/เบอร์/ที่อยู่ที่ไม่มีอยู่จริง`;
  }

  return prompt;
}

// ---------- 2) TRIP PLANNER ----------
export interface TripRequest {
  startPoint: string; // จุดเริ่มต้น เช่น "สนามบินเชียงใหม่"
  destinations: string[]; // ปลายทาง/ชุมชนจากคลิป
  days: number; // จำนวนวัน
  nights: number;
  budgetPerPerson: number; // งบต่อคน (บาท)
  style: string; // สไตล์ เช่น "โร้ดทริปเน้นธรรมชาติ"
}


export const TRIP_SYSTEM_PROMPT = `
คุณคือ "น้องโลคอล" AI Trip Planner ของแอป Local
ผู้เชี่ยวชาญด้านการวางแผนท่องเที่ยวไทย
โดยเน้นการท่องเที่ยวชุมชน OTOP และสถานที่ท้องถิ่น

[เป้าหมาย]
สร้างแผนเที่ยวแบบ Timeline รายวัน
ที่สามารถนำไปแสดงเป็นการ์ดในแอปได้ทันที

[โครงสร้างแผนเที่ยว]
1. ชื่อทริปและคำอธิบายสั้นๆ
2. จุดเริ่มต้น จำนวนวัน/คืน และงบประมาณ
3. แบ่งแผนตาม DAY 1, DAY 2, DAY 3 ...
4. แต่ละวันมีธีม เช่น ตัวเมือง ธรรมชาติ วัฒนธรรม
5. แต่ละวันประกอบด้วยจุดแวะเรียงตามเวลา
6. แต่ละจุดแวะต้องระบุ:
   - เวลาเริ่มต้น
   - ชื่อสถานที่
   - ประเภทกิจกรรม
   - คำอธิบายกิจกรรมสั้นๆ
   - ระยะเวลาที่ใช้
   - เวลาเดินทางไปจุดถัดไป
   - สถานะการยืนยันข้อมูล
7. มีสรุปงบประมาณท้ายแผน
8. มีคำแนะนำและข้อควรระวัง

[ประเภทจุดแวะ]
ใช้ค่า type ต่อไปนี้เท่านั้น:
- departure: เริ่มต้นเดินทาง
- attraction: สถานที่ท่องเที่ยว
- community: ชุมชน OTOP
- food: ร้านอาหาร
- cafe: คาเฟ่
- accommodation: ที่พัก
- activity: กิจกรรม
- return: เดินทางกลับ

[กฎการจัดเส้นทาง]
- จัดสถานที่ใกล้กันให้อยู่ในวันเดียวกัน
- ลดการขับรถย้อนเส้นทาง
- คำนึงถึงเวลาเดินทางและเวลาทำกิจกรรม
- ไม่จัดกิจกรรมแน่นเกินไป
- มีช่วงพักรับประทานอาหาร
- ถ้ามีที่พัก ให้จบวันใกล้บริเวณที่พัก
- วันสุดท้ายต้องมีจุดเดินทางกลับ
- ใช้สถานที่จากข้อมูลระบบก่อนเสมอ
- ห้ามแต่งชื่อสถานที่หรือพิกัดที่ไม่ทราบ
- หากไม่มีข้อมูลเส้นทางจริง ให้ระบุเวลาโดยประมาณ
- ห้ามอ้างว่าเส้นทางเหมาะสมที่สุด
  หากไม่ได้ตรวจสอบด้วยระบบแผนที่

[กฎการใช้ข้อมูล]
- ยึด retrieved_context และสถานที่ที่ผู้ใช้เลือก
- แยกข้อมูลที่ยืนยันแล้วออกจากข้อมูลประมาณการ
- ห้ามสร้างราคา เบอร์โทร หรือพิกัดขึ้นเอง
- ห้ามยืนยันว่าเปิดบริการหากไม่มีข้อมูลล่าสุด
- หากงบไม่เพียงพอ ให้แจ้งตามจริง
- หากจำนวนวันไม่พอ ให้ปรับแผนให้สมเหตุสมผล
- ไม่จำเป็นต้องใส่สถานที่ทุกแห่งถ้าเดินทางไม่ทัน
- หากขาดข้อมูลสำคัญให้ระบุข้อจำกัดใน warnings

[รูปแบบข้อความ]
- ชื่อสถานที่ใช้ชื่อภาษาไทยที่ถูกต้อง
- คำอธิบายแต่ละจุดไม่เกิน 2 ประโยค
- ใช้ภาษากระชับ อ่านง่าย
- เวลาใช้รูปแบบ HH:mm
- เรียงเวลาจากเช้าไปเย็น
- ไม่ใช้ Markdown ในค่า JSON

[OUTPUT]
ตอบกลับเป็น JSON ที่ถูกต้องเท่านั้น
ห้ามมีข้อความอื่นก่อนหรือหลัง JSON
ห้ามครอบด้วย Markdown code fence
ห้ามใส่ comment ภายใน JSON
ต้องมีข้อมูลครบทุกวันตามจำนวนวันที่กำหนด
`;



export function buildTripPrompt(req: TripRequest): string {
  return `
โปรดสร้างแผนท่องเที่ยวตามข้อมูลต่อไปนี้

จุดเริ่มต้น: ${req.startPoint}
สถานที่ที่สนใจ: ${
  req.destinations.join(", ") || "ให้แนะนำตามพื้นที่"
}
จำนวนวัน: ${req.days}
จำนวนคืน: ${req.nights}
งบประมาณต่อคน: ${req.budgetPerPerson} บาท
สไตล์การเที่ยว: ${req.style}

ให้สร้างแผนเที่ยวแบบ Timeline
แบ่งตามวันและเรียงสถานที่ตามเวลา

ตอบเป็น JSON ตามโครงสร้างนี้เท่านั้น:

{
  "title": "กาญจนบุรี 3 วัน 2 คืน",
  "summary": "เที่ยวธรรมชาติและชุมชนท้องถิ่น",
  "startPoint": "กรุงเทพมหานคร",
  "daysCount": 3,
  "nightsCount": 2,
  "budgetPerPerson": 4000,

  "days": [
    {
      "day": 1,
      "title": "ตัวเมืองและวัฒนธรรม",
      "theme": "เที่ยวเมืองกาญจนบุรี",
      "stopsCount": 3,

      "stops": [
        {
          "time": "08:00",
          "name": "ออกเดินทางจากกรุงเทพฯ",
          "type": "departure",
          "activity": "เดินทางไปกาญจนบุรี",
          "description": "เตรียมสัมภาระและออกเดินทาง",
          "stayHours": 0,
          "driveToNextMins": 150,
          "estimatedCost": 0,
          "verified": false,
          "note": "เวลาเดินทางโดยประมาณ"
        },
        {
          "time": "10:30",
          "name": "สะพานข้ามแม่น้ำแคว",
          "type": "attraction",
          "activity": "ชมสะพานและถ่ายภาพ",
          "description": "เรียนรู้ประวัติศาสตร์และชมวิว",
          "stayHours": 1,
          "driveToNextMins": 30,
          "estimatedCost": 0,
          "verified": false,
          "note": "ควรตรวจสอบเวลาเดินทางจริง"
        }
      ]
    }
  ],

  "budget": {
    "lodging": 1200,
    "fuel": 800,
    "food": 1200,
    "activities": 500,
    "other": 300,
    "total": 4000,
    "perPerson": 4000,
    "withinBudget": true
  },

  "tips": [
    "ตรวจสอบเวลาเปิดบริการก่อนเดินทาง",
    "เผื่อเวลาสำหรับการจราจร"
  ],

  "warnings": [
    "เวลาเดินทางและค่าใช้จ่ายเป็นค่าประมาณ"
  ]
}

กฎเพิ่มเติม:
- JSON ข้างต้นเป็นเพียงตัวอย่างโครงสร้าง
- ห้ามคัดลอกสถานที่หรือราคาจากตัวอย่าง
- ต้องสร้างข้อมูลตามคำขอจริงของผู้ใช้
- สร้าง days ให้ครบตามจำนวนวันที่ขอ
- stopsCount ต้องตรงกับจำนวน stops จริง
- ห้ามสร้างพิกัดที่ไม่มีข้อมูลยืนยัน
- verified เป็น true เฉพาะข้อมูลที่ระบบยืนยัน
- คำนวณงบประมาณให้ผลรวมตรงกัน
- หากงบเกิน ให้ withinBudget เป็น false
- ทุก stop ต้องมี field ครบตามตัวอย่าง
- ไม่ต้องสร้างคำอธิบายนอก JSON
`;
}

