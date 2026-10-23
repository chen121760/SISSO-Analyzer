"""Independent NumPy checks of local case reports; no application code imported.

python tools/verify-evaluation.py [local-evaluation]
Binary Newton optimization, pairwise AUC, threshold precision/recall and confusion
counts are intentionally calculated differently from the JavaScript implementation.
"""
import json
import sys
from pathlib import Path
import numpy as np

folder = Path(sys.argv[1] if len(sys.argv) > 1 else "local-evaluation")
train = json.loads((folder / "logistic-train.json").read_text(encoding="utf-8"))
verify = json.loads((folder / "logistic-verify.json").read_text(encoding="utf-8"))
Xraw = np.array([r["coords"] for r in train["rows"]], dtype=float)
y = np.array([r["yTrue"] for r in train["rows"]])
mu, sd = Xraw.mean(axis=0), Xraw.std(axis=0)
sd[sd == 0] = 1
X = np.column_stack([np.ones(len(y)), (Xraw - mu) / sd])
beta = np.zeros(X.shape[1])
# Two-class softmax weights sum to zero. In the equivalent binary log-odds
# parametrization the penalty is lambda/4 * ||beta_slopes||^2.
penalty = train["config"]["lambda"] / 2
for iteration in range(100):
    p = 1 / (1 + np.exp(-np.clip(X @ beta, -700, 700)))
    gradient = X.T @ (p - y) / len(y) + np.r_[0, penalty * beta[1:]]
    hessian = X.T @ ((p * (1 - p))[:, None] * X) / len(y)
    hessian += np.diag(np.r_[0, np.full(X.shape[1] - 1, penalty)])
    update = np.linalg.solve(hessian, gradient)
    beta -= update
    if np.max(np.abs(update)) < 1e-12:
        break
else:
    raise AssertionError("Independent Newton fit did not converge")

evidence = {"oracle": "Independent NumPy Newton fit and pairwise ranking checks", "newtonIterations": iteration + 1, "datasets": {}}
for name, report in [("train", train), ("verify", verify)]:
    truth = np.array([r["yTrue"] for r in report["rows"]])
    coords = np.array([r["coords"] for r in report["rows"]])
    z = np.column_stack([np.ones(len(truth)), (coords - mu) / sd]) @ beta
    js_scores = np.array([r["scores"][1] for r in report["rows"]])
    score_error = float(np.max(np.abs(z - js_scores)))
    assert score_error < 2e-5, score_error
    pred = (z >= 0).astype(int)
    assert np.array_equal(pred, [r["yPred"] for r in report["rows"]])
    matrix = np.zeros((2, 3), dtype=int)
    for target, prediction in zip(truth, pred):
        matrix[target, prediction] += 1
    assert matrix.tolist() == report["metrics"]["confusion"]
    # Use JS scores to test exact tie handling independently of fitting error.
    positive, negative = js_scores[truth == 1], js_scores[truth == 0]
    differences = positive[:, None] - negative[None, :]
    auc = float(np.mean((differences > 0) + 0.5 * (differences == 0)))
    previous_recall, ap = 0.0, 0.0
    for threshold in sorted(set(js_scores), reverse=True):
        selected = js_scores >= threshold
        tp = np.sum(selected & (truth == 1))
        recall = tp / np.sum(truth == 1)
        precision = tp / np.sum(selected)
        ap += (recall - previous_recall) * precision
        previous_recall = recall
    probabilities = np.array([r["probabilities"][1] for r in report["rows"]])
    brier = float(np.mean((probabilities - truth) ** 2))
    log_loss = float(-np.mean(truth * np.log(probabilities) + (1 - truth) * np.log(1 - probabilities)))
    for key, value in [("auc", auc), ("ap", ap), ("brier", brier), ("logLoss", log_loss)]:
        assert abs(value - report["metrics"][key]) < 1e-12, (key, value)
    evidence["datasets"][name] = {"maxScoreDifference": score_error, "auc": auc, "ap": float(ap), "brier": brier, "logLoss": log_loss, "confusion": matrix.tolist()}
for name in ["train", "verify"]:
    geom = json.loads((folder / f"geometry-{name}.json").read_text(encoding="utf-8"))
    matrix = [[0, 0, 0], [0, 0, 0]]
    for row in geom["rows"]:
        matrix[row["yTrue"]][2 if row["yPred"] is None else row["yPred"]] += 1
    assert matrix == geom["metrics"]["confusion"]
    correct = sum(row["yTrue"] == row["yPred"] for row in geom["rows"])
    assert abs(correct / len(geom["rows"]) - geom["metrics"]["accuracy"]) < 1e-12
evidence["passed"] = True
regression_file = folder / "regression-demo-verify.json"
if regression_file.exists():
    regression = json.loads(regression_file.read_text(encoding="utf-8"))
    truth = np.array([r["yTrue"] for r in regression["rows"]], dtype=float)
    pred = np.array([r["yPred"] for r in regression["rows"]], dtype=float)
    baseline = np.array([r["baseline"] for r in regression["rows"]], dtype=float)
    valid = np.isfinite(truth) & np.isfinite(pred) & np.isfinite(pred - truth)
    truth, pred, baseline = truth[valid], pred[valid], baseline[valid]
    residual = pred - truth
    absolute = np.abs(residual)
    expected = {"rmse": np.sqrt(np.mean(residual ** 2)), "mae": absolute.mean(), "maxae": absolute.max(), "bias": residual.mean(),
                "medianAE": np.quantile(absolute, 0.5), "p90AE": np.quantile(absolute, 0.9), "p95AE": np.quantile(absolute, 0.95),
                "r2": 1 - np.sum(residual ** 2) / np.sum((truth - truth.mean()) ** 2),
                "baselineSkill": 1 - np.mean(residual ** 2) / np.mean((baseline - truth) ** 2)}
    for key, value in expected.items():
        assert abs(value - regression["metrics"][key]) < 1e-10, (key, value)
    evidence["regression"] = {"valid": int(np.sum(valid)), "metrics": {k: float(v) for k, v in expected.items()}}
(folder / "independent-check.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
print(json.dumps(evidence, indent=2))
