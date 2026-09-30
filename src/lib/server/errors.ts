import type { z } from "zod";

/** Errors the server layer may surface to clients. Messages are safe to show; details stay in logs. */
export type AppErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "conflict" | "rate_limited" | "unavailable" | "internal";

const STATUS: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

/**
 * Maps a PostgREST / Postgres error to an AppError. RLS denials and missing rows
 * are indistinguishable to the caller on purpose (no cross-tenant enumeration).
 */
export function fromDbError(error: PostgrestLikeError, notFoundMessage = "Not found."): AppError {
  switch (error.code) {
    case "42501":
      return new AppError("forbidden", "You do not have permission to do this.");
    case "P0002":
    case "PGRST116":
      return new AppError("not_found", notFoundMessage);
    case "23505":
      return new AppError("conflict", "This already exists.");
    case "23503":
    case "23514":
    case "22P02":
    case "22001":
    case "23502":
      return new AppError("invalid_input", "The request contains invalid data.");
    case "54000":
      return new AppError("rate_limited", "Limit reached.");
    default:
      return new AppError("internal", "Unexpected database error.");
  }
}

/** Validates caller input; failures are the caller's fault (invalid_input), unlike row-decoding failures. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError("invalid_input", "The request contains invalid data.");
  return r.data;
}
