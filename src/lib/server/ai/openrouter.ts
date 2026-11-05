import "server-only";
import { z } from "zod";
import { serverConfig } from "../config";
import { observe } from "@/lib/server/observability";
import { consumePermit, type ProviderPermit } from "../governance/permit";

export class AIUnavailableError extends Error {}

/** Provider-reported usage. Fields are null when OpenRouter does not report them; never estimated. */
export interface CompletionUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
}

/** The call reached the provider (and may have been billed) but produced no usable output. */
export class CompletionError extends Error {
  constructor(
    message: string,
    readonly model: string,
    readonly usage: CompletionUsage | null,
  ) {
    super(message);
  }
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Calls OpenRouter with a JSON-schema response format and validates the reply
 * with zod. Throws on transport errors, refusals or schema violations; callers
 * decide how to fall back.
 */
/**
 * Phase 17A: the OpenRouter transport. It needs a permit from the provider gate (one call, one reservation),
 * a model chosen by the Model Policy Engine and its price cap (max_price): nothing else may call OpenRouter.
 */
export async function structuredCompletion<S extends z.ZodType>(
  permit: ProviderPermit,
  opts: {
    name: string;
    schema: S;
    messages: ChatMessage[];
    model: string;
    maxPrice: { prompt: number; completion: number };
    timeoutMs?: number;
    maxTokens?: number;
  },
): Promise<{ data: z.infer<S>; model: string; usage: CompletionUsage | null }> {
  consumePermit(permit, "openrouter");
  const cfg = serverConfig().openrouter;
  if (!cfg.apiKey || !cfg.enabled) throw new AIUnavailableError("OpenRouter is not configured for this app.");
  const model = opts.model;
  // Safe metadata only (provider, model, duration, outcome, category): never prompts or outputs.
  return observe({ operation: "provider.call", provider: "openrouter", model }, () => complete(cfg.apiKey!, model, opts));
}

async function complete<S extends z.ZodType>(
  apiKey: string,
  model: string,
  opts: { name: string; schema: S; messages: ChatMessage[]; maxPrice: { prompt: number; completion: number }; timeoutMs?: number; maxTokens?: number },
): Promise<{ data: z.infer<S>; model: string; usage: CompletionUsage | null }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-title": "ORQO",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: opts.messages,
      ...(opts.maxTokens && { max_tokens: opts.maxTokens }),
      // The provider must refuse to charge above the policy's price cap (USD per million tokens).
      provider: { max_price: { prompt: opts.maxPrice.prompt, completion: opts.maxPrice.completion } },
      // Ask OpenRouter to report token usage and cost for the usage ledger.
      usage: { include: true },
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.name, strict: true, schema: z.toJSONSchema(opts.schema, { target: "draft-7" }) },
      },
    }),
  });
  if (!res.ok) {
    // Status only: the provider's body may echo request content and is never logged or surfaced.
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`OpenRouter HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
  };
  const usage: CompletionUsage | null = body.usage
    ? {
        promptTokens: body.usage.prompt_tokens ?? null,
        completionTokens: body.usage.completion_tokens ?? null,
        costUsd: typeof body.usage.cost === "number" && Number.isFinite(body.usage.cost) ? body.usage.cost : null,
      }
    : null;
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new CompletionError("OpenRouter returned no content.", body.model ?? model, usage);
  let json: unknown;
  try {
    json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new CompletionError("OpenRouter returned invalid JSON.", body.model ?? model, usage);
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) throw new CompletionError("OpenRouter output failed schema validation.", body.model ?? model, usage);
  return { data: parsed.data, model: body.model ?? model, usage };
}
