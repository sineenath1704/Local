import { API_TIMEOUT_MS } from "./apiConfig";
import { aiFetch, AiError, AiFetchOptions, toastAiError } from "./aiHttp";
import type {
  PlaceChoice,
  ClipContext,
  TripDraft,
  TripSlotsWire,
  PlaceTag,
  ChatSource,
  ChatPlaceCard,
  DiscoveryStyle,
} from "../data/tripsData";
import { slotsFromWire } from "../data/tripsData";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface FolderContext {
  folderName: string;
  places: string[];
}

/**
 * คำตอบจาก backend — ถ้าชื่อสถานที่ที่ถามซ้ำกันหลายแห่ง
 * จะมี `placeCandidates` ให้ผู้ใช้เลือก (ไม่มี = คำตอบธรรมดา)
 */
export interface ChatReply {
  reply: string;
  placeCandidates?: PlaceChoice[];
  /**
   * สถานะข้อมูลแผนทริป — มีเฉพาะตอนที่เอไaiกำลังช่วยวางแผนทริป
   * (ไม่มี = ข้อความธรรมดา → ห้ามแสดงปุ่มแผน)
   */
  tripDraft?: TripDraft;
  /**
   * แท็กประเภทสถานที่ — backend ตรวจจากทะเบียน OTOP ของระบบ
   * (เจอ = "otop" · ไม่เจอ = "tourism")
   */
  placeTag?: PlaceTag;
  /** หมวดหมู่ของสถานที่ (ที่พัก · ร้านอาหาร · คาเฟ่ ...) */
  tags?: string[];
  /**
   * ชื่อสถานที่ที่จะติดแท็ก — มีเฉพาะตอนที่คำตอบเอ่ยชื่อนี้จริง
   * (แอปใช้วางแท็กไว้หน้าชื่อในบรรทัดเดียวกับคำตอบ)
   */
  tagPlace?: string;
  /** ลิงก์แหล่งที่มา — มีเมื่อคำตอบนี้มาจากการค้นเว็บ */
  sources?: ChatSource[];
  /** แท็กแยกรายสถานที่ */
  placeTags?: {
    name: string;
    placeTag?: PlaceTag;
    tags?: string[];
  }[];
  /** สัญญาณให้แสดงรายการโฟลเดอร์ให้ผู้ใช้เลือก */
  showFolderPicker?: boolean;
}

/**
 * อ่าน `tripDraft` ที่ backend ส่งกลับมา
 * ค่าที่ผิดรูปแบบ → ทิ้งทั้งก้อน (ไม่ทำให้แชทพัง)
 */
function parseTripDraft(raw: unknown): TripDraft | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  if (!d.slots || typeof d.slots !== "object") return undefined;
  const slots = slotsFromWire(d.slots as TripSlotsWire);
  const missing = Array.isArray(d.missing)
    ? d.missing.filter((m): m is string => typeof m === "string")
    : [];
  return {
    slots,
    missing,
    planReady: d.planReady === true,
  };
}

/** แปลงรายการสถานที่จาก backend → ใช้เฉพาะที่มี placeId+name จริง */
function parsePlaceCandidates(raw: unknown): PlaceChoice[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const list: PlaceChoice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.placeId !== "string" || !c.placeId.trim()) continue;
    if (typeof c.name !== "string" || !c.name.trim()) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
    list.push({
      placeId: c.placeId.trim(),
      name: c.name.trim(),
      address: str(c.address),
      province: str(c.province),
      district: str(c.district),
      subdistrict: str(c.subdistrict),
      community: str(c.community),
      rating: num(c.rating),
      userRatingsTotal: num(c.userRatingsTotal),
      googleMapsUrl: str(c.googleMapsUrl),
    });
  }
  return list.length > 0 ? list : undefined;
}

/**
 * แปลงแท็กประเภทสถานที่จาก backend
 * ค่าที่ไม่รู้จัก → ทิ้ง (ไม่ทำให้แชทพัง)
 */
