import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  FlatList,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XMarkIcon, UserGroupIcon, CheckCircleIcon } from "react-native-heroicons/outline";
import { CheckCircleIcon as CheckSolid } from "react-native-heroicons/solid";
import { FRIENDS } from "../data/socialData";

interface CreateGroupSheetProps {
  visible: boolean;
  /** When set, we're ADDING members to an existing group (hide the name field). */
  mode: "create" | "addMembers";
  existingMemberIds?: string[];
  onClose: () => void;
  onCreate?: (name: string, memberIds: string[]) => void;
  onAddMembers?: (memberIds: string[]) => void;
}

function Avatar({ avatar, name }: { avatar: any | null; name: string }) {
  if (avatar) return <Image source={avatar} style={{ width: 44, height: 44, borderRadius: 22 }} />;
  return (
    <View className="w-11 h-11 rounded-full bg-emerald-100 items-center justify-center">
      <Text className="text-[#2D6A4F] font-bold">{name.trim().charAt(0)}</Text>
    </View>
  );
}

export default function CreateGroupSheet({
  visible,
  mode,
  existingMemberIds = [],
  onClose,
  onCreate,
  onAddMembers,
}: CreateGroupSheetProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setName("");
      setSelected([]);
    }
  }, [visible]);

  // In addMembers mode, friends already in the group can't be re-added.
  const selectable = FRIENDS.filter((f) => !existingMemberIds.includes(f.id));

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canSubmit =
    mode === "create" ? name.trim().length > 0 && selected.length > 0 : selected.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "create") onCreate?.(name.trim(), selected);
    else onAddMembers?.(selected);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-black/40" />
      </TouchableWithoutFeedback>

      <View
        className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 8, maxHeight: "82%" }}
      >
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-gray-300" />
        </View>

        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-1 pb-3 border-b border-gray-100">
          <View className="flex-row items-center">
            <UserGroupIcon size={20} color="#2D6A4F" />
            <Text className="text-lg font-black text-gray-900 ml-2">
              {mode === "create" ? "สร้างแชทกลุ่ม" : "เพิ่มสมาชิก"}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} className="p-1">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* Group name (create mode only) */}
        {mode === "create" && (
          <View className="px-5 pt-3">
            <Text className="text-gray-500 text-[12px] mb-1.5">ชื่อกลุ่ม</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="เช่น ทริปเชียงใหม่ 2026"
              placeholderTextColor="#9CA3AF"
              className="bg-gray-100 rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900"
            />
          </View>
        )}

        {/* Members picker */}
        <Text className="text-gray-400 text-[11px] font-bold px-5 pt-4 pb-1 uppercase">
          เลือกเพื่อน ({selected.length})
        </Text>
        <FlatList
          data={selectable}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => {
            const picked = selected.includes(item.id);
            return (
              <TouchableOpacity
                onPress={() => toggle(item.id)}
                activeOpacity={0.7}
                className="flex-row items-center px-5 py-2.5"
              >
                <Avatar avatar={item.avatar} name={item.name} />
                <View className="flex-1 ml-3">
                  <Text className="text-gray-900 font-semibold text-[14px]">{item.name}</Text>
                  <Text className="text-gray-400 text-[11px]">{item.username}</Text>
                </View>
                {picked ? (
                  <CheckSolid size={24} color="#00D26A" />
                ) : (
                  <CheckCircleIcon size={24} color="#D1D5DB" />
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="px-5 py-6">
              <Text className="text-gray-400 text-[13px]">เพื่อนทุกคนอยู่ในกลุ่มแล้ว</Text>
            </View>
          }
        />

        {/* Submit */}
        <View className="px-5 pt-2">
          <TouchableOpacity
            onPress={submit}
            disabled={!canSubmit}
            activeOpacity={0.85}
            className={`py-3.5 rounded-2xl items-center ${canSubmit ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
          >
            <Text className={`font-bold text-[15px] ${canSubmit ? "text-white" : "text-gray-400"}`}>
              {mode === "create" ? "สร้างกลุ่ม" : "เพิ่มเข้ากลุ่ม"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
