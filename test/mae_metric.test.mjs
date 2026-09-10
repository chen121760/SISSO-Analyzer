// mae_metric.test.mjs — MAE (mean absolute error) as a first-class metric.
//
// MAE is computed by the engine's single metrics routine (computeMetrics) and
// therefore reaches every surface that reads a metric key: table columns,
// numeric filters, sort keys, the Δ train→validation gap, the Pareto axes, the
// Compare table, the batch copy text and the detail dialog. Nothing recomputes
// it per view.
//
// Conventions verified here:
//   MAE       = mean(|pred − true|)        per dataset, from the same stored
//                                          predictions + target column as
//                                          RMSE / MaxAE / R² / ρ
//   MAE ≤ RMSE ≤ MaxAE                     for any residual series
//   ΔMAE      = MAE_verify − MAE_train     positive ⇒ validation worse
//                                          (same direction as ΔRMSE)
//   train-only run ⇒ ΔMAE = NaN
//
// Run: node test/mae_metric.test.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");
const demoData = require("../js/demo-data.js").DEMO_DATA;

let failures = 0;
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}
function assertNear(actual, expected, eps, label) {
  const pass = Math.abs(actual - expected) <= eps;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${actual}, want ~${expected}`);
}
function assertNaN(v, label) {
  const pass = Number.isNaN(v);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${v}, want NaN`);
}

function runPipeline(withVerify) {
  return core.runPipeline({
    trainText: demoData.train,
    verifyText: withVerify ? demoData.verify : undefined,
    topText: demoData.top,
    coeffText: demoData.coeff,
    uspaceText: demoData.uspace,
  });
}

// Independent MAE: recomputed from the model's stored predictions and the
// target column of the dataset — the same inputs the engine's own metrics use.
function naiveMae(data, pred, targetLetter) {
  const y = data.cols[targetLetter];
  const n = Math.min(y.length, pred.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(pred[i] - y[i]);
  return sum / n;
}

// ---------------------------------------------------------------------------
// 1. train MAE: exact value, and the MAE ≤ RMSE ≤ MaxAE ordering
// ---------------------------------------------------------------------------
{
  const res = runPipeline(false);
  const letter = res.meta.targetLetter;
  let valueOk = true, orderOk = true, finiteOk = true;
  for (const m of res.models) {
    const want = naiveMae(res.train, m.predTrain, letter);
    const got = m.metricsTrain.mae;
    if (!Number.isFinite(got)) finiteOk = false;
    if (!(Math.abs(got - want) <= 1e-12)) valueOk = false;
    if (!(got <= m.metricsTrain.rmse + 1e-12 && m.metricsTrain.rmse <= m.metricsTrain.maxae + 1e-12)) {
      orderOk = false;
    }
  }
  assert(finiteOk, `train-only run: MAE finite for all ${res.models.length} models`);
  assert(valueOk, "MAE == mean(|pred − true|) recomputed from the stored predictions");
  assert(orderOk, "MAE ≤ RMSE ≤ MaxAE on every model");
  const m0 = res.models[0];
  assertNear(core.metricValue(m0, "train", "mae"), m0.metricsTrain.mae, 1e-12,
    "metricValue(train, mae) == metricsTrain.mae");
  assertNaN(core.metricValue(m0, "verify", "mae"), "train-only run: metricValue(verify, mae) is NaN");
}

// ---------------------------------------------------------------------------
// 2. verify MAE: same definition on the validation dataset
// ---------------------------------------------------------------------------
{
  const res = runPipeline(true);
  const letter = res.meta.targetLetter;
  let valueOk = true, orderOk = true, finiteOk = true;
  for (const m of res.models) {
    const want = naiveMae(res.verify, m.predVerify, letter);
    const got = m.metricsVerify.mae;
    if (!Number.isFinite(got)) finiteOk = false;
    if (!(Math.abs(got - want) <= 1e-12)) valueOk = false;
    if (!(got <= m.metricsVerify.rmse + 1e-12 && m.metricsVerify.rmse <= m.metricsVerify.maxae + 1e-12)) {
      orderOk = false;
    }
  }
  assert(finiteOk, `train+verify run: verify MAE finite for all ${res.models.length} models`);
  assert(valueOk, "verify MAE == mean(|pred − true|) on the verify dataset");
  assert(orderOk, "verify MAE ≤ RMSE ≤ MaxAE on every model");
  const m0 = res.models[0];
  assertNear(core.metricValue(m0, "verify", "mae"), m0.metricsVerify.mae, 1e-12,
    "metricValue(verify, mae) == metricsVerify.mae");
}

// ---------------------------------------------------------------------------
// 3. ΔMAE: same sign convention as ΔRMSE (positive ⇒ validation worse)
// ---------------------------------------------------------------------------
{
  const res = runPipeline(true);
  const m0 = res.models[0];
  assertNear(core.metricValue(m0, "delta", "mae"),
    m0.metricsVerify.mae - m0.metricsTrain.mae, 1e-12, "ΔMAE = MAE_verify − MAE_train");
  let contractOk = true;
  for (const m of res.models) {
    const t = m.metricsTrain && m.metricsTrain.mae;
    const v = m.metricsVerify && m.metricsVerify.mae;
    const d = core.metricValue(m, "delta", "mae");
    // ΔMAE follows the same direction as ΔRMSE, so a model whose validation
    // MAE is worse than its train MAE must show a positive gap.
    if (!(Math.abs(d - (v - t)) <= 1e-12)) contractOk = false;
  }
  assert(contractOk, "every demo model: ΔMAE == MAE_verify − MAE_train");
  const trainOnly = runPipeline(false).models[0];
  assertNaN(core.metricValue(trainOnly, "delta", "mae"), "train-only run ⇒ ΔMAE NaN");
}

// ---------------------------------------------------------------------------
// 4. plumbing: MAE is reachable through the shared metric surfaces
// ---------------------------------------------------------------------------
{
  const res = runPipeline(true);
  const models = res.models.slice(0, 3);
  const rows = core.compareMetricRows(models);
  const trainMae = rows.find((r) => r.dataset === "train" && r.metric === "mae");
  const verifyMae = rows.find((r) => r.dataset === "verify" && r.metric === "mae");
  assert(!!trainMae, "Compare table has a train MAE row");
  assert(!!verifyMae, "Compare table has a verify MAE row");
  let aligned = true;
  models.forEach((m, i) => {
    if (trainMae.values[i] !== m.metricsTrain.mae) aligned = false;
  });
  assert(aligned, "Compare MAE row matches each model's metricsTrain.mae");
  // MAE is smaller-is-better, so a missing value sorts to the worst endpoint.
  assert(core.metricSortEndpoint("mae", "train") === Infinity, "missing train MAE → +Infinity");
  assert(core.metricSortEndpoint("mae", "delta") === Infinity, "missing ΔMAE → +Infinity");
  // MAE never displaces the historical default Pareto axes.
  assert(JSON.stringify(core.paretoDefaultAxes(["train"], 3)) === JSON.stringify([
    { dataset: "train", metric: "rmse" },
    { dataset: "train", metric: "maxae" },
    { dataset: "train", metric: "r2" },
  ]), "MAE keeps the default Pareto axes unchanged");
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
