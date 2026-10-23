/* Experimental binary classifiers with fixed-size boundaries in (d1, d2). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-evaluation.js"), require("./sisso-classification.js"), require("./sisso-svm.js"));
  else root.SissoSimpleBoundaries = factory(root.SissoEvaluation, root.SissoClassification, root.SissoSVM);
})(typeof self !== "undefined" ? self : this, function (E, Class, SVM) {
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
  function options(input) {
    input = input || {};
    var family = input.family || "linear", lambda = input.lambda === undefined ? 0.01 : Number(input.lambda);
    if (families.indexOf(family) < 0 || !Number.isFinite(lambda) || lambda < 1e-6 || lambda > 1e6) throw new Error("simpleInvalidOptions");
    return { family: family, lambda: lambda };
  }
  function trainModel(result, model, input) {
    if (result.classes.length !== 2 || result.meta.sissoIn.descDim !== 2) throw new Error("simpleOnlyBinary2D");
    var config = options(input), points = Class.projectModel(result, model, "train"), fitted;
    try { fitted = fit(points, config.family, config.lambda); }
    catch (error) { throw new Error(error.message.indexOf("singularity") >= 0 ? "simpleSingularity" : error.message); }
    if (!fitted.converged) throw new Error("simpleNotConverged");
    function scores(data) {
      var predicted = data.map(function (p) { return predict(fitted, p.coords).yPred; });
      return predicted.some(function (v) { return v === null; }) ? null : SVM.measure(data.map(function (p) { return p.classIndex; }), predicted, 2);
    }
    var summary = { rank: model.rank, status: "ready", fit: fitted, train: scores(points), verify: null, verifyIssue: null };
    if (!summary.train) throw new Error("svmInvalidCoordinates");
    if (result.verify) {
      summary.verifyIssue = "svmVerificationLabels";
      if (Class.hasVerificationLabels(result)) {
        summary.verify = scores(Class.projectModel(result, model, "verify"));
        summary.verifyIssue = summary.verify ? null : "simpleInvalidVerification";
      }
    }
    return summary;
  }
  function formulaText(fitted, descriptors, classes) {
    return descriptors.map(function (d, i) { return "d" + (i + 1) + " = " + d.original; }).join("\n") +
      "\nClass 0 = " + JSON.stringify(classes[0]) + "; class 1 = " + JSON.stringify(classes[1]) + "\n" + formula(fitted).text;
  }
  function roots(a, b, c) {
    if (a === 0) return b === 0 ? [] : [-c / b];
    var scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c)); a /= scale; b /= scale; c /= scale;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    var q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(disc));
    return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
  }
  function boundary(fitted, bounds, resolution) {
    if (!bounds || bounds.length !== 2 || bounds.some(function (b) { return b.length !== 2 || !b.every(Number.isFinite) || b[0] >= b[1]; })) throw new Error("simpleInvalidBounds");
    var c = fitted.coefficients, quad = fitted.family === "quadratic", reciprocal = fitted.family === "reciprocal";
    var a = quad ? c[2] : 0, b = c[1], yCoef = c[quad ? 3 : 2];
    var ux = fitted.units[0], uy = fitted.units[1], lo = bounds[0][0] / ux, hi = bounds[0][1] / ux;
    var bottom = bounds[1][0] / uy, top = bounds[1][1] / uy, segments = [];
    function valid(u) { return Number.isFinite(u) && u >= lo && u <= hi && (!reciprocal || Math.abs(u) > fitted.poleTolerance); }
    function level(v) { return reciprocal ? (c[0] + yCoef * v === 0 ? [] : [-b / (c[0] + yCoef * v)]) : roots(a, b, c[0] + yCoef * v); }
    if (yCoef === 0) {
      level(0).filter(valid).forEach(function (u) { segments.push([u * ux, bounds[1][0], u * ux, bounds[1][1]]); });
    } else {
      var cuts = [lo, hi].concat(level(bottom), level(top));
      if (reciprocal) cuts = cuts.concat([-fitted.poleTolerance, fitted.poleTolerance]);
      cuts = cuts.filter(function (u) { return Number.isFinite(u) && u >= lo && u <= hi; }).sort(function (x, y) { return x - y; });
      function y(u) { return -(c[0] + (reciprocal ? b / u : b * u + a * u * u)) / yCoef; }
      for (var i = 1; i < cuts.length; i++) {
        var left = cuts[i - 1], right = cuts[i], mid = left / 2 + right / 2, v = y(mid);
        if (left === right || !valid(mid) || v < bottom || v > top) continue;
        var steps = Math.max(8, Math.round((resolution || 128) * (right - left) / (hi - lo)));
        for (var j = 0; j < steps; j++) {
          var u1 = left + (right - left) * j / steps, u2 = left + (right - left) * (j + 1) / steps;
          var v1 = y(u1), v2 = y(u2), segment = [u1 * ux, v1 * uy, u2 * ux, v2 * uy];
          if (valid(u1) && valid(u2) && segment.every(Number.isFinite)) segments.push(segment);
        }
      }
    }
    return { segments: segments, bounds: bounds, kind: "simple-zero" };
  }
  return { families: families, fit: fit, predict: predict, formula: formula, options: options, trainModel: trainModel, formulaText: formulaText, boundary: boundary };
});
