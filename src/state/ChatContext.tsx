import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import {
  AppNotification,
  DirectChat,
  GroupChat,
  ChatMessage,
  ME_ID,
  SEED_NOTIFICATIONS,
  SEED_DIRECT_CHATS,
  SEED_GROUP_CHATS,
} from "../data/chatData";
import { useInteractions } from "./InteractionContext";

/**
 * ChatContext — messaging state (notifications, DMs, groups).
 * -------------------------------------------------------------
 * Seeded from chatData.json, then grows from REAL actions:
 *   • sending text in a chat
 *   • creating a group + adding members
 *   • videos shared from the feed (ingested from InteractionContext.chatShares)
 */

interface ChatState {
  notifications: AppNotification[];
  directChats: DirectChat[];
  groupChats: GroupChat[];

  unreadNotifications: number;

  // notifications
  markAllNotificationsRead: () => void;

  // direct chats
  ensureDirectChat: (friendId: string) => string; // returns chat id
  sendDirectMessage: (friendId: string, text: string) => void;

  // group chats
  createGroup: (name: string, memberIds: string[]) => string; // returns group id
  addGroupMembers: (groupId: string, memberIds: string[]) => void;
  sendGroupMessage: (groupId: string, text: string) => void;
}

const ChatContext = createContext<ChatState | null>(null);

let msgSeq = 0;
function nextMsgId(): string {
  msgSeq += 1;
  return `msg-${Date.now()}-${msgSeq}`;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { chatShares } = useInteractions();

  const [notifications, setNotifications] = useState<AppNotification[]>(SEED_NOTIFICATIONS);
  const [directChats, setDirectChats] = useState<DirectChat[]>(SEED_DIRECT_CHATS);
  const [groupChats, setGroupChats] = useState<GroupChat[]>(SEED_GROUP_CHATS);

  // Track which shares we've already turned into chat messages (avoid dupes).
  const [ingestedShareIds, setIngestedShareIds] = useState<string[]>([]);

  // Ingest videos shared from the feed → append as messages into the DM.
  useEffect(() => {
    const pending = chatShares.filter((s) => !ingestedShareIds.includes(s.id));
    if (pending.length === 0) return;

    setDirectChats((prev) => {
      let next = prev;
      for (const share of pending) {
        const chatIdx = next.findIndex((c) => c.friendId === share.friendId);
        const msg: ChatMessage = {
          id: nextMsgId(),
          senderId: ME_ID,
          sharedVideoId: share.videoId,
          at: share.at,
        };
        if (chatIdx >= 0) {
          next = next.map((c, i) =>
            i === chatIdx ? { ...c, messages: [...c.messages, msg] } : c
          );
        } else {
          next = [
            ...next,
            { id: `dm-${share.friendId}`, friendId: share.friendId, messages: [msg] },
          ];
        }
      }
      return next;
    });

    setIngestedShareIds((prev) => [...prev, ...pending.map((s) => s.id)]);
  }, [chatShares, ingestedShareIds]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications]
  );

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
  }, []);

  const ensureDirectChat = useCallback((friendId: string) => {
    const id = `dm-${friendId}`;
    setDirectChats((prev) =>
      prev.some((c) => c.friendId === friendId)
        ? prev
        : [...prev, { id, friendId, messages: [] }]
    );
    return id;
  }, []);

  const sendDirectMessage = useCallback((friendId: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    setDirectChats((prev) => {
      const idx = prev.findIndex((c) => c.friendId === friendId);
      const msg: ChatMessage = { id: nextMsgId(), senderId: ME_ID, text: body, at: Date.now() };
      if (idx >= 0) {
        return prev.map((c, i) => (i === idx ? { ...c, messages: [...c.messages, msg] } : c));
      }
      return [...prev, { id: `dm-${friendId}`, friendId, messages: [msg] }];
    });
  }, []);

  const createGroup = useCallback((name: string, memberIds: string[]) => {
    const id = `grp-${Date.now()}`;
    const members = Array.from(new Set([ME_ID, ...memberIds]));
    setGroupChats((prev) => [
      ...prev,
      { id, name: name.trim() || "กลุ่มใหม่", memberIds: members, messages: [] },
    ]);
    return id;
  }, []);

  const addGroupMembers = useCallback((groupId: string, memberIds: string[]) => {
    setGroupChats((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, memberIds: Array.from(new Set([...g.memberIds, ...memberIds])) }
          : g
      )
    );
  }, []);

  const sendGroupMessage = useCallback((groupId: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    setGroupChats((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              messages: [
                ...g.messages,
                { id: nextMsgId(), senderId: ME_ID, text: body, at: Date.now() },
              ],
            }
          : g
      )
    );
  }, []);

  const value = useMemo<ChatState>(
    () => ({
      notifications,
      directChats,
      groupChats,
      unreadNotifications,
      markAllNotificationsRead,
      ensureDirectChat,
      sendDirectMessage,
      createGroup,
      addGroupMembers,
      sendGroupMessage,
    }),
    [
      notifications,
      directChats,
      groupChats,
      unreadNotifications,
      markAllNotificationsRead,
      ensureDirectChat,
      sendDirectMessage,
      createGroup,
      addGroupMembers,
      sendGroupMessage,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}
