/**
 * ============================================================
 *  VIDEO CONTENT ANALYZER PROMPT  — แก้ได้ที่ไฟล์นี้ไฟล์เดียว
 * ============================================================
 *
 * AI ที่ "สรุปเนื้อหาจากคลิปวิดีโอ" (คนละตัวกับ AI ตอบคำถาม/น้องโลคอล)
 * ทำงานฝั่ง server ตอนเจ้าของอัปโหลดวิดีโอ:
 *   เสียง → Speech-to-Text → transcript (+ audioType)
 *   ภาพ   → Vision         → visualDescription, onScreenText
 *   รวม caption → ส่งเข้า LLM พร้อม prompt นี้ → ได้ข้อมูล structured + สรุป
 *
 * ลำดับแหล่งข้อมูล:
 *   - audioType = speech/mixed : transcript (เฉพาะส่วนพูด) > onScreenText > visual > caption
 *   - audioType = music/none   : caption > onScreenText > visual  (ห้ามใช้ transcript/เนื้อเพลง)
 */

/** ชนิดเสียงในคลิป (ตาม Video Content Analyzer spec) */
export type AudioType = "speech" | "music" | "mixed" | "none";

/** ข้อมูลที่ได้จากขั้น Speech-to-Text + Vision ก่อนส่งเข้า LLM */
export interface VideoAnalysisInput {
  /** แคปชันที่ผู้โพสต์เขียน */
  caption?: string;
  /** ข้อความถอดเสียงจากคลิป (Speech-to-Text) */
  transcript?: string;
  /** ชนิดเสียง: speech | music | mixed | none */
  audioType?: AudioType;
  /** คำอธิบายภาพจาก Vision AI */
  visualDescription?: string;
  /** ตัวหนังสือ/ป้าย/ซับไตเติลในคลิป */
  onScreenText?: string[];
  /** ความยาวคลิป (วินาที) */
  videoDurationSec?: number;
  /** ผู้โพสต์เป็นชุมชนหรือนักท่องเที่ยว */
  uploaderType?: "community" | "tourist";
  /** ข้อมูลประกอบเพิ่มเติม (ถ้ามี) */
  location?: string;
}

/**
 * SYSTEM PROMPT — Video Content Analyzer
 * ✏️ แก้บทบาท/กฎ/ลำดับแหล่งข้อมูล ได้ที่นี่
 */
export const SYSTEM_PROMPT = `คุณคือ AI วิเคราะห์คลิปวิดีโอ ประจำแอป Local
หน้าที่: ดึงและสรุปข้อมูลที่เป็นประโยชน์จากคลิปที่ชุมชนหรือนักท่องเที่ยวอัปโหลด เพื่อแสดงผลในแอปและเพิ่มลงฐานข้อมูลชุมชน

[กฎการเลือกแหล่งข้อมูลตามชนิดเสียง]
- audioType = "speech" หรือ "mixed": ให้น้ำหนัก transcript (เฉพาะส่วนที่เป็นเสียงพูด/บรรยาย) > on_screen_text > visual > caption. ถ้า mixed ให้กรองเนื้อหาที่เป็นเพลงออกทั้งหมด ใช้เฉพาะส่วนพูด
- audioType = "music" หรือ "none": ห้ามใช้ transcript และห้ามนำเนื้อเพลง/ชื่อเพลงมาสรุปเป็นข้อมูลสถานที่โดยเด็ดขาด ให้ยึด caption > on_screen_text > visual แทน

[กฎห้าม — Hard Rules]
1. ห้ามแต่งข้อมูลที่ไม่มีในคลิป — ถ้าไม่พบข้อมูล ให้ใส่ null (อย่าเดา)
2. ห้ามนำเนื้อเพลงมาแปลเป็นข้อมูลสถานที่ (เช่น เนื้อเพลงพูดถึงธรรมชาติ ≠ ชื่อสถานที่)
3. ห้ามสรุปเกินจริง — ถ้าคลิปแสดงแค่อาหาร อย่าสรุปว่ามีโฮมสเตย์
4. ห้ามระบุราคาถ้าไม่ปรากฏในคลิปหรือแคปชัน
5. ห้ามระบุเบอร์โทรถ้าไม่ปรากฏชัดในคลิป/แคปชัน

[คำบรรยายสรุป]
- เขียนภาษาไทย 2–4 ประโยค อ่านง่าย ดึงใจให้อยากไปเยือน (ไม่ใช่รายงานแห้งๆ)
- รูปแบบ: [ชื่อสถานที่] ใน [ที่ตั้ง] — [จุดเด่น 1–2 ประโยค] + กิจกรรม/ประสบการณ์ + ราคาเริ่มต้น (ถ้ามี)
- อย่าเอ่ยถึงกระบวนการเทคนิค (เช่น "จาก transcript") ในตัวสรุป

ตอบกลับเป็น JSON ที่ถูกต้องตามรูปแบบที่กำหนดเท่านั้น ห้ามมีข้อความอื่นนอก JSON`;

/**
 * สร้าง USER PROMPT จากผลวิเคราะห์ภาพ+เสียง+caption
 * ✏️ แก้โครงสร้าง/คำสั่ง output ได้ตรงนี้
 */
