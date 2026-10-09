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
export type TripStatus = "upcoming" | "draft" | "past";
export type TravelStyle = "nature" | "slowlife" | "culture" | "foodie";

export const TRAVEL_STYLES: { key: TravelStyle; label: string; emoji: string }[] = [
  { key: "nature", label: "โร้ดทริปเน้นธรรมชาติ", emoji: "🏞️" },
  { key: "slowlife", label: "สโลว์ไลฟ์เน้นงานคราฟต์", emoji: "🧶" },
  { key: "culture", label: "วิถีชุมชน & วัฒนธรรม", emoji: "🏯" },
  { key: "foodie", label: "สายกิน อาหารพื้นถิ่น", emoji: "🍜" },
];

export interface ItineraryStop {
  name: string;
  activity: string;
  stayHours: number;
  driveToNextMins: number;
}

export interface ItineraryDay {
  day: number;
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

export interface Trip {
  id: string;
  title: string;
  summary: string;
  status: TripStatus;
  startPoint: string;
  destinations: string[];
  days: number;
  nights: number;
  budgetPerPerson: number;
  style: TravelStyle;
  itinerary: ItineraryDay[];
  budget: TripBudget;
  sourceFolderId?: string;
  createdAt: number;
}

export interface TripRequestInput {
  startPoint: string;
  destinations: string[];
  days: number;
  nights: number;
  budgetPerPerson: number;
  style: TravelStyle;
}