function parsePlaceTag(raw: unknown): PlaceTag | undefined {
  return raw === "otop" || raw === "tourism" ? raw : undefined;
}

/** แปลงรายการแท็กหมวดหมู่ — เก็บแค่ค่าที่เป็นข้อความจริง */
function parseTopicTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return list.length > 0 ? list.slice(0, 4) : undefined;
}

/**
 * ชื่อสถานที่ที่จะติดแท็ก — backend ส่งมาเฉพาะตอนที่คำตอบเอ่ยชื่อนี้จริง
 * ค่าที่ไม่ใช่ข้อความ → ทิ้ง (แอปจะได้ไม่ติดแท็กที่ไหนเลย)
 */
function parseTagPlace(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name ? name : undefined;
}

/** แปลงลิงก์แหล่งที่มา — ข้ามรายการที่ไม่มี url */
function parseSources(raw: unknown): ChatSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list: ChatSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.url !== "string" || !s.url.trim()) continue;
    list.push({
      title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : s.url.trim(),
      url: s.url.trim(),
    });
    if (list.length >= 5) break;
  }
  return list.length > 0 ? list : undefined;
}

/**
 * แปลงการ์ดสถานที่จาก backend (ประเภท D)
 * ข้อมูลผิดรูปแบบ → ทิ้งทีละใบ (ไม่ทำให้การ์ดทั้งก้อนพัง)
 */
function parsePlaceCards(raw: unknown): ChatPlaceCard[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const list: ChatPlaceCard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const placeId = str(p.placeId);
    const name = str(p.name);
    if (!placeId || !name) continue;
    list.push({
      placeId,
      name,
      description: typeof p.description === "string" ? p.description : "",
      address: str(p.address),
      area: str(p.area),
      district: str(p.district),
      subdistrict: str(p.subdistrict),
      category: str(p.category),
      photoUrl: str(p.photoUrl),
      rating: num(p.rating),
      userRatingsTotal: num(p.userRatingsTotal),
      website: str(p.website),
      googleMapsUrl: str(p.googleMapsUrl),
      lat: num(p.lat),
      lng: num(p.lng),
      openingHours: str(p.openingHours),
      priceLevel: num(p.priceLevel),
      types: Array.isArray(p.types)
        ? p.types.filter((t): t is string => typeof t === "string")
        : [],
      styleId: str(p.styleId),
      styleLabel: str(p.styleLabel),
      styleEmoji: str(p.styleEmoji),
    });
  }
  return list.length > 0 ? list : undefined;
}

/**
 * แปลงสไตล์ที่เอไaiเสนอจาก backend
 * ข้อมูลผิดรูปแบบ → ทิ้งทีละแบบ (ถ้าเหลือน้อยกว่า 2 → ใช้ชุดสำรองแทน)
 */
function parseDiscoveryStyles(raw: unknown): DiscoveryStyle[] {
  if (!Array.isArray(raw)) return [];
  const list: DiscoveryStyle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const label = typeof s.label === "string" ? s.label.trim() : "";
    if (!label) continue;
    const id =
      typeof s.id === "string" && s.id.trim()
        ? s.id.trim()
        : `style-${list.length + 1}`;
    list.push({
      id,
      label,
      emoji: typeof s.emoji === "string" && s.emoji.trim() ? s.emoji.trim() : "📍",
      desc: typeof s.desc === "string" ? s.desc.trim() : "",
      query: typeof s.query === "string" && s.query.trim() ? s.query.trim() : label,
    });
    if (list.length >= 12) break;
  }
  return list;
}

/**
 * คลังแท็กสำรอง — ชุดเดียวกับ `DISCOVERY_TAGS` ของ backend
 * (ดึงหมวดหมู่มาจากทะเบียน OTOP ของระบบ) · ใช้ตอนเรียก backend ไม่สำเร็จ
 * (ผู้ใช้ต้องเลือกแท็กได้เสมอ แม้ไม่มีเน็ต)
 */
