import { createApp } from "./app";
import { config, isAiConfigured } from "./config";

/** Local dev server (not used on Vercel — Vercel uses api/index.ts). */
const app = createApp();

app.listen(config.port, () => {
  console.log(`\n🚀 Local AI backend running at http://localhost:${config.port}`);
  console.log(`   (LAN devices use http://<your-pc-ip>:${config.port})`);
  console.log(`   GET  /health            → config + runtime info`);
  console.log(`   GET  /health/ping-ai    → ยิง AI จริง 1 ครั้ง บอกว่า token ใช้ได้ไหม`);
  console.log(`   GET  /ai-summary/:postId`);
  console.log(`   POST /ai-summary/:postId/generate`);
  console.log(`   POST /ai-chat`);
  console.log(`   POST /trips/generate`);
  console.log(
    `   AI configured: ${isAiConfigured() ? "yes" : "no (using stub responses)"}`
  );
  console.log(`   Every response carries an x-request-id header.\n`);
});
