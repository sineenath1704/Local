import { API_TIMEOUT_MS } from "./apiConfig";
import {
  ItineraryDay,
  TripBudget,
  TripRequestInput,
  TRAVEL_STYLES,
} from "../data/tripsData";
import { aiFetch, AiError, toastAiError } from "./aiHttp";

export interface GeneratedItinerary {
  title: string;
  summary: string;
  days: ItineraryDay[];
  budget: TripBudget;
  /**
   * Was this really written by the AI, or is it the offline template?
   * This used to be invisible: a 502 or a timeout silently produced a
   * plausible-looking itinerary with no marker at all.
   */
  source?: "ai" | "local-fallback";
  fallbackReason?: string;
  /** id ของแถวที่บันทึกไว้ใน `trip_plans` (null = ยังไม่ได้บันทึก) */
  planId?: string | null;
  /** backend บันทึกลง `trip_plans` สำเร็จไหม */
  persisted?: boolean;
  /** เหตุผลที่บันทึกไม่สำเร็จ (ถ้ามี) */
  persistReason?: string;
  /** backend อ่านโฟลเดอร์จริงได้ไหม (false = ใช้ชื่อสถานที่ที่ client ส่งมา) */
  folderResolved?: boolean;
  /** คำเตือนจาก backend เช่น โฟลเดอร์ยังไม่มีข้อมูลสถานที่ */
  folderWarning?: string | null;
}

/** ตัวเลือกเพิ่มเติมตอนเรียกตัวสร้างแพลน */
export interface GenerateTripOptions {
  /** รหัสโฟลเดอร์ต้นทาง — backend จะใช้สถานที่ในโฟลเดอร์เป็นจุดหมาย */
  folderId?: string | null;
  /** Supabase access token — จำเป็นเมื่อมี folderId */
  token?: string | null;
}

/**
 * ทำให้ข้อมูลที่ AI คืนมาใช้กับ UI ได้เสมอ
 * -----------------------------------------------------------------
 * โมเดลอาจตอบมาไม่ครบทุก field (เช่น stop ที่ไม่มี `stayHours`)
 * → ถ้าปล่อยผ่านไป หน้าทริปจะพังตอนอ่านค่าเลข (เช่น NaN หรือ crash)
 * ฟังก์ชันนี้เติมค่าเริ่มต้นให้ ไม่แตะข้อมูลที่มีอยู่แล้ว
 */
export function normalizeItineraryDays(days: unknown): ItineraryDay[] {
  if (!Array.isArray(days)) return [];
  return days.map((d: any, i: number) => ({
    ...d,
    day: Number(d?.day) || i + 1,
    ...(d?.date ? { date: String(d.date) } : {}),
    stops: (Array.isArray(d?.stops) ? d.stops : []).map((s: any) => ({
      ...s,
      name: String(s?.name ?? "จุดแวะ"),
      activity: String(s?.activity ?? ""),
      stayHours: Number(s?.stayHours) || 0,
      driveToNextMins: Number(s?.driveToNextMins) || 0,
    })),
  }));
}

/** เติมงบที่ขาดให้ครบ (UI อ่าน `perPerson.toLocaleString()` โดยตรง) */
export function normalizeTripBudget(budget: unknown): TripBudget {
  const b = (budget ?? {}) as any;
  const lodging = Number(b.lodging) || 0;
  const fuel = Number(b.fuel) || 0;
  const food = Number(b.food) || 0;
  const total = Number(b.total) || lodging + fuel + food;
  const perPerson = Number(b.perPerson) || total;
  return {
    lodging,
    fuel,
    food,
    total,
    perPerson,
    withinBudget: b.withinBudget !== false,
  };
}

function styleLabel(key: TripRequestInput["style"]): string {
  return TRAVEL_STYLES.find((s) => s.key === key)?.label ?? "โร้ดทริปเน้นธรรมชาติ";
}