export const FALLBACK_DISCOVERY_TAGS: DiscoveryStyle[] = [
  {
    id: "temple",
    label: "วัด วัฒนธรรม",
    emoji: "🏛️",
    desc: "วัดสำคัญ โบราณสถาน ประเพณีท้องถิ่น",
    query: "วัด",
  },
  {
    id: "attraction",
    label: "แหล่งท่องเที่ยว ตลาด",
    emoji: "🎭",
    desc: "จุดถ่ายรูป ตลาดนัด แหล่งท่องเที่ยวดัง",
    query: "แหล่งท่องเที่ยว",
  },
  {
    id: "nature",
    label: "ธรรมชาติ จุดชมวิว",
    emoji: "🌿",
    desc: "อุทยานแห่งชาติ จุดชมวิว สวนสาธารณะ",
    query: "จุดชมวิว",
  },
  {
    id: "mountain",
    label: "ภูเขา",
    emoji: "⛰️",
    desc: "จุดเดินป่า สระ ดอย วิวมอง",
    query: "ภูเขา",
  },
  {
    id: "sea",
    label: "ทะเล ชายหาด",
    emoji: "🌊",
    desc: "หาดทราย เกาะ จุดดำน้ำ",
    query: "ชายหาด",
  },
  {
    id: "waterfall",
    label: "น้ำตก",
    emoji: "💧",
    desc: "น้ำตก ธาร ผา ถ้ำ",
    query: "น้ำตก",
  },
  {
    id: "cafe",
    label: "คาเฟ่ ถ่ายรูป",
    emoji: "☕",
    desc: "ร้านกาแฟบรรยากาศดี มุมถ่ายรูป",
    query: "คาเฟ่",
  },
  {
    id: "food",
    label: "ร้านอาหาร สตรีทฟู้ด",
    emoji: "🍜",
    desc: "ของกินขึ้นชื่อ ตลาดกลางคืน",
    query: "ร้านอาหาร",
  },
  {
    id: "activity",
    label: "กิจกรรม เดินป่า",
    emoji: "🏕️",
    desc: "แคมป์ปิ้ง ล่องแก่ง จุดตกหินน้ำตก",
    query: "จุดตกหินน้ำตก",
  },
  {
    id: "stay",
    label: "ที่พัก พักผ่อน",
    emoji: "🛏️",
    desc: "โรงแรม โฮมสเตย์ แคมป์ปิ้ง ริมน้ำ สปา วิถีสโลว์ไลฟ์",
    query: "ที่พัก",
  },
];

/** คำตอบของเส้นทาง "ถามแนะนำสถานที่" */
export interface DiscoveryPlacesReply {
  /** คำตอบข้อความของเอไaiในแชท */
  reply: string;
  /** การ์ดสถานที่เรียงลงมา */
  places: ChatPlaceCard[];
  /** แท็กที่ใช้หาสถานที่ (ผู้ใช้เลือกเอง หรือให้เอไaiเลือกให้) */
  tags: DiscoveryStyle[];
  /** พื้นที่ที่ใช้ค้น (null = ทั่วประเทศไทย) */
  area: string | null;
}

/**
 * ขอ "คลังแท็ก" ที่ผู้ใช้จะเลือกในป๊อปอัป
 * -------------------------------------------------------------
 * backend ส่งคลังคงที่กลับมา (ไม่ต้องรอ AI → ป๊อปอัปขึ้นทันที)
 * ถ้าล้มเหลวคืนชุดสำรองในแอป (ผู้ใช้ต้องเลือกได้เสมอ)
 */
