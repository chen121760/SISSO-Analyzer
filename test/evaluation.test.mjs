import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CLASS_TEXTS } from "./classification.test.mjs";
const require = createRequire(import.meta.url);
const E = require("../js/sisso-evaluation.js");
const C = require("../js/sisso-classification.js");
const Core = require("../js/sisso-core.js");
const near = (a, b, eps = 1e-10) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const point = (coords, classIndex) => ({ coords, classIndex, finite: coords.every(Number.isFinite) });

// Boundary/degenerate-domain cases, including more classes than dimensions.
const fit = E.fitGeometry([point([0], 0), point([2], 0), point([1], 1), point([3], 1), point([5], 2)], 3, 1, [1, 1, 1]);
assert.equal(E.geometryPredict(fit, [0]).yPred, 0);
assert.equal(E.geometryPredict(fit, [2]).status, "ambiguous");
assert.equal(E.geometryPredict(fit, [4]).status, "out-of-domain");
assert.equal(E.geometryPredict(fit, [5]).yPred, 2);
assert.equal(E.geometryPredict(fit, [NaN]).status, "invalid");
assert.throws(() => E.fitGeometry([], 2, 1, [0, 1]), /isconvex/);
const line = E.fitGeometry([point([0, 0], 0), point([2, 2], 0), point([3, 0], 1)], 2, 2, [1, 1]);
assert.equal(E.geometryPredict(line, [1, 1]).yPred, 0);
assert.equal(E.geometryPredict(line, [1, 1.001]).status, "out-of-domain");
assert.equal(E.geometryPredict(line, [3, 0]).yPred, 1);
const huge = E.fitGeometry([point([1e180, 0], 0), point([2e180, 0], 0), point([1e180, 1e180], 0), point([-1e180, 0], 1)], 2, 2);
assert.equal(E.geometryPredict(huge, [1.2e180, 0.1e180]).yPred, 0);

const result = C.runPipeline(CLASS_TEXTS);
const native = E.evaluate(result, result.models[0], { dataset: "train" });
assert.equal(native.metrics.accuracy, 1);
assert.equal(native.metrics.auc, null);
assert.equal(native.rows[0].officialClassified, "YES");
const abstain = E.evaluate(result, result.models[0], { dataset: "verify" });
assert.equal(abstain.rows[0].correct, null);
assert.equal(abstain.metrics.accuracy, 0);
assert.equal(abstain.metrics.selectiveAccuracy, null);
assert.deepEqual(abstain.metrics.confusion, [[0, 0, 0], [0, 0, 1]]);
const logit = E.evaluate(result, result.models[0], { dataset: "verify", method: "logistic" });
assert.equal(logit.manifest.fit.converged, true);
const flipped = structuredClone(result); flipped.verify.labels = [0];
const logitFlip = E.evaluate(flipped, flipped.models[0], { dataset: "verify", method: "logistic" });
assert.deepEqual(logit.manifest.fit, logitFlip.manifest.fit);
assert.deepEqual(logit.rows[0].scores, logitFlip.rows[0].scores);
assert.equal(logit.rows[0].yPred, logitFlip.rows[0].yPred);
const hiddenLabels = structuredClone(result); hiddenLabels.verify.labels = [null];
assert.equal(E.evaluate(hiddenLabels, hiddenLabels.models[0], { method: "logistic" }).metrics.labelled, 0);
const threshold = E.evaluate(result, result.models[0], { dataset: "train", method: "logistic", threshold: 1 });
const logisticTrain = E.evaluate(result, result.models[0], { dataset: "train", method: "logistic" });
assert.equal(threshold.metrics.auc, logisticTrain.metrics.auc);
assert.notEqual(threshold.metrics.accuracy, logisticTrain.metrics.accuracy);
const pos0 = E.evaluate(result, result.models[0], { dataset: "train", method: "logistic", positiveClass: 0 });
near(pos0.metrics.auc, 1);
assert.deepEqual(pos0.rows.map(r => r.yPred), logisticTrain.rows.map(r => r.yPred));
const multiFit = E.fitLogistic([point([-4, 0], 0), point([-3, 1], 0), point([4, 0], 1), point([3, 1], 1), point([0, 4], 2), point([1, 5], 2)], 3, 0.01);
assert.equal(multiFit.converged, true);
assert.deepEqual([[-4, 0], [4, 0], [0, 4]].map(x => E.logisticPredict(multiFit, x, 1, 0.5).yPred), [0, 1, 2]);

