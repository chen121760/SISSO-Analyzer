/* Post-evaluation only. Official SISSO overlap/YES/NO are never predictions. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-core.js"), require("./sisso-classification.js"));
  else root.SissoEvaluation = factory(root.SissoCore, root.SissoClassification);
})(typeof self !== "undefined" ? self : this, function (Core, Classification) {
  "use strict";
  var VERSION = 1;
  var registry = [
    ["rmse", "regression", "min", "target", "finite pairs"],
    ["mae", "regression", "min", "target", "finite pairs"],
    ["maxae", "regression", "min", "target", "finite pairs"],
    ["r2", "regression", "max", "unitless", "nonconstant truth"],
    ["rho", "regression", "max", "unitless", "nonconstant ranks"],
    ["medianAE", "regression", "min", "target", "finite pairs"],
    ["p90AE", "regression", "min", "target", "finite pairs"],
    ["p95AE", "regression", "min", "target", "finite pairs"],
    ["bias", "regression", "zero", "target", "finite pairs"],
    ["toleranceRate", "regression", "max", "fraction", "predefined tolerance"],
    ["baselineSkill", "regression", "max", "unitless", "training-mean baseline"],
    ["accuracy", "classification", "max", "fraction", "labels; rejection counts as incorrect"],
    ["selectiveAccuracy", "classification", "max", "fraction", "accepted labelled predictions"],
    ["balancedAccuracy", "classification", "max", "fraction", "all classes present"],
    ["macroF1", "classification", "max", "fraction", "all classes present"],
    ["mcc", "classification", "max", "unitless", "nondegenerate confusion matrix"],
    ["auc", "classification", "max", "unitless", "continuous scores and both classes"],
    ["ap", "classification", "max", "unitless", "continuous scores and both classes"],
    ["brier", "classification", "min", "unitless", "probabilities"],
    ["logLoss", "classification", "min", "unitless", "probabilities"],
    ["coverage", "both", "max", "fraction", "all input rows"]
  ].map(function (r) { return { key: r[0], task: r[1], direction: r[2], units: r[3], requires: r[4] }; });
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function ratio(a, b) { return b ? a / b : null; }
  function quantile(a, q) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), p = (s.length - 1) * q, i = Math.floor(p);
    return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i);
  }
  function label(v, k) { return Number.isInteger(v) && v >= 0 && v < k; }
  function config(input) {
    var c = Object.assign({ method: "geometry", dataset: "verify", role: "validation", positiveClass: 1,
      threshold: 0.5, lambda: 0.01, tolerance: null, bootstrap: 0, seed: 42, alpha: 0.1 }, input || {});
    if (["geometry", "logistic"].indexOf(c.method) < 0) throw new Error("Unknown prediction method.");
    if (["train", "validation", "test", "calibration"].indexOf(c.role) < 0) throw new Error("Invalid dataset role.");
    ["threshold", "lambda", "alpha"].forEach(function (key) { if (!Number.isFinite(c[key])) throw new Error("Invalid " + key); });
    if (c.threshold < 0 || c.threshold > 1 || c.lambda <= 0 || c.alpha <= 0 || c.alpha >= 1) throw new Error("Threshold / regularization / alpha is out of range.");
    if (c.tolerance !== null && (!Number.isFinite(c.tolerance) || c.tolerance < 0)) throw new Error("Tolerance must be nonnegative or empty.");
    if (!Number.isInteger(c.bootstrap) || c.bootstrap < 0 || c.bootstrap > 2000 || !Number.isInteger(c.seed)) throw new Error("Bootstrap must be 0–2000; seed must be an integer.");
    return c;
  }

  // Fit geometry on training labels only. Normalize coordinates before cross products.
  function fitGeometry(points, k, dim, convex) {
    if (convex && convex.some(function (v) { return v !== 1; })) throw new Error("Geometry prediction requires isconvex=1 for every class. Use the auxiliary classifier instead.");
    var scale = Array(dim).fill(0);
    points.filter(function (p) { return p.finite; }).forEach(function (p) { p.coords.forEach(function (x, j) { scale[j] = Math.max(scale[j], Math.abs(x)); }); });
    scale = scale.map(function (x) { return x || 1; });
    var normalized = points.map(function (p) { return Object.assign({}, p, { coords: p.coords.map(function (x, j) { return x / scale[j]; }) }); });
    var hulls = Classification.rebuildHulls(normalized, k, dim);
    if (hulls.some(function (h) { return !h.length; })) throw new Error("A class has no finite training descriptors.");
    return { type: "geometry", scale: scale, hulls: hulls, epsilon: 1e-10, dim: dim };
  }
  function inside(p, h, eps) {
    if (p.length === 1) return p[0] >= h[0][0] - eps && p[0] <= h[h.length - 1][0] + eps;
    if (h.length === 1) return Math.hypot(p[0] - h[0][0], p[1] - h[0][1]) <= eps;
    if (h.length === 2) {
      var a = h[0], b = h[1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) <= eps * len &&
        (p[0] - a[0]) * dx + (p[1] - a[1]) * dy >= -eps * len &&
        (p[0] - b[0]) * dx + (p[1] - b[1]) * dy <= eps * len;
    }
    var sign = 0;
    for (var i = 0; i < h.length; i++) {
      var u = h[i], v = h[(i + 1) % h.length], cross = (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
      if (Math.abs(cross) <= eps * Math.hypot(v[0] - u[0], v[1] - u[1])) continue;
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
    return true;
  }
  function geometryPredict(fit, coords) {
    if (!coords.every(Number.isFinite)) return { yPred: null, status: "invalid" };
    var p = coords.map(function (x, j) { return x / fit.scale[j]; }), hits = [];
    fit.hulls.forEach(function (h, c) { if (inside(p, h, fit.epsilon)) hits.push(c); });
    return { yPred: hits.length === 1 ? hits[0] : null, status: hits.length === 1 ? "accepted" : hits.length ? "ambiguous" : "out-of-domain" };
  }

  function softmax(z) {
    var m = Math.max.apply(null, z), ex = z.map(function (x) { return Math.exp(x - m); }), s = ex.reduce(function (a, b) { return a + b; }, 0);
    return ex.map(function (x) { return x / s; });
  }
  // Binary softmax has equivalent log-odds beta = w1-w0. Its slope penalty is
  // lambda/4 * beta^2. A tiny damped Newton solve avoids thousands of gradient
  // passes for each candidate, without changing the multinomial objective.
  function binaryNewton(x, data, lambda) {
    var d = x[0].length, beta = Array(d).fill(0), iteration, norm = Infinity, converged = false;
    function objective(b) {
      var loss = 0;
      for (var i = 0; i < x.length; i++) {
        var z = 0; for (var j = 0; j < d; j++) z += x[i][j] * b[j];
        loss += Math.log1p(Math.exp(-Math.abs(z))) + Math.max(z, 0) - data[i].classIndex * z;
      }
      return loss / x.length + lambda / 4 * b.slice(1).reduce(function (s, v) { return s + v * v; }, 0);
    }
    for (iteration = 0; iteration < 100; iteration++) {
      var g = Array(d).fill(0), h = Array.from({ length: d }, function () { return Array(d).fill(0); });
      for (var i = 0; i < x.length; i++) {
        var z = 0; for (var j = 0; j < d; j++) z += x[i][j] * beta[j];
        var exp = Math.exp(-Math.abs(z)), p = z >= 0 ? 1 / (1 + exp) : exp / (1 + exp);
        for (var a = 0; a < d; a++) {
          g[a] += (p - data[i].classIndex) * x[i][a] / x.length;
          for (var b = 0; b < d; b++) h[a][b] += p * (1 - p) * x[i][a] * x[i][b] / x.length;
        }
      }
      for (var j = 1; j < d; j++) { g[j] += lambda / 2 * beta[j]; h[j][j] += lambda / 2; }
      norm = Math.sqrt(2 * g.reduce(function (s, v) { return s + v * v; }, 0));
      if (norm < 1e-7) { converged = true; break; }
      var matrix = h.map(function (row, i) { return row.concat(g[i]); }), valid = true;
      for (var c = 0; c < d; c++) {
        var pivot = c;
        for (var r = c + 1; r < d; r++) if (Math.abs(matrix[r][c]) > Math.abs(matrix[pivot][c])) pivot = r;
        if (Math.abs(matrix[pivot][c]) < 1e-15) { valid = false; break; }
        var temp = matrix[c]; matrix[c] = matrix[pivot]; matrix[pivot] = temp;
        var divisor = matrix[c][c]; for (var col = c; col <= d; col++) matrix[c][col] /= divisor;
        for (var r = 0; r < d; r++) if (r !== c) {
          var factor = matrix[r][c]; for (var col = c; col <= d; col++) matrix[r][col] -= factor * matrix[c][col];
        }
      }
      if (!valid) break;
      var delta = matrix.map(function (row) { return row[d]; }), loss = objective(beta), step = 1;
      var descent = g.reduce(function (s, v, j) { return s + v * delta[j]; }, 0), next;
      while (step >= 1e-10) {
        next = beta.map(function (v, j) { return v - step * delta[j]; });
        if (objective(next) <= loss - 1e-4 * step * descent + 1e-15) break;
        step /= 2;
      }
      if (step < 1e-10) break;
      beta = next;
    }
    return { weights: [beta.map(function (v) { return -v / 2; }), beta.map(function (v) { return v / 2; })],
      iterations: iteration, converged: converged, gradientNorm: norm, optimizer: "damped Newton (binary softmax equivalent)" };
  }
  // Deterministic full-batch multinomial logistic regression: mean cross entropy
  // + lambda/2 * sum(slopes^2). Intercepts are unpenalized, scaling is train-only.
  function fitLogistic(points, k, lambda) {
    var data = points.filter(function (p) { return p.finite && label(p.classIndex, k); });
    if (new Set(data.map(function (p) { return p.classIndex; })).size !== k) throw new Error("Every class needs finite training descriptors.");
    var dim = data[0].coords.length;
    var scale = Array.from({ length: dim }, function (_, j) { return data.reduce(function (m, p) { return Math.max(m, Math.abs(p.coords[j])); }, 0) || 1; });
    var mu = scale.map(function (s, j) { return mean(data.map(function (p) { return p.coords[j] / s; })); });
    var sd = scale.map(function (s, j) { return Math.sqrt(mean(data.map(function (p) { return Math.pow(p.coords[j] / s - mu[j], 2); }))) || 1; });
    var x = data.map(function (p) { return [1].concat(p.coords.map(function (v, j) { return (v / scale[j] - mu[j]) / sd[j]; })); });
    if (k === 2) return Object.assign({ type: "logistic", scale: scale, mean: mu, sd: sd, lambda: lambda,
      nTrain: data.length, invalidTrain: points.length - data.length }, binaryNewton(x, data, lambda));
    var w = Array.from({ length: k }, function () { return Array(dim + 1).fill(0); });
    // A global Hessian bound uses mean squared row norm (not maximum).
    var step = 1 / (0.5 * mean(x.map(function (r) { return r.reduce(function (s, v) { return s + v * v; }, 0); })) + lambda);
    var converged = false, iteration, norm;
    for (iteration = 0; iteration < 4000; iteration++) {
      var g = w.map(function (r) { return r.map(function (v, j) { return j ? lambda * v : 0; }); });
      x.forEach(function (r, i) {
        var prob = softmax(w.map(function (a) { return a.reduce(function (s, v, j) { return s + v * r[j]; }, 0); }));
        for (var c = 0; c < k; c++) for (var j = 0; j <= dim; j++) g[c][j] += (prob[c] - (data[i].classIndex === c ? 1 : 0)) * r[j] / data.length;
      });
      norm = Math.sqrt(g.reduce(function (s, a) { return s + a.reduce(function (t, v) { return t + v * v; }, 0); }, 0));
      if (norm < 1e-7) { converged = true; break; }
      w.forEach(function (a, c) { a.forEach(function (_, j) { w[c][j] -= step * g[c][j]; }); });
    }
    return { type: "logistic", weights: w, scale: scale, mean: mu, sd: sd, lambda: lambda, nTrain: data.length,
      invalidTrain: points.length - data.length, iterations: iteration, converged: converged, gradientNorm: norm, optimizer: "full-batch gradient descent (multinomial)" };
  }
  function logisticPredict(fit, coords, positiveClass, threshold) {
    if (!coords.every(Number.isFinite)) return { yPred: null, status: "invalid" };
    var x = [1].concat(coords.map(function (v, j) { return (v / fit.scale[j] - fit.mean[j]) / fit.sd[j]; }));
    var scores = fit.weights.map(function (w) { return w.reduce(function (s, v, j) { return s + v * x[j]; }, 0); });
    if (!scores.every(Number.isFinite)) return { yPred: null, status: "invalid" };
    var probabilities = softmax(scores), pred = probabilities.indexOf(Math.max.apply(null, probabilities));
    if (probabilities.length === 2) pred = probabilities[positiveClass] >= threshold ? positiveClass : 1 - positiveClass;
    // Binary log-odds avoid saturation-induced probability ties in ROC.
    var ranking = scores.length === 2 ? [scores[0] - scores[1], scores[1] - scores[0]] : probabilities.slice();
    return { yPred: pred, status: "accepted", probabilities: probabilities, scores: ranking };
  }

  function curves(truth, scores) {
    var rows = truth.map(function (y, i) { return { y: y, score: scores[i] }; }).filter(function (r) { return (r.y === 0 || r.y === 1) && Number.isFinite(r.score); });
    var pos = rows.filter(function (r) { return r.y === 1; }).length, neg = rows.length - pos;
    if (!pos || !neg) return { available: false, reason: "ROC / AP require both positive and negative labelled samples with finite scores.", n: rows.length };
    rows.sort(function (a, b) { return b.score - a.score; });
    var roc = [[0, 0]], pr = [[0, 1]], thresholds = [null], tp = 0, fp = 0, auc = 0, ap = 0;
    for (var i = 0; i < rows.length;) {
      var score = rows[i].score, oldTp = tp, oldFp = fp;
      while (i < rows.length && rows[i].score === score) { if (rows[i].y) tp++; else fp++; i++; }
      auc += (fp - oldFp) / neg * (tp + oldTp) / (2 * pos);
      ap += (tp - oldTp) / pos * tp / (tp + fp);
      roc.push([fp / neg, tp / pos]); pr.push([tp / pos, tp / (tp + fp)]); thresholds.push(score);
    }
    return { available: true, n: rows.length, positives: pos, negatives: neg, prevalence: pos / rows.length, auc: auc, ap: ap, roc: roc, pr: pr, thresholds: thresholds };
  }
  function classificationMetrics(rows, k, positiveClass) {
    var cm = Array.from({ length: k }, function () { return Array(k + 1).fill(0); });
    var labelled = 0, accepted = 0, correct = 0, statuses = {};
    rows.forEach(function (r) {
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      if (!label(r.yTrue, k)) return;
      labelled++; var p = label(r.yPred, k) ? r.yPred : k;
      cm[r.yTrue][p]++;
      if (p < k) { accepted++; if (p === r.yTrue) correct++; }
    });
    var perClass = cm.map(function (r, c) {
      var support = r.reduce(function (s, n) { return s + n; }, 0), predicted = cm.reduce(function (s, a) { return s + a[c]; }, 0), tp = r[c];
      return { classIndex: c, support: support, tp: tp, fp: predicted - tp, fn: support - tp,
        precision: predicted ? tp / predicted : 0, recall: ratio(tp, support), f1: support + predicted ? 2 * tp / (support + predicted) : null };
    });
    var predictedCounts = Array.from({ length: k + 1 }, function (_, c) { return cm.reduce(function (s, r) { return s + r[c]; }, 0); });
    var supportCounts = perClass.map(function (r) { return r.support; }).concat(0);
    var dot = predictedCounts.reduce(function (s, p, i) { return s + p * supportCounts[i]; }, 0);
    var den = Math.sqrt((labelled * labelled - predictedCounts.reduce(function (s, p) { return s + p * p; }, 0)) *
      (labelled * labelled - supportCounts.reduce(function (s, p) { return s + p * p; }, 0)));
    var allPresent = perClass.every(function (r) { return r.support > 0; });
    var out = { n: rows.length, labelled: labelled, accepted: accepted, rejected: labelled - accepted, unlabelled: rows.length - labelled,
      statuses: statuses, confusion: cm, normalized: cm.map(function (r, c) { return r.map(function (n) { return ratio(n, perClass[c].support); }); }), perClass: perClass,
      accuracy: ratio(correct, labelled), selectiveAccuracy: ratio(correct, accepted), coverage: ratio(rows.filter(function (r) { return label(r.yPred, k); }).length, rows.length),
      balancedAccuracy: allPresent ? mean(perClass.map(function (r) { return r.recall; })) : null,
      macroF1: allPresent ? mean(perClass.map(function (r) { return r.f1; })) : null,
      mcc: den ? (correct * labelled - dot) / den : null };
    out.ranking = Array.from({ length: k }, function (_, c) {
      return curves(rows.map(function (r) { return label(r.yTrue, k) ? Number(r.yTrue === c) : null; }), rows.map(function (r) { return r.scores ? r.scores[c] : NaN; }));
    });
    var chosen = out.ranking[positiveClass];
    out.auc = chosen && chosen.available ? chosen.auc : null; out.ap = chosen && chosen.available ? chosen.ap : null;
    if (k === 2) {
      var other = 1 - positiveClass;
      out.binary = { tp: cm[positiveClass][positiveClass], fn: cm[positiveClass][other], fp: cm[other][positiveClass], tn: cm[other][other],
        rejectedPositive: cm[positiveClass][k], rejectedNegative: cm[other][k] };
    }
    var probRows = rows.filter(function (r) { return label(r.yTrue, k) && validProb(r.probabilities, k); });
    out.probabilityN = probRows.length;
    out.brier = mean(probRows.map(function (r) { return r.probabilities.reduce(function (s, p, c) { return s + Math.pow(p - Number(r.yTrue === c), 2); }, 0) / (k === 2 ? 2 : 1); }));
    out.logLoss = mean(probRows.map(function (r) { return -Math.log(Math.max(1e-15, r.probabilities[r.yTrue])); }));
    out.reliability = Array.from({ length: 10 }, function (_, b) {
      var bin = probRows.filter(function (r) { return Math.min(9, Math.floor(r.probabilities[positiveClass] * 10)) === b; });
      return { lower: b / 10, upper: (b + 1) / 10, n: bin.length, probability: mean(bin.map(function (r) { return r.probabilities[positiveClass]; })), frequency: mean(bin.map(function (r) { return Number(r.yTrue === positiveClass); })) };
    });
    return out;
  }
  function validProb(p, k) { return Array.isArray(p) && p.length === k && p.every(function (v) { return Number.isFinite(v) && v >= 0 && v <= 1; }) && Math.abs(p.reduce(function (s, v) { return s + v; }, 0) - 1) < 1e-8; }
  function regressionMetrics(rows, tolerance) {
    var finite = rows.filter(function (r) { return Number.isFinite(r.yTrue) && Number.isFinite(r.yPred) && Number.isFinite(r.yPred - r.yTrue); });
    var errors = finite.map(function (r) { return r.yPred - r.yTrue; }), abs = errors.map(Math.abs);
    var metrics = finite.length ? Core.computeMetrics(finite.map(function (r) { return r.yTrue; }), finite.map(function (r) { return r.yPred; })) : {};
    var out = { n: rows.length, valid: finite.length, invalid: rows.length - finite.length, coverage: ratio(finite.length, rows.length) };
    ["rmse", "mae", "maxae", "r2", "rho"].forEach(function (key) { out[key] = Number.isFinite(metrics[key]) ? metrics[key] : null; });
    out.bias = mean(errors); out.medianAE = quantile(abs, 0.5); out.p90AE = quantile(abs, 0.9); out.p95AE = quantile(abs, 0.95);
    out.toleranceRate = tolerance === null ? null : ratio(abs.filter(function (e) { return e <= tolerance; }).length, abs.length);
    var baseline = finite.every(function (r) { return Number.isFinite(r.baseline); }) ? mean(finite.map(function (r) { return Math.pow(r.baseline - r.yTrue, 2); })) : null;
    out.baselineSkill = baseline > 0 ? 1 - mean(errors.map(function (e) { return e * e; })) / baseline : null;
    return out;
  }

  function bootstrap(rows, metricFn, keys, repeats, seed) {
    if (!repeats || rows.length < 2) return null;
    // Group resampling when every row has a group; otherwise IID rows.
    var grouped = rows.every(function (r) { return typeof r.group === "string" && r.group.length; }), groups = new Map();
    rows.forEach(function (r, i) { var key = grouped ? r.group : String(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    var units = Array.from(groups.values()), samples = {};
    if (units.length < 2) return { unavailable: "At least two independent resampling units are required." };
    keys.forEach(function (k) { samples[k] = []; });
    var rng = seed >>> 0;
    function random() { rng += 0x6D2B79F5; var t = rng; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    for (var b = 0; b < repeats; b++) {
      var sample = [];
      for (var i = 0; i < units.length; i++) sample.push.apply(sample, units[Math.floor(random() * units.length)]);
      var m = metricFn(sample);
      keys.forEach(function (k) { if (Number.isFinite(m[k])) samples[k].push(m[k]); });
    }
    var intervals = {};
    keys.forEach(function (key) { intervals[key] = { validReplicates: samples[key].length,
      low: quantile(samples[key], 0.025), high: quantile(samples[key], 0.975) }; });
    return { method: grouped ? "group percentile bootstrap" : "IID percentile bootstrap", confidence: 0.95, repeats: repeats, seed: seed,
      units: units.length, conditionalOnFrozenModel: true, intervals: intervals };
  }
  function summarize(rows, task, classes, c) { return task === "classification" ? classificationMetrics(rows, classes.length, c.positiveClass) : regressionMetrics(rows, c.tolerance); }
  function report(rows, task, classes, c, manifest) {
    var metrics = summarize(rows, task, classes, c);
    var keys = registry.filter(function (r) { return r.task === task || r.task === "both"; }).map(function (r) { return r.key; });
    return { schemaVersion: VERSION, taskType: task, classes: classes || [], config: c, manifest: manifest, rows: rows, metrics: metrics,
      unavailable: keys.filter(function (k) { return metrics[k] === null; }).map(function (k) { var m = registry.find(function (r) { return r.key === k; }); return { metric: k, requires: m.requires }; }),
      uncertainty: bootstrap(rows, function (sample) { return summarize(sample, task, classes, c); }, keys, c.bootstrap, c.seed) };
  }
  function evaluate(result, model, input) {
    var c = config(input), task = result.taskType === "classification" ? "classification" : "regression";
    var data = Core.datasetData(result, c.dataset);
    if (!data) throw new Error("Selected dataset is unavailable.");
    if (c.dataset === "train" || /^t\d+$/.test(c.dataset)) c.role = "train";
    var classes = result.classes || [], fit = null, rows;
    if (task === "classification") {
      if (!label(c.positiveClass, classes.length)) throw new Error("Choose a valid positive class.");
      var train = Classification.projectModel(result, model, "train");
      fit = c.method === "geometry" ? fitGeometry(train, classes.length, result.meta.sissoIn.descDim, result.meta.sissoIn.isconvex) : fitLogistic(train, classes.length, c.lambda);
      rows = Classification.projectModel(result, model, c.dataset).map(function (p) {
        var prediction = fit.type === "geometry" ? geometryPredict(fit, p.coords) : logisticPredict(fit, p.coords, c.positiveClass, c.threshold);
        return Object.assign({ id: p.name, yTrue: p.classIndex, coords: p.coords, officialClassified: p.classified,
          correct: label(p.classIndex, classes.length) && prediction.yPred !== null ? p.classIndex === prediction.yPred : null }, prediction);
      });
    } else {
      var prediction = Core.modelPrediction(model, c.dataset), target = result.meta.targetLetter;
      if (!prediction || prediction.length !== data.n) throw new Error("Missing or misaligned model predictions.");
      if (c.dataset === "train" && result.tasks) {
        prediction = Array.from(prediction);
        result.tasks.forEach(function (t) { if (!Core.modelPrediction(model, t.key)) for (var i = 0; i < t.data.n; i++) prediction[t.start + i] = NaN; });
      }
      var training = /^t\d+$/.test(c.dataset) ? data : result.train;
      var baseline = mean(Array.from(training.cols[target]).filter(Number.isFinite));
      var baselineByRow = null;
      if (c.dataset === "train" && result.tasks) {
        baselineByRow = [];
        result.tasks.forEach(function (t) { var m = mean(Array.from(t.data.cols[target]).filter(Number.isFinite)); for (var i = 0; i < t.data.n; i++) baselineByRow.push(m); });
      }
      // Native MT-SISSO has no held-out task mapping. SISSO++ imports retain
      // that mapping explicitly, so each test row uses its own task baseline.
      if (c.dataset === "verify" && result.tasks && result.meta.sourceEngine === "SISSO++") {
        var taskIndices = result.meta.sissoPlusPlus.verifyTaskIndices;
        if (!Core.validateVerifyTasks(taskIndices, result.tasks.length, data.n)) throw new Error("Missing verification task mapping.");
        var taskMeans = result.tasks.map(function (t) { return mean(Array.from(t.data.cols[target]).filter(Number.isFinite)); });
        baselineByRow = taskIndices.map(function (t) { return taskMeans[t]; });
      }
      rows = data.names.map(function (id, i) { var y = data.cols[target][i], p = prediction[i];
        return { id: id, yTrue: y, yPred: p, residual: p - y, baseline: baselineByRow ? baselineByRow[i] : baseline,
          status: Number.isFinite(y) && Number.isFinite(p) && Number.isFinite(p - y) ? "accepted" : "invalid" }; });
    }
    var trainIds = new Set(result.train.names), overlap = c.dataset === "verify" ? rows.filter(function (r) { return trainIds.has(r.id); }).length : rows.length;
    var manifest = { evaluatorVersion: VERSION, modelRank: model.rank, descriptors: model.descriptors,
      formulaOriginal: model.formulaOriginal || null, formulasOriginalByTask: model.formulasOriginalByTask || null,
      columns: result.columns || null,
      method: task === "classification" ? (c.method === "geometry" ? "Training-domain rejection classifier" : "SISSO descriptors + auxiliary multinomial logistic regression") : "Fixed SISSO regression",
      dataset: c.dataset, declaredRole: c.dataset === "train" || /^t\d+$/.test(c.dataset) ? "train" : c.role,
      trainingIds: result.train.names, evaluationIds: data.names, idOverlapWithTrain: overlap, fit: fit,
      warnings: ["Dataset roles are user declarations, not proof of independence. Selecting models or thresholds on verification data makes it validation data."] };
    if (fit && fit.converged === false) manifest.warnings.push("Logistic optimizer reached its iteration limit; inspect gradientNorm before using its scores.");
    if (result.meta.multiTask) manifest.warnings.push("Pooled multi-task metrics mix target distributions; inspect each task separately. Baselines use each task's training mean.");
    if (overlap && c.dataset === "verify") manifest.warnings.push("Evaluation IDs overlap training IDs; independent-test interpretation is not justified.");
    var out = report(rows, task, classes, c, manifest);
    if (task === "regression") {
      var trainData = /^t\d+$/.test(c.dataset) ? data : result.train;
      var featureKeys = Object.keys(trainData.cols).filter(function (key) { return key !== result.meta.targetLetter && typeof trainData.cols[key][0] === "number"; });
      var ranges = {};
      featureKeys.forEach(function (key) {
        var values = Array.from(trainData.cols[key]).filter(Number.isFinite);
        ranges[key] = values.length ? values.reduce(function (range, v) { return [Math.min(range[0], v), Math.max(range[1], v)]; }, [Infinity, -Infinity]) : null;
      });
      rows.forEach(function (r, i) {
        var invalid = featureKeys.some(function (key) { return !ranges[key] || !data.cols[key] || !Number.isFinite(data.cols[key][i]); });
        r.domain = invalid ? "invalid" : featureKeys.some(function (key) { return data.cols[key][i] < ranges[key][0] || data.cols[key][i] > ranges[key][1]; }) ? "outside" : "inside";
      });
      out.applicability = { ranges: ranges, outside: rows.filter(function (r) { return r.domain === "outside"; }).length,
        invalid: rows.filter(function (r) { return r.domain === "invalid"; }).length };
    }
    return out;
  }

  // Import predictions produced outside the browser, including complete-pipeline
  // out-of-fold runs. Strict IDs prevent row-position joins and accidental leakage.
  function validateBundle(doc) {
    if (!doc || doc.schemaVersion !== 1 || ["regression", "classification"].indexOf(doc.taskType) < 0 || typeof doc.modelId !== "string" || !doc.modelId.trim()) throw new Error("Expected schemaVersion=1, taskType and modelId.");
    if (!Array.isArray(doc.trainingIds) || new Set(doc.trainingIds).size !== doc.trainingIds.length || doc.trainingIds.some(function (id) { return typeof id !== "string" || !id; })) throw new Error("trainingIds must contain unique nonempty strings.");
    var k = (doc.classes || []).length;
    if (doc.taskType === "classification" && (k < 2 || doc.classes.some(function (s) { return typeof s !== "string" || !s; }) || new Set(doc.classes).size !== k)) throw new Error("Classification requires unique class names in score-column order.");
    if (!Array.isArray(doc.datasets) || !doc.datasets.length) throw new Error("No prediction datasets supplied.");
    var ids = new Set(), seenRows = new Set(), training = new Set(doc.trainingIds), groupDatasets = new Map();
    doc.datasets.forEach(function (d) {
      if (!d || typeof d.id !== "string" || !d.id || ids.has(d.id) || ["validation", "test", "calibration", "train", "fold"].indexOf(d.role) < 0 || !Array.isArray(d.rows) || !d.rows.length) throw new Error("Invalid dataset ID, role or rows.");
      ids.add(d.id);
      var local = new Set(), foldTraining = null;
      if (d.role === "fold") {
        if (!Array.isArray(d.trainingIds) || ["within-fold", "fixed"].indexOf(d.descriptorSelection) < 0) throw new Error("Each fold needs trainingIds and descriptorSelection (within-fold or fixed).");
        if (d.trainingIds.some(function (id) { return typeof id !== "string" || !id; }) || new Set(d.trainingIds).size !== d.trainingIds.length) throw new Error("Invalid fold training IDs.");
        foldTraining = new Set(d.trainingIds);
      }
      d.rows.forEach(function (r) {
        if (!r || typeof r.id !== "string" || !r.id || local.has(r.id)) throw new Error("Missing or duplicate sample ID.");
        local.add(r.id);
        if (d.role !== "train") {
          if (seenRows.has(r.id)) throw new Error("Evaluation / calibration / fold IDs must be disjoint; repeated CV must be imported as separate bundles.");
          seenRows.add(r.id);
          if ((foldTraining || training).has(r.id)) throw new Error("Evaluation IDs overlap their declared training IDs.");
        }
        if (r.group !== undefined && (typeof r.group !== "string" || !r.group)) throw new Error("group must be a nonempty string.");
        if (r.group !== undefined) {
          if (groupDatasets.has(r.group) && groupDatasets.get(r.group) !== d.id) throw new Error("Groups overlap between datasets; use disjoint groups for calibration/evaluation/folds.");
          groupDatasets.set(r.group, d.id);
        }
        if (d.role === "train" && !training.has(r.id)) throw new Error("Training rows must be listed in trainingIds.");
        if (doc.taskType === "regression") {
          if (r.yTrue !== null && !Number.isFinite(r.yTrue) || r.yPred !== null && !Number.isFinite(r.yPred)) throw new Error("Regression truth/prediction must be numbers or null.");
          if (r.baseline !== undefined && !Number.isFinite(r.baseline)) throw new Error("Invalid baseline prediction.");
        } else {
          if (r.yTrue !== null && !label(r.yTrue, k) || r.yPred !== null && !label(r.yPred, k)) throw new Error("Class indices must be zero-based integers or null.");
          if (r.probabilities !== undefined && !validProb(r.probabilities, k)) throw new Error("Invalid probability vector.");
          if (r.scores !== undefined && (!Array.isArray(r.scores) || r.scores.length !== k || !r.scores.every(Number.isFinite))) throw new Error("Invalid class score vector.");
        }
      });
      if (d.rows.some(function (r) { return r.group !== undefined; }) && !d.rows.every(function (r) { return r.group !== undefined; })) throw new Error("Provide groups for every row or no rows.");
    });
    return doc;
  }
  function conformal(calibration, rows, task, k, alpha) {
    var scores = calibration.map(function (r) { return task === "regression" ? (Number.isFinite(r.yTrue) && Number.isFinite(r.yPred) ? Math.abs(r.yPred - r.yTrue) : null) : (label(r.yTrue, k) && validProb(r.probabilities, k) ? 1 - r.probabilities[r.yTrue] : null); });
    if (!scores.length || scores.some(function (s) { return s === null || !Number.isFinite(s); })) return { available: false, reason: "Every calibration row needs a finite labelled prediction (probabilities for classification)." };
    scores.sort(function (a, b) { return a - b; });
    var rank = Math.ceil((scores.length + 1) * (1 - alpha)), q = rank > scores.length ? Infinity : scores[rank - 1];
    var outputs = rows.map(function (r) {
      if (task === "regression") return { id: r.id, lower: Number.isFinite(r.yPred) && Number.isFinite(q) ? r.yPred - q : null,
        upper: Number.isFinite(r.yPred) && Number.isFinite(q) ? r.yPred + q : null, unbounded: !Number.isFinite(q),
        covered: Number.isFinite(r.yTrue) && Number.isFinite(r.yPred) ? Math.abs(r.yTrue - r.yPred) <= q : null };
      var set = validProb(r.probabilities, k) ? r.probabilities.map(function (p, c) { return 1 - p <= q ? c : -1; }).filter(function (c) { return c >= 0; }) : null;
      return { id: r.id, set: set, covered: set && label(r.yTrue, k) ? set.indexOf(r.yTrue) >= 0 : null };
    });
    return { available: true, alpha: alpha, calibrationN: scores.length, quantileRank: rank, q: Number.isFinite(q) ? q : null, unbounded: !Number.isFinite(q),
      coverage: mean(outputs.filter(function (o) { return o.covered !== null; }).map(function (o) { return Number(o.covered); })),
      evaluatedN: outputs.filter(function (o) { return o.covered !== null; }).length,
      width: task === "regression" && Number.isFinite(q) ? 2 * q : null,
      meanSetSize: task === "classification" ? mean(outputs.filter(function (o) { return o.set; }).map(function (o) { return o.set.length; })) : null,
      assumption: "Frozen model and preprocessing; independent exchangeable calibration/evaluation samples. Dataset declarations cannot verify these assumptions.", rows: outputs };
  }
  function evaluateBundle(doc, datasetId, input) {
    validateBundle(doc); var c = config(input), d = doc.datasets.find(function (d) { return d.id === datasetId; });
    if (!d) throw new Error("Unknown prediction dataset.");
    var classes = doc.classes || [], k = classes.length;
    if (doc.taskType === "classification" && !label(c.positiveClass, k)) throw new Error("Invalid positive class.");
    c.role = d.role === "fold" ? "validation" : d.role; c.dataset = d.id;
    var rows = d.rows.map(function (r) { return Object.assign({}, r, { status: r.yPred === null ? "rejected" : "accepted",
      correct: doc.taskType === "classification" && r.yTrue !== null && r.yPred !== null ? r.yTrue === r.yPred : null,
      residual: doc.taskType === "regression" && Number.isFinite(r.yTrue) && Number.isFinite(r.yPred) ? r.yPred - r.yTrue : null,
      scores: r.scores || r.probabilities }); });
    var out = report(rows, doc.taskType, classes, c, { evaluatorVersion: VERSION, modelId: doc.modelId, method: "Imported frozen predictions",
      declaredRole: d.role, trainingIds: d.trainingIds || doc.trainingIds, descriptorSelection: d.descriptorSelection || null,
      warnings: ["Provenance is user-declared. Full SISSO cross-validation requires descriptor selection inside each training fold.", "Bootstrap intervals condition on frozen predictions; they do not account for model selection."] });
    var calibration = doc.datasets.filter(function (r) { return r.role === "calibration"; });
    out.conformal = { available: false, reason: "Supply exactly one separate calibration dataset and declare exchangeable=true and frozenBeforeCalibration=true; evaluation must be validation/test." };
    if (calibration.length === 1 && ["test", "validation"].indexOf(d.role) >= 0 && doc.exchangeable === true && doc.frozenBeforeCalibration === true) {
      out.conformal = conformal(calibration[0].rows, rows, doc.taskType, k, c.alpha);
    }
    out.folds = doc.datasets.filter(function (d) { return d.role === "fold"; }).map(function (f) { return { id: f.id, descriptorSelection: f.descriptorSelection,
      metrics: summarize(f.rows.map(function (r) { return Object.assign({}, r, { status: r.yPred === null ? "rejected" : "accepted", scores: r.scores || r.probabilities }); }), doc.taskType, classes, c) }; });
    return out;
  }
  function csv(report) {
    var columns = ["id", "yTrue", "yPred", "correct", "status", "officialClassified", "residual", "baseline", "domain", "coords", "scores", "probabilities", "group"];
    function cell(v) { if (v === null || v === undefined || typeof v === "number" && !Number.isFinite(v)) return "";
      var s = Array.isArray(v) ? JSON.stringify(v) : String(v);
      // Spreadsheet formula injection protection for user-controlled strings.
      if (typeof v === "string" && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"'; }
    return [columns.join(",")].concat(report.rows.map(function (r) { return columns.map(function (k) { return cell(r[k]); }).join(","); })).join("\r\n");
  }
  return { VERSION: VERSION, registry: registry, config: config, fitGeometry: fitGeometry, geometryPredict: geometryPredict,
    fitLogistic: fitLogistic, logisticPredict: logisticPredict, curves: curves, classificationMetrics: classificationMetrics,
    regressionMetrics: regressionMetrics, bootstrap: bootstrap, evaluate: evaluate, validateBundle: validateBundle,
    evaluateBundle: evaluateBundle, conformal: conformal, csv: csv };
});
