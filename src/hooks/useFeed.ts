import { useState, useEffect, useCallback } from "react";
import { loadFeed, FeedResult } from "../services/feedService";
import { VideoPost } from "../data/homeFeedData";

/**
 * Loads the video feed from Supabase ONLY (no mock/fallback).
 * Starts empty + loading; the UI shows an empty/error state when there are
 * no real posts.
 */
export function useFeed() {
  const [posts, setPosts] = useState<VideoPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<FeedResult["status"]>("ok");

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await loadFeed();
    setPosts(result.posts);
    setStatus(result.status);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadFeed();
      if (!active) return;
      setPosts(result.posts);
      setStatus(result.status);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { posts, loading, status, refetch };
}