// Hand-computable ranking cases: ties processed together, AP is not trapezoidal.
const rank = E.curves([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]);
near(rank.auc, 0.75); near(rank.ap, 5 / 6);
near(E.curves([0, 1, 0, 1], [1, 1, 1, 1]).auc, 0.5);
near(E.curves([0, 1, 0, 1], [1, 1, 1, 1]).ap, 0.5);
assert.equal(E.curves([1, 1], [1, 2]).available, false);
const rows = [
  { id: "a", yTrue: 0, yPred: 0, status: "accepted" },
  { id: "b", yTrue: 0, yPred: 1, status: "accepted" },
  { id: "c", yTrue: 1, yPred: 1, status: "accepted" },
  { id: "d", yTrue: 1, yPred: null, status: "ambiguous" },
  { id: "e", yTrue: null, yPred: 1, status: "accepted" }
];
const metrics = E.classificationMetrics(rows, 2, 1);
near(metrics.accuracy, 0.5); near(metrics.selectiveAccuracy, 2 / 3); near(metrics.coverage, 0.8);
near(metrics.balancedAccuracy, 0.5); near(metrics.macroF1, (2 / 3 + 0.5) / 2);
near(metrics.mcc, 2 / Math.sqrt(80));
assert.deepEqual(metrics.binary, { tp: 1, fn: 0, fp: 1, tn: 1, rejectedPositive: 1, rejectedNegative: 0 });
const probMetrics = E.classificationMetrics([
  { yTrue: 0, yPred: 0, probabilities: [0.8, 0.2], status: "accepted" },
  { yTrue: 1, yPred: 1, probabilities: [0.4, 0.6], status: "accepted" }
], 2, 1);
near(probMetrics.brier, 0.1); near(probMetrics.logLoss, -(Math.log(0.8) + Math.log(0.6)) / 2);
assert.equal(probMetrics.reliability.reduce((s, b) => s + b.n, 0), 2);

const regression = [{ id: "a", yTrue: 1, yPred: 2, baseline: 2 }, { id: "b", yTrue: 2, yPred: 0, baseline: 2 }, { id: "c", yTrue: 4, yPred: 4, baseline: 2 }, { id: "d", yTrue: 5, yPred: NaN, baseline: 2 }];
const rm = E.regressionMetrics(regression, 1);
near(rm.rmse, Math.sqrt(5 / 3)); near(rm.mae, 1); near(rm.medianAE, 1); near(rm.p90AE, 1.8); near(rm.p95AE, 1.9); near(rm.bias, -1 / 3); near(rm.toleranceRate, 2 / 3); near(rm.baselineSkill, 0);
assert.equal(rm.invalid, 1); near(rm.coverage, 0.75);
assert.equal(E.regressionMetrics([{ yTrue: 1, yPred: 2 }], null).r2, null);
assert.equal(E.regressionMetrics([{ yTrue: -1e308, yPred: 1e308 }], null).valid, 0);
const regResult = Core.runPipeline({ trainText: "name y x\na 1 1\nb 2 2\nc 3 3\n", verifyText: "name y x\nv 4 4\n", uspaceText: "x SIS_score=1\n", topText: "Rank RMSE MaxAE Feature_ID\n1 0 0 ( 1)\n", coeffText: "Model_ID, coefficients\n1 0 1\n" });
const regReport = E.evaluate(regResult, regResult.models[0], { tolerance: 0 });
assert.equal(regReport.metrics.rmse, 0); assert.equal(regReport.metrics.baselineSkill, 1); assert.equal(regReport.applicability.outside, 1);