export async function requestDiscoveryTags(opts: {
  messages?: ChatTurn[];
  area?: string | null;
}): Promise<DiscoveryStyle[]> {
  try {
    const data = await withToast<{ tags?: unknown; styles?: unknown }>({
      label: "ai-chat/discovery",
      path: "/ai-chat/discovery",
      method: "POST",
      body: {
        messages: opts.messages ?? [],
        area: opts.area ?? undefined,
      },
      timeoutMs: API_TIMEOUT_MS * 3,
    });
    const tags = parseDiscoveryStyles(data?.tags ?? data?.styles);
    return tags.length >= 2 ? tags : FALLBACK_DISCOVERY_TAGS;
  } catch {
    // ล้มเหลว = ใช้ชุดสำรอง (ผู้ใช้ยังเลือกแท็กได้)
    return FALLBACK_DISCOVERY_TAGS;
  }
}

/**
 * ขอสถานที่ตามแท็กที่ผู้ใช้เลือก (หรือให้เอไaiเลือกให้)
 * -------------------------------------------------------------
 * คืนคำตอบข้อความ + การ์ดสถานที่ (ข้อมูลจริงจาก Google Places)
 *
 * `excludePlaceIds` / `excludeNames` = สถานที่ที่เคยได้ไปแล้ว
 * → รอบนี้จะไม่ย้ำสถานที่เดิม (ใช้ตอนกด "รีเฟช")
 */
export async function requestDiscoveryPlaces(opts: {
  messages: ChatTurn[];
  area?: string | null;
  /** แท็กที่ผู้ใช้ยืนยัน (ยืนยันแล้วค่อยส่ง) */
  tags?: DiscoveryStyle[];
  /** สถานที่ที่เคยได้ไปแล้ว — ห้ามย้ำ */
  excludePlaceIds?: string[];
  /** ชื่อสถานที่ที่เคยได้ไปแล้ว — ห้ามย้ำ */
  excludeNames?: string[];
  /** true = ให้เอไaiเลือกแท็กเองจากคำถาม (ไม่ต้องยืนยัน) */
  aiPicks?: boolean;
}): Promise<DiscoveryPlacesReply> {
  const data = await withToast<{
    reply?: unknown;
    places?: unknown;
    tags?: unknown;
    area?: unknown;
  }>({
    label: "ai-chat/discovery",
    path: "/ai-chat/discovery",
    method: "POST",
    body: {
      messages: opts.messages,
      area: opts.area ?? undefined,
      tags: opts.tags,
      excludePlaceIds: opts.excludePlaceIds,
      excludeNames: opts.excludeNames,
      aiPicks: opts.aiPicks ? true : undefined,
    },
    timeoutMs: API_TIMEOUT_MS * 5,
  });

  if (typeof data?.reply !== "string") {
    throw new AiError({
      kind: "bad-shape",
      status: 200,
      body: JSON.stringify(data ?? null),
      requestId: null,
      label: "ai-chat/discovery",
      url: "",
      durationMs: 0,
      timeoutMs: API_TIMEOUT_MS * 5,
    });
  }

  const places = parsePlaceCards(data.places) ?? [];
  const tags = parseDiscoveryStyles(
    Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []
  );
  return {
    reply: data.reply,
    places,
    tags,
    area: typeof data.area === "string" && data.area.trim() ? data.area.trim() : null,
  };
}

/** Every call raises a toast on failure, then rethrows for the caller to render. */function withToast<T>(opts: AiFetchOptions): Promise<T> {
  return aiFetch<T>({
    ...opts,
    onSettled: (ok, error) => {
      if (!ok && error) toastAiError(error);
    },
  });
}

/**
 * Send the running conversation to the backend AI chat endpoint.
 *
 * Throws `AiError` on failure. This used to return a fixed Thai sentence
 * ("ระบบ AI ขัดข้องชั่วคราว") which the chat screen appended as if it were a
 * real assistant reply — so a 401, a timeout and a dead backend were
 * indistinguishable. The screen now catches and styles it separately.
 *
 * `mode: "host-self"` switches the backend into a JWT-gated advisor mode that
 * reads the host's own business data. Caller must pass the JWT; a missing or
 * stale token will surface as a 401 from the backend.
 */
