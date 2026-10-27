import express from "express";
import cors from "cors";
import { config, isAiConfigured } from "./config";
import aiSummaryRouter from "./routes/aiSummary";
import aiCaptionRouter from "./routes/aiCaption";
import aiChatRouter from "./routes/aiChat";
import tripsRouter from "./routes/trips";
import foldersRouter from "./routes/folders";
import placesRouter from "./routes/places";
import hostPlaceRouter from "./routes/hostPlace";
import otopRouter from "./routes/otop";
import accountRouter from "./routes/account";
import { seedMemorySummary } from "./summaryStore";
import { pingAi } from "./aiCore";
import { requestContext, requestId } from "./middleware/requestContext";
import { notFoundHandler, errorHandler } from "./middleware/errors";

/**
 * Builds the configured Express app (no listen()).
 * Reused by both the local server (server.ts) and the Vercel handler (api/index.ts).
 */
export function createApp() {
  const app = express();

  app.set("trust proxy", true);

  // FIRST: every request gets an id + a one-line access log.
  app.use(requestContext);

  app.use(cors({
    // The app reads this to correlate a failed call with a backend log line.
    exposedHeaders: ["x-request-id"],
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    let upstreamHost = "";
    try {
      upstreamHost = config.ai.baseUrl ? new URL(config.ai.baseUrl).host : "";
    } catch {
      upstreamHost = config.ai.baseUrl;
    }
    res.json({
      ok: true,
      aiConfigured: isAiConfigured(),
      model: config.ai.model,
      upstreamHost,
      // Length only — never the token itself. Tells us "set, but how long".
      tokenLength: config.ai.authToken.length,
      timeoutMs: config.ai.timeoutMs,
      maxTokens: config.ai.maxTokens,
      supabaseConfigured: Boolean(config.supabase.url && config.supabase.serviceRoleKey),
      placesConfigured: Boolean(config.places.googleKey),
      nodeVersion: process.version,
      uptimeSec: Math.round(process.uptime()),
      requestId: requestId(req),
    });
  });

  /**
   * Fires ONE real request at the AI provider (max_tokens: 1) and reports the
   * result. `/health` says the process is alive; only this says whether the
   * token actually works.
   */
  app.get("/health/ping-ai", async (req, res) => {
    const result = await pingAi();
    res.status(result.ok ? 200 : 502).json({ ...result, requestId: requestId(req) });
  });

  app.use("/ai-summary", aiSummaryRouter);
  app.use("/ai-caption", aiCaptionRouter);
  app.use("/ai-chat", aiChatRouter);
  app.use("/trips", tripsRouter);
  app.use("/folders", foldersRouter);
  app.use("/places", placesRouter);
  // Mounted after placesRouter on purpose: /places/verify is a real GET route
  // there, and Express only falls through to the next handler when nothing
  // matched. Keeping the host write on its own path avoids any ordering
  // question about which router owns /places/*.
  app.use("/places", hostPlaceRouter);
  app.use("/otop", otopRouter);

  // Seed demo summaries (memory-only; post-1/2/3 are not real DB video ids).
  // Real summaries are persisted in Supabase via POST /ai-summary/:id/generate.
  seedMemorySummary("post-1", {
    status: "ready",
    generatedAt: new Date().toISOString(),
    model: config.ai.model,
    text:
      "บ้านห้วยห้อม อ.แม่ลาน้อย จ.แม่ฮ่องสอน หมู่บ้านปกาเกอะญอกลางหุบเขา ตื่นเช้ามาดริปกาแฟอาราบิกาสดจากไร่ในชุมชน ท่ามกลางอากาศหนาวและวิวฝูงแกะ ชวนพักโฮมสเตย์สัมผัสวิถีชุมชนแบบช้าๆ",
    place: {
      place_name: "บ้านห้วยห้อม",
      location: { province: "แม่ฮ่องสอน", district: "แม่ลาน้อย", subdistrict: "ห้วยห้อม", gps: null },
      category: ["โฮมสเตย์", "ชุมชนชนเผ่า", "ไร่กาแฟ"],
      activities: ["ดริปกาแฟสด", "ชมฝูงแกะ", "พักโฮมสเตย์วิถีชุมชน"],
      price_info: { weekday: "450 - 500 บาท/คืน (รวมอาหารเช้า)", weekend: null, currency: "THB" },
      contact: { phone: null, facebook: null, line: null },
      opening_hours: null,
      otop_products: ["กาแฟอาราบิกาอินทรีย์", "ผ้าทอขนแกะ"],
      highlights: ["กาแฟอาราบิกาจากไร่ชุมชน", "อากาศหนาวและสายหมอก", "วิถีปกาเกอะญอ"],
      tags: ["#แม่ฮ่องสอน", "#แม่ลาน้อย", "#ห้วยห้อม", "#กาแฟดอย", "#โฮมสเตย์"],
      confidence: {
        overall_confidence: 0.9,
        source_used: ["caption", "visual"],
        missing_info: ["เบอร์ติดต่อ", "พิกัด GPS"],
        warning: null,
      },
    },
    tags: ["#แม่ฮ่องสอน", "#แม่ลาน้อย", "#ห้วยห้อม", "#กาแฟดอย", "#โฮมสเตย์"],
    highlights: ["กาแฟอาราบิกาจากไร่ชุมชน", "อากาศหนาวและสายหมอก", "วิถีปกาเกอะญอ"],
    onScreenText: ["ห้วยห้อม 16°C", "Local"],
  });

  seedMemorySummary("post-2", {
    status: "ready",
    generatedAt: new Date().toISOString(),
    model: config.ai.model,
    text:
      "บ้านนาต้นจั่น อ.ศรีสัชนาลัย จ.สุโขทัย ชวนชิมข้าวเปิ๊บโบราณ นั่งรถอีแต๊กชมพระอาทิตย์ตกกลางทุ่งนา สัมผัสวิถีชุมชนอบอุ่นเหมือนได้กลับบ้านต่างจังหวัด",
    place: {
      place_name: "บ้านนาต้นจั่น",
      location: { province: "สุโขทัย", district: "ศรีสัชนาลัย", subdistrict: null, gps: null },
      category: ["โฮมสเตย์", "วิถีเกษตร", "อาหารพื้นถิ่น"],
      activities: ["ชิมข้าวเปิ๊บ", "นั่งรถอีแต๊ก", "ชมพระอาทิตย์ตกกลางทุ่งนา"],
      price_info: { weekday: "ราคาโดยประมาณ", weekend: null, currency: "THB" },
      contact: { phone: null, facebook: null, line: null },
      opening_hours: null,
      otop_products: ["ผ้าหมักโคลน", "ข้าวเปิ๊บ"],
      highlights: ["ข้าวเปิ๊บโบราณ", "นั่งรถอีแต๊กชมทุ่ง", "วิถีชุมชนอบอุ่น"],
      tags: ["#บ้านนาต้นจั่น", "#สุโขทัย", "#วิถีชุมชน", "#Local"],
      confidence: { overall_confidence: 0.85, source_used: ["caption", "visual"], missing_info: ["ราคา", "เบอร์ติดต่อ"], warning: null },
    },
    tags: ["#บ้านนาต้นจั่น", "#สุโขทัย", "#วิถีชุมชน", "#Local"],
    highlights: ["ข้าวเปิ๊บโบราณ", "นั่งรถอีแต๊กชมทุ่ง", "วิถีชุมชนอบอุ่น"],
    onScreenText: ["บ้านนาต้นจั่น", "สุโขทัย"],
  });

  seedMemorySummary("post-3", {
    status: "ready",
    generatedAt: new Date().toISOString(),
    model: config.ai.model,
    text:
      "บ้านปางห้า อ.แม่สาย จ.เชียงราย ชวนทำเวิร์กช็อปกระดาษสาจากใบไม้สด จิบชาอัสสัมหอมกรุ่นท่ามกลางสายหมอกยามเช้า สัมผัสงานหัตถกรรมพื้นถิ่นแบบใกล้ชิด",
    place: {
      place_name: "บ้านปางห้า",
      location: { province: "เชียงราย", district: "แม่สาย", subdistrict: null, gps: null },
      category: ["Workshop", "หัตถกรรม", "คาเฟ่"],
      activities: ["ทำกระดาษสา", "จิบชาอัสสัม", "ชมสายหมอกยามเช้า"],
      price_info: { weekday: "เวิร์กช็อป 150 - 300 บาท/ท่าน", weekend: null, currency: "THB" },
      contact: { phone: null, facebook: null, line: null },
      opening_hours: "เปิดทุกวัน 08:00 - 17:00",
      otop_products: ["กระดาษสา", "ชาอัสสัม"],
      highlights: ["เวิร์กช็อปกระดาษสา", "ชาอัสสัมหอมกรุ่น", "สายหมอกยามเช้า"],
      tags: ["#บ้านปางห้า", "#เชียงราย", "#หัตถกรรมไทย", "#Local"],
      confidence: { overall_confidence: 0.88, source_used: ["caption", "visual"], missing_info: ["เบอร์ติดต่อ"], warning: null },
    },
    tags: ["#บ้านปางห้า", "#เชียงราย", "#หัตถกรรมไทย", "#Local"],
    highlights: ["เวิร์กช็อปกระดาษสา", "ชาอัสสัมหอมกรุ่น", "สายหมอกยามเช้า"],
    onScreenText: ["บ้านปางห้า", "เชียงราย"],
  });

  // LAST: anything unrouted → JSON 404, anything thrown → JSON envelope.
  app.use("/account", accountRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
