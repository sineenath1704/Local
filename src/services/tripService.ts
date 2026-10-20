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
export async function generateTrip(req: TripRequestInput): Promise<GeneratedItinerary> {
  const payload = {
    startPoint: req.startPoint,
    destinations: req.destinations,
    days: req.days,
    nights: req.nights,
    budgetPerPerson: req.budgetPerPerson,
    style: styleLabel(req.style),
  };

  const local = (reason: string): GeneratedItinerary => ({
    ...localItinerary(req),
    fallbackReason: reason,
  });

  try {
    const data = await aiFetch<GeneratedItinerary & { fallback?: GeneratedItinerary; error?: string }>({
      label: "trips/generate",
      path: "/trips/generate",
      method: "POST",
      body: payload,
      timeoutMs: API_TIMEOUT_MS * 4,
      onSettled: (ok, error) => {
        if (!ok && error) toastAiError(error);
      },
    });

    if (Array.isArray(data?.days) && data?.budget) {
      return { ...data, source: data.source ?? "ai" };
    }
    return local(data?.fallbackReason ?? "AI ตอบมาไม่ใช่ข้อมูลทริปที่ใช้ได้");
  } catch (err: any) {
    if (err instanceof AiError) {
      // The backend sends a `fallback` alongside the error — prefer it over
      // rebuilding locally, and keep the real reason either way.
      const fallback = safeParse<GeneratedItinerary>(err.body);
      return { ...(fallback ?? localItinerary(req)), fallbackReason: err.message };
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
