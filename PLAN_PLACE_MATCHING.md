# 🧭 แผนแก้ไข: จับคู่สถานที่จากคลิป → Google Places → ยืนยัน → สถานที่ในชุมชน

> **สถานะ:** ร่างแผน (ยังไม่ลงมือแก้โค้ดไฟล์ใด ๆ — แก้เฉพาะไฟล์แผนนี้)
> **วันที่:** 2026-10-26 (รอบที่ 3 — ไล่ลำดับใหม่ทั้งแผน ตามคำตอบครบ 25 ข้อ)
> **ขอบเขต:** หน้าโพสต์วิดีโอ → การยืนยันสถานที่ → บันทึกเข้าชุมชน → แสดง/แชทกับรายการสถานที่ของชุมชน
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

> **อัปเดต 2026-10-26 (รอบที่ 3) — โมเดลเปลี่ยนและไล่ลำดับใหม่ทั้งแผน**
>
> - ตัดสินใจครบแล้ว **25 ข้อ (D1–D25)** — ครบทุกช่องว่างที่เคยค้าง (Q1–Q23)
> - **โมเดลข้อมูลเปลี่ยนไปครึ่งหนึ่ง** เพราะผู้ใช้ยืนยัน 4 ข้อสำคัญ:
>   1. **ชุมชน (หมู่บ้าน OTOP) = read-only จาก OTOP data** — ห้ามแก้ไขชุมชนที่ลงทะเบียนไว้แล้ว
>   2. **1 host = 1 สถานที่ประกอบการ** — ข้อขัดแย้ง "host หลายคนแก้สถานที่เดียวกัน" หายไปเอง
>   3. **owner = ผู้ประกอบการ** (ไม่ใช่คนบันทึกครั้งแรก) + เพิ่ม `recorded_by`
>   4. **ไม่มี "สถานที่รอตรวจ"** — ถ้าจับคู่ชุมชนไม่ได้ก็ไม่บันทึก
> - **ลำดับงานถูกไล่ใหม่** เป็น 4 เฟสตามชั้นจริง (ข้อมูล → backend → mobile → เฟส 2) — ดู §9
> - **ต้อง probe Google Places สดก่อนลงมือ** (ขั้น 0.1) ไม่งั้นเฟสทั้งหมดจะได้ข้อมูลว่างโดยไม่มี error

---

## 1. การตัดสินใจที่ผู้ใช้เลือก (ต้องยึด)

### 1.1 กติกาธุรกิจ

| # | หัวข้อ | การตัดสินใจ | ผลกระทบต่อแผน |
|---|---|---|---|
| D1 | แหล่งความจริงของสถานที่ | **`community_places` เป็นแหล่งจริง** — `places` คงเป็น cache ตอนโพสต์ | ไม่ต้องแตะตาราง `places` ที่ใช้งานได้ |
| D2 | เกณฑ์การเทียบ | **เทียบด้วย Google place id อย่างเดียว** | ต้องมี `users.business_place_id` ที่เป็น Google id จริงเสมอ |
| D3 | บริบท AI แชท | **ส่งหลายสถานที่** | แก้ `aiChat.ts` ในเฟส 4 |
| D4 | กลไกชุมชน↔สถานที่ | **ใช้ `community_id`** (ไม่ใช้ text `village`) | ต้องกู้ตาราง `communities` มาใช้งานจริง — ALTER ก่อน (ดู §2.1) |
| D5 | โหมด own_business | **ตรวจเทียบเสมอ** (ไม่ล็อกลอย ๆ) | โหมดนี้เปลี่ยนพฤติกรรมเต็ม |
| D6 | สิทธิ์ tourist | **บันทึกได้ แต่แก้ข้อมูลของเจ้าของสถานที่ไม่ได้** | แยกสิทธิ์ใน backend + ซ่อนการ์ดแก้ไข |
| D7 | การเช็ค cache ก่อนค้น Google | **ค้นด้วย id เท่านั้น** (เลิก ILIKE ชื่อ) | แก้ `findLocalPlaces` |
| D8 | ขอบเขต | **2 เฟสของงาน** (ผลิตภัณฑ์): เฟส 1 = หน้าโพสต์, เฟส 2 = AI แชท + โปรไฟล์ + แผนที่ | ในแผนนี้แยกเป็น 4 เฟสตามชั้นงาน (ดู §9) |

### 1.2 โมเดลข้อมูล (รอบที่ 3 — เปลี่ยนจากรอบที่ 2)

| # | หัวข้อ | การตัดสินใจ | ผลกระทบต่อแผน |
|---|---|---|---|
| **D9** | เงื่อนไขของ host | **ทุก host ต้องมีเลขประกอบการ (OTOP) → ต้องมี `otop_village_id`** | บังคับตอน onboarding; **host เดิมที่ไม่มี → ลดสิทธิ์เป็น tourist** + ปุ่มยืนยันตัวตนกลับมา (D16) |
| **D10** | `owner_id` ของสถานที่ | **= ผู้ประกอบการ (host)** ไม่ใช่คนที่บันทึกครั้งแรก | ต้องเพิ่มคอลัมน์ `recorded_by` = คนที่บันทึก (D14) |
| **D11** | สถานที่ที่จับคู่ชุมชนไม่ได้ | **ไม่บันทึก** — ไม่มี "สถานที่รอตรวจ" | ตัด `source='pending_review'` ออกจากแผนเดิม; ทุกแถวใน `community_places` ต้องมี `community_id` |
| **D12** | ที่มาของ "ชุมชน" | **registry read-only จาก OTOP data** — seed `communities` จาก `src/data/thailand_hierarchy.json` (3,882 แถว) | ชุมชนในระบบครบภูมิภาค; **ห้ามมี UI แก้ไขชุมชน** |
| **D13** | ตัวเชื่อมชุมชน ↔ host | **CDD `Village_ID`** เป็นตัวเชื่อมเดียว → เติม `otop_village_id` ลงใน data file | ต้องทำ mapping file (ขั้น 0.4) — **ทำเฉพาะหมู่บ้านที่มี host ก่อน** ไม่ต้องครบ 3,882 ในรอบแรก |
| **D14** | เจ้าของแถวสถานที่ | **`owner_id` = ผู้ประกอบการ (host)**, เพิ่มคอลัมน์ **`recorded_by` = คนที่บันทึกครั้งแรก** | แถวที่ tourist บันทึก → `owner_id` = NULL + `recorded_by` = tourist; host มาเป็นเจ้าของ → `owner_id` เปลี่ยน NULL→host (เท่านั้น) |
| **D15** | 1 host = 1 สถานที่ | **host แต่ละคนมีสถานที่ประกอบการ 1 แห่ง** | host แก้ได้เฉพาะสถานที่ที่ `business_place_id` ของตัวเองชี้ไป — ไม่มีการแก้ชนกันอีกต่อไป |
| **D16** | host เดิมที่ไม่มี OTOP | **ลดสิทธิ์เป็น tourist** + ปุ่ม **"ยืนยันตัวตนเป็น host"** ในหน้าโปรไฟล์ (กรอกเลขประกอบการ → verify ผ่าน CDD → เลื่อน role กลับ) | ผู้ใช้เดิมไม่หาย แต่ต้องยืนยันใหม่ก่อนใช้สิทธิ์ host |
| **D17** | own_business เมื่อ Google ไม่เจอ | **ให้ host เลือกหมุด Google ตอนโพสต์ครั้งแรก แล้วบันทึกกลับ `users.business_place_id`** | ตัวเองซ่อมแซ้วได้ ไม่ต้องกลับไปแก้โปรไฟล์; D2 ใช้ได้ทันที |
| **D18** | ชื่อ hierarchy ใน `community_places` | **ไม่เก็บซ้ำ — ดึงจาก `communities` ตอนอ่าน (join)** | เลิกเขียน `province`/`district`/`subdistrict`/`village`; อ่านผ่าน join |
| **D19** | ข้อมูลที่ยืนยันแล้วใน `places` (cache) | **ย้าย (copy) เข้า `community_places`** + เติม `community_id` | แหล่งจริงเริ่มต้นมีข้อมูลครบ — ต้อง spot-check ก่อนรัน |
| **D20** | ที่แสดงรายการสถานที่ | **ทั้งสามที่** — โปรไฟล์ชุมชน + แผนที่ + AI แชท | เฟส 2 ต้องทำ 3 หน้าจอ |
| **D21** | ราคาที่ tourist เห็น | **เห็นทั้ง `price_info` (เจ้าของแจ้ง) และ `price_level` (แถบจาก Google) + ป้ายกำกับแหล่งที่มา** | ต้องมี badge กำกับทุกกลุ่มข้อมูล (D21) |
| **D22** | ขอบเขต AI แชท | **ถามได้ทั้งชุมชน — โมเดลเลือกชุมชนให้เอง** | host ถามได้ทั้ง "ของฉัน" และ "ทุกที่ในหมู่บ้านฉัน"; tourist ถามได้โดยระบุชื่อชุมชน/ตำบล |
| **D23** | `nearby_communities` | **จังหวัดเดียวกัน เรียงตามจำนวนสถานที่ที่ยืนยันแล้ว** | ไม่ต้องคำนวณระยะทาง (ชุมชนไม่มี lat/lng) |
| **D24** | ปุ่ม "ค้นใหม่ในชุมชนนี้" | **ค้นที่ระดับตำบล + ปุ่ม "ค้นกว้างขึ้น (ทั้งอำเภอ)"** | strict filter 2 ระดับ |
| **D25** | อายุ cache `places` | **เก็บไว้ไม่ลบ** | ไม่ต้องมีงานล้างข้อมูล |
| **D28** | ที่มาของ "สถานที่ในชุมชน" | **ไม่มีใน hierarchy — สถานที่เกิดจากการยืนยันของผู้ใช้ แล้วสะสมใน `community_places`**; ขอบเขต "ในชุมชน" = **ระดับตำบล + เช็คชื่อหมู่บ้าน** (Google ไม่มี address component ระดับหมู่บ้าน) | ชุมชนคือ **ขอบเขต** ไม่ใช่รายการ → ต้องมี `community_match_level` + ป้ายบอกระดับ (ดู §2.2) |

### 1.3 กติกาการเขียนข้อมูล (จากคำตอบรอบที่ 3)

| # | หัวข้อ | การตัดสินใจ | ผลกระทบต่อแผน |
|---|---|---|---|
| **D26** | tourist เติมข้อมูลอะไรได้ | **เฉพาะข้อมูลจากคลิป** = `capacity` / `house_rules` / `areas` / `facilities` (jsonb) | ห้ามแตะ `price_info` / `price_level` / `phone` / `opening_hours` / `website` / `rating` |
| **D27** | own_business ต้องยืนยันก่อนโพสต์ไหม | **บังคับยืนยันก่อนโพสต์** | ถ้า Google ไม่เจอ → เลือกหมุดตอนโพสต์ (D17) |

---

## 2. โมเดลข้อมูลเป้าหมาย

### 2.1 ชุมชน — registry ที่ read-only

```
src/data/thailand_hierarchy.json   (3,882 หมู่บ้าน OTOP — ชุดข้อมูลหลัก)
        │  seed (read-only, ห้ามแก้ผ่าน UI)
        ▼
public.communities  ── 1 แถว = 1 หมู่บ้าน
   id, name, region, province, district, subdistrict
   otop_village_id  ← CDD Village_ID (D13) — ตัวเชื่อมกับ host
   host_user_id     ← host คนแรกที่ผูกกับหมู่บ้านนี้ (nullable)
   is_verified      ← true (มาจาก OTOP dataset)
   latitude/longitude ← NULL (ไม่มีแหล่งข้อมูล)
```

**ข้อบังคับ:**
- ชุมชนที่ลงทะเบียน OTOP แล้ว = **แก้ไขไม่ได้** (D12) — ไม่มี endpoint แก้ `communities` จากแอป
- ชุมชนเพิ่มได้เฉพาะการ **seed** จาก OTOP data เท่านั้น
- `communities` เดิมเป็น **dead schema** (grep ทั้ง `src/` + `backend/` ไม่พบการอ่าน/เขียน) และ **ไม่มีแถวอยู่** → seed ใหม่ได้เลย ไม่ต้องย้ายของเดิม

