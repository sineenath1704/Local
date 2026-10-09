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

| Name | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://nrrai2-model.sit.kmutt.ac.th/api` |
| `ANTHROPIC_AUTH_TOKEN` | your real token |
| `ANTHROPIC_MODEL` | `minimax-m3` |
| `AI_TIMEOUT_MS` | `120000` |
| `AI_MAX_TOKENS` | `1024` |

Then redeploy so they take effect:
```bash
vercel --prod
```

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
