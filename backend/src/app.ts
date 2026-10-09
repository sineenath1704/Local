import express from "express";
import cors from "cors";
import { config, isAiConfigured } from "./config";
import aiSummaryRouter from "./routes/aiSummary";
import aiChatRouter from "./routes/aiChat";
import tripsRouter from "./routes/trips";
import { saveSummary } from "./summaryStore";

/**
 * Builds the configured Express app (no listen()).
 * Reused by both the local server (server.ts) and the Vercel handler (api/index.ts).
 */
export function createApp() {
  const app = express();

  app.use(cors()); // allow the Expo app (any origin) to call
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, aiConfigured: isAiConfigured(), model: config.ai.model });
  });

  app.use("/ai-summary", aiSummaryRouter);
  app.use("/ai-chat", aiChatRouter);
  app.use("/trips", tripsRouter);

  // Seed a demo summary so GET returns real data immediately.
  // NOTE: on Vercel this in-memory store resets per cold start — fine for the
  // seeded demo; real summaries should be persisted in the DB (Supabase).
  saveSummary("post-1", {
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

  return app;
}
