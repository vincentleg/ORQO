/**
 * Provider-neutral inference adapters. The evaluator only knows `InferenceAdapter`; plugging in the event's
 * base model or the trained model/adapter never changes evaluation code.
 *
 *   mock:oracle | mock:base | mock:hallucinating   deterministic, offline (harness validation only)
 *   replay:<path.jsonl>                             completions produced elsewhere ({"exampleId","completion"} per line)
 *   openai:<baseUrl>#<model>                        any OpenAI-compatible server (vLLM, SGLang, TGI, llama.cpp, …)
 *
 * The OpenAI-compatible adapter is a plain HTTP client for a server YOU run (e.g. on the event GPU box). It is
 * restricted to loopback hosts unless a host is approved in configs/safety.json, so it cannot silently reach a
 * paid API. No paid provider is implemented here.
 */
import { isAbsolute, join } from "node:path";
import { assertInferenceHost, REPO_ROOT } from "../configs/config";
import { readJsonl } from "../dataset/io";
import type { Example } from "../dataset/schema/example";
import type { CompanyIntelligence } from "../dataset/schema/output";
import type { ChatMessage } from "../prompts/prompt";

export interface InferenceRequest {
  example: Example;
  messages: ChatMessage[];
  maxOutputTokens: number;
}

export interface InferenceResponse {
  completion: string;
  latencyMs: number;
}

export interface InferenceAdapter {
  readonly id: string;
  generate(req: InferenceRequest): Promise<InferenceResponse>;
}

// ---------------------------------------------------------------------------------------------------------
// Mock adapters (deterministic; they read the gold answer, so they are ONLY for testing the harness)
// ---------------------------------------------------------------------------------------------------------

const firstSentence = (s: string) => (s.match(/^[^.!?]{8,}[.!?]/)?.[0] ?? s).slice(0, 280);

/** A plausible untrained model: valid-ish JSON, generic reasoning, overconfident, a few typical hallucinations. */
export function mockBaseOutput(e: Example): string {
  const e1 = e.evidence[0];
  const quote = firstSentence(e1.text).replace(/[.!?]$/, "");
  const g = e.expected;
  const sig = { status: "present" as const, basis: "inference" as const, evidence: [e1.id], rationale: "The company appears to use modern technology." };
  const out: CompanyIntelligence = {
    ...g,
    summary: { statement: quote, basis: "fact", evidence: [e1.id], quote },
    products: [],
    namedCustomers: [],
    partnerships: [],
    businessModel: { offeringForms: ["software"], revenueModels: ["subscription"], customerScope: ["business"], claims: [] },
    markets: [],
    deployment: { cloud: sig, onPrem: g.deployment.onPrem, edge: sig, hardware: g.deployment.hardware },
    technicalSignals: [],
    geography: { status: "known", locations: [{ place: "United States", kind: "headquarters", basis: "fact", evidence: [e1.id], quote }] },
    maturity: { stage: "growth", basis: "inference", evidence: [e1.id], rationale: "The company has a website and a product." },
    conflicts: [],
    fit: { class: "moderate", score: 60, rationale: "There may be synergies between the two companies.", supporting: [], contradicting: [] },
    opportunity: { relationship: "technology_partner", thesis: "The companies could collaborate to innovate together.", ownBrings: "Technology.", targetBrings: "Market access.", basis: "inference", evidence: [e1.id] },
    decisionMakerRoles: [{ role: "CEO", function: "executive", rationale: "The CEO makes decisions." }],
    unknowns: [],
    confidence: { level: "strong", rationale: "The website is clear." },
    nextAction: { kind: "engage_role", text: "Reach out to the CEO." },
  };
  const json = JSON.stringify(out);
  // Typical untrained formatting failures, deterministic per example.
  if (e.evidence.length === 1) return json.slice(0, Math.floor(json.length * 0.6));
  return e.id.length % 2 ? "```json\n" + json + "\n```" : json;
}

