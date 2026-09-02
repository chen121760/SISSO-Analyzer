// verify_against_sisso.mjs — regression test: the JS core must reproduce
// SISSO's own numbers exactly.
//
// Reads the real data files from the parent directory (D2F2) and checks:
//   1. column layout (246 columns, 244 features, target = col "b")
//   2. property std dev matches SISSO.out (1.50974)
//   3. top-3 models' RMSE / MaxAE match the values SISSO printed in top1000_D002
//   4. R2 / Spearman rho are finite and in expected ranges
//   5. verify.dat == train.dat is detected as in-sample
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", ".."); // D2F2 root

function read(rel) {
  return readFileSync(join(DATA, rel), "utf8");
}

let failures = 0;
function check(label, actual, expected, tol = 1e-5) {
  const pass = Math.abs(actual - expected) <= tol;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${actual}, want ${expected} (tol ${tol})`);
}
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

const files = {
  trainText: read("train.dat"),
  verifyText: read("verify.dat"),
  topText: read("Models/top1000_D002"),
  coeffText: read("Models/top1000_D002_coeff"),
  uspaceText: read("SIS_subspaces/Uspace.expressions"),
};

const t0 = Date.now();
const res = core.runPipeline(files);
const elapsed = Date.now() - t0;

console.log(`\nrunPipeline finished in ${elapsed} ms`);

// 1. column layout
assert(res.meta.nFeatures === 244, `nFeatures == 244 (got ${res.meta.nFeatures})`);
assert(res.meta.targetLetter === "b", `target letter == b (got ${res.meta.targetLetter})`);
assert(res.meta.targetName === "log10_D_cm2_s", `target name == log10_D_cm2_s (got ${res.meta.targetName})`);
assert(res.columns.length === 246, `246 columns (got ${res.columns.length})`);
assert(res.meta.nModels === 1000, `1000 models (got ${res.meta.nModels})`);

// 2. property std dev == 1.50974 (population std, like SISSO)
const y = Array.from(res.train.cols.b);
const mean = y.reduce((a, b) => a + b, 0) / y.length;
const std = Math.sqrt(y.reduce((a, b) => a + (b - mean) ** 2, 0) / y.length);
check("property std dev", std, 1.50974, 1e-4);

// 3. top-3 RMSE / MaxAE fidelity
const sissoTop3 = [
  { rank: 1, rmse: 1.034756, maxae: 3.416835 },
  { rank: 2, rmse: 1.047646, maxae: 2.910653 },
  { rank: 3, rmse: 1.050265, maxae: 2.635592 },
];
for (const exp of sissoTop3) {
  const m = res.models[exp.rank - 1];
  check(`model ${exp.rank} RMSE_train`, m.metricsTrain.rmse, exp.rmse, 1e-5);
  check(`model ${exp.rank} MaxAE_train`, m.metricsTrain.maxae, exp.maxae, 1e-5);
  // SISSO's own reported values should match too
  check(`model ${exp.rank} RMSE_sisso`, m.rmseSisso, exp.rmse, 1e-6);
}

// 4. R2 / rho sanity (R2 ~0.53 for model 1, rho must be in [-1, 1] and finite)
const m1 = res.models[0];
assert(Number.isFinite(m1.metricsTrain.r2), "model 1 R2 finite");
check("model 1 R2", m1.metricsTrain.r2, 0.5302477604590157, 1e-4);
assert(m1.metricsTrain.rho >= -1 && m1.metricsTrain.rho <= 1, "model 1 rho in [-1,1]");
assert(Number.isFinite(m1.metricsTrain.rho), "model 1 rho finite");

// 5. verify == train detected as in-sample
assert(res.meta.validationNote === "in-sample", `validationNote == in-sample (got ${res.meta.validationNote})`);

// 6. every model evaluated without error and metrics finite
let errModels = 0, okModels = 0;
for (const m of res.models) {
  if (m.error || !m.metricsTrain.ok) errModels++;
  else okModels++;
}
assert(errModels === 0, `all 1000 models evaluate without error (errors: ${errModels}, ok: ${okModels})`);

// 7. consistency: RMSE_train should equal RMSE_sisso across ALL models (this
//    proves the whole rename -> assemble -> eval chain is faithful)
let maxDev = 0;
for (const m of res.models) {
  const dev = Math.abs(m.metricsTrain.rmse - m.rmseSisso);
  if (dev > maxDev) maxDev = dev;
}
console.log(`\nmax |RMSE_train - RMSE_sisso| across ${res.models.length} models: ${maxDev.toExponential(4)}`);
assert(maxDev < 1e-5, "RMSE_train == RMSE_sisso across all models");

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
