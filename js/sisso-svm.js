/* Optional, training-only RBF C-SVC evaluation in two-descriptor space. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-classification.js"));
  else root.SissoSVM = factory(root.SissoClassification);
})(typeof self !== "undefined" ? self : this, function (Classification) {
  "use strict";

  var METRICS = ["accuracy", "balancedAccuracy", "macroF1"];

  function options(value) {
    value = value || {};
    var cost = value.cost === undefined ? 1 : Number(value.cost);
    var gamma = value.gamma === undefined || value.gamma === "scale" ? "scale" : Number(value.gamma);
    var complexity = value.complexity === undefined ? 3 : Number(value.complexity);
    if (!Number.isFinite(cost) || cost < 1e-6 || cost > 1e6 ||
        gamma !== "scale" && (!Number.isFinite(gamma) || gamma < 1e-6 || gamma > 1e6)) {
      throw new Error("svmInvalidOptions");
    }
    if (!Number.isInteger(complexity) || complexity < 1 || complexity > 5) throw new Error("svmInvalidComplexity");
    return { cost: cost, gamma: gamma, complexity: complexity };
  }

  function validPoint(p) {
    return p && p.coords && p.coords.length === 2 && p.coords.every(Number.isFinite);
  }

  // Work in units of each training column's largest magnitude first. This
  // avoids overflowing a mean/variance when SISSO expressions have large units.
  function fitScaler(points) {
    var units = [0, 0], means = [0, 0], scales = [0, 0];
    points.forEach(function (p) {
      for (var d = 0; d < 2; d++) units[d] = Math.max(units[d], Math.abs(p.coords[d]));
    });
    units = units.map(function (v) { return v || 1; });
    points.forEach(function (p) {
      for (var d = 0; d < 2; d++) means[d] += p.coords[d] / units[d];
    });
    means = means.map(function (v) { return v / points.length; });
    points.forEach(function (p) {
      for (var d = 0; d < 2; d++) scales[d] += Math.pow(p.coords[d] / units[d] - means[d], 2) / points.length;
    });
    scales = scales.map(function (v) { return Math.sqrt(v) || 1; });
    return { units: units, means: means, scales: scales };
  }

  function transform(coords, scaler) {
    return coords.map(function (v, d) { return (v / scaler.units[d] - scaler.means[d]) / scaler.scales[d]; });
  }

  function measure(labels, predicted, nClasses) {
    if (!labels.length || predicted.length !== labels.length) throw new Error("svmInvalidLabels");
    var actual = Array(nClasses).fill(0), guesses = Array(nClasses).fill(0), hits = Array(nClasses).fill(0);
    labels.forEach(function (c, i) {
      var p = predicted[i];
      if (!Number.isInteger(c) || c < 0 || c >= nClasses || !Number.isInteger(p) || p < 0 || p >= nClasses) {
        throw new Error("svmInvalidLabels");
      }
      actual[c]++; guesses[p]++;
      if (c === p) hits[c]++;
    });
    var recall = 0, f1 = 0, present = 0;
    for (var c = 0; c < nClasses; c++) {
      if (actual[c]) { recall += hits[c] / actual[c]; present++; }
      f1 += actual[c] + guesses[c] ? 2 * hits[c] / (actual[c] + guesses[c]) : 0;
    }
    var correct = hits.reduce(function (a, b) { return a + b; }, 0);
    return { n: labels.length, correct: correct, accuracy: correct / labels.length,
      balancedAccuracy: recall / present, macroF1: f1 / nClasses };
  }

  function trainModel(result, model, config, SVM) {
    if (result.meta.sissoIn.descDim !== 2) throw new Error("svmOnly2D");
    config = options(config);
    var train = Classification.projectModel(result, model, "train"), nClasses = result.classes.length;
    if (!train.length || !train.every(validPoint)) throw new Error("svmInvalidCoordinates");
    var scaler = fitScaler(train), x = train.map(function (p) { return transform(p.coords, scaler); });
    var labels = train.map(function (p) { return p.classIndex; });
    if (new Set(labels).size !== nClasses || nClasses < 2) throw new Error("svmInvalidLabels");
    var variance = x.reduce(function (sum, p) { return sum + (p[0] * p[0] + p[1] * p[1]) / x.length; }, 0);
    var baseGamma = config.gamma === "scale" ? (variance ? 1 / variance : 1) : config.gamma;
    var gamma = baseGamma * Math.pow(4, config.complexity - 3);
    var classifier = new SVM({ type: SVM.SVM_TYPES.C_SVC, kernel: SVM.KERNEL_TYPES.RBF,
      cost: config.cost, gamma: gamma, tolerance: 0.001, cacheSize: 16, quiet: true,
      shrinking: true, probabilityEstimates: false });
    try {
      classifier.train(x, labels);
      var summary = { rank: model.rank, status: "ready",
        fit: { serialized: classifier.serializeModel(), scaler: scaler, cost: config.cost,
          gamma: gamma, baseGamma: baseGamma, complexity: config.complexity },
        train: measure(labels, classifier.predict(x), nClasses), verify: null, verifyIssue: null };
      if (result.verify) {
        summary.verifyIssue = "svmVerificationLabels";
        if (Classification.hasVerificationLabels(result)) {
          var verify = Classification.projectModel(result, model, "verify");
          var vx = verify.map(function (p) { return transform(p.coords, scaler); });
          if (verify.every(validPoint) && vx.every(function (p) { return p.every(Number.isFinite); })) {
            summary.verify = measure(verify.map(function (p) { return p.classIndex; }), classifier.predict(vx), nClasses);
            summary.verifyIssue = null;
          } else summary.verifyIssue = "svmInvalidVerification";
        }
      }
      return summary;
    } finally { classifier.free(); }
  }

  function domain(points) {
    points = points.filter(validPoint);
    if (!points.length) return [[-1, 1], [-1, 1]];
    return [0, 1].map(function (d) {
      var unit = points.reduce(function (v, p) { return Math.max(v, Math.abs(p.coords[d])); }, 0) || 1;
      var lo = Infinity, hi = -Infinity;
      points.forEach(function (p) { lo = Math.min(lo, p.coords[d] / unit); hi = Math.max(hi, p.coords[d] / unit); });
      var pad = (hi - lo || 1) * 0.08;
      return [Math.max(-Number.MAX_VALUE, (lo - pad) * unit), Math.min(Number.MAX_VALUE, (hi + pad) * unit)];
    });
  }

  // Evaluate the actual LIBSVM decision functions, not interpolated class IDs.
  // Binary: f(z) = sum_i coefficient_i exp(-gamma ||z - SV_i||²) - rho.
  // Multiclass: LIBSVM stores one coefficient column per other category, with
  // support vectors grouped by category. Its vote rule uses every i-vs-j f_ij.
  function decisionFunction(fit) {
    var lines = fit.serialized.trim().split(/\r?\n/), header = {}, at = 0;
    for (; at < lines.length && lines[at] !== "SV"; at++) {
      var cells = lines[at].trim().split(/\s+/); header[cells.shift()] = cells;
    }
    var n = Number(header.nr_class && header.nr_class[0]);
    if (!header.kernel_type || header.kernel_type[0] !== "rbf" || !header.svm_type || header.svm_type[0] !== "c_svc" ||
        !Number.isInteger(n) || n < 2 || at === lines.length) {
      throw new Error("svmInvalidModel");
    }
    var labels = (header.label || []).map(Number), counts = (header.nr_sv || []).map(Number);
    var rho = (header.rho || []).map(Number), gamma = Number((header.gamma || [])[0]);
    var vectors = [], coefficients = [], starts = [], pairs = [];
    lines.slice(at + 1).forEach(function (line) {
      var parts = line.trim().split(/\s+/), coefs = parts.slice(0, n - 1).map(Number), coords = [0, 0];
      parts.slice(n - 1).forEach(function (part) {
        var item = part.split(":"), index = Number(item[0]);
        if (item.length !== 2 || !Number.isInteger(index) || index < 1 || index > 2) throw new Error("svmInvalidModel");
        coords[index - 1] = Number(item[1]);
      });
      if (coefs.length !== n - 1 || !coefs.every(Number.isFinite) || !coords.every(Number.isFinite)) throw new Error("svmInvalidModel");
      vectors.push(coords); coefficients.push(coefs);
    });
    if (labels.length !== n || !labels.every(Number.isInteger) || new Set(labels).size !== n || counts.length !== n ||
        !counts.every(function (v) { return Number.isInteger(v) && v >= 0; }) ||
        Number((header.total_sv || [])[0]) !== vectors.length ||
        counts.reduce(function (a, b) { return a + b; }, 0) !== vectors.length ||
        rho.length !== n * (n - 1) / 2 || !rho.every(Number.isFinite) || !Number.isFinite(gamma) || gamma <= 0) {
      throw new Error("svmInvalidModel");
    }
    var start = 0;
    for (var i = 0; i < n; i++) {
      starts.push(start); start += counts[i];
      for (var j = i + 1; j < n; j++) pairs.push([labels[i], labels[j]]);
    }
    var kernels = new Float64Array(vectors.length);
    function evaluate(coords) {
      var z = transform(coords, fit.scaler);
      if (!z.every(Number.isFinite)) throw new Error("svmInvalidCoordinates");
      for (var s = 0; s < vectors.length; s++) {
        var dx = z[0] - vectors[s][0], dy = z[1] - vectors[s][1];
        kernels[s] = Math.exp(-gamma * (dx * dx + dy * dy));
      }
      var values = [], votes = Array(n).fill(0), pair = 0;
      for (var a = 0; a < n; a++) {
        for (var b = a + 1; b < n; b++) {
          var value = -rho[pair++];
          for (var p = starts[a]; p < starts[a] + counts[a]; p++) value += coefficients[p][b - 1] * kernels[p];
          for (var q = starts[b]; q < starts[b] + counts[b]; q++) value += coefficients[q][a] * kernels[q];
          values.push(value); votes[value > 0 ? a : b]++;
        }
      }
      var winner = 0;
      for (var c = 1; c < n; c++) if (votes[c] > votes[winner]) winner = c;
      return { values: values, predicted: labels[winner] };
    }
    evaluate.equations = [];
    for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) {
      var terms = [];
      for (var p = starts[a]; p < starts[a] + counts[a]; p++) terms.push({ coefficient: coefficients[p][b - 1], vector: vectors[p] });
      for (var q = starts[b]; q < starts[b] + counts[b]; q++) terms.push({ coefficient: coefficients[q][a], vector: vectors[q] });
      evaluate.equations.push({ labels: [labels[a], labels[b]], rho: rho[evaluate.equations.length], terms: terms });
    }
    evaluate.gamma = gamma;
    evaluate.labels = labels;
    evaluate.pairs = pairs;
    return evaluate;
  }

  // Marching squares with continuous margins and refined edge roots. The
  // sampling grid controls drawing accuracy; complexity changes the fitted γ.
  function boundary(fit, bounds, resolution) {
    resolution = resolution || 128;
    if (!Number.isInteger(resolution) || resolution < 3 || resolution > 161 || !bounds || bounds.length !== 2 ||
        bounds.some(function (b) { return b.length !== 2 || !b.every(Number.isFinite) || b[0] >= b[1]; })) {
      throw new Error("svmInvalidCoordinates");
    }
    function lerp(a, b, t) { return (1 - t) * a + t * b; }
    var xs = [], ys = [], grid = [], segments = [], edgeCache = new Map(), evaluate = decisionFunction(fit);
    for (var i = 0; i < resolution; i++) {
      xs.push(lerp(bounds[0][0], bounds[0][1], i / (resolution - 1)));
      ys.push(lerp(bounds[1][0], bounds[1][1], i / (resolution - 1)));
    }
    for (var y = 0; y < resolution; y++) grid.push(xs.map(function (x) { return evaluate([x, ys[y]]); }));
    function root(a, b, va, vb, pair, key) {
      if (edgeCache.has(key)) return edgeCache.get(key);
      var point;
      if (va === 0) point = a;
      else if (vb === 0) point = b;
      else {
        // Safeguarded secant/bisection keeps endpoints on f=0 to numerical
        // tolerance, rather than using midpoints of differing class labels.
        var tolerance = Math.max(Math.abs(va), Math.abs(vb)) * 1e-9;
        for (var iteration = 0; iteration < 22; iteration++) {
          var t = Math.max(0.1, Math.min(0.9, Math.abs(va) / (Math.abs(va) + Math.abs(vb))));
          point = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
          var value = evaluate(point).values[pair];
          if (value === 0 || Math.abs(value) <= tolerance) break;
          if ((value >= 0) === (va >= 0)) { a = point; va = value; } else { b = point; vb = value; }
        }
      }
      edgeCache.set(key, point); return point;
    }
    for (var r = 0; r < resolution - 1; r++) {
      for (var c = 0; c < resolution - 1; c++) {
        var corners = [[xs[c], ys[r]], [xs[c + 1], ys[r]], [xs[c + 1], ys[r + 1]], [xs[c], ys[r + 1]]];
        for (var pair = 0; pair < evaluate.pairs.length; pair++) {
          var values = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]].map(function (v) { return v.values[pair]; });
          var edges = [];
          for (var e = 0; e < 4; e++) {
            var next = (e + 1) % 4;
            if ((values[e] >= 0) === (values[next] >= 0)) continue;
            var key = pair + ":" + (e === 0 ? "h:" + r + ":" + c : e === 1 ? "v:" + r + ":" + (c + 1) :
              e === 2 ? "h:" + (r + 1) + ":" + c : "v:" + r + ":" + c);
            edges.push(root(corners[e], corners[next], values[e], values[next], pair, key));
          }
          var candidates = [];
          if (edges.length === 2) candidates.push([edges[0], edges[1]]);
          else if (edges.length === 4) {
            var center = evaluate([lerp(xs[c], xs[c + 1], .5), lerp(ys[r], ys[r + 1], .5)]).values[pair];
            if ((center >= 0) === (values[0] >= 0)) candidates.push([edges[0], edges[1]], [edges[2], edges[3]]);
            else candidates.push([edges[0], edges[3]], [edges[1], edges[2]]);
          }
          candidates.forEach(function (segment) {
            if (evaluate.pairs.length > 1) {
              // Suppress i-vs-j contours hidden inside another winning region.
              var sx = xs[c + 1] - xs[c], sy = ys[r + 1] - ys[r];
              var tx = (segment[1][0] - segment[0][0]) / sx, ty = (segment[1][1] - segment[0][1]) / sy;
              var length = Math.hypot(tx, ty) || 1, nx = -ty / length * sx * .08, ny = tx / length * sy * .08;
              var mx = lerp(segment[0][0], segment[1][0], .5), my = lerp(segment[0][1], segment[1][1], .5);
              if (evaluate([mx + nx, my + ny]).predicted === evaluate([mx - nx, my - ny]).predicted) return;
            }
            segments.push(segment[0].concat(segment[1]));
          });
        }
      }
    }
    return { segments: segments, bounds: bounds, resolution: resolution, kind: "decision-zero", pairs: evaluate.pairs };
  }

  function formulaText(fit, descriptors, classes) {
    var decision = decisionFunction(fit), lines = [];
    (descriptors || []).forEach(function (d, i) { lines.push("d" + (i + 1) + " = " + d.original); });
    for (var d = 0; d < 2; d++) lines.push("z" + (d + 1) + " = (d" + (d + 1) + " / (" + fit.scaler.units[d] + ") - (" + fit.scaler.means[d] + ")) / (" + fit.scaler.scales[d] + ")");
    lines.push("gamma = " + decision.gamma);
    lines.push("Class IDs (zero-based): " + decision.labels.map(function (id) { return id + " = " + (classes && classes[id] ? JSON.stringify(classes[id]) : "Category " + (id + 1)); }).join(", "));
    decision.equations.forEach(function (eq) {
      var name = "f_" + eq.labels.join("_");
      lines.push("", name + "(d1,d2) = " + eq.terms.map(function (t) {
        return "(" + t.coefficient + ") * exp(-(" + decision.gamma + ") * ((z1 - (" + t.vector[0] + "))^2 + (z2 - (" + t.vector[1] + "))^2))";
      }).join(" + ") + " - (" + eq.rho + ")");
      lines.push(name + " > 0: vote for " + eq.labels[0] + "; otherwise: vote for " + eq.labels[1] + ". Boundary: " + name + " = 0.");
    });
    lines.push("", "Prediction: most votes wins; tied votes use this class order: " + decision.labels.join(", ") + ".");
    return lines.join("\n");
  }

  function metric(summary, key) {
    var m = /^svm-(train|verify)-(accuracy|balancedAccuracy|macroF1)$/.exec(key);
    return m && summary && summary.status === "ready" && summary[m[1]] ? summary[m[1]][m[2]] : null;
  }

  function compare(a, b, key, summaries) {
    if (key.indexOf("svm-") !== 0) return a[key] - b[key] || a.rank - b.rank;
    var av = metric(summaries.get(a.rank), key), bv = metric(summaries.get(b.rank), key);
    if (av === null || bv === null) return av === bv ? a.rank - b.rank : av === null ? 1 : -1;
    return bv - av || a.rank - b.rank;
  }

  return { options: options, trainModel: trainModel, measure: measure, transform: transform,
    domain: domain, boundary: boundary, decisionFunction: decisionFunction, formulaText: formulaText, metric: metric, compare: compare, metrics: METRICS };
});