export function buildSummaryPrompt(input: VideoAnalysisInput): string {
  const audioType: AudioType =
    input.audioType ?? (input.transcript?.trim() ? "speech" : "none");
  const usesTranscript = audioType === "speech" || audioType === "mixed";

  const caption = input.caption?.trim() || "(ไม่มีแคปชัน)";

  const transcriptBlock = usesTranscript
    ? input.transcript?.trim() || "(ไม่มีข้อความถอดเสียง)"
    : "(เป็นเสียงเพลง/ไม่มีเสียงพูด — ห้ามใช้ ให้ยึด caption + ตัวหนังสือในคลิปแทน)";

  const onScreenText = input.onScreenText?.length
    ? input.onScreenText.map((t) => `"${t}"`).join(", ")
    : "(ไม่มีตัวหนังสือในคลิป)";

  const visual = input.visualDescription?.trim() || "(ไม่มีคำอธิบายภาพ)";

  const extras = [
    input.videoDurationSec ? `ความยาวคลิป: ${input.videoDurationSec} วินาที` : "",
    input.uploaderType ? `ผู้โพสต์: ${input.uploaderType}` : "",
    input.location?.trim() ? `ข้อมูลสถานที่ประกอบ: ${input.location.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `โปรดวิเคราะห์คลิปวิดีโอจากข้อมูลต่อไปนี้ (audioType = "${audioType}")

[caption] แคปชันของผู้โพสต์:
${caption}

[audio_transcript] ข้อความถอดเสียง:
${transcriptBlock}

[on_screen_text] ตัวหนังสือ/ป้าย/ซับไตเติลในคลิป:
${onScreenText}

[visual_description] คำอธิบายภาพจาก Vision:
${visual}
${extras ? `\n[meta]\n${extras}` : ""}

ตอบกลับเป็น JSON รูปแบบนี้เท่านั้น (ใส่ null เมื่อไม่พบข้อมูล ห้ามเดา):
{
  "place_name": "ชื่อสถานที่/ชุมชน หรือ null",
  "location": { "province": null, "district": null, "subdistrict": null, "gps": null },
  "category": ["โฮมสเตย์ | ร้านอาหาร | คาเฟ่ | Workshop | วัด | ธรรมชาติ | ..."],
  "activities": ["กิจกรรมที่พบ"],
  "price_info": { "weekday": null, "weekend": null, "currency": "THB" },
  "contact": { "phone": null, "facebook": null, "line": null },
  "opening_hours": null,
  "otop_products": ["สินค้า OTOP ที่พบ"],
  "highlights": ["จุดเด่น 1", "จุดเด่น 2"],
  "tags": ["#แท็ก"],
  "summary": "คำบรรยายสรุป 2–4 ประโยค อ่านสนุก เห็นภาพ",
  "confidence": {
    "overall_confidence": 0.0,
    "source_used": ["caption | audio_transcript | on_screen_text | visual"],
    "missing_info": ["ข้อมูลที่ยังขาด"],
    "warning": "ข้อควรระวัง หรือ null"
  }
}`;
}

// ============================================================
//  CAPTION HELPER — "ให้ AI ช่วยคิดแคปชัน" ตอนโพสต์
// ============================================================

/** ข้อมูลสำหรับให้ AI ช่วยคิดแคปชัน (ดึงจาก AI summary + สถานที่) */
export interface CaptionInput {
  /** ร่างแคปชันที่ผู้ใช้พิมพ์มาบ้างแล้ว (ถ้ามี) */
  draft?: string;
  locationName?: string;
  province?: string;
  district?: string;
  hashtags?: string[];
  /** สรุปจาก AI ของคลิป (แหล่งหลักในการคิดแคปชัน) */
  summaryText?: string;
  highlights?: string[];
  uploaderType?: "community" | "tourist";
}

export const CAPTION_SYSTEM_PROMPT = `คุณคือผู้ช่วยคิดแคปชันของแอป Local แพลตฟอร์มท่องเที่ยวชุมชน OTOP ไทย
หน้าที่: เขียนแคปชันสั้นๆ ให้คลิปวิดีโอที่กำลังจะโพสต์ ให้คนอยากดูและอยากไปเที่ยวตาม

กติกา:
- เขียนเป็นภาษาไทยที่เป็นธรรมชาติ อบอุ่น มีชีวิตชีวา เหมือนเจ้าของคลิปเล่าเอง
- ความยาว 1–2 ประโยค กระชับ ใส่ emoji ได้ 1–2 ตัว
- อิงจากสรุป AI และสถานที่ที่ให้มา ห้ามแต่งข้อมูลที่ไม่มี (ราคา/เบอร์)
- เสนอ 3 ตัวเลือกที่โทนต่างกัน (สนุก / อบอุ่น / กระชับ)
- ตอบกลับเป็น JSON เท่านั้น: { "captions": ["...", "...", "..."] }`;

export function buildCaptionPrompt(input: CaptionInput): string {
  const place = [input.locationName, input.district, input.province].filter(Boolean).join(" ");
  return `โปรดคิดแคปชัน 3 แบบสำหรับคลิปนี้

สถานที่: ${place || "(ไม่ระบุ)"}
สรุปเนื้อหาคลิป (จาก AI): ${input.summaryText?.trim() || "(ไม่มี)"}
จุดเด่น: ${input.highlights?.length ? input.highlights.join(", ") : "(ไม่มี)"}
แฮชแท็กที่ผู้ใช้ใส่: ${input.hashtags?.length ? input.hashtags.join(" ") : "(ไม่มี)"}
ร่างแคปชันเดิม: ${input.draft?.trim() || "(ไม่มี)"}

ตอบกลับเป็น JSON เท่านั้น:
{ "captions": ["แคปชันแบบที่ 1", "แคปชันแบบที่ 2", "แคปชันแบบที่ 3"] }`;
}
