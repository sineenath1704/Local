import { Platform } from "react-native";

/**
 * Base URL of OUR backend (the one in `mobile/backend/`).
 * -------------------------------------------------------------
 * Dev notes:
 *   - Android emulator reaches the host machine via 10.0.2.2 (not localhost)
 *   - iOS simulator / web can use localhost directly
 *   - Real device: set API_BASE_URL_OVERRIDE below to your PC's LAN IP,
 *     e.g. "http://192.168.1.20:4000"
 *
 * For staging/production, set API_BASE_URL_OVERRIDE to your deployed URL.
 */

// 👉 Priority 1: env override (set EXPO_PUBLIC_API_BASE_URL in .env).
//    This is REQUIRED when running on a real device (phone/iPad) because
//    "localhost" there means the device itself, not your computer.
//    Use your PC's LAN IP, e.g. http://192.168.3.30:1025
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

// Priority 2: in-code override (optional).
const API_BASE_URL_OVERRIDE = "";

const DEV_PORT = 1025;

function resolveBaseUrl(): string {
  if (ENV_BASE_URL.trim() !== "") {
    return ENV_BASE_URL.trim().replace(/\/+$/, "");
  }
  if (API_BASE_URL_OVERRIDE.trim() !== "") {
    return API_BASE_URL_OVERRIDE.trim().replace(/\/+$/, "");
  }

  if (Platform.OS === "android") {
    return `http://10.0.2.2:${DEV_PORT}`;
  }
  // iOS simulator & web
  return `http://localhost:${DEV_PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();

/** Default timeout for backend requests (ms). */
export const API_TIMEOUT_MS = 8000;

/**
 * คำขอที่ต้องรอโมเดลนาน (แชท / คำนวณแพลนทริป)
 * -------------------------------------------------------------
 * backend ทำงานหลายรอบต่อคำขอ (Google Places → ค้นเว็บ → เรียกโมเดล)
 * และตัวโมเดลเองตั้ง AI_TIMEOUT_MS = 120 วินาที
 *
 * เดิมแชทใช้แค่ API_TIMEOUT_MS × 3 = 24 วินาที
 * → เคยตัดคำตอบทิ้งกลางคัน แล้วขึ้นข้อความหลอกว่า "ต่อเซิร์ฟเวอร์ไม่ได้"
 *   (จริง ๆ คือรอไม่ทัน — เซิร์ฟเวอร์ยังทำงานอยู่)
 *
 * ตอนนี้ยาวกว่างบ AI ของ backend → เซิร์ฟเวอร์เป็นคนตอบ/ตอบว่าล้มเหลวก่อน
 * ถ้ายังไม่มีคำตอบในเวลานี้ แปลว่าจริง ๆ แล้วมีปัญหาที่ปลายทาง
 */
export const AI_CHAT_TIMEOUT_MS = 130_000;

/** คำนวณแพลนทริป — โมเดลคิดนานกว่าแชท (งบ AI ของ backend = 120 วินาที) */
export const AI_PLAN_TIMEOUT_MS = 180_000;
