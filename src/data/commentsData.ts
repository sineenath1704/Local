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
  atmosphere?: string | null;
  category: string[];
  activities: string[];
  price_info: {
    weekday: string | null;
    weekend: string | null;
    currency?: string;
    /**
     * Google's price band for the place ("฿" / "฿฿฿" / "ฟรี"). Filled in when
     * the user tick-confirms a Google place — it is an overall estimate, NOT
     * a weekday/weekend price, so it lives beside them rather than in them.
     */
    level?: string | null;
  };
  contact: {
    phone?: string | null;
    facebook?: string | null;
    line?: string | null;
    /** Website of the confirmed place, from Google. */
    website?: string | null;
  };
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

/**
 * การ์ดหน้าโพสต์ (PostCard) — รูปแบบมีโครงสร้างของสรุป AI
 * -------------------------------------------------------------
 * ต้องตรงกับฝั่ง backend (`backend/src/videoPromptV2.ts`) ทุกคีย์
 * คลิปที่สรุปด้วย VCA V2 เท่านั้นที่มี field นี้ · คลิปเก่าไม่มี → แอป
 * ต้อง fallback ไปใช้ `text` แบบเดิม
 *
 * รูปแบบปัจจุบัน: การ์ด "ข้อความล้วน" แบ่งเป็นบล็อก (`blocks`)
 *   · bullets = หัวข้อ + รายการ (ขึ้นต้นด้วย "• ")
 *   · facts   = หัวข้อ (ถ้ามี) + บรรทัดข้อเท็จจริงต่อเนื่อง (ไม่มีไอคอน ไม่มี bullet)
 * `sections` (รูปแบบเก่าที่มี ✔/⚠/ℹ) เก็บไว้เผื่อคลิปเก่าในฐานข้อมูล
 */
export interface PostCardLine {
  /** ok = ยืนยันได้ · warn = ข้อจำกัด/กติกา · info = ข้อมูลจากแผนที่ */
  kind: "ok" | "warn" | "info";
  text: string;
  /** ลิงก์เปิดแผนที่ (มีเฉพาะบรรทัดที่พาไปยังสถานที่จริง) — แอปทำให้กดได้ */
  url?: string | null;
}

/** บล็อกหนึ่งบล็อกของการ์ด */
export interface PostCardBlock {
  /** หัวข้อของบล็อก (เช่น "ราคา" "ที่พัก" "ภายในห้องพัก") — ไม่มี = บรรทัดต่อเนื่อง */
  title?: string | null;
  style: "bullets" | "facts";
  lines: PostCardLine[];
}

/** หัวข้อหนึ่งหัวข้อของการ์ด (รูปแบบเก่า) */
export interface PostCardSection {
  title: string;
  /** ตัวเลขเด่นบนหัวข้อ เช่น "฿700/คน" — ไม่มีข้อมูล = ไม่แสดง */
  highlight?: string | null;
  lines: PostCardLine[];
}

export interface PostCard {
  /** ชื่อสถานที่ + ที่อยู่ที่รวบรวมแล้ว + แท็กไลน์สั้น ๆ */
  place?: {
    name?: string | null;
    address?: string | null;
    /** ประโยคสั้นว่าที่นี่คืออะไร — แสดงใต้ชื่อสถานที่ */
    tagline?: string | null;
    /** คำบรรยายสถานที่ — แสดงใต้แท็กไลน์ */
    description?: string | null;
  } | null;
  /** บล็อกเรียงตามลำดับที่จะแสดง (รูปแบบปัจจุบัน) */
  blocks?: PostCardBlock[] | null;
  /** รูปแบบเก่า — มีเฉพาะการ์ดที่สร้างก่อนเปลี่ยนไปใช้บล็อก */
  sections?: PostCardSection[] | null;
  /** บรรทัดกิจกรรม/สินค้า (รูปแบบเก่า) */
  activity?: string | null;
  /** ติดต่อ/จอง + เวลาเปิด */
  contact?: {
    phone?: string | null;
    facebook?: string | null;
    line?: string | null;
    hours?: string | null;
  } | null;
  /** เครดิตแผนที่ — ต้องแสดงเมื่อมีข้อมูลจาก Google Maps Platform */
  mapCredit?: string | null;
}

export interface AiSummary {
  status: AiSummaryStatus;
  generatedAt?: string;
  model?: string;
  text: string;
  /** Structured extraction from the clip (place/price/contact/...), when available. */
  place?: AiPlaceData;
  /** การ์ดสรุปแบบมีโครงสร้าง — มีเฉพาะคลิปที่สรุปด้วย VCA V2 */
  card?: PostCard;
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
