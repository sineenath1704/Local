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
  UserIcon,
  UserGroupIcon,
  PlusIcon,
  HeartIcon,
  ChatBubbleOvalLeftIcon,
  UserPlusIcon,
  SparklesIcon,
} from "react-native-heroicons/outline";
import { useChat } from "../state/ChatContext";
import ChatRoom from "../components/ChatRoom";
import CreateGroupSheet from "../components/CreateGroupSheet";
import {
  AppNotification,
  friendAvatar,
  getFriend,
  ME_ID,
} from "../data/chatData";

type ChatTab = "notifications" | "direct" | "group";

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

  const [tab, setTab] = useState<ChatTab>("direct");
  const [openDirectFriendId, setOpenDirectFriendId] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [addMembersGroupId, setAddMembersGroupId] = useState<string | null>(null);

  // Tell the host whether a room is open (so it can hide the bottom bar)
  React.useEffect(() => {
    onRoomOpenChange?.(openDirectFriendId !== null || openGroupId !== null);
  }, [openDirectFriendId, openGroupId, onRoomOpenChange]);

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
        {tab === "group" && (
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
          ["direct", "แชทส่วนตัว", <UserIcon key="u" size={16} />],
          ["group", "แชทกลุ่ม", <UserGroupIcon key="g" size={16} />],
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

      {/* ---- Direct chats tab ---- */}
      {tab === "direct" && (
        <FlatList
          data={directChats}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 100 }}
          renderItem={({ item }) => {
            const friend = getFriend(item.friendId);
            return (
              <TouchableOpacity
                onPress={() => setOpenDirectFriendId(item.friendId)}
                activeOpacity={0.7}
                className="flex-row items-center px-5 py-3"
              >
                <Avatar avatar={friend?.avatar ?? friendAvatar(item.friendId)} name={friend?.name ?? "ผู้ใช้"} />
                <View className="flex-1 ml-3">
                  <Text className="text-gray-900 font-bold text-[14px]">{friend?.name ?? "ผู้ใช้"}</Text>
                  <Text className="text-gray-500 text-[12px]" numberOfLines={1}>
                    {lastText(item.messages)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="py-20 items-center">
              <Text className="text-gray-400 text-sm">ยังไม่มีแชทส่วนตัว</Text>
            </View>
          }
        />
      )}

      {/* ---- Group chats tab ---- */}
      {tab === "group" && (
        <FlatList
          data={groupChats}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setOpenGroupId(item.id)}
              activeOpacity={0.7}
              className="flex-row items-center px-5 py-3"
            >
              <View className="w-[52px] h-[52px] rounded-full bg-emerald-100 items-center justify-center">
                <UserGroupIcon size={24} color="#2D6A4F" />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-gray-900 font-bold text-[14px]">{item.name}</Text>
                <Text className="text-gray-400 text-[11px] mb-0.5">{item.memberIds.length} สมาชิก</Text>
                <Text className="text-gray-500 text-[12px]" numberOfLines={1}>
                  {lastText(item.messages)}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View className="py-20 items-center px-10">
              <UserGroupIcon size={40} color="#D1D5DB" />
              <Text className="text-gray-400 text-sm text-center mt-3">
                ยังไม่มีแชทกลุ่ม กดปุ่มสร้างกลุ่ม เพื่อชวนเพื่อนมาวางแผนทริปด้วยกัน
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
