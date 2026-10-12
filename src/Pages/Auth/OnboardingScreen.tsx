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
import { verifyOtop, type OtopProfile } from "../../services/otopService";

/**
 * OnboardingScreen — shown once after a first Google sign-in, before the app.
 * Step 1: pick a unique username.
 * Step 2: display name + phone + avatar → save → done.
 */
type Step = "role" | "otop" | "username" | "details";

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { isUsernameAvailable, completeOnboarding } = useAuth();

  const [step, setStep] = useState<Step>("role");

  // Role + OTOP verification
  const [role, setRole] = useState<"tourist" | "host" | null>(null);
  const [villageId, setVillageId] = useState("");
  const [otopChecking, setOtopChecking] = useState(false);
  const [otop, setOtop] = useState<OtopProfile | null>(null);

  const [username, setUsername] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const checkOtop = async () => {
    if (!villageId.trim()) {
      Alert.alert("กรอกเลขทะเบียน", "กรุณากรอกเลขทะเบียน OTOP นวัตวิถี");
      return;
    }
    setOtopChecking(true);
    const r = await verifyOtop(villageId.trim());
    setOtopChecking(false);
    if (!r.configured) {
      Alert.alert("ยังไม่พร้อมใช้งาน", "ระบบยืนยัน OTOP ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์");
      return;
    }
    if (!r.verified || !r.profile) {
      setOtop(null);
      Alert.alert("ไม่พบทะเบียน", r.error ?? "ไม่พบเลขทะเบียนนี้ในระบบ OTOP กรุณาตรวจสอบอีกครั้ง");
      return;
    }
    setOtop(r.profile);
  };

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
    setStep("details");
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
      role: role ?? "tourist",
      otop: role === "host" ? otop : null,
    });
    setSaving(false);
    if (error) {
      Alert.alert("บันทึกไม่สำเร็จ", error);
      if (error.includes("ถูกใช้แล้ว")) setStep("username");
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
        {/* ---- STEP: choose role ---- */}
        {step === "role" && (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">คุณคือใคร?</Text>
            <Text className="text-gray-500 text-[13px] mb-6 leading-5">
              เลือกประเภทบัญชีเพื่อเริ่มใช้งาน Local
            </Text>

            <TouchableOpacity
              onPress={() => {
                setRole("tourist");
                setStep("username");
              }}
              activeOpacity={0.85}
              className="border-2 border-gray-200 rounded-2xl p-4 mb-3 flex-row items-center"
            >
              <Text className="text-3xl mr-3">🧳</Text>
              <View className="flex-1">
                <Text className="text-gray-900 font-black text-[15px]">นักท่องเที่ยว</Text>
                <Text className="text-gray-500 text-[12px]">เที่ยว รีวิว บันทึกคลิป วางแผนทริป</Text>
              </View>
              <ArrowRightIcon size={18} color="#9CA3AF" strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setRole("host");
                setStep("otop");
              }}
              activeOpacity={0.85}
              className="border-2 border-emerald-200 bg-emerald-50 rounded-2xl p-4 flex-row items-center"
            >
              <Text className="text-3xl mr-3">🏡</Text>
              <View className="flex-1">
                <Text className="text-gray-900 font-black text-[15px]">ชุมชน OTOP นวัตวิถี</Text>
                <Text className="text-gray-500 text-[12px]">ผู้ให้บริการ — ยืนยันด้วยเลขทะเบียน</Text>
              </View>
              <ArrowRightIcon size={18} color="#2D6A4F" strokeWidth={2.5} />
            </TouchableOpacity>
          </>
        )}

        {/* ---- STEP: OTOP verification (host only) ---- */}
        {step === "otop" && (
          <>
            <Text className="text-2xl font-black text-gray-900 mb-1">ยืนยันชุมชน OTOP</Text>
            <Text className="text-gray-500 text-[13px] mb-6 leading-5">
              กรอกเลขทะเบียนผู้ประกอบการ OTOP นวัตวิถี เพื่อยืนยันว่าเป็นผู้ให้บริการจริง
            </Text>

            <Text className="text-gray-700 font-bold text-[13px] mb-1.5">เลขทะเบียน (Village ID)</Text>
            <View className="flex-row">
              <TextInput
                value={villageId}
                onChangeText={(t) => {
                  setVillageId(t);
                  setOtop(null);
                }}
                placeholder="เช่น 123456"
                placeholderTextColor="#9CA3AF"
                className="flex-1 bg-gray-100 rounded-xl px-3.5 py-3 text-[15px] text-gray-900"
              />
              <TouchableOpacity
                onPress={checkOtop}
                disabled={otopChecking || !villageId.trim()}
                activeOpacity={0.85}
                className={`ml-2 px-4 items-center justify-center rounded-xl ${villageId.trim() && !otopChecking ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
              >
                {otopChecking ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className={`font-bold text-[13px] ${villageId.trim() ? "text-white" : "text-gray-400"}`}>ตรวจสอบ</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Verified community card */}
            {otop && (
              <View className="mt-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                <View className="flex-row items-center mb-2">
                  <CheckCircleIcon size={18} color="#2D6A4F" />
                  <Text className="text-[#1B4332] font-black text-[14px] ml-1.5">ยืนยันแล้ว</Text>
                </View>
                {otop.otopNawatwithi && (
                  <Text className="text-gray-900 font-bold text-[14px] mb-0.5">{otop.otopNawatwithi}</Text>
                )}
                <Text className="text-gray-600 text-[12px] leading-5">
                  {[otop.village, otop.tambol && `ต.${otop.tambol}`, otop.amphur && `อ.${otop.amphur}`, otop.province, otop.region]
                    .filter(Boolean)
                    .join(" • ")}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => setStep("username")}
              disabled={!otop}
              activeOpacity={0.85}
              className={`mt-8 py-4 rounded-2xl flex-row items-center justify-center ${otop ? "bg-[#2D6A4F]" : "bg-gray-200"}`}
            >
              <Text className={`font-bold text-[15px] mr-1.5 ${otop ? "text-white" : "text-gray-400"}`}>ถัดไป</Text>
              <ArrowRightIcon size={18} color={otop ? "#FFFFFF" : "#9CA3AF"} strokeWidth={2.5} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep("role")} activeOpacity={0.7} className="mt-3 items-center">
              <Text className="text-gray-400 text-[13px]">ย้อนกลับ</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "username" ? (
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

            <TouchableOpacity
              onPress={() => setStep(role === "host" ? "otop" : "role")}
              activeOpacity={0.7}
              className="mt-3 items-center"
            >
              <Text className="text-gray-400 text-[13px]">ย้อนกลับ</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {step === "details" && (
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

            <TouchableOpacity onPress={() => setStep("username")} activeOpacity={0.7} className="mt-3 items-center">
              <Text className="text-gray-400 text-[13px]">ย้อนกลับไปแก้ชื่อผู้ใช้</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
