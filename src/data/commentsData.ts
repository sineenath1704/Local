import rawComments from "./commentsData.json";

/**
 * Comments / Reviews / AI-summary data layer.
 * -------------------------------------------------------------
 * Editable content lives in `commentsData.json`, keyed by postId.
 * Avatars / images can't live in JSON, so they're referenced by a string
 * key and mapped to bundled assets here.
 *
 * The AI summary is treated as PRE-COMPUTED data (as if returned by the
 * backend). The app never runs speech-to-text / vision / LLM on-device —
 * see `src/services/aiSummaryService.ts` for the intended backend flow.
 */

// ---- Asset map (key -> bundled image) ----
const IMAGE_ASSETS: Record<string, any> = {
  persona_pa_somsri: require("../../assets/persona_pa_somsri.jpg"),
  persona_art: require("../../assets/persona_art.jpg"),
  card_persona_pa_somsri: require("../../assets/card_persona_pa_somsri.jpg"),
  card_persona_art: require("../../assets/card_persona_art.jpg"),
};

/** Resolve an image key to a bundled asset, or null for a generic avatar. */
export function resolveCommentImage(key?: string): any | null {
  if (!key || key === "generic") return null;
  return IMAGE_ASSETS[key] ?? null;
}

// ---- Types ----
export interface CommentReply {
  id: string;
  authorName: string;
  avatarKey?: string;
  timeAgo: string;
  text: string;
  likes: number;
}

export interface CommentItem {
  id: string;
  authorName: string;
  avatarKey?: string;
  timeAgo: string;
  text: string;
  likes: number;
  replies: CommentReply[];
}

export interface ReviewItem {
  id: string;
  authorName: string;
  avatarKey?: string;
  timeAgo: string;
  rating: number; // 0-5
  text: string; // optional (may be empty)
  imageKeys: string[]; // optional (may be empty)
}

export type AiSummaryStatus = "ready" | "processing" | "unavailable";

/** Structured place data extracted from the clip (Video Content Analyzer). */
export interface AiPlaceData {
  place_name: string | null;
  location: {
    province: string | null;
    district: string | null;
    subdistrict?: string | null;
    gps?: string | null;
  };
  category: string[];
  activities: string[];
  price_info: { weekday: string | null; weekend: string | null; currency?: string };
  contact: { phone?: string | null; facebook?: string | null; line?: string | null };
  opening_hours?: string | null;
  otop_products: string[];
  highlights: string[];
  tags: string[];
  confidence?: {
    overall_confidence?: number;
    source_used?: string[];
    missing_info?: string[];
    warning?: string | null;
  };
}

export interface AiSummary {
  status: AiSummaryStatus;
  generatedAt?: string;
  model?: string;
  text: string;
  /** Structured extraction from the clip (place/price/contact/...), when available. */
  place?: AiPlaceData;
  tags?: string[];
  highlights?: string[];
  transcriptHighlights?: string[]; // legacy: from Speech-to-Text
  visualTags?: string[]; // legacy: from Vision analysis
  onScreenText?: string[]; // text detected on screen
}

export interface PostCommentData {
  comments: CommentItem[];
  reviews: ReviewItem[];
  aiSummary: AiSummary | null;
}

const EMPTY_SUMMARY: AiSummary = {
  status: "processing",
  text: "ระบบกำลังประมวลผลวิดีโอนี้ด้วย AI (ถอดเสียง + วิเคราะห์ภาพ) โปรดกลับมาดูสรุปอีกครั้งภายหลัง",
};

const rawMap = rawComments as Record<string, Partial<PostCommentData>>;

/** Get fully-shaped comment data for a post (safe defaults when missing). */
export function getPostCommentData(postId: string): PostCommentData {
  const entry = rawMap[postId];
  return {
    comments: (entry?.comments as CommentItem[]) ?? [],
    reviews: (entry?.reviews as ReviewItem[]) ?? [],
    aiSummary: (entry?.aiSummary as AiSummary) ?? EMPTY_SUMMARY,
  };
}

/** Count helpers for the sheet tab headers. */
export function countComments(data: PostCommentData): number {
  return data.comments.reduce((sum, c) => sum + 1 + c.replies.length, 0);
}

export function countReviews(data: PostCommentData): number {
  return data.reviews.length;
}

/** Build a fresh client-side comment (optimistic add before a real API call). */
export function makeLocalComment(text: string): CommentItem {
  return {
    id: `local-${Date.now()}`,
    authorName: "คุณ",
    avatarKey: "generic",
    timeAgo: "เมื่อสักครู่",
    text,
    likes: 0,
    replies: [],
  };
}

export function makeLocalReply(text: string): CommentReply {
  return {
    id: `local-r-${Date.now()}`,
    authorName: "คุณ",
    avatarKey: "generic",
    timeAgo: "เมื่อสักครู่",
    text,
    likes: 0,
  };
}
