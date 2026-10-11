import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import {
  CheckCircleIcon,
  XCircleIcon,
  CameraIcon,
  ArrowRightIcon,
} from "react-native-heroicons/outline";
import { useAuth } from "../../state/AuthContext";

/**
 * OnboardingScreen — shown once after a first Google sign-in, before the app.
 * Step 1: pick a unique username.
 * Step 2: display name + phone + avatar → save → done.
 */
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { isUsernameAvailable, completeOnboarding } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);

  const [username, setUsername] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const normalized = username.trim().toLowerCase();
  const validFormat = /^[a-z0-9_.]{3,20}$/.test(normalized);

  const checkUsername = async () => {
    if (!validFormat) {
      setAvailable(null);
      Alert.alert("ชื่อผู้ใช้ไม่ถูกต้อง", "ใช้ a-z, 0-9, _ หรือ . ความยาว 3-20 ตัวอักษร");
      return;
    }
    setChecking(true);
    const ok = await isUsernameAvailable(normalized);
    setAvailable(ok);
    setChecking(false);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("ต้องการสิทธิ์เข้าถึงรูปภาพ", "โปรดอนุญาตให้แอปเข้าถึงคลังรูปเพื่อเลือกรูปโปรไฟล์");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const goStep2 = async () => {
    // Re-verify availability before advancing.
    if (!validFormat) {
      Alert.alert("ชื่อผู้ใช้ไม่ถูกต้อง", "ใช้ a-z, 0-9, _ หรือ . ความยาว 3-20 ตัวอักษร");
      return;
    }
    setChecking(true);
    const ok = await isUsernameAvailable(normalized);
    setChecking(false);
    setAvailable(ok);
    if (!ok) {
      Alert.alert("ชื่อผู้ใช้ซ้ำ", "ชื่อนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น");
      return;
    }
    setStep(2);
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      Alert.alert("กรอกชื่อ", "กรุณากรอกชื่อที่จะแสดงในโปรไฟล์");
      return;
    }
    setSaving(true);
    const { error } = await completeOnboarding({
      username: normalized,
      displayName: displayName.trim(),
      phone: phone.trim() || undefined,
      avatarUri,
    });
    setSaving(false);
    if (error) {
      Alert.alert("บันทึกไม่สำเร็จ", error);
      if (error.includes("ถูกใช้แล้ว")) setStep(1);
    }
    // On success, AuthGate re-renders into the app automatically.
  };

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: Math.max(insets.top, 16) + 8 }}>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Progress */}
        <View className="flex-row items-center mb-6">
          <View className="flex-1 h-1.5 rounded-full bg-[#2D6A4F]" />
          <View className={`flex-1 h-1.5 rounded-full ml-2 ${step === 2 ? "bg-[#2D6A4F]" : "bg-gray-200"}`} />
        </View>

        {step === 1 ? (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">ตั้งชื่อผู้ใช้</Text>
            <Text className="text-gray-500 text-[13px] mb-6 leading-5">
              ชื่อผู้ใช้ (username) ใช้เป็นชื่อเฉพาะของคุณ ห้ามซ้ำกับคนอื่น และตั้งได้ครั้งเดียว
            </Text>

            <View className="flex-row items-center bg-gray-100 rounded-xl px-3.5">
              <Text className="text-gray-400 text-[15px]">@</Text>
              <TextInput
                value={username}
                onChangeText={(t) => {
                  setUsername(t);
                  setAvailable(null);
                }}
                placeholder="username"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 py-3 text-[15px] text-gray-900 ml-1"
              />
              {checking ? (
                <ActivityIndicator size="small" color="#2D6A4F" />
              ) : available === true ? (
                <CheckCircleIcon size={22} color="#2D6A4F" />
              ) : available === false ? (
                <XCircleIcon size={22} color="#DC2626" />
              ) : null}
            </View>

            <TouchableOpacity onPress={checkUsername} activeOpacity={0.7} className="self-start mt-2">
              <Text className="text-[#2D6A4F] text-[12px] font-semibold">ตรวจสอบชื่อนี้</Text>
            </TouchableOpacity>

            {available === true && (
              <Text className="text-emerald-600 text-[12px] mt-1">ใช้ชื่อนี้ได้ ✓</Text>
            )}
            {available === false && (
              <Text className="text-red-500 text-[12px] mt-1">ชื่อนี้ถูกใช้แล้ว</Text>
            )}

            <TouchableOpacity
              onPress={goStep2}
              disabled={checking || !validFormat}
              activeOpacity={0.85}
              className={`mt-8 py-4 rounded-2xl flex-row items-center justify-center ${
                validFormat && !checking ? "bg-[#2D6A4F]" : "bg-gray-200"
              }`}
            >
              <Text className={`font-bold text-[15px] mr-1.5 ${validFormat ? "text-white" : "text-gray-400"}`}>
                ถัดไป
              </Text>
              <ArrowRightIcon size={18} color={validFormat ? "#FFFFFF" : "#9CA3AF"} strokeWidth={2.5} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">ข้อมูลโปรไฟล์</Text>
            <Text className="text-gray-500 text-[13px] mb-6">กรอกชื่อ รูป และเบอร์ติดต่อ</Text>

            {/* Avatar */}
            <View className="items-center mb-6">
              <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={{ width: 96, height: 96, borderRadius: 48 }} />
                ) : (
                  <View className="w-24 h-24 rounded-full bg-gray-100 items-center justify-center border-2 border-dashed border-gray-300">
                    <CameraIcon size={28} color="#9CA3AF" />
                  </View>
                )}
              </TouchableOpacity>
              <Text className="text-gray-400 text-[12px] mt-2">แตะเพื่อเลือกรูปโปรไฟล์</Text>
            </View>

            <Text className="text-gray-700 font-bold text-[13px] mb-1.5">ชื่อที่แสดง</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="เช่น ป้าสมศรี ชุมชนห้วยห้อม"
              placeholderTextColor="#9CA3AF"
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[15px] text-gray-900 mb-4"
            />

            <Text className="text-gray-700 font-bold text-[13px] mb-1.5">
              เบอร์โทร <Text className="text-gray-400 font-normal">(ไม่บังคับ)</Text>
            </Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="08x-xxx-xxxx"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              className="bg-gray-100 rounded-xl px-3.5 py-3 text-[15px] text-gray-900 mb-8"
            />

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || !displayName.trim()}
              activeOpacity={0.85}
              className={`py-4 rounded-2xl items-center justify-center ${
                displayName.trim() && !saving ? "bg-[#2D6A4F]" : "bg-gray-200"
              }`}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className={`font-bold text-[15px] ${displayName.trim() ? "text-white" : "text-gray-400"}`}>
                  บันทึกและเริ่มใช้งาน
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep(1)} activeOpacity={0.7} className="mt-3 items-center">
              <Text className="text-gray-400 text-[13px]">ย้อนกลับไปแก้ชื่อผู้ใช้</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
