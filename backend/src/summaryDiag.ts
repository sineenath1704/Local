/**
 * DIAGNOSTIC TRAIL — บันทึกว่าแต่ละขั้นตอนของ AI summary "เกิดอะไรขึ้นบ้าง"
 * =============================================================
 * ปัญหาที่ทำให้ debug ไม่ได้: หลายขั้นตอนเขียนแบบ "กลืน error เงียบ ๆ"
 * (proofread, Google Places, คำบรรยายสำรอง) พอข้อมูลไม่ครบ
 * ก็ไม่มีใครบอกได้ว่าหายตรงไหน — ผู้ใช้เห็นแค่สรุปที่ว่างเปล่า
 *
 * คราวนี้ทุกขั้นตอนรายงานผลของตัวเองกลับไปพร้อม summary
 *   → ผู้ใช้เห็นบนเครื่องตอนอัปคลิป (การ์ด "รายงานการวิเคราะห์")
 *   → และถูกบันทึกไปกับโพสต์ใน `videos.ai_summary`
 *
 * กฎเหล็กของไฟล์นี้
 *   · ห้ามใส่เนื้อหาของผู้ใช้ (ถอดเสียง ข้อความบนจอ คำตอบดิบของโมเดล)
 *     — เก็บแค่ "ความยาว" เป็นตัวเลข และคำอธิบายที่เราเขียนเอง
 *   · ห้ามใส่ body ของปลายทาง (อาจมีข้อมูลของผู้ใช้ปนอยู่) — เก็บแค่รหัสสถานะ
 *   · ทุกอย่างที่บันทึกต้องอ่านรู้เรื่องได้โดยไม่ต้องเปิดโค้ด
 */

import { describeError } from "./aiErrors";

/** ผลของหนึ่งขั้นตอน */
export type DiagStatus = "ok" | "failed" | "skipped";

export interface DiagStep {
  /** รหัสขั้นตอน (คงที่ ใช้เทียบได้) */
  id: string;
  /** ชื่อที่แสดงในแอป */
  label: string;
  status: DiagStatus;
  /** ใช้เวลากี่มิลลิวินาที */
  ms: number;
  /** อธิบายสั้น ๆ ว่าเกิดอะไรขึ้น */
  detail: string;
  /** ตัวเลข/ค่าคงที่ล้วน ๆ — ใช้นับเชิงวิเคราะห์ */
  data?: Record<string, number | string | boolean | null>;
}

export interface SummaryDiag {
  startedAt: string;
  totalMs: number;
  /**
   * ok      = ทุกขั้นตอนผ่าน
   * partial = สรุดได้ แต่มีข้อมูลบางส่วนขาด
   * failed  = สรุปไม่ได้เลย
   */
  verdict: "ok" | "partial" | "failed";
  /** ปัญหาที่ทำให้ข้อมูลไม่ครบ — เรียงตามลำดับที่เจอ */
  problems: string[];
  steps: DiagStep[];
}

/** ตัดข้อความให้สั้น และกันข้อมูลลับหลุด (โทเคน/คีย์ยาว ๆ) */
export function safeDetail(text: unknown, max = 160): string {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  // อะไรที่ยาวมากและไม่มีช่องว่าง หน้าตาเหมือนคีย์ลับ → ตัดทิ้ง
  s = s.replace(/[A-Za-z0-9_\-]{32,}/g, "[ซ่อน]");
  return s.slice(0, max);
}

/** ข้อความของ error ที่ปลอดภัยพอจะเก็บลงรายงาน */
export function errorDetail(err: any): string {
  if (!err) return "ไม่ทราบสาเหตุ";
  // error จากปลายทาง AI มี body ติดมาด้วย — ใช้คำอธิบายภาษาไทยแทน
  if (err.name === "AiUpstreamError" || typeof err.upstreamStatus === "number") {
    return safeDetail(describeError(err));
  }
  return safeDetail(err.message ?? String(err));
}

/** ตัวช่วยบันทึกรายงานของหนึ่งรอบการสรุป */
export class DiagLog {
  private readonly startedAt = new Date().toISOString();
  private readonly t0 = Date.now();
  private readonly steps: DiagStep[] = [];
  private readonly problems: string[] = [];
  private failed = false;

  /** บันทึกผลของขั้นตอนหนึ่ง */
  add(step: DiagStep): void {
    this.steps.push(step);
    if (step.status === "failed") this.failed = true;
  }

  /** ขั้นตอนที่ไม่ได้ทำ (เช่น proofread ถูกข้ามเพราะขั้นก่อนหน้าพัง) */
  skip(id: string, label: string, reason: string): void {
    this.add({ id, label, status: "skipped", ms: 0, detail: safeDetail(reason) });
  }

  /** เพิ่มปัญหาที่ทำให้ข้อมูลไม่ครบ — แอปจะแสดงเป็นหัวข้อสีแดง */
  problem(message: string): void {
    const m = safeDetail(message, 240);
    if (m && !this.problems.includes(m)) this.problems.push(m);
  }

  /**
   * รันหนึ่งขั้นตอนแล้วบันทึกผลให้เอง (จับเวลา + จับ error + โยนต่อ)
   * `report` ใช้บอกรายละเอียดของขั้นตอนนั้น
   */
  async run<T>(
    id: string,
    label: string,
    fn: (report: (detail: string, data?: DiagStep["data"]) => void) => Promise<T>
  ): Promise<T> {
    const t = Date.now();
    let detail = "";
    let data: DiagStep["data"];
    try {
      const out = await fn((d, dd) => {
        detail = d;
        data = dd;
      });
      this.add({ id, label, status: "ok", ms: Date.now() - t, detail: safeDetail(detail), data });
      return out;
    } catch (err: any) {
      const msg = errorDetail(err);
      this.add({ id, label, status: "failed", ms: Date.now() - t, detail: msg, data });
      this.problem(`${label} ล้มเหลว: ${msg}`);
      throw err;
    }
  }

  /** สรุปเป็นรายงานที่ส่งกลับแอป */
  finish(): SummaryDiag {
    const totalMs = Date.now() - this.t0;
    let verdict: SummaryDiag["verdict"] = "ok";
    if (this.failed) verdict = "failed";
    else if (this.problems.length > 0) verdict = "partial";
    return {
      startedAt: this.startedAt,
      totalMs,
      verdict,
      problems: [...this.problems],
      steps: this.steps,
    };
  }
}
