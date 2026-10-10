-- ============================================================
--  Migration — AI summary accuracy feedback on videos
--  Run in Supabase SQL Editor (safe to run multiple times).
-- ------------------------------------------------------------
--  Lets the uploader rate how accurate the AI's auto-summary was
--  (1 = ไม่ตรงเลย … 5 = ตรงมาก). Collected at upload time so we can
--  measure + improve the summary model later.
-- ============================================================

alter table public.videos
  add column if not exists ai_summary_accuracy int
    check (ai_summary_accuracy is null or (ai_summary_accuracy >= 1 and ai_summary_accuracy <= 5));

comment on column public.videos.ai_summary_accuracy is
  'Uploader rating (1-5) of how accurate the AI auto-summary was. NULL = not rated. Used for model evaluation.';