export interface SendChatOptions {
  folder?: FolderContext;
  /**
   * รหัสโฟลเดอร์ (path ใหม่) — backend จะไปอ่านคลิปจริง จับคู่ทะเบียนสถานที่
   * แล้วเรียบเรียงข้อมูลเอง (ต้องมี Bearer token)
   * ถ้าไม่ส่ง `folder` จะใช้ชื่อสถานที่ดิบที่ client ส่งมาแทน (แชทแบบไม่ล็อกอิน)
   */
  folderId?: string | null;
  /** "tourist" (default) is unauthenticated; "host-self" requires a Bearer token. */
  mode?: "tourist" | "host-self";
  /** Supabase access token. Required when mode === "host-self". */
  token?: string;
  /**
   * ชุมชนที่กำลังคุยอยู่ (D22) — ให้ backend ดึงเฉพาะสถานที่ในชุมชนนั้น
   * ถ้าไม่ส่ง backend จะเดาจากชื่อชุมชนในข้อความแทน
   */
  communityId?: string | null;
  /**
   * place_id ของสถานที่ที่ผู้ใช้เลือกจากรายการ (กรณีชื่อซ้ำ)
   * → backend ดึงรายละเอียดของอันนี้ตรง ๆ ไม่ต้องค้นชื่อใหม่
   * ส่ง "ตัวระบุ" เท่านั้น — ไม่ส่งข้อมูลสถานที่มาเอง
   */
  placeId?: string | null;
  /** ชื่อสถานที่ที่ผู้ใช้เลือก (กันไว้ให้ backend รู้ว่าเลือกอันไหน) */
  placeName?: string | null;
  /**
   * บริบทจากคลิปที่ผู้ใช้กูลับมาแชท (ปุ่ม "คุยต่อกับ AI เรื่องนี้")
   * → backend แทรกเป็นบล็อกแยกใน system prompt ให้โมเดลยึดเป็นข้อมูลหลัก
   * (ชื่อสถานที่ ที่ตั้ง ราคา เวลาเปิด กติกา วิธีเดินทางที่พูดในคลิป)
   */
  clipContext?: ClipContext | null;
  /**
   * ช่องข้อมูลแผนทริปที่ผู้ใช้ให้ไว้แล้ว (สะสม) → backend merge กับค่าที่โมเดลสกัดใหม่
   * ค่าที่โมเดลไม่รู้ (null) จะไม่ทับค่านี้
   *
   * รูปแบบที่ส่ง = ขาเข้า/ขาออกของ backend (`date` + `days`) → แปลงจาก
   * ช่วงวันที่ของแอปด้วย `slotsToWire` ก่อนส่ง
   */
  tripDraft?: TripSlotsWire | null;
  /**
   * แผนทริปที่กำลังจะให้เอไaiแก้ไข (จาก ItineraryViewer) → แทรกเป็นบล็อกข้อมูล
   * ใน system prompt เพื่อให้เอไaiรู้ว่าแก้อะไรจากแผนเดิม
   */
  planContext?: unknown;
  /**
   * ผู้ใช้กด "ยกเลิก" ในป๊อปอัปเลือกสไตล์ → คำถามถูกส่งมาเป็นแชทธรรมดา
   * → บอก backend ให้รู้ว่า "ไม่มีการ์ดสถานที่จะขึ้น" (ไม่งั้นโมเดลจะสัญญาว่าจะมีการ์ดให้เลือก)
   */
  discoveryDismissed?: boolean;
}

