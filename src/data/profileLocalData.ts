import rawProfile from "./profileLocalData.json";

/**
 * ProfileLocal (current user) data layer.
 * -------------------------------------------------------------
 * Editable seed (name/bio/avatar) + registration info live in
 * profileLocalData.json. Binary assets are referenced by key and mapped here.
 *
 * Mutable state (edited name/bio/avatar, owned-video captions, deletions)
 * lives in MyProfileContext — this file only provides the initial seed.
 */

// ---- Asset maps ----
const IMAGE_ASSETS: Record<string, any> = {
  persona_pa_somsri: require("../../assets/persona_pa_somsri.jpg"),
  persona_art: require("../../assets/persona_art.jpg"),
  card_persona_pa_somsri: require("../../assets/card_persona_pa_somsri.jpg"),
  card_persona_art: require("../../assets/card_persona_art.jpg"),
};

const VIDEO_ASSETS: Record<string, any> = {
  huai_hom: require("../../assets/Video/บ้านห้วยห้อม.mp4"),
  ja_bo: require("../../assets/Video/บ้านจ่าโบ.mp4"),
};

export function resolveProfileImage(key?: string): any {
  return (key && IMAGE_ASSETS[key]) || IMAGE_ASSETS.persona_pa_somsri;
}
export function resolveProfileVideo(key?: string): any {
  return (key && VIDEO_ASSETS[key]) || VIDEO_ASSETS.huai_hom;
}

// ---- Types ----
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

/** A video the current user owns (editable caption, deletable). */
export interface MyVideo {
  id: string;
  caption: string;
  thumbnail: any;
  videoSource: any;
  views: string;
}

/** Generic grid item (used for saved/liked tabs too). */
export interface VideoItemData {
  id: string;
  title: string;
  thumbnail: any;
  videoSource?: any;
  views: string;
  likesCount?: number;
}

/** Static profile seed (editable fields get copied into MyProfileContext). */
export interface ProfileLocalSeed {
  location: string;
  name: string;
  username: string;
  bio: string;
  avatar: any;
  registeredInfo: RegisteredCommunityInfo;
  ownedVideos: MyVideo[];
}

// ---- Raw shapes ----
interface RawOwnedVideo {
  id: string;
  videoKey: string;
  thumbKey: string;
  caption: string;
  views: string;
}

const raw = rawProfile as {
  profile: { location: string; name: string; username: string; bio: string; avatarKey: string };
  registeredInfo: RegisteredCommunityInfo;
  ownedVideos: RawOwnedVideo[];
};

export const PROFILE_LOCAL_SEED: ProfileLocalSeed = {
  location: raw.profile.location,
  name: raw.profile.name,
  username: raw.profile.username,
  bio: raw.profile.bio,
  avatar: resolveProfileImage(raw.profile.avatarKey),
  registeredInfo: raw.registeredInfo,
  ownedVideos: raw.ownedVideos.map((v) => ({
    id: v.id,
    caption: v.caption,
    thumbnail: resolveProfileImage(v.thumbKey),
    videoSource: resolveProfileVideo(v.videoKey),
    views: v.views,
  })),
};
