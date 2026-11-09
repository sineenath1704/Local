import { HOME_FEED_POSTS } from "./homeFeedData";
import { getVideoById } from "./profilesData";
import type { VideoPost } from "./homeFeedData";

/**
 * AI Planner data layer — types + helpers for folders, trips, and AI chat.
 * -------------------------------------------------------------
 * Trips and chat threads are produced by REAL user actions and held in
 * AiPlannerContext. This file only provides types + lookups that turn a
 * saved video id into displayable info (poster, title, place label).
 */

// ---- Saved video → display info ----
export interface SavedVideoInfo {
  id: string;
  title: string;
  poster: any | null;
  placeLabel: string; // e.g. "บ้านห้วยห้อม จ.แม่ฮ่องสอน"
  province?: string;
}

const POST_BY_ID = new Map(HOME_FEED_POSTS.map((p) => [p.id, p]));

/** Resolve a saved video id (feed post or profile video) to display info. */
export function resolveSavedVideo(videoId: string): SavedVideoInfo {
  const post = POST_BY_ID.get(videoId);
  if (post) {
    return {
      id: videoId,
      title: post.author.name,
      poster: post.poster,
      placeLabel: `${post.location.village} จ.${post.location.province}`,
      province: post.location.province,
    };
  }
  const pv = getVideoById(videoId);
  if (pv) {
    return {
      id: videoId,
      title: pv.title,
      poster: pv.thumbnail,
      placeLabel: pv.title,
    };
  }
  return { id: videoId, title: "คลิปที่บันทึก", poster: null, placeLabel: videoId };
}

/** Build the list of place labels for a set of saved video ids (trip context). */
export function placeLabelsFor(videoIds: string[]): string[] {
  const labels = videoIds.map((id) => resolveSavedVideo(id).placeLabel);
  // de-dupe while preserving order
  return Array.from(new Set(labels));
}

// ---- Chat ----

/**
 * สถานที่ที่ backend หาเจอจาก Google Places แต่ชื่อซ้ำหลายแห่ง
 * → ส่งกลับมาให้ผู้ใช้เลือกก่อนถามต่อ (แตะที่อันใดอันหนึ่ง → ส่ง `placeId` กลับไป)
 *
 * รูปแบบนี้ตรงกับ `PlaceChoice` ที่ backend ส่งมาใน `POST /ai-chat`
 */
export interface PlaceChoice {
  placeId: string;
  name: string;
  address: string | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  community: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  googleMapsUrl: string | null;
}

/**
 * บริบทจากคลิปที่ผู้ใช้กูลับมาแชท (ปุ่ม "คุยต่อกับ AI เรื่องนี้")
 * -------------------------------------------------------------
 * เก็บเฉพาะข้อมูลที่มีผลต่อการตัดสินใจไปเที่ยว (ชื่อสถานที่ · ที่ตั้ง ·
 * ราคา · เวลาเปิด · กติกา · วิธีเดินทางที่พูดในคลิป)
 *
 * ฝั่ง backend แทรกเป็นบล็อกแยกใน system prompt → ให้โมเดลยึดเป็นข้อมูล
 * หลักตอนตอบ แทนที่จะเดาเอาจากชื่อสถานที่อย่างเดียว
 */
export interface ClipContext {
  /** ชื่อสถานที่ที่ปรากฏในคลิป — ใช้ค้นข้อมูล Google Place ให้ตรงแห่ง */
  placeName?: string | null;
  /** ที่อยู่ที่รวบรวมได้จากคลิป */
  address?: string | null;
  /** คำอธิบายสั้น ๆ ว่าที่นี่คืออะไร */
  description?: string | null;
  /** ข้อมูลสำคัญเรียงตามลำดับความสำคัญ (บรรทัดละเรื่อง) */
  details?: string[];
  /** วิธีเดินทางที่พูดไว้ในคลิป (ถ้ามี) */
  directions?: string | null;
  /** ช่องทางติดต่อที่มีในคลิป */
  contact?: {
    phone?: string | null;
    facebook?: string | null;
    line?: string | null;
    website?: string | null;
  };
  /** พิกัด/ลิงก์แผนที่ที่มีในคลิป */
  gps?: string | null;
  /** สรุปแบบเล่าเรื่องจากคลิป (ข้อความเดียว) */
  narration?: string | null;
}

/**
 * แท็กประเภทสถานที่
 * - `otop` = ติดทะเบียน OTOP ของระบบ (เจอใน community_places)
 * - `tourism` = ท่องเที่ยวทั่วไป (ไม่ได้ติดทะเบียน)
 */
export type PlaceTag = "otop" | "tourism";

/** ลิงก์แหล่งที่มาจากการค้นเว็บ (Gemini + Google Search) */
export interface ChatSource {
  title: string;
  url: string;
}

/**
 * โฟลเดอร์ที่ผู้ใช้แนบไปกับข้อความ
 * -------------------------------------------------------------
 * ส่งเป็น "ออบเจกต์" ไม่ใช่ข้อความธรรมดา → ในแชทแสดงเป็นการ์ดโฟลเดอร์
 * ที่กดเข้าไปดูคลิปข้างในได้ และคลิปในโฟลเดอร์เล่นเต็มจอแบบหน้าโฮม
 */
export interface ChatFolderAttachment {
  id: string;
  name: string;
  /** จำนวนคลิปในโฟลเดอร์ตอนแนบ */
  clipCount: number;
}

/**
 * สไตล์การท่องเที่ยวที่ผู้ใช้เลือกก่อนหาสถานที่
 * -------------------------------------------------------------
 * มาจาก `POST /ai-chat/discovery` (ไม่ส่ง style) → เอไaiเสนอตามคำถาม
 * ถ้าเอไaiล้มเหลว แอปจะใช้ชุดสำรอง 6 แบบแทน
 */
export interface DiscoveryStyle {
  /** id สั้น ๆ ใช้เก็บค่าที่ผู้ใช้เลือก */
  id: string;
  /** ชื่อสไตล์ที่แสดงในป๊อปอัป */
  label: string;
  /** อีโมจิประกอบสไตล์ */
  emoji: string;
  /** คำอธิบายสั้น ๆ ว่าสไตล์นี้คืออะไร */
  desc: string;
  /** คำค้นภาษาไทยสำหรับ Google */
  query: string;
}

/**
 * การ์ดสถานที่ 1 แห่ง ในแชท (ประเภท D — "ถามแนะนำสถานที่")
 * -------------------------------------------------------------
 * ข้อมูลทั้งหมดมาจาก Google Places จริง (ชื่อ · รูป · ดาว · พิกัด ·
 * เว็บไซต์) · คำอธิบายสั้น ๆ เขียนโดยเอไai
 */
