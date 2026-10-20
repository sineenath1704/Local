import { Request, Response, NextFunction } from "express";
import { AiUpstreamError, classifyError, describeError } from "../aiErrors";
import { requestId } from "./requestContext";

/**
 * One error shape for the whole backend.
 * -------------------------------------------------------------
 * Every failure the app can hit now comes back as:
 *   { error: <human Thai reason>, code, requestId, upstream?: { status, body } }
 *
 * The app reads `error` for the toast and `code`/`upstream` for the
 * diagnostics screen, so "why did the AI fail" is never a guess.
 */
export interface ErrorBody {
  error: string;
  code: string;
  requestId?: string;
  upstream?: { status: number; body: string };
}

/** Build the response body for an arbitrary thrown value. */
export function errorBody(err: any, req?: Request): ErrorBody {
  const body: ErrorBody = {
    error: describeError(err),
    code: classifyError(err),
  };
  const id = req ? requestId(req) : undefined;
  if (id) body.requestId = id;
  if (err instanceof AiUpstreamError) {
    body.upstream = { status: err.upstreamStatus, body: err.upstreamBody };
  }
  return body;
}

/**
 * Helper for route handlers: turn a caught error into a 502 with a real reason.
 * Replaces the old `res.status(502).json({ error: err.message || "…ตายตัว" })`.
 */
export function sendError(res: Response, err: any, req: Request, status = 502): void {
  const body = errorBody(err, req);
  if (body.upstream) {
    console.error(
      `[req ${body.requestId ?? "?"}] upstream ${body.upstream.status}: ${body.upstream.body.slice(0, 300)}`
    );
  } else {
    console.error(`[req ${body.requestId ?? "?"}] ${body.code}: ${body.error}`);
  }
  res.status(status).json(body);
}

/** 404 for any path that fell through the routers (was: Express HTML page). */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `ไม่พบเส้นทาง ${req.method} ${req.originalUrl}`,
    code: "NOT_FOUND",
    requestId: requestId(req),
  } satisfies ErrorBody);
}

/** Global handler for anything thrown outside a route's own try/catch. */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) return;
  console.error(`[req ${requestId(req) ?? "?"}] unhandled:`, err);
  res.status(500).json(errorBody(err, req));
}