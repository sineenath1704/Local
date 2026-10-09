import rawChat from "./chatData.json";
import { FRIENDS, Friend } from "./socialData";
import { resolveProfileImage } from "./profilesData";

/**
 * Chat data layer — notifications, direct chats, group chats.
 * -------------------------------------------------------------
 * Editable seed content lives in `chatData.json`.
 * New messages / groups / shared-video messages are produced by REAL actions
 * and held in ChatContext (not mocked).
 */

export const ME_ID = "me";

// ---- Types ----
export type NotificationType = "follow" | "like" | "comment" | "system" | "share";

export interface AppNotification {
  id: string;
  type: NotificationType;
  actorName: string;
  avatarKey?: string;
  avatar: any | null;
  text: string;
  timeAgo: string;
  unread: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string; // "me" or a friend id
  text?: string;
  /** When the message is a shared video from the feed. */
  sharedVideoId?: string;
  at: number;
}

export interface DirectChat {
  id: string;
  friendId: string;
  messages: ChatMessage[];
}

export interface GroupChat {
  id: string;
  name: string;
  memberIds: string[]; // includes "me"
  messages: ChatMessage[];
}

// ---- Raw shapes ----
interface RawNotification {
  id: string;
  type: NotificationType;
  actorName: string;
  avatarKey?: string;
  text: string;
  timeAgo: string;
  unread: boolean;
}

export const SEED_NOTIFICATIONS: AppNotification[] = (
  rawChat.notifications as RawNotification[]
).map((n) => ({
  ...n,
  avatar: resolveProfileImage(n.avatarKey),
}));

export const SEED_DIRECT_CHATS: DirectChat[] = rawChat.directChats as DirectChat[];
export const SEED_GROUP_CHATS: GroupChat[] = rawChat.groupChats as GroupChat[];

// ---- Lookups ----
const FRIEND_BY_ID = new Map(FRIENDS.map((f) => [f.id, f]));

export function getFriend(friendId: string): Friend | undefined {
  return FRIEND_BY_ID.get(friendId);
}

export function friendName(friendId: string): string {
  if (friendId === ME_ID) return "คุณ";
  return getFriend(friendId)?.name ?? "ผู้ใช้";
}

export function friendAvatar(friendId: string): any | null {
  if (friendId === ME_ID) return null;
  return getFriend(friendId)?.avatar ?? null;
}

export { FRIENDS } from "./socialData";
export type { Friend } from "./socialData";
