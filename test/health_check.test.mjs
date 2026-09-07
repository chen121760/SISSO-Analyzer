// health_check.test.mjs — regression tests for the Analysis Health Check.
//
// The validator (js/health-check.js) is DOM-free and reuses SissoCore parsers,
// so it runs identically in the browser and here. These tests verify:
//   1. a normal project (built-in demo + a small hand-made one) passes with
//      Passed rows and no warnings/errors
//   2. running the health check never changes a healthy project's results
//   3. header misalignment between train.dat / verify.dat is a Warning and the
//      broken verify file is dropped (train-only) instead of blocking
//   4. non-numeric / NaN / Inf cells are Warnings
//   5. duplicate sample names are Warnings
//   6. a descriptor referencing a feature missing from Uspace is an Error
//   7. top/coefficient row-count mismatch is an Error
//   8. descriptor divide-by-zero / log / sqrt domain hazards are Warnings
//   9. a missing required file is an Error
//
// Run: node test/health_check.test.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");
const health = require("../js/health-check.js");
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
function findBy(report, id) {
  return (report.checks || []).find((c) => c.id === id) || null;
}
function counts(report) {
  const out = { pass: 0, warning: 0, error: 0 };
  for (const c of report.checks) out[c.level]++;
  return out;
}

// ---------------------------------------------------------------------------
// Hand-made mini SISSO run (2 samples, 2 features, 2 ranked models).
// ---------------------------------------------------------------------------
const HEADER = "name target f1 f2";
const TRAIN_OK = `${HEADER}
s1 10 2 4
s2 12 3 5
s3 14 1 6
`;
const TOP_OK = "Rank RMSE MaxAE Feature_ID\n1 0.9 2.0 ( 1)\n2 1.1 2.5 ( 2)\n";
const COEFF_OK = "Model_ID c0 c1\n1 -1.0 0.5\n2 -2.0 0.25\n";
const USPACE_OK = "(f1) SIS_score = 0.1\n(f2) SIS_score = 0.2\n";

function files(over) {
  return Object.assign({
    train: TRAIN_OK,
    top: TOP_OK,
    coeff: COEFF_OK,
    uspace: USPACE_OK,
    verify: TRAIN_OK, // identical layout by default
  }, over || {});
}

// ---------------------------------------------------------------------------
// 1. healthy mini project + the built-in demo project both pass
// ---------------------------------------------------------------------------
{
  const mini = health.check(files());
  assert(mini.level === "pass", "mini project level == pass");
  assertEq(counts(mini).warning, 0, "mini project has no warnings");
  assertEq(counts(mini).error, 0, "mini project has no errors");
  for (const id of ["train-parse", "train-duplicates", "train-numeric",
    "verify-consistency", "verify-duplicates", "verify-numeric", "models", "descriptors"]) {
    const e = findBy(mini, id);
    assert(e && e.level === "pass", `mini project check '${id}' is Passed`);
  }

  const demo = health.check({
    train: demoData.train,
    verify: demoData.verify,
    top: demoData.top,
    coeff: demoData.coeff,
    uspace: demoData.uspace,
  });
  assert(demo.level === "pass", "built-in demo project level == pass");
  assertEq(counts(demo).warning, 0, "demo project has no warnings");
  assertEq(counts(demo).error, 0, "demo project has no errors");
  assert(findBy(demo, "train-parse").level === "pass", "demo train-parse Passed");
  assert(findBy(demo, "models").level === "pass", "demo model-consistency check Passed");
  assert(findBy(demo, "descriptors").level === "pass", "demo descriptors Passed");
}

// ---------------------------------------------------------------------------
// 2. the health check never changes a healthy project's analysis results
// ---------------------------------------------------------------------------
{
  const runOnce = () => core.runPipeline({
    trainText: demoData.train,
    verifyText: demoData.verify,
    topText: demoData.top,
    coeffText: demoData.coeff,
    uspaceText: demoData.uspace,
  });
  const baseline = runOnce();
  health.check({
    train: demoData.train,
    verify: demoData.verify,
    top: demoData.top,
    coeff: demoData.coeff,
    uspace: demoData.uspace,
  });
  const again = runOnce();
  assertEq(again.meta.nModels, baseline.meta.nModels, "nModels unchanged after health check");
  assertEq(again.models[0].metricsTrain.rmse, baseline.models[0].metricsTrain.rmse,
    "model-1 train RMSE unchanged after health check");
  assertEq(again.models[0].metricsVerify.rmse, baseline.models[0].metricsVerify.rmse,
    "model-1 verify RMSE unchanged after health check");
}

