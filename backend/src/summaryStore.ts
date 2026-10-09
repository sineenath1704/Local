import { AiSummaryResult } from "./aiClient";

/**
 * In-memory summary store (demo).
 * -------------------------------------------------------------
 * In production, replace this with a real database (Postgres, Mongo, etc.).
 * The important architectural point: summaries are computed ONCE at upload
 * time and stored here, so the mobile app reads them instantly on demand.
 */
const store = new Map<string, AiSummaryResult>();

export function saveSummary(postId: string, summary: AiSummaryResult): void {
  store.set(postId, summary);
}

export function getSummary(postId: string): AiSummaryResult | undefined {
  return store.get(postId);
}

export function hasSummary(postId: string): boolean {
  return store.has(postId);
}
