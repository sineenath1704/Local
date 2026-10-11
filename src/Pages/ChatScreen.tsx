import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BellIcon,
  UserGroupIcon,
  PlusIcon,
  HeartIcon,
  ChatBubbleOvalLeftIcon,
  UserPlusIcon,
  SparklesIcon,
} from "react-native-heroicons/outline";
import { useMemo } from "react";
import { useChat } from "../state/ChatContext";
import ChatRoom from "../components/ChatRoom";
import ChatClipViewer from "../components/ChatClipViewer";
import CreateGroupSheet from "../components/CreateGroupSheet";
import {
  AppNotification,
  ChatMessage,
  friendAvatar,
  getFriend,
  ME_ID,
} from "../data/chatData";
import { getPostById, VideoPost } from "../data/homeFeedData";

type ChatTab = "notifications" | "chats";

/** A unified row for the merged chat list (direct + group). */
type Conversation =
  | { kind: "direct"; id: string; friendId: string; name: string; avatar: any | null; messages: ChatMessage[]; lastAt: number }
  | { kind: "group"; id: string; name: string; memberIds: string[]; messages: ChatMessage[]; lastAt: number };

/** Resolve the clips shared in a conversation, in order, to full posts. */
function sharedClipsOf(messages: ChatMessage[]): VideoPost[] {
  const out: VideoPost[] = [];
  for (const m of messages) {
    if (m.sharedVideoId) {
      const post = getPostById(m.sharedVideoId);
      if (post) out.push(post);
    }
  }
  return out;
}

/** Icon per notification type. */
function NotiIcon({ type }: { type: AppNotification["type"] }) {
  const common = { size: 15, color: "#FFFFFF" } as const;
  const bg =
    type === "like" ? "bg-red-500" :
    type === "follow" ? "bg-blue-500" :
    type === "comment" ? "bg-emerald-500" :
    type === "share" ? "bg-amber-500" : "bg-gray-400";
  return (
    <View className={`w-6 h-6 rounded-full items-center justify-center ${bg}`}>
      {type === "like" ? <HeartIcon {...common} /> :
       type === "follow" ? <UserPlusIcon {...common} /> :
       type === "comment" ? <ChatBubbleOvalLeftIcon {...common} /> :
       <SparklesIcon {...common} />}
    </View>
  );
}

function Avatar({ avatar, name, size = 52 }: { avatar: any | null; name: string; size?: number }) {
  if (avatar) return <Image source={avatar} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="bg-emerald-100 items-center justify-center">
      <Text className="text-[#2D6A4F] font-bold text-lg">{name.trim().charAt(0)}</Text>
    </View>
  );
}

interface ChatScreenProps {
  /** Notifies the host when a full-screen chat room opens/closes. */
  onRoomOpenChange?: (open: boolean) => void;
}

