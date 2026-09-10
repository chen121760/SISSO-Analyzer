// delta_metrics.test.mjs — train → validation generalization-gap metrics.
//
// The Δ metrics share ONE definition implemented in the engine accessor
// (Core.metricValue(model, "delta", key)); the table cells, the numeric
// filter, the sorters and the Pareto axes all read through it, so a value is
// never computed twice in different places.
//
// Conventions verified here:
//   ΔRMSE  = RMSE_verify − RMSE_train
//   ΔMAE   = MAE_verify − MAE_train
//   ΔMaxAE = MaxAE_verify − MaxAE_train
//   ΔR²    = R²_train − R²_verify
//   Δρ     = ρ_train − ρ_verify
// i.e. positive always means validation performed worse than training, and a
// smaller value (closer to 0 / negative) is better. A train-only run (or a
// model without metricsVerify) has NO delta — metricValue returns NaN.
//
// Run: node test/delta_metrics.test.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");
const demoData = require("../js/demo-data.js").DEMO_DATA;

let failures = 0;
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}
function assertEq(actual, expected, label) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${actual}, want ${expected}`);
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

// Synthetic model with known train / verify numbers.
function fakeModel(train, verify) {
  return {
    rank: 1,
    metricsTrain: train ? {
      rmse: 1.0, mae: 1.25, maxae: 2.0, r2: 0.8, rho: 0.7,
    } : null,
    metricsVerify: verify ? {
      rmse: 1.5, mae: 1.75, maxae: 2.5, r2: 0.6, rho: 0.5,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// 1. delta VALUES: the five formulas, sign convention positive = worse
// ---------------------------------------------------------------------------
{
  const m = fakeModel(true, true); // verify worse on every metric
  assertNear(core.metricValue(m, "delta", "rmse"), 1.5 - 1.0, 1e-12, "ΔRMSE = verify − train");
  assertNear(core.metricValue(m, "delta", "mae"), 1.75 - 1.25, 1e-12, "ΔMAE = verify − train");
  assertNear(core.metricValue(m, "delta", "maxae"), 2.5 - 2.0, 1e-12, "ΔMaxAE = verify − train");
  assertNear(core.metricValue(m, "delta", "r2"), 0.8 - 0.6, 1e-12, "ΔR² = train − verify (positive ⇒ worse)");
  assertNear(core.metricValue(m, "delta", "rho"), 0.7 - 0.5, 1e-12, "Δρ = train − verify (positive ⇒ worse)");
  const v = core.metricValue(m, "delta", "rmse");
  assert(v > 0, "sign: verify-worse ⇒ positive Δ");
}
{
  // verify better than train ⇒ negative Δ across the board
  const m = fakeModel(true, true);
  m.metricsVerify = { rmse: 0.6, mae: 0.8, maxae: 1.2, r2: 0.95, rho: 0.92 };
  assert(core.metricValue(m, "delta", "rmse") < 0, "verify-better ⇒ negative ΔRMSE");
  assert(core.metricValue(m, "delta", "r2") < 0, "verify-better ⇒ negative ΔR²");
}
{
  // equal ⇒ zero
  const m = fakeModel(true, true);
  m.metricsVerify = { rmse: 1.0, mae: 1.25, maxae: 2.0, r2: 0.8, rho: 0.7 };
  assertEq(core.metricValue(m, "delta", "rmse"), 0, "equal train/verify ⇒ Δ = 0");
  assertEq(core.metricValue(m, "delta", "r2"), 0, "equal train/verify ⇒ ΔR² = 0");
}

// ---------------------------------------------------------------------------
// 2. no-validation cases: delta undefined (NaN), no crash anywhere
// ---------------------------------------------------------------------------
{
  const m = fakeModel(true, false);
  assertNaN(core.metricValue(m, "delta", "rmse"), "train-only model ⇒ ΔRMSE NaN");
  assertNaN(core.metricValue(m, "delta", "mae"), "train-only model ⇒ ΔMAE NaN");
  assertNaN(core.metricValue(m, "delta", "r2"), "train-only model ⇒ ΔR² NaN");
  assertNaN(core.metricValue(m, "delta", "rho"), "train-only model ⇒ Δρ NaN");
}
{
  const m = fakeModel(false, false);
  assertNaN(core.metricValue(m, "delta", "rmse"), "no metrics at all ⇒ NaN, no throw");
}
{
  // missing single metric inside an otherwise present metrics object
  const m = fakeModel(true, true);
  m.metricsVerify = { rmse: 1.5, maxae: 2.5, r2: 0.6 }; // rho absent
  assertNaN(core.metricValue(m, "delta", "rho"), "missing verify metric ⇒ NaN, no throw");
}
{
  // real pipeline: train-only run ⇒ every delta is NaN and everything else
  // (train metrics, pareto-friendly accessor) still works
  const res = core.runPipeline({
    trainText: demoData.train,
    topText: demoData.top,
    coeffText: demoData.coeff,
    uspaceText: demoData.uspace,
  });
  let ok = true;
  for (const mm of res.models) {
    if (!Number.isNaN(core.metricValue(mm, "delta", "rmse"))) ok = false;
    if (Number.isNaN(core.metricValue(mm, "train", "rmse"))) ok = false;
  }
  assert(ok, `train-only run: ${res.models.length} models have Δ=NaN but train metrics intact`);
}

// ---------------------------------------------------------------------------
// 3. demo run with verify: deltas are finite and follow the definitions
// ---------------------------------------------------------------------------
{
  const res = core.runPipeline({
    trainText: demoData.train,
    verifyText: demoData.verify,
    topText: demoData.top,
    coeffText: demoData.coeff,
    uspaceText: demoData.uspace,
  });
  const m0 = res.models[0];
  const exp = {
    rmse: m0.metricsVerify.rmse - m0.metricsTrain.rmse,
    mae: m0.metricsVerify.mae - m0.metricsTrain.mae,
    maxae: m0.metricsVerify.maxae - m0.metricsTrain.maxae,
    r2: m0.metricsTrain.r2 - m0.metricsVerify.r2,
    rho: m0.metricsTrain.rho - m0.metricsVerify.rho,
  };
  assertNear(core.metricValue(m0, "delta", "rmse"), exp.rmse, 1e-12, "demo ΔRMSE == verify − train");
  assertNear(core.metricValue(m0, "delta", "mae"), exp.mae, 1e-12, "demo ΔMAE == verify − train");
  assertNear(core.metricValue(m0, "delta", "maxae"), exp.maxae, 1e-12, "demo ΔMaxAE == verify − train");
  assertNear(core.metricValue(m0, "delta", "r2"), exp.r2, 1e-12, "demo ΔR² == train − verify");
  assertNear(core.metricValue(m0, "delta", "rho"), exp.rho, 1e-12, "demo Δρ == train − verify");
  let contractOk = true;
  for (const mm of res.models) {
    ["rmse", "mae", "maxae", "r2", "rho"].forEach((k) => {
      const t = mm.metricsTrain && mm.metricsTrain[k];
      const v = mm.metricsVerify && mm.metricsVerify[k];
      const d = core.metricValue(mm, "delta", k);
      const expectFinite = Number.isFinite(t) && Number.isFinite(v);
      if (expectFinite !== Number.isFinite(d)) contractOk = false;
    });
  }
  assert(contractOk, `all ${res.models.length} demo models: Δ finite ⇔ both train & verify metric finite`);
}

// ---------------------------------------------------------------------------
// 4. sorting direction — the smaller (more negative) the gap, the better.
//    Ascending sort of the numeric key equals "best gap first"; NaN (missing
//    verify) must never appear inside the sorted range, so endpoints put it on
//    the metric's worst side.
// ---------------------------------------------------------------------------
{
  const good = fakeModel(true, true); // ΔRMSE = +0.5
  const bad = fakeModel(true, true);  // make verify much worse
  bad.metricsVerify = { rmse: 3.0, mae: 3.4, maxae: 4.0, r2: 0.2, rho: 0.1 };
  const noV = fakeModel(true, false);
  const keys = ["rmse", "mae", "maxae", "r2", "rho"];
  keys.forEach((k) => {
    const goodV = core.metricValue(good, "delta", k);
    const badV = core.metricValue(bad, "delta", k);
    assert(badV > goodV, `${k}: worse gap sorts after better gap (ascending)`);
  });
  // Ascending sort semantics of the UI comparator:
  const asc = (va, vb) => (va < vb ? -1 : va > vb ? 1 : 0);
  assert(asc(core.metricValue(good, "delta", "rmse"), core.metricValue(bad, "delta", "rmse")) === -1,
    "ΔRMSE ascending: better (smaller) model first");
  assert(asc(core.metricValue(good, "delta", "r2"), core.metricValue(bad, "delta", "r2")) === -1,
    "ΔR² ascending: better (smaller) model first");
  // Missing values use deterministic worst-side endpoints:
  keys.forEach((k) => {
    assertEq(core.metricSortEndpoint(k, "delta"), Infinity, `delta ${k} missing → +Infinity (worst)`);
  });
  assertEq(core.metricSortEndpoint("rmse", "train"), Infinity, "train rmse missing → +Infinity");
  assertEq(core.metricSortEndpoint("mae", "train"), Infinity, "train mae missing → +Infinity");
  assertEq(core.metricSortEndpoint("r2", "train"), -Infinity, "train r2 missing → −Infinity");
  assertEq(core.metricSortEndpoint("rho", "train"), 0, "train rho missing → 0 (existing behaviour)");
  // worst delta endpoint sorts strictly after any finite gap
  assert(core.metricSortEndpoint("rmse", "delta") > core.metricValue(good, "delta", "rmse"),
    "missing gap sorts after finite worse gap");
  // sanity: compareMetricRows (used by the Compare view) still works with the
  // same accessor and is not confused by the delta pseudo-dataset.
  const rows = core.compareMetricRows([good, bad]);
  assert(rows.some((r) => r.dataset === "verify" && r.metric === "rmse"), "compare rows unaffected by delta support");
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
