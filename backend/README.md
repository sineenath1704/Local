# Local — AI Summary Backend

Backend ตัวอย่าง (Node.js + Express + TypeScript) สำหรับสร้างและให้บริการ "สรุปวิดีโอด้วย AI"
ให้แอป Local ดึงไปแสดงในแท็บ **สรุปจากเอไอ** ของหน้าคอมเมนต์

## ทำไมต้องมี backend นี้

มือถือ **ไม่ควร** ประมวลผลวิดีโอเอง (หนัก + ช้า) และ **ห้าม** ฝัง token ของ AI ไว้ในแอป
(เพราะดึงออกจาก bundle ได้) ดังนั้น:

```
เจ้าของอัปโหลดวิดีโอ
   │
   ▼
POST /ai-summary/:postId/generate   ← ส่งผล Speech-to-Text + Vision เข้ามา
   │
   ├─ LLM (ใช้ prompt จาก src/prompt.ts)
   ▼
เก็บสรุปไว้ (summaryStore / DB)
   │
   ▼
GET /ai-summary/:postId             ← แอปดึงมาแสดงทันที ไม่ต้องรอ AI
```

## แก้ Prompt ได้ที่ไหน

➡️ **`src/prompt.ts`** ไฟล์เดียว — มีทั้ง `SYSTEM_PROMPT` และ `buildSummaryPrompt()`
แก้คำสั่ง/ภาษา/รูปแบบ output ได้เลย ไม่ต้องแตะไฟล์อื่น

## ติดตั้ง & รัน

```bash
cd backend
cp .env.example .env     # แล้วใส่ค่า ANTHROPIC_* ของจริง (บน Windows ใช้ copy .env.example .env)
npm install
npm run dev              # dev mode (auto-reload)
# หรือ
npm run build && npm start
```

> ถ้ายังไม่ใส่ token ก็รันได้ — ระบบจะคืนข้อความ stub แทน (status: "unavailable")

## Environment variables (`.env`)

| ตัวแปร | ความหมาย |
|---|---|
| `PORT` | พอร์ตเซิร์ฟเวอร์ (ค่าเริ่มต้น 4000) |
| `ANTHROPIC_BASE_URL` | base URL ของ AI endpoint |
| `ANTHROPIC_AUTH_TOKEN` | token (อยู่บน server เท่านั้น) |
| `ANTHROPIC_MODEL` | ชื่อโมเดล เช่น `minimax-m3` |
| `AI_TIMEOUT_MS` | timeout ตอนเรียก AI |
| `AI_MAX_TOKENS` | จำนวน token สูงสุดของคำตอบ |

## Endpoints

### `GET /health`
ตรวจสถานะ + ว่าตั้งค่า AI แล้วหรือยัง

### `GET /ai-summary/:postId`
ให้แอปดึง "สรุปที่คำนวณไว้แล้ว" — 200 ถ้ามี, 404 ถ้ายังไม่ถูกประมวลผล

### `POST /ai-summary/:postId/generate`
เรียกตอนอัปโหลดวิดีโอ เพื่อสร้างสรุป (ไม่ใช่ตอนผู้ใช้กดคอมเมนต์)

ตัวอย่าง body:
```json
{
  "transcript": "วันนี้เราจะพาไปเที่ยวบ้านแม่กำปอง...",
  "visualTags": ["คาเฟ่", "น้ำตก", "หมู่บ้านกลางหุบเขา"],
  "onScreenText": ["แม่กำปอง", "เชียงใหม่"],
  "caption": "พาเที่ยวแม่กำปอง",
  "location": "เชียงใหม่"
}
```

ลองด้วย curl:
```bash
curl -X POST http://localhost:4000/ai-summary/post-2/generate \
  -H "Content-Type: application/json" \
  -d '{"transcript":"พาเที่ยวบ้านแม่กำปอง","visualTags":["คาเฟ่","น้ำตก"],"location":"เชียงใหม่"}'
```

## เชื่อมกับแอป Local

แก้ `mobile/src/services/aiSummaryService.ts` ให้ `fetchAiSummary` เรียก backend นี้แทนการอ่าน local:

```ts
const API_BASE_URL = "http://10.0.2.2:4000"; // Android emulator → localhost ของเครื่อง
// iOS simulator ใช้ http://localhost:4000
// อุปกรณ์จริง ใช้ IP ของเครื่องใน LAN เช่น http://192.168.1.20:4000

export async function fetchAiSummary(postId: string) {
  const res = await fetch(`${API_BASE_URL}/ai-summary/${postId}`);
  if (!res.ok) return null;
  return (await res.json());
}
```
