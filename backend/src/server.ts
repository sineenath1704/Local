import { createApp } from "./app";
import { config, isAiConfigured } from "./config";

/** Local dev server (not used on Vercel — Vercel uses api/index.ts). */
const app = createApp();

app.listen(config.port, () => {
  console.log(`\n🚀 Local AI backend running at http://localhost:${config.port}`);
  console.log(`   (LAN devices use http://<your-pc-ip>:${config.port})`);
  console.log(`   GET  /health`);
  console.log(`   GET  /ai-summary/:postId`);
  console.log(`   POST /ai-summary/:postId/generate`);
  console.log(`   POST /ai-chat`);
  console.log(`   POST /trips/generate`);
  console.log(
    `   AI configured: ${isAiConfigured() ? "yes" : "no (using stub responses)"}\n`
  );
});
