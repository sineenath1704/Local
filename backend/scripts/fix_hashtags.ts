/**
 * Repair hashtags that lost their Thai vowels and tone marks.
 * -------------------------------------------------------------
 * The caption helper used to strip every character outside `\p{L}` and
 * `\p{N}`, so "ที่พักริมนา" became "ทพกรมนา" before it ever reached the
 * app. Users who tapped such a suggestion saved the broken value into
 * `videos.hashtags`, and it shows under the video in the feed forever.
 *
 * The marks are gone — they cannot be reconstructed by guessing. But the
 * same clip usually still has an INTACT copy of the same words:
 *   · `videos.ai_summary` → `place.tags` / `place.place_name` / `place.community`
 *   · `video_ai_analyses` → `tags` / `place_name` / `community`
 * (none of those go through the hashtag normalizer, so their marks are intact)
 *
 * This script compares the stored hashtag with those intact words by
 * running BOTH sides through the OLD normalizer (the one that caused the
 * damage). That is the exact inverse of the bug, so a candidate matches
 * only when it could really have produced the stored value.
 *
 * When exactly one intact word matches, the stored value is restored to
 * it. When nothing matches — or two different words match — the row is
 * reported for a human to fix. The script never guesses.
 *
 *   cd backend
 *   npm run fix:hashtags              # dry run — prints what would change
 *   npm run fix:hashtags -- --apply   # writes to the database
 *
 * Uses the service-role key (server side only) — never expose it to the app.
 */

import * as fs from "fs";
import { getSupabaseAdmin } from "../src/supabaseAdmin";
import { normalizeHashtag } from "../src/hashtagText";

/**
 * ตัวแปลงแฮชแท็กเดิม (ก่อนแก้บั๊ก) — ต้องเหมือนของเดิมทุกตัวอักษร
 *
 * ใช้เป็น "กุญแจ" ของการเทียบ: ค่าที่เก็บอยู่ในฐานข้อมูลคือผลลัพธ์ของ
 * ตัวนี้ ถ้าเอาต้นฉบับมาผ่านตัวนี้ด้วยแล้วได้ค่าเดียวกัน แปลว่า
 * ต้นฉบับนั้น "อาจ" เป็นคำเดิมได้ — แต่ยังต้องไม่ชัดเจนจนกว่าจะ
 * เจอต้นฉบับที่ตรงกันพอดีหนึ่งค่า
 */
export function legacyNormalizeHashtag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 40);
}

/** พยัญชนะไทย (เอกภาพ U+0E01–U+0E2E) — ใช้บอกว่าคำนี้เป็นภาษาไทย */
const THAI_CONSONANT = /[ก-ฮ]/;
/** สระ/วรรณยุกต์ — ถ้ามีอยู่แล้วแปลว่าคำนี้ไม่ได้ถูกทำลาย */
const HAS_MARK = /\p{M}/u;

/**
 * คำนี้ดูเป็นไทย แต่ไม่มีสระเลย → น่าสงสัยว่าเคยถูกตัดสระทิ้ง
 *
 * ใช้เป็น "จอแสดงผล" เท่านั้น ไม่ใช่เงื่อนไขในการเขียน
 * (คำไทยที่ถูกต้องหลายคำไม่มีสระ เช่น ไทย ปาย ชา กาแฟ → จะติดรายการ
 * "ต้องให้คนตรวจ" ซึ่งเป็นแค่รายการ ไม่ได้ถูกแก้อัตโนมัติ)
 */
