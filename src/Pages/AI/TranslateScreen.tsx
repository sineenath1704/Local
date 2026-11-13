import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import {
  ArrowsRightLeftIcon,
  ChevronDownIcon,
  MicrophoneIcon,
  SparklesIcon,
  StopIcon,
} from "react-native-heroicons/outline";
import {
  RecordingPresets,
  useAudioRecorder,
  type AudioRecorder,
} from "expo-audio";
import { useSettings } from "../../state/SettingsContext";
import {
  AUTO_CHOICE,
  myLanguageChoice,
  type LangChoice,
  type TranslateResult,
} from "../../data/translateData";
import { translateTextFlow, transcribeAudio } from "../../services/translateService";
import {
  requestMicPermission,
  startRecording,
  stopRecording,
} from "../../services/voiceService";
import { LanguagePickerSheet } from "../../components/LanguagePickerSheet";

/**
 * TranslateScreen — "AI ช่วยแปลภาษา"
 * -------------------------------------------------------------
 * เป็นคอนเทนต์ฝั่งขวาของสวิชในแท็บแชท (ดู AiHubScreen) → ไม่มีปุ่มย้อนกลับ
 * เพราะสวิชเองคือทางกลับ
 *
 * หน้าจอแบบ Google Translate:
 *   [ ภาษาต้นทาง ▾ ]  ⇄  [ ภาษาปลายทาง ▾ ]
 *   [ ช่องพิมพ์ + ไมค์ ]
 *   [ แปล ]
 *   [ การ์ดผลลัพธ์ ]
 *   [ ประวัติ 5 รายการล่าสุด ]
 *
 * ฝั่งต้นทางเริ่มต้นเป็น "อัตโนมัติ" เพราะผู้ใช้มักไม่รู้ว่าคำที่เจอเป็นภาษาอะไร
 * ฝั่งปลายทางเริ่มต้นเป็น "ภาษาของฉัน" (ดึงจากที่ตั้งค่าไว้ในแอป)
 */

/** พูดยาวเกินนี้แล้วหยุดให้เอง (กันไฟล์เสียงบวมเกินลิมิตของ backend) */
const MAX_RECORD_SECONDS = 30;

function ResultRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View className="mt-3">
      <Text className="text-[11px] font-bold text-gray-400 uppercase">
        {label}
      </Text>
      <Text
        className={`text-[15px] mt-0.5 leading-6 ${
          strong ? "font-bold text-gray-900" : "text-gray-700"
        }`}
      >
        {value}
      </Text>
    </View>
  );
}