export interface ChatPlaceCard {
  placeId: string;
  name: string;
  /** คำอธิบายสั้น ๆ ว่าสถานที่นี้คืออะไร */
  description: string;
  address: string | null;
  /** จังหวัดของสถานที่ */
  area: string | null;
  district: string | null;
  subdistrict: string | null;
  /** ประเภทสถานที่ (วัด · คาเฟ่ · จุดท่องเที่ยว ...) */
  category: string | null;
  /** path ของรูปใน backend — แอปต้องแปลงเป็น URL เต็มก่อนโหลด */
  photoUrl: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  /** เว็บไซต์/เพจของสถานที่ (ถ้าไม่มี → ซ่อนปุ่ม) */
  website: string | null;
  /** ลิงก์เปิดใน Google Maps */
  googleMapsUrl: string | null;
  lat: number | null;
  lng: number | null;
  openingHours: string | null;
  /** ระดับราคาจาก Google (0-4) */
  priceLevel: number | null;
  /** ประเภทดิบจาก Google (ใช้กรอง/แสดงผล) */
  types: string[];
  /** id ของแท็กที่สถานที่นี้มา (null = ไม่รู้) */
  styleId: string | null;
  /** ชื่อแท็กที่แสดงบนการ์ด (มาจาก backend) */
  styleLabel: string | null;
  /** อีโมจิของแท็กที่แสดงบนการ์ด */
  styleEmoji: string | null;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  /**
   * This "message" is actually a failure notice, not a reply. Set when the AI
   * call failed, so the bubble can be styled as an error instead of passing
   * the failure text off as something the assistant actually said.
   */
  isError?: boolean;
  /**
   * สถานที่ที่ชื่อซ้ำหลายแห่ง (backend ส่งกลับมา) → ให้ผู้ใช้เลือก
   * มีแค่ตอนที่คำถามแตะสถานที่ที่ยังไม่มีข้อมูลในระบบ และ Google คืนมาหลายแห่ง
   */
  placeCandidates?: PlaceChoice[];
  /**
   * การ์ดสถานที่ที่แนะนำ (ประเภท D — "ถามแนะนำสถานที่")
   * → แสดงเรียงลงมาใต้คำตอบ ผู้ใช้ติ๊กเลือกได้ว่าอยากไปที่ไหน
   */
  placeCards?: ChatPlaceCard[];
  /**
   * สไตล์ที่ผู้ใช้เลือกจากป๊อปอัป (การ์ดสถานที่จะแสดงป้ายสไตล์นี้บนชื่อสถานที่)
   */
  discoveryStyle?: DiscoveryStyle;
  /**
   * แท็กที่ผู้ใช้เลือก (เลือกได้หลายอัน) — ใช้ตอนกด "รีเฟช" เพื่อดึงที่ใหม่ด้วยแท็กเดิม
   */
  discoveryTags?: DiscoveryStyle[];
  /**
   * placeId ทุกใบที่เคยโผล่ในการ์ดของข้อความนี้ (รวมที่ถูกรีเฟชออกไปแล้ว)
   * → ใช้ตัด "ไม่ซ้ำ" ตอนกด "รีเฟช"
   */
  discoverySeen?: string[];
  /**
   * ชื่อสถานที่ที่เคยโผล่ในการ์ดของข้อความนี้ → บอก AI ว่าห้ามเสนอซ้ำ
   */
  discoverySeenNames?: string[];
  /** placeId ที่ผู้ใช้เลือกจาก `placeCandidates` (ส่งกลับไปให้ backend ดึงรายละเอียดของอันนี้) */
  chosenPlaceId?: string;
  /**
   * คลิปที่ผู้ใช้แนบมาพร้อมข้อความ (กรณี "คุยต่อจากคลิป")
   * → แสดงเป็นการ์ดวิดีโอในแชท แตะแล้วเปิดผู้ดูคลิปเต็มจอ (แบบเดียวกับหน้าแรก)
   */
  video?: VideoPost;
  /**
   * สถานะข้อมูลแผนทริปที่ backend สกัดได้จากบทสนทนา
   * → มีเฉพาะตอนที่เอไอกำลังช่วยวางแผนทริปจริง ๆ (ไม่มี = ข้อความธรรมดา)
   */
  tripDraft?: TripDraft;
  /** แผนที่วางแล้ว (ผลจาก POST /trips/plan) → แสดงเป็นการ์ดแผนในแชท */
  plan?: TripPlan;
  /** ข้อมูลเสริมของแพลน (จุดที่ยังไม่ได้ไป · คำเตือน · รหัสแผนที่บันทึกไว้) */
  planMeta?: TripPlanMeta;
  /**
   * แท็กประเภทสถานที่ — backend ตรวจจากทะเบียน OTOP ของระบบ
   * (ตามกฎ: เจอในทะเบียน = OTOP · ไม่เจอ = ท่องเที่ยวทั่วไป)
   */
  placeTag?: PlaceTag;
  /** หมวดหมู่ของสถานที่ (ที่พัก · ร้านอาหาร · คาเฟ่ · แหล่งท่องเที่ยว ...) */
  tags?: string[];
  /**
   * ชื่อสถานที่ที่จะติดแท็ก — backend ส่งมาเฉพาะตอนที่คำตอบเอ่ยชื่อนี้จริง
   * → แอปวางแท็กไว้ "หน้าชื่อ" ในบรรทัดเดียวกับคำตอบ (ไม่ใช่ก้อนใต้ข้อความ)
   */
  tagPlace?: string | null;
  /**
   * แท็กแยกตามแต่ละสถานที่ (ข้อ 5)
   */
  placeTags?: {
    name: string;
    placeTag?: PlaceTag;
    tags?: string[];
  }[];
  /** ลิงก์แหล่งที่มา — มีเมื่อคำตอบนี้มาจากการค้นเว็บ */
  sources?: ChatSource[];
  /**
   * โฟลเดอร์ที่ผู้ใช้แนบมาพร้อมข้อความนี้
   * → แสดงเป็นการ์ดโฟลเดอร์ที่กดเข้าไปดูคลิปข้างในได้ (ไม่ใช่ส่งเป็นข้อความ)
   */
  folder?: ChatFolderAttachment;
  /**
   * ข้อความนี้เป็นที่เกาะของ "การ์ดตั้งค่าแพลน" (TripQuestionFlow โหมด setup)
   * → โผล่หลังผู้ใช้กด "สร้างแพลนทริปจาก N แห่งที่เลือก" เพื่อให้ผู้ใช้กรอกข้อมูลก่อน
   */
  planSetup?: boolean;
  /**
   * สถานที่ที่ผู้ใช้ติ๊กจากการ์ดสถานที่ → เก็บไว้กับข้อความการ์ดตั้งค่า
   * -------------------------------------------------------------
   * · เป็น **แหล่งเดียว** ของรายการที่ติ๊ก (การ์ดตั้งค่าโชว์ชิปจากที่นี่
   *   และปุ่มยืนยันเอาไปสร้างคำขอจากที่นี่ → สองที่อ่านค่าเดียวกัน = ต่างกันไม่ได้)
   * · เก็บ "บนตัวข้อความ" ไม่ใช่ใน state ที่คีย์ด้วย id ข้อความ → ไม่หลุดระหว่างทาง
   */
  planPlaces?: {
    label: string;
    address?: string | null;
    coords: { lat: number; lng: number };
    openingHours?: string | null;
    website?: string | null;
    /** ลิงก์ Google Maps ของสถานที่ (เปิดดูตำแหน่งได้จากกล่องที่เลือก) */
    googleMapsUrl?: string | null;
    /** คะแนนรีวิว (ถ้ามี) */
    rating?: number | null;
  }[];
  /**
   * ข้อความที่ส่งให้ **โมเดล** เห็นเพิ่มเติม แต่ผู้ใช้ไม่เห็นในฟอง
   * -------------------------------------------------------------
   * · ใช้ฝั่งแอปบอกโมเดลเรื่อง "เจตนา" / "บริบทที่ผู้ใช้เลือก" โดยไม่ต้องแตะ prompt ฝั่ง backend
   * · ต่อท้ายเนื้อหาข้อความตอนประกอบประวัติแชท (ดู AiChatScreen)
   */
  aiNote?: string;
  /**
   * การ์ดแพลนอยู่โหมดไหน
   * · "plan"    = แผนที่เส้นทาง + จุดแวะ (เส้นทางเดิม: กดยืนยันแล้วบันทึกเข้าทริปเลย)
   * · "staged"  = แผนที่เส้นทาง + จุดแวะ (flow ใหม่: ผู้ใช้จัดลำดับจุดก่อน → สรุปทีหลัง)
   * · "summary" = สรุปเป็นกล่อง "เวลา — สถานที่" เรียงลงล่าง
   */
  planView?: "plan" | "staged" | "summary";
  /**
   * การ์ดสรุปนี้กลับมาจากข้อความการ์ดแพลนไหน (id ของข้อความ)
   * → ใช้ตอนผู้ใช้กด "แก้ไขแพลน" ในการ์ดสรุป → คืนการ์ดแพลนเดิมกลับมาให้แก้ต่อ
   */
  planFromId?: string;
}

