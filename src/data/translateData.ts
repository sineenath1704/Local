import type { AppLanguage } from "../state/SettingsContext";

/**
 * รายการภาษาสำหรับ "เอไAI ช่วยแปลภาษา"
 * -------------------------------------------------------------
 * ฝั่งต้นทาง (source) = "ภาษาที่ผู้ใช้อยากแปล" — มักไม่รู้ว่าเป็นภาษาอะไร
 *   → ค่าเริ่มต้นคือ "auto" (ให้โมเดลตรวจหาให้) แล้วค่อยมาเลือกเองทีหลังได้
 * ฝั่งปลายทาง (target) = "ภาษาที่ผู้ใช้ใช้อยู่" → ดึงค่าเริ่มต้นจาก SettingsContext
 */

export type LanguageGroup = "dialect" | "foreign";

export interface LanguageOption {
  id: string;
  label: string;
  group: LanguageGroup;
}

/** ฝั่งที่เลือกได้ — ใช้ทั้งต้นทางและปลายทาง */
export interface LangChoice {
  /** "auto" | id ในรายการ | "custom" (พิมพ์ชื่อเอง) */
  id: string;
  /** ป้ายที่แสดงบนปุ่ม */
  label: string;
}

/** ต้นทางแบบตรวจหาอัตโนมัติ — โมเดลเป็นคนตรวจว่าเป็นภาษาอะไร */
export const AUTO_CHOICE: LangChoice = {
  id: "auto",
  label: "อัตโนมัติ — ตรวจหาให้",
};

/** ภาษาไทยถิ่น 4 ภาค (คนเที่ยวชุมชนไทยเจอบ่อยที่สุด) */
export const DIALECT_LANGUAGES: LanguageOption[] = [
  { id: "th-isarn", label: "อีสาน (ภาคอีสาน)", group: "dialect" },
  { id: "th-lanna", label: "ล้านนา (ภาคเหนือ)", group: "dialect" },
  { id: "th-paknam", label: "ปักษ์ใต้ (ภาคใต้)", group: "dialect" },
  { id: "th-central", label: "ไทย (ภาษากลาง)", group: "dialect" },
];

/** ภาษาต่างประเทศที่เจอบ่อยในไทย */
export const FOREIGN_LANGUAGES: LanguageOption[] = [
  { id: "en", label: "อังกฤษ", group: "foreign" },
  { id: "zh", label: "จีน", group: "foreign" },
  { id: "km", label: "เขมร", group: "foreign" },
  { id: "ms", label: "มลายู", group: "foreign" },
  { id: "lo", label: "ลาว", group: "foreign" },
  { id: "ru", label: "รัสเซีย", group: "foreign" },
  { id: "ja", label: "ญี่ปุ่น", group: "foreign" },
  { id: "ko", label: "เกาหลี", group: "foreign" },
  { id: "id", label: "อินโดนีเซีย", group: "foreign" },
  { id: "vn", label: "เวียดนาม", group: "foreign" },
  { id: "fr", label: "ฝรั่งเศส", group: "foreign" },
];

/** id ของตัวเลือก "อื่น ๆ — พิมพ์ชื่อเอง" */
export const CUSTOM_CHOICE_ID = "custom";

/** ป้ายของ "ภาษาที่ผู้ใช้ใช้อยู่" ตามค่าที่ตั้งไว้ในแอป */
export function myLanguageLabel(lang: AppLanguage): string {
  return lang === "en" ? "ภาษาของฉัน (English)" : "ภาษาของฉัน (ไทย)";
}

/** id ของ "ภาษาที่ผู้ใช้ใช้อยู่" — ใช้เป็นค่าเริ่มต้นของฝั่งปลายทาง */
export function myLanguageId(lang: AppLanguage): string {
  return lang === "en" ? "en" : "th-central";
}

/** ค่าเริ่มต้นของฝั่งปลายทาง */
export function myLanguageChoice(lang: AppLanguage): LangChoice {
  return { id: myLanguageId(lang), label: myLanguageLabel(lang) };
}

/**
 * ผลลัพธ์จาก backend — ตรงกับ TranslateResult ฝั่ง backend
 * (backend/src/aiClient.ts)
 */
export interface TranslateResult {
  detectedSource: string | null;
  /**
   * รหัสภาษาที่ backend ตรวจพบ (เช่น "north" · "isan" · "en")
   * → ใช้เทียบกับภาษาเป้าหมายได้ (null = โมเดลไม่แน่ใจ)
   */
  detectedSourceId?: string | null;
  sourceLabel: string;
  targetLabel: string;
  original: string;
  translation: string | null;
  pronunciation: string | null;
  note: string | null;
  confidence: number;
  sameLanguage: boolean;
  /**
   * ความหมาย “ภาษาไทยภาษากลาง” ที่ได้จากขั้นแรก (backend แปล 2 ขั้นให้)
   * → มีค่าเฉพาะตอนที่ปลายทางเป็นภาษาอื่น (แสดงให้เห็นว่าแปลผ่านกลางมาแล้ว)
   */
  centralMeaning?: string | null;
}
