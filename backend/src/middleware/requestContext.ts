import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Assigns a short id to every request and logs one line when it finishes.
 * -------------------------------------------------------------
 * The id is echoed back in the `x-request-id` response header, so the app's
 * diagnostics screen can show exactly which backend log line belongs to which
 * failed AI call (`grep 3f9a1c` in the backend terminal).
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/** 8 hex chars is plenty to correlate, and short enough to read in a log line. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID().slice(0, 8);
  req.id = id;
  res.setHeader("x-request-id", id);

  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    const line = `[req ${id}] ${req.method} ${req.originalUrl} → ${res.statusCode}  ${ms}ms`;
    // 5xx is worth a louder channel so it stands out when scrolling the log.
    if (res.statusCode >= 500) {
      console.error(line);
    } else {
      console.log(line);
    }
  });

  next();
}

export function requestId(req: Request): string | undefined {
  return req.id;
}