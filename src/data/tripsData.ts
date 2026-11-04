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
 * ชื่อของ slot ต้องตรงกับ `backend/src/tripPrompt.ts` เป๊ะ ๆ
 */
export interface TripSlots {
  startPoint?: TripPlanPoint | null;
  returnMode?: TripReturnMode | null;
  endPoint?: TripPlanPoint | null;
  date?: string | null;
  startTime?: string | null;
  days?: number | null;
  /**
   * key ของรถ (`private_car` …) หรือชื่อที่แสดง ("รถยนต์ส่วนตัว")
   * → เป็น string ธรรมดา เพราะโมเดลอาจเขียนชื่อมาแทน key
   * (backend จับคู่ให้เอง · ถ้าไม่รู้จักจะใช้รถยนต์ส่วนตัวเป็นค่าเริ่มต้น)
   */
  vehicle?: string | null;
  fuelType?: string | null;
  travelers?: number | null;
  budgetPerPerson?: number | null;
  style?: string | null;
  /**
   * จุดสิ้นสุดของแต่ละวัน (หลายวัน) — เก็บไว้ฝั่งแอปเท่านั้น
   * (backend ไม่ได้อยู่ใน TRIP_DRAFT แต่รับ dayEndPoints ตอนเรียก /trips/plan)
   */
  dayEndPoints?: (TripPlanPoint | null)[] | null;
}

/**
 * ข้อมูลที่ยังขาด — คำนวณแบบ deterministic ฝั่งแอป (เหมือน `computeTripMissing` ของ backend)
 * -------------------------------------------------------------
 * ต้องมี: จุดเริ่ม(พร้อมพิกัด) · วันที่ · เวลาเริ่ม · รถ · จำนวนวัน
 * และจุดสิ้นสุดตอนกลับ (พร้อมพิกัด) เมื่อ returnMode = "custom"
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

  if (!slots.date) missing.push("วันที่");
  if (!slots.startTime) missing.push("เวลาเริ่มต้น");
  if (!slots.vehicle) missing.push("รถที่ใช้");
  if (!slots.days) missing.push("จำนวนวัน");

  return missing;
}

/** ข้อมูลครบพอที่จะกด "สร้างแพลนทริป" หรือยัง */
export function isTripPlanReady(slots: TripSlots): boolean {
  return computeTripMissing(slots).length === 0;
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
}

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
