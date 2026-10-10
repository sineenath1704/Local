import { useState, useEffect, useCallback } from "react";
import { loadFeed, FeedResult } from "../services/feedService";
import { VideoPost, HOME_FEED_POSTS } from "../data/homeFeedData";

/**
 * Loads the video feed from Supabase (with bundled fallback).
 * Renders the fallback instantly, then swaps in the Supabase feed.
 */
export function useFeed() {
  const [posts, setPosts] = useState<VideoPost[]>(HOME_FEED_POSTS);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<FeedResult["source"]>("fallback");

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await loadFeed();
    setPosts(result.posts);
    setSource(result.source);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await loadFeed();
      if (!active) return;
      setPosts(result.posts);
      setSource(result.source);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { posts, loading, source, refetch };
}
