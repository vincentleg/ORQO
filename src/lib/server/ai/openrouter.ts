import { z } from "zod";
import { serverConfig } from "../config";

export class AIUnavailableError extends Error {}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Calls OpenRouter with a JSON-schema response format and validates the reply
 * with zod. Throws on transport errors, refusals or schema violations; callers
 * decide how to fall back.
 */
export async function structuredCompletion<S extends z.ZodType>(opts: {
  name: string;
  schema: S;
  messages: ChatMessage[];
  model?: string;
  timeoutMs?: number;
}): Promise<{ data: z.infer<S>; model: string }> {
  const cfg = serverConfig().openrouter;
  if (!cfg.apiKey || !cfg.enabled) throw new AIUnavailableError("OpenRouter is not configured for this app.");
  const model = opts.model ?? cfg.discoveryModel;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
      "x-title": "ORQO",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: opts.messages,
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.name, strict: true, schema: z.toJSONSchema(opts.schema, { target: "draft-7" }) },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content.");
  const json: unknown = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  return { data: opts.schema.parse(json), model: body.model ?? model };
}
