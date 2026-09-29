/**
 * Public company research via the Brave Search API, then structured extraction
 * via OpenRouter. Every extracted capability/need must cite one of the returned
 * search results; uncited items are dropped. Nothing here is simulated.
 */
import { z } from "zod";
import type { Capability, Company, Need, Source } from "@/lib/domain/types";
import { TAGS, type Tag } from "@/lib/domain/taxonomy";
import { structuredCompletion } from "../ai/openrouter";
import { serverConfig } from "../config";

export class ResearchUnavailableError extends Error {}

interface BraveResult {
  title: string;
  url: string;
  description: string;
}

export async function braveSearch(query: string, count = 8): Promise<BraveResult[]> {
  const key = serverConfig().brave.apiKey;
  if (!key) throw new ResearchUnavailableError("BRAVE_API_KEY is not configured.");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, { headers: { accept: "application/json", "x-subscription-token": key }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const body = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (body.web?.results ?? [])
    .filter((r): r is { title: string; url: string; description: string } => Boolean(r.title && r.url && r.description))
    .map(({ title, url, description }) => ({ title, url, description: description.replace(/<[^>]+>/g, "") }));
}

const TAG_KEYS = Object.keys(TAGS) as [Tag, ...Tag[]];

const Extraction = z.object({
  summary: z.string(),
  headquarters: z.string(),
  geographies: z.array(z.string()),
  markets: z.array(z.string()),
  capabilities: z.array(z.object({ label: z.string(), detail: z.string(), tags: z.array(z.enum(TAG_KEYS)), sourceIndex: z.number().int(), excerpt: z.string() })),
  needs: z.array(
    z.object({ label: z.string(), detail: z.string(), tags: z.array(z.enum(TAG_KEYS)), intensity: z.enum(["exploring", "active", "critical"]), sourceIndex: z.number().int(), excerpt: z.string() }),
  ),
});

export async function researchCompany(name: string): Promise<{ company: Company; sources: Source[] }> {
  const results = await braveSearch(`${name} company products partners expansion`);
  if (results.length === 0) throw new Error(`No public results for ${name}.`);
  const now = new Date().toISOString();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const sources: Source[] = results.map((r, i) => ({ id: `s-web-${slug}-${i}`, kind: "web-search", label: r.title, url: r.url, retrievedAt: now, simulated: false }));

  const { data } = await structuredCompletion({
    name: "orqo_company_research",
    schema: Extraction,
    messages: [
      {
        role: "system",
        content:
          "You are ORQO's Research and Capability Extraction agent. Extract only what the numbered search results state. Every item must cite sourceIndex and quote a short excerpt from that result. Mark needs only when the results show intent (hiring, expansion, stated plans). Omit anything unsupported.",
      },
      { role: "user", content: `Company: ${name}\n\n${results.map((r, i) => `[${i}] ${r.title}\n${r.url}\n${r.description}`).join("\n\n")}` },
    ],
  });

  const cite = (i: number) => sources[i]?.id;
  const companyId = `c-${slug}`;
  const offers: Capability[] = data.capabilities.flatMap((c, i) => {
    const sourceId = cite(c.sourceIndex);
    if (!sourceId) return [];
    return [{ id: `cap-${slug}-${i}`, companyId, label: c.label, detail: c.detail, tags: c.tags, evidence: [{ sourceId, excerpt: c.excerpt, epistemic: "fact" as const }], visibility: "public" as const, observedAt: now }];
  });
  const needs: Need[] = data.needs.flatMap((n, i) => {
    const sourceId = cite(n.sourceIndex);
    if (!sourceId) return [];
    return [
      { id: `need-${slug}-${i}`, companyId, label: n.label, detail: n.detail, tags: n.tags, intensity: n.intensity, evidence: [{ sourceId, excerpt: n.excerpt, epistemic: "inference" as const }], visibility: "public" as const, observedAt: now },
    ];
  });

  return {
    sources,
    company: {
      id: companyId,
      name,
      tagline: data.summary.split(". ")[0],
      summary: data.summary,
      headquarters: data.headquarters,
      size: "Unknown",
      markets: data.markets,
      geographies: data.geographies,
      offers,
      needs,
      objectives: [],
      constraints: [],
      accent: "#94A3B8",
    },
  };
}