**ปัญหาที่ต้องแก้ก่อน seed** ([schema.sql:61-77](supabase/schema.sql#L61-L77)):

| คอลัมน์ | ปัญหา | แก้ |
|---|---|---|
| `host_user_id uuid not null … on delete cascade` | หลาย host ต่อหมู่บ้าน + ลบบัญชี host → ลบชุมชนทั้งแถว (cascade ไป `services`/`bookings`/`passport_stamps`) | `drop not null` + `on delete set null`; ย้ายความเป็นเจ้าของไปที่ `users.community_id` |
| `latitude/longitude double precision not null` | **ไม่มีแหล่งข้อมูล** — `thailand_hierarchy.json` ไม่มี lat/lng, CDD API ไม่คืนพิกัด | `drop not null` (คง NULL) |
| `capacity_per_day int not null check (> 0)` | **ไม่มีแหล่งข้อมูล** — `community_registrations.carrying_capacity` เป็น varchar และเป็นตารางที่ไม่มีโค้ดใช้ | `drop not null` + ตัด CHECK |
| `name/region/province/district/subdistrict not null` | มีค่าจาก hierarchy ครบ | ไม่ต้องแก้ (แต่ `subdistrict` ใน hierarchy เป็น string `"ต.สุเทพ, หมู่ 11"` → ต้อง parse เอาชื่อตำบลออกมา ดูขั้น 1.1) |

> **ชุมชนในระบบนี้ไม่มี "รายการสถานที่" ติดมาด้วย** — hierarchy มีถึงระดับชุมชนเท่านั้น (ชื่อหมู่บ้าน + ต./อ./จ.) → **สถานที่ในชุมชนมาจากไหน** ดู **§2.2**

### 2.2 ที่มาของ "สถานที่ในชุมชน" — ชุมชนคือ **ขอบเขต** ไม่ใช่ **รายการ**

> **คำถามที่เจอช่องว่าง:** *"hierarchy มีแค่ถึงระดับชุมชน ยังไม่มีสถานที่ในชุมชน — จะได้สถานที่ในชุมชนมาจากไหน?"*
>
> **คำตอบ: `thailand_hierarchy.json` เป็น "ทะเบียนของชุมชน" ไม่ใช่ "แคตตาล็อกสถานที่" — สถานที่ในชุมชนไม่มีของต้นมาให้ seed มันเกิดจากการยืนยันของผู้ใช้ แล้วสะสมอยู่ใน `community_places`**

**สิ่งที่ hierarchy มีจริง** (ตรวจจาก `src/data/thailand_hierarchy.json` — 3,882 ชุมชน):

| ฟิลด์ | ตัวอย่าง | ใช้ทำอะไรในแผนนี้ |
|---|---|---|
| `id` | `place-เชียงใหม่-เมืองเชียงใหม่-1` | key ภายในของ dataset (ไม่ใช่ CDD id — ดู D13) |
| `name` | `บ้านดอยปุย` | **ชื่อหมู่บ้าน** → ใช้เป็น "คำที่ต้องเจอในที่อยู่" ของชั้นที่ 2 ในการกรอง (2.2.2) |
| `subdistrict` | `ต.สุเทพ, หมู่ 11` | **string รวม 2 อย่าง** → ต้อง parse เป็น "ต.สุเทพ" + "หมู่ 11" (ดูข้อ 3 ใน §11) |
| `districtName` / `provinceName` / `regionName` | `เมืองเชียงใหม่` / `เชียงใหม่` / `ภาคเหนือ` | ใช้ทำ **scope** ตอนค้น Google (5.2) |
| `category` / `highlight` | `ชุมชนท่องเที่ยว OTOP นวัตวิถี` | ข้อความแนะนำชุมชน |
| `isVisited` / `reviewClipCount` | `false` / `42` | `reviewClipCount` = สัญญาณว่าชุมชนนี้มีคลิปอยู่แล้ว (ลำดับความสำคัญตอน seed) |
| **ไม่มี** | `place_id` · `lat/lng` · รายการสถานที่ในชุมชน | — |

**ทำไมไม่มี และทำไมแก้ไม่ได้:** hierarchy มาจาก dataset ชุมชนท่องเที่ยว OTOP ซึ่ง **หน่วยเล็กสุดคือ "หมู่บ้าน"** → ไม่มีแคตตาล็อกสถานที่ย่อยให้ดึงมา และ CDD OTOP API ที่ใช้มีแค่ `GET /otop/verify/:id` ([otop.ts](backend/src/routes/otop.ts)) ซึ่งคืน `idNumber/region/province/amphur/tambol/village` — **ไม่มีรายการสถานที่ในหมู่บ้าน และไม่มีพิกัด**

**สถานที่ในชุมชนมี 3 ทางที่มา** (ทั้ง 3 ทางลง `community_places` เสมอ):

| # | ที่มา | ใครสร้าง | `owner_id` | `source` |
|---|---|---|---|---|
| 1 | **Host ยืนยันที่ประกอบการของตัวเอง** — ผูก `users.business_place_id` (Google id) | host | host | `host_verified` |
| 2 | **ผู้ใช้ยืนยันสถานที่ใหม่จากผลค้น "ในชุมชน"** (เส้นทาง ③ — 6.5) | tourist หรือ host | host (ถ้าเป็นของ host) / NULL | `google_places` |
| 3 | **backfill จาก `places`** (D19) — สถานที่ที่เคยยืนยันไว้แล้วในระบบเก่า | — | ตามข้อมูลเดิม | `google_places` |

→ **"ข้อมูลสถานที่ใกล้เคียงในชุมชน" ที่โจทย์เดิมต้องการ = ผลสะสมของ 3 ทางนี้ใน `community_places`** ไม่ใช่ข้อมูลที่ seed ล่วงหน้าได้ → ชุมชนที่ยังไม่มีใครยืนยันสถานที่ = **หน้าโปรไฟล์ว่าง** (ดู 2.2.4)

#### 2.2.1 ข้อจำกัดสำคัญ: Google Places ไม่มี "หมู่บ้าน" ใน address components

Places (New) คืน address components ถึงระดับ: `country` → `administrative_area_level_1` (จังหวัด) → `_2` (อำเภอ/เขต) → `_3` (ตำบล/แขวง) → `locality` → `sublocality` → `neighborhood` — **ไม่มีระดับ "หมู่บ้าน"**

→ ขอบเขต "ในชุมชน" ที่ทำได้จริง = **ระดับตำบล** + **เช็คชื่อหมู่บ้านเป็นข้อความ**

นี่ไม่ใช่ตัวเลือกอิสระ — เป็น **ข้อจำกัดของข้อมูล** และตรงกับ D24 ที่ผู้ใช้เลือก ("ตำบล + ปุ่มค้นกว้างขึ้น") พอดี → ไม่ต้องถามซ้ำ แต่ต้อง **เขียนคำบอกผู้ใช้ให้ตรง**

#### 2.2.2 การกรอง 3 ชั้น (แทนการกรองเดียว)

ชั้นที่ 1-2 คือ "อัตโนมัติ" ชั้นที่ 3 คือ "ให้คนตัดสิน"

| ชั้น | เงื่อนไข | ข้อความบนการ์ด | `community_match_level` |
|---|---|---|---|
| 1 | `subdistrict` ตรงกับตำบลของชุมชน **และ** ชื่อหมู่บ้านปรากฏใน `formatted_address` หรือชื่อสถานที่ | "อยู่ในหมู่บ้านนี้" | `village` |
| 2 | `subdistrict` ตรงกับตำบล **แต่** ยังไม่เจอชื่อหมู่บ้าน | "อยู่ตำบลเดียวกัน — ไม่ใช่หมู่บ้านเดียวกัน" | `subdistrict` |
| 3 | `district` ตรง (อำเภอ) — มาจากปุ่ม "ค้นกว้างขึ้น" (D24) | "อยู่ในอำเภอเดียวกัน" | `district` |

> **ชั้น 1 เป็นการเดา ไม่ใช่การยืนยัน** — ชื่อหมู่บ้านไทยซ้ำกันมาก และ Google ไม่ได้เขียนชื่อหมู่บ้านในที่อยู่เสมอ ("หมู่ 11, ต.สุเทพ, อ.เมือง, จ.เชียงใหม่" บางที่ไม่มีชื่อหมู่บ้านเลย) → **ต้องให้ผู้ใช้กดยืนยันเสมอ** ชั้น 1 แค่ทำให้เรียงลำดับผลลัพธ์ถูก

**การเทียบชื่อหมู่บ้าน (ชั้น 1):**
- normalize ก่อนเทียบ — ตัดช่องว่าง/วรรคตอน/อักษรไทยที่ Google เขียนต่าง (`สุเทพ` / `สุ เทพ` / `สุ-เทพ`)
- เทียบแบบ **substring** (ข้อความหนึ่งเป็นส่วนหนึ่งของอีกข้อความ) ไม่ใช่ equality
- **ชื่อที่สั้นเกินไปให้ข้าม** (น้อยกว่า ~5 ตัวอักษร เช่น "บ้าน" "ดอย") ไม่งั้นจะ match ทั้งจังหวัด
- ชื่อหมู่บ้านมาจาก `communities.name` (seed แล้ว) → ไม่ต้อง parse ซ้ำจาก hierarchy

**ทำไมถึงต้องมีชั้น 3:** `extractAdminFromAddress` ([places.ts:77-105](backend/src/routes/places.ts#L77-L105)) parse จาก `formatted_address` ด้วย regex

```ts
/(?:จังหวัด|จ\.)\s*([^\s,\d]+)   // เอา 1 คำ
/(?:อำเภอ|อ\.|เขต)\s*([^\s,\d]+)   // เอา 1 คำ
/(?:ตำบล|ต\.|แขวง)\s*([^\s,\d]+)   // เอา 1 คำ
```

→ `[^\s,\d]+` จับได้ **คำเดียว** (ชื่อตำบลที่มีเว้นวรรคจะถูกตัด) และ **ถ้าไม่มี "ต." ในข้อความ → คืน `null`**
→ เส้นทาง Places (New) ที่ใช้ `addressComponents` จริงเชื่อถือได้กว่า แต่ **เส้นทาง Legacy ยังพึ่ง regex** → ถ้า parse ไม่ได้ **ห้ามทิ้งผลลัพธ์** → ปล่อยเป็นชั้น 3 ให้ผู้ใช้ตัดสินแทน

#### 2.2.3 ไม่มีพิกัดของชุมชน → ค้นด้วยรัศมีไม่ได้

`communities.latitude/longitude` เป็น `not null` แต่ **ไม่มีแหล่งข้อมูล** (hierarchy ไม่มี, CDD ไม่คืน) → ต้อง `drop not null` (4.1) และ **การกรองทั้งหมดเป็นการเทียบข้อความ ไม่ใช่ระยะทาง** — เหมือนกับ D23 (`nearby_communities` = จังหวัดเดียวกัน ไม่คำนวณระยะทาง)

> หมุด "ที่ของ host" ที่ยืนยันแล้วมี lat/lng ได้ แต่นั่นคือพิกัด **สถานที่** ไม่ใช่พิกัด **ชุมชน** → ใช้เป็นจุดอ้างอิงระดับชุมชนไม่ได้

#### 2.2.4 ผลกระทบ: cold start และหน้า/แชทที่ยังว่าง

- ชุมชนที่ยังไม่มีสถานที่ที่ยืนยันแล้ว → **โปรไฟล์ชุมชนว่าง** และ **AI แชทตอบไม่ได้** → ต้องมี empty state ที่ชัด ("ยังไม่มีสถานที่ที่ยืนยันในชุมชนนี้ — เป็นคนแรกที่เพิ่ม" → เปิด flow ค้นในตำบล) และแชทตอบว่า "ยังไม่มีข้อมูล" **ห้ามเดา**
- เรียงลำดับความสำคัญตอน seed: ชุมชนที่ `reviewClipCount` สูง = มีคลิปอยู่แล้ว = มีโอกาสมีสถานที่
- **ความเสี่ยงที่ต้อง probe ก่อน:** หมู่บ้าน OTOP ส่วนใหญ่ **ไม่มี Google Place** → ผลค้นระดับตำบลจะออกมาเป็น "ร้าน/โรงแรมในตำบล" ซึ่งไม่ใช่สถานที่ในหมู่บ้าน → ต้องดูตัวอย่างจริงก่อนว่าเส้นทาง ③ ให้ผลที่ใช้ได้แค่ไหน (ขั้น 0.7)

#### 2.2.5 คอลัมน์ที่ต้องเพิ่ม

`community_places.community_match_level text` — ค่า: `village` | `subdistrict` | `district` | `manual`

- `manual` = ผู้ใช้เลือกชุมชนเองตอนยืนยัน (6.7) → **ค่าที่เชื่อถือที่สุด**
- ใช้ทำ **ป้ายกำกับ** (6.12) และตรวจย้อนหลังว่าจับคู่ผิดกี่แถว
- ค่า NULL = backfill จาก `places` (เดิม) ที่ยังไม่รู้ระดับ → แสดงเป็น "—"

### 2.3 host ↔ ชุมชน

```
public.users
  otop_village_id   varchar(40)   ← CDD Village_ID (มีอยู่แล้ว)
  community_id      uuid → communities.id   (ใหม่)
  business_place_id text          ← Google Place ID (ใหม่ — D2)
```

- **1 host = 1 สถานที่ประกอบการ** (D15) → `business_place_id` ระบุ "ที่ของฉัน" ได้ชัดเจน
- host หลายคนต่อหมู่บ้านได้ (D1 เดิม) → ความเป็นเจ้าของชุมชนอยู่ที่ `users.community_id`
- ชุมชนมี 1, 2, … host → `communities.host_user_id` = host คนแรก (เพื่ออ้างอิงเท่านั้น ไม่ใช่เจ้าของสิทธิ์)

### 2.4 สถานที่ — `community_places`

```
public.community_places
  place_id      text unique   ← Google Place ID (หรือ synthetic `host-<uid>`)
  place_name, formatted_address, latitude, longitude, google_maps_url
  phone, opening_hours, website, price_info     ← เจ้าของสถานที่ (host แก้ได้)
  price_level?  rating, user_ratings_total       ← จาก Google
  capacity, house_rules, areas, facilities (jsonb) ← จากคลิป
  business_hours, business_pricing (jsonb)       ← จากการ์ดแก้ไขของ host
  ── ความสัมพันธ์ (ใหม่) ──
  community_id  uuid → communities.id   (ใหม่ — D4, ไม่ NULL)
  owner_id      uuid → users.id        ← ผู้ประกอบการ (D14) — NULL ได้
  recorded_by   uuid → users.id        ← คนที่บันทึกครั้งแรก (D14)
  source        'host_verified' | 'google_places'
  community_match_level 'village'|'subdistrict'|'district'|'manual'  ← จับคู่ชุมชนได้ระดับไหน (D28)
  ── ชื่อ hierarchy ──
  province/district/subdistrict/village → เลิกเขียน ดึงจาก communities (D18)
```

**กติกาความเป็นเจ้าของ (D14 + D15):**

| กรณี | `owner_id` | `recorded_by` |
|---|---|---|
| tourist บันทึกสถานที่ใหม่ | NULL | tourist |
| host ยืนยัน/บันทึกสถานที่ของตัวเอง | host (ถ้าเดิม NULL → เปลี่ยนเป็น host) | คนที่บันทึกครั้งแรก (ไม่ถูกทับ) |
| host แก้สถานที่ของ host คนอื่น | **ทำไม่ได้** — backend ต้องเช็ค `business_place_id` | — |

> `owner_id` ย้ายได้ **ทิศทางเดียว**: `NULL → host` เท่านั้น (host คนหนึ่งไม่ดึงแถวของอีกคน) — เปลี่ยนหลักเดิมใน §8

### 2.5 สิทธิ์ 3 บทบาท (D6 + D26 + D27)

มี **2 ช่องทาง** ที่เขียนข้อมูลลง `community_places` — ต้องแยกสิทธิ์ให้ชัดตามช่องทาง:

| ช่องทาง | ฟิลด์ที่เขียนได้ | ใครเขียน |
|---|---|---|
| **A. การ์ดแก้ไขในหน้าโพสต์**<br>`POST /places/save-place-details`<br>(`DETAIL_FIELDS` + `DETAIL_JSON_FIELDS`) | `phone` · `opening_hours` · `price_level` · `website` | host เท่านั้น |
| | `capacity` · `house_rules` · `areas` · `facilities` (จากคลิป) | host ✅ / tourist ✅ (เฉพาะช่องที่ยังว่าง) |
| **B. โปรไฟล์ host**<br>RPC `host_save_business_profile` | `place_name` · `price_info` · `business_pricing` · `business_hours` | host เท่านั้น |
| **ไม่มีใครแก้** | `rating` · `user_ratings_total` (จาก Google) · `place_id` · `source` | — |

> **`price_info` ไม่ได้ถูกเขียนจากช่องทาง A** — โค้ดเขียนกำกับไว้ชัด ("the price BAND is a different fact and lives in its own column, and the structured prices belong to the profile editor") → การ์ดในหน้าโพสต์แก้ได้แค่ **แถบราคา** `price_level` ไม่ใช่ราคาจริง

| บทบาท | เขียนแถวใหม่ | แก้ `phone`/`opening_hours`/`price_level`/`website` | แก้ `capacity`/`house_rules`/`areas`/`facilities` | แก้ `price_info`/`business_pricing` |
|---|---|---|---|---|
| **host (ผู้ประกอบการ)** | ✅ | ✅ (เฉพาะสถานที่ของตัวเอง) | ✅ | ✅ |
| **tourist** | ✅ (เฉพาะช่องที่ยังว่าง) | ❌ | ✅ (เฉพาะช่องที่ยังว่าง) | ❌ |
| **host ที่ยังไม่ยืนยันตัวตน** (ไม่มี OTOP) | ❌ (ยังเป็น tourist) | ❌ | ❌ | ❌ |
**กฎ "เติมเฉพาะที่ยังว่าง" ของ tourist:** ถ้าแถวมีอยู่แล้ว → update เฉพาะ column ที่ `IS NULL` เท่านั้น (ห้ามทับค่าที่เจ้าของสถานที่แก้ไว้ — ตรงกับหลัก "ค่าของเจ้าของสถานที่ชนะค่าของ Google" ที่มีอยู่แล้วใน `seedPlaceDetails`); ถ้าไม่มีแถว → insert ใหม่ (เฉพาะ 4 คอลัมน์จากคลิป)

### 2.6 บั๊กที่พบระหว่างสืบค้น (ต้องแก้ก่อนทุกอย่าง)

#### 2.6.1 🔴 `place_id` มี timestamp → บันทึกซ้ำได้แถวใหม่ทุกครั้ง

`community_places.place_id` เป็น `TEXT UNIQUE` ([create_community_places.sql:11](supabase/migrations/create_community_places.sql#L11)) และทุกเส้นทางเขียนใช้ `on conflict (place_id) do update` → **ถ้า `place_id` เปลี่ยนทุกครั้ง จะได้แถวใหม่ทุกครั้ง ไม่ใช่แก้แถวเดิม**

พบ **3 รูปแบบ id ที่ขัดกัน** — host คนเดียวกันอาจได้แถวแยกกัน 3 แถว:

| ที่อยู่ | รูปแบบ | ปัญหา |
|---|---|---|
| [OnboardingScreen.tsx:273](src/Pages/Auth/OnboardingScreen.tsx#L273) | `otop-${villageId}-${Date.now()}` | 🔴 **มี timestamp → บันทึกซ้ำได้แถวใหม่ทุกครั้ง** |
| [ProfileLocal.tsx:348](src/Pages/ProfileLocal.tsx#L348) | `otop-fallback-${otop_village_id \|\| user.id \|\| Date.now()}` | 🟡 ไม่มี timestamp แต่ **รูปแบบต่างจาก `host-${uid}`** → host เดียวกันอาจมี 2 แถว |
| [hostPlaceService.ts:106](src/services/hostPlaceService.ts#L106) | `host-${userId}` | ✅ ถูกต้อง (คอมเมนต์ L99-105 เขียนเตือนไว้แล้ว) |

**แก้:** ทั้ง 3 ทางให้ใช้ `syntheticPlaceId(user.id)` ที่เดียว

> ⚠️ **ผลกระทบต่อ D2:** ถ้า `business_place_id` เป็น `host-…` หรือ `otop-…` → **ไม่ใช่ Google id** → เทียบกับ candidate จาก Google ไม่ได้เลย → โหมด own_business จะตกไปทาง "ไม่ตรง" ทุกครั้ง
>
> **ทางออกตาม D17:** ถ้า Google หาไม่เจอ → ให้ host เลือกหมุด Google **ตอนโพสต์** แล้วบันทึกกลับ `users.business_place_id` → หลังจากนั้น D2 ใช้ได้จริง

#### 2.6.2 🔴 Google Places อาจ "ค้นไม่ได้" แต่ไม่บอก — ทั้งแผนจะได้ข้อมูลว่าง

สถานะ GCP project **122791880272** (probe เมื่อ 2026-10-24): **billing ปิด** และ **Places (New) `v1/places:searchText` ไม่ได้เปิด** (`API_KEY_SERVICE_BLOCKED`) เหลือเฉพาะ Legacy `textsearch`

ปัญหาไม่ใช่แค่ "ค้นไม่เจอ" แต่คือ **คืนค่าว่างแบบเงียบ ไม่ error**:

| จุด | พฤติกรรม |
|---|---|
| [places.ts:223](backend/src/routes/places.ts#L223) | Places (New) → `resp.ok` = false → ไม่ throw → ตกไป legacy |
| [places.ts:255](backend/src/routes/places.ts#L255) | Legacy → เช็คแค่ `legData.status === "OK"` — Google ตอบ HTTP 200 พร้อม body `status: "REQUEST_DENIED"` เวลาบิลลิ่มปิด → ไม่ throw → คืน `[]` |
| [places.ts:463-494](backend/src/routes/places.ts#L463-L494) | `candidates.length === 0` → ขึ้น diag ว่า *"failed: ค้นแล้วไม่เจอสถานที่"* → ผู้ใช้/AI คิดว่าเป็นแค่ค้นไม่เจอ |

**ผลกระทบต่อแผน:** ถ้าค้นไม่ได้จริง → ① ไม่มี candidate ให้เทียบ (D2 ใช้ไม่ได้) และ ③ "ค้นใหม่ในชุมชน" คืนรายการว่าง → ฟีเจอร์หลักของเฟส 1 ไม่มีข้อมูลเลย แต่ UI ไม่มีทางบอกว่าเป็นปัญหาบิลลิ่ม

**แก้ 2 ส่วน:**
1. **ก่อนลงมือ** — probe สดว่า Places ยังใช้ได้ไหม (เปิด Places (New) 1 คลิก + เปิด billing) ถ้าปิดบิลลิ่มจริง ให้เปิดก่อน
2. **ในโค้ด** — แยก "ค้นไม่ได้" ออกจาก "ค้นไม่เจอ": ให้ `searchPlaceCandidates` ตรวจ `legData.status` ที่ไม่ใช่ `OK` แล้ว **throw** พร้อมข้อความ (`ZERO_RESULTS` = ไม่เจอจริง, อื่น ๆ = error) → ให้ diag รายงานตรง ๆ ว่าเป็นข้อผิดพลาดของ API ไม่ใช่ "ไม่เจอสถานที่"

#### 2.6.3 🟡 RPC `host_save_business_profile` ตัด field แบบ allowlist

[add_community_places_structured.sql:108-118](supabase/migrations/add_community_places_structured.sql#L108-L118) — field ที่ไม่อยู่ใน allowlist จะ **โยน error `unknown field`** ไม่ใช่ข้าม ดังนั้น `business_place_id` และ `community_id` ที่จะเพิ่ม **ต้องแก้ allowlist ใน RPC ด้วย** ไม่ใช่แค่เพิ่มคอลัมน์ในตาราง

#### 2.6.4 🟡 RLS policy ของ `community_places` หลวม

[create_community_places.sql:43-46](supabase/migrations/create_community_places.sql#L43-L46):
```sql
WITH CHECK (auth.uid() = owner_id OR auth.uid() IS NOT NULL)
```
เงื่อนไขหลังทำให้เงื่อนไขแรกเป็นจริงเสมอ → **authenticated ใครก็ insert แถวที่ `owner_id` ของคนอื่นได้** ปัจจุบันยังไม่เป็นปัญหาเพราะ backend ใช้ service role (ข้าม RLS) แต่พอ D6 เปิดให้ tourist บันทึกได้ ต้องแก้ให้ตรงกัน

#### 2.6.5 🟡 `saveVerifiedPlace` เองก็ค้นด้วยชื่อแบบ fuzzy

[placesLocalService.ts:88-92](src/services/placesLocalService.ts#L88-L92) — ก่อน insert จะเรียก `findLocalPlaces` ด้วยชื่อ ซึ่งค้นแบบ `ILIKE %name%` → ต้องเปลี่ยนเป็น id ตาม D7 ทั้งฟังก์ชัน

---

## 3. เฟส 0 — เตรียมข้อมูล (ก่อนแตะโค้ด)

| # | งาน | ทำไม | ผ่านเมื่อ |
|---|---|---|---|
| **0.1** | **Probe Google Places สด** — ยืนยันว่า `textsearch` (Legacy) คืนผลจริง ไม่ใช่ HTTP 200 + `status: "REQUEST_DENIED"` | 2.6.2 — ถ้าบิลลิ่มยังปิด ทุกขั้นตอนหลังจากนี้จะได้ข้อมูลว่างโดยไม่มี error | ได้ผลจริง ≥ 1 candidate |
| **0.2** | **เปิด Places (New) `v1/places:searchText`** (1 คลิกใน GCP console) ถ้าจะใช้ราคาถูกกว่า + ได้ field mask ครบ | โค้ดลองเส้นทางนี้ก่อนเสมอ ([places.ts:223](backend/src/routes/places.ts#L223)) | เปิดแล้ว หรือตัดสินใจใช้ Legacy ต่อ |
| **0.3** | **เปิด billing** (ถ้าปิดอยู่) หรือตั้งงบ/เตรียมเปิด | โหมด own_business จะค้น Google ทุกครั้งที่โพสต์ → ต้องรู้ว่าเงินไหลจากไหน | มีงบ/เปิดแล้ว |
| **0.4** | **ทำ mapping file: หมู่บ้านใน hierarchy → CDD Village_ID** — เฉพาะหมู่บ้านที่มี host อยู่ในระบบ (D13) | เชื่อม `users.otop_village_id` (CDD) ให้กับ `communities` (hierarchy) — ต้องรู้ว่า Village_ID ไหนตรงกับชุมชนไหน | ไฟล์ mapping มีทุกหมู่บ้านที่มี host |
| **0.5** | **นับ host ที่ยังไม่มี `otop_village_id`** ในฐานข้อมูลจริง | D9 + D16 — จำนวนนี้คือผู้ใช้ที่จะถูกลดสิทธิ์เป็น tourist (ขั้น 2.4) | ได้ตัวเลขจริง |
| **0.6** | **เติม `otop_village_id` ลงใน `src/data/thailand_hierarchy.json`** สำหรับหมู่บ้านที่ map ได้ (D13) | `communities` จะ seed จากไฟล์นี้ → ต้องมี id ติดมาด้วย | ทุกแถวที่ map ได้มี `otop_village_id` |
| **0.7** | **Probe ผลค้นระดับตำบลของหมู่บ้าน OTOP จริง 2-3 ชุมชน** — ค้นด้วย scope ตาม §2.2.2 แล้วดูว่า (ก) มี candidate ที่ชื่อหมู่บ้านปรากฏจริงไหม (ข) ผลที่ได้เป็นสถานที่ในหมู่บ้านจริง หรือเป็นแค่ร้าน/โรงแรมทั่วไปในตำบล | §2.2.4 — ถ้า Google ไม่มีสถานที่ระดับหมู่บ้านเลย → เส้นทาง ③ จะได้ผลที่ไม่มีประโยชน์ ต้องออกแบบ UI ใหม่ | เห็นตัวอย่าง candidate จริง + ตัดสินใจว่าใช้ได้ไหม |

> **ลำดับสำคัญ:** 0.4 → 0.6 ต้องมาก่อนขั้น 1.1 (seed) เพราะ seed ใช้ `otop_village_id` เป็น key
>
> **ถ้า 0.1 ยังไม่ผ่าน** — อย่าเพิ่งแก้โค้ด เพราะจะทดสอบ "ไม่ตรง / ค้นไม่เจอ" ทั้งหมดด้วยข้อมูลว่าง แล้วเข้าใจผิดว่าโค้ดผิด

---

## 4. เฟส 1 — โครงข้อมูล (migration + seed + backfill)

### 4.1 Migration — `supabase/migrations/add_place_matching.sql` (ไฟล์ใหม่)

```sql
-- ── 1) ปลดล็อกตาราง communities ให้เป็น registry read-only ของ OTOP ─────
alter table public.communities
  alter column host_user_id drop not null;
alter table public.communities
  drop constraint if exists communities_host_user_id_fkey;
alter table public.communities
  add constraint communities_host_user_id_fkey
  foreign key (host_user_id) references public.users(id) on delete set null;

--    lat/lng + capacity_per_day: ไม่มีแหล่งข้อมูล (ดู 2.1) → คง NULL
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

-- ── 2) host → ชุมชน (หนึ่งชุมชนมี host ได้หลายคน) ──────────────────
alter table public.users
  add column if not exists community_id uuid
  references public.communities(id) on delete set null;

-- ── 3) id ของ Google สำหรับสถานที่ที่ host ลงทะเบียนไว้ ─────────────
alter table public.users
  add column if not exists business_place_id text;

-- ── 4) สถานที่ → ชุมชน (D4) ───────────────────────────────────────
alter table public.community_places
  add column if not exists community_id uuid
  references public.communities(id) on delete restrict;
create index if not exists idx_cp_community
  on public.community_places(community_id);

-- ── 5) เจ้าของ = ผู้ประกอบการ + ผู้บันทึก (D14) ──────────────────
alter table public.community_places
  add column if not exists recorded_by uuid
  references public.users(id) on delete set null;

-- ── 6) เลิกเขียนชื่อ hierarchy ซ้ำใน community_places (D18) ───────────
--    ยังไม่ลบคอลัมน์ในรอบนี้ (กลับได้) แต่หยุดเขียนและอ่านจาก join
alter table public.community_places
  alter column province drop not null;

-- ── 7) ดัชนีช่วยค้นสถานที่ในชุมชน (D7: ค้นด้วย id) ─────────────────
create index if not exists idx_places_google_id
  on public.places(google_place_id) where google_place_id is not null;

-- ── 8) ระดับที่จับคู่ชุมชนได้ (D28) ───────────────────────────────────
--    village = เจอชื่อหมู่บ้านในที่อยู่ | subdistrict = ตำบลตรง
--    district = อำเภอตรง | manual = ผู้ใช้เลือกชุมชนเอง
--    NULL = backfill จาก places (เดิม) ที่ยังไม่รู้ระดับ
alter table public.community_places
  add column if not exists community_match_level text;
```

> `on delete restrict` บน `community_places.community_id` — ต่างจาก `set null` เพราะ D11/D4 บอกว่าทุกสถานที่ต้องผูกกับชุมชนเสมอ ถ้าชุมชนถูกลบ → ต้องลบสถานที่ด้วย ไม่ใช่ปล่อยให้ลอย
>
> **ลบคอลัมน์ hierarchy ทีหลัง** (เฟส 3 ข้อ 3.9) — ทำเมื่อไม่มีโค้ดไหนอ่านคอลัมน์เหล่านั้นแล้ว

### 4.2 Seed ชุมชน — `backend/scripts/seed_communities.ts` (ไฟล์ใหม่)

- อ่าน `src/data/thailand_hierarchy.json` (3,882 แถว) → upsert เข้า `communities`
- `name` = ชื่อหมู่บ้าน, `region`/`province`/`district` = จาก hierarchy, `subdistrict` = **parse** จาก `"ต.สุเทพ, หมู่ 11"` → `"สุเทพ"`
- `otop_village_id` = ค่าที่เติมในขั้น 0.6 (ถ้ายังไม่มี → NULL และข้ามการ unique ชน)
- `is_verified` = true, `latitude`/`longitude`/`capacity_per_day` = NULL
- รันซ้ำได้ (upsert ตาม `otop_village_id`)

> สคริปต์นี้ต้องรันด้วย service-role key (backend มี `.env` อยู่แล้ว — ดูรูปแบบจาก `backend/scripts/gem_probe.ts`)

### 4.3 Backfill (สคริปต์แยก — ต้องรันด้วยมือ)

| ขั้น | จาก | ไป |
|---|---|---|
| **B1** | `communities` ที่ seed แล้ว + `users.otop_village_id` | `users.community_id` → ชุมชนจาก `otop_village_id` (join ผ่าน mapping) |
| **B2** | `users` ที่มี `community_id` | `community_places` ที่ `owner_id` = host → `community_id` = ชุมชนของ host |
| **B3** | `community_places.place_id` ขึ้นต้นด้วย `host-`/`otop-` | `users.business_place_id` = NULL (ไม่ใช่ Google id) |
| **B4** | `community_places.place_id` เป็น Google id จริง (ขึ้นต้นด้วย `ChIJ`) | `users.business_place_id` = `place_id` |
| **B5** | `community_places` ที่ยังไม่มี `community_id` | หา `community_id` จาก `place_id` ที่ผูกกับ `business_place_id` ของ host → ถ้าหาไม่ได้ **รายงานออกมา** (ต้องแก้ก่อน set not null) |
| **B6** | ตาราง `places` ที่มี `google_place_id` จริง (D19) | **copy** เข้า `community_places` + เติม `community_id` จาก `community`/`subdistrict`/`district`/`province` (match กับ `communities`) + `owner_id` = NULL + `recorded_by` = `verified_by` |

> **B1/B4/B6 ต้อง review ผลลัพธ์ด้วยตา** เพราะ `place_id` ที่ขึ้นต้นด้วย `ChIJ` เป็นรูปแบบของ Google Place ID (ยืนยันจาก [places.ts:405-417](backend/src/routes/places.ts#L405-L417) ที่ query Google) แต่ควร spot-check ก่อนรันจริง
>
> **B5 คือ gate สำคัญ** — ถ้ามีแถวที่หา `community_id` ไม่ได้ แปลว่ามีสถานที่ "ลอย" → ต้องจัดการก่อนจึงจะ `set not null` ได้
>
> **D19 (B6) — copy ไม่ใช่ move:** แถวใน `places` ยังอยู่ เพราะ `places` ยังเป็น cache ที่ `videos.place_id` ชี้อยู่ (D25: เก็บไว้ไม่ลบ) — การ copy ทำให้มีข้อมูลซ้ำ 2 ที่ชั่วคราว แต่ `community_places` เป็นแหล่งจริง (D1)

### 4.4 แก้ RPC — `add_community_places_structured.sql`

- allowlist `USER_FIELDS` เพิ่ม `businessPlaceId` → `business_place_id`
- allowlist `PLACE_FIELDS` เพิ่ม `communityId` → `community_id`
- `insert into community_places` เพิ่มคอลัมน์ `community_id` + `recorded_by`
- **`on conflict (place_id) do update` ต้องแก้เรื่อง `owner_id`** (D14):
  ```sql
  owner_id = case
    when community_places.owner_id is null then excluded.owner_id   -- เปลี่ยน NULL→host ได้
    else community_places.owner_id                                    -- มีเจ้าของแล้ว = ห้ามย้าย
  end,
  ```
  → หลักเดิม "owner_id ไม่ถูกย้าย" **ยังอยู่** แค่ผ่อนเป็น "ย้ายได้เฉพาะตอนยังไม่มีเจ้าของ"
- `recorded_by` = `coalesce(community_places.recorded_by, excluded.recorded_by)` (คนที่บันทึกครั้งแรกเท่านั้น)
- **ยุติการเขียน** `province`/`district`/`subdistrict`/`village` (D18) → ยังส่งไปได้แต่ไม่ถูกใช้

---

## 5. เฟส 2 — Backend

### 5.1 แยก "ค้นไม่ได้" ออกจาก "ค้นไม่เจอ" (2.6.2)

[places.ts:223-289](backend/src/routes/places.ts#L223-L289) — `searchPlaceCandidates` ต้อง **throw** เมื่อ Google ตอบผิดพลาด (`legData.status` ไม่ใช่ `OK` และไม่ใช่ `ZERO_RESULTS` — เช่น `REQUEST_DENIED` เมื่อบิลลิ่มปิด) → diag รายงานว่าเป็น **ข้อผิดพลาดของ API** ไม่ใช่ "ค้นแล้วไม่เจอสถานที่"

### 5.2 `enrichWithGooglePlaces` รับ scope ใหม่ — [places.ts:380-463](backend/src/routes/places.ts#L380-L463)

```ts
export async function enrichWithGooglePlaces(
  summary: AiSummaryResult,
  scope?: LocationScope          // { community?, subdistrict?, district?, province? }
): Promise<AiSummaryResult>
```

- query เดิม: `place_name + community + district + province + "ประเทศไทย"` → **เติม scope.subdistrict** เข้าไป (ตอนนี้ค้นได้แค่ระดับอำเภอ)
- **กรองผลแบบ strict**: ถ้ามี scope → เก็บเฉพาะ candidate ที่ `subdistrict` ตรง (fallback: `district` ตรง) — ปัจจุบัน [places.ts:433-436](backend/src/routes/places.ts#L433-L436) กรองแค่ "อยู่ในไทย"
- ถ้ามี scope แล้วไม่เหลือ candidate → คืน `place.google_candidates = []` (ไม่ error) เพื่อให้ client เข้าสู่เส้นทาง "ค้นใหม่ในชุมชน"
- **คืน `match_level` ทุก candidate** (ดู §2.2.2) — `village` / `subdistrict` / `district` → client ใช้เรียงลำดับ + แสดงป้าย (6.12)
- **เทียบชื่อหมู่บ้านแบบ substring หลัง normalize** — `communities.name` (เช่น "บ้านดอยปุย") เทียบกับ `formatted_address` + ชื่อสถานที่ — ชื่อที่สั้นเกิน ~5 ตัวอักษรให้ข้าม
- **ถ้า parse ตำบลไม่ได้ (regex เดิมจับได้ 1 คำ)** → ห้ามทิ้งผลลัพธ์ → ปล่อยเป็นระดับ `district` ให้ผู้ใช้ตัดสิน (ดู §2.2.2)

### 5.3 `/ai-summary/preview` + `/:postId/generate` รับ `locationScope`

[aiSummary.ts:19](backend/src/routes/aiSummary.ts#L19) (`readInput`), เรียกที่ [aiSummary.ts:87](backend/src/routes/aiSummary.ts#L87) และ [aiSummary.ts:175](backend/src/routes/aiSummary.ts#L175) — **2 จุด** ไม่ใช่จุดเดียว

> **เหตุผล:** โหมด `community_spot` ส่ง `uploaderType: "tourist"` และ `location: undefined` ([CreatePostScreen.tsx:336-339](src/Pages/CreatePostScreen.tsx#L336-L339)) → backend ไม่รู้ว่า host อยู่ชุมชนไหน → query scope ไม่ได้

### 5.4 `POST /places/verify` — เพิ่มพารามิเตอร์ `strict` — [places.ts:547](backend/src/routes/places.ts#L547)

ปัจจุบันกรองแบบ *prefer* (ถ้าไม่ match ก็คืนของทั่วประเทศกลับมา ดู L488-517) → เพิ่ม `strict?: boolean`:
- `strict: true` → กรองจริงตาม province/district/subdistrict และถ้าไม่เหลือ → คืน `candidates: []`
- ใช้ตอน "ค้นใหม่ในชุมชน" (เส้นทาง ③) — **ระดับตำบล** และมีระดับ "กว้างขึ้น" เป็นอำเภอ (D24)
- **default ต้องเป็น `false`** เพื่อไม่ให้ผู้เรียกเดิม (เช่น `ProfileLocal`) ได้ผลเปลี่ยน
- รับ `scopeLevel?: 'subdistrict' | 'district'` → ระดับตำบล default, ปุ่ม "ค้นกว้างขึ้น" = ถอด `subdistrict` ออก (D24)

### 5.5 `POST /places/upsert-host-place` — เพิ่ม `communityId` + `businessPlaceId`

[hostPlace.ts:30](backend/src/routes/hostPlace.ts#L30) (`USER_FIELDS`), [hostPlace.ts:44](backend/src/routes/hostPlace.ts#L44) (`PLACE_FIELDS`), route ที่ [hostPlace.ts:92](backend/src/routes/hostPlace.ts#L92)

- `USER_FIELDS` เพิ่ม `businessPlaceId` → `business_place_id`
- `PLACE_FIELDS` เพิ่ม `communityId` → `community_id`
- **RPC ต้องแก้ allowlistด้วย** (2.6.3) และ `insert into community_places` ต้องเพิ่ม `community_id` + `recorded_by`

### 5.6 `POST /places/save-place-details` — แยกสิทธิ์ host/tourist (D6 + D26)

[places.ts:701](backend/src/routes/places.ts#L701) — ปัจจุบันบล็อกที่ [places.ts:743](backend/src/routes/places.ts#L743) (`userRow?.role !== "host"`) → เปลี่ยนเป็น:

| บทบาท | เขียนแถวใหม่ได้ | แก้ `phone`/`opening_hours`/`price_level`/`website` | แก้ `capacity`/`house_rules`/`areas`/`facilities` |
|---|---|---|---|
| host | ✅ | ✅ | ✅ |
| tourist | ✅ (เฉพาะช่องที่ยังว่าง) | ❌ | ✅ (เฉพาะช่องที่ยังว่าง) |

> `price_info` / `business_pricing` / `business_hours` **ไม่ได้อยู่ใน endpoint นี้** — เขียนผ่าน RPC `host_save_business_profile` (ช่องทาง B ใน §2.5) → tourist แตะไม่ได้อยู่แล้ว ไม่ต้องเพิ่มโค้ดกัน
>
> `rating` / `user_ratings_total` ไม่อยู่ใน `DETAIL_FIELDS` → ไม่มีใครแก้ได้ (ข้อมูลจาก Google)

**กฎ "เติมเฉพาะที่ยังว่าง" สำหรับ tourist:** ถ้าแถวมีอยู่แล้ว → update เฉพาะ column ที่ `IS NULL` เท่านั้น; ถ้าไม่มีแถว → insert ใหม่ (เฉพาะ 4 คอลัมน์จากคลิป + `community_id` + `recorded_by`)

> **ความปลอดภัย:** backend ใช้ service role → RLS ถูกข้าม → **การบล็อกต้องทำที่ backend** ไม่ใช่ฝากไว้ที่ RLS (แก้ policy ข้อ 2.6.4 ด้วยเพื่อให้ตรงกัน)

### 5.7 `GET /places/community` — endpoint ใหม่

`GET /places/community?communityId=…` → คืนรายการสถานที่ของชุมชน **พร้อม join `communities`** เพื่อดึงชื่อ hierarchy (D18) และ `recorded_by`/`owner_id`

### 5.8 AI แชท — `backend/src/routes/aiChat.ts` (เฟส 4 แต่เตรียมโครงที่นี่)

| โหมด | ตอนนี้ | ใหม่ (D22) |
|---|---|---|
| host-self ([aiChat.ts:160](backend/src/routes/aiChat.ts#L160)) | `owner_id = userId` + `limit(1)` → ได้แถวเดียว | `community_id = host.community_id` → ได้ทุกสถานที่ของชุมชน (จำกัด ~20) |
| tourist ([aiChat.ts:206](backend/src/routes/aiChat.ts#L206)) | `limit(50)` ทั้งตาราง + match ด้วยชื่อ | ถ้ารู้ `community_id` → ดึงเฉพาะชุมชนนั้น / ไม่รู้ → match ด้วยชื่อเหมือนเดิม + ให้โมเดลเลือก |

→ `PlaceContext` (ที่ [tripPrompt.ts:199-259](backend/src/tripPrompt.ts#L199-L259)) ต้องรองรับหลายสถานที่ — เปลี่ยนเป็น `places: PlaceContext[]` พร้อม backward compat ของ `place` เดิม

> หมายเหตุ: `select` ใน tourist branch ต้องเพิ่มคอลัมน์ `community_id` และ `users:owner_id` ต้องเพิ่ม `community_id` ด้วย
>
> ⚠️ **`tripPrompt.ts` มีการแก้ค้างอยู่ → ห้ามแตะ** (ดู §8) — ถ้าต้องแก้ `PlaceContext` ให้ทำเป็น commit แยกและประสานกับผู้ใช้ก่อน

---

## 6. เฟส 3 — Mobile หน้าโพสต์

### 6.1 เปลี่ยน `findLocalPlaces` ให้ค้นด้วย id (D7) — [placesLocalService.ts:44-63](src/services/placesLocalService.ts#L44-L63)

`q.ilike("name", '%'+name+'%')` ([placesLocalService.ts:52](src/services/placesLocalService.ts#L52)) → `q.eq("google_place_id", googlePlaceId)` และ `saveVerifiedPlace` ต้องใช้ id ตรวจซ้ำแทนชื่อ (2.6.5)

> **เหตุผล:** การ match ด้วยชื่อแบบ ILIKE ทำให้ "บ้านปาย" ไปตรงกับ "บ้านปายใหม่" แล้ว **เลือกให้อัตโนมัติ** ([CreatePostScreen.tsx:484](src/Pages/CreatePostScreen.tsx#L484)) แล้วเลิกค้น Google ทิ้ง — ขัดกับ docblock ของตัวเอง ("never auto-pick when more than one") และขัดกับ D2

### 6.2 สร้างฟังก์ชันเทียบ "ตรงกับทะเบียน" — ไฟล์ใหม่ `src/services/placeMatchService.ts`

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

### 6.3 ปรับ `runLocationVerify` — [CreatePostScreen.tsx:432](src/Pages/CreatePostScreen.tsx#L432)

```
runLocationVerify(place)
  │
  ├─ เติมฟอร์มจากที่ AI อ่านได้ (เหมือนเดิม)
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

### 6.4 การ์ด "ตรงกับที่ลงทะเบียน" (ใหม่)

```
┌─────────────────────────────────────────────┐
│ ✓ ตรงกับที่ลงทะเบียนของชุมชน              │
│   [ชื่อสถานที่ — อ่านได้ แก้ได้]              │
│   ที่อยู่ · ต./อ./จ.                        │
│   [ ✓ ยืนยันถูกต้อง ]  [ ✕ ไม่ใช่ที่นี่ ]   │
└─────────────────────────────────────────────┘
```

ปุ่ม "✕ ไม่ใช่ที่นี่" → **ไม่ล้างข้อมูล** แต่ไปสู่เส้นทาง ③ (ต่างจาก `clearLocation()` ปัจจุบันที่ล้างทุกอย่างที่ [CreatePostScreen.tsx:666](src/Pages/CreatePostScreen.tsx#L666))

### 6.5 `searchInCommunity()` — เส้นทาง ③ (ใหม่, D24)

```ts
await verifyPlaceOnGoogle({
  placeName,
  community: scopeCommunity,
  subdistrict: scopeSubdistrict,   // ← ระดับตำบล (ค่าเริ่มต้น)
  district: scopeDistrict,
  province: scopeProvince,
  strict: true,
});
```

- scope สำหรับ host โหมด community_spot = ชุมชน/ตำบล/อำเภอ/จังหวัดของ host
- scope สำหรับ tourist = ค่าที่ AI อ่านได้ + ที่ผู้ใช้กรอก
- ผลลัพธ์ที่เจอ → ขึ้นเป็น **"สถานที่ใหม่ในชุมชน"** ให้กดยืนยัน (ต่างจาก candidate ทั่วไปด้วยป้ายกำกับ)
- **เมื่อผลลัพธ์ว่าง** → ปุ่ม **"ค้นกว้างขึ้น (ทั้งอำเภอ)"** → เรียกซ้ำโดยถอด `subdistrict` ออก (D24)
- ผลลัพธ์ถูกจัดลำดับตาม `match_level` (`village` ก่อน `subdistrict` ก่อน `district`) และติดป้ายกำกับ (6.12)
- **ถ้าไม่มี candidate ที่ `match_level = village` เลย = ยังไม่มีอะไรที่อยู่ "ในหมู่บ้าน" จริง** → ต้องบอกผู้ใช้ตามตรง ห้ามทำให้ดูเหมือนอยู่ในหมู่บ้าน (ดู §2.2.2)
- ผู้ใช้ยืนยันสถานที่ที่เลือก → เขียน `community_match_level = 'manual'` (ผู้ใช้เลือกชุมชนเอง — เชื่อถือที่สุด)

### 6.6 โหมด own_business — ตรวจเทียบเสมอ + บังคับยืนยัน (D5 + D27 + D17)

เปลี่ยนจาก "ล็อกตำแหน่ง ไม่ตรวจ" ([CreatePostScreen.tsx:377-380](src/Pages/CreatePostScreen.tsx#L377-L380)) เป็น:

- ส่ง `locationScope` = ชุมชน/ตำบล/อำเภอ/จังหวัดของ host → backend ค้น Google scoped
- ได้ candidate → เทียบกับ `user.business_place_id`
  - **ตรง** → การ์ด "✓ ตรงกับที่ลงทะเบียนของคุณ" → ยืนยัน → ใช้ตำแหน่งทะเบียน
  - **ไม่ตรง** → ขึ้นเป็น "สถานที่ใหม่ในชุมชน" → ยืนยัน → บันทึกเป็นสถานที่ของชุมชน
- **ไม่ตรงและไม่มี candidate** → เตือนว่าคลิปนี้อาจไม่ได้ถ่ายที่สถานที่ที่ลงทะเบียน → **ให้ host เลือกหมุด Google** (D17) → บันทึกกลับ `users.business_place_id` → ยืนยัน → โพสต์ได้
- **บังคับยืนยันก่อนโพสต์เสมอ** (D27) — ไม่มีทางโพสต์ผ่านโดยไม่ผ่านขั้นตอนยืนยัน

> ⚠️ **จุดที่พฤติกรรมเปลี่ยนมากที่สุด** — โหมดนี้เคย "สำเร็จเสมอ" เพราะไม่เคยตรวจ ต้องมี fallback ที่ไม่ทำให้ host ที่ถ่ายถูกที่แต่ Google หาไม่เจอ ต้องโดนบล็อก (D17 คือคำตอบ)

### 6.7 บันทึกสถานที่เข้าชุมชน

[CreatePostScreen.tsx:604](src/Pages/CreatePostScreen.tsx#L604) และ [CreatePostScreen.tsx:827](src/Pages/CreatePostScreen.tsx#L827) (จุดเรียก `saveVerifiedPlace`) — เพิ่ม `communityId`:

- host → `communityId = user.community_id`
- tourist → ต้องระบุชุมชน: หาก place อยู่ในตำบลที่มีชุมชนที่ลงทะเบียนไว้ 1 ชุมชน → ใช้ชุมชนนั้น / มากกว่า → ให้ผู้ใช้เลือกในการ์ดยืนยัน
- **จับคู่ชุมชนไม่ได้ → ไม่บันทึกเลย** (D11) — ไม่มี `pending_review`, ไม่มี `community_id = NULL`
- `owner_id` = host (ถ้าเป็น host) / NULL (ถ้าเป็น tourist) + `recorded_by` = ผู้ใช้ที่บันทึก

### 6.8 ซ่อนการ์ดแก้ไขรายละเอียดจาก tourist (D6)

[CreatePostScreen.tsx:1502-1503](src/Pages/CreatePostScreen.tsx#L1502-L1503) เงื่อนไข `isCommunityHost && confirmedPlace?.placeId && placeDetailsReady` → tourist ไม่เห็นการ์ด `PlaceDetailsCard`

> หมายเหตุ: D26 ให้ tourist เติม `capacity`/`house_rules`/`areas`/`facilities` ได้ → การ์ดนี้ต้อง**ยังแสดง** แต่ปิดเฉพาะช่องที่ tourist แก้ไม่ได้ (ราคา/เวลาเปิด/โทร) — **ไม่ใช่ซ่อนทั้งการ์ด**

### 6.9 เขียน `community` ที่ยืนยันแล้วกลับลง summary

[CreatePostScreen.tsx:237-264](src/Pages/CreatePostScreen.tsx#L237-L264) ปัจจุบันคง `place.community` ของ AI ไว้ ไม่ใช่ค่าที่ผู้ใช้ยืนยัน → ต้องเขียนค่าที่ยืนยันแล้วลงไปด้วย

### 6.10 ปรับช่องทะเบียนของ host

- [AuthContext.tsx:170](src/state/AuthContext.tsx#L170) — เพิ่ม `business_place_id?: string | null` ใน user row (อ่านผ่าน `select("*")` แล้ว จึงแค่เพิ่ม field ใน type) + `community_id`
- [OnboardingScreen.tsx:273](src/Pages/Auth/OnboardingScreen.tsx#L273) — บันทึก `businessPlaceId` เมื่อยืนยันหมุด Google + **แก้บั๊ก timestamp** (2.6.1)
- [ProfileLocal.tsx:348](src/Pages/ProfileLocal.tsx#L348) — เหมือนกัน + แก้รูปแบบ id
- [hostPlaceService.ts:106](src/services/hostPlaceService.ts#L106) — `HostPlaceWrite.users` เพิ่ม `businessPlaceId`

### 6.11 บังคับ D9 + D16 — host ต้องมี OTOP และมีทางกลับมา

- [OnboardingScreen.tsx:258](src/Pages/Auth/OnboardingScreen.tsx#L258) `applyOtopFallbackPin` — ปัจจุบันเป็น *fallback* (ยังลงทะเบียนได้แม้ไม่มี OTOP) → เปลี่ยนเป็น **บังคับ**: host ต้องเลือกหมู่บ้าน OTOP ให้เสร็จก่อนจบขั้นตอน
- [ProfileLocal.tsx:337](src/Pages/ProfileLocal.tsx#L337) `applyBizOtopFallback` — เหมือนกัน
- จุดที่บันทึก host: validation `otop_village_id` ว่าง = ยังเป็น host ไม่ได้ → บันทึก `role` เป็น `host` ได้ก็ต่อเมื่อมีค่านี้
- **D16 — ปุ่ม "ยืนยันตัวตนเป็น host"** ในหน้าโปรไฟล์: กรอกเลขประกอบการ → เรียก `/otop/verify/:id` → ผ่านก็เลื่อน `role` = `host` + เซ็ต `otop_village_id`/`community_id`

### 6.12 ป้ายกำกับแหล่งที่มา (D21)

| กลุ่มข้อมูล | ป้าย |
|---|---|
| `price_info` / `business_pricing` / `phone` / `opening_hours` / `website` | "เจ้าของแจ้ง" |
| `capacity` / `house_rules` / `areas` / `facilities` | "จากคลิป" |
| `rating` / `user_ratings_total` / `price_level` | "จาก Google" |
| `community_match_level` = `village` | "อยู่ในหมู่บ้านนี้" |
| `community_match_level` = `subdistrict` | "อยู่ตำบลเดียวกัน" |
| `community_match_level` = `district` | "อยู่ในอำเภอเดียวกัน" |
| `community_match_level` = `manual` | "ผู้ใช้ระบุเอง" |

### 6.13 ไฟล์ที่เฟส 3 แตะ (ตรวจทีละไฟล์)

| ไฟล์ | สิ่งที่เปลี่ยน | ความเสี่ยง |
|---|---|---|
| `src/Pages/CreatePostScreen.tsx` | flow ใหม่ทั้งก้อน | สูง — หน้าหลักของงานนี้ |
| `src/services/placeMatchService.ts` | **ใหม่** | ต่ำ |
| `src/services/placesLocalService.ts` | ค้นด้วย id (ทั้ง `findLocalPlaces` + `saveVerifiedPlace`) | กระทบ auto-pick เดิม (ตั้งใจ) |
| `src/services/placesService.ts` | เพิ่ม `strict` | ต่ำ |
| `src/state/AuthContext.tsx` | เพิ่ม field | ต่ำ |
| `src/Pages/Auth/OnboardingScreen.tsx` | บันทึก Google id + แก้บั๊ก + บังคับ OTOP | กระทบการลงทะเบียน |
| `src/Pages/ProfileLocal.tsx` | เหมือนกัน + ปุ่มยืนยันตัวตน (D16) | กระทบการแก้ร้าน |
| `src/components/PlaceDetailsCard.tsx` | ซ่อนช่องที่ tourist แก้ไม่ได้ + ป้ายแหล่งที่มา | ต่ำ |
| `src/services/hostPlaceService.ts` | เพิ่ม `businessPlaceId` | ต่ำ |

---

## 7. เฟส 4 — โปรไฟล์ชุมชน + แผนที่ + AI แชท (D20–D23)

### 7.1 หน้าโปรไฟล์ชุมชน

[ProfileLocal.tsx](src/Pages/ProfileLocal.tsx) ดึงจาก `GET /places/community?communityId=…` → แสดงรายการสถานที่พร้อม:
- ชื่อ / ที่อยู่ / เวลาเปิด / โทร / เว็บ
- **ราคา: ทั้ง `price_info` และ `price_level` + ป้ายกำกับ** (D21)
- ป้ายแหล่งที่มาของทุกกลุ่ม (6.12)
- จำกัดจำนวนต่อหน้า ~20 + ปุ่ม "ดูเพิ่มเติม" (AI แชทใช้ cap เดียวกัน)
- **Empty state** — ชุมชนที่ยังไม่มีสถานที่ที่ยืนยันแล้ว → "ยังไม่มีสถานที่ในชุมชนนี้" + ปุ่ม "เป็นคนแรกที่เพิ่ม" (เปิด flow ค้นในตำบล) — ห้ามเป็นหน้าว่าง (ดู §2.2.4)

### 7.2 แผนที่

`src/Pages/Map/*` ปัจจุบันแสดงแต่หมู่บ้าน OTOP (ระดับชุมชน) → เพิ่มชั้นหมุดระดับสถานที่ (จาก `community_places` ที่มี lat/lng) + toggle "ชุมชน / สถานที่"

### 7.3 AI แชท

- host-self → ดึงทุกสถานที่ของ `community_id` (จำกัด ~20) — ถามได้ทั้ง "ของฉัน" และ "ทุกที่ในหมู่บ้าน" (D22)
- tourist → ถ้ารู้ `community_id` ดึงเฉพาะชุมชนนั้น / ไม่รู้ → match ด้วยชื่อ + ให้โมเดลเลือก
- `PlaceContext` → `places: PlaceContext[]` (5.8)

### 7.4 `nearby_communities` / `retrieved_context`

[tripPrompt.ts:28-30](backend/src/tripPrompt.ts#L28-L30) สั่งโมเดลให้ยึดสองค่านี้เป็นแหล่งหลัก — แต่**ไม่มีโค้ดไหนส่งค่านี้เลย** และไม่มีชั้น RAG/vector ในโรเจกต์

- `nearby_communities` = ชุมชน **จังหวัดเดียวกัน** เรียงตามจำนวนสถานที่ที่ยืนยันแล้ว (D23) — ไม่ต้องคำนวณระยะทาง (ชุมชนไม่มี lat/lng)
- `retrieved_context` = สถานที่ในชุมชนที่ผู้ใช้กำลังถาม

> ⚠️ `tripPrompt.ts` มีการแก้ค้างอยู่ → **ห้ามแตะ** — ถ้าต้องแก้ ให้แยก commit และประสานกับผู้ใช้ก่อน

---

## 8. สิ่งที่ห้ามแตะ / ระบบที่ต้องไม่พัง

| สิ่ง | ที่อยู่ | เหตุผล |
|---|---|---|
| `backend/src/tripPrompt.ts` | มีการแก้ค้างอยู่ | ไม่เกี่ยวกับงานนี้ — **ห้ามแตะ** |
| `owner_id` **ไม่ถูกย้ายระหว่าง host** | [places.ts:770](backend/src/routes/places.ts#L770) + [add_community_places_structured.sql:174-191](supabase/migrations/add_community_places_structured.sql#L174-L191) | หลัก "ราคาเป็นของสถานที่ ไม่ใช่ของผู้โพสต์" ต้องอยู่ — ย้ายได้**เฉพาะ NULL→host** (D14) เท่านั้น ห้ามย้ายจาก host คนหนึ่งไปอีกคน |
| "ค่าของเจ้าของสถานที่ชนะค่าของ Google" | `seedPlaceDetails` + `fetchPlaceDetailsRow` ([placeDetailsService.ts:105](src/services/placeDetailsService.ts#L105)) | ห้ามกลับด้าน — tourist ต้องยึดกฎเดียวกัน (5.6) |
| การคุมค่าใช้จ่าย Places API | `SEARCH_FIELD_MASK` / `DETAILS_FIELD_MASK` | ค้น 1 ครั้ง + ดึง detail 1 ครั้ง (เฉพาะตอนผู้ใช้ติ๊ก) — ห้ามเพิ่ม call โดยไม่คิด |
| `/places/verify` default behavior | [places.ts:488-517](backend/src/routes/places.ts#L488-L517) | ผู้เรียกเดิมต้องได้ผลเดิม → `strict` เป็น opt-in |
| `google_candidates` ถูกตัดตอน persist | [uploadService.ts:54](src/services/uploadService.ts#L54) | เหตุผลเดิมยังดี (ไม่ให้ candidate ค้างใน DB) |
| ตาราง `places` | [placesLocalService.ts](src/services/placesLocalService.ts) | D1: ใช้เป็น cache ต่อไป, **D25: เก็บไว้ไม่ลบ** — ห้ามลบ |
| `services` / `bookings` / `passport_stamps` | [schema.sql:79-90, 263-280](supabase/schema.sql#L79-L90) | dead code เหมือนกัน — **ไม่แตะ** (สังเกตว่า `on delete cascade` จาก `communities` จะกระทบ แต่ไม่มีแถวอยู่) |
| ชุมชนที่ลงทะเบียน OTOP | `communities` | **ห้ามแก้ไข** (D12) — เพิ่มได้เฉพาะ seed จาก OTOP data |
| `src/data/thailand_hierarchy.json` | โครงสร้างข้อมูล | เพิ่มได้เฉพาะคอลัมน์ `otop_village_id` (ขั้น 0.6) — **ห้ามลบ/เปลี่ยนชื่อฟิลด์เดิม** (แอปอ่านอยู่) |

---

## 9. ลำดับการลงมือ (ไล่ลำดับใหม่ — เรียงตามชั้นจริง)

> เดิมแผนรวมงาน migration กับงาน UI ปนกัน → ไล่ใหม่เป็น **ข้อมูล → backend → mobile → เฟส 2** เพื่อให้แต่ละชั้นทดสอบได้เดี่ยว ๆ และไม่มีขั้นตอนไหนต้องรอผลของขั้นที่ยังไม่เสร็จ

### เฟส 0 — เตรียมข้อมูล (ไม่แตะโค้ดแอป)

| # | งาน | ไฟล์ | เสร็จเมื่อ |
|---|---|---|---|
| 0.1 | Probe Google Places สด | — | ได้ผลจริง ≥ 1 candidate |
| 0.2 | เปิด Places (New) (ถ้าคุ้ม) | — | เปิดแล้ว หรือตัดสินใจใช้ Legacy |
| 0.3 | เปิด billing | — | มีงบ/เปิดแล้ว |
| 0.4 | ทำ mapping file หมู่บ้าน → CDD Village_ID | ไฟล์ใหม่ (mapping) | ครบทุกหมู่บ้านที่มี host |
| 0.5 | นับ host ที่ไม่มี `otop_village_id` | — | ได้ตัวเลขจริง |
| 0.6 | เติม `otop_village_id` ใน hierarchy | `src/data/thailand_hierarchy.json` | ทุกแถวที่ map ได้มี id |
| 0.7 | Probe ผลค้นระดับตำบลของหมู่บ้าน OTOP จริง | — | เห็น candidate จริง + ตัดสินใจว่าใช้ได้ไหม |

### เฟส 1 — โครงข้อมูล

| # | งาน | ไฟล์ | เสร็จเมื่อ |
|---|---|---|---|
| 1.1 | เขียน migration (ALTER `communities` + คอลัมน์ใหม่ + ดัชนี) | `add_place_matching.sql` | รันได้โดยไม่ error |
| 1.2 | เขียน + รัน seed `communities` 3,882 แถว | `backend/scripts/seed_communities.ts` | ตรวจนับแล้ว = 3,882 |
| 1.3 | เขียน + รัน backfill B1–B5 (spot-check ก่อน) | `backend/scripts/backfill_places.ts` | `business_place_id` + `community_id` ถูกต้อง, ไม่มีแถวค้าง |
| 1.4 | เขียน + รัน backfill B6 (copy จาก `places`) | ไฟล์เดียวกัน | สถานที่ที่ยืนยันแล้วเข้า `community_places` |
| 1.5 | set `community_places.community_id` **not null** (หลัง B5/B6 ไม่มีแถวค้าง) | `add_place_matching.sql` | ไม่มีแถว NULL |
| 1.6 | แก้ RPC allowlist + `community_id`/`recorded_by` + `owner_id` แบบ NULL→host | `add_community_places_structured.sql` | host บันทึกแล้ว `community_id` ถูกเขียน |
| 1.7 | แก้ RLS policy | `policies.sql` | tourist insert ไม่ได้แปะ `owner_id` คนอื่น |

### เฟส 2 — Backend (ทดสอบด้วย curl ได้ ไม่ต้องแตะแอป)

| # | งาน | ไฟล์ | เสร็จเมื่อ |
|---|---|---|---|
| 2.1 | แยก "ค้นไม่ได้" จาก "ค้นไม่เจอ" (2.6.2) | `backend/src/routes/places.ts` | บิลลิ่มปิด → diag บอกว่า error ของ API |
| 2.2 | `enrichWithGooglePlaces` รับ scope + กรอง strict | `backend/src/routes/places.ts` | ค้นแล้วเหลือเฉพาะในตำบล |
| 2.3 | `aiSummary` รับ `locationScope` (2 จุดเรียก) | `backend/src/routes/aiSummary.ts` | query แคบลงตาม scope |
| 2.4 | `/places/verify` รับ `strict` | `backend/src/routes/places.ts` | default เดิมไม่เปลี่ยนผล |
| 2.5 | `/places/upsert-host-place` + `communityId`/`businessPlaceId` | `backend/src/routes/hostPlace.ts` | บันทึกแล้วเขียนครบ |
| 2.6 | `/places/save-place-details` แยกสิทธิ์ host/tourist (D6 + D26) | `backend/src/routes/places.ts` | tourist แก้ราคาไม่ได้ แต่เติมข้อมูลจากคลิปได้ |
| 2.7 | `GET /places/community?communityId=` + join hierarchy | `backend/src/routes/places.ts` | คืนรายการพร้อมชื่อจังหวัด/อำเภอ/ตำบล |
| 2.8 | กรอง 3 ชั้น + คืน `match_level` (D28, §2.2.2) | `backend/src/routes/places.ts` | ทุก candidate มีระดับการจับคู้ |

### เฟส 3 — Mobile หน้าโพสต์

| # | งาน | ไฟล์ | เสร็จเมื่อ |
|---|---|---|---|
| 3.1 | แก้ `place_id` ทั้ง 3 ทางให้ใช้ `syntheticPlaceId` เดียว (2.6.1) | `OnboardingScreen.tsx`, `ProfileLocal.tsx` | บันทึกซ้ำแล้วไม่เพิ่มแถว |
| 3.2 | `findLocalPlaces` + `saveVerifiedPlace` ค้นด้วย id (D7, 2.6.5) | `placesLocalService.ts` | ไม่มี auto-pick จากชื่อ fuzzy |
| 3.3 | `placeMatchService.ts` + เทียบใน `runLocationVerify` | `placeMatchService.ts`, `CreatePostScreen.tsx` | candidate ที่ตรง id แสดงการ์ด "ตรงกับทะเบียน" |
| 3.4 | การ์ด "ตรงกับที่ลงทะเบียน" + ปุ่ม "✕ ไม่ใช่ที่นี่" ไม่ล้างข้อมูล | `CreatePostScreen.tsx` | กดแล้วข้อมูลเดิมยังอยู่ |
| 3.5 | `searchInCommunity()` + ปุ่ม "ค้นกว้างขึ้น" + เรียงลำดับตาม `match_level` (D24/D28) | `placesService.ts`, `backend/places.ts`, `CreatePostScreen.tsx` | กด "ไม่ใช่" แล้วได้รายการในชุมชน พร้อมป้ายระดับ ไม่ใช่ฟอร์มว่าง |
| 3.6 | own_business: ตรวจเทียบ + บังคับยืนยัน + เลือกหมุดตอนโพสต์ (D17/D27) | `CreatePostScreen.tsx` | คลิปที่ไม่ใช่ร้านตัวเองถูกจับได้, โพสต์ไม่ได้ถ้าไม่ยืนยัน |
| 3.7 | บันทึก `community_id` + `owner_id`/`recorded_by` + ไม่บันทึกถ้าจับคู่ไม่ได้ (D11/D14) | `backend/places.ts`, `CreatePostScreen.tsx` | tourist บันทึกได้แต่แก้ราคาไม่ได้ |
| 3.8 | `business_place_id` + `community_id` ใน AuthContext + จุดบันทึก | `AuthContext.tsx`, `OnboardingScreen.tsx`, `ProfileLocal.tsx`, `hostPlaceService.ts` | host ที่เลือกหมุด Google มี id ใน user row |
| 3.9 | บังคับ OTOP + ปุ่มยืนยันตัวตนในโปรไฟล์ (D9/D16) + ลดสิทธิ์ host เดิม | `OnboardingScreen.tsx`, `ProfileLocal.tsx`, `hostPlaceService.ts` | host เดิมกลับมาเป็น host ได้ด้วยเลขประกอบการ |
| 3.10 | ซ่อนเฉพาะช่องที่ tourist แก้ไม่ได้ + ป้ายแหล่งที่มา (D21/D26) | `PlaceDetailsCard.tsx` | tourist เห็นข้อมูลจากคลิปแต่แก้ราคาไม่ได้ |
| 3.11 | เขียน `community` ที่ยืนยันแล้วกลับลง summary | `CreatePostScreen.tsx` | `summary.community` = ค่าที่ยืนยัน |
| 3.12 | lint + typecheck + ทดสอบจริง 3 แบบ | — | ผ่านทั้ง 3 โหมด |

### เฟส 4 — โปรไฟล์ + แผนที่ + แชท

| # | งาน | ไฟล์ | เสร็จเมื่อ |
|---|---|---|---|
| 4.1 | AI แชท: host-self ดึงทั้งชุมชน + tourist resolve ชุมชน (D22) | `backend/src/routes/aiChat.ts` | ถาม "มีอะไรในหมู่บ้านฉัน" ได้ครบ |
| 4.2 | `PlaceContext` → `places: PlaceContext[]` (⚠️ `tripPrompt.ts` ห้ามแตะ) | `backend/src/tripPrompt.ts` | ประสานกับผู้ใช้ก่อนแก้ |
| 4.3 | `nearby_communities` = จังหวัดเดียวกัน เรียงตามจำนวนสถานที่ (D23) | `backend/src/routes/aiChat.ts` | prompt ได้ค่าที่สั่งไว้ |
| 4.4 | หน้าโปรไฟล์ชุมชน: รายการสถานที่ + ราคา + ป้าย (D20/D21) | `ProfileLocal.tsx` | เห็นรายการครบ ในชุมชน |
| 4.5 | แผนที่: ชั้นหมุดสถานที่ + toggle (D20) | `src/Pages/Map/*` | กดชุมชนเห็นสถานที่ข้างใน |

> **ลำดับสำคัญ:** 1.1 → 1.2 → 1.3 → 1.4 → 1.5 ต้องเรียงตามนี้ (FK ต้องมีก่อน backfill) และ 1.6–1.7 ต้องมาก่อนเฟส 2 (backend เขียนผ่าน RPC) — ถ้าแก้ RPC ก่อน migration แล้ว runtime จะ error
>
> **3.1 ต้องมาก่อน 1.3** — ถ้ายังมี id ที่มี timestamp การ backfill B4 จะเขียน `business_place_id` ผิด และ D2 จะพังตั้งแต่ต้น

---

## 10. คำถามที่ตอบแล้ว (ครบทุกข้อ)

| # | คำถาม | คำตอบ | ผลกับแผน |
|---|---|---|---|
| Q1 | ชุมชน 1 ชุมชน มี host ได้หลายคนไหม? | **ได้หลายคน** | `users.community_id` (1.1 ข้อ 2) |
| Q2 | รายการสถานที่ในชุมชน แสดงที่ไหน? | **ทั้งสามที่** — โปรไฟล์ + แผนที่ + แชท | → D20, เฟส 4 มี 3 หน้าจอ |
| Q3 | tourist เจอชุมชนที่ยังไม่มี → สร้างชุมชนใหม่ไหม? | **ไม่สร้าง** — และ **ไม่บันทึกถ้าจับคู่ไม่ได้** | → D11, 6.7 (ไม่มี `pending_review`) |
| Q4 | cache `places` เก็บไว้นานแค่ไหน? | **เก็บไว้ไม่ลบ** | → D25 (§8) |
| Q5 | tourist เห็นราคาไหม? | **เห็นทั้ง `price_info` และ `price_level` + ป้ายกำกับแหล่งที่มา** | → D21, 6.12, 7.1 |
| Q6 | tourist บันทึกสถานที่ครั้งแรก → `owner_id` คือใคร? | **ผู้ประกอบการ (host)** + `recorded_by` = คนที่บันทึก | → D14, 4.4, 5.5 |
| Q7 | host ที่ไม่มี OTOP → อยู่ชุมชนไหน? | **ทุก host ต้องมีเลขประกอบการ OTOP** | → D9, 6.11 |
| Q8 | host เดิมที่ไม่มี OTOP จัดการยังไง? | **ลดสิทธิ์เป็น tourist** + ปุ่มยืนยันตัวตนในโปรไฟล์ | → D16, 6.11, ขั้น 3.9 |
| Q9 | host หลายคนแก้สถานที่เดียวกัน ใครเขียนทับ? | **ไม่มีกรณีนี้** — 1 host = 1 สถานที่ประกอบการ; host แก้ได้เฉพาะที่ `business_place_id` ของตัวเองชี้ | → D15, 6.6, 5.6 (บั๊ก 2.7 เดิม **ตกไป**) |
| Q10 | "สถานที่รอตรวจ" ใครตรวจ? | **ไม่มี "สถานที่รอตรวจ"** — จับคู่ชุมชนไม่ได้ก็ไม่บันทึก | → D11, 6.7 |
| Q11 | tourist เติมข้อมูลอะไรได้บ้าง? | **เฉพาะข้อมูลจากคลิป** (`capacity`/`house_rules`/`areas`/`facilities`) | → D26, 5.6, 6.8 |
| Q12 | ชุมชน (OTOP) เก็บเป็น registry ยังไง? | **seed จาก `thailand_hierarchy.json` ทั้ง 3,882 แถว** | → D12, 4.2 |
| Q13 | เชื่อม hierarchy กับ CDD Village_ID ยังไง? | **เติม `otop_village_id` ใน data file** | → D13, ขั้น 0.4/0.6 |
| Q14 | 1 host = 1 สถานที่ → `owner_id` เป็นใคร? | **ผู้ประกอบการ + `recorded_by`** | → D14, 4.4, 5.5 |
| Q15 | จับคู่ชุมชนไม่ได้ → ใครดู? | **ไม่บันทึกเลย** | → D11, 6.7 |
| Q16 | host เดิมที่ถูกลดสิทธิ์ → กลับมาเป็น host ยังไง? | **ปุ่มยืนยันตัวตนในโปรไฟล์** | → D16, 6.11 |
| Q17 | own_business แล้ว Google ไม่เจอ → `business_place_id` เป็นอะไร? | **ให้เลือกหมุดตอนโพสต์แล้วบันทึกกลับ** | → D17, 6.6 |
| Q18 | ชื่อ hierarchy ใน `community_places` เก็บไว้หรือดึงจาก `communities`? | **ดึงจาก `communities` ตอนอ่าน** | → D18, 4.1 ข้อ 6, 5.7 |
| Q19 | ข้อมูลที่ยืนยันแล้วใน `places` → ย้ายเข้า `community_places` ไหม? | **ย้าย (copy)** | → D19, backfill B6 |
| Q20 | AI แชทดึงข้อมูลแบบไหน? | **ถามได้ทั้งชุมชน — โมเดลเลือกให้** | → D22, 5.8, 7.3 |
| Q21 | `nearby_communities` ใช้เกณฑ์อะไร? | **จังหวัดเดียวกัน เรียงตามจำนวนสถานที่** | → D23, 7.4 |
| Q22 | ปุ่ม "ค้นใหม่ในชุมชนนี้" ค้นระดับไหน? | **ตำบล + ปุ่ม "ค้นกว้างขึ้น (ทั้งอำเภอ)"** | → D24, 5.4, 6.5 |
| Q23 | ป้ายกำกับแหล่งที่มา → ติดแค่ราคาหรือทุกกลุ่ม? | **ติดป้ายทุกกลุ่ม** | → D21, 6.12 |
| Q24 | ได้ CDD Village_ID มาจากไหน? | **map เฉพาะหมู่บ้านที่มี host ก่อน** | → ขั้น 0.4, 0.6 |
| Q25 | own_business ต้องยืนยันก่อนโพสต์ไหม? | **บังคับยืนยันก่อนโพสต์** | → D27, 6.6 |
| Q26 | hierarchy ไม่มีสถานที่ในชุมชน — สถานที่ในชุมชนมาจากไหน? | **ไม่มีแหล่งข้อมูลสำเร็จรูป — สถานที่เกิดจากการยืนยันของผู้ใช้ แล้วสะสมใน `community_places`**; ขอบเขต "ในชุมชน" = ตำบล + เช็คชื่อหมู่บ้าน (Google ไม่มีระดับหมู่บ้าน) | → D28, §2.2, 6.5, 6.12 |

---

## 11. สิ่งที่ยังไม่แน่ใจ (ระบุตรง ๆ ไม่ปิดบัง)

1. **D2 ("เทียบด้วย Google id อย่างเดียว") ใช้ได้จริงกับ host ที่ยังไม่ได้เลือกหมุด Google** — D17 ให้เลือกหมุดตอนโพสต์แล้วบันทึกกลับ ซึ่งแก้ได้หลังโพสต์แรก แต่ **ก่อนโพสต์แรก host จะยังไม่มี Google id** → own_business รอบแรกจะเข้าเส้นทาง "เลือกหมุด" เสมอ
2. **การเติม `otop_village_id` ให้ hierarchy** — รอบแรก map เฉพาะหมู่บ้านที่มี host (D13/D24) → ชุมชนที่ยังไม่มี host จะ **ไม่มี `otop_village_id`** → ใช้เป็น key หลักไม่ได้ ระบบจะอ้างอิงด้วย `name`+hierarchy แทน ซึ่งบอกได้แค่ "ชุมชนในระบบ" ไม่ใช่ "หมู่บ้านที่ OTOP ลงทะเบียนแน่นอน"
3. **ชุมชนใน hierarchy ไม่มีระดับตำบลจริง** — `subdistrict` เป็น string รวม (`"ต.สุเทพ, หมู่ 11"`) → ต้อง parse เป็นชื่อตำบล ถ้าชื่อตำบลไม่ unique ในอำเภอ ต้องรวมกับชื่ออำเภอเสมอ
4. **Google Places อาจใช้ไม่ได้เลยตอนนี้ (2.6.2)** — billing ของ GCP project ปิดอยู่ + Places (New) ไม่ได้เปิด → ทั้งแผนอาจได้ข้อมูลว่างโดยไม่มี error ต้อง probe สดก่อน (ขั้น 0.1)
5. **ค่าใช้จ่าย Places API เพิ่ม** — โหมด own_business จะค้น Google ทุกครั้งที่โพสต์ (เพิ่ม ~1 call/โพสต์) ต้องตั้งงบกลาง
6. **backfill + seed ต้องรันด้วยมือ** — ผมรัน migration ให้ไม่ได้ (ต้องใช้สิทธิ์ SQL Editor ของ Supabase) จะเขียนสคริปต์ให้
7. **โค้ดเดิมบางส่วนจะต้องเปลี่ยนพฤติกรรม** — ผู้ใช้ที่คุ้นเคยกับ "own_business ล็อกตำแหน่งแน่นอน" จะเจอการ์ดยืนยันบังคับ (D27)
8. **`communities` เป็น dead schema — การกู้มาใช้ต้อง ALTER 4 จุด** (2.1) และ `services`/`bookings`/`passport_stamps` จะผูกกับมันแบบ `on delete cascade` — ตอนนี้ไม่มีแถว แต่ถ้าวันหนึ่งมี ให้ระวังลบชุมชน
9. **`tripPrompt.ts` มีการแก้ค้างอยู่** — ขั้น 4.2 จำเป็นต้องแตะไฟล์นี้ → ต้องประสานกับผู้ใช้ก่อน ไม่งั้นจะชนกับงานที่ค้างอยู่
10. **การลดสิทธิ์ host เดิมเป็น tourist (D16) เป็นการกระทบผู้ใช้จริง** — ตัวเลขจริงยังไม่รู้ (ขั้น 0.5) ควรดูก่อนว่าจะเป็นกี่คน
11. **หมู่บ้าน OTOP ส่วนใหญ่ไม่มี Google Place** — ถ้า probe (ขั้น 0.7) ยืนยันว่าผลค้นระดับตำบลเป็นแค่ร้าน/โรงแรมทั่วไป ไม่ใช่สถานที่ในหมู่บ้าน → เส้นทาง ③ ("ค้นใหม่ในชุมชน") จะให้ผลที่ไม่ตรงโจทย์ ต้องออกแบบใหม่ (เช่น ให้ host ระบุเอง หรือ seed จากข้อมูลอื่น)
12. **ชั้นที่ 1 (เดาจากชื่อหมู่บ้าน) เชื่อถือได้แค่ไหน** — ชื่อหมู่บ้านไทยซ้ำกันมาก และ Google ไม่ได้เขียนชื่อหมู่บ้านในที่อยู่เสมอ → ต้องวัดจากข้อมูลจริงว่าป้าย "อยู่ในหมู่บ้านนี้" หลอกผู้ใช้บ่อยแค่ไหน
