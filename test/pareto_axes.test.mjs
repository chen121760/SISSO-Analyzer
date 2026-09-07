// pareto_axes.test.mjs — regression tests for the (dataset, metric) Pareto
// axis abstraction.
//
// The Pareto UI now treats every axis as { dataset, metric }, where the
// datasets are the ones actually present in the loaded run ("train" always,
// "verify" only when a verify file was analysed). The engine keeps its
// metricsTrain / metricsVerify fields; SissoCore.metricValue /
// availableDatasets / paretoDefaultAxes / paretoAxesDistinct are the shared
// primitives the UI and the CSV export build on. This file verifies:
//
//   1. dataset detection: train-only runs expose only "train"
//   2. the unified metric accessor reads the right per-dataset slot
//   3. deterministic, duplicate-free default axes
//   4. duplicate-axis detection
//   5. full-run consistency for Train-only + Train+Verify runs in 2D and 3D,
//      including same-dataset axes (Train RMSE × Train MaxAE) and maximize
//      directions, cross-checked against an independent front oracle
//
// Run: node test/pareto_axes.test.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");
const demoData = require("../js/demo-data.js").DEMO_DATA;

let failures = 0;
function check(label, actual, expected, tol = 1e-12) {
  const pass = Math.abs(actual - expected) <= tol;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${actual}, want ${expected} (tol ${tol})`);
}
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}
function assertEqStr(actual, expected, label) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    console.log(`    --- actual ---\n${String(actual)}\n    --- expected ---\n${String(expected)}`);
  }
}

// Two runs of the same demo data: with and without a verify file.
const resBoth = core.runPipeline({
  trainText: demoData.train,
  verifyText: demoData.verify,
  topText: demoData.top,
  coeffText: demoData.coeff,
  uspaceText: demoData.uspace,
});
const resTrain = core.runPipeline({
  trainText: demoData.train,
  // no verifyText — a train-only project
  topText: demoData.top,
  coeffText: demoData.coeff,
  uspaceText: demoData.uspace,
});
console.log(
  `\ntrain+verify run: ${resBoth.meta.nModels} models (nVerify ${resBoth.meta.nVerify}) | ` +
  `train-only run: ${resTrain.meta.nModels} models (nVerify ${resTrain.meta.nVerify}, verify ${String(resTrain.verify)})`
);
assert(resBoth.meta.nVerify === 28 && resTrain.meta.nVerify === 0, "meta.nVerify differs as expected");
assert(resTrain.verify === null, "train-only result has no verify object");

// ---------------------------------------------------------------------------
// 1. availableDatasets
// ---------------------------------------------------------------------------
assertEqStr(core.availableDatasets(resTrain).join(","), "train", "train-only datasets = [train]");
assertEqStr(core.availableDatasets(resBoth).join(","), "train,verify", "train+verify datasets = [train,verify]");
assertEqStr(core.availableDatasets(null).join(","), "train", "null result still offers train");

// ---------------------------------------------------------------------------
// 2. metricValue — one accessor over the existing metricsTrain/metricsVerify
// ---------------------------------------------------------------------------
{
  const m = resTrain.models[0];
  check("train-only: metricValue(train, rmse) == metricsTrain.rmse",
    core.metricValue(m, "train", "rmse"), m.metricsTrain.rmse);
  assert(Number.isNaN(core.metricValue(m, "verify", "rmse")),
    "train-only: metricValue(verify, rmse) is NaN");
  assert(Number.isNaN(core.metricValue(m, "train", "nope")),
    "unknown metric -> NaN");
  const mb = resBoth.models[0];
  check("train+verify: metricValue(verify, rmse) == metricsVerify.rmse",
    core.metricValue(mb, "verify", "rmse"), mb.metricsVerify.rmse);
  check("train+verify: metricValue(train, r2) == metricsTrain.r2",
    core.metricValue(mb, "train", "r2"), mb.metricsTrain.r2);
}

// ---------------------------------------------------------------------------
// 3. paretoDefaultAxes — deterministic, duplicate-free
// ---------------------------------------------------------------------------
{
  assertEqStr(
    JSON.stringify(core.paretoDefaultAxes(["train"], 2)),
    JSON.stringify([
      { dataset: "train", metric: "rmse" },
      { dataset: "train", metric: "maxae" },
    ]),
    "defaults(train-only, 2D) = RMSE × MaxAE on train"
  );
  assertEqStr(
    JSON.stringify(core.paretoDefaultAxes(["train", "verify"], 2)),
    JSON.stringify([
      { dataset: "train", metric: "rmse" },
      { dataset: "verify", metric: "rmse" },
    ]),
    "defaults(train+verify, 2D) = train RMSE × verify RMSE"
  );
  assertEqStr(
    JSON.stringify(core.paretoDefaultAxes(["train"], 3)),
    JSON.stringify([
      { dataset: "train", metric: "rmse" },
      { dataset: "train", metric: "maxae" },
      { dataset: "train", metric: "r2" },
    ]),
    "defaults(train-only, 3D) are distinct train metrics"
  );
  assert(core.paretoAxesDistinct(core.paretoDefaultAxes(["train"], 3)), "train-only 3D defaults distinct");
  assert(core.paretoAxesDistinct(core.paretoDefaultAxes(["train", "verify"], 3)), "train+verify 3D defaults distinct");
}

// ---------------------------------------------------------------------------
// 4. paretoAxesEqual / paretoAxesDistinct
// ---------------------------------------------------------------------------
{
  assert(core.paretoAxesEqual({ dataset: "train", metric: "rmse" }, { dataset: "train", metric: "rmse" }),
    "same dataset+metric -> equal");
  assert(!core.paretoAxesEqual({ dataset: "train", metric: "rmse" }, { dataset: "train", metric: "maxae" }),
    "same dataset, different metric -> not equal");
  assert(!core.paretoAxesEqual({ dataset: "train", metric: "rmse" }, { dataset: "verify", metric: "rmse" }),
    "same metric, different dataset -> not equal (Train RMSE vs Verify RMSE is allowed)");
  assert(core.paretoAxesDistinct([
    { dataset: "train", metric: "rmse" },
    { dataset: "train", metric: "maxae" },
    { dataset: "verify", metric: "rmse" },
  ]), "distinct axes accepted");
  assert(!core.paretoAxesDistinct([
    { dataset: "train", metric: "rmse" },
    { dataset: "verify", metric: "maxae" },
    { dataset: "train", metric: "rmse" },
  ]), "duplicate axis rejected");
}

// ---------------------------------------------------------------------------
// Independent naive front oracles (no shared code with the engine helpers).
// ---------------------------------------------------------------------------
function dominates2D(p, q, minX, minY) {
  const sx = (minX ? q.x : -q.x) - (minX ? p.x : -p.x);
  const sy = (minY ? q.y : -q.y) - (minY ? p.y : -p.y);
  return sx <= 0 && sy <= 0 && (sx < 0 || sy < 0);
}
function dominates3D(p, q, minX, minY, minZ) {
  const sx = (minX ? q.x : -q.x) - (minX ? p.x : -p.x);
  const sy = (minY ? q.y : -q.y) - (minY ? p.y : -p.y);
  const sz = (minZ ? q.z : -q.z) - (minZ ? p.z : -p.z);
  return sx <= 0 && sy <= 0 && sz <= 0 && (sx < 0 || sy < 0 || sz < 0);
}
function oracleFrontRanks(pts, dominates) {
  const out = new Set();
  for (const p of pts) {
    let dom = false;
    for (const q of pts) {
      if (q.rank !== p.rank && dominates(p, q)) { dom = true; break; }
    }
    if (!dom) out.add(p.rank);
  }
  return out;
}

// Re-implements the UI's point membership rule through the shared accessor:
// a model is plotted when every axis' metric value is finite.
function collect(res, defs) {
  const pts = [];
  for (const m of res.models) {
    const pt = { rank: m.rank, m };
    let ok = true;
    for (const d of defs) {
      const v = core.metricValue(m, d.dataset, d.metric);
      if (!Number.isFinite(v)) { ok = false; break; }
      pt[d.code] = v;
    }
    if (ok) pts.push(pt);
  }
  return pts;
}

function axesFor(defs) {
  return defs.map((d) => ({ code: d.code, dataset: d.dataset, metric: d.metric }));
}

// ---------------------------------------------------------------------------
// 5. Train-only run, 2D: Train RMSE × Train MaxAE
// ---------------------------------------------------------------------------
{
  const defs = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "train", metric: "maxae" },
  ];
  const pts = collect(resTrain, defs);
  const front = core.paretoFront2D(pts, true, true); // both minimize
  const rows = core.paretoExportRows(pts, [], front, axesFor(defs));

  assert(rows.length - 1 === resTrain.models.length,
    `train-only: every model has finite train RMSE/MaxAE -> ${rows.length - 1} rows`);
  assertEqStr(rows[0].join("|"),
    "rank|formula|x_dataset|x_metric|x_value|y_dataset|y_metric|y_value|is_pareto|excluded",
    "train-only 2D export header");

  const oracle = oracleFrontRanks(pts, (p, q) => dominates2D(p, q, true, true));
  const engineSet = new Set(front.map((p) => p.rank));
  assertEqStr([...oracle].sort().join(","), [...engineSet].sort().join(","),
    "train-only engine front == naive oracle");

  let flagsOk = true, valuesOk = true, formulasOk = true;
  const byRank = {};
  for (const p of pts) byRank[p.rank] = p;
  for (const r of rows.slice(1)) {
    const p = byRank[r[0]];
    const isFront = oracle.has(r[0]);
    if (r[8] !== (isFront ? 1 : 0) || r[9] !== 0) flagsOk = false;
    if (r[2] !== "train" || r[5] !== "train" || r[3] !== "rmse" || r[6] !== "maxae") valuesOk = false;
    if (r[1] !== p.m.formulaOriginal) formulasOk = false;
  }
  assert(flagsOk, "train-only is_pareto/excluded flags match oracle (no ghosts)");
  assert(valuesOk, "train-only export dataset/metric tokens are train/train");
  assert(formulasOk, "train-only export formulas match models");
  console.log(`   -> ${rows.length - 1} rows, ${front.length} on the front`);
}

// ---------------------------------------------------------------------------
// 6. Train+Verify run, 2D: maximize directions and same-dataset axes
//    (x = Train R2 ↑, y = Verify Spearman rho ↑)
// ---------------------------------------------------------------------------
{
  const defs = [
    { code: "x", dataset: "train", metric: "r2" },
    { code: "y", dataset: "verify", metric: "rho" },
  ];
  const pts = collect(resBoth, defs);
  const front = core.paretoFront2D(pts, false, false); // both maximize
  const rows = core.paretoExportRows(pts, [], front, axesFor(defs));
  const oracle = oracleFrontRanks(pts, (p, q) => dominates2D(p, q, false, false));
  const engineSet = new Set(front.map((p) => p.rank));

  assertEqStr([...oracle].sort().join(","), [...engineSet].sort().join(","),
    "train+verify 2D (r2/rho maximize) engine front == naive oracle");
  assert(rows.length - 1 === pts.length, `train+verify 2D exports all finite points (${rows.length - 1})`);
  let ok = true;
  for (const r of rows.slice(1)) {
    if (r[2] !== "train" || r[3] !== "r2" || r[5] !== "verify" || r[6] !== "rho") ok = false;
    if (r[8] !== (oracle.has(r[0]) ? 1 : 0)) ok = false;
  }
  assert(ok, "train+verify 2D tokens and flags correct");
  console.log(`   -> ${rows.length - 1} rows, ${front.length} on the front`);
}

// Same-dataset axes on the full run: Train RMSE × Train MaxAE also works when
// a verify file IS present (datasets are user choice, not forced).
{
  const defs = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "train", metric: "maxae" },
  ];
  const pts = collect(resBoth, defs);
  const front = core.paretoFront2D(pts, true, true);
  const rows = core.paretoExportRows(pts, [], front, axesFor(defs));
  const oracle = oracleFrontRanks(pts, (p, q) => dominates2D(p, q, true, true));
  const engineSet = new Set(front.map((p) => p.rank));
  assertEqStr([...oracle].sort().join(","), [...engineSet].sort().join(","),
    "train×train axes on full run == naive oracle");
  assert(rows.length - 1 === pts.length, "train×train axes export all plotted points");
  assert(rows[0][2] === "x_dataset" && rows[0][5] === "y_dataset" && rows[0][3] === "x_metric" &&
    rows[0][6] === "y_metric", "train×train header still generic");
  console.log(`   -> ${rows.length - 1} rows, ${front.length} on the front`);
}

// ---------------------------------------------------------------------------
// 7. Train-only + Train+Verify, 3D
// ---------------------------------------------------------------------------
{
  // 3D on a train-only run: three different train metrics, one maximize (r2).
  const defs3t = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "train", metric: "maxae" },
    { code: "z", dataset: "train", metric: "r2" },
  ];
  const pts3t = collect(resTrain, defs3t);
  const front3t = core.paretoFront3D(pts3t, true, true, false);
  const rows3t = core.paretoExportRows(pts3t, [], front3t, axesFor(defs3t));
  const oracle3t = oracleFrontRanks(pts3t, (p, q) => dominates3D(p, q, true, true, false));
  const engineSet3t = new Set(front3t.map((p) => p.rank));
  assertEqStr([...oracle3t].sort().join(","), [...engineSet3t].sort().join(","),
    "train-only 3D (all-train axes) engine front == naive oracle");
  assert(rows3t.length - 1 === pts3t.length, `train-only 3D exports all points (${rows3t.length - 1})`);
  assert(rows3t[0][8] === "z_dataset" && rows3t[0][9] === "z_metric" && rows3t[0][10] === "z_value",
    "train-only 3D header has the z triple");
  let zOk = true;
  for (const r of rows3t.slice(1)) {
    if (r[8] !== "train" || r[9] !== "r2") zOk = false;
    if (r[11] !== (oracle3t.has(r[0]) ? 1 : 0)) zOk = false;
  }
  assert(zOk, "train-only 3D z tokens and is_pareto flags correct");
  console.log(`   -> ${rows3t.length - 1} rows, ${front3t.length} on the front (train-only 3D)`);

  // 3D on the full run mixing datasets: x train RMSE (min), y verify MaxAE
  // (min), z verify Spearman rho (max).
  const defs3 = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "verify", metric: "maxae" },
    { code: "z", dataset: "verify", metric: "rho" },
  ];
  const pts3 = collect(resBoth, defs3);
  const front3 = core.paretoFront3D(pts3, true, true, false);
  const rows3 = core.paretoExportRows(pts3, [], front3, axesFor(defs3));
  const oracle3 = oracleFrontRanks(pts3, (p, q) => dominates3D(p, q, true, true, false));
  const engineSet3 = new Set(front3.map((p) => p.rank));
  assertEqStr([...oracle3].sort().join(","), [...engineSet3].sort().join(","),
    "train+verify 3D (mixed datasets) engine front == naive oracle");
  assert(rows3.length - 1 === pts3.length, `train+verify 3D exports all points (${rows3.length - 1})`);
  let mixedOk = true;
  for (const r of rows3.slice(1)) {
    if (r[8] !== "verify" || r[9] !== "rho") mixedOk = false;
    if (r[11] !== (oracle3.has(r[0]) ? 1 : 0) || r[12] !== 0) mixedOk = false;
  }
  assert(mixedOk, "train+verify 3D mixed z tokens and flags correct");
  console.log(`   -> ${rows3.length - 1} rows, ${front3.length} on the front (mixed 3D)`);
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
