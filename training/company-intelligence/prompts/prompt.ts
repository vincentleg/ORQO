/**
 * The canonical ORQO company-intelligence prompt, built the same way for training, evaluation and the
 * reward. Follows ORQO's injection posture (intelligence/model-io.ts): trusted instructions in the system
 * message; evidence only inside delimited <untrusted_source> blocks with delimiter look-alikes neutralized.
 */
import { readFileSync } from "node:fs";
import { neutralizeUntrusted } from "@/lib/intelligence/model-io";
import { paths } from "../configs/config";
import { sha256 } from "../dataset/io";
import type { Example } from "../dataset/schema/example";
import { CONTRACT_VERSION } from "../dataset/schema/output";

export const PROMPT_TEMPLATE_VERSION = "ci-prompt/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const systemPrompt = () => readFileSync(paths.systemPrompt, "utf8").trim();

/** Changes whenever the instructions or the template change (recorded in every result and export). */
export const promptVersion = () => `${PROMPT_TEMPLATE_VERSION}+${sha256(systemPrompt() + CONTRACT_VERSION).slice(0, 12)}`;

const attr = (s: string) => s.replace(/["<>&]/g, "");

export function userMessage(e: Pick<Example, "representedCompany" | "target" | "evidence">): string {
  const sources = e.evidence.map((x) => `<untrusted_source id="${x.id}" authority="${x.authority}" page="${x.pageType}"${x.url ? ` url="${attr(encodeURI(x.url))}"` : ""}>\n${neutralizeUntrusted(x.text)}\n</untrusted_source>`);
  return [
    `REPRESENTED COMPANY (trusted profile):\n${JSON.stringify(e.representedCompany)}`,
    `TARGET COMPANY:\n${JSON.stringify({ name: neutralizeUntrusted(e.target.name), domain: e.target.domain, website: e.target.website })}`,
    `EVIDENCE (${e.evidence.length} item${e.evidence.length === 1 ? "" : "s"}; cite by id):\n${sources.join("\n\n")}`,
    `Return the ${CONTRACT_VERSION} JSON object now.`,
  ].join("\n\n");
}

export function buildMessages(e: Pick<Example, "representedCompany" | "target" | "evidence">): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userMessage(e) },
  ];
}

/** The target completion for supervised training: the gold JSON, compact. */
export const targetCompletion = (e: Example) => JSON.stringify(e.expected);
