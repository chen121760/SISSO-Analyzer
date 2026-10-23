"""Independent vectorized NumPy audit of batch leaders and predefined ranks.
python tools/verify-evaluation-batch.py [local-evaluation/batch]
"""
import json
import sys
from pathlib import Path
import numpy as np

folder = Path(sys.argv[1] if len(sys.argv) > 1 else "local-evaluation/batch")
audits = json.loads((folder / "independent-input.json").read_text(encoding="utf-8"))
checks = []
for audit in audits:
    training = audit["train"]
    coords = np.array([r["coords"] for r in training["rows"]], dtype=float)
    truth = np.array([r["yTrue"] for r in training["rows"]])
    mu, sd = coords.mean(axis=0), coords.std(axis=0)
    sd[sd == 0] = 1
    x = np.column_stack([np.ones(len(coords)), (coords - mu) / sd])
    beta = np.zeros(x.shape[1])
    penalty = training["config"]["lambda"] / 2
    for iteration in range(100):
        p = 1 / (1 + np.exp(-np.clip(x @ beta, -700, 700)))
        gradient = x.T @ (p - truth) / len(x) + np.r_[0, penalty * beta[1:]]
        hessian = x.T @ ((p * (1 - p))[:, None] * x) / len(x) + np.diag(np.r_[0, np.full(x.shape[1] - 1, penalty)])
        update = np.linalg.solve(hessian, gradient)
        beta -= update
        if np.max(np.abs(update)) < 1e-12:
            break
    else:
        raise AssertionError((audit["rank"], "NumPy did not converge"))
    record = {"rank": audit["rank"], "datasets": {}}
    for name in ["train", "verify"]:
        report = audit[name]
        rows = report["rows"]
        coords = np.array([r["coords"] for r in rows], dtype=float)
        truth = np.array([r["yTrue"] for r in rows])
        expected_scores = np.column_stack([np.ones(len(coords)), (coords - mu) / sd]) @ beta
        scores = np.array([r["scores"][1] for r in rows])
        difference = float(np.max(np.abs(expected_scores - scores)))
        assert difference < 2e-5, (audit["rank"], name, difference)
        pred = np.array([r["yPred"] for r in rows])
        assert np.array_equal((expected_scores >= 0).astype(int), pred), (audit["rank"], "decisions")
        pos, neg = scores[truth == 1], scores[truth == 0]
        pairs = pos[:, None] - neg[None, :]
        auc = float(np.mean((pairs > 0) + 0.5 * (pairs == 0)))
        recall_before, ap = 0.0, 0.0
        for threshold in sorted(set(scores), reverse=True):
            selected = scores >= threshold
            true_positive = np.sum(selected & (truth == 1))
            recall = true_positive / len(pos)
            ap += (recall - recall_before) * true_positive / np.sum(selected)
            recall_before = recall
        probabilities = np.array([r["probabilities"][1] for r in rows])
        brier = float(np.mean((probabilities - truth) ** 2))
        p_true = np.where(truth == 1, probabilities, 1 - probabilities)
        loss = float(-np.mean(np.log(np.maximum(p_true, 1e-15))))
        metrics = {"accuracy": float(np.mean(pred == truth)), "coverage": 1.0, "auc": auc, "ap": float(ap), "brier": brier, "logLoss": loss}
        for key, value in metrics.items():
            assert abs(value - report["metrics"][key]) < 1e-9, (audit["rank"], name, key, value, report["metrics"][key])
        record["datasets"][name] = {"maxScoreDifference": difference, **metrics}
    checks.append(record)
output = {"passed": True, "oracle": "Independent NumPy fit, pairwise AUC and threshold-count AP", "models": len(checks), "checks": checks}
(folder / "independent-check.json").write_text(json.dumps(output, indent=2), encoding="utf-8")
print(json.dumps({"passed": True, "models": len(checks), "ranks": [r["rank"] for r in checks], "maxScoreDifference": max(d["maxScoreDifference"] for c in checks for d in c["datasets"].values())}))
