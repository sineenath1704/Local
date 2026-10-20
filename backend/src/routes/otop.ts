import { Router, Request, Response } from "express";
import { config, isOtopConfigured } from "../config";

/**
 * GET /otop/verify/:id
 * -------------------------------------------------------------
 * Verify an OTOP นวัตวิถี community by its registration number (Village_ID)
 * against the CDD registry, and return a normalized community profile the app
 * stores on the host's user row + shows on the profile "ข้อมูลเพิ่มเติม".
 *
 * Upstream: GET {baseUrl}/{token}/otop_nawatwithi/{id}
 * The token stays server-side (env OTOP_API_TOKEN) — never sent to the app.
 */

interface OtopProfile {
  idNumber: string | null;
  region: string | null;
  province: string | null;
  amphur: string | null;
  tambol: string | null;
  village: string | null;
  otopNawatwithi: string | null;
  otopForTourism: string | null;
  cbtVillage: string | null;
  raw: any;
}

const router = Router();

/** Pick the first present value among several possible keys (API shape may vary). */
function pick(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/** Normalize the upstream record (which may be an object or a 1-item array). */
function normalize(payload: any): OtopProfile | null {
  const rec = Array.isArray(payload) ? payload[0] : payload?.data ?? payload;
  if (!rec || typeof rec !== "object") return null;
  return {
    idNumber: pick(rec, ["id_number", "idNumber", "id"]),
    // province/amphur come as int codes per spec; village_8/village_10 carry
    // the display จังหวัด/ภูมิภาค. Prefer the string display fields.
    region: pick(rec, ["village_10", "region"]),
    province: pick(rec, ["village_8", "province"]),
    amphur: pick(rec, ["amphur"]),
    tambol: pick(rec, ["tambol"]),
    village: pick(rec, ["village"]),
    otopNawatwithi: pick(rec, ["otop_nawatwithi"]),
    otopForTourism: pick(rec, ["otop_for_tourism"]),
    cbtVillage: pick(rec, ["otop_community_based_tourism_village"]),
    raw: rec,
  };
}

/**
 * Mock communities for UI flow testing, keyed by a short numeric ID.
 *
 * These used to be "DEMO001"… but the Village ID field opens a numeric keypad,
 * so the letters couldn't be typed at all. Plain digits keep the demo reachable
 * from a real keyboard.
 */
const MOCK_COMMUNITIES: Record<string, any> = {
  "001": {
    idNumber: "001",
    region: "ภาคเหนือ",
    province: "แม่ฮ่องสอน",
    amphur: "แม่ลาน้อย",
    tambol: "ห้วยห้อม",
    village: "บ้านห้วยห้อม",
    otopNawatwithi: "ชุมชนบ้านห้วยห้อม",
    otopForTourism: "กาแฟอาราบิกาอินทรีย์ ผ้าทอขนแกะ โฮมสเตย์",
    cbtVillage: "หมู่บ้านท่องเที่ยวโดยชุมชนบ้านห้วยห้อม",
    raw: { note: "mock — replace with real OTOP_API_TOKEN" },
  },
  "002": {
    idNumber: "002",
    region: "ภาคเหนือ",
    province: "เชียงราย",
    amphur: "แม่สาย",
    tambol: "ปางห้า",
    village: "บ้านปางห้า",
    otopNawatwithi: "ชุมชนท่องเที่ยว OTOP นวัตวิถี บ้านปางห้า",
    otopForTourism: "กระดาษสา ชาอัสสัม",
    cbtVillage: "หมู่บ้านท่องเที่ยวโดยชุมชน",
    raw: { note: "mock — replace with real OTOP_API_TOKEN" },
  },
  "003": {
    idNumber: "003",
    region: "ภาคกลาง",
    province: "สุโขทัย",
    amphur: "ศรีสัชนาลัย",
    tambol: "นาต้นจั่น",
    village: "บ้านนาต้นจั่น",
    otopNawatwithi: "ชุมชนท่องเที่ยว OTOP นวัตวิถี บ้านนาต้นจั่น",
    otopForTourism: "ผ้าหมักโคลน ข้าวเปิ๊บ",
    cbtVillage: "หมู่บ้านท่องเที่ยวโดยชุมชน",
    raw: { note: "mock — replace with real OTOP_API_TOKEN" },
  },
};

router.get("/verify/:id", async (req: Request, res: Response) => {
  const id = (req.params.id ?? "").trim().toUpperCase();
  if (!id) return res.status(400).json({ error: "id is required" });

  // Mock mode: the three short demo IDs answer without a real token (for UI flow
  // testing). Gated to exactly three digits so a real 6-digit Village ID can
  // never collide with one of them.
  if (/^\d{3}$/.test(id)) {
    const mock = MOCK_COMMUNITIES[id];
    return res.json({ configured: true, verified: Boolean(mock), profile: mock ?? null });
  }

  if (!isOtopConfigured()) {
    return res.json({ configured: false, verified: false, profile: null });
  }

  const url = `${config.otop.baseUrl}/${config.otop.token}/otop_nawatwithi/${encodeURIComponent(id)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.log("[otop] upstream error", resp.status, t.slice(0, 200));
      return res.status(502).json({ error: `OTOP API error ${resp.status}` });
    }
    const data: any = await resp.json().catch(() => null);
    // eslint-disable-next-line no-console
    console.log("[otop] raw =", JSON.stringify(data).slice(0, 400)); // see real shape once

    const profile = normalize(data);
    if (!profile || !profile.idNumber) {
      return res.json({ configured: true, verified: false, profile: null });
    }
    return res.json({ configured: true, verified: true, profile });
  } catch (err: any) {
    const message = err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ OTOP API" : err?.message || "ตรวจสอบทะเบียนไม่สำเร็จ";
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
