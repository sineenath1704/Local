import rawProfiles from "./profilesData.json";

/**
 * Profiles data layer (tourist + community users).
 * -------------------------------------------------------------
 * Editable profile content lives in `profilesData.json`.
 * Binary assets (avatar / video) are referenced by key and mapped here.
 *
 * Likes / followers / etc. that depend on USER ACTIONS are NOT stored here —
 * those live in the InteractionContext and are derived from real taps.
 * `followersBase` is only the starting follower count shown on a profile.
 */

// ---- Asset maps ----
const VIDEO_ASSETS: Record<string, any> = {
  huai_hom: require("../../assets/Video/บ้านห้วยห้อม.mp4"),
  ja_bo: require("../../assets/Video/บ้านจ่าโบ.mp4"),
};

const IMAGE_ASSETS: Record<string, any> = {
  persona_pa_somsri: require("../../assets/persona_pa_somsri.jpg"),
  persona_art: require("../../assets/persona_art.jpg"),
  card_persona_pa_somsri: require("../../assets/card_persona_pa_somsri.jpg"),
  card_persona_art: require("../../assets/card_persona_art.jpg"),
};

export function resolveProfileImage(key?: string): any | null {
  if (!key || key === "generic") return null;
  return IMAGE_ASSETS[key] ?? null;
}

function resolveVideo(key?: string): any {
  return (key && VIDEO_ASSETS[key]) || VIDEO_ASSETS.huai_hom;
}

// ---- Types ----
export type ProfileKind = "tourist" | "community";

export interface RegisteredCommunityInfo {
  smceCode?: string;
  presidentName?: string;
  phone?: string;
  address?: string;
  carryingCapacity?: string;
  pricingCeiling?: string;
  category?: string;
  verifiedStatus?: boolean;
  registeredDate?: string;
}

export interface CommunityBusiness {
  aboutText: string;
  openHours: string;
  services: string[];
  contactLine: string;
}

export interface CommunityInfo {
  provinceName: string;
  districtName: string;
  mapLabel: string;
  registeredInfo: RegisteredCommunityInfo;
  business: CommunityBusiness;
}

/** A video owned by a profile (shown in the profile grid). */
export interface ProfileVideo {
  id: string;
  ownerId: string;
  title: string;
  thumbnail: any;
  videoSource: any;
  views: string;
  baseLikes: number; // starting like count (real taps add on top via context)
}

export interface UserProfile {
  id: string;
  kind: ProfileKind;
  name: string;
  username: string;
  avatar: any | null;
  avatarKey?: string;
  bio: string;
  location: string;
  followersBase: number;
  community?: CommunityInfo;
  videos: ProfileVideo[];
}

// ---- Raw shapes (from JSON) ----
interface RawProfile {
  id: string;
  kind: ProfileKind;
  name: string;
  username: string;
  avatarKey?: string;
  bio: string;
  location: string;
  followersBase: number;
  community?: CommunityInfo;
  videoKeys: string[];
}

const AVATAR_THUMBS = ["persona_pa_somsri", "persona_art", "card_persona_pa_somsri", "card_persona_art"];

function buildProfile(raw: RawProfile): UserProfile {
  const videos: ProfileVideo[] = raw.videoKeys.map((vKey, i) => ({
    id: `${raw.id}-vid-${i + 1}`,
    ownerId: raw.id,
    title: `คลิป ${i + 1} ของ ${raw.name}`,
    thumbnail: IMAGE_ASSETS[AVATAR_THUMBS[i % AVATAR_THUMBS.length]],
    videoSource: resolveVideo(vKey),
    views: "1K",
    // No mock likes — counts start at 0 and grow only from real taps.
    baseLikes: 0,
  }));

  return {
    id: raw.id,
    kind: raw.kind,
    name: raw.name,
    username: raw.username,
    avatar: resolveProfileImage(raw.avatarKey),
    avatarKey: raw.avatarKey,
    bio: raw.bio,
    location: raw.location,
    // No mock followers — count starts at 0 and grows only from real follows.
    followersBase: 0,
    community: raw.community,
    videos,
  };
}

export const USER_PROFILES: UserProfile[] = (rawProfiles.profiles as RawProfile[]).map(buildProfile);

const PROFILE_BY_ID = new Map(USER_PROFILES.map((p) => [p.id, p]));

export function getProfileById(id: string): UserProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

/** All videos across all profiles, keyed by videoId (for lookups by the feed). */
export const ALL_PROFILE_VIDEOS: ProfileVideo[] = USER_PROFILES.flatMap((p) => p.videos);

export function getVideoById(videoId: string): ProfileVideo | undefined {
  return ALL_PROFILE_VIDEOS.find((v) => v.id === videoId);
}
