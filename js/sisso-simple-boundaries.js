/* Experimental binary classifiers with fixed-size boundaries in (d1, d2). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-evaluation.js"));
  else root.SissoSimpleBoundaries = factory(root.SissoEvaluation);
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";
  var families = ["linear", "quadratic", "reciprocal"];
  function basis(coords, fit) {
    if (!coords || coords.length !== 2 || !coords.every(Number.isFinite)) return null;
    var u = coords[0] / fit.units[0], v = coords[1] / fit.units[1];
    if (fit.family === "reciprocal" && Math.abs(u) <= fit.poleTolerance) return null;
    var values = fit.family === "quadratic" ? [u, u * u, v] : fit.family === "reciprocal" ? [1 / u, v] : [u, v];
    return values.every(Number.isFinite) ? values : null;
  }
  function fit(points, family, lambda) {
    if (families.indexOf(family) < 0) throw new Error("Unknown boundary family.");
    if (!points.length || points.some(function (p) {
      return !p.coords || p.coords.length !== 2 || !p.coords.every(Number.isFinite) || (p.classIndex !== 0 && p.classIndex !== 1);
    }) || new Set(points.map(function (p) { return p.classIndex; })).size !== 2) {
      throw new Error("Simple boundaries require finite 2D training points from exactly two classes.");
    }
    lambda = lambda === undefined ? 0.01 : lambda;
    if (!Number.isFinite(lambda) || lambda <= 0) throw new Error("Regularization must be positive and finite.");
    var units = [0, 0];
    points.forEach(function (p) { p.coords.forEach(function (x, j) { units[j] = Math.max(units[j], Math.abs(x)); }); });
    var out = { family: family, units: units.map(function (v) { return v || 1; }), poleTolerance: 1e-12, lambda: lambda };
    var transformed = points.map(function (p) {
      var coords = basis(p.coords, out);
      if (!coords) throw new Error("Training points meet the reciprocal singularity or an invalid transform; no rows were dropped.");
      return { coords: coords, finite: true, classIndex: p.classIndex };
    });
    out.logistic = E.fitLogistic(transformed, 2, lambda);
    out.converged = out.logistic.converged;
    var beta = out.logistic.weights[1].map(function (w, i) { return w - out.logistic.weights[0][i]; });
    out.coefficients = [beta[0]];
    beta.slice(1).forEach(function (w, i) {
      out.coefficients[0] -= w * out.logistic.mean[i] / out.logistic.sd[i];
      out.coefficients.push(w / out.logistic.scale[i] / out.logistic.sd[i]);
    });
    if (!out.coefficients.every(Number.isFinite)) throw new Error("Non-finite boundary coefficients.");
    return out;
  }
  function predict(fit, coords) {
    var values = basis(coords, fit);
    return values ? E.logisticPredict(fit.logistic, values, 1, 0.5) : { yPred: null, status: "invalid" };
  }
  // Full numeric precision is retained; callers can format a separate preview.
  function formula(fit) {
    var c = fit.coefficients, units = fit.units;
    var original = fit.family === "quadratic" ? [c[0], c[1] / units[0], c[2] / units[0] / units[0], c[3] / units[1]] :
      fit.family === "reciprocal" ? [c[0], c[1] * units[0], c[2] / units[1]] : [c[0], c[1] / units[0], c[2] / units[1]];
    // Keep normalized coordinates if converting units would lose a nonzero term.
    var normalized = original.some(function (v, i) { return !Number.isFinite(v) || (v === 0 && c[i] !== 0); });
    var terms = fit.family === "quadratic" ? ["1", "d1", "d1^2", "d2"] : fit.family === "reciprocal" ? ["1", "1/d1", "d2"] : ["1", "d1", "d2"];
    var values = normalized ? c : original;
    var prefix = normalized ? "u = d1 / (" + units[0] + "); v = d2 / (" + units[1] + ")\n" : "";
    if (normalized) terms = terms.map(function (s) { return s.replace("d1", "u").replace("d2", "v"); });
    return { text: prefix + "g = " + values.map(function (v, i) { return "(" + v + ")" + (i ? "*(" + terms[i] + ")" : ""); }).join(" + ") +
      "\ng >= 0: class 1; g < 0: class 0. Boundary: g = 0." + (fit.family === "reciprocal" ? "\nInvalid when |d1 / (" + units[0] + ")| <= " + fit.poleTolerance + "." : ""),
      coefficients: values, terms: terms, normalized: normalized, parameterCount: values.length };
  }
  return { families: families, fit: fit, predict: predict, formula: formula };
});
