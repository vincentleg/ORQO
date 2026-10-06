# ORQO Business Intelligence Brain v1 — training & evaluation harness

Provider-neutral harness to train and evaluate a company-intelligence model for ORQO. **Nothing here trains,
calls a model, or spends money by itself.** Training method (SFT, LoRA/QLoRA, GRPO/RL, …), base model, GPU and
framework come from the event organizers; this package supplies the data, prompt, reward, evaluator and gate.

## Cost safety: read first

`configs/safety.json` has `external_paid_spend_usd = 0`. **NO paid API, NO paid GPU, NO paid storage,
NO paid provider** unless Vincent explicitly approves it (and the approval is recorded in that file: every CLI
refuses to run otherwise). Event-provided credits/resources may be used later, but activating them is a
deliberate step (`event_credits_activated` + approval), not part of this preparation. The inference adapter
only talks to loopback hosts unless a host is approved there.

## Layout

| path | what |
|---|---|
| `dataset/schema/output.ts` | **Output contract** `orqo.company_intelligence/v1` (zod) → `company-intelligence.output.schema.json` |
| `dataset/schema/example.ts` | **Example format** (one JSONL line) → `example.schema.json` |
| `dataset/seed/*.json` | 15 synthetic seed examples (reviewable sources) + `represented/` companies |
| `dataset/seed.jsonl`, `dataset/splits/` | compiled seed; deterministic train/validation/holdout + `manifest.json` |
| `dataset/{build,split,export}.ts` | compile+validate · split · export to trainer formats (holdout never exported) |
| `prompts/system.md`, `prompts/prompt.ts` | canonical task prompt (evidence in `<untrusted_source>` blocks) |
| `eval/scorer.ts` | deterministic scoring + hallucination checks (shared with the reward) |
| `eval/adapters.ts` | `InferenceAdapter`: `mock:*`, `replay:<jsonl>`, `openai:<loopback url>#<model>` |
| `eval/judge.ts` | hook for the event's judge (files in/out; never calls a model) |
| `eval/run.ts`, `eval/gate.ts` | evaluate one model · base-vs-trained integration gate |
| `eval/finding.ts` | output → ORQO mission finding (`company_analysis`) mapping |
| `rewards/` | reward (`reward.ts`), stdio server, Python shim, `REWARD_SPEC.md` |
| `configs/` | safety, reward weights/penalties, gate thresholds, split salt/ratios |
| `tests/harness.test.ts` | `bun run test:training` |
| `../../models/company-intelligence/MODEL_CARD.md` | model card template |

## Live-event runbook

Each step's output feeds the next. `<…>` = fill in once the event stack is known.

### 0. Environment (Daytona / event GPU box)
```bash
git clone <repo> && cd ORQO && git checkout training/company-intelligence-v1
bun install --frozen-lockfile          # no GPU tooling needed for the harness itself
bun run intel:check && bun run test:training
<install the event's training framework as instructed by the organizers>
```

### 1. Export training data (train/validation only)
```bash
bun run intel:export -- --split train      --format chat     # SFT / LoRA / QLoRA  (or prompt-completion | text)
bun run intel:export -- --split validation --format chat
bun run intel:export -- --split train      --format rl       # GRPO / RL prompts (+ example_id)
# → training/company-intelligence/results/exports/*.jsonl + export-manifest.json (keep it: the gate needs it)
```

### 2. Baseline (base model, before training)
Serve the base model with an OpenAI-compatible server on the box (vLLM / SGLang / TGI / llama.cpp), or run
batch inference and write `{"exampleId","completion"}` lines.
```bash
<serve base model, e.g.: vllm serve <base-model> --port 8000>
bun run intel:eval -- --adapter openai:http://127.0.0.1:8000/v1#<base-model> --label base --emit-judge-requests
#   or: --adapter replay:training/company-intelligence/results/predictions/base.jsonl
```
Use the **same** generation settings for base and trained (temperature 0, same max tokens).
Optional: guided JSON decoding with `dataset/schema/company-intelligence.output.schema.json`.

### 3. Training
```bash
<event training command> --train results/exports/train.chat.jsonl --eval results/exports/validation.chat.jsonl …
# RL: reward_funcs=[OrqoReward(repo_root=".")]  from rewards/orqo_reward.py  (dataset: train.rl.jsonl)
```
Record base model id/revision, method, hyper-parameters, hardware, duration and seed for the model card.

### 4. Evaluate the trained model (same holdout, same prompt)
```bash
<serve trained model/adapter, e.g.: vllm serve <base-model> --enable-lora --lora-modules orqo=<adapter-path>>
bun run intel:eval -- --adapter openai:http://127.0.0.1:8000/v1#<served-name> --label trained --emit-judge-requests
```
Optional judge: give both `judge-requests.jsonl` files to the event judge, collect
`{"exampleId","dimension","score","rationale","runLabel"}` lines, then re-run both evals with
`--judge file:<verdicts.jsonl>`.

### 5. Compare and gate
```bash
bun run intel:gate -- \
  --base    training/company-intelligence/results/runs/base/results.json \
  --trained training/company-intelligence/results/runs/trained/results.json \
  --training-manifest training/company-intelligence/results/exports/export-manifest.json
# exit 0 = qualifies_for_integration_review · exit 1 = does_not_qualify   → results/gate/gate.md
```

### 6. Integration decision
Fill `models/company-intelligence/MODEL_CARD.md`. A qualifying model is only **eligible** for an ORQO
integration review; nothing is integrated automatically. Weights stay out of git.

## Success gate (programmatic: `eval/gate.ts`, thresholds in `configs/gate.json`)

1. evaluated on the untouched holdout (manifest-verified; training export manifest proves no holdout example was exported);
2. overall (mean reward) improves by ≥ 0.02 over baseline;
3. factual grounding does not regress;
4. hallucination rate and fabricated-contact rate do not increase;
5. schema-valid rate ≥ 95%.

Plus comparability (same prompt/contract/scorer/reward/judge). Per-dimension and per-example regressions are reported as warnings.

## Important caveats

- The seed set is **15 synthetic examples** (`.example` domains, names marked "(synthetic)") for harness
  validation. It is not a training corpus and its 3-example holdout cannot support a real integration decision.
  Add curated examples as new `dataset/seed/*.json` files, then `intel:build` + `intel:split` **before** any training.
  Never re-split after training has started (the gate detects it).
- Mock adapters read the gold answers; they exist only to test the harness.
