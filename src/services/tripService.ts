import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";
import {
  ItineraryDay,
  TripBudget,
  TripRequestInput,
  TRAVEL_STYLES,
} from "../data/tripsData";

export interface GeneratedItinerary {
  title: string;
  summary: string;
  days: ItineraryDay[];
  budget: TripBudget;
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
  };
}

/** Ask the backend to generate a road-trip itinerary from the wizard inputs. */
export async function generateTrip(req: TripRequestInput): Promise<GeneratedItinerary> {
  const payload = {
    startPoint: req.startPoint,
    destinations: req.destinations,
    days: req.days,
    nights: req.nights,
    budgetPerPerson: req.budgetPerPerson,
    style: styleLabel(req.style),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 4);
  try {
    const res = await fetch(`${API_BASE_URL}/trips/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.fallback) return data.fallback as GeneratedItinerary;
      return localItinerary(req);
    }
    const data = await res.json();
    if (Array.isArray(data?.days) && data?.budget) {
      return data as GeneratedItinerary;
    }
    return localItinerary(req);
  } catch {
    return localItinerary(req);
  } finally {
    clearTimeout(timer);
  }
}
