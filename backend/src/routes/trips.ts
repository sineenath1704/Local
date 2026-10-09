import { Router, Request, Response } from "express";
import { callAi, extractJson, isAiConfigured } from "../aiCore";
import { TRIP_SYSTEM_PROMPT, buildTripPrompt, TripRequest } from "../tripPrompt";

const router = Router();

/** Build a reasonable offline itinerary when AI isn't configured. */
function stubItinerary(req: TripRequest) {
  const stops = [req.startPoint, ...req.destinations];
  const perDay = Math.max(1, Math.ceil(stops.length / req.days));
  const days = [];
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
    summary: `โร้ดทริปสไตล์ ${req.style} เริ่มจาก ${req.startPoint}`,
    days,
    budget: {
      lodging,
      fuel,
      food,
      total,
      perPerson: total,
      withinBudget: total <= req.budgetPerPerson,
    },
    source: "stub",
  };
}

/**
 * POST /trips/generate
 * -------------------------------------------------------------
 * Turn wizard inputs (+ clips chosen from a folder) into a road-trip itinerary.
 *
 * Body: TripRequest {
 *   startPoint, destinations[], days, nights, budgetPerPerson, style
 * }
 */
router.post("/generate", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const tripReq: TripRequest = {
    startPoint: String(b.startPoint ?? "").trim() || "สนามบินเชียงใหม่",
    destinations: Array.isArray(b.destinations) ? b.destinations : [],
    days: Number(b.days) > 0 ? Number(b.days) : 3,
    nights: Number(b.nights) >= 0 ? Number(b.nights) : 2,
    budgetPerPerson: Number(b.budgetPerPerson) > 0 ? Number(b.budgetPerPerson) : 3000,
    style: String(b.style ?? "").trim() || "โร้ดทริปเน้นธรรมชาติ",
  };

  if (!isAiConfigured()) {
    return res.json(stubItinerary(tripReq));
  }

  try {
    const raw = await callAi({
      system: TRIP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildTripPrompt(tripReq) }],
      maxTokens: 2048,
    });
    const parsed = extractJson(raw);
    if (parsed && Array.isArray(parsed.days)) {
      return res.json({ ...parsed, source: "ai" });
    }
    // AI replied but not valid JSON → fall back to a usable plan.
    return res.json(stubItinerary(tripReq));
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ AI" : err?.message || "สร้างแผนไม่สำเร็จ";
    return res.status(502).json({ error: message, fallback: stubItinerary(tripReq) });
  }
});

export default router;
