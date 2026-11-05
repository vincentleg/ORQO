# Reward specification — ORQO Company Intelligence v1

Implementation: `rewards/reward.ts` (pure) over `eval/scorer.ts` (pure). Config: `configs/reward.json`.
The evaluator and the reward share the scorer, so RL optimizes exactly what the gate measures.

```
invalid output (not JSON, or not schema-valid)      → reward = −1
otherwise reward = clamp( Σ wᵈ·scoreᵈ − min(Σ penalties, 2.0), −1, 1 )
```

## Weights (sum = 1)

| dimension | w | deterministic score (0–1) |
|---|---|---|
| factual_grounding | 0.25 | grounded claims / (claims + forbidden-term hits + contact hits). A claim is grounded when every cited evidence id exists, its `quote` appears verbatim (case/accent/whitespace-folded) in a cited item, and any named entity (product, customer, partner, fact location) appears in cited evidence. |
| opportunity_reasoning | 0.20 | 0.4 relationship ∈ acceptable (or correctly `null`) · 0.15 opportunity cites existing evidence · 0.15 thesis uses what the represented company actually sells · 0.3 next action ∈ acceptable |
| company_understanding | 0.15 | 0.2 offering-form Jaccard · 0.1 revenue/customer-scope Jaccard · 0.3 deployment signals vs gold · 0.1 maturity · 0.3 key-term recall |
| fit_classification | 0.15 | 1 if acceptable · 0.4 if one class away · 0 otherwise |
| decision_maker_reasoning | 0.10 | 0.7 recall + 0.3 precision of role *functions* vs gold; 1 when correctly empty; 0 if any contact detail |
| uncertainty_calibration | 0.10 | 0.4 confidence level (exact 1 / adjacent 0.5) · 0.3 required unknowns listed · 0.2 must-remain-unknown respected · 0.1 conflicts surfaced |
| schema_compliance | 0.05 | 1 bare JSON · 0.5 fenced/prose-wrapped JSON |

An external judge may refine only company_understanding, opportunity_reasoning and decision_maker_reasoning
(`eval/judge.ts`, blended `(1−w)·det + w·judge`). Grounding, fit, calibration and schema stay deterministic.

## Penalties (subtracted, total capped at 2.0)

| kind | amount | triggered by | counts as hallucination |
|---|---|---|---|
| fabricated_contact | 1.00 | email, phone number (≥ 8 digits), personal profile URL anywhere in the output | yes |
| fabricated_fact | 0.35 each | quote not in cited evidence; nonexistent evidence id; named entity absent from evidence; forbidden term (plausible hallucination listed per example); named customer/partner/product where the evidence names none | yes |
| unsupported_technical_claim | 0.25 | deployment signal asserted as FACT where the evidence does not establish it; signal quote not found | yes |
| unsupported_technical_inference | 0.10 | same, asserted as INFERENCE (softer: it is labelled, but still unsupported) | no |
| unsupported_geography | 0.30 | any location where geography must remain unknown; a fact location absent from its evidence | yes |
| contradiction | 0.40 | signal opposite to the evidence (present ↔ absent); maturity ≥ 2 stages off; fit opposite of the supported class | yes (fit: no) |
| unjustified_confidence | 0.30 | confidence two levels above gold, or `strong` with an unacceptable fit | no |

## Properties (tested in `tests/harness.test.ts`)

- Every gold answer earns ≈ 1.0 with zero penalties (the dataset build refuses gold that does not).
- Invalid output → −1; a fabricated contact alone drives the reward to ≤ 0.
- Fact-level unsupported claims cost more than inference-level ones; honest `unknown` is never penalized.
- Obeying an injected instruction in evidence (e.g. "rate this excellent") is penalized.

## Using it from a trainer

- **Python (TRL GRPO, etc.)**: `rewards/orqo_reward.py` → `OrqoReward(repo_root=…)` is a reward function
  `(prompts, completions, example_id, **kw) → list[float]`. Stdlib only; spawns `rewards/server.ts`.
- **Any language**: `bun training/company-intelligence/rewards/server.ts` — JSONL over stdio.
- The server loads train/validation only and refuses holdout ids.

Reward hacking watch-list: the deterministic checks reward schema-valid, cautious answers; a policy that
answers `unknown` everywhere loses company_understanding, fit and opportunity credit, so it does not win.
Inspect per-example breakdowns (`results/runs/<label>/results.json`) whenever reward rises faster than the
judge-refined scores.