/** ข้อมูลเสริมที่มาคู่กับ `AiChatMessage.plan` */
export interface TripPlanMeta {
  /** จุดในโฟลเดอร์ที่ AI ไม่ได้เลือก → เสนอให้ผู้ใช้กดเพิ่มเอง */
  notSelected?: { id: string; name: string; type: string }[];
  /** คำเตือนจาก AI */
  aiWarnings?: string[];
  /** คำเตือนจาก backend (เช่น โฟลเดอร์ยังไม่มีข้อมูลสถานที่) */
  folderWarning?: string | null;
  /** รหัสแผนในฐานข้อมูล (มีเมื่อกดยืนยันแล้ว) */
  planId?: string | null;
}

export interface AiChatThread {
  id: string;
  title: string;
  /** When set, this thread is scoped to a saved folder. */
  folderId?: string;
  messages: AiChatMessage[];
  createdAt: number;
  /**
   * บริบทจากคลิปที่ผู้ใช้กูลับมา (แชทที่เปิดจากปุ่ม "คุยต่อกับ AI เรื่องนี้")
   * → เก็บไว้กับเธรด เพื่อให้ทุกข้อความในแชทนี้ยึดข้อมูลคลิปเดียวกัน
   */
  clipContext?: ClipContext | null;
  /** คลิปที่แนบมาพร้อมแชทนี้ (ใช้แสดงเป็นวิดีโอในแชท) */
  video?: VideoPost | null;
}

// ---- การวางแผนทริป (ช่องข้อมูล + แผนที่คำนวณแล้ว) ----

/**
 * จุดเริ่มต้น / จุดสิ้นสุดตอนกลับ
 * -------------------------------------------------------------
 * `coords` เป็น null เมื่อผู้ใช้ยังไม่ได้เลือกพิกัด — backend จะไม่ยอมวางแผนถ้ายังไม่มีพิกัด
 */
export interface TripPlanPoint {
  label: string;
  address?: string | null;
  coords?: { lat: number; lng: number } | null;
}

/** กลับจุดเดิม (ไป-กลับ) หรือกลับคนละจุด */
export type TripReturnMode = "same_as_start" | "custom";

export type VehicleKey =
  | "private_car"
  | "diesel_car"
  | "pickup"
  | "van"
  | "motorbike"
  | "ev"
  | "public";

export type FuelTypeKey =
  | "gasohol95"
  | "gasohol91"
  | "gasoholE20"
  | "dieselB20"
  | "diesel"
  | "premiumDiesel"
  | "gsh95"
  | "x99"
  | "gasoline95"
  | "electric";

export const VEHICLE_OPTIONS: { key: VehicleKey; label: string }[] = [
  { key: "private_car", label: "รถยนต์ส่วนตัว" },
  { key: "diesel_car", label: "รถยนต์ดีเซล" },
  { key: "pickup", label: "รถปิคอัพ" },
  { key: "van", label: "รถตู้" },
  { key: "motorbike", label: "มอเตอร์ไซค์" },
  { key: "ev", label: "รถไฟฟ้า" },
  { key: "public", label: "ขนส่งสาธารณะ / รถไฟ / เครื่องบิน" },
];

export const FUEL_TYPE_OPTIONS: { key: FuelTypeKey; label: string }[] = [
  { key: "gasohol95", label: "แก๊สโซฮอล์ 95" },
  { key: "gasohol91", label: "แก๊สโซฮอล์ 91" },
  { key: "gasoholE20", label: "แก๊สโซฮอล์ E20" },
  { key: "dieselB20", label: "ดีเซล B20" },
  { key: "diesel", label: "ดีเซล" },
  { key: "premiumDiesel", label: "พรีเมียมดีเซล" },
  { key: "gsh95", label: "ซูเปอร์ พาวเวอร์ GSH95" },
  { key: "x99", label: "ซูเปอร์ พาวเวอร์ X99" },
  { key: "gasoline95", label: "เบนซิน 95" },
  { key: "electric", label: "ไฟฟ้า" },
];

/**
 * ช่องข้อมูลของแผนทริปที่เอไอสกัดได้จากบทสนทนา
 * -------------------------------------------------------------
 * `null` = "ยังไม่รู้" → ห้ามทับค่าที่ผู้ใช้เคยกรอกไว้ (merge ที่ฝั่ง backend)
 *
 * ช่วงวันที่เก็บเป็น `startDate` + `endDate` (string `"YYYY-MM-DD"` ทั้งคู่)
 * → ไม่ใช้ Date object เพราะข้ามเขตเวลาแล้ววันเพี้ยน (เช่น เลือก 00:00 ของวันถัดไป)
 * ส่วนขาเข้า–ขาออกกับ backend ยังเป็น `date` + `days` → แปลงที่ `slotsToWire` / `slotsFromWire`
 */
export interface TripSlots {
  startPoint?: TripPlanPoint | null;
  returnMode?: TripReturnMode | null;
  endPoint?: TripPlanPoint | null;
  /** วันเริ่มต้นของทริป ("YYYY-MM-DD") */
  startDate?: string | null;
  /** วันสิ้นสุดของทริป ("YYYY-MM-DD") */
  endDate?: string | null;
  startTime?: string | null;
  /**
   * key ของรถ (`private_car` …) หรือชื่อที่แสดง ("รถยนต์ส่วนตัว")
   * → เป็น string ธรรมดา เพราะโมเดลอาจเขียนชื่อมาแทน key
   * (backend จับคู่ให้เอง · ถ้าไม่รู้จักจะใช้รถยนต์ส่วนตัวเป็นค่าเริ่มต้น)
   */
  vehicle?: string | null;
  /**
   * ชื่อ/รุ่นรถที่ผู้ใช้พิมพ์เอง (เช่น "Toyota Corolla Altis")
   * → ให้เอไaiเป็นคนระบุชนิดน้ำมันที่รถคันนี้ใช้จริง
   */
  vehicleModel?: string | null;
  fuelType?: string | null;
  travelers?: number | null;
  budgetPerPerson?: number | null;
  style?: string | null;
  /**
   * จุดสิ้นสุดของแต่ละวัน (หลายวัน) — เก็บไว้ฝั่งแอปเท่านั้น
   * (backend ไม่ได้อยู่ใน TRIP_DRAFT แต่รับ dayEndPoints ตอนเรียก /trips/plan)
   */
  dayEndPoints?: (TripPlanPoint | null)[] | null;
  /**
   * สถานที่ปลายทางที่ผู้ใช้ต้องการไป (เก็บลง data ฝั่งแอป ไม่ต้องผ่าน AI)
   */
  destinations?: TripPlanPoint[] | null;
}

