// model_state_compare.test.mjs — favourite / exclude state + Compare data.
//
// The UI keeps per-model favourite/excluded flags in ONE map that rides on the
// pipeline result (state.result.modelStates); it is serialized into saved
// projects and restored by applyProject. This file verifies the shared
// engine-level primitives those flows are built on:
//   1. state normalization (old projects, legacy flag aliases, stale ranks)
//   2. compact serialization + round-trip
//   3. modelExcluded / modelFavorite read the map
//   4. compareMetricRows == metricValue cell-for-cell (train & train+verify)
//   5. compareSampleMatrix == the pipeline's own predictions/errors, aligned
//      per model, and null when the dataset is absent
//
// Run: node test/model_state_compare.test.mjs
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
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assertDeep(actual, expected, label) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}

const resBoth = core.runPipeline({
  trainText: demoData.train,
  verifyText: demoData.verify,
  topText: demoData.top,
  coeffText: demoData.coeff,
  uspaceText: demoData.uspace,
});
const resTrain = core.runPipeline({
  trainText: demoData.train,
  topText: demoData.top,
  coeffText: demoData.coeff,
  uspaceText: demoData.uspace,
});
const ranks = new Set(resBoth.models.map((m) => m.rank));
const m1 = resBoth.models[0];

// ---------------------------------------------------------------------------
// 1. normalization
// ---------------------------------------------------------------------------
assertEq(Object.keys(core.normalizeModelStates(null)).length, 0, "null state -> empty map");
assertEq(Object.keys(core.normalizeModelStates(undefined)).length, 0, "undefined state -> empty map");
assertEq(Object.keys(core.normalizeModelStates({})).length, 0, "empty object -> empty map");
{
  // legacy aliases (fav/hidden) and numeric-string keys are accepted
  const st = core.normalizeModelStates({
    "1": { fav: true },
    "2": { hidden: true },
    3: { favorite: true, excluded: false },
    4: { excluded: true },
  });
  assert(st[1].favorite === true && st[1].excluded === false, "legacy 'fav' maps to favorite");
  assert(st[2].excluded === true && st[2].favorite === false, "legacy 'hidden' maps to excluded");
  assert(st[3].favorite === true, "numeric-key entry with favorite");
  assert(st[4].excluded === true, "numeric-key entry with excluded");
  assert(st[5] === undefined, "missing rank not created");
}
{
  const dirty = core.normalizeModelStates({ "0": { favorite: true }, "-3": { excluded: true }, "abc": { favorite: true } });
  assertEq(Object.keys(dirty).length, 0, "invalid ranks are dropped");
  const junk = core.normalizeModelStates({ 1: { favorite: "yes" }, 2: "boom", 3: { favorite: true } });
  assert(junk[1].favorite === true, "truthy favorite flag is enabled (boolean-coerced)");
  assert(junk[2] === undefined, "non-object entry dropped");
  assert(junk[3].favorite === true, "clean entry survives junk");
}
{
  // ranks that no longer exist are pruned (project files changed between saves)
  const st = core.normalizeModelStates({ 1: { favorite: true }, 999: { excluded: true } },
    new Set([1, 2]));
  assertEq(Object.keys(st).join(","), "1", "stale ranks pruned by validRanks");
}

// ---------------------------------------------------------------------------
// 2. compact serialization + round trip
// ---------------------------------------------------------------------------
{
  const states = core.normalizeModelStates(null);
  states[1] = { favorite: true, excluded: false };
  states[5] = { favorite: false, excluded: true };
  states[7] = { favorite: false, excluded: false };
  const json = core.modelStatesToJSON(states);
  assertEq(Object.keys(json).join(","), "1,5", "only touched flags are serialized");
  assert(json[1].favorite === true && json[1].excluded === undefined, "favorite-only compact entry");
  const back = core.normalizeModelStates(json, new Set([1, 5, 7, 8]));
  assert(back[1].favorite && !back[1].excluded, "round trip keeps favorite");
  assert(back[5].excluded && !back[5].favorite, "round trip keeps excluded");
  assert(back[7] === undefined, "untouched model stays untouchable after round trip");
  // old-style project without the section
  assertEq(Object.keys(core.normalizeModelStates(undefined, ranks)).length, 0,
    "old project (no modelStates) loads with nothing flagged");
}

// ---------------------------------------------------------------------------
// 3. helpers read the map (this is the single source the UI toggles write to)
// ---------------------------------------------------------------------------
{
  const states = core.normalizeModelStates(null);
  states[1] = { favorite: true, excluded: false };
  states[2] = { favorite: false, excluded: true };
  const a = resBoth.models[0];   // rank 1
  const b = resBoth.models[1];   // rank 2
  assert(core.modelFavorite(states, a) === true, "modelFavorite true");
  assert(core.modelFavorite(states, b) === false, "modelFavorite false");
  assert(core.modelExcluded(states, b) === true, "modelExcluded true");
  assert(core.modelExcluded(states, a) === false, "modelExcluded false");
  // un-exclude = write false back to the same map
  states[2].excluded = false;
  assert(core.modelExcluded(states, b) === false, "restoring an excluded model flips the flag back");
}

