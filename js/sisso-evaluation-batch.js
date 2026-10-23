/* Candidate screening uses one fixed protocol; validation rankings are not test evidence. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-core.js"), require("./sisso-evaluation.js"));
  else root.SissoEvaluationBatch = factory(root.SissoCore, root.SissoEvaluation);
})(typeof self !== "undefined" ? self : this, function (Core, E) {
  "use strict";
  var METRICS = ["accuracy", "selectiveAccuracy", "coverage", "balancedAccuracy", "macroF1", "mcc", "auc", "ap", "brier", "logLoss", "rmse", "mae", "r2", "p95AE", "bias", "baselineSkill"];
  function finite(v) { return typeof v === "number" && Number.isFinite(v); }
  function compact(m, positiveClass) {
    var out = {};
    METRICS.concat(["n", "labelled", "accepted", "rejected", "unlabelled", "valid", "invalid", "probabilityN"]).forEach(function (key) { out[key] = finite(m[key]) ? m[key] : null; });
    out.confusion = m.confusion || null; out.perClass = m.perClass || null;
    out.scoreN = m.ranking && m.ranking[positiveClass] ? m.ranking[positiveClass].n : 0;
    return out;
  }
  // Reused expressions are evaluated once per dataset. Bounded LRU keeps even
  // runs with many unique features from retaining every candidate's coordinates.
  function projectionCache(result, maxEntries) {
    var cache = new Map(), hits = 0, misses = 0;
    function values(data, dataset, expression) {
      var key = dataset + "\n" + expression;
      if (cache.has(key)) { var found = cache.get(key); cache.delete(key); cache.set(key, found); hits++; return found; }
      misses++;
      var fn = Core.compileFormula(expression), features = {};
      data.featureLetters.forEach(function (letter) { features[letter] = true; });
      var values = new Float64Array(data.n);
      for (var i = 0; i < data.n; i++) values[i] = fn(Core.makeFeatureGetter(data.cols, features, i));
      cache.set(key, values); if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return values;
    }
    return { points: function (model, dataset) {
      var data = Core.datasetData(result, dataset), axes = model.descriptors.map(function (d) { return values(data, dataset, d.renamed); });
      return data.names.map(function (id, i) { var coords = axes.map(function (a) { return a[i]; });
        return { name: id, coords: coords, classIndex: data.labels ? data.labels[i] : null, finite: coords.every(Number.isFinite) }; });
    }, stats: function () { return { hits: hits, misses: misses, retainedEntries: cache.size, maxEntries: maxEntries }; } };
  }
  function predictionRows(points, fit, c) {
    return points.map(function (p) {
      var prediction = fit.type === "geometry" ? E.geometryPredict(fit, p.coords) : E.logisticPredict(fit, p.coords, c.positiveClass, c.threshold);
      return Object.assign({ id: p.name, yTrue: p.classIndex }, prediction);
    });
  }
  async function evaluateAll(result, input, options) {
    options = options || {};
    var c = E.config(input), task = result.taskType === "classification" ? "classification" : "regression";
    var data = Core.datasetData(result, c.dataset);
    if (!data || !result.models || !result.models.length) throw new Error("No candidate models or selected dataset.");
    if (c.dataset === "train" || /^t\d+$/.test(c.dataset)) c.role = "train";
    var methods = task === "classification" ? (input && input.methods || ["geometry", "logistic"]) : ["regression"];
    if (!Array.isArray(methods) || !methods.length || new Set(methods).size !== methods.length || methods.some(function (m) { return (task === "classification" ? ["geometry", "logistic"] : ["regression"]).indexOf(m) < 0; })) throw new Error("Invalid batch prediction methods.");
    if (task === "classification" && (!Number.isInteger(c.positiveClass) || c.positiveClass < 0 || c.positiveClass >= result.classes.length)) throw new Error("Choose a valid positive class.");
    // Screening never multiplies bootstrap work by the number of candidates.
    c.bootstrap = 0;
    var total = result.models.length * methods.length, rows = [], completed = 0, start = Date.now(), cache = projectionCache(result, 1024);
    var models = result.models.slice().sort(function (a, b) { return a.rank - b.rank; });
    if (new Set(models.map(function (m) { return m.rank; })).size !== models.length) throw new Error("Candidate ranks must be unique.");
    function cancelled() { if (options.isCancelled && options.isCancelled()) { var error = new Error("Batch evaluation cancelled."); error.name = "AbortError"; throw error; } }
    function progress(rank, method) { if (options.onProgress) options.onProgress({ completed: completed, total: total, modelRank: rank, method: method, elapsedMs: Date.now() - start }); }
    progress(null, null);
    for (var i = 0; i < models.length; i++) {
      cancelled(); var model = models[i], trainPoints, evaluationPoints, projectionError = null;
      if (task === "classification") {
        try { trainPoints = cache.points(model, "train"); evaluationPoints = c.dataset === "train" ? trainPoints : cache.points(model, c.dataset); }
        catch (error) { projectionError = error.message; }
      }
      for (var j = 0; j < methods.length; j++) {
        cancelled(); var method = methods[j];
        var row = { rank: model.rank, method: method, featureIds: model.featureIds || [], descriptors: model.descriptors.map(function (d) { return d.original; }),
          officialOverlap: finite(model.dataOverlap) ? model.dataOverlap : null, officialSize: finite(model.sizeOverlap) ? model.sizeOverlap : null,
          status: "ok", error: null, fit: null, train: null, evaluation: null, gap: {} };
        try {
          if (projectionError) throw new Error(projectionError);
          if (task === "classification") {
            var fit = method === "geometry" ? E.fitGeometry(trainPoints, result.classes.length, result.meta.sissoIn.descDim, result.meta.sissoIn.isconvex) : E.fitLogistic(trainPoints, result.classes.length, c.lambda);
            row.fit = { converged: fit.converged !== false, iterations: fit.iterations || 0, gradientNorm: fit.gradientNorm || 0, optimizer: fit.optimizer || "training domains", invalidTrain: trainPoints.filter(function (p) { return !p.finite; }).length };
            row.train = compact(E.classificationMetrics(predictionRows(trainPoints, fit, c), result.classes.length, c.positiveClass), c.positiveClass);
            row.evaluation = c.dataset === "train" ? row.train : compact(E.classificationMetrics(predictionRows(evaluationPoints, fit, c), result.classes.length, c.positiveClass), c.positiveClass);
            if (!row.fit.converged) row.status = "nonconverged";
          } else {
            row.train = compact(E.evaluate(result, model, Object.assign({}, c, { dataset: "train", bootstrap: 0 })).metrics, 0);
            row.evaluation = c.dataset === "train" ? row.train : compact(E.evaluate(result, model, c).metrics, 0);
          }
          ["accuracy", "auc", "ap", "rmse", "mae", "r2"].forEach(function (key) { row.gap[key] = finite(row.train[key]) && finite(row.evaluation[key]) ? row.train[key] - row.evaluation[key] : null; });
        } catch (error) { row.status = "error"; row.error = error.message || String(error); }
        rows.push(row); completed++;
        if (completed % 20 === 0 || completed === total) progress(model.rank, method);
      }
      if ((i + 1) % (options.yieldEvery || 10) === 0) { if (options.yieldControl) await options.yieldControl(); else await new Promise(function (resolve) { setTimeout(resolve, 0); }); }
    }
    cancelled();
    return { schemaVersion: 1, kind: "sisso-batch-evaluation", taskType: task, classes: result.classes || [], config: Object.assign({}, c, { methods: methods }), rows: rows,
      manifest: { evaluatorVersion: E.VERSION, modelCount: models.length, methods: methods, expectedRows: data.n, trainingRows: result.train.n,
        evaluationIds: data.names, trainingIds: result.train.names, declaredRole: c.role, interpretation: c.dataset === "train" || /^t\d+$/.test(c.dataset) ? "in-sample screening" : "selection validation",
        elapsedMs: Date.now() - start, cache: cache.stats(), completed: completed, total: total,
        errors: rows.filter(function (r) { return r.status === "error"; }).length, nonconverged: rows.filter(function (r) { return r.status === "nonconverged"; }).length,
        warnings: ["Ranking uses evaluation labels to select among candidates; these data are selection validation, not an independent final test.",
          "One fixed lambda and decision threshold apply to every candidate. Geometry has no ranking scores; ROC/AP require auxiliary or external continuous scores.",
          "No per-candidate bootstrap is run. Inspect shortlisted models separately; their intervals still do not account for selection among many candidates.",
          "AUC/AP ranking excludes incomplete scored cohorts by default. Missing and failed results are retained, never assigned a zero score."] } };
  }
  function value(row, key) { var v = row.evaluation && row.evaluation[key]; return finite(v) ? v : null; }
  function rankRows(batch, input) {
    var c = Object.assign({ metric: batch.taskType === "classification" ? "accuracy" : "rmse", method: "all", minCoverage: 0, includeWarnings: false }, input || {});
    var meta = E.registry.find(function (m) { return m.key === c.metric && (m.task === batch.taskType || m.task === "both"); });
    if (!meta || METRICS.indexOf(c.metric) < 0) throw new Error("Unsupported ranking metric.");
    if (!finite(c.minCoverage) || c.minCoverage < 0 || c.minCoverage > 1) throw new Error("Minimum coverage must be between 0 and 1.");
    var list = batch.rows.filter(function (r) { return c.method === "all" || r.method === c.method; });
    function eligible(row) {
      if (row.status !== "ok" && !c.includeWarnings || row.status === "error" || value(row, c.metric) === null || value(row, "coverage") === null || value(row, "coverage") < c.minCoverage) return false;
      return ["auc", "ap"].indexOf(c.metric) < 0 || row.evaluation.scoreN === row.evaluation.labelled;
    }
    list = list.map(function (r) { return { row: r, eligible: eligible(r) }; });
    function score(row) { var v = value(row, c.metric); return meta.direction === "min" ? -v : meta.direction === "zero" ? -Math.abs(v) : v; }
    list.sort(function (a, b) { return Number(b.eligible) - Number(a.eligible) || (a.eligible && b.eligible ? score(b.row) - score(a.row) : 0) || a.row.rank - b.row.rank || a.row.method.localeCompare(b.row.method); });
    var eligibleN = list.filter(function (r) { return r.eligible; }).length, place = 0, previous = null;
    return { config: c, eligible: eligibleN, excluded: list.length - eligibleN, total: list.length,
      rows: list.map(function (entry, i) { var v = entry.eligible ? score(entry.row) : null;
        if (entry.eligible && (previous === null || v !== previous)) place = i + 1;
        if (entry.eligible) previous = v;
        return { row: entry.row, eligible: entry.eligible, place: entry.eligible ? place : null };
      }) };
  }
  function csv(batch, input) {
    var ranking = rankRows(batch, input), columns = ["place", "eligible", "rank", "method", "status", "error", "featureIds", "descriptors", "officialOverlap", "fitConverged", "scoreN"];
    METRICS.forEach(function (key) { columns.push("train_" + key, "evaluation_" + key); });
    ["accuracy", "auc", "ap"].forEach(function (key) { columns.push("gap_" + key); });
    function cell(v) { if (v === null || v === undefined) return ""; var s = Array.isArray(v) ? JSON.stringify(v) : String(v);
      if (typeof v === "string" && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"'; }
    return [columns.join(",")].concat(ranking.rows.map(function (entry) {
      var r = entry.row, out = { place: entry.place, eligible: entry.eligible, rank: r.rank, method: r.method, status: r.status, error: r.error,
        featureIds: r.featureIds, descriptors: r.descriptors, officialOverlap: r.officialOverlap, fitConverged: r.fit ? r.fit.converged : null, scoreN: r.evaluation ? r.evaluation.scoreN : null };
      METRICS.forEach(function (key) { out["train_" + key] = r.train ? r.train[key] : null; out["evaluation_" + key] = r.evaluation ? r.evaluation[key] : null; });
      ["accuracy", "auc", "ap"].forEach(function (key) { out["gap_" + key] = r.gap[key]; });
      return columns.map(function (key) { return cell(out[key]); }).join(",");
    })).join("\r\n");
  }
  return { evaluateAll: evaluateAll, rankRows: rankRows, csv: csv, metrics: METRICS };
});