/** The gold answer plus fabrications: a named customer and a personal contact. Must never pass the gate. */
export function mockHallucinatingOutput(e: Example): string {
  const g = e.expected;
  const name = e.scoring.forbiddenTerms[0] ?? "Globex Industries";
  const e1 = e.evidence[0];
  const quote = e1.text.slice(0, 60);
  return JSON.stringify({
    ...g,
    namedCustomers: [{ name, description: "Key customer.", basis: "fact", evidence: [e1.id], quote }],
    decisionMakerRoles: [...g.decisionMakerRoles.slice(0, 4), { role: "Chief Executive Officer", function: "executive", rationale: "Reach Jane Doe directly at jane.doe@" + e.target.domain + " or +1 415 555 0134." }],
    confidence: { level: "strong", rationale: "Confirmed." },
  } satisfies CompanyIntelligence);
}

export class MockAdapter implements InferenceAdapter {
  readonly id: string;
  constructor(readonly mode: "oracle" | "base" | "hallucinating") {
    this.id = `mock:${mode}`;
  }
  async generate({ example }: InferenceRequest): Promise<InferenceResponse> {
    const completion = this.mode === "oracle" ? JSON.stringify(example.expected) : this.mode === "base" ? mockBaseOutput(example) : mockHallucinatingOutput(example);
    return { completion, latencyMs: 0 };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Replay: completions generated by any external stack (batch inference on the event GPU, etc.)
// ---------------------------------------------------------------------------------------------------------

export class ReplayAdapter implements InferenceAdapter {
  readonly id: string;
  private readonly byId: Map<string, string>;
  constructor(path: string) {
    const abs = isAbsolute(path) ? path : join(REPO_ROOT, path);
    this.id = `replay:${path}`;
    this.byId = new Map(
      readJsonl(abs).map((r) => {
        const row = r as { exampleId?: string; example_id?: string; completion?: string; output?: unknown };
        const id = row.exampleId ?? row.example_id;
        if (!id) throw new Error(`${path}: every row needs exampleId`);
        return [id, typeof row.completion === "string" ? row.completion : JSON.stringify(row.output ?? null)];
      }),
    );
  }
  async generate({ example }: InferenceRequest): Promise<InferenceResponse> {
    const c = this.byId.get(example.id);
    if (c === undefined) throw new Error(`${this.id}: no completion for ${example.id}`);
    return { completion: c, latencyMs: 0 };
  }
}

// ---------------------------------------------------------------------------------------------------------
// OpenAI-compatible HTTP (self-hosted server). Loopback-only unless approved in safety.json.
// ---------------------------------------------------------------------------------------------------------

export class OpenAICompatibleAdapter implements InferenceAdapter {
  readonly id: string;
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    assertInferenceHost(baseUrl);
    this.id = `openai:${model}`;
  }
  async generate({ messages, maxOutputTokens }: InferenceRequest): Promise<InferenceResponse> {
    const t0 = performance.now();
    const key = process.env.ORQO_CI_INFERENCE_TOKEN;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: this.model, messages, temperature: 0, max_tokens: maxOutputTokens }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`${this.id}: HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { completion: body.choices?.[0]?.message?.content ?? "", latencyMs: Math.round(performance.now() - t0) };
  }
}

export function adapterFromSpec(spec: string): InferenceAdapter {
  const [kind, ...rest] = spec.split(":");
  const arg = rest.join(":");
  if (kind === "mock" && (arg === "oracle" || arg === "base" || arg === "hallucinating")) return new MockAdapter(arg);
  if (kind === "replay" && arg) return new ReplayAdapter(arg);
  if (kind === "openai" && arg.includes("#")) {
    const [url, model] = arg.split("#");
    return new OpenAICompatibleAdapter(url, model);
  }
  throw new Error(`unknown adapter spec "${spec}" (mock:oracle|base|hallucinating, replay:<file>, openai:<baseUrl>#<model>)`);
}
