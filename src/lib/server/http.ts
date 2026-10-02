import { z } from "zod";
import { AppError } from "./errors";
import { errorCategory, errorSummary, recordOperation } from "@/lib/server/observability";

const MAX_JSON_BYTES = 64 * 1024;
const NO_STORE = { "cache-control": "private, no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Reads and validates a JSON body. Oversized or malformed bodies are invalid_input. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S, maxBytes = MAX_JSON_BYTES): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("invalid_input", "Request body is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError("invalid_input", "Request body is too large.");
  let raw: unknown;
  try {
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new AppError("invalid_input", "Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError("invalid_input", "Request body is invalid.");
  return parsed.data;
}

const RECORDED: ReadonlySet<string> = new Set(["unauthenticated", "forbidden", "rate_limited", "unavailable"]);

/**
 * Phase 13: aggregate, PII-free record of a refused request — auth failures, entitlement/role denials, quota and
 * rate limits, unavailable features. Only the constant route label and the denial category are kept (no ids, no
 * user, no input). Validation errors, not-found and conflicts are not recorded (noise, and not security signals).
 */
export function recordDenial(e: unknown, route: string): void {
  if (!(e instanceof AppError) || !RECORDED.has(e.code)) return;
  recordOperation({ operation: "request.refused", outcome: e.code === "unavailable" ? "unavailable" : "denied", errorCategory: errorCategory(e), target: route });
}

/** Converts thrown errors into safe JSON responses. Unexpected errors are logged with a request id, never echoed. */
export function toErrorResponse(e: unknown, route: string): Response {
  recordDenial(e, route);
  if (e instanceof AppError) return json({ error: { code: e.code, message: e.message } }, e.status);
  if (e instanceof z.ZodError) {
    // A row from the database failed to decode: a server-side data problem, not the caller's.
    const requestId = crypto.randomUUID();
    console.error(`[orqo] ${route} decode failure`, requestId, e.issues.map((i) => i.path.join(".")).join(", "));
    return json({ error: { code: "internal", message: "Unexpected server error.", requestId } }, 500);
  }
  const requestId = crypto.randomUUID();
  console.error(`[orqo] ${route} failed`, requestId, errorSummary(e));
  return json({ error: { code: "internal", message: "Unexpected server error.", requestId } }, 500);
}

/** Same policy for the legacy demo routes, whose clients expect `{ error: string }`. */
export async function toLegacyErrorResponse(e: unknown, route: string): Promise<Response> {
  const res = toErrorResponse(e, route);
  const body = (await res.json()) as { error: { message: string } };
  return json({ error: body.error.message }, res.status);
}

/**
 * CSRF guard for cookie-authenticated state-changing JSON routes: requires a
 * JSON content type (HTML forms cannot send one cross-site without a CORS
 * preflight) and, when the browser sends an Origin, that it is this host.
 */
export function assertSameOriginJson(request: Request): void {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) throw new AppError("invalid_input", "Expected application/json.");
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("forbidden", "Cross-site request refused.");
  }
  if (originHost !== host) throw new AppError("forbidden", "Cross-site request refused.");
}
