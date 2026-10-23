import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
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
console.log("PASS simple linear/parabolic/reciprocal boundaries, compact formula agreement, fixed training preprocessing, singularity guards and extreme units");
