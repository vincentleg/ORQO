# results/

Generated, local-only (git-ignored except this file):

- `exports/` — trainer-ready JSONL + `export-manifest.json` (proof of what training saw)
- `runs/<label>/` — `predictions.jsonl`, `results.json`, `summary.md`, optional `judge-requests.jsonl`
- `gate/` — `gate.json`, `gate.md`

Copy the final `gate.md` and both `summary.md` files into `models/company-intelligence/MODEL_CARD.md`.
