# Deploy the Local AI backend to Vercel

The backend runs as Vercel serverless functions. `api/index.ts` is the entry;
`vercel.json` routes every path to it. No long-running server needed.

## 1. Install the Vercel CLI (once)
```bash
npm i -g vercel
```

## 2. Log in
```bash
vercel login
```

## 3. Deploy (run inside the `backend/` folder)
```bash
cd backend
vercel            # first run: links/creates the project (answer the prompts)
vercel --prod     # deploy to production → gives you a public https URL
```
You'll get a URL like `https://local-ai-backend.vercel.app`.

## 4. Set environment variables on Vercel (NOT in code)
Dashboard → your project → **Settings → Environment Variables**, add:

| Name | Value | จำเป็น? |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `https://nrrai2-model.sit.kmutt.ac.th/api` | จำเป็น |
| `ANTHROPIC_AUTH_TOKEN` | your real token | จำเป็น |
| `ANTHROPIC_MODEL` | `minimax-m3` | ไม่ (default เหมือนกัน) |
| `AI_TIMEOUT_MS` | `120000` | ไม่ (default เหมือนกัน) |
| `AI_MAX_TOKENS` | `32768` | **ไม่** — ค่าเริ่มต้นใน `src/config.ts` คือ 32768 อยู่แล้ว |

Then redeploy so they take effect:
```bash
vercel --prod
```

> ⚠️ **ระวังเรื่อง "env ที่ไม่ได้ตั้ง"**
>
> ค่าที่ไม่ได้ตั้งบน Vercel จะไปใช้ **default ใน `src/config.ts`** เงียบ ๆ
> เคยเกิดกรณีนี้กับ `AI_MAX_TOKENS`: ไม่มีใน dashboard → ไปใช้ default **1024**
> → โมเดลตอบกลาง JSON → `place` ว่าง → Google Places ไม่มีอะไรให้ค้น
> → ผู้ใช้เห็นสรุปเปล่า โดยไม่มี error ให้ตัวไหน
>
> ตอนนี้ default เป็น 32768 (พอสำหรับ prompt ~70 คีย์) และเซิร์ฟเวอร์จะเตือนตอน
> เริ่มถ้างบน้อยกว่า 4096 + ถ้าคำตอบถูกตัด ระบบจะลองใหม่ด้วยงบ 32768 อัตโนมัติ
> ดูรายงาน `รายงานการวิเคราะห์` ในแอปได้ว่าติดตรงไหน

> `PORT` is NOT needed on Vercel (serverless handles it).

## 5. Point the mobile app at the deployed URL
In `mobile/.env`:
```
EXPO_PUBLIC_API_BASE_URL=https://local-ai-backend.vercel.app
```
Then restart Metro so Expo picks up the env change:
```bash
npx expo start --clear
```

## 6. Verify
```bash
curl https://local-ai-backend.vercel.app/health
# {"ok":true,"aiConfigured":true,"model":"minimax-m3"}
```

## Notes
- The in-memory summary store resets on cold starts — fine for the seeded demo.
  Real summaries should be persisted in Supabase (next step).
- CORS is open (`cors()`), so the Expo app can call it from any origin.