// ---------------------------------------------------------------------------
// 4. compareMetricRows == metricValue, for train-only and train+verify runs
// ---------------------------------------------------------------------------
function checkMetricRows(res) {
  const models = res.models.slice(0, 3);
  const rows = core.compareMetricRows(models);
  const expectVerify = !!models[0].metricsVerify;
  const expectN = (expectVerify ? 2 : 1) * 5;
  assertEq(rows.length, expectN, `${expectVerify ? "both" : "train-only"} metric row count`);
  let ok = true;
  for (const row of rows) {
    if (row.values.length !== models.length) ok = false;
    for (let i = 0; i < models.length; i++) {
      const want = core.metricValue(models[i], row.dataset, row.metric);
      const got = row.values[i];
      if (!(got === want || (Number.isNaN(got) && Number.isNaN(want)))) ok = false;
    }
  }
  assert(ok, `${expectVerify ? "both" : "train-only"} compareMetricRows matches metricValue`);
  assert(rows.every((r) => ["rmse", "mae", "maxae", "r2", "rho"].includes(r.metric)),
    "metric order is stable rmse/mae/maxae/r2/rho");
}
checkMetricRows(resTrain);
checkMetricRows(resBoth);

// ---------------------------------------------------------------------------
// 5. compareSampleMatrix == pipeline predictions/errors, aligned per model
// ---------------------------------------------------------------------------
{
  const models = [resBoth.models[0], resBoth.models[50], resBoth.models[100]];
  const mTrain = core.compareSampleMatrix(resBoth, models, "train");
  assert(mTrain && mTrain.rows.length === resBoth.meta.nTrain, "train sample rows == nTrain");
  const mVerify = core.compareSampleMatrix(resBoth, models, "verify");
  assert(mVerify && mVerify.rows.length === resBoth.meta.nVerify, "verify sample rows == nVerify");

  let trainOk = true, verifyOk = true;
  for (let i = 0; i < mTrain.rows.length; i++) {
    const row = mTrain.rows[i];
    for (let k = 0; k < models.length; k++) {
      const m = models[k];
      const pred = m.predTrain[i];
      const err = pred - row.target;
      const p = row.preds[k];
      if (p.rank !== m.rank || p.pred !== pred || Math.abs(p.error - err) > 1e-12) trainOk = false;
    }
  }
  assert(trainOk, "train compareSampleMatrix pred/error == pipeline arrays");
  for (let i = 0; i < mVerify.rows.length; i++) {
    const row = mVerify.rows[i];
    for (let k = 0; k < models.length; k++) {
      const m = models[k];
      const pred = m.predVerify[i];
      const err = pred - row.target;
      const p = row.preds[k];
      if (p.rank !== m.rank || p.pred !== pred || Math.abs(p.error - err) > 1e-12) verifyOk = false;
    }
  }
  assert(verifyOk, "verify compareSampleMatrix pred/error == pipeline arrays");
  assert(mTrain.rows[0].preds.length === models.length, "preds aligned with the compared models");
  // target values match the dataset's target column
  const dataT = resBoth.train;
  const yT = Array.from(dataT.cols[resBoth.meta.targetLetter]);
  assert(mTrain.rows[3].target === yT[3], "sample target == target column");

  // train-only run: verify sample matrix is unavailable; train works
  const tOnlyModels = [resTrain.models[0], resTrain.models[1]];
  assert(core.compareSampleMatrix(resTrain, tOnlyModels, "verify") === null,
    "train-only run returns null for the verify matrix");
  const tOnly = core.compareSampleMatrix(resTrain, tOnlyModels, "train");
  assert(tOnly && tOnly.rows.length === resTrain.meta.nTrain, "train-only run still builds a train matrix");
  assert(tOnly.rows[0].preds.length === 2, "train-only matrix aligned to the two models");
}

// ---------------------------------------------------------------------------
// 6. a realistic save -> toggle -> save -> load cycle for one project
// ---------------------------------------------------------------------------
{
  const saved = { modelStates: core.modelStatesToJSON(core.normalizeModelStates(null)) };
  const states = core.normalizeModelStates(saved.modelStates, ranks);
  states[1] = { favorite: true, excluded: false };
  states[42] = { favorite: true, excluded: false };
  saved.modelStates = core.modelStatesToJSON(states);
  // reopen the project: normalize against the same ranks
  const reopened = core.normalizeModelStates(saved.modelStates, ranks);
  assert(reopened[1].favorite === true && reopened[42].favorite === true,
    "favourites survive a save/reopen cycle");
  assertEq(Object.keys(saved.modelStates).length, 2, "compact saved project keeps only touched ranks");
  assert(reopened[2] === undefined, "untouched rank not flagged after reopen");
}

// sanity anchors: demo run shapes
assertEq(resBoth.meta.nModels, 232, "demo model count anchor");
assertEq(resTrain.meta.nModels, 232, "train-only model count anchor");
assert(m1.metricsVerify && m1.predVerify.length === resBoth.meta.nVerify, "demo pipeline produced verify predictions");

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
