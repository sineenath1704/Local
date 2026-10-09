import { PlaceItem } from "./thailandGeographicData";
import rawPosts from "./homeFeedPosts.json";

/**
 * Home feed data layer.
 * -------------------------------------------------------------
 * Editable post text/numbers live in `homeFeedPosts.json` (easy to scan & edit).
 * Binary assets (video / images) can't live in JSON, so they're mapped here by key.
 */

// ---- Media assets ----
/** Map a string key (used in JSON) to a bundled video asset. */
const VIDEO_ASSETS: Record<string, any> = {
  huai_hom: require("../../assets/Video/บ้านห้วยห้อม.mp4"),
  ja_bo: require("../../assets/Video/บ้านจ่าโบ.mp4"),
};

/** Default video used when a post doesn't specify a videoKey. */
export const FEED_VIDEO_SOURCE = VIDEO_ASSETS.huai_hom;

function resolveVideo(key?: string): any {
  return (key && VIDEO_ASSETS[key]) || FEED_VIDEO_SOURCE;
}

/** Map a string key (used in JSON) to a bundled image asset. */
const IMAGE_ASSETS: Record<string, any> = {
  persona_pa_somsri: require("../../assets/persona_pa_somsri.jpg"),
  persona_art: require("../../assets/persona_art.jpg"),
  card_persona_pa_somsri: require("../../assets/card_persona_pa_somsri.jpg"),
  card_persona_art: require("../../assets/card_persona_art.jpg"),
};

function resolveImage(key: string): any {
  return IMAGE_ASSETS[key] ?? IMAGE_ASSETS.persona_pa_somsri;
}

// ---- Types ----
export interface VideoPost {
  id: string;
  authorId: string; // links to a profile in profilesData
  videoSource: any;
  poster: any;
  author: {
    name: string;
    handle: string;
    avatar: any;
  };
  location: {
    village: string;
    district: string;
    province: string;
  };
  caption: string;
  hashtags: string[];
  booking: {
    roomsText: string;
    price: number;
  };
  initialLikes: number;
  initialComments: number;
  initialSaves: number;
  initialShares: number;
  initialLiked: boolean;
  initialSaved: boolean;
}

/** Shape of each entry in homeFeedPosts.json (assets referenced by key). */
interface RawVideoPost {
  id: string;
  authorId: string;
  videoKey?: string;
  posterKey: string;
  author: { name: string; handle: string; avatarKey: string };
  location: { village: string; district: string; province: string };
  caption: string;
  hashtags: string[];
  booking: { roomsText: string; price: number };
  initialLikes: number;
  initialComments: number;
  initialSaves: number;
  initialShares: number;
  initialLiked: boolean;
  initialSaved: boolean;
}

/** Fully-resolved posts (JSON text + bundled assets). */
export const HOME_FEED_POSTS: VideoPost[] = (rawPosts as RawVideoPost[]).map((p) => ({
  id: p.id,
  authorId: p.authorId,
  videoSource: resolveVideo(p.videoKey),
  poster: resolveImage(p.posterKey),
  author: {
    name: p.author.name,
    handle: p.author.handle,
    avatar: resolveImage(p.author.avatarKey),
  },
  location: p.location,
  caption: p.caption,
  hashtags: p.hashtags,
  booking: p.booking,
  initialLikes: p.initialLikes,
  initialComments: p.initialComments,
  initialSaves: p.initialSaves,
  initialShares: p.initialShares,
  initialLiked: p.initialLiked,
  initialSaved: p.initialSaved,
}));

/**
 * Build a tailored feed post for a place chosen on the map,
 * so the Home feed can lead with that community's video.
 */
export function buildPlaceFeedPost(place: PlaceItem): VideoPost {
  const safeName = place.name.replace(/[\s.]+/g, "_");
  const tagName = place.name.replace(/[\s.]+/g, "");
  return {
    id: `place-${place.id}`,
    authorId: "user-pasomsri",
    videoSource: FEED_VIDEO_SOURCE,
    poster: IMAGE_ASSETS.persona_pa_somsri,
    author: {
      name: `ชุมชน${place.name}`,
      handle: `@${safeName}`,
      avatar: IMAGE_ASSETS.card_persona_pa_somsri,
    },
    location: {
      village: place.name,
      district: `อ.${place.districtName}`,
      province: place.provinceName,
    },
    caption:
      place.highlight ||
      `ยินดีต้อนรับสู่ ${place.name} สัมผัสวิถีชีวิต ผลิตภัณฑ์ OTOP และอาหารพื้นถิ่น 🌿✨`,
    hashtags: [`#${tagName}`, `#${place.provinceName}`, "#OTOP", "#Local"],
    booking: {
      roomsText: "เปิดรับนักท่องเที่ยว",
      price: 490,
    },
    initialLikes: 1420,
    initialComments: 312,
    initialSaves: 890,
    initialShares: 245,
    initialLiked: false,
    initialSaved: false,
  };
}
