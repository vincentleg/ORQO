# Model card — ORQO Business Intelligence Brain v1 (Company Intelligence)

> Status: **NOT TRAINED.** Template prepared on branch `training/company-intelligence-v1`.
> Fill every `TBD` from real artifacts (`training/company-intelligence/results/`). Never estimate.

## Purpose

Given the represented company's profile/objectives, a target company and supplied evidence, produce an
`orqo.company_intelligence/v1` analysis (FACT / INFERENCE / UNKNOWN; fit; opportunity; decision-maker ROLES;
unknowns; confidence; next action). It must never invent contacts, customers, products, partnerships,
technical architecture or geography.

## Identity

| field | value |
|---|---|
| model name | orqo-company-intelligence-v1 |
| base model | TBD (provided by event) — exact id + revision/hash |
| base model license | TBD |
| training method | TBD (SFT / LoRA / QLoRA / GRPO / …) |
| adapter or full weights | TBD |
| event | TBD (name, date) |
| artifact location | TBD (path/URI; weights are never committed to git) |
| artifact sha256 | TBD |

## Data

| field | value |
|---|---|
| dataset | TBD (e.g. seed v1 + …) — `dataset/seed.jsonl` sha256 TBD |
| split manifest sha256 | TBD (`dataset/splits/manifest.json`) |
| train / validation / holdout | TBD / TBD / TBD examples |
| synthetic share | TBD (seed v1 is 100% synthetic, harness validation only) |
| training export manifest | TBD (`results/exports/export-manifest.json`) |
| prompt version | TBD (`ci-prompt/v1+…`) |

## Training

| field | value |
|---|---|
| hardware | TBD (GPU model × count, provided by event) |
| environment | TBD (Daytona workspace id/image) |
| framework + version | TBD |
| duration (wall clock) | TBD |
| compute (GPU-hours) | TBD |
| key parameters | TBD (epochs/steps, lr, batch, seq len, LoRA r/alpha/dropout/targets, quantization, GRPO group size/β/KL, seed) |
| reward | `ci-reward/v1` (only if RL) |

## Evaluation (untouched holdout, identical prompt/scorer/judge)

| metric | baseline | trained | Δ |
|---|---|---|---|
| overall (mean reward) | TBD | TBD | TBD |
| factual_grounding | TBD | TBD | TBD |
| opportunity_reasoning | TBD | TBD | TBD |
| company_understanding | TBD | TBD | TBD |
| fit_classification | TBD | TBD | TBD |
| decision_maker_reasoning | TBD | TBD | TBD |
| uncertainty_calibration | TBD | TBD | TBD |
| schema_compliance | TBD | TBD | TBD |
| schema-valid rate | TBD | TBD | TBD |
| hallucination rate | TBD | TBD | TBD |
| fabricated-contact rate | TBD | TBD | TBD |

Judge: TBD (`none` or the event judge; weight). Gate decision: TBD (paste `results/gate/gate.md`).

## Regressions

TBD — every non-blocking warning from the gate (per-dimension and per-example), with an explanation.

## Limitations

- Seed v1 has 15 synthetic examples and a 3-example holdout: it validates the harness, not the model.
  Any score on it is not statistically meaningful; a real holdout of curated examples is required before
  any integration decision.
- English only; evidence limited to supplied text (no browsing, no retrieval).
- Deterministic scoring approximates understanding and commercial reasoning; subjective quality needs a judge.
- TBD (observed failure modes).

## ORQO integration status

**Not integrated.** Integration requires: gate `qualifies_for_integration_review` on an untouched holdout,
plus an explicit review by Vincent. Planned surface: mission finding `company_analysis`
(`eval/finding.ts` mapping) behind a feature flag. Status: TBD.

## Cost

| item | value |
|---|---|
| actual external paid spend (USD) | **0** at preparation · TBD after the event (must stay 0 unless Vincent approved otherwise in `configs/safety.json`) |
| event-provided credits used | TBD |
