"""ORQO Company Intelligence reward for Python RL trainers (stdlib only, no dependencies).

Wraps the canonical TypeScript reward (rewards/server.ts) so Python trainers use the exact same scoring as
the evaluator. Shaped like a TRL GRPO reward function:

    from orqo_reward import OrqoReward
    orqo_reward = OrqoReward(repo_root="/path/to/ORQO")
    trainer = GRPOTrainer(..., reward_funcs=[orqo_reward])   # dataset rows carry `example_id`

The RL dataset is produced by:  bun training/company-intelligence/dataset/export.ts --split train --format rl
Requires `bun` on PATH. The holdout is refused by the server.
"""
import json
import subprocess
import threading


class OrqoReward:
    __name__ = "orqo_company_intelligence_reward"

    def __init__(self, repo_root=".", splits="train,validation", bun="bun"):
        self._lock = threading.Lock()
        self._proc = subprocess.Popen(
            [bun, "training/company-intelligence/rewards/server.ts", "--splits", splits],
            cwd=repo_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    @staticmethod
    def _text(completion):
        # TRL passes either a string or a conversational list [{"role": "assistant", "content": "..."}].
        if isinstance(completion, list):
            return "".join(m.get("content", "") for m in completion if isinstance(m, dict))
        return str(completion)

    def score(self, example_id, completion):
        with self._lock:
            self._proc.stdin.write(json.dumps({"example_id": example_id, "completion": self._text(completion)}) + "\n")
            self._proc.stdin.flush()
            line = self._proc.stdout.readline()
        out = json.loads(line)
        if out.get("reward") is None:
            raise ValueError("reward refused for %s: %s" % (example_id, out.get("error")))
        return out

    def __call__(self, prompts=None, completions=None, example_id=None, **kwargs):
        if example_id is None:
            raise ValueError("dataset rows must carry `example_id` (use export.ts --format rl)")
        return [float(self.score(i, c)["reward"]) for i, c in zip(example_id, completions)]

    def close(self):
        self._proc.stdin.close()
        self._proc.wait(timeout=10)


if __name__ == "__main__":
    import sys

    r = OrqoReward(repo_root=sys.argv[1] if len(sys.argv) > 1 else ".")
    print(json.dumps(r.score(sys.argv[2], sys.argv[3])))
    r.close()
