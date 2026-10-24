-- ─────────────────────────────────────────────────────────────
-- Lock down public.video_ai_analyses
-- ─────────────────────────────────────────────────────────────
-- The table was readable by anyone (policy "Anyone can read
-- video_ai_analyses"). It holds raw_analysis — the full AI output for a
-- clip, including the raw transcript the uploader spoke, plus the contact
-- details Google Places returned for the place.
--
-- Nothing in the app reads this table (the app only writes it on upload;
-- the feed reads `videos.ai_summary`, which keeps its own policies). So we
-- can drop the blanket read and let only the post's owner read their own
-- analysis.
--
-- Existing policy to remove:
--   "Anyone can read video_ai_analyses"  (for select, using (true))

drop policy if exists "Anyone can read video_ai_analyses"
  on public.video_ai_analyses;

-- Owners can read the analysis of their own posts.
create policy "Owners can read their video_ai_analyses"
  on public.video_ai_analyses for select
  using (
    exists (
      select 1 from public.videos
      where public.videos.id = video_ai_analyses.post_id
        and public.videos.user_id = auth.uid()
    )
  );