export function looksStripped(tag: string): boolean {
  const t = tag.replace(/^#+/, "");
  if (!THAI_CONSONANT.test(t)) return false;
  if (Array.from(t).length < 2) return false;
  return !HAS_MARK.test(t);
}

/** เก็บเฉพาะค่าที่เป็นข้อความ */
export function strings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

export interface VideoRow {
  id: string;
  hashtags: unknown;
  ai_summary: unknown;
}

/**
 * ต้นฉบับที่สระครบของโพสต์นั้น — จากทั้ง summary และตาราง analyses
 *
 * ค่าพวกนี้ไม่เคยผ่านตัวแปลงแฮชแท็ก สระจึงยังอยู่ครบ
 * (แต่อาจมี "#" นำหน้าติดมาจากโมเดล — จัดการตอนเทียบ)
 */
export function candidatesFor(
  video: VideoRow,
  analysesTags: string[],
  analysesPlace: string[]
): string[] {
  const summary = (video.ai_summary ?? {}) as Record<string, any>;
  const place = (summary.place ?? {}) as Record<string, any>;
  const out: string[] = [
    ...strings(place.tags),
    ...strings(summary.tags),
    ...strings(analysesTags),
  ];
  for (const v of [place.place_name, place.community, ...analysesPlace]) {
    if (typeof v === "string" && v.trim() !== "") out.push(v);
  }
  return out;
}

/** ผลลัพธ์ของการวางแผนกู้แฮชแท็กของโพสต์หนึ่งแถว */
export interface HashtagFixPlan {
  /** ค่าใหม่ที่จะบันทึกกลับ (มี "#" นำหน้าเหมือนของเดิม) */
  next: string[];
  /** คู่ที่กู้ได้: เดิม → ใหม่ */
  fixes: { from: string; to: string }[];
  /** ค่าที่น่าสงสัยว่าเสีย แต่กู้ไม่ได้ — ต้องให้คนแก้เอง */
  needsReview: string[];
  /** มีอะไรเปลี่ยนไหม */
  changed: boolean;
}

/**
 * วางแผนการกู้แฮชแท็กของโพสต์หนึ่งแถว (ไม่แตะฐานข้อมูล — ทดสอบได้)
 *
 * กู้ได้ก็ต่อเมื่อเจอ "ต้นฉบับ" ที่ผ่านตัวแปลงเดิมแล้วได้ค่าเดียวกับ
 * ค่าที่เก็บอยู่ และเจอพอดีหนึ่งค่า (ถ้ามีสองค่าต่างกันที่ตรงกัน
 * → กำกวม → ไม่กู้ ปล่อยไว้ให้คนตรวจ)
 */
export function planHashtagFix(
  video: VideoRow,
  analysesTags: string[] = [],
  analysesPlace: string[] = []
): HashtagFixPlan {
  const stored = strings(video.hashtags);
  const plan: HashtagFixPlan = { next: [], fixes: [], needsReview: [], changed: false };
  if (!stored.length) return plan;

  const candidates = candidatesFor(video, analysesTags, analysesPlace);

  // กุญแจ → ชุดของ "รูปแบบที่กู้คืนได้" (ตัดซ้ำออก)
  //
  // เก็บเฉพาะต้นฉบับที่ "มีสระอยู่จริง" เท่านั้น — ต้นฉบับที่ไม่มีสระ
  // กู้อะไรไม่ได้อยู่แล้ว ถ้าเอามารวมด้วยจะทำให้เกิด "กำกวม" ปลอม ๆ
  // (เช่นต้นฉบับหนึ่งมีสระ อีกต้นฉบับหนึ่งไม่มี ทั้งคู่ชนพยัญชนะเดียวกัน)
  const byKey = new Map<string, Set<string>>();
  for (const c of candidates) {
    if (!HAS_MARK.test(c)) continue;
    const k = legacyNormalizeHashtag(c);
    if (!k) continue;
    const restored = normalizeHashtag(c);
    if (!restored) continue;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k)!.add(restored);
  }

  for (const tag of stored) {
    const bareTag = tag.replace(/^#+/, "");

    // ค่าที่ยังมีสระ/วรรณยุกต์อยู่ ไม่ได้ถูกตัวแปลงเดิมทำลาย
    // (ตัวเดิมตัดมาร์กออก "หมด" ไม่ใช่บางตัว) → ไม่แตะ เพื่อไม่ไปทับ
    // แฮชแท็กที่ผู้ใช้พิมพ์เองและยังถูกต้อง
    if (HAS_MARK.test(bareTag)) {
      plan.next.push(tag);
      continue;
    }

    const matches = byKey.get(legacyNormalizeHashtag(bareTag));

    // ต้นฉบับที่ชัดเจนพอดีหนึ่งค่า และ "ต่างจากค่าที่เก็บอยู่จริง"
    if (matches && matches.size === 1) {
      const restored = [...matches][0];
      if (restored !== bareTag) {
        // เก็บรูปแบบเดียวกับของเดิม — ค่าในฐานข้อมูลมี "#" นำหน้าเสมอ
        const nextTag = tag.startsWith("#") ? `#${restored}` : restored;
        plan.next.push(nextTag);
        plan.fixes.push({ from: tag, to: nextTag });
        plan.changed = true;
        continue;
      }
    }
    plan.next.push(tag);
    if (looksStripped(tag)) plan.needsReview.push(tag);
  }

  return plan;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error(
      "ยังตั้งค่า Supabase ไม่ได้ (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — ทำต่อไม่ได้"
    );
    process.exitCode = 1;
    return;
  }

  console.log("=== กู้แฮชแท็กที่สระหาย ===");
  console.log(apply ? "โหมด: เขียนจริง (--apply)\n" : "โหมด: dry-run (ยังไม่เขียนอะไร)\n");

  // 1) โพสต์ที่มีแฮชแท็ก
  const videos: VideoRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("videos")
      .select("id, hashtags, ai_summary")
      .not("hashtags", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`อ่าน videos ไม่สำเร็จ: ${error.message}`);
    videos.push(...((data ?? []) as VideoRow[]));
    if (!data || data.length < pageSize) break;
  }

  // 2) แท็กจากตาราง analyses (ชุดสำรอง) — อ่านครั้งเดียว แล้วจับคู่ในโค้ด
  const { data: analyses, error: analysesError } = await supabase
    .from("video_ai_analyses")
    .select("post_id, tags, place_name, community");
  if (analysesError) {
    throw new Error(`อ่าน video_ai_analyses ไม่สำเร็จ: ${analysesError.message}`);
  }
  const analysesByPost = new Map<string, { tags: string[]; place: string[] }>();
  for (const row of (analyses ?? []) as any[]) {
    analysesByPost.set(row.post_id, {
      tags: strings(row.tags),
      place: [row.place_name, row.community].filter(
        (v: unknown): v is string => typeof v === "string"
      ),
    });
  }

  console.log(`โพสต์ที่มีแฮชแท็ก: ${videos.length} แถว\n`);

  let fixedRows = 0;
  let fixedTags = 0;
  const needsReview: { id: string; tag: string }[] = [];
  const backup: { id: string; before: string[] }[] = [];

  for (const video of videos) {
    const analysis = analysesByPost.get(video.id);
    const plan = planHashtagFix(video, analysis?.tags ?? [], analysis?.place ?? []);

    for (const f of plan.fixes) {
      fixedTags++;
      console.log(`  ✓ ${f.from} → ${f.to}`);
    }
    for (const tag of plan.needsReview) needsReview.push({ id: video.id, tag });

    if (!plan.changed) continue;
    fixedRows++;
    backup.push({ id: video.id, before: strings(video.hashtags) });
    if (!apply) continue;

    const { error } = await supabase
      .from("videos")
      .update({ hashtags: plan.next })
      .eq("id", video.id);
    if (error) {
      console.error(`  ✗ แก้แถว ${video.id} ไม่สำเร็จ: ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`\nแก้ได้ ${fixedTags} แฮชแท็ก ใน ${fixedRows} แถว`);

  // เขียนไฟล์สำรองค่าเดิมไว้ก่อนเสมอ (ย้อนกลับได้ถ้ามีปัญหา)
  if (backup.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `hashtags.backup.${stamp}.json`;
    // ไฟล์นี้ชื่อ *.backup.* → .gitignore ของโปรเจกต์กรองไว้แล้ว
    fs.writeFileSync(path, JSON.stringify(backup, null, 2));
    console.log(`สำรองค่าเดิมไว้ที่ ${path}`);
  }

  if (!apply) {
    console.log("(dry-run — ส่ง --apply เพื่อเขียนจริง)");
  }

  if (needsReview.length) {
    console.log(`\nต้องให้คนแก้เอง ${needsReview.length} ค่า (กู้จากต้นฉบับไม่ได้):`);
    for (const r of needsReview) console.log(`  · ${r.tag}   (post ${r.id})`);
  }
}

// รันเฉพาะเมื่อสั่งตรง ๆ — การ import ไฟล์นี้ (เช่นในเครื่องมือตรวจ)
// ต้องไม่ไปแตะฐานข้อมูล
if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
