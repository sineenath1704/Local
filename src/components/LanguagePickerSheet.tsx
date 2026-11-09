import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import {
  XMarkIcon,
  CheckIcon,
  SparklesIcon,
  PencilSquareIcon,
} from "react-native-heroicons/outline";
import {
  AUTO_CHOICE,
  CUSTOM_CHOICE_ID,
  DIALECT_LANGUAGES,
  FOREIGN_LANGUAGES,
  type LangChoice,
  type LanguageOption,
} from "../data/translateData";

/**
 * LanguagePickerSheet — ตัวเลือกภาษา (ใช้ได้ทั้งฝั่งต้นทางและฝั่งปลายทาง)
 * -------------------------------------------------------------
 * รายการภาษาแบ่งเป็น 3 กลุ่ม:
 *   1. ตรวจหาอัตโนมัติ (เฉพาะฝั่งต้นทาง) — โมเดลเป็นคนตรวจว่าเป็นภาษาอะไร
 *   2. ไทยถิ่น 4 ภาค
 *   3. ภาษาต่างประเทศที่เจอในไทย
 *   4. อื่น ๆ — พิมพ์ชื่อภาษาเอง (ส่งเป็น label ไปให้โมเดล)
 *
 * ตัวนี้ถูก mount ใหม่ทุกครั้งที่เปิด (พ่นแม่ส่งเฉพาะตอนเปิด) → ไม่ต้องล้าง
 * state ใน effect (กฎ react-hooks/set-state-in-effect ของ React Compiler)
 */
export interface LanguagePickerSheetProps {
  visible: boolean;
  /** หัวข้อของฝั่งที่กำลังเลือก เช่น "ภาษาต้นทาง" */
  title: string;
  /** ฝั่งต้นทางเท่านั้นที่มีตัวเลือก "ตรวจหาอัตโนมัติ" */
  allowAuto?: boolean;
  /** ภาษาที่เลือกอยู่ตอนนี้ (ไฮไลต์ในลิสต์) */
  value: LangChoice | null;
  onSelect: (choice: LangChoice) => void;
  onClose: () => void;
}

