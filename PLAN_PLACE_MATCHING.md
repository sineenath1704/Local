# 🧭 แผนแก้ไข: จับคู่สถานที่จากคลิป → Google Places → ยืนยัน → สถานที่ในชุมชน

> **สถานะ:** ร่างแผน (ยังไม่ลงมือแก้ไฟล์ใด ๆ)
> **วันที่:** 2026-10-26
> **ขอบเขต:** หน้าโพสต์วิดีโอ → การยืนยันสถานที่ → บันทึกเข้าชุมชน → AI แชทอ่านรายการสถานที่ของชุมชน
> **หลักฐาน:** อ้างอิงไฟล์:บรรทัดจริงทุกข้อ (ตรวจด้วย grep/read แล้ว)

---

## 0. สรุปผู้บริหาร

โจทย์เดิม: *"สถานที่ที่อ่านได้จากคลิป → ค้น Google Places → ตรงกับที่ชุมชนลงทะเบียนไว้ไหม? ถ้าตรงให้กดยืนยัน / ถ้าไม่ตรงให้ไปค้นว่าอยู่ที่ไหนในชุมชนนั้น แล้วขึ้นเป็นสถานที่ใหม่ให้กดยืนยัน แล้วเอาข้อมูลที่ยืนยันไปใส่ข้อมูลสถานที่ใกล้เคียงในชุมชน"*

**สถานะปัจจุบัน: ยังไม่เป็นแบบนั้น** — มีโครงชิ้นส่วนที่ ① และปุ่ม UI ครบแล้ว แต่ขาดกลไกเทียบจริง (②) และกลไก "ค้นใหม่ในชุมชน" (③)

| ส่วน | สถานะ | หมายเหตุ |
|---|---|---|
| ① ดึงสถานที่จากคลิป → ค้น Google | ✅ ใช้งานได้ | `enrichWithGooglePlaces` — 1 ครั้งค้น / 1 ครั้งดึง detail |
| ② เทียบกับทะเบียนของชุมชน | ❌ ไม่มี | ทั้ง codebase ไม่มีการเทียบ `place_id` ของ candidate กับของทะเบียนเลย |
| ③ ค้นใหม่ในชุมชน + สถานที่ใหม่ → บันทึกเข้าชุมชน | ❌ ไม่มี | ปุ่ม "✕ ไม่ถูกต้อง" ล้างข้อมูลทิ้ง ไม่ใช่ค้นใหม่; ไม่มีความสัมพันธ์ชุมชน↔สถานที่ |

---

## 1. การตัดสินใจที่ผู้ใช้เลือก (ต้องยึด)

| # | หัวข้อ | การตัดสินใจ | ผลกระทบต่อแผน |
|---|---|---|---|
| D1 | แหล่งความจริงของสถานที่ | **`community_places` เป็นแหล่งจริง** — `places` คงเป็น cache ตอนโพสต์ | ไม่ต้องแตะตาราง `places` ที่ใช้งานได้ |
| D2 | เกณฑ์การเทียบ | **เทียบด้วย Google place id อย่างเดียว** | ต้อง migration เพิ่ม `users.business_place_id` |
| D3 | บริบท AI แชท | **ส่งหลายสถานที่** | แก้ `aiChat.ts` ในเฟส 2 |
| D4 | กลไกชุมชน↔สถานที่ | **ใช้ `community_id`** (ไม่ใช้ text `village`) | ต้องกู้ตาราง `communities` มาใช้งานจริง — ต้อง ALTER ก่อน (ดู 2.2) |
| D5 | โหมด own_business | **ตรวจเทียบเสมอ** (ไม่ล็อกลอย ๆ) | โหมดนี้เปลี่ยนพฤติกรรมเต็ม |
| D6 | สิทธิ์ tourist | **บันทึกได้ แต่แก้ข้อมูลไม่ได้** | ต้องแยกสิทธิ์ใน backend + ซ่อนการ์ดแก้ไข |
| D7 | การเช็ค cache ก่อนค้น Google | **ค้นด้วย id เท่านั้น** (เลิก ILIKE ชื่อ) | แก้ `findLocalPlaces` |
| D8 | ขอบเขต | **2 เฟส** | เฟส 1 = หน้าโพสต์, เฟส 2 = AI แชท + โปรไฟล์ชุมชน |

---

## 2. บั๊กที่พบระหว่างสืบค้น (ต้องแก้ก่อนทุกอย่าง)

### 2.1 🔴 `place_id` มี timestamp → บันทึกซ้ำได้แถวใหม่ทุกครั้ง