/** Local fallback itinerary (if the backend is unreachable). */
function localItinerary(req: TripRequestInput): GeneratedItinerary {
  const stops = [req.startPoint, ...req.destinations];
  const perDay = Math.max(1, Math.ceil(stops.length / req.days));
  const days: ItineraryDay[] = [];
  let idx = 0;
  for (let d = 1; d <= req.days; d++) {
    const dayStops = [];
    for (let k = 0; k < perDay && idx < stops.length; k++, idx++) {
      dayStops.push({
        name: stops[idx],
        activity: d === 1 && k === 0 ? "เริ่มต้นเดินทาง" : "สำรวจชุมชน / พักผ่อน",
        stayHours: 2 + (k % 2),
        driveToNextMins: 60 + ((idx * 25) % 90),
      });
    }
    if (dayStops.length === 0) {
      dayStops.push({ name: "พักผ่อนอิสระ", activity: "เที่ยวชมรอบที่พัก", stayHours: 3, driveToNextMins: 0 });
    }
    days.push({ day: d, stops: dayStops });
  }
  const lodging = req.nights * 500;
  const fuel = req.days * 350;
  const food = req.days * 400;
  const total = lodging + fuel + food;
  return {
    title: `ทริป ${req.destinations[0] ?? req.startPoint} ${req.days} วัน`,
    summary: `โร้ดทริปสไตล์ ${styleLabel(req.style)} เริ่มจาก ${req.startPoint}`,
    days,
    budget: { lodging, fuel, food, total, perPerson: total, withinBudget: total <= req.budgetPerPerson },
    source: "local-fallback",
  };
}

/**
 * Ask the backend to generate a road-trip itinerary from the wizard inputs.
 *
 * Always resolves — but `source` tells the caller whether the AI actually
 * produced it. On failure we still return a usable plan (the app would be
 * useless otherwise) *and* record the real reason, so the UI can badge it and
 * the diagnostics screen can show what went wrong.
 */
export async function generateTrip(
  req: TripRequestInput,
  opts?: GenerateTripOptions
): Promise<GeneratedItinerary> {
  const payload = {
    startPoint: req.startPoint,
    destinations: req.destinations,
    days: req.days,
    nights: req.nights,
    budgetPerPerson: req.budgetPerPerson,
    style: styleLabel(req.style),
    // ถ้ามีโฟลเดอร์ → backend เป็นคนเลือกจุดหมายจากข้อมูลจริงในโฟลเดอร์
    folderId: opts?.folderId ?? undefined,
  };

  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const local = (reason: string): GeneratedItinerary => ({
    ...localItinerary(req),
    fallbackReason: reason,
  });

  try {
    const data = await aiFetch<GeneratedItinerary & { fallback?: GeneratedItinerary; error?: string }>({
      label: "trips/generate",
      path: "/trips/generate",
      method: "POST",
      headers,
      body: payload,
      timeoutMs: API_TIMEOUT_MS * 4,
      onSettled: (ok, error) => {
        if (!ok && error) toastAiError(error);
      },
    });

    if (Array.isArray(data?.days) && data?.budget) {
      return {
        ...data,
        days: normalizeItineraryDays(data.days),
        budget: normalizeTripBudget(data.budget),
        source: data.source ?? "ai",
      };
    }
    return local(data?.fallbackReason ?? "AI ตอบมาไม่ใช่ข้อมูลทริปที่ใช้ได้");
  } catch (err: any) {
    if (err instanceof AiError) {
      // The backend sends a `fallback` alongside the error — prefer it over
      // rebuilding locally, and keep the real reason either way.
      //
      // The envelope is `{error, code, requestId, fallback: {...}}` → the
      // itinerary lives one level down. Reading the top level instead used to
      // hand back an object with no `days`/`budget` at all, and the trip
      // screen then crashed on it.
      const parsed = safeParse<any>(err.body);
      const fallback =
        parsed && Array.isArray(parsed.fallback?.days)
          ? {
              ...parsed.fallback,
              days: normalizeItineraryDays(parsed.fallback.days),
              budget: normalizeTripBudget(parsed.fallback.budget),
            }
          : null;
      return {
        ...(fallback ?? localItinerary(req)),
        fallbackReason: err.message,
      };
    }
    return local(err?.message ?? "เรียก AI ไม่สำเร็จ");
  }
}

/** `AiError.body` may be a JSON string, an upstream string, or anything. */
function safeParse<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}