export default function ChatScreen({ onRoomOpenChange }: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const {
    notifications,
    directChats,
    groupChats,
    unreadNotifications,
    markAllNotificationsRead,
    sendDirectMessage,
    createGroup,
    addGroupMembers,
    sendGroupMessage,
  } = useChat();

  const [tab, setTab] = useState<ChatTab>("chats");
  const [openDirectFriendId, setOpenDirectFriendId] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [addMembersGroupId, setAddMembersGroupId] = useState<string | null>(null);
  // Clip viewer: which conversation's clips + the index to start at.
  const [clipViewer, setClipViewer] = useState<
    { clips: VideoPost[]; index: number; title: string } | null
  >(null);

  // Merge direct + group chats into one list, newest activity first.
  const conversations = useMemo<Conversation[]>(() => {
    const directs: Conversation[] = directChats.map((c) => {
      const f = getFriend(c.friendId);
      return {
        kind: "direct",
        id: c.id,
        friendId: c.friendId,
        name: f?.name ?? "ผู้ใช้",
        avatar: f?.avatar ?? friendAvatar(c.friendId),
        messages: c.messages,
        lastAt: c.messages[c.messages.length - 1]?.at ?? 0,
      };
    });
    const groups: Conversation[] = groupChats.map((g) => ({
      kind: "group",
      id: g.id,
      name: g.name,
      memberIds: g.memberIds,
      messages: g.messages,
      lastAt: g.messages[g.messages.length - 1]?.at ?? 0,
    }));
    return [...directs, ...groups].sort((a, b) => b.lastAt - a.lastAt);
  }, [directChats, groupChats]);

  // Tell the host whether a full-screen view is open (hides the bottom bar).
  React.useEffect(() => {
    onRoomOpenChange?.(
      openDirectFriendId !== null || openGroupId !== null || clipViewer !== null
    );
  }, [openDirectFriendId, openGroupId, clipViewer, onRoomOpenChange]);

  // Open the clip viewer for the clip the user tapped inside a conversation.
  const openClipFromMessages = (messages: ChatMessage[], videoId: string, title: string) => {
    const clips = sharedClipsOf(messages);
    const index = clips.findIndex((c) => c.id === videoId);
    if (clips.length === 0 || index < 0) return; // clip not resolvable (e.g. Supabase upload)
    setClipViewer({ clips, index, title });
  };

  // ---- Full-screen clip viewer (clips shared in the open conversation) ----
  if (clipViewer) {
    return (
      <ChatClipViewer
        clips={clipViewer.clips}
        initialIndex={clipViewer.index}
        title={clipViewer.title}
        onClose={() => setClipViewer(null)}
      />
    );
  }

  // ---- Open a direct chat room ----
  if (openDirectFriendId) {
    const chat = directChats.find((c) => c.friendId === openDirectFriendId);
    const friend = getFriend(openDirectFriendId);
    return (
      <ChatRoom
        title={friend?.name ?? "แชท"}
        subtitle={friend?.username}
        avatar={friend?.avatar ?? null}
        messages={chat?.messages ?? []}
        onSend={(text) => sendDirectMessage(openDirectFriendId, text)}
        onBack={() => setOpenDirectFriendId(null)}
        onOpenClip={(videoId) =>
          openClipFromMessages(chat?.messages ?? [], videoId, friend?.name ?? "แชท")
        }
      />
    );
  }

  // ---- Open a group chat room ----
  if (openGroupId) {
    const group = groupChats.find((g) => g.id === openGroupId);
    return (
      <>
        <ChatRoom
          title={group?.name ?? "กลุ่ม"}
          subtitle={`${group?.memberIds.length ?? 0} สมาชิก`}
          isGroup
          messages={group?.messages ?? []}
          onSend={(text) => sendGroupMessage(openGroupId, text)}
          onBack={() => setOpenGroupId(null)}
          onAddMembers={() => setAddMembersGroupId(openGroupId)}
          onOpenClip={(videoId) =>
            openClipFromMessages(group?.messages ?? [], videoId, group?.name ?? "กลุ่ม")
          }
        />
        <CreateGroupSheet
          visible={addMembersGroupId === openGroupId}
          mode="addMembers"
          existingMemberIds={group?.memberIds ?? []}
          onClose={() => setAddMembersGroupId(null)}
          onAddMembers={(ids) => addGroupMembers(openGroupId, ids)}
        />
      </>
    );
  }

  const lastText = (msgs: { text?: string; sharedVideoId?: string; senderId: string }[]) => {
    const m = msgs[msgs.length - 1];
    if (!m) return "ยังไม่มีข้อความ";
    const prefix = m.senderId === ME_ID ? "คุณ: " : "";
    return prefix + (m.sharedVideoId ? "📹 แชร์คลิปวิดีโอ" : m.text ?? "");
  };

  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 16) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-5 pb-2 flex-row items-center justify-between"
      >
        <Text className="text-2xl font-black text-gray-900">กล่องข้อความ</Text>
        {tab === "chats" && (
          <TouchableOpacity
            onPress={() => setShowCreateGroup(true)}
            activeOpacity={0.8}
            className="flex-row items-center bg-[#2D6A4F] px-3 py-2 rounded-full"
          >
            <PlusIcon size={16} color="#FFFFFF" strokeWidth={2.5} />
            <Text className="text-white text-[12px] font-bold ml-1">สร้างกลุ่ม</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View className="flex-row px-3 border-b border-gray-100">
        {([
          ["notifications", "แจ้งเตือน", <BellIcon key="b" size={16} />],
          ["chats", "แชท", <ChatBubbleOvalLeftIcon key="c" size={16} />],
        ] as const).map(([key, label]) => {
          const active = tab === key;
          const showBadge = key === "notifications" && unreadNotifications > 0;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => {
                setTab(key);
                if (key === "notifications") markAllNotificationsRead();
              }}
              activeOpacity={0.7}
              className={`flex-1 py-3 items-center flex-row justify-center border-b-2 ${
                active ? "border-[#2D6A4F]" : "border-transparent"
              }`}
            >
              <Text className={`text-[13px] ${active ? "font-bold text-[#2D6A4F]" : "font-medium text-gray-500"}`}>
                {label}
              </Text>
              {showBadge && (
                <View className="ml-1.5 bg-red-500 rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center">
                  <Text className="text-white text-[10px] font-bold">{unreadNotifications}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ---- Notifications tab ---- */}
      {tab === "notifications" && (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <View className={`flex-row items-center px-5 py-3 ${item.unread ? "bg-emerald-50/40" : ""}`}>
              <View className="relative mr-3">
                <Avatar avatar={item.avatar} name={item.actorName} size={46} />
                <View className="absolute -bottom-1 -right-1">
                  <NotiIcon type={item.type} />
                </View>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 text-[13px] leading-5">
                  <Text className="font-bold">{item.actorName}</Text> {item.text}
                </Text>
                <Text className="text-gray-400 text-[11px] mt-0.5">{item.timeAgo}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View className="py-20 items-center">
              <Text className="text-gray-400 text-sm">ยังไม่มีการแจ้งเตือน</Text>
            </View>
          }
        />
      )}

      {/* ---- Unified chats tab (direct + group together) ---- */}
      {tab === "chats" && (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 100 }}
          renderItem={({ item }) => {
            const hasClips = item.messages.some((m) => m.sharedVideoId);
            return (
              <TouchableOpacity
                onPress={() =>
                  item.kind === "direct"
                    ? setOpenDirectFriendId(item.friendId)
                    : setOpenGroupId(item.id)
                }
                activeOpacity={0.7}
                className="flex-row items-center px-5 py-3"
              >
                {/* Avatar — person for direct, group icon for group */}
                {item.kind === "group" ? (
                  <View className="w-[52px] h-[52px] rounded-full bg-emerald-100 items-center justify-center">
                    <UserGroupIcon size={24} color="#2D6A4F" />
                  </View>
                ) : (
                  <Avatar avatar={item.avatar} name={item.name} />
                )}

                <View className="flex-1 ml-3">
                  <View className="flex-row items-center">
                    <Text className="text-gray-900 font-bold text-[14px]" numberOfLines={1}>
                      {item.name}
                    </Text>
                    {/* Small type tag so direct vs group is never confusing */}
                    {item.kind === "group" && (
                      <View className="ml-2 flex-row items-center bg-emerald-50 rounded-full px-2 py-0.5">
                        <UserGroupIcon size={10} color="#2D6A4F" />
                        <Text className="text-[#2D6A4F] text-[10px] font-semibold ml-0.5">
                          {item.memberIds.length}
                        </Text>
                      </View>
                    )}
                    {hasClips && <Text className="ml-1.5 text-[11px]">📹</Text>}
                  </View>
                  <Text className="text-gray-500 text-[12px] mt-0.5" numberOfLines={1}>
                    {lastText(item.messages)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="py-20 items-center px-10">
              <ChatBubbleOvalLeftIcon size={40} color="#D1D5DB" />
              <Text className="text-gray-400 text-sm text-center mt-3">
                ยังไม่มีแชท แชร์คลิปจากหน้าหลักให้เพื่อน หรือกดปุ่ม "สร้างกลุ่ม" เพื่อเริ่มคุยกัน
              </Text>
            </View>
          }
        />
      )}

      {/* Create group sheet */}
      <CreateGroupSheet
        visible={showCreateGroup}
        mode="create"
        onClose={() => setShowCreateGroup(false)}
        onCreate={(name, ids) => {
          const id = createGroup(name, ids);
          setShowCreateGroup(false);
          setOpenGroupId(id);
        }}
      />
    </View>
  );
}