// ---- ช่วงวันที่ (คำนวณจากสตริง ไม่ผ่าน Date.parse ข้ามเขตเวลา) ----

/** ทริปยาวสุดกี่วัน (backend clamp ไว้ที่ 7 วันเหมือนกัน) */
export const TRIP_MAX_DAYS = 7;

/** เดือนแบบย่อ (ม.ค.–ธ.ค.) — ใช้ร่วมกันทั้งการ์ดและปฏิทิน */
export const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** วันในสัปดาห์แบบย่อ (เริ่มที่อาทิตย์ — ตรงกับปฏิทินไทย) */
export const THAI_WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

/** วันนี้ตามเวลาท้องถิ่นของเครื่องผู้ใช้ ("YYYY-MM-DD") */
export function tripTodayIso(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function parseIsoParts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** เลื่อนวันแบบไม่สนเขตเวลา (ใช้ Date.UTC เป็นตัวกลาง) */
export function tripAddDays(iso: string, n: number): string {
  const p = parseIsoParts(iso);
  if (!p) return iso;
  const t = Date.UTC(p.y, p.m - 1, p.d) + n * 86400000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** จำนวนวันระหว่างสองวัน (b − a) — ลบเครื่องหมาย = ย้อนหลัง */
export function tripDiffDays(a: string, b: string): number {
  const pa = parseIsoParts(a);
  const pb = parseIsoParts(b);
  if (!pa || !pb) return 0;
  const ta = Date.UTC(pa.y, pa.m - 1, pa.d);
  const tb = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((tb - ta) / 86400000);
}

/**
 * จำนวนวันของช่วง (รวมวันเริ่มและวันสิ้นสุด) = end − start + 1
 * → null เมื่อช่วงยังไม่ครบหรือสิ้นสุดมาก่อนเริ่ม
 */
export function tripRangeDays(
  start?: string | null,
  end?: string | null
): number | null {
  if (!start || !end) return null;
  const diff = tripDiffDays(start, end);
  if (diff < 0) return null;
  return diff + 1;
}

/** "10 พ.ย. 2569" (ใส่ชื่อวันได้) */
export function formatThaiDate(iso?: string | null, withWeekday = false): string {
  if (!iso) return "";
  const p = parseIsoParts(iso);
  if (!p) return iso;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const dow = THAI_WEEKDAYS[dt.getUTCDay()];
  const core = `${p.d} ${THAI_MONTHS[p.m - 1]} ${p.y + 543}`;
  return withWeekday ? `${dow} ${core}` : core;
}

/** สรุปช่วงวันที่แบบสั้น: "10–12 พ.ย. 2569 · 3 วัน 2 คืน" */
export function formatThaiDateRange(
  start?: string | null,
  end?: string | null,
  opts?: { withDuration?: boolean }
): string {
  if (!start) return "";
  const days = tripRangeDays(start, end);
  if (!end || days == null) return formatThaiDate(start);
  const sp = parseIsoParts(start);
  const ep = parseIsoParts(end);
  const nights = days - 1;
  const span =
    sp && ep && sp.m === ep.m
      ? `${sp.d}–${ep.d} ${THAI_MONTHS[ep.m - 1]} ${ep.y + 543}`
      : `${formatThaiDate(start)} – ${formatThaiDate(end)}`;
  // withDuration: false = ไม่ต่อท้าย "· N วัน M คืน" (กรณีที่มีข้อความอื่นบอกจำนวนวันอยู่แล้ว)
  if (opts?.withDuration === false) return span;
  return `${span} · ${days} วัน${nights > 0 ? ` ${nights} คืน` : " · ไป-กลับ"}`;
}

// ---- ประเภทรถ (3 แบบ) ----

/**
 * รถที่ผู้ใช้เลือกได้มี 3 คลาส
 * -------------------------------------------------------------
 * · private_car — รถยนต์ส่วนตัว (น้ำมัน/ไฟฟ้า ขึ้นกับรุ่นที่ผู้ใช้ระบุ)
 * · ev         — รถไฟฟ้า (คิดค่าไฟ ไม่ใช่ค่าน้ำมัน)
 * · public     — ขนส่งสาธารณะ (ไม่คิดค่าเดินทาง)
 */
export type VehicleClass = "private_car" | "ev" | "public";

export const VEHICLE_CLASS_OPTIONS: { key: VehicleClass; label: string }[] = [
  { key: "private_car", label: "รถยนต์ส่วนตัว" },
  { key: "ev", label: "รถไฟฟ้า" },
  { key: "public", label: "รถสาธารณะ" },
];

/** คำที่บอกว่าเป็น "รถสาธารณะ" (ใช้จับคำที่โมเดลเขียนมา) */
const PUBLIC_VEHICLE_WORDS = [
  "public",
  "transit",
  "bus",
  "train",
  "plane",
  "ferry",
  "รถสาธารณะ",
  "ขนส่งสาธารณะ",
  "รถไฟ",
  "เครื่องบิน",
  "รถเมล์",
  "รถตู้เอก",
  "เรือ",
];

/**
 * จัดค่าที่ได้ (key หรือชื่อรถ) → เป็นคลาสรถ 3 แบบ
 * → null = ยังไม่ได้เลือกรถ
 */
export function vehicleClassOf(v?: string | null): VehicleClass | null {
  if (!v) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const opt = VEHICLE_CLASS_OPTIONS.find(
    (o) => o.key === raw || o.label === raw
  );
  if (opt) return opt.key;
  const hit = VEHICLE_OPTIONS.find((o) => o.key === raw || o.label === raw);
  if (hit) {
    if (hit.key === "public") return "public";
    if (hit.key === "ev") return "ev";
    return "private_car";
  }
  const lower = raw.toLowerCase();
  if (PUBLIC_VEHICLE_WORDS.some((w) => lower.includes(w.toLowerCase()))) {
    return "public";
  }
  return "private_car";
}

/** ป้ายที่อ่านง่ายของรถที่เลือกไว้ (คลาส 2 แบบ) */
export function vehicleClassLabel(v?: string | null): string {
  const cls = vehicleClassOf(v);
  if (!cls) return "";
  return (
    VEHICLE_CLASS_OPTIONS.find((o) => o.key === cls)?.label ?? String(v ?? "")
  );
}

// ---- แปลงรูปแบบขาเข้า/ขาออกกับ backend ----

/**
 * รูปแบบที่ส่งไปหา backend / ที่ backend ส่งกลับมา
 * → backend รู้จักแค่ `date` (วันเริ่ม) + `days` (จำนวนวัน)
 */
export interface TripSlotsWire {
  startPoint?: TripPlanPoint | null;
  returnMode?: TripReturnMode | null;
  endPoint?: TripPlanPoint | null;
  date?: string | null;
  startTime?: string | null;
  days?: number | null;
  vehicle?: string | null;
  vehicleModel?: string | null;
  fuelType?: string | null;
  travelers?: number | null;
  budgetPerPerson?: number | null;
  style?: string | null;
}

/**
 * ทำให้ช่องข้อมูลเป็นรูปแบบของแอปเสมอ
 * -------------------------------------------------------------
 * รองรับทั้งรูปแบบใหม่ (`startDate`/`endDate`) และรูปแบบเก่า (`date`/`days`)
 * ที่ยังค้างอยู่ในแชทเก่า → แปลงให้อัตโนมัติ
 */
export function normalizeTripSlotsShape(
  raw?: TripSlots | TripSlotsWire | null
): TripSlots {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, any>;
  const date = (r.startDate ?? r.date ?? null) as string | null;
  const rawDays = Number(r.days);
  const endDate: string | null =
    (r.endDate as string | null) ??
    (date && Number.isFinite(rawDays) && rawDays > 1
      ? tripAddDays(date, rawDays - 1)
      : date);
  return {
    startPoint: r.startPoint ?? null,
    returnMode: r.returnMode ?? null,
    endPoint: r.endPoint ?? null,
    startDate: date,
    endDate,
    startTime: r.startTime ?? null,
    vehicle: r.vehicle ?? null,
    vehicleModel: r.vehicleModel ?? null,
    fuelType: r.fuelType ?? null,
    travelers: r.travelers ?? null,
    budgetPerPerson: r.budgetPerPerson ?? null,
    style: r.style ?? null,
    dayEndPoints: Array.isArray(r.dayEndPoints) ? r.dayEndPoints : null,
    destinations: Array.isArray(r.destinations) ? r.destinations : null,
  };
}

/** แอป → backend (แปลงช่วงวันที่เป็น `date` + `days`) */
export function slotsToWire(slots: TripSlots): TripSlotsWire {
  const days = tripRangeDays(slots.startDate, slots.endDate);
  return {
    startPoint: slots.startPoint ?? null,
    returnMode: slots.returnMode ?? null,
    endPoint: slots.endPoint ?? null,
    date: slots.startDate ?? null,
    startTime: slots.startTime ?? null,
    days: days == null ? null : Math.min(TRIP_MAX_DAYS, Math.max(1, days)),
    vehicle: slots.vehicle ?? null,
    vehicleModel: slots.vehicleModel ?? null,
    fuelType: slots.fuelType ?? null,
    travelers: slots.travelers ?? null,
    budgetPerPerson: slots.budgetPerPerson ?? null,
    style: slots.style ?? null,
  };
}

/** backend → แอป (แปลง `date` + `days` กลับเป็นช่วงวันที่) */
export function slotsFromWire(wire?: TripSlotsWire | null): TripSlots {
  return normalizeTripSlotsShape(wire);
}

/**
 * ข้อมูลที่ยังขาด — คำนวณแบบ deterministic ฝั่งแอป
 * -------------------------------------------------------------
 * รอบแรก (การ์ดช่องข้อมูล) ขอแค่ 5 อย่าง:
 *   จุดเริ่ม(พร้อมพิกัด) · จุดสิ้นสุดตอนกลับ (เมื่อกลับคนละจุด)
 *   · ช่วงวันที่ที่ถูกต้อง · เวลาออกเดินทาง
 *
 * **ประเภทรถ / ชื่อรุ่นรถ / จำนวนคน / จุดสิ้นสุดรายวัน → ไม่บังคับ**
 *   ย้ายไปถามอีกรอบตอนสรุปค่าใช้จ่าย (หลังจัดการเส้นทางเสร็จ) แทนการบังคับกรอกตอนแรก
 *   → ผู้ใช้ที่ไม่รู้ว่ารถตัวเองเป็นรุ่นอะไร ยังกดส่งข้อมูลได้
 *
 * งบ / สไตล์ → **ไม่บังคับ** (มีค่าเริ่มต้นของระบบ)
 */
export function computeTripMissing(slots: TripSlots): string[] {
  const missing: string[] = [];

  if (!slots.startPoint) {
    missing.push("จุดเริ่มต้น");
  } else if (!slots.startPoint.coords) {
    missing.push("พิกัดจุดเริ่มต้น");
  }

  if (slots.returnMode === "custom") {
    if (!slots.endPoint) {
      missing.push("จุดสิ้นสุดตอนกลับ");
    } else if (!slots.endPoint.coords) {
      missing.push("พิกัดจุดสิ้นสุดตอนกลับ");
    }
  }

  // ช่วงวันที่ — ต้องครบและ "ถูกต้อง" ไม่ใช่แค่มีค่า
  if (!slots.startDate) {
    missing.push("วันเดินทาง");
  } else if (!slots.endDate) {
    missing.push("วันสิ้นสุดของทริป");
  } else {
    const days = tripRangeDays(slots.startDate, slots.endDate);
    if (days == null) {
      missing.push("วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น");
    } else if (days > TRIP_MAX_DAYS) {
      missing.push(`ทริปได้ไม่เกิน ${TRIP_MAX_DAYS} วัน`);
    } else if (slots.startDate < tripTodayIso()) {
      missing.push("วันเดินทางย้อนหลัง");
    }
  }

  if (!slots.startTime) missing.push("เวลาออกเดินทาง");

  return missing;
}

/** ข้อมูลครบพอที่จะกด "สร้างแพลนทริป" หรือยัง */
export function isTripPlanReady(slots: TripSlots): boolean {
  return computeTripMissing(slots).length === 0;
}

// ── flow "ถามทีละคำถาม" ────────────────────────────────────────────────

/**
 * คำถามที่แอปถามทีละข้อ (ข้อ 2.3)
 * -------------------------------------------------------------
 * ผู้ใช้ตอบได้ทั้งแบบ "พิมพ์" และแบบ "เลือกตัวเลือก"
 * → ลำดับนี้ต้องตรงกับที่ backend คิด "ขาดอะไร" (computeTripMissing)
 */
export type TripQuestionKey =
  | "startPoint"
  | "startPointCoords"
  | "returnMode"
  | "endPoint"
  | "endPointCoords"
  | "startDate"
  | "endDate"
  | "startTime";

/**
 * รายการคำถามที่ "ต้องถาม" ตามคำตอบที่ผู้ใช้ให้มาตอนนี้
 * -------------------------------------------------------------
 * · จุดเริ่มต้นยังไม่มี → ถามชื่อก่อน (ยังไม่ถามพิกัด)
 * · เลือก "กลับคนละจุด" → เพิ่มคำถามจุดสิ้นสุด
 * · จุดที่มีแล้วแต่ยังไม่มีพิกัด → ถามหาพิกัดต่อ
 */
export function tripQuestionList(slots: TripSlots): TripQuestionKey[] {
  const list: TripQuestionKey[] = ["startPoint"];
  if (slots.startPoint && !slots.startPoint.coords) list.push("startPointCoords");
  list.push("returnMode");
  if (slots.returnMode === "custom") {
    list.push("endPoint");
    if (slots.endPoint && !slots.endPoint.coords) list.push("endPointCoords");
  }
  list.push("startDate", "endDate", "startTime");
  return list;
}

/** คำถามนี้ตอบไปแล้วหรือยัง */
export function isQuestionAnswered(key: TripQuestionKey, slots: TripSlots): boolean {
  switch (key) {
    case "startPoint":
      return !!slots.startPoint?.label;
    case "startPointCoords":
      return !!slots.startPoint?.coords;
    case "returnMode":
      return slots.returnMode === "same_as_start" || slots.returnMode === "custom";
    case "endPoint":
      return !!slots.endPoint?.label;
    case "endPointCoords":
      return !!slots.endPoint?.coords;
    case "startDate":
      return !!slots.startDate && slots.startDate >= tripTodayIso();
    case "endDate": {
      if (!slots.endDate) return false;
      const days = tripRangeDays(slots.startDate, slots.endDate);
      return days != null && days <= TRIP_MAX_DAYS;
    }
    case "startTime":
      return !!slots.startTime;
  }
}

/**
 * คำถามถัดไปที่ต้องถาม (null = ข้อมูลครบ พร้อมสรุปและสร้างแพลน)
 * → คำนวณแบบ deterministic ฝั่งแอป (ไม่ให้โมเดลตัดสิน)
 */
export function nextTripQuestion(slots: TripSlots): TripQuestionKey | null {
  for (const key of tripQuestionList(slots)) {
    if (!isQuestionAnswered(key, slots)) return key;
  }
  return null;
}

/** สถานะแผนทริปที่ backend ส่งกลับมา (ข้อมูลที่ได้แล้ว · ที่ยังขาด · พร้อมวางแผนไหม) */
export interface TripDraft {
  slots: TripSlots;
  missing: string[];
  planReady: boolean;
}

// ── แผนที่ backend คำนวณแล้ว (POST /trips/plan) ────────────────────────────

export interface TripPlanOpenHours {
  status: "open" | "closed" | "unknown";
  openFrom?: string;
  openTo?: string;
  confidence?: string;
  note?: string;
}

export interface TripPlanStop {
  id: string;
  name: string;
  type: string;
  activity?: string;
  description?: string;
  coordinates: { lat: number; lng: number };
  arriveTime?: string;
  leaveTime?: string;
  stayHours?: number;
  openHours?: TripPlanOpenHours | null;
  distanceFromPrevKm?: number | null;
  driveToNextMins?: number | null;
  booking?: { phone?: string | null; website?: string | null; note?: string | null } | null;
  estimatedCost?: number | null;
  note?: string | null;
  dataSource?: string;
  verified?: boolean;
  issues?: string[];
}

export interface TripPlanLeg {
  fromIndex: number;
  toIndex: number;
  km: number;
  minutes: number;
  source: string;
  geometry: { lat: number; lng: number }[];
}

export interface TripPlanDay {
  day: number;
  date: string;
  title?: string;
  theme?: string;
  startPoint: TripPlanPoint;
  endPoint: TripPlanPoint;
  endPointType: "return" | "lodging";
  stops: TripPlanStop[];
  legs: TripPlanLeg[];
  totalKm: number;
  totalDriveMinutes: number;
  fuelCost: number;
  warnings: string[];
}

export interface TripPlanLodging {
  name: string;
  address?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  price?: number | null;
  priceUnit?: string | null;
  priceText?: string | null;
  distanceKm?: number | null;
  phone?: string | null;
  website?: string | null;
  rating?: number | null;
  source?: string;
}

export interface TripPlanVehicle {
  key: string;
  label: string;
  /** ชื่อ/รุ่นรถที่ผู้ใช้กรอก (ถ้ามี) — ใช้ระบุชนิดน้ำมัน */
  model?: string | null;
  kmPerLitre: number | null;
  fuelType: string | null;
  fuelPricePerLitre: number | null;
  fuelPriceSource: string;
  fuelPriceEffectiveDate?: string;
  fuelPriceFetchedAt?: string;
  fuelPriceIsEstimate: boolean;
  fuelPriceText?: string;
}

export interface TripPlan {
  title: string;
  summary: string;
  startPoint: TripPlanPoint;
  endPoint: TripPlanPoint;
  returnMode: TripReturnMode;
  days: TripPlanDay[];
  lodgingSuggestions: TripPlanLodging[];
  budget: {
    fuel: number;
    lodging: number;
    food: number;
    activities: number;
    other: number;
    total: number;
    perPerson: number;
    groupTotal: number;
    withinBudget: boolean;
  };
  warnings: string[];
  assumptions: string[];
  tips: string[];
  routeSource: string;
  routeCredit: string;
  /** เวลาเริ่มต้นของวันแรก — ใช้คำนวณแผนใหม่ได้ตรง ๆ */
  startTime?: string;
  /** จำนวนผู้เดินทาง */
  travelers?: number;
  /** งบต่อคนที่ผู้ใช้ระบุ */
  budgetPerPerson?: number;
  /** สไตล์ทริป */
  style?: string;
  fuel?: {
    fuelType?: string | null;
    pricePerLitre?: number | null;
    kmPerLitre?: number | null;
    source?: string | null;
    effectiveDate?: string | null;
    fetchedAt?: string | null;
    isEstimate?: boolean;
    text?: string | null;
  };
  vehicle?: TripPlanVehicle;
  aiUsed?: boolean;
  droppedStops?: { name: string; day: number; reason: string }[];
}

// ── สรุปแผนทั้งหมดกลับให้ผู้ใช้ (ข้อ 2.3) ───────────────────────────────

/** จัดตัวเลขให้มีจุลภาค (ไม่พึ่ง Intl — Hermes บางเวอร์ชันไม่ครบ) */
function formatBaht(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * สรุปแพลนทั้งหมดเป็นข้อความสั้น ๆ ให้ผู้ใช้อ่านในแชท
 * -------------------------------------------------------------
 * การ์ดแพลนดูรายละเอียด (แผนที่ ต้นทุน จุดแวะ) แต่แชทควรมี "ภาพรวม"
 * ของทั้งทริปอยู่บ้าง ไม่งั้นผู้ใช้ต้องเลื่อนการ์ดขึ้นไปดูเอง
 */
export function formatPlanSummary(plan: TripPlan): string {
  const days = plan.days ?? [];
  const lines: string[] = [];

  const title = plan.title?.trim() || "แผนทริป";
  lines.push(`📋 สรุปแผนทริป — ${title}`);

  // ── เส้นทางรวม ────────────────────────────────────────────────
  const startLabel = plan.startPoint?.label ?? "จุดเริ่มต้น";
  const endLabel =
    plan.returnMode === "custom" && plan.endPoint?.label
      ? plan.endPoint.label
      : "จุดเดิม";
  lines.push(
    `📍 ${startLabel} → ${endLabel} · ${days.length || 1} วัน` +
      (plan.startTime ? ` · ออกเดินทาง ${plan.startTime}` : "")
  );

  // ── รถ / คน / งบ ─────────────────────────────────────────────
  const vehicleText = plan.vehicle
    ? `${plan.vehicle.label}${plan.vehicle.model ? ` (${plan.vehicle.model})` : ""}`
    : "ไม่ระบุ";
  const travelers = plan.travelers ?? 1;
  const budgetPer = plan.budgetPerPerson ?? plan.budget?.perPerson ?? 0;
  lines.push(
    `🚗 รถ: ${vehicleText} · ผู้เดินทาง ${travelers} คน` +
      (budgetPer ? ` · งบ ${formatBaht(budgetPer)} บาท/คน` : "")
  );

  // ── ค่าใช้จ่าย ───────────────────────────────────────────────
  const budget = plan.budget;
  if (budget) {
    const parts: string[] = [];
    if (budget.lodging) parts.push(`ที่พัก ${formatBaht(budget.lodging)}`);
    if (budget.fuel) parts.push(`น้ำมัน/ค่าไฟ ${formatBaht(budget.fuel)}`);
    if (budget.food) parts.push(`อาหาร ${formatBaht(budget.food)}`);
    if (budget.activities) parts.push(`กิจกรรม ${formatBaht(budget.activities)}`);
    lines.push(
      `💰 รวม ${formatBaht(budget.total)} บาท (คนละ ${formatBaht(
        budget.perPerson
      )} บาท)` + (parts.length ? ` · ${parts.join(" · ")}` : "")
    );
  }

  // ── รายวัน ───────────────────────────────────────────────────
  for (const day of days) {
    lines.push("");
    lines.push(
      `วันที่ ${day.day} · ${formatThaiDate(day.date)}` +
        (day.title ? ` — ${day.title}` : "")
    );
    const stops = day.stops ?? [];
    if (stops.length === 0) {
      lines.push("  (ไม่มีจุดแวะในวันนี้)");
      continue;
    }
    for (const stop of stops) {
      const time = stop.arriveTime ? `${stop.arriveTime} ` : "";
      const bits: string[] = [];
      if (stop.activity) bits.push(stop.activity);
      if (stop.stayHours) bits.push(`อยู่ ${stop.stayHours} ชม.`);
      if (stop.distanceFromPrevKm != null && stop.distanceFromPrevKm > 0) {
        bits.push(
          `เดินทาง ${stop.distanceFromPrevKm.toFixed(1)} กม.` +
            (stop.driveToNextMins != null ? ` (${Math.round(stop.driveToNextMins)} นาที)` : "")
        );
      }
      if (stop.estimatedCost) bits.push(`ค่าใช้จ่าย ${formatBaht(stop.estimatedCost)} บาท`);
      lines.push(
        `  • ${time}${stop.name}` + (bits.length ? ` — ${bits.join(" · ")}` : "")
      );
    }
    if (day.totalKm) {
      lines.push(
        `  🚗 วันนี้รวม ${day.totalKm.toFixed(1)} กม. · เวลาเดินทาง ${Math.round(
          day.totalDriveMinutes
        )} นาที`
      );
    }
  }

  // ── ข้อควรรู้ ────────────────────────────────────────────────
  const notes = [...(plan.warnings ?? []), ...(plan.assumptions ?? [])].slice(0, 4);
  if (notes.length) {
    lines.push("");
    lines.push("ข้อควรรู้:");
    for (const n of notes) lines.push(`  • ${n}`);
  }

  return lines.join("\n");
}

// ── ข้อความฝั่งผู้ใช้ที่ระบบสร้างให้เอง ────────────────────────────────
// ใช้ใน flow ใหม่: ผู้ใช้ติ๊กสถานที่ → ระบบส่ง "คำสั่ง" ของผู้ใช้ → ผู้ใช้กรอกข้อมูล
// → ระบบส่งข้อมูลที่กรอก → ผู้ใช้จัดลำดับจุด → ระบบส่งรายการจุด
// ข้อความพวกนี้ถูกเก็บลงประวัติแชท (ฝั่งผู้ใช้) แต่ไม่ยิงไปเอไaiตอบกลับทันที

/** ป้ายสั้น ๆ ของรถที่เลือก (ใช้ทั้งในการ์ดและในข้อความสรุป) */
export function vehicleCategoryLabel(vehicle?: string | null): string {
  const v = (vehicle ?? "").trim().toLowerCase();
  if (v === "ev") return "รถไฟฟ้า";
  if (v === "van") return "รถตู้";
  if (v === "motorbike" || v === "motorcycle") return "มอเตอร์ไซค์";
  if (v === "public") return "ขนส่งสาธารณะ";
  if (v === "private_car") return "รถยนต์ส่วนตัว";
  return v || "ไม่ระบุ";
}

/**
 * ข้อความฝั่งผู้ใช้: "ทริป 1 วัน · จุดเริ่มต้น: ดอยอินทนนท์ · 8 พ.ย. · 08:00 · รถยนต์ส่วนตัว (Toyota) · 2 คน · งบ 3,000 บาท/คน"
 * → ข้ามส่วนที่ผู้ใช้ไม่ได้กรอก (ไม่บังคับให้ต้องครบทุกช่อง)
 */
export function formatTripSetupText(slots: TripSlots): string {
  const bits: string[] = [];

  const days = tripRangeDays(slots.startDate, slots.endDate);
  if (slots.startDate) {
    bits.push(`ทริป ${days ?? 1} วัน`);
  }

  // จุดเริ่มต้น / จุดสิ้นสุด (แยกข้อความ ไม่ปนกับวันที่)
  const startLabel = slots.startPoint?.label?.trim();
  if (startLabel) bits.push(`จุดเริ่มต้น: ${startLabel}`);
  if (slots.returnMode === "custom") {
    const endLabel = slots.endPoint?.label?.trim();
    if (endLabel) bits.push(`จุดสิ้นสุด: ${endLabel}`);
  }

  // ช่วงวันที่ (ไม่ต่อท้ายจำนวนวันซ้ำกับบรรทัดแรก)
  if (slots.startDate) {
    bits.push(
      formatThaiDateRange(slots.startDate, slots.endDate, { withDuration: false })
    );
  }
  if (slots.startTime) bits.push(`ออกเดินทาง ${slots.startTime}`);
  if (slots.vehicle) {
    const model = slots.vehicleModel?.trim();
    bits.push(
      model
        ? `${vehicleCategoryLabel(slots.vehicle)} (${model})`
        : vehicleCategoryLabel(slots.vehicle)
    );
  }
  if (slots.travelers != null) bits.push(`${slots.travelers} คน`);
  if (slots.budgetPerPerson != null) {
    bits.push(`งบ ${slots.budgetPerPerson.toLocaleString("th-TH")} บาท/คน`);
  }

  return bits.length ? bits.join(" · ") : "สร้างแพลนทริป";
}

/**
 * บริบท "สถานที่ที่ผู้ใช้เลือก" สำหรับส่งให้โมเดล
 * -------------------------------------------------------------
 * · โมเดลเห็นแค่เนื้อหาข้อความในประวัติแชท → ถ้าไม่แนบชื่อ/พิกัดสถานที่ที่ผู้ใช้ติ๊ก
 *   โมเดลจะไม่รู้จักว่าแผนนี้มาจากสถานที่ไหนบ้าง
 * · ใช้ร่วมกับกล่อง "สถานที่ที่เลือก" ที่ผู้ใช้เห็น (แหล่งเดียวกัน = ต่างกันไม่ได้)
 */
export function formatPlanPlacesContext(
  places: AiChatMessage["planPlaces"],
  slots?: TripSlots
): string {
  const list = places ?? [];
  if (!list.length) return "";
  const lines: string[] = [
    `สถานที่ที่ผู้ใช้เลือก (${list.length} จุด — ให้ใส่ในแผนให้ครบ):`,
  ];
  list.forEach((p, i) => {
    const coords = `${p.coords.lat.toFixed(4)}, ${p.coords.lng.toFixed(4)}`;
    const address = p.address ? ` — ${p.address}` : "";
    lines.push(`${i + 1}. ${p.label} (${coords})${address}`);
  });
  const start = slots?.startPoint;
  if (start?.label) {
    const coords = start.coords
      ? ` (${start.coords.lat.toFixed(4)}, ${start.coords.lng.toFixed(4)})`
      : "";
    lines.push(`จุดเริ่มต้น: ${start.label}${coords}`);
  }
  return lines.join("\n");
}

/**
 * ข้อความฝั่งผู้ใช้: "ยืนยันแพลนทริป · วันที่ 1: 09:00 ดอยอินทนนท์ → 11:30 วัดพระธาตุ"
 * → สรุปจุดที่ผู้ใช้จัดลำดับเอง (ตามที่กดยืนยันในการ์ดแพลน)
 */
export function formatStopsSelectionText(plan: TripPlan): string {
  const lines: string[] = ["ยืนยันแพลนทริป"];
  for (const day of plan.days ?? []) {
    const stops = day.stops ?? [];
    if (stops.length === 0) continue;
    const route = stops
      .map((s) => {
        const time = s.arriveTime ?? s.leaveTime ?? "";
        return time ? `${time} ${s.name}` : s.name;
      })
      .join(" → ");
    lines.push(`วันที่ ${day.day}: ${route}`);
  }
  return lines.join("\n");
}

// ---- Trips ----
export type TripStatus = "draft" | "planned" | "active" | "completed";
export type TravelStyle = "nature" | "slowlife" | "culture" | "foodie";

export const TRAVEL_STYLES: { key: TravelStyle; label: string; emoji: string }[] = [
  { key: "nature", label: "โร้ดทริปเน้นธรรมชาติ", emoji: "🏞️" },
  { key: "slowlife", label: "สโลว์ไลฟ์เน้นงานคราฟต์", emoji: "🧶" },
  { key: "culture", label: "วิถีชุมชน & วัฒนธรรม", emoji: "🏯" },
  { key: "foodie", label: "สายกิน อาหารพื้นถิ่น", emoji: "🍜" },
];

export type StopType =
  | "departure"
  | "attraction"
  | "community"
  | "food"
  | "cafe"
  | "accommodation"
  | "activity"
  | "return";

export interface ItineraryStop {
  id?: string;
  name: string;
  activity: string;
  stayHours: number;
  driveToNextMins: number;
  startTime?: string;
  endTime?: string;
  type?: StopType;
  estimatedCost?: number;
  verified?: boolean;
  note?: string;
  province?: string;
  district?: string;
  community?: string;
  coordinates?: { lat: number; lng: number };
  completed?: boolean;
  /** เวลามาถึงจริงที่ระบบคำนวณ (ต่างจาก startTime ของแผนเดิม) */
  arriveTime?: string;
  /** เวลาออกจากจุดนี้ */
  leaveTime?: string;
  /** สถานะเปิด/ปิด ณ เวลาที่มาถึง */
  openHours?: TripPlanOpenHours | null;
  /** ระยะจากจุดก่อนหน้า (กม.) */
  distanceFromPrevKm?: number | null;
  /** วิธีจอง / ติดต่อ */
  booking?: { phone?: string | null; website?: string | null; note?: string | null } | null;
  /** คำเตือนเฉพาะจุด */
  issues?: string[];
  /** จุดแวะระหว่างทาง (ปั๊ม/ร้านอาหาร/จุดพัก) — ใส่เองในหน้าแพลน */
  isWaypoint?: boolean;
  /** ชนิดของจุดแวะระหว่างทาง */
  waypointKind?: WaypointKind;
}

/** ชนิดจุดแวะระหว่างทางที่ผู้ใช้เพิ่มเองในหน้าแพลน */
export type WaypointKind = "fuel" | "food" | "convenience" | "rest";

export interface ItineraryDay {
  day: number;
  date?: string;
  stops: ItineraryStop[];
  title?: string;
  theme?: string;
  /** จุดเริ่มต้นของวันนี้ */
  startPoint?: TripPlanPoint;
  /** จุดสิ้นสุดของวันนี้ (กลับจุดเดิม หรือ ที่พักค้างคืน) */
  endPoint?: TripPlanPoint;
  endPointType?: "return" | "lodging";
  /** เส้นทางจริงรายขา (ไว้วาดเส้นบนแผนที่) */
  legs?: TripPlanLeg[];
  totalKm?: number;
  totalDriveMinutes?: number;
  fuelCost?: number;
  warnings?: string[];
}

export interface TripBudget {
  lodging: number;
  fuel: number;
  food: number;
  activities?: number;
  other?: number;
  total: number;
  perPerson: number;
  withinBudget: boolean;
}

/**
 * สถานที่ที่แพลนนี้ใช้ พร้อมที่มาของข้อมูล
 * -------------------------------------------------------------
 * `registry` = ยืนยันในทะเบียนสถานที่แล้ว
 * `clip`     = มาจากข้อความในคลิป (ยังไม่ยืนยัน)
 *
 * เป็นรูปแบบเดียวกันทั้ง 3 ที่ (หน้าโฟลเดอร์ / แชท / แพลนทริป) เพื่อให้
 * ป้ายที่มาแสดงตรงกัน โดยไม่ต้องผูก tripsData กับ service ของโฟลเดอร์
 */
export interface TripFolderPlace {
  name: string;
  source: "registry" | "clip";
  clipCount?: number;
  communityName?: string | null;
  address?: string | null;
}

export interface Trip {
  id: string;
  planId?: string; // Unique plan id for two-way chat iteration
  title: string;
  summary: string;
  status: TripStatus;
  startPoint: string;
  startPointUrl?: string; // e.g. Google Maps URL
  startPointCoords?: { lat: number; lng: number };
  startTime?: string; // e.g. "06:00"
  /** จำนวนผู้เดินทาง (ใช้คิดงบต่อคน/ค่าน้ำมัน) */
  travelers?: number;
  destinations: string[];
  days: number;
  nights: number;
  budgetPerPerson: number;
  style: TravelStyle;
  itinerary: ItineraryDay[];
  budget: TripBudget;
  sourceFolderId?: string;
  /** สถานที่ที่แพลนนี้ไป พร้อมที่มา (ยืนยันแล้ว / ยังไม่ยืนยัน) */
  folderPlaces?: TripFolderPlace[];
  createdAt: number;
  updatedAt?: number;

  // ── ข้อมูลของแผนที่วางด้วยระบบคำนวณจริง (POST /trips/plan) ──
  /** กลับจุดเดิม หรือกลับคนละจุด */
  returnMode?: TripReturnMode;
  /** จุดสิ้นสุดตอนกลับ */
  endPoint?: string;
  endPointCoords?: { lat: number; lng: number };
  /** รถที่ใช้ + ที่มาของราคาน้ำมัน */
  vehicle?: TripPlanVehicle;
  fuel?: TripPlan["fuel"];
  /** ที่พักที่ระบบเสนอ (หลายวัน) */
  lodging?: TripPlanLodging[];
  /** ข้อควรระวัง / สมมติฐานที่ระบบบอกไว้ */
  warnings?: string[];
  assumptions?: string[];
  /** ที่มาของข้อมูลเส้นทาง (osrm = เส้นทางจริง · estimate = ประมาณ) */
  routeSource?: string;
  routeCredit?: string;
}

export interface TripRequestInput {
  startPoint: string;
  destinations: string[];
  days: number;
  nights: number;
  budgetPerPerson: number;
  style: TravelStyle;
}
