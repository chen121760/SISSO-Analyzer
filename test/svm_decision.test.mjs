import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { workerHarness } from "./svm-harness.mjs";
const require = createRequire(import.meta.url);
const Engine = require("../js/sisso-svm.js");
const Classification = require("../js/sisso-classification.js");
const { context } = workerHarness();
const SVM = context.libsvm;
const identity = { units: [1, 1], means: [0, 0], scales: [1, 1] };
const known = { scaler: identity, serialized: "svm_type c_svc\nkernel_type rbf\ngamma 0.5\nnr_class 2\ntotal_sv 2\nrho 0.2\nlabel 0 1\nnr_sv 1 1\nSV\n2 1:0 2:0\n-1 1:1 2:0\n" };
const knownDecision = Engine.decisionFunction(known);
for (const [x, y] of [[0, 0], [1, 1], [-.3, .2], [3, -2]]) {
  const expected = 2 * Math.exp(-.5 * (x * x + y * y)) - Math.exp(-.5 * ((x - 1) ** 2 + y * y)) - .2;
  assert.ok(Math.abs(knownDecision([x, y]).values[0] - expected) < 1e-14);
}
console.log("PASS continuous f(d1,d2) uses actual support-vector coefficients, RBF gamma and rho");

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/rbf-svm-circle");
const files = Object.fromEntries(Object.entries({ train: "train.dat", verify: "verify.dat", verifylabels: "verify_labels.json",
  sissoin: "SISSO.in", top: "top1_D002", uspace: "Uspace.expressions" }).map(([key, name]) => [key, fs.readFileSync(path.join(dir, name), "utf8")]));
const result = Classification.runPipeline(files), model = result.models[0];
const trained = Engine.trainModel(result, model, {}, SVM), decision = Engine.decisionFunction(trained.fit);
assert.equal(trained.train.accuracy, 1);
assert.equal(trained.verify.accuracy, 1);
const native = SVM.load(trained.fit.serialized);
try {
  for (let i = 0; i < 24; i++) for (let j = 0; j < 25; j++) {
    const point = [-1.61 + i * .137, -1.58 + j * .129];
    assert.equal(decision(point).predicted, native.predictOne(Engine.transform(point, trained.fit.scaler)));
  }
} finally { native.free(); }
const bounds = Engine.domain(Classification.projectModel(result, model, "train"));
const curve = Engine.boundary(trained.fit, bounds);
assert.equal(curve.kind, "decision-zero");
assert.ok(curve.segments.length > 100);
let maxResidual = 0;
const endpoints = new Map();
for (const segment of curve.segments) {
  for (const p of [segment.slice(0, 2), segment.slice(2)]) {
    maxResidual = Math.max(maxResidual, Math.abs(decision(p).values[0]));
    const key = p.map((v) => v.toFixed(9)).join(","); endpoints.set(key, (endpoints.get(key) || 0) + 1);
    assert.ok(Math.hypot(...p) > .3 && Math.hypot(...p) < 1.3);
  }
}
assert.ok(maxResidual < 1e-7, `edge endpoints solve f=0; max residual ${maxResidual}`);
assert.ok([...endpoints.values()].every((degree) => degree === 2), "closed nonlinear contour with shared edge roots");
console.log(`PASS nonlinear closed zero contour: ${curve.segments.length} segments, max |f|=${maxResidual.toExponential(2)}; decisions agree with native LIBSVM`);

const low = Engine.trainModel(result, model, { complexity: 1 }, SVM);
const high = Engine.trainModel(result, model, { complexity: 5 }, SVM);
assert.equal(low.fit.complexity, 1); assert.equal(high.fit.complexity, 5);
assert.equal(high.fit.gamma / low.fit.gamma, 256);
assert.deepEqual(low.fit.scaler, high.fit.scaler);
assert.notEqual(low.fit.serialized, high.fit.serialized);
const lowCurve = Engine.boundary(low.fit, bounds, 48), highCurve = Engine.boundary(high.fit, bounds, 48);
assert.notDeepEqual(lowCurve.segments, highCurve.segments, "complexity changes the fitted boundary, not rendering resolution");
for (const complexity of [0, 6, 2.5, NaN, ""]) assert.throws(() => Engine.options({ complexity }), /svmInvalidComplexity/);
console.log("PASS complexity changes gamma and fitted boundaries while keeping scaling and sampling resolution fixed");

const multiFiles = { ...files, verify: undefined, verifylabels: undefined,
  train: "name x z\na -3 -3\nb -2.6 -3\nc -3 3\nd -2.6 3\ne 3 -3\nf 2.6 -3\ng 3 3\nh 2.6 3\n",
  sissoin: files.sissoin.replace("(8,12)", "(2,2,2,2)").replace("(1,1)", "(1,1,1,1)"),
};
const multi = Classification.runPipeline(multiFiles);
const multiFit = Engine.trainModel(multi, multi.models[0], {}, SVM);
const multiDecision = Engine.decisionFunction(multiFit.fit), multiNative = SVM.load(multiFit.fit.serialized);
assert.equal(multiDecision.pairs.length, 6);
try {
  for (let i = 0; i < 31; i++) for (let j = 0; j < 30; j++) {
    const point = [-4.11 + i * .271, -4.13 + j * .277];
    assert.equal(multiDecision(point).predicted, multiNative.predictOne(Engine.transform(point, multiFit.fit.scaler)));
  }
} finally { multiNative.free(); }
assert.ok(Engine.boundary(multiFit.fit, [[-4, 4], [-4, 4]], 48).segments.length > 0);
console.log("PASS all six pairwise decision functions and voting agree with native four-class LIBSVM");

// Evaluate the exported numeric expressions as an independent deployment check.
for (const fit of [known, trained.fit, multiFit.fit]) {
  const text = Engine.formulaText(fit, [{ original: "x" }, { original: "y" }], ["A", "B", "C", "D"]);
  const expressions = text.split("\n").filter(line => /^f_.*\(d1,d2\) = /.test(line)).map(line => line.split(" = ")[1]);
  const evaluate = Engine.decisionFunction(fit);
  for (const point of [[0, 0], [1.3, -2.1], [-.5, .7]]) {
    const z = Engine.transform(point, fit.scaler);
    expressions.forEach((expression, i) => {
      const value = vm.runInNewContext(expression.replaceAll("exp(", "Math.exp(").replaceAll("^2", "**2"), { z1: z[0], z2: z[1] });
      assert.ok(Math.abs(value - evaluate(point).values[i]) < 1e-12);
    });
  }
  assert.ok(text.includes("0 = \"A\""));
  assert.ok(text.includes(evaluate.labels.join(", ")));
}
console.log("PASS exported binary/multiclass formulas reproduce decision values and retain class mapping and tie order");