export function LanguagePickerSheet({
  visible,
  title,
  allowAuto = false,
  value,
  onSelect,
  onClose,
}: LanguagePickerSheetProps) {
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");

  const reset = () => {
    setCustomMode(false);
    setCustomText("");
  };

  const pick = (choice: LangChoice) => {
    reset();
    onSelect(choice);
  };

  const confirmCustom = () => {
    const name = customText.trim();
    if (!name) return;
    pick({ id: CUSTOM_CHOICE_ID, label: name });
  };

  const renderOption = (opt: LanguageOption) => {
    const selected = value?.id === opt.id;
    return (
      <TouchableOpacity
        key={opt.id}
        onPress={() => pick({ id: opt.id, label: opt.label })}
        activeOpacity={0.85}
        className={`flex-row items-center justify-between px-4 py-3 rounded-xl mb-1.5 ${
          selected ? "bg-violet-50 border border-violet-200" : "bg-gray-50"
        }`}
      >
        <Text
          className={`text-[14px] flex-1 ${selected ? "font-bold text-violet-700" : "font-medium text-gray-700"}`}
        >
          {opt.label}
        </Text>
        {selected ? <CheckIcon size={16} color="#7C3AED" /> : null}
      </TouchableOpacity>
    );
  };

  const customSelected = value?.id === CUSTOM_CHOICE_ID;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 items-center justify-center px-5">
        <View className="bg-white rounded-3xl w-full max-w-[420px] overflow-hidden">
          {/* หัวเรื่อง */}
          <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
            <Text className="text-[17px] font-bold text-gray-900">{title}</Text>
            <TouchableOpacity
              onPress={() => {
                reset();
                onClose();
              }}
              className="p-1 rounded-full bg-gray-100"
            >
              <XMarkIcon size={20} color="#4B5563" />
            </TouchableOpacity>
          </View>

          <ScrollView className="px-5 pb-2" style={{ maxHeight: 380 }}>
            {/* ตรวจหาอัตโนมัติ — ฝั่งต้นทางเท่านั้น */}
            {allowAuto ? (
              <TouchableOpacity
                onPress={() => pick(AUTO_CHOICE)}
                activeOpacity={0.85}
                className={`flex-row items-center justify-between px-4 py-3 rounded-xl mb-3 ${
                  value?.id === "auto"
                    ? "bg-violet-50 border border-violet-200"
                    : "bg-gray-50"
                }`}
              >
                <View className="flex-row items-center flex-1">
                  <SparklesIcon size={16} color="#7C3AED" />
                  <Text
                    className={`text-[14px] ml-2 flex-1 ${
                      value?.id === "auto"
                        ? "font-bold text-violet-700"
                        : "font-medium text-gray-700"
                    }`}
                  >
                    {AUTO_CHOICE.label}
                  </Text>
                </View>
                {value?.id === "auto" ? <CheckIcon size={16} color="#7C3AED" /> : null}
              </TouchableOpacity>
            ) : null}

            {/* ไทยถิ่น */}
            <Text className="text-[11px] font-bold text-gray-400 uppercase mb-1.5">
              ไทยถิ่น
            </Text>
            {DIALECT_LANGUAGES.map(renderOption)}

            {/* ต่างประเทศ */}
            <Text className="text-[11px] font-bold text-gray-400 uppercase mb-1.5 mt-2">
              ต่างประเทศที่เจอในไทย
            </Text>
            {FOREIGN_LANGUAGES.map(renderOption)}

            {/* อื่น ๆ — พิมพ์เอง */}
            <Text className="text-[11px] font-bold text-gray-400 uppercase mb-1.5 mt-2">
              อื่น ๆ
            </Text>
            {customMode ? (
              <View className="bg-gray-50 rounded-xl px-3 py-3 mb-2">
                <TextInput
                  value={customText}
                  onChangeText={setCustomText}
                  placeholder="พิมพ์ชื่อภาษา เช่น ภาษาปะติวอน"
                  placeholderTextColor="#9CA3AF"
                  autoFocus
                  onSubmitEditing={confirmCustom}
                  returnKeyType="done"
                  className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[14px] text-gray-900"
                />
                <View className="flex-row mt-2.5">
                  <TouchableOpacity
                    onPress={() => {
                      reset();
                    }}
                    activeOpacity={0.85}
                    className="flex-1 rounded-xl py-2.5 items-center bg-white border border-gray-200 mr-2"
                  >
                    <Text className="text-gray-600 font-bold text-[13px]">ยกเลิก</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={confirmCustom}
                    activeOpacity={0.85}
                    disabled={customText.trim() === ""}
                    className={`flex-1 rounded-xl py-2.5 items-center ${
                      customText.trim() === "" ? "bg-gray-200" : "bg-violet-600"
                    }`}
                  >
                    <Text
                      className={`font-bold text-[13px] ${
                        customText.trim() === "" ? "text-gray-400" : "text-white"
                      }`}
                    >
                      ตกลง
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setCustomMode(true)}
                activeOpacity={0.85}
                className={`flex-row items-center justify-between px-4 py-3 rounded-xl mb-1.5 ${
                  customSelected
                    ? "bg-violet-50 border border-violet-200"
                    : "bg-gray-50"
                }`}
              >
                <View className="flex-row items-center flex-1">
                  <PencilSquareIcon size={16} color="#6B7280" />
                  <Text
                    className={`text-[14px] ml-2 flex-1 ${
                      customSelected
                        ? "font-bold text-violet-700"
                        : "font-medium text-gray-700"
                    }`}
                    numberOfLines={1}
                  >
                    {customSelected && value ? value.label : "พิมพ์ชื่อภาษาเอง"}
                  </Text>
                </View>
                {customSelected ? <CheckIcon size={16} color="#7C3AED" /> : null}
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* ปิด */}
          <View className="px-5 pt-2 pb-5">
            <TouchableOpacity
              onPress={() => {
                reset();
                onClose();
              }}
              activeOpacity={0.85}
              className="rounded-xl py-3 items-center justify-center bg-gray-100"
            >
              <Text className="text-gray-700 font-bold text-[13.5px]">ปิด</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
