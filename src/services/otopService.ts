import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";

/**
 * OTOP community verification (via our backend → CDD registry).
 * The CDD token lives on the backend; the app only sends the Village_ID.
 */
export interface OtopProfile {
  idNumber: string | null;
  region: string | null;
  province: string | null;
  amphur: string | null;
  tambol: string | null;
  village: string | null;
  otopNawatwithi: string | null;
  otopForTourism: string | null;
  cbtVillage: string | null;
  raw?: any;
}

export interface OtopVerifyResult {
  configured: boolean; // false when backend has no OTOP token
  verified: boolean;
  profile: OtopProfile | null;
  error?: string;
}

export async function verifyOtop(villageId: string): Promise<OtopVerifyResult> {
  const id = villageId.trim();
  if (!id) return { configured: false, verified: false, profile: null, error: "กรุณากรอกเลขทะเบียน" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${API_BASE_URL}/otop/verify/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { configured: true, verified: false, profile: null, error: data?.error ?? "ตรวจสอบไม่สำเร็จ" };
    }
    return {
      configured: Boolean(data?.configured),
      verified: Boolean(data?.verified),
      profile: data?.profile ?? null,
    };
  } catch {
    return { configured: false, verified: false, profile: null, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" };
  } finally {
    clearTimeout(timer);
  }
}