export async function sendChat(
  messages: ChatTurn[],
  folderOrOpts?: FolderContext | SendChatOptions,
): Promise<ChatReply> {
  // Two call shapes accepted: (messages, folderCtx) — the legacy one — or
  // (messages, opts). The cleanest discriminator is `mode` and `token`,
  // which never existed on the legacy `FolderContext`.
  const opts: SendChatOptions =
    folderOrOpts === undefined
      ? {}
      : "mode" in (folderOrOpts as object) || "token" in (folderOrOpts as object)
        ? (folderOrOpts as SendChatOptions)
        : { folder: folderOrOpts as FolderContext };

  const headers: Record<string, string> = {};
  if (opts.mode === "host-self" && !opts.token) {
    // Surface the missing-credential case as an honest error instead of a
    // confusing 401 from the backend — saves a round-trip.
    throw new AiError({
      kind: "bad-request",
      status: 0,
      body: "ต้องล็อกอินเพื่อใช้โหมดผู้ประกอบการ (token หายไป)",
      requestId: null,
      label: "ai-chat",
      url: "",
      durationMs: 0,
      timeoutMs: API_TIMEOUT_MS * 3,
    });
  }
  // ส่ง token ทุกครั้งที่มี session — ไม่ใช่เฉพาะโหมด host-self
  // เพราะ backend ต้องใช้มันตรวจสิทธิ์เจ้าของโฟลเดอร์ก่อนอ่านข้อมูลโฟลเดอร์
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const data = await withToast<{
    reply?: unknown;
    placeCandidates?: unknown;
    tripDraft?: unknown;
    placeTag?: unknown;
    tags?: unknown;
    tagPlace?: unknown;
    placeTags?: unknown;
    showFolderPicker?: unknown;
    sources?: unknown;
  }>({
    label: "ai-chat",
    path: "/ai-chat",
    method: "POST",
    headers,
    body: {
      messages,
      folder: opts.folder,
      folderId: opts.folderId ?? undefined,
      mode: opts.mode ?? "tourist",
      communityId: opts.communityId ?? undefined,
      placeId: opts.placeId ?? undefined,
      placeName: opts.placeName ?? undefined,
      clipContext: opts.clipContext ?? undefined,
      tripDraft: opts.tripDraft ?? undefined,
      planContext: opts.planContext ?? undefined,
      discoveryDismissed: opts.discoveryDismissed ? true : undefined,
    },
    timeoutMs: API_TIMEOUT_MS * 3,
  });
  if (typeof data?.reply !== "string") {
    // 2xx but the payload isn't what we expect — record it rather than guess.
    throw new AiError({
      kind: "bad-shape",
      status: 200,
      body: JSON.stringify(data ?? null),
      requestId: null,
      label: "ai-chat",
      url: "",
      durationMs: 0,
      timeoutMs: API_TIMEOUT_MS * 3,
    });
  }
  const placeCandidates = parsePlaceCandidates(data.placeCandidates);
  const tripDraft = parseTripDraft(data.tripDraft);
  const placeTag = parsePlaceTag(data.placeTag);
  const tags = parseTopicTags(data.tags);
  const tagPlace = parseTagPlace(data.tagPlace);
  const sources = parseSources(data.sources);
  const placeTags = Array.isArray(data.placeTags)
    ? (data.placeTags as any[])
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .map((p) => ({
          name: String(p.name).trim(),
          placeTag: parsePlaceTag(p.placeTag),
          tags: parseTopicTags(p.tags),
        }))
    : undefined;
  const showFolderPicker = data.showFolderPicker === true;
  return {
    reply: data.reply,
    ...(placeCandidates ? { placeCandidates } : {}),
    ...(tripDraft ? { tripDraft } : {}),
    ...(placeTag ? { placeTag } : {}),
    ...(tags ? { tags } : {}),
    ...(tagPlace ? { tagPlace } : {}),
    ...(sources ? { sources } : {}),
    ...(placeTags && placeTags.length > 0 ? { placeTags } : {}),
    ...(showFolderPicker ? { showFolderPicker: true } : {}),
  };
}