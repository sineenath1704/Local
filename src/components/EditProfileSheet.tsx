import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XMarkIcon, CameraIcon } from "react-native-heroicons/outline";
import * as ImagePicker from "expo-image-picker";
import { useMyProfile } from "../state/MyProfileContext";

interface EditProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

export default function EditProfileSheet({ visible, onClose }: EditProfileSheetProps) {
  const insets = useSafeAreaInsets();
  const { name, bio, username, avatar, updateName, updateBio, updateAvatarUri } = useMyProfile();

  const [draftName, setDraftName] = useState(name);
  const [draftBio, setDraftBio] = useState(bio);
  const [draftAvatar, setDraftAvatar] = useState<any>(avatar);

  useEffect(() => {
    if (visible) {
      setDraftName(name);
      setDraftBio(bio);
      setDraftAvatar(avatar);
    }
  }, [visible, name, bio, avatar]);

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("ต้องการสิทธิ์เข้าถึงรูปภาพ", "โปรดอนุญาตให้แอปเข้าถึงคลังรูปภาพเพื่อเปลี่ยนรูปโปรไฟล์");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setDraftAvatar({ uri: result.assets[0].uri });
    }
  };

  const save = () => {
    updateName(draftName.trim() || name);
    updateBio(draftBio);
    if (draftAvatar?.uri) updateAvatarUri(draftAvatar.uri);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-black/40" />
      </TouchableWithoutFeedback>

      <View
        className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 8, maxHeight: "88%" }}
      >
        <View className="items-center pt-2.5 pb-1">
          <View className="w-10 h-1.5 rounded-full bg-gray-300" />
        </View>

        <View className="flex-row items-center justify-between px-5 pt-1 pb-3 border-b border-gray-100">
          <Text className="text-lg font-black text-gray-900">แก้ไขโปรไฟล์</Text>
          <TouchableOpacity onPress={onClose} className="p-1">
            <XMarkIcon size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
          {/* Avatar */}
          <View className="items-center mb-6">
            <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8} className="relative">
              <Image
                source={draftAvatar}
                style={{ width: 110, height: 110, borderRadius: 55 }}
                className="bg-gray-100 border border-gray-200"
                resizeMode="cover"
              />
              <View className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-[#2D6A4F] items-center justify-center border-2 border-white">
                <CameraIcon size={18} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
            <Text className="text-gray-400 text-[12px] mt-2">แตะเพื่อเปลี่ยนรูปจากคลังภาพ</Text>
          </View>

          {/* Name (editable) */}
          <Text className="text-gray-700 font-bold text-[13px] mb-1.5">ชื่อ</Text>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="ชื่อโปรไฟล์"
            placeholderTextColor="#9CA3AF"
            className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-4"
          />

          {/* Username (read-only) */}
          <Text className="text-gray-700 font-bold text-[13px] mb-1.5">
            ชื่อผู้ใช้ <Text className="text-gray-400 font-normal">(แก้ไขไม่ได้)</Text>
          </Text>
          <View className="bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-3 mb-4">
            <Text className="text-[14px] text-gray-400">{username}</Text>
          </View>

          {/* Bio (editable) */}
          <Text className="text-gray-700 font-bold text-[13px] mb-1.5">คำบรรยายใต้ชื่อ</Text>
          <TextInput
            value={draftBio}
            onChangeText={setDraftBio}
            placeholder="เล่าเกี่ยวกับคุณหรือชุมชนของคุณ..."
            placeholderTextColor="#9CA3AF"
            multiline
            className="bg-gray-100 rounded-xl px-3.5 py-3 text-[14px] text-gray-900 mb-6"
            style={{ minHeight: 80, textAlignVertical: "top" }}
          />

          <TouchableOpacity
            onPress={save}
            activeOpacity={0.85}
            className="bg-[#2D6A4F] py-3.5 rounded-2xl items-center"
          >
            <Text className="text-white font-bold text-[15px]">บันทึก</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}
