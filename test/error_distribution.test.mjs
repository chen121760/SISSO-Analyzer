// error_distribution.test.mjs — residual (error = predicted − true) values,
// residual statistics and histogram binning used by the model-detail
// "Error distribution" view.
//
// The UI never re-implements these numbers: the detail dialog calls the exact
// functions verified here (Core.errorSeries / residualStats / errorHistogram),
// so the chart can only show what these helpers compute.
//
// Run: node test/error_distribution.test.mjs
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
function assertNear(actual, expected, eps, label) {
  const pass = typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= eps;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${actual}, want ~${expected}`);
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

// ---------------------------------------------------------------------------
// 1. residual values: error = predicted - true, aligned & NaN for non-finite
// ---------------------------------------------------------------------------
{
  const errs = core.errorSeries([10, 20, 30, 40], [9, 21, 27, 40]);
  assertEq(errs.length, 4, "errorSeries aligned length");
  assertDeep(Array.from(errs), [1, -1, 3, 0], "errorSeries = predicted - true");
}
{
  // NaN on either side of the pair -> NaN residual; other indices untouched
  const errs = core.errorSeries([1, NaN, 3, Infinity], [0, 0, 1, 1]);
  assert(Number.isNaN(errs[1]), "NaN predicted -> NaN residual");
  assert(Number.isNaN(errs[2]) === false && errs[2] === 2, "finite pair unaffected by NaN neighbours");
  assert(Number.isNaN(errs[3]), "Infinity predicted -> NaN residual");
  assertEq(errs.length, 4, "errorSeries keeps input length with NaN holes");
}
{
  // Shorter of the two inputs wins (mismatched lengths are a caller bug, but
  // must not throw).
  const errs = core.errorSeries([1, 2, 3], [0, 0]);
  assertEq(errs.length, 2, "errorSeries truncates to the shorter input");
}

// ---------------------------------------------------------------------------
// 2. finiteResiduals drops NaN / ±Inf
// ---------------------------------------------------------------------------
{
  const out = core.finiteResiduals([1, NaN, -2, Infinity, 3, -Infinity]);
  assertDeep(out, [1, -2, 3], "finiteResiduals keeps only finite values in order");
  assertDeep(core.finiteResiduals(null), [], "finiteResiduals(null) -> []");
}

// ---------------------------------------------------------------------------
// 3. residualStats: mean / median / std (population, ÷ n) over finite values
// ---------------------------------------------------------------------------
{
  const s = core.residualStats([-2, -1, 0, 1, 2]);
  assertEq(s.n, 5, "stats n = 5");
  assertEq(s.mean, 0, "mean = 0");
  assertEq(s.median, 0, "median (odd n) = middle value");
  assertNear(s.std, Math.sqrt(2), 1e-12, "population std of -2..2 = sqrt(2)");
  assertEq(s.ok, true, "stats ok flag");
}
{
  const s = core.residualStats([-3, -1, 1, 2]);
  assertEq(s.mean, -0.25, "mean of four values");
  assertEq(s.median, 0, "median (even n) = mean of two middle values");
  assertNear(s.std, Math.sqrt(3.6875), 1e-12, "population std matches np.std semantics (÷ n)");
}
{
  const s = core.residualStats([NaN, 1, Infinity, 3, -Infinity]);
  assertEq(s.n, 2, "non-finite residuals excluded from stats");
  assertEq(s.mean, 2, "mean over finite only");
  assertEq(s.median, 2, "median over finite only");
  assertEq(s.std, 1, "std over finite only");
}
{
  const s = core.residualStats([]);
  assertEq(s.ok, false, "empty input -> ok:false");
  assertEq(s.n, 0, "empty input -> n:0");
  const s2 = core.residualStats([NaN, NaN]);
  assertEq(s2.ok, false, "all-NaN input -> ok:false");
}

// ---------------------------------------------------------------------------
// 4. errorHistogram: equal-width binning with exact membership rules
// ---------------------------------------------------------------------------
{
  // values spanning [0, 10] with 5 bins -> width 2, edges [0,2,4,6,8,10]
  const h = core.errorHistogram([0, 1, 2, 3.9, 4, 5.9, 6, 8, 10], { bins: 5 });
  assertEq(h.ok, true, "histogram ok");
  assertEq(h.binCount, 5, "bins honoured from opts");
  assertEq(h.binWidth, 2, "equal width = (max-min)/bins");
  assertDeep(Array.from(h.edges), [0, 2, 4, 6, 8, 10], "edges exact");
  assertDeep(Array.from(h.counts), [2, 2, 2, 1, 2],
    "counts: [0,2)->{0,1}, [2,4)->{2,3.9}, [4,6)->{4,5.9}, [6,8)->{6}, [8,10]->{8,10}");
  assertEq(h.counts.reduce((a, b) => a + b, 0), 9, "all finite values counted exactly once");
  assertEq(h.zeroBin, 0, "0 lies in bin 0 (left edge inclusive)");
  assertEq(h.containsZero, true, "containsZero true when 0 inside range");
}
{
  // interior edge: a value exactly at edges[i] goes to the RIGHT bin
  const h = core.errorHistogram([-3, -2, -1, 0, 1, 2, 3], { bins: 3 });
  // width 2, edges [-3,-1,1,3]
  assertDeep(Array.from(h.edges), [-3, -1, 1, 3], "symmetric edges");
  assertDeep(Array.from(h.counts), [2, 2, 3],
    "bin0 {-3,-2}, bin1 {-1,0}, bin2 {1,2,3}: -1 and 1 sit on interior edges -> right bin; max 3 clamped into last bin");
  assertEq(h.zeroBin, 1, "0 inside bin 1");
}
{
  // values below/at min belong to first bin, at max to last bin
  const h = core.errorHistogram([5, 5, 10, 10], { bins: 5 }); // width 1, edges 5..10
  assertDeep(Array.from(h.counts), [2, 0, 0, 0, 2], "min-side and max-side clamps land in outer bins");
}
{
  // zero fully on the negative side / positive side -> zeroBin -1
  const h1 = core.errorHistogram([1, 2, 3, 4, 5], { bins: 5 });
  assertEq(h1.zeroBin, -1, "all-positive residuals: no zero bin");
  assertEq(h1.containsZero, false, "all-positive residuals: containsZero false");
  const h2 = core.errorHistogram([-5, -4, -3, -2, -1], { bins: 5 });
  assertEq(h2.zeroBin, -1, "all-negative residuals: no zero bin");
}
{
  // zero exactly at the data maximum is counted and located in the last bin
  const h = core.errorHistogram([-4, -2, 0], { bins: 4 }); // width 1, edges -4..0
  assertEq(h.zeroBin, h.binCount - 1, "zero == data max sits in the last bin");
  assertEq(h.containsZero, true, "containsZero true when 0 == max");
  assertEq(h.counts.reduce((a, b) => a + b, 0), 3, "three finite values counted");
}
{
  // NaN / ±Inf never enter a bin and are reported as excluded
  const h = core.errorHistogram([-2, NaN, 0, Infinity, 2]);
  assertEq(h.ok, true, "histogram over the finite subset still ok");
  assertEq(h.n, 3, "n counts finite only");
  assertEq(h.excluded, 2, "excluded = non-finite count");
  assertEq(h.counts.reduce((a, b) => a + b, 0), 3, "bins hold only finite values");
}
{
  // degenerate input (all residuals identical): still a valid, non-empty binning
  const h = core.errorHistogram([0, 0, 0, 0]);
  assertEq(h.ok, true, "constant residuals still produce a histogram");
  assertEq(h.binCount > 0, true, "positive bin count for constant input");
  assert(h.binWidth > 0, "positive bin width after symmetric expansion");
  assertEq(h.counts.reduce((a, b) => a + b, 0), 4, "constant residuals all counted");
  assertEq(h.containsZero, true, "zero expanded range contains 0");
}
{
  // empty / all non-finite
  const h = core.errorHistogram([]);
  assertEq(h.ok, false, "empty input -> ok:false");
  assertEq(h.n, 0, "empty input -> n:0");
  assertEq(h.bins.length, 0, "empty input -> no bins");
  const h2 = core.errorHistogram([NaN, Infinity]);
  assertEq(h2.ok, false, "all non-finite -> ok:false");
  assertEq(h2.n, 0, "all non-finite -> n:0");
}
{
  // default bin count (no opts.bins) is deterministic and within [5, 60]
  const h = core.errorHistogram([-2, -1, -0.5, 0, 0.5, 1, 2]);
  const n = h.binCount;
  assertEq(n, Math.max(5, Math.min(60, Math.ceil(Math.sqrt(7)))), "auto bin count = clamped sqrt rule");
}

// ---------------------------------------------------------------------------
// 5. residuals & stats & bins agree with the demo pipeline + per-sample matrix
// ---------------------------------------------------------------------------
{
  const res = core.runPipeline({
    trainText: demoData.train,
    verifyText: demoData.verify,
    topText: demoData.top,
    coeffText: demoData.coeff,
    uspaceText: demoData.uspace,
  });
  const m = res.models[0];
  const yT = Array.from(res.train.cols[res.meta.targetLetter]);

  const errs = core.errorSeries(m.predTrain, yT);
  assertEq(errs.length, res.meta.nTrain, "train residual count == nTrain");
  for (let i = 0; i < res.meta.nTrain; i++) {
    assertNear(errs[i], m.predTrain[i] - yT[i], 1e-12, `train residual ${i} == pred - true`);
  }

  // same residual the Compare matrix reports (its "error" column)
  const mat = core.compareSampleMatrix(res, [m], "train");
  assertEq(mat.rows.length, res.meta.nTrain, "compare matrix row count == nTrain");
  let aligned = true;
  for (let i = 0; i < res.meta.nTrain; i++) {
    const rowErr = mat.rows[i].preds[0].error;
    const want = Number.isFinite(errs[i]) ? errs[i] : NaN;
    if (!(rowErr === want || (Number.isNaN(rowErr) && Number.isNaN(want)))) aligned = false;
  }
  assert(aligned, "errorSeries matches compareSampleMatrix error per row");

  const stats = core.residualStats(errs);
  assertEq(stats.n, core.finiteResiduals(errs).length, "stats.n == finite residual count");
  const hist = core.errorHistogram(errs);
  assertEq(hist.counts.reduce((a, b) => a + b, 0), hist.n, "demo histogram bins sum == n");
  // train residuals of a fitted model straddle zero in the demo run
  assertEq(hist.containsZero, true, "demo train residuals contain 0");
  assertEq(stats.mean < 1e-6 && stats.mean > -1e-6, true, "demo train mean error ~0");

  // verify dataset behaves the same when present
  const m100 = res.models[100];
  const yV = Array.from(res.verify.cols[res.meta.targetLetter]);
  const errsV = core.errorSeries(m100.predVerify, yV);
  assertEq(errsV.length, res.meta.nVerify, "verify residual count == nVerify");
  const histV = core.errorHistogram(errsV);
  assertEq(histV.counts.reduce((a, b) => a + b, 0), histV.n, "demo verify histogram bins sum == n");

  // train-only run still computes train residuals normally
  const resT = core.runPipeline({
    trainText: demoData.train,
    topText: demoData.top,
    coeffText: demoData.coeff,
    uspaceText: demoData.uspace,
  });
  const mT = resT.models[0];
  const yTT = Array.from(resT.train.cols[resT.meta.targetLetter]);
  const errsT = core.errorSeries(mT.predTrain, yTT);
  assertEq(errsT.length, resT.meta.nTrain, "train-only run: train residuals available");
  assertEq(core.errorHistogram(errsT).ok, true, "train-only run: histogram builds");
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