// ---------------------------------------------------------------------------
// 3. train/verify header misalignment -> Warning + dropVerify (not blocking)
// ---------------------------------------------------------------------------
{
  // Same column count but the two features are swapped -> silent misalignment.
  const verifySwapped = "name target f2 f1\nv1 10 4 2\nv2 12 5 3\n";
  const r = health.check(files({ verify: verifySwapped }));
  assert(r.level === "warning", "header mismatch level == warning (not error)");
  assertEq(counts(r).error, 0, "header mismatch is not blocking");
  const e = findBy(r, "verify-consistency");
  assert(e && e.level === "warning" && r.dropVerify === true, "verify-consistency warns and drops verify");
  assert(e.message.includes("f2"), "message points at the differing column");

  // Column-count mismatch -> also Warning + dropVerify.
  const verifyShort = "name target f1\nv1 10 2\n";
  const r2 = health.check(files({ verify: verifyShort }));
  assert(r2.level === "warning" && findBy(r2, "verify-consistency").level === "warning",
    "column-count mismatch warns and drops verify");
  assert(r2.dropVerify === true, "column-count mismatch sets dropVerify");

  // Unparseable verify rows -> Warning + dropVerify.
  const verifyBrokenRows = "name target f1 f2\nv1 10 2\nv2 12 3 5\n";
  const r3 = health.check(files({ verify: verifyBrokenRows }));
  assert(r3.level === "warning" && r3.dropVerify === true,
    "unparseable verify rows warn and drop verify (analysis may still run train-only)");
}

// ---------------------------------------------------------------------------
// 4. non-numeric / NaN / Inf cells in train.dat -> Warning
// ---------------------------------------------------------------------------
{
  const bad = files({
    train: `${HEADER}
s1 10 NaN 4
s2 abc 3 Inf
s3 14 1 6
`,
  });
  const r = health.check(bad);
  assert(r.level === "warning", "bad numeric cells level == warning");
  const e = findBy(r, "train-numeric");
  assert(e && e.level === "warning" && e.message.includes("3"), "train-numeric warns (3 bad cells)");
  assert(e.message.includes("NaN") && e.message.includes("Inf"), "message mentions NaN/Inf cells");
}

// ---------------------------------------------------------------------------
// 5. duplicate sample names -> Warning
// ---------------------------------------------------------------------------
{
  const dup = files({
    train: `${HEADER}
s1 10 2 4
s1 12 3 5
s3 14 1 6
`,
  });
  const r = health.check(dup);
  assert(r.level === "warning", "duplicate names level == warning");
  const e = findBy(r, "train-duplicates");
  assert(e && e.level === "warning" && e.message.includes("s1"), "train-duplicates warns about s1");
}

// ---------------------------------------------------------------------------
// 6. descriptor referencing a feature missing from Uspace -> Error (blocking)
// ---------------------------------------------------------------------------
{
  const badTop = "Rank RMSE MaxAE Feature_ID\n1 0.9 2.0 ( 1)\n2 1.1 2.5 ( 99)\n";
  const r = health.check(files({ top: badTop }));
  assert(r.level === "error", "missing descriptor reference level == error");
  const e = findBy(r, "models");
  assert(e && e.level === "error" && e.message.includes("99"), "models error mentions feature id 99");
  assert(r.dropVerify === false, "descriptor errors do not involve verify");
}

// ---------------------------------------------------------------------------
// 7. top/coefficient row-count mismatch -> Error
// ---------------------------------------------------------------------------
{
  const shortCoeff = "Model_ID c0 c1\n1 -1.0 0.5\n";
  const r = health.check(files({ coeff: shortCoeff }));
  assert(r.level === "error", "row-count mismatch level == error");
  const e = findBy(r, "models");
  assert(e && e.level === "error" && e.message.includes("2") && e.message.includes("1"),
    "models error states both row counts");
}

// ---------------------------------------------------------------------------
// 8. descriptor domain hazards (log of a negative value) -> Warning
// ---------------------------------------------------------------------------
{
  // f1 is negative on the second sample; descriptor #1 = log(f1) -> NaN there.
  const domainTrain = `${HEADER}
s1 10 2 4
s2 12 -1 5
s3 14 1 6
`;
  const uspaceLog = "(log(f1)) SIS_score = 0.1\n(f2) SIS_score = 0.2\n";
  const r = health.check(files({ train: domainTrain, uspace: uspaceLog }));
  assert(r.level === "warning", "log-domain hazard level == warning (not blocking)");
  const e = findBy(r, "descriptors");
  assert(e && e.level === "warning" && e.message.includes("non-finite"),
    "descriptors warns about non-finite values");
  assert(e.message.includes("log"), "message hints at the hazard");
}

// ---------------------------------------------------------------------------
// 9. missing required file -> Error
// ---------------------------------------------------------------------------
{
  const noUspace = files({ uspace: "" });
  const r = health.check(noUspace);
  assert(r.level === "error", "missing required file level == error");
  assert(findBy(r, "required").level === "error", "required error entry present");
}

// ---------------------------------------------------------------------------
// 10. every healthy check stays parseable by the real pipeline (end-to-end)
// ---------------------------------------------------------------------------
{
  const r = health.check(files());
  assert(r.level === "pass", "mini healthy set passes");
  // And the same texts really run through the pipeline without error.
  const res = core.runPipeline({
    trainText: TRAIN_OK,
    topText: TOP_OK,
    coeffText: COEFF_OK,
    uspaceText: USPACE_OK,
    verifyText: TRAIN_OK,
  });
  assertEq(res.meta.nModels, 2, "mini set pipeline produces 2 models");
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
