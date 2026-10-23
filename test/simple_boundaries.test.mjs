import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { workerHarness } from "./svm-harness.mjs";
const require = createRequire(import.meta.url);
const Simple = require("../js/sisso-simple-boundaries.js");
const point = (x, y, label) => ({ coords: [x, y], classIndex: label, finite: true });

const datasets = {
  linear: [-3, -2, -1, 1, 2, 3].flatMap(x => [point(x, x - 2, 0), point(x, x + 2, 1)]),
  quadratic: [-3, -2, -1, 0, 1, 2, 3].flatMap(x => [point(x, x * x - 2, 0), point(x, x * x + 2, 1)]),
  reciprocal: [-3, -2, -1, -.5, .5, 1, 2, 3].flatMap(x => [point(x, 1 / x - 1, 0), point(x, 1 / x + 1, 1)]),
};
for (const family of Simple.families) {
  const fit = Simple.fit(datasets[family], family, .001), formula = Simple.formula(fit);
  assert.equal(fit.converged, true);
  assert.equal(formula.parameterCount, family === "quadratic" ? 4 : 3);
  for (const p of datasets[family]) {
    const prediction = Simple.predict(fit, p.coords);
    assert.equal(prediction.yPred, p.classIndex);
    const score = formula.coefficients.reduce((sum, c, i) => sum + c * vm.runInNewContext(formula.terms[i].replace("^2", "**2"), { d1: p.coords[0], d2: p.coords[1] }), 0);
    assert.ok(Math.abs(score - prediction.scores[1]) < 1e-10);
  }
  assert.equal(Simple.predict(fit, [NaN, 1]).status, "invalid");
  const mesh = Simple.boundary(fit, [[-4, 4], [-5, 10]]);
  assert.ok(mesh.segments.length > 0);
  for (const segment of mesh.segments) {
    if (family === "reciprocal") assert.ok(segment[0] * segment[2] > 0, "never connect across the reciprocal pole");
    for (const p of [segment.slice(0, 2), segment.slice(2)]) assert.ok(Math.abs(Simple.predict(fit, p).scores[1]) < 1e-8, "curve endpoints solve the actual classifier score");
  }
}
const fixed = Simple.fit(datasets.quadratic, "quadratic");
const before = JSON.stringify(fixed);
Simple.predict(fixed, [1000, -1000]);
assert.equal(JSON.stringify(fixed), before, "prediction never refits/scales from verification points");
assert.equal(Simple.predict(Simple.fit(datasets.reciprocal, "reciprocal"), [0, 1]).status, "invalid");
assert.throws(() => Simple.fit([...datasets.reciprocal, point(0, 0, 1)], "reciprocal"), /singularity/);
assert.throws(() => Simple.fit([point(0, 0, 0), point(1, 1, 2)], "linear"), /two classes/);
assert.throws(() => Simple.fit(datasets.linear, "linear", 0), /Regularization/);
assert.throws(() => Simple.fit([point(0, 0, 0)], "linear"), /two classes/);
const huge = Simple.fit(datasets.quadratic.map(p => point(p.coords[0] * 1e180, p.coords[1] * 1e180, p.classIndex)), "quadratic");
assert.equal(Simple.formula(huge).normalized, true, "unit conversion never silently erases quadratic coefficients");
assert.equal(Simple.predict(huge, [1e180, 3e180]).yPred, 1);
const normalized = Simple.formula(huge);
const score = normalized.coefficients.reduce((sum, c, i) => sum + c * vm.runInNewContext(normalized.terms[i].replace("^2", "**2"), {
  u: 1e180 / huge.units[0], v: 3e180 / huge.units[1],
}), 0);
assert.ok(Math.abs(score - Simple.predict(huge, [1e180, 3e180]).scores[1]) < 1e-10);
const vertical = Simple.boundary({ family: "quadratic", units: [1, 1], coefficients: [-1, 0, 1, 0] }, [[-2, 2], [-3, 3]]);
assert.equal(vertical.segments.length, 2);
assert.deepEqual(vertical.segments.map(s => s[0]).sort(), [-1, 1]);
assert.throws(() => Simple.options({ lambda: 0 }), /simpleInvalidOptions/);
assert.throws(() => Simple.boundary(fixed, [[1, 0], [0, 1]]), /simpleInvalidBounds/);
const texts = { train: "name x y\na 1 0\nb 2 1\nc 3 2\nd 1 4\ne 2 5\nf 3 6\n", verify: "name x y\nv 0 4\n",
  sissoin: "ptype=2\nntask=1\nnsample=(3,3)\nnsf=2\ndesc_dim=2\nisconvex=(1,1)\n", uspace: "x\ny\n",
  top: "rank #data_overlap size_overlap feature_ID\n1 0 0 (1 2)\n", verifylabels: JSON.stringify({ class_order: ["low", "high"], rows: [{ id: "v", class: 1 }] }) };
const result = require("../js/sisso-classification.js").runPipeline(texts);
const summary = Simple.trainModel(result, result.models[0], { family: "reciprocal" });
assert.equal(summary.train.n, 6);
assert.equal(summary.verify, null);
assert.equal(summary.verifyIssue, "simpleInvalidVerification", "do not score a reduced verification cohort");
const worker = workerHarness("simple");
worker.context.onmessage({ data: { type: "start", id: 1, texts, options: { family: "linear" } } });
worker.drain();
assert.equal(worker.context.libsvm, undefined, "simple-only training never loads LIBSVM");
assert.equal(worker.messages.at(-1).type, "done");
const message = worker.messages.find(m => m.type === "model");
assert.equal(message.summary.status, "ready");
worker.context.onmessage({ data: { type: "boundary", id: 1, key: "curve", fit: message.summary.fit, bounds: [[-1, 4], [-1, 7]] } });
assert.ok(worker.messages.at(-1).mesh.segments.length > 0);
console.log("PASS simple linear/parabolic/reciprocal boundaries, compact formula agreement, fixed training preprocessing, singularity guards and extreme units");
