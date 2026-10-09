import rawSocial from "./socialData.json";
import { resolveProfileImage } from "./profilesData";

/**
 * Social data layer — friends/people for the Share sheet, and chat routing.
 * Chat messages themselves are produced by real "share to chat" actions
 * (stored in InteractionContext), not mocked here.
 */

export interface Friend {
  id: string;
  name: string;
  username: string;
  avatarKey?: string;
  avatar: any | null;
}

interface RawFriend {
  id: string;
  name: string;
  username: string;
  avatarKey?: string;
}

export const FRIENDS: Friend[] = (rawSocial.friends as RawFriend[]).map((f) => ({
  id: f.id,
  name: f.name,
  username: f.username,
  avatarKey: f.avatarKey,
  avatar: resolveProfileImage(f.avatarKey),
}));
