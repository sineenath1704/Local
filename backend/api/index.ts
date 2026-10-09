import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../src/app";

/**
 * Vercel serverless entry. The Express app is created once per cold start
 * and reused across invocations. vercel.json routes every path here.
 */
const app = createApp();

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Express apps are valid (req, res) handlers.
  return (app as any)(req, res);
}