export default function TranslateScreen() {
  const { language } = useSettings();

  const [source, setSource] = useState<LangChoice>(AUTO_CHOICE);
  const [target, setTarget] = useState<LangChoice>(() =>
    myLanguageChoice(language)
  );
  const [picker, setPicker] = useState<"source" | "target" | null>(null);

  const [text, setText] = useState("");
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"translate" | "transcribe" | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [history, setHistory] = useState<TranslateResult[]>([]);

  // เก็บภาษาล่าสุดไว้ใน ref — เพื่อให้ฟังก์ชันที่ถูกเรียกจาก timeout
  // (หยุดอัดเสียงอัตโนมัติ) ใช้ค่าที่ถูกต้องเสมอ โดยไม่ต้องผูก dependency
  const langRef = useRef<{ source: LangChoice; target: LangChoice }>({
    source,
    target,
  });
  useEffect(() => {
    langRef.current = { source, target };
  }, [source, target]);

  const busyRef = useRef(false);
  const recordingRef = useRef(false);
  /** เวลาที่เริ่มอัดเสียง (ms) — ใช้วัดความยาวจริงตอนหยุด ไม่พึ่งตัวนับวินาทีใน state */
  const startedAtRef = useRef<number | null>(null);

  /**
   * ตัว recorder มาจาก hook `useAudioRecorder` ของ expo-audio
   * (SDK 58 ไม่ให้สร้าง AudioRecorder เองได้ — ต้องใช้ hook ที่คุม lifecycle)
   * เก็บใน ref เพื่อให้ callback ที่เรียกจากปุ่ม/ตัวจับเวลาไม่ต้องผูก dependency
   */
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderRef = useRef<AudioRecorder>(recorder);
  useEffect(() => {
    recorderRef.current = recorder;
  }, [recorder]);

  const markBusy = useCallback((value: "translate" | "transcribe" | null) => {
    busyRef.current = value !== null;
    setBusy(value);
  }, []);

  /** ยิงแปล — เรียกได้จากทั้งปุ่มแปลและหลังถอดเสียงเสร็จ */
  const runTranslate = useCallback(
    async (payload: string, src: LangChoice, tgt: LangChoice) => {
      markBusy("translate");
      setError(null);
      try {
        const res = await translateTextFlow({
          text: payload,
          sourceId: src.id,
          sourceLabel: src.label,
          targetId: tgt.id,
          targetLabel: tgt.label,
        });
        setResult(res);
        setHistory((prev) => [res, ...prev].slice(0, 5));
      } catch (err: any) {
        setError(err?.message ?? "แปลไม่สำเร็จ — ลองอีกครั้ง");
      } finally {
        markBusy(null);
      }
    },
    [markBusy]
  );

  // ---- เสียงพูด ----
  const startVoice = useCallback(async () => {
    if (busyRef.current || recordingRef.current) return;
    try {
      const granted = await requestMicPermission();
      if (!granted) {
        Alert.alert(
          "ต้องอนุญาตให้แอปเข้าถึงไมโครโฟนก่อน",
          "เปิดตั้งค่าแอป → สิทธิ์ → ไมโครโฟน แล้วลองอีกครั้ง"
        );
        return;
      }
      await startRecording(recorderRef.current);
      recordingRef.current = true;
      startedAtRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "เปิดการอัดเสียงไม่สำเร็จ — ลองอีกครั้ง");
    }
  }, []);

  /**
   * หยุดอัดเสียง → ถอดเสียง → ขึ้นในช่อง → แปลต่ออัตโนมัติ
   * ("พูดแล้วแปลเลย แต่ต้องมีข้อความขึ้นด้วย")
   */
  const stopVoice = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    markBusy("transcribe");
    setError(null);
    try {
      const { uri, mimeType } = await stopRecording(recorderRef.current);
      const elapsed = startedAtRef.current
        ? (Date.now() - startedAtRef.current) / 1000
        : 0;
      startedAtRef.current = null;

      // Android: MediaRecorder ยุติไฟล์ไม่สำเร็จถ้าอัดสั้นกว่า ~1 วินาที
      // (ไฟล์จะเสีย → Gemini อ่านไม่ออก) → บอกผู้ใช้ดีกว่าขึ้น "ถอดเสียงไม่สำเร็จ"
      if (Platform.OS === "android" && elapsed < 1) {
        setError("พูดสั้นเกินไป — ลองพูดยาวสัก 1 วินาทีแล้วใหม่");
        markBusy(null);
        return;
      }

      const spoken = await transcribeAudio(uri, mimeType);
      if (!spoken) {
        setError("ไม่ได้ยินเสียงพูด — ลองพูดอีกครั้ง");
        markBusy(null);
        return;
      }
      setText(spoken);
      const { source: src, target: tgt } = langRef.current;
      await runTranslate(spoken, src, tgt);
    } catch (err: any) {
      setError(err?.message ?? "ถอดเสียงไม่สำเร็จ — ลองอีกครั้ง");
      markBusy(null);
    }
  }, [markBusy, runTranslate]);

  // นาฬิกาวินาทีตอนอัดเสียง
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setSeconds((s) => (s + 1 > MAX_RECORD_SECONDS ? MAX_RECORD_SECONDS : s + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // หยุดอัดเสียงอัตโนมัติเมื่อครบเวลา
  // (เรียกผ่าน setTimeout เพื่อไม่ให้ setState เกิดในตัว effect โดยตรง)
  useEffect(() => {
    if (!recording) return;
    if (seconds < MAX_RECORD_SECONDS) return;
    const timer = setTimeout(() => {
      void stopVoice();
    }, 0);
    return () => clearTimeout(timer);
  }, [recording, seconds, stopVoice]);

  // ---- สลับทิศทาง ----
  const swap = useCallback(() => {
    if (source.id === "auto") {
      // ต้นทางเป็นอัตโนมัติ → ⇄ แปลว่า "อยากแปลจากภาษาของฉันไปเป็นภาษาถิ่น"
      // → ต้นทางกลายเป็นภาษาปลายทางเดิม และเปิดให้เลือกภาษาปลายทางทันที
      setSource(target);
      setPicker("target");
      return;
    }
    setSource(target);
    setTarget(source);
  }, [source, target]);

  const onTranslatePress = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("ยังไม่ได้พิมพ์หรือพูดอะไร — พิมพ์คำที่อยากแปลได้เลย");
      return;
    }
    void runTranslate(trimmed, source, target);
  }, [runTranslate, source, target, text]);

  const showMic = Platform.OS !== "web";

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-gray-400 text-[11px] pt-3 pb-2 leading-4">
          พิมพ์หรือพูดคำที่เจอเวลาเที่ยว แล้ว AI จะอธิบายความหมายในภาษาที่เราใช้
          พร้อมบอกว่าออกเสียงอย่างไร
        </Text>

        {/* --- สองปุ่มภาษา + ⇄ --- */}
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => setPicker("source")}
            activeOpacity={0.85}
            className="flex-1 bg-gray-100 rounded-2xl px-3 py-2.5 flex-row items-center"
          >
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-gray-400 uppercase">
                ต้นทาง
              </Text>
              <Text
                className="text-[13.5px] font-bold text-gray-900"
                numberOfLines={1}
              >
                {source.label}
              </Text>
            </View>
            <ChevronDownIcon size={14} color="#6B7280" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={swap}
            activeOpacity={0.8}
            className="mx-2 w-9 h-9 rounded-full bg-violet-100 items-center justify-center"
          >
            <ArrowsRightLeftIcon size={16} color="#7C3AED" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setPicker("target")}
            activeOpacity={0.85}
            className="flex-1 bg-gray-100 rounded-2xl px-3 py-2.5 flex-row items-center"
          >
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-gray-400 uppercase">
                ปลายทาง
              </Text>
              <Text
                className="text-[13.5px] font-bold text-gray-900"
                numberOfLines={1}
              >
                {target.label}
              </Text>
            </View>
            <ChevronDownIcon size={14} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* --- ช่องพิมพ์ + ไมค์ --- */}
        <View className="bg-gray-100 rounded-2xl px-4 py-3 flex-row items-end mt-3">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="พิมพ์หรือพูดคำที่อยากแปล…"
            placeholderTextColor="#9CA3AF"
            multiline
            editable={!busy}
            style={{ minHeight: 44, maxHeight: 120 }}
            className="flex-1 text-[15px] text-gray-900 leading-6 pr-2"
          />
          {showMic ? (
            <TouchableOpacity
              onPress={recording ? () => void stopVoice() : () => void startVoice()}
              activeOpacity={0.85}
              disabled={busy !== null}
              className={`w-11 h-11 rounded-full items-center justify-center ${
                recording ? "bg-red-500" : "bg-violet-600"
              } ${busy !== null && !recording ? "opacity-40" : ""}`}
            >
              {recording ? (
                <StopIcon size={19} color="#FFFFFF" />
              ) : (
                <MicrophoneIcon size={19} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        {/* สถานะตอนอัดเสียง / กำลังทำงาน */}
        {recording ? (
          <View className="flex-row items-center mt-2">
            <View className="w-2 h-2 rounded-full bg-red-500 mr-1.5" />
            <Text className="text-[12px] font-bold text-red-600">
              กำลังอัดเสียง {seconds} วิ — แตะไมค์อีกครั้งเพื่อหยุด
            </Text>
          </View>
        ) : null}

        {busy === "transcribe" ? (
          <View className="flex-row items-center mt-2">
            <ActivityIndicator size="small" color="#7C3AED" />
            <Text className="text-[12px] font-medium text-gray-600 ml-2">
              กำลังถอดเสียงพูดของคุณ...
            </Text>
          </View>
        ) : null}

        {/* --- ปุ่มแปล --- */}
        <TouchableOpacity
          onPress={onTranslatePress}
          activeOpacity={0.9}
          disabled={busy !== null}
          className={`mt-3 rounded-2xl py-3.5 flex-row items-center justify-center ${
            busy !== null ? "bg-violet-300" : "bg-violet-600"
          }`}
        >
          {busy === "translate" ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <SparklesIcon size={18} color="#FFFFFF" />
          )}
          <Text className="text-white font-black text-[15px] ml-2">
            {busy === "translate" ? "กำลังแปล..." : "แปล"}
          </Text>
        </TouchableOpacity>

        {/* --- ข้อความผิดพลาด --- */}
        {error ? (
          <View className="mt-3 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
            <Text className="text-[13px] font-medium text-red-700">{error}</Text>
          </View>
        ) : null}

        {/* --- การ์ดผลลัพธ์ --- */}
        {result ? (
          <View className="mt-4 bg-white border border-gray-200 rounded-3xl p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <SparklesIcon size={15} color="#7C3AED" />
                <Text className="text-[12.5px] font-bold text-violet-700 ml-1.5 flex-1" numberOfLines={1}>
                  ตรวจพบ: {result.detectedSource ?? source.label}
                </Text>
              </View>
              {result.sameLanguage ? (
                <Text className="text-[11px] font-bold text-amber-600">
                  เป็นภาษาเดียวกันอยู่แล้ว
                </Text>
              ) : (
                <Text className="text-[11px] font-medium text-gray-400">
                  มั่นใจ {Math.round(result.confidence * 100)}%
                </Text>
              )}
            </View>

            <ResultRow label="ต้นฉบับ" value={result.original} />

            {/* ความหมายกลาง — โชว์เฉพาะตอนที่แปลผ่าน “ไทยกลาง” มา (ปลายทางเป็นภาษาอื่น) */}
            {result.centralMeaning &&
            result.centralMeaning !== result.translation ? (
              <ResultRow label="ความหมายกลาง" value={result.centralMeaning} />
            ) : null}

            {result.translation ? (
              <ResultRow label="ความหมาย" value={result.translation} strong />
            ) : null}

            {result.pronunciation ? (
              <ResultRow label="ออกเสียง" value={result.pronunciation} />
            ) : null}

            {result.note ? (
              <ResultRow label="หมายเหตุ" value={result.note} />
            ) : null}
          </View>
        ) : null}

        {/* --- ประวัติ --- */}
        {history.length > 0 ? (
          <View className="mt-5">
            <Text className="text-[11px] font-bold text-gray-400 uppercase mb-1.5">
              ที่แปลล่าสุด
            </Text>
            {history.map((item, index) => (
              <TouchableOpacity
                key={`${item.original}-${index}`}
                onPress={() => setResult(item)}
                activeOpacity={0.8}
                className="bg-gray-50 rounded-2xl px-4 py-3 mb-1.5"
              >
                <Text className="text-[13px] font-bold text-gray-800" numberOfLines={1}>
                  {item.original}
                </Text>
                {item.translation ? (
                  <Text className="text-[12.5px] text-gray-500 mt-0.5" numberOfLines={1}>
                    {item.translation}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* --- ตัวเลือกภาษา --- */}
      {picker ? (
        <LanguagePickerSheet
          visible
          title={picker === "source" ? "ภาษาต้นทาง" : "ภาษาปลายทาง"}
          allowAuto={picker === "source"}
          value={picker === "source" ? source : target}
          onSelect={(choice) => {
            if (picker === "source") setSource(choice);
            else setTarget(choice);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </View>
  );
}
