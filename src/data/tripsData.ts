import { HOME_FEED_POSTS } from "./homeFeedData";
import { getVideoById } from "./profilesData";

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
}

export interface AiChatThread {
  id: string;
  title: string;
  /** When set, this thread is scoped to a saved folder. */
  folderId?: string;
  messages: AiChatMessage[];
  createdAt: number;
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
}

export interface ItineraryDay {
  day: number;
  date?: string;
  stops: ItineraryStop[];
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
}

export interface TripRequestInput {
  startPoint: string;
  destinations: string[];
  days: number;
  nights: number;
  budgetPerPerson: number;
  style: TravelStyle;
}
