/**
 * Operational observability (Phase 12): a provider-agnostic boundary for SAFE
 * metadata about server operations — provider calls, graph rebuilds, failures.
 *
 * Events carry a closed set of fields (operation, outcome, duration, provider,
 * model, sanitized error category, retries, ids, usage). Free text never
 * passes through unredacted: secrets, tokens, emails, phone numbers and URL
 * query strings are masked, and strings are length-capped. Business content
 * (notes, contact data, page text, prompts) is never an event field.
 *
 * The default sink writes one structured line to the server log. A tracing
 * backend (e.g. Langfuse, OpenTelemetry) can replace the sink in Phase 13;
 * none is integrated or required now. Recording never throws.
 */

export const OPERATION_OUTCOMES = ["succeeded", "failed", "denied", "unavailable"] as const;
export type OperationOutcome = (typeof OPERATION_OUTCOMES)[number];

export interface OperationEvent {
  /** e.g. "provider.call", "graph.rebuild". */
  operation: string;
  outcome: OperationOutcome;
  durationMs?: number;
  organizationId?: string | null;
  provider?: string;
  model?: string;
  /** Sanitized category (e.g. "timeout", "http_429", "config") — never a raw message. */
  errorCategory?: string;
  retries?: number;
  runId?: string | null;
  agentId?: string;
  toolId?: string;
  /** A sanitized subject such as a CSP directive's blocked origin or an API route label. Never free text. */
  target?: string;
  units?: number;
  costUsd?: number | null;
}

const STRING_FIELDS = ["operation", "provider", "model", "errorCategory", "agentId", "toolId", "target"] as const;
/** Identifier fields: kept only when they look like an identifier, never redacted text. */
const ID_FIELDS = ["organizationId", "runId"] as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NUMBER_FIELDS = ["durationMs", "retries", "units", "costUsd"] as const;
const MAX_FIELD = 120;

const REDACTIONS: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[supabase-key]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[api-key]"],
  [/\b(api[_-]?key|token|secret|password|passwd|authorization)(\s*[=:]\s*)("?)[^\s"&,;]+/gi, "$1$2$3[redacted]"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/gi, "[scheme]://[credentials]@"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\+\d[\d\s().-]{6,}\d/g, "[phone]"],
  [/\b0\d(?:[\s.-]?\d{2}){4}\b/g, "[phone]"],
  [/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[query]"],
];

/** Masks secrets and personal identifiers in free text, and caps its length. */
export function redact(text: string, max = 300): string {
  let out = text;
  for (const [re, by] of REDACTIONS) out = out.replace(re, by);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** A log-safe one-line summary of an unknown error: its name and a redacted, capped message. */
export function errorSummary(e: unknown, max = 200): string {
  if (e instanceof Error) return `${e.name}: ${redact(e.message, max)}`;
  return typeof e;
}

function clean(e: OperationEvent): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = { outcome: (OPERATION_OUTCOMES as readonly string[]).includes(e.outcome) ? e.outcome : "failed" };
  for (const k of STRING_FIELDS) {
    const v = e[k];
    if (typeof v === "string" && v) out[k] = redact(v, MAX_FIELD);
    else if (v === null) out[k] = null;
  }
  for (const k of ID_FIELDS) {
    const v = e[k];
    if (typeof v === "string" && ID.test(v)) out[k] = v;
    else if (v === null) out[k] = null;
  }
  for (const k of NUMBER_FIELDS) {
    const v = e[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = k === "durationMs" ? Math.round(v) : v;
  }
  return out;
}

type Sink = (event: Record<string, string | number | null>) => void;
const defaultSink: Sink = (event) => console.info("[orqo:op]", JSON.stringify(event));
let sink: Sink = defaultSink;

/** Replaces the sink (tests, or a tracing backend later). Returns a function restoring the previous one. */
export function setOperationSink(next: Sink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

/** Records one operation. Only whitelisted, sanitized fields leave this function; it never throws. */
export function recordOperation(event: OperationEvent): void {
  try {
    sink(clean(event));
  } catch {
    // Observability must never break the operation it observes.
  }
}

/** Sanitized category for an error: a known code if the error carries one, else its kind. Never its message. */
export function errorCategory(e: unknown): string {
  if (e && typeof e === "object") {
    const x = e as { category?: unknown; reason?: unknown; code?: unknown; name?: unknown };
    // A specific denial reason (e.g. "quota_exhausted", "plan_required") beats the generic error code.
    for (const v of [x.category, x.reason, x.code]) if (typeof v === "string" && /^[a-z0-9_]{1,40}$/i.test(v)) return v;
    if (x.name === "TimeoutError" || x.name === "AbortError") return "timeout";
    if (e instanceof Error) {
      const m = e.message.match(/\bHTTP (\d{3})\b/);
      if (m) return `http_${m[1]}`;
    }
  }
  return "error";
}

/** Runs `fn`, recording its duration and outcome. Errors are re-thrown unchanged. */
export async function observe<T>(base: Omit<OperationEvent, "outcome" | "durationMs">, fn: () => Promise<T>, clock: () => number = Date.now): Promise<T> {
  const started = clock();
  try {
    const value = await fn();
    recordOperation({ ...base, outcome: "succeeded", durationMs: clock() - started });
    return value;
  } catch (e) {
    recordOperation({ ...base, outcome: "failed", durationMs: clock() - started, errorCategory: errorCategory(e) });
    throw e;
  }
}