// Reproducibility, percentile intervals, groups and undefined resamples.
const boot = E.bootstrap(rows, sample => E.classificationMetrics(sample, 2, 1), ["accuracy", "auc"], 100, 123);
assert.deepEqual(boot, E.bootstrap(rows, sample => E.classificationMetrics(sample, 2, 1), ["accuracy", "auc"], 100, 123));
assert.equal(boot.intervals.auc.validReplicates, 0);
assert.equal(boot.intervals.auc.low, null);
assert.equal(E.bootstrap(rows.map(r => ({ ...r, group: "same" })), () => ({}), [], 10, 1).unavailable.length > 0, true);

const bundle = { schemaVersion: 1, taskType: "regression", modelId: "frozen-v1", trainingIds: ["tr"], exchangeable: true, frozenBeforeCalibration: true, datasets: [
  { id: "cal", role: "calibration", rows: Array.from({ length: 9 }, (_, i) => ({ id: "c" + i, yTrue: i, yPred: 0 })) },
  { id: "test", role: "test", rows: [{ id: "t1", yTrue: 3, yPred: 0 }, { id: "t2", yTrue: 10, yPred: 0 }] }
] };
const imported = E.evaluateBundle(bundle, "test", { alpha: 0.1 });
assert.equal(imported.conformal.q, 8); near(imported.conformal.coverage, 0.5); assert.equal(imported.conformal.width, 16);
assert.equal(E.evaluateBundle(bundle, "test", { alpha: 0.01 }).conformal.unbounded, true);
assert.equal(E.evaluateBundle({ ...bundle, exchangeable: false }, "test").conformal.available, false);
const bad = structuredClone(bundle); bad.datasets[1].rows[0].id = "tr"; assert.throws(() => E.validateBundle(bad), /training/);
bad.datasets[1].rows[0].id = "c0"; assert.throws(() => E.validateBundle(bad), /disjoint/);
bad.datasets[1].rows[0].id = "t1"; bad.datasets[1].rows[0].yPred = "1"; assert.throws(() => E.validateBundle(bad), /numbers/);
const groups = structuredClone(bundle); groups.datasets.forEach(d => d.rows.forEach(r => r.group = "overlap")); assert.throws(() => E.validateBundle(groups), /Groups overlap/);
const folds = { schemaVersion: 1, taskType: "regression", modelId: "pipeline", trainingIds: [], datasets: [
  { id: "f1", role: "fold", trainingIds: ["b"], descriptorSelection: "within-fold", rows: [{ id: "a", yTrue: 1, yPred: 1 }] },
  { id: "f2", role: "fold", trainingIds: ["a"], descriptorSelection: "within-fold", rows: [{ id: "b", yTrue: 2, yPred: 3 }] }
] };
assert.deepEqual(E.evaluateBundle(folds, "f1").folds.map(f => f.metrics.mae), [0, 1]);
folds.datasets[0].trainingIds.push("a"); assert.throws(() => E.validateBundle(folds), /training/);
const sets = E.conformal(Array.from({ length: 9 }, (_, i) => ({ yTrue: i % 2, probabilities: [0.5, 0.5] })), [{ id: "t", yTrue: 1, probabilities: [0.9, 0.1] }], "classification", 2, 0.1);
assert.deepEqual(sets.rows[0].set, [0]); assert.equal(sets.coverage, 0);
assert.match(E.csv({ rows: [{ id: "=formula", correct: false, yPred: 0 }] }), /'=formula/);
assert.throws(() => E.config({ bootstrap: 2001 }), /Bootstrap/);
console.log("PASS evaluation: geometry, leakage, ranking ties, abstention denominators, regression diagnostics, bootstrap, imports, folds and conformal");