`community_places.place_id` เป็น `TEXT UNIQUE` ([create_community_places.sql:11](supabase/migrations/create_community_places.sql#L11)) และทุกเส้นทางเขียนใช้ `on conflict (place_id) do update` → **ถ้า `place_id` เปลี่ยนทุกครั้ง จะได้แถวใหม่ทุกครั้ง ไม่ใช่แก้แถวเดิม**

พบ **3 รูปแบบ id ที่ขัดกัน** — host คนเดียวกันอาจได้แถวแยกกัน 3 แถว:

| ที่อยู่ | รูปแบบ | ปัญหา |
|---|---|---|
| [OnboardingScreen.tsx:273](src/Pages/Auth/OnboardingScreen.tsx#L273) | `otop-${villageId}-${Date.now()}` | 🔴 **มี timestamp → บันทึกซ้ำได้แถวใหม่ทุกครั้ง** |
| [ProfileLocal.tsx:348](src/Pages/ProfileLocal.tsx#L348) | `otop-fallback-${otop_village_id \|\| user.id \|\| Date.now()}` | 🟡 ไม่มี timestamp แต่ **รูปแบบต่างจาก `host-${uid}`** → host เดียวกันอาจมี 2 แถว |
| [hostPlaceService.ts:106](src/services/hostPlaceService.ts#L106) | `host-${userId}` | ✅ ถูกต้อง (คอมเมนต์ L99-105 เขียนเตือนไว้แล้ว) |

**แก้:** ทั้ง 3 ทางให้ใช้ `syntheticPlaceId(user.id)` ที่เดียว

> ⚠️ **ผลกระทบต่อ D2:** ถ้า `business_place_id` เป็น `host-…` หรือ `otop-…` → **ไม่ใช่ Google id** → เทียบกับ candidate จาก Google ไม่ได้เลย → โหมด own_business จะตกไปทาง "ไม่ตรง" ทุกครั้ง

> **ข้อเสนอ:** บังคับให้ host ในโหมด own_business **ต้องเลือกหมุด Google** — ปัจจุบันมี fallback ที่ไม่มี Google pin อยู่ 2 ที่ (`applyOtopFallbackPin` [OnboardingScreen.tsx:258](src/Pages/Auth/OnboardingScreen.tsx#L258), `applyBizOtopFallback` [ProfileLocal.tsx:337](src/Pages/ProfileLocal.tsx#L337)) ไม่งั้น D2 จะใช้ไม่ได้จริง

### 2.2 🔴 ตาราง `communities` ใช้เป็น registry ไม่ได้ตรง ๆ ต้อง ALTER ก่อน

`communities` เป็น **dead schema** (grep ทั้ง `src/` + `backend/` ไม่พบการอ่าน/เขียนเลย) แต่ถ้าจะกู้มาใช้ตาม D4 ต้องแก้ 3 อย่างก่อน ไม่งั้น backfill ทำไม่ได้:

| คอลัมน์ | ปัญหา | ที่มาของข้อมูล |
|---|---|---|
| `host_user_id uuid not null … on delete cascade` | โครงสร้าง "1 host = 1 ชุมชน" ขัดกับ "1 ชุมชนมีหลาย host"; และ **ลบบัญชี host → ลบชุมชนทั้งแถว** (cascade ไป `services`/`bookings`/`passport_stamps` ด้วย) | ต้องย้ายความเป็นเจ้าของไปที่ `users.community_id` |
| `latitude/longitude double precision not null` | **ไม่มีแหล่งข้อมูล** — ชุดข้อมูล OTOP (`thailand_hierarchy.json`) ไม่มีพิกัด (`PlaceItem` มีแค่ id/name/subdistrict/district/province/region), CDD API (`otop.ts`) ไม่คืน lat/lng, `community_registrations` ไม่มีคอลัมน์พิกัด | ผ่อน NOT NULL (หรือคำนวณ centroid จาก `community_places` ภายหลัง) |
| `capacity_per_day int not null check (capacity_per_day > 0)` | **ไม่มีแหล่งข้อมูล** — `community_registrations.carrying_capacity` เป็น varchar และเป็นตารางที่ไม่มีโค้ดใช้ | ผ่อน NOT NULL + ตัด CHECK |

คอลัมน์ text ที่เหลือมีแหล่งข้อมูลครบจาก `users` ([add_otop_registration.sql:15-19](supabase/migrations/add_otop_registration.sql#L15-L19)): `name`←`otop_village`, `region`←`otop_region`, `province`←`otop_province`, `district`←`otop_amphur`, `subdistrict`←`otop_tambol`

### 2.3 🟡 RPC `host_save_business_profile` ตัด field แบบ allowlist

[add_community_places_structured.sql:108-118](supabase/migrations/add_community_places_structured.sql#L108-L118) — field ที่ไม่อยู่ใน allowlist จะ **โยน error `unknown field`** ไม่ใช่ข้าม ดังนั้น `business_place_id` และ `community_id` ที่จะเพิ่ม **ต้องแก้ allowlist ใน RPC ด้วย** ไม่ใช่แค่เพิ่มคอลัมน์ในตาราง

### 2.4 🟡 RLS policy ของ `community_places` หลวม

[create_community_places.sql:43-46](supabase/migrations/create_community_places.sql#L43-L46):
```sql
WITH CHECK (auth.uid() = owner_id OR auth.uid() IS NOT NULL)
```
เงื่อนไขหลังทำให้เงื่อนไขแรกเป็นจริงเสมอ → **authenticated ใครก็ insert แถวที่ `owner_id` ของคนอื่นได้** ปัจจุบันยังไม่เป็นปัญหาเพราะ backend ใช้ service role (ข้าม RLS) แต่พอ D6 เปิดให้ tourist บันทึกได้ ต้องแก้ให้ตรงกัน

### 2.5 🟡 `saveVerifiedPlace` เองก็ค้นด้วยชื่อแบบ fuzzy

[placesLocalService.ts:88-92](src/services/placesLocalService.ts#L88-L92) — ก่อน insert จะเรียก `findLocalPlaces` ด้วยชื่อ ซึ่งค้นแบบ `ILIKE %name%` → ต้องเปลี่ยนเป็น id ตาม D7 ทั้งฟังก์ชัน

---

## 3. เฟส 1 — หน้าโพสต์

### 3.1 Migration — `supabase/migrations/add_place_matching.sql` (ไฟล์ใหม่)

```sql
-- ── 1) id ของ Google สำหรับสถานที่ที่ host ลงทะเบียนไว้ ──────────────
alter table public.users
  add column if not exists business_place_id text;     -- Google Place ID

-- ── 2) ปลดล็อกตาราง communities ให้ใช้เป็น registry ได้จริง ─────────
--    host_user_id เดิม NOT NULL + on delete cascade → ย้ายความเป็นเจ้าของ
--    ไปที่ users.community_id (ด้านล่าง) แล้วให้แถวชุมชนไม่ตายตาม host
alter table public.communities
  alter column host_user_id drop not null;
alter table public.communities
  drop constraint if exists communities_host_user_id_fkey;
alter table public.communities
  add constraint communities_host_user_id_fkey
  foreign key (host_user_id) references public.users(id) on delete set null;

--    lat/lng + capacity_per_day: ไม่มีแหล่งข้อมูล (ดู 2.2) → ผ่อนไว้ก่อน
alter table public.communities
  alter column latitude drop not null,
  alter column longitude drop not null,
  alter column capacity_per_day drop not null;
alter table public.communities
  drop constraint if exists communities_capacity_per_day_check;

--    ตัวระบุชุมชนที่เสถียร = CDD Village_ID (เลขทะเบียน OTOP)
alter table public.communities
  add column if not exists otop_village_id varchar(40);
create unique index if not exists idx_communities_village
  on public.communities(otop_village_id) where otop_village_id is not null;

-- ── 3) host → ชุมชน (หนึ่งชุมชนมี host ได้หลายคน) ──────────────────
alter table public.users
  add column if not exists community_id uuid
  references public.communities(id) on delete set null;

-- ── 4) สถานที่ → ชุมชน ──────────────────────────────────────────────
--    on delete set null: ลบชุมชนทิ้ง → สถานที่ต้องไม่หายตาม
alter table public.community_places
  add column if not exists community_id uuid
  references public.communities(id) on delete set null;
create index if not exists idx_cp_community
  on public.community_places(community_id);

-- ── 5) ดัชนีช่วยค้นสถานที่ในชุมชน (D7: ค้นด้วย id) ───────────────────
create index if not exists idx_places_google_id
  on public.places(google_place_id) where google_place_id is not null;
create unique index if not exists idx_cp_place_id
  on public.community_places(place_id) where place_id is not null;
```

> `idx_cp_place_id` — คอลัมน์ `place_id` เดิมเป็น `TEXT UNIQUE` แล้ว (ซึ่ง Postgres ใช้เป็น unique index อยู่แล้ว) ถ้ามีแถว `place_id IS NULL` หลายแถว การเพิ่ม unique index แบบ partial จะไม่ชน ปลอดภัย

**Backfill (สคริปต์แยก ต้องรันด้วยมือ 1 ครั้ง — ผมรัน migration ให้ไม่ได้ ต้องใช้สิทธิ์ SQL Editor ของ Supabase):**

| ขั้น | จาก | ไป |
|---|---|---|
| B1 | `users` ที่มี `otop_village_id` (จัดกลุ่มตามค่านี้) | สร้าง `communities` 1 แถวต่อ `otop_village_id` — เติม `name`/`region`/`province`/`district`/`subdistrict` จาก host คนแรกในกลุ่ม, `host_user_id` = host คนแรก, `lat/lng/capacity` = NULL, `is_verified` = `bool_or(otop_verified)` |
| B2 | `users.otop_village_id` | `users.community_id` → ชุมชนจาก B1 |
| B3 | `community_places` ที่ `owner_id` = host | `community_id` = ชุมชนของ host จาก B2 |
| B4 | `community_places` ที่ `place_id` ขึ้นต้นด้วย `host-`/`otop-` | `users.business_place_id` = NULL (ไม่ใช่ Google id) |
| B5 | `community_places` ที่ `place_id` เป็น Google id จริง (ขึ้นต้นด้วย `ChIJ`) | `users.business_place_id` = `place_id` |

> B5 คือการกู้ `business_place_id` ของ host ที่ลงทะเบียนแล้วแต่เลือกหมุด Google ไว้ — ทำให้ D2 ใช้ได้กับ host ที่มีอยู่แล้วโดยไม่ต้องให้ไปลงทะเบียนใหม่
>
> **หมายเหตุ:** B1/B5 ต้อง review ผลลัพธ์ด้วยตา เพราะ `place_id` ที่ขึ้นต้นด้วย `ChIJ` เป็นรูปแบบของ Google Place ID (ยืนยันจาก [places.ts:405-417](backend/src/routes/places.ts#L405-L417) ที่ query Google) แต่ควร spot-check ก่อนรันจริง

### 3.2 Backend

**3.2.1 `enrichWithGooglePlaces` รับ scope ใหม่** — [places.ts:380-463](backend/src/routes/places.ts#L380-L463)

```ts
export async function enrichWithGooglePlaces(
  summary: AiSummaryResult,
  scope?: LocationScope          // { community?, subdistrict?, district?, province? }
): Promise<AiSummaryResult>
```

- query เดิม: `place_name + community + district + province + "ประเทศไทย"` → **เติม scope.subdistrict** เข้าไป (ตอนนี้ค้นได้แค่ระดับอำเภอ)
- **กรองผลแบบ strict**: ถ้ามี scope → เก็บเฉพาะ candidate ที่ `subdistrict` ตรง (fallback: `district` ตรง) — ปัจจุบัน [places.ts:433-436](backend/src/routes/places.ts#L433-L436) กรองแค่ "อยู่ในไทย"
- ถ้ามี scope แล้วไม่เหลือ candidate → คืน `place.google_candidates = []` (ไม่ error) เพื่อให้ client เข้าสู่เส้นทาง "ค้นใหม่ในชุมชน"

**3.2.2 `/ai-summary/preview` + `/:postId/generate` รับ `locationScope`** — [aiSummary.ts:18-30](backend/src/routes/aiSummary.ts#L18-L30) (`readInput`), เรียกที่ [aiSummary.ts:109](backend/src/routes/aiSummary.ts#L109) และ [aiSummary.ts:167](backend/src/routes/aiSummary.ts#L167) — **2 จุด** ไม่ใช่จุดเดียว

> **เหตุผล:** โหมด `community_spot` ส่ง `uploaderType: "tourist"` และ `location: undefined` ([CreatePostScreen.tsx:333-337](src/Pages/CreatePostScreen.tsx#L333-L337)) → backend ไม่รู้ว่า host อยู่ชุมชนไหน → query scope ไม่ได้

**3.2.3 `POST /places/verify` — เพิ่มพารามิเตอร์ `strict`** — [places.ts:471-526](backend/src/routes/places.ts#L471-L526)

ปัจจุบันกรองแบบ *prefer* (ถ้าไม่ match ก็คืนของทั่วประเทศกลับมา ดู L488-517) → เพิ่ม `strict?: boolean`:
- `strict: true` → กรองจริงตาม province/district/subdistrict และถ้าไม่เหลือ → คืน `candidates: []`
- ใช้ตอน "ค้นใหม่ในชุมชน" (เส้นทาง ③)
- **default ต้องเป็น `false`** เพื่อไม่ให้ผู้เรียกเดิม (เช่น `ProfileLocal`) ได้ผลเปลี่ยน

**3.2.4 `POST /places/upsert-host-place` — เพิ่ม `communityId` + `businessPlaceId`** — [hostPlace.ts:30-58](backend/src/routes/hostPlace.ts#L30-L58) (allowlist) และ RPC ที่ [add_community_places_structured.sql:108-118](supabase/migrations/add_community_places_structured.sql#L108-L118)

- `USER_FIELDS` เพิ่ม `businessPlaceId` → `business_place_id`
- `PLACE_FIELDS` เพิ่ม `communityId` → `community_id`
- **RPC ต้องแก้ allowlist ด้วย** (2.3) และ `insert into community_places` ต้องเพิ่มคอลัมน์ `community_id`
- **`on conflict (place_id) do update` ต้องไม่ย้าย `owner_id`** — คงหลักเดิมไว้ ([add_community_places_structured.sql:174-191](supabase/migrations/add_community_places_structured.sql#L174-L191))

**3.2.5 `POST /places/save-place-details` — แยกสิทธิ์ host/tourist (D6)** — [places.ts:657-672](backend/src/routes/places.ts#L657-L672)

ปัจจุบันบล็อก `role !== "host"` → เปลี่ยนเป็น:

| บทบาท | เขียนแถวใหม่ได้ | แก้ `price_level`/`phone`/`opening_hours`/`website` | แก้ `capacity`/`house_rules`/`areas`/`facilities` |
|---|---|---|---|
| host | ✅ | ✅ | ✅ |
| tourist | ✅ (เฉพาะช่องที่ยังว่าง) | ❌ | ❌ |

**กฎ "เติมเฉพาะที่ยังว่าง" สำหรับ tourist:** ถ้าแถวมีอยู่แล้ว → update เฉพาะ column ที่ `IS NULL` เท่านั้น (ห้ามทับค่าที่เจ้าของสถานที่แก้ไว้ — ตรงกับหลัก "ค่าของเจ้าของสถานที่ชนะค่าของ Google" ที่มีอยู่แล้วใน `seedPlaceDetails`); ถ้าไม่มีแถว → insert ใหม่

> **ความปลอดภัย:** backend ใช้ service role → RLS ถูกข้าม → **การบล็อกต้องทำที่ backend** ไม่ใช่ฝากไว้ที่ RLS (แก้ policy ข้อ 2.4 ด้วยเพื่อให้ตรงกัน)

**3.2.6 จุดอ่าน `community_places` ตามชุมชน** — endpoint ใหม่ `GET /places/community?communityId=…` → คืนรายการสถานที่ของชุมชน (พร้อม `owner_id`, ราคา, เวลาเปิด, ข้อมูลจากคลิป)

### 3.3 Mobile — หน้าโพสต์

**3.3.1 เปลี่ยน `findLocalPlaces` ให้ค้นด้วย id (D7)** — [placesLocalService.ts:44-63](src/services/placesLocalService.ts#L44-L63)

`q.ilike("name", '%'+name+'%')` → `q.eq("google_place_id", googlePlaceId)` และ `saveVerifiedPlace` ต้องใช้ id ตรวจซ้ำแทนชื่อ (2.5)

> **เหตุผล:** การ match ด้วยชื่อแบบ ILIKE ทำให้ "บ้านปาย" ไปตรงกับ "บ้านปายใหม่" แล้ว **เลือกให้อัตโนมัติ** ([CreatePostScreen.tsx:484-487](src/Pages/CreatePostScreen.tsx#L484-L487)) แล้วเลิกค้น Google ทิ้ง — ขัดกับ docblock ของตัวเอง ("never auto-pick when more than one") และขัดกับ D2

**3.3.2 สร้างฟังก์ชันเทียบ "ตรงกับทะเบียน"** — ไฟล์ใหม่ `src/services/placeMatchService.ts`

```ts
export type MatchKind = "registered" | "none";

export function matchAgainstRegistered(
  candidates: PlaceCandidate[],
  registeredPlaceId: string | null
): { kind: MatchKind; candidate: PlaceCandidate | null } {
  if (!registeredPlaceId) return { kind: "none", candidate: null };
  const hit = candidates.find(c => c.placeId === registeredPlaceId) ?? null;
  return { kind: hit ? "registered" : "none", candidate: hit };
}
```

> D2 = "เทียบด้วย Google id อย่างเดียว" → **ไม่มีการเทียบด้วยชื่อหรือระยะทาง** ถ้า `registeredPlaceId` เป็น null หรือไม่ใช่ Google id → ถือว่า "ไม่ตรง" เสมอ

**3.3.3 ปรับ `runLocationVerify`** — [CreatePostScreen.tsx:419-495](src/Pages/CreatePostScreen.tsx#L419-L495)

```
runLocationVerify(place)
  │
  ├─ เติมฟอร์มจากที่ AI อ่านได้ (เหมือนเดิม :445-457)
  │
  ├─ ① มี candidate จาก backend ไหม?
  │    └─ เทียบ candidate.placeId === registeredPlaceId
  │         ├─ ตรง → การ์ด "✓ ตรงกับที่ลงทะเบียนของชุมชน"
  │         └─ ไม่ตรง → การ์ด "พบสถานที่อื่นในชุมชน" (เลือกได้)
  │              + ปุ่ม "ค้นหาใหม่ในชุมชนนี้"
  │
  ├─ ② ไม่มี candidate → เช็ค cache ตาราง places ด้วย id (D7)
  │         ├─ เจอ → ใช้เลย (เป็นสถานที่ที่ยืนยันไว้แล้ว)
  │         └─ ไม่เจอ → ค้น Google เอง (lookupOnGoogle)
  │
  └─ ③ ผู้ใช้กด "ไม่ใช่" / "ค้นหาใหม่ในชุมชนนี้" → searchInCommunity()
```

**3.3.4 การ์ด "ตรงกับที่ลงทะเบียน" (ใหม่)** — แยกจากการ์ด candidate ทั่วไป เพราะความหมายต่างกัน

```
┌─────────────────────────────────────────────┐
│ ✓ ตรงกับที่ลงทะเบียนของชุมชน              │
│   [ชื่อสถานที่ — อ่านได้ แก้ได้]              │
│   ที่อยู่ · ต./อ./จ.                        │
│   [ ✓ ยืนยันถูกต้อง ]  [ ✕ ไม่ใช่ที่นี่ ]   │
└─────────────────────────────────────────────┘
```

ปุ่ม "✕ ไม่ใช่ที่นี่" → **ไม่ล้างข้อมูล** แต่ไปสู่เส้นทาง ③ (ต่างจาก `clearLocation()` ปัจจุบันที่ล้างทุกอย่างที่ [CreatePostScreen.tsx:653-673](src/Pages/CreatePostScreen.tsx#L653-L673))

**3.3.5 `searchInCommunity()` — เส้นทาง ③ (ใหม่)**

```ts
await verifyPlaceOnGoogle({
  placeName,
  community: scopeCommunity,
  subdistrict: scopeSubdistrict,
  district: scopeDistrict,
  province: scopeProvince,
  strict: true,          // ← พารามิเตอร์ใหม่จาก 3.2.3
});
```

- scope สำหรับ host โหมด community_spot = ชุมชน/ตำบล/อำเภอ/จังหวัดของ host
- scope สำหรับ tourist = ค่าที่ AI อ่านได้ + ที่ผู้ใช้กรอก
- ผลลัพธ์ที่เจอ → ขึ้นเป็น **"สถานที่ใหม่ในชุมชน"** ให้กดยืนยัน (ต่างจาก candidate ทั่วไปด้วยป้ายกำกับ)

**3.3.6 โหมด own_business — ตรวจเทียบเสมอ (D5)** — [CreatePostScreen.tsx:364-380](src/Pages/CreatePostScreen.tsx#L364-L380)

เปลี่ยนจาก "ล็อกตำแหน่ง ไม่ตรวจ" เป็น:
- ส่ง `locationScope` = ชุมชน/ตำบล/อำเภอ/จังหวัดของ host → backend ค้น Google scoped
- ได้ candidate → เทียบกับ `user.business_place_id`
  - ตรง → การ์ด "✓ ตรงกับที่ลงทะเบียนของคุณ" → ยืนยัน → ใช้ตำแหน่งทะเบียน
  - ไม่ตรง → ขึ้นเป็น "สถานที่ใหม่ในชุมชน" → ยืนยัน → บันทึกเป็นสถานที่ของชุมชน
- **ไม่ตรงและไม่มี candidate** → เตือนว่าคลิปนี้อาจไม่ได้ถ่ายที่สถานที่ที่ลงทะเบียน → ให้ผู้ใช้เลือก (ยืนยันตำแหน่งทะเบียนไว้ หรือระบุใหม่) — **ไม่ล้างตำแหน่งทะเบียนทิ้ง**

> ⚠️ จุดที่พฤติกรรมเปลี่ยนมากที่สุด — โหมดนี้เคย "สำเร็จเสมอ" เพราะไม่เคยตรวจ ต้องมี fallback ที่ไม่ทำให้ host ที่ถ่ายที่ร้านถูก ๆ แต่ Google หาไม่เจอ ต้องโดนบล็อก

**3.3.7 บันทึกสถานที่ใหม่เข้าชุมชน** — [CreatePostScreen.tsx:551-605](src/Pages/CreatePostScreen.tsx#L551-L605) เพิ่ม `communityId`:
- host → `communityId = user.community_id`
- tourist → ต้องระบุชุมชน: หาก place อยู่ในตำบลที่มีชุมชนที่ลงทะเบียนไว้ 1 ชุมชน → ใช้ชุมชนนั้น / มากกว่า → ให้ผู้ใช้เลือกในการ์ดยืนยัน

**3.3.8 ซ่อนการ์ดแก้ไขรายละเอียดจาก tourist (D6)** — [CreatePostScreen.tsx:1427](src/Pages/CreatePostScreen.tsx#L1427) เงื่อนไข `isCommunityHost && confirmedPlace?.placeId && placeDetailsReady` → tourist ไม่เห็นการ์ด `PlaceDetailsCard`

**3.3.9 เขียน `community` ที่ยืนยันแล้วกลับลง summary** — [CreatePostScreen.tsx:237-264](src/Pages/CreatePostScreen.tsx#L237-L264) ปัจจุบันคง `place.community` ของ AI ไว้ ไม่ใช่ค่าที่ผู้ใช้ยืนยัน → ต้องเขียนค่าที่ยืนยันแล้วลงไปด้วย

### 3.4 ปรับช่องทะเบียนของ host ให้เก็บ Google id

- [AuthContext.tsx:170](src/state/AuthContext.tsx#L170) — เพิ่ม `business_place_id?: string | null` ใน user row (อ่านผ่าน `select("*")` แล้ว จึงแค่เพิ่ม field ใน type)
- [OnboardingScreen.tsx:273](src/Pages/Auth/OnboardingScreen.tsx#L273) — บันทึก `businessPlaceId` เมื่อยืนยันหมุด Google + **แก้บั๊ก timestamp** (2.1)
- [ProfileLocal.tsx:348](src/Pages/ProfileLocal.tsx#L348) — เหมือนกัน + แก้รูปแบบ id
- [hostPlaceService.ts:106](src/services/hostPlaceService.ts#L106) — `HostPlaceWrite.users` เพิ่ม `businessPlaceId`

### 3.5 ไฟล์ที่เฟส 1 แตะ (ตรวจทีละไฟล์)

| ไฟล์ | สิ่งที่เปลี่ยน | ความเสี่ยง |
|---|---|---|
| `supabase/migrations/add_place_matching.sql` | **ใหม่** — รวม ALTER `communities` (2.2) | ต้องรันเอง + backfill + spot-check |
| `supabase/migrations/add_community_places_structured.sql` | แก้ allowlist + insert `community_id` ใน RPC | สูง — RPC อยู่ใน 3 เส้นทางเขียน |
| `backend/src/routes/places.ts` | scope ใน enrich, `strict` ใน /verify, สิทธิ์ tourist, endpoint อ่านตามชุมชน | กระทบ `/places/verify` ที่ใช้อยู่ → default เดิมต้องคง |
| `backend/src/routes/aiSummary.ts` | รับ `locationScope` (2 จุดเรียก) | additive เท่านั้น |
| `backend/src/routes/hostPlace.ts` | allowlist `businessPlaceId` + `communityId` | กระทบทุกการบันทึกโปรไฟล์ host |
| `src/Pages/CreatePostScreen.tsx` | flow ใหม่ทั้งก้อน | สูง — หน้าหลักของงานนี้ |
| `src/services/placeMatchService.ts` | **ใหม่** | ต่ำ |
| `src/services/placesLocalService.ts` | ค้นด้วย id (ทั้ง `findLocalPlaces` + `saveVerifiedPlace`) | กระทบ auto-pick เดิม (ตั้งใจ) |
| `src/services/placesService.ts` | เพิ่ม `strict` | ต่ำ |
| `src/state/AuthContext.tsx` | เพิ่ม field | ต่ำ |
| `src/Pages/Auth/OnboardingScreen.tsx` | บันทึก Google id + แก้บั๊ก | กระทบการลงทะเบียน |
| `src/Pages/ProfileLocal.tsx` | เหมือนกัน | กระทบการแก้ร้าน |
| `src/components/PlaceDetailsCard.tsx` | ซ่อนจาก tourist | ต่ำ |

---

## 4. เฟส 2 — AI แชท + โปรไฟล์ชุมชน

### 4.1 AI แชทรับหลายสถานที่ (D3) — [aiChat.ts](backend/src/routes/aiChat.ts)

| โหมด | ตอนนี้ | ใหม่ |
|---|---|---|
| host-self ([:160-170](backend/src/routes/aiChat.ts#L160-L170)) | `owner_id = userId` + `limit(1)` → ได้แถวเดียว | `community_id = host.community_id` → ได้ทุกสถานที่ของชุมชน (จำกัด ~20) |
| tourist ([:206-233](backend/src/routes/aiChat.ts#L206-L233)) | `limit(50)` ทั้งตาราง + match ด้วยชื่อ | ถ้ารู้ `community_id` → ดึงเฉพาะชุมชนนั้น / ไม่รู้ → match ด้วยชื่อเหมือนเดิม |

→ `PlaceContext` (ที่ [tripPrompt.ts:199-259](backend/src/tripPrompt.ts#L199-L259)) ต้องรองรับหลายสถานที่ — เปลี่ยนเป็น `places: PlaceContext[]` พร้อม backward compat ของ `place` เดิม

> หมายเหตุ: `select` ใน tourist branch ต้องเพิ่มคอลัมน์ `community_id` และ `users:owner_id` ต้องเพิ่ม `community_id` ด้วย

### 4.2 เติม `nearby_communities` / `retrieved_context` ที่ prompt รอไว้อยู่แล้ว

[tripPrompt.ts:28-30](backend/src/tripPrompt.ts#L28-L30) สั่งโมเดลให้ยึดสองค่านี้เป็นแหล่งหลัก — แต่**ไม่มีโค้ดไหนส่งค่านี้เลย** และไม่มีชั้น RAG/vector ในโปรเจกต์

เฟส 2 ควรสร้าง producer แบบไม่ต้องมี vector DB:
- `nearby_communities` = ชุมชนที่ลงทะเบียนในจังหวัดเดียวกัน (+ สถานที่ของชุมชนนั้น) — เติมจาก `communities` + `community_places`
- `retrieved_context` = สถานที่ในชุมชนที่ผู้ใช้กำลังถาม (จาก `community_id` ที่ resolve ได้)

> ⚠️ `communities.latitude/longitude` เป็น NULL (2.2) → คำนวณระยะทางจริงไม่ได้ → ระยะแรกใช้ "จังหวัดเดียวกัน" เป็นเกณฑ์ หรือเติมพิกัดจาก centroid ของ `community_places` ของชุมชนนั้น

### 4.3 หน้าโปรไฟล์ชุมชนแสดงรายการสถานที่ — [ProfileLocal.tsx](src/Pages/ProfileLocal.tsx) ดึงจาก `GET /places/community?communityId=…`

### 4.4 แผนที่แสดงสถานที่ (ทางเลือก — ยังไม่ผูกกับเฟส 2) — `src/Pages/Map/*` ปัจจุบันแสดงแต่หมู่บ้าน OTOP (ระดับชุมชน) → สามารถเพิ่มหมุดสถานที่ระดับย่อยได้

---

## 5. สิ่งที่ห้ามแตะ / ระบบที่ต้องไม่พัง

| สิ่ง | ที่อยู่ | เหตุผล |
|---|---|---|
| `backend/src/tripPrompt.ts` | มีการแก้ค้างอยู่ | ไม่เกี่ยวกับงานนี้ — **ห้ามแตะ** |
| `owner_id` ไม่ถูกย้าย | [places.ts:770](backend/src/routes/places.ts#L770) + [add_community_places_structured.sql:174-191](supabase/migrations/add_community_places_structured.sql#L174-L191) | หลัก "ราคาเป็นของสถานที่ ไม่ใช่ของผู้โพสต์" ต้องอยู่ — ห้ามเพิ่ม `owner_id = excluded.owner_id` |
| "ค่าของเจ้าของสถานที่ชนะค่าของ Google" | `seedPlaceDetails` + `fetchPlaceDetailsRow` ([placeDetailsService.ts:105](src/services/placeDetailsService.ts#L105)) | ห้ามกลับด้าน — tourist ต้องยึดกฎเดียวกัน (3.2.5) |
| การคุมค่าใช้จ่าย Places API | `SEARCH_FIELD_MASK` / `DETAILS_FIELD_MASK` | ค้น 1 ครั้ง + ดึง detail 1 ครั้ง (เฉพาะตอนผู้ใช้ติ๊ก) — ห้ามเพิ่ม call โดยไม่คิด |
| `/places/verify` default behavior | [places.ts:488-517](backend/src/routes/places.ts#L488-L517) | ผู้เรียกเดิมต้องได้ผลเดิม → `strict` เป็น opt-in |
| `google_candidates` ถูกตัดตอน persist | [uploadService.ts:54-59](src/services/uploadService.ts#L54-L59) | เหตุผลเดิมยังดี (ไม่ให้ candidate ค้างใน DB) |
| ตาราง `places` | [placesLocalService.ts](src/services/placesLocalService.ts) | D1: ใช้เป็น cache ต่อไป ห้ามลบ |
| `services` / `bookings` / `passport_stamps` | [schema.sql:79-90, 263-280](supabase/schema.sql#L79-L90) | dead code เหมือนกัน — **ไม่แตะ** (สังเกตว่า `on delete cascade` จาก `communities` จะกระทบ แต่ไม่มีแถวอยู่) |

---

## 6. ลำดับการลงมือ (เฟส 1)

| # | งาน | ไฟล์ | เสร็จเมื่อ |
|---|---|---|---|
| 1.1 | แก้ `place_id` ทั้ง 3 ทางให้ใช้ `syntheticPlaceId` เดียว | `OnboardingScreen.tsx`, `ProfileLocal.tsx` | บันทึกซ้ำแล้วไม่เพิ่มแถว |
| 1.2 | เขียน migration (ALTER `communities` + คอลัมน์ใหม่) | `add_place_matching.sql` | รันได้โดยไม่ error |
| 1.3 | เขียน + รัน backfill (spot-check ก่อน) | `add_place_matching_backfill.sql` | `business_place_id` + `community_id` มีค่าถูกต้อง |
| 1.4 | แก้ RPC allowlist + เพิ่ม `community_id` | `add_community_places_structured.sql` | host บันทึกแล้ว `community_id` ถูกเขียน |
| 1.5 | เพิ่ม `business_place_id` เข้า AuthContext + จุดบันทึก | `AuthContext.tsx`, `OnboardingScreen.tsx`, `ProfileLocal.tsx`, `hostPlaceService.ts` | host ที่เลือกหมุด Google มี id ใน user row |
| 1.6 | `placeMatchService.ts` + เทียบใน `runLocationVerify` | `CreatePostScreen.tsx` | candidate ที่ตรง id แสดงการ์ด "ตรงกับทะเบียน" |
| 1.7 | `lookupOnGoogle` → `strict` + `searchInCommunity()` | `placesService.ts`, `backend/places.ts`, `CreatePostScreen.tsx` | กด "ไม่ใช่" แล้วได้รายการในชุมชน ไม่ใช่ฟอร์มว่าง |
| 1.8 | โหมด own_business ตรวจเทียบ | `CreatePostScreen.tsx`, `aiSummary.ts`, `backend/places.ts` | คลิปที่ไม่ใช่ร้านตัวเองถูกจับได้ |
| 1.9 | บันทึก `community_id` + สิทธิ์ tourist + แก้ RLS | `backend/places.ts`, `backend/hostPlace.ts`, `policies.sql` | tourist บันทึกได้ แต่แก้ราคา/โทรไม่ได้ |
| 1.10 | `findLocalPlaces` + `saveVerifiedPlace` ค้นด้วย id | `placesLocalService.ts` | ไม่มี auto-pick จากชื่อ fuzzy อีก |
| 1.11 | เขียน `community` ที่ยืนยันแล้วกลับลง summary | `CreatePostScreen.tsx` | `summary.community` = ค่าที่ยืนยัน |
| 1.12 | lint + typecheck + ทดสอบจริง 3 แบบ | — | ผ่านทั้ง 3 โหมด |

> **ลำดับสำคัญ:** 1.1 ก่อนเสมอ — ถ้ายังมี id ที่มี timestamp การ backfill B5 จะเขียน `business_place_id` ผิด และ D2 จะพังตั้งแต่ต้น

---

## 7. คำถามที่ยังค้าง (ต้องตอบก่อนลงมือเฟส 2)

| # | คำถาม | ทำไมต้องถาม |
|---|---|---|
| Q1 | ชุมชนหนึ่งมี host ได้หลายคนไหม? | กระทบ `communities.host_user_id` — แผนถือว่า "หลายคนได้" (ย้ายความเป็นเจ้าของไป `users.community_id` + เปลี่ยน FK เป็น `on delete set null`) ถ้าจริงว่า 1 host เท่านั้น จะยุ่งกว่านี้ |
| Q2 | "สถานที่ใกล้เคียงในชุมชน" แสดงที่ไหนบ้าง? (โปรไฟล์ชุมชน / แผนที่ / แชท / ทั้งหมด) | กำหนดว่าเฟส 2 ต้องทำกี่หน้าจอ |
| Q3 | นักท่องเที่ยวยืนยันสถานที่ในชุมชนที่ยังไม่มีในระบบ → ให้สร้างชุมชนใหม่ไหม? | กระทบว่า `communities` จะโตได้เองหรือไม่ (ปัจจุบัน `communities` เป็น dead code — ไม่มีโค้ดสร้างแถวใหม่) |
| Q4 | จะเก็บ `places` (cache) ไว้กี่ทีแล้วค่อยลบ? | D1 ให้เก็บไว้ — แต่ต้องรู้ว่าเมื่อไหร่ถือว่าเลิกใช้ |
| Q5 | `price_info` / `business_pricing` (ราคาเจ้าของสถานที่) กับ `price_level` (แถบราคาจาก Google) แสดงให้ tourist เห็นไหม? | ตอนนี้ tourist ไม่เห็นการ์ดเลย |
| Q6 | ให้ tourist บันทึกสถานที่ได้ → ใครเป็น `owner_id`? | แผนถือว่า `owner_id` = คนที่บันทึกครั้งแรก (tourist) แล้ว host แก้รายละเอียดได้ผ่านช่องทาง host — เพราะ `owner_id` ไม่ถูกย้าย ทำให้ "host เข้ามาแก้ราคาที่ tourist บันทึกไว้" ได้ |

---

## 8. สิ่งที่ยังไม่แน่ใจ (ระบุตรง ๆ ไม่ปิดบัง)

1. **D2 ("เทียบด้วย Google id อย่างเดียว") ใช้ได้จริงกับ host ที่ไม่ได้เลือกหมุด Google** — ต้องบังคับเลือกหมุด (2.1) ไม่งั้นโหมด own_business จะตกไปทาง "ไม่ตรง" ทุกครั้ง
2. **ไม่มีการทดสอบอัตโนมัติ** — ต้องทดสอบกับคลิปจริง 3 แบบ (ตรงทะเบียน / ไม่ตรงแต่อยู่ในชุมชน / ไม่ตรงและไม่มีในชุมชน)
3. **ค่าใช้จ่าย Places API เพิ่ม** — โหมด own_business จะค้น Google ทุกครั้งที่โพสต์ (เพิ่ม ~1 call/โพสต์) ต้องตั้งงบกลาง
4. **backfill ต้องรันด้วยมือ** — ผมรัน migration ให้ไม่ได้ (ต้องใช้สิทธิ์ SQL Editor ของ Supabase) จะเขียนสคริปต์ให้
5. **โค้ดเดิมบางส่วนจะต้องเปลี่ยนพฤติกรรม** — ผู้ใช้ที่คุ้นเคยกับ "own_business ล็อกตำแหน่งแน่นอน" จะเจอการ์ดยืนยันเพิ่ม
6. **`communities` เป็น dead schema — การกู้มาใช้ต้อง ALTER 4 จุด** (2.2) และ `services`/`bookings`/`passport_stamps` จะผูกกับมันแบบ `on delete cascade` — ตอนนี้ไม่มีแถว แต่ถ้าวันหนึ่งมี ต้องระวังลบชุมชน
