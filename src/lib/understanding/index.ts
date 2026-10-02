/**
 * Adaptive Commercial Understanding — the single entry point Phase 15 uses.
 * Business DNA → Market Model (one way) → next question. Pure.
 */
import type { TargetProfile } from "@/lib/intelligence/types";
import { buildBusinessDna } from "./dna";
import { buildMarketModel } from "./market";
import { nextQuestion } from "./question";
import type { CommercialUnderstanding, Validation } from "./types";

export function understandCompany(input: { companyName: string; website: string | null; intelligence: { id: string; researchedAt: string; profile: TargetProfile } | null; validations: readonly Validation[] }): CommercialUnderstanding {
  const dna = buildBusinessDna(input);
  const market = buildMarketModel(dna);
  return { dna, market, nextQuestion: nextQuestion(dna, input.validations) };
}

export { buildBusinessDna, itemKey } from "./dna";
export { buildMarketModel } from "./market";
export { nextQuestion } from "./question";
export type * from "./types";
