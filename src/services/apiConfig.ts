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

// 👉 Set this to force a specific backend URL (leave "" to auto-detect in dev).
const API_BASE_URL_OVERRIDE = "";

const DEV_PORT = 1025;

function resolveBaseUrl(): string {
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
