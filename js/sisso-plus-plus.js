/* SISSO++ text-model importer. Format reference:
 * https://nomad-lab.pages.mpcdf.de/cpp_sisso/quick_start/code_ref.html
 * Keep the original train/test split and check expressions against the coordinates
 * written by SISSO++; never infer a random split or treat SVM classes as YES/NO.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-core.js"));
  else root.SissoPlusPlus = factory(root.SissoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  var MODEL = /^(train|test)_dim_(\d+)_model_(\d+)\.dat$/i;
  function base(path) { return String(path).replace(/\\/g, "/").split("/").pop(); }
  function modelName(path) { return MODEL.exec(base(path)); }
  function isCandidate(path) { return /^sisso\.json$/i.test(base(path)) || /\.csv$/i.test(path) || !!modelName(path); }
  function num(value, label) {
    var text = String(value).trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(text)) throw new Error("SISSO++: invalid number in " + label + ".");
    var n = Number(text.replace(/[dD]/, "e"));
    if (!Number.isFinite(n)) throw new Error("SISSO++: non-finite number in " + label + ".");
    return n;
  }
  function close(a, b) { return Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)); }
  function csv(text) {
    text = String(text).replace(/^\uFEFF/, "");
    var rows = [], row = [], cell = "", quoted = false, closed = false;
    for (var i = 0; i <= text.length; i++) {
      var c = i === text.length ? "\n" : text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else { quoted = false; closed = true; }
        } else { cell += c; }
      } else if (c === '"' && !cell.trim() && !closed) { quoted = true; cell = ""; }
      else if (c === "," || c === "\n" || c === "\r") {
        row.push(cell.trim()); cell = ""; closed = false;
        if (c !== ",") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          if (row.some(function (s) { return s !== ""; })) rows.push(row);
          row = [];
        }
      } else {
        if (closed && !/\s/.test(c)) throw new Error("SISSO++: invalid CSV after a closing quote.");
        cell += c;
      }
    }
    if (quoted) throw new Error("SISSO++: unterminated CSV quote.");
    return rows;
  }
  function fields(line) { return csv(line)[0] || []; }
  function numericSuffix(line, count) {
    // Upstream's writer pads sample/task IDs but does not CSV-quote commas in
    // them. Numeric columns have known widths, so read them from the right.
    var tail = [];
    for (var i = 0; i < count; i++) {
      var comma = line.lastIndexOf(",");
      if (comma < 0) throw new Error("SISSO++: missing numeric model columns.");
      tail.unshift(line.slice(comma + 1).trim()); line = line.slice(0, comma);
    }
    var id = line.trim();
    if (id.startsWith('"')) { var decoded = fields(id); if (decoded.length !== 1) throw new Error("SISSO++: malformed quoted sample/task ID."); id = decoded[0]; }
    return [id].concat(tail);
  }
  function parseConfig(text) {
    var out = "", string = false, escaped = false, line = false, block = false;
    text = String(text).replace(/^\uFEFF/, "");
    for (var i = 0; i < text.length; i++) {
      var c = text[i], next = text[i + 1];
      if (line) { if (c === "\n" || c === "\r") { line = false; out += c; } continue; }
      if (block) { if (c === "*" && next === "/") { block = false; i++; } else if (c === "\n") out += c; continue; }
      if (string) {
        out += c;
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') string = false;
      } else if (c === '"') { string = true; out += c; }
      else if (c === "/" && (next === "/" || next === "*")) { out += " "; line = next === "/"; block = next === "*"; i++; }
      else out += c;
    }
    if (block) throw new Error("SISSO++: unterminated configuration comment.");
    try { return JSON.parse(out); } catch (_) { throw new Error("SISSO++: invalid sisso.json."); }
  }
  function normalizePath(path) {
    var parts = [];
    String(path).replace(/\\/g, "/").split("/").forEach(function (s) {
      if (!s || s === ".") return;
      if (s === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else parts.push(s);
    });
    return parts.join("/");
  }
  function expression(record, featureNames) {
    var stack = [], tokens = record.rpn.split("|"), usable = true;
    var binary = { add: "+", sub: "-", mult: "*", div: "/" };
    var unary = { sqrt: "sqrt", cbrt: "cbrt", log: "log", exp: "exp", abs: "abs", sin: "sin", cos: "cos" };
    tokens.forEach(function (t) {
      t = t.trim();
      if (!usable) return;
      if (/^\d+$/.test(t)) {
        if (Number(t) >= featureNames.length) { usable = false; return; }
        stack.push(featureNames[Number(t)]);
      } else if (binary[t] || t === "abs_diff") {
        if (stack.length < 2) { usable = false; return; }
        var b = stack.pop(), a = stack.pop();
        stack.push(t === "abs_diff" ? "abs(" + a + "-" + b + ")" : "(" + a + binary[t] + b + ")");
      } else {
        if (!stack.length) { usable = false; return; }
        var x = stack.pop();
        if (unary[t]) stack.push(unary[t] + "(" + x + ")");
        else if (t === "sq" || t === "cb" || t === "six" || t === "six_pow") stack.push("(" + x + "^" + ({ sq: 2, cb: 3, six: 6, six_pow: 6 })[t] + ")");
        else if (t === "inv") stack.push("(1/(" + x + "))");
        else if (t === "neg_exp") stack.push("exp(-(" + x + "))");
        else usable = false;
      }
    });
    var result = usable && stack.length === 1 ? stack[0] : record.literal;
    // The strict formatting parser rejects syntax the evaluator cannot account for.
    Core.formulaAst(result);
    return result;
  }

  function parseModel(entry) {
    var match = modelName(entry.path), dim = Number(match[2]), index = Number(match[3]);
    if (!Number.isSafeInteger(dim) || dim < 1 || !Number.isSafeInteger(index) || index < 0) throw new Error("SISSO++: invalid model filename.");
    var model = { path: entry.path, kind: match[1].toLowerCase(), dim: dim, index: index,
      descriptors: [], coefficients: [], counts: [], rows: [], rmse: null, maxae: null, overlap: null, classification: false };
    var section = "";
    String(entry.text).replace(/^\uFEFF/, "").split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      if (!/^\s*#/.test(line)) {
        var cells = numericSuffix(line.replace(/,\s*$/, ""), dim + 2);
        if (cells.length !== dim + 3 || !cells[0]) throw new Error("SISSO++: invalid sample row in " + entry.path + ".");
        model.rows.push({ id: cells[0], target: num(cells[1], entry.path), prediction: num(cells[2], entry.path),
          coords: cells.slice(3).map(function (s) { return num(s, entry.path); }) });
        return;
      }
      var s = line.replace(/^\s*#\s?/, "").trim(), m;
      if ((m = /^RMSE:\s*([^;]+);\s*Max\s*AE:\s*(\S+)/i.exec(s))) {
        model.rmse = num(m[1], "RMSE"); model.maxae = num(m[2], "Max AE");
      }
      if ((m = /^(LOG_RMSE|MSLE):\s*([^;]+)(?:;\s*Max\s*AE:\s*(\S+))?/i.exec(s))) {
        model.logRegression = true;
        model.nativeLoss = { name: m[1], value: num(m[2], m[1]), maxae: m[3] === undefined ? null : num(m[3], "log Max AE") };
      }
      if ((m = /^(Davies Bouldin(?: Test)? Loss|Sil Score (?:Train|Test) Loss|Calinski Harabasz(?: Test)? Loss)\s*:\s*([^;]+)/i.exec(s))) {
        model.classification = true;
        model.nativeLoss = { name: m[1], value: num(m[2], m[1]) };
      }
      if ((m = /#?\s*Samples in Convex Hull Overlap Region:\s*([^;]+)/i.exec(s))) {
        model.classification = true; model.overlap = num(m[1], "convex-hull overlap count");
        if (!Number.isSafeInteger(model.overlap) || model.overlap < 0) throw new Error("SISSO++: convex-hull overlap count must be a non-negative integer.");
      }
      if ((m = /Samples SVM Misclassified:\s*([^;\s]+)/i.exec(s))) {
        model.svmMisclassified = num(m[1], "SVM misclassification count");
        if (!Number.isSafeInteger(model.svmMisclassified) || model.svmMisclassified < 0) throw new Error("SISSO++: invalid SVM misclassification count.");
      }
      if (/^Coefficients\s*$/i.test(s)) { section = "coeff"; return; }
      if (/^Decision Boundaries\s*$/i.test(s)) { section = "svm"; model.classification = true; return; }
      if (/^Feature Rung, Units, and Expressions/i.test(s)) { section = "features"; return; }
      if (/^Number of Samples Per Task/i.test(s)) { section = "counts"; return; }
      if (/^(?:Test Indexes:|Excluded Indexes:|Sample ID\s*,)/i.test(s)) { section = ""; return; }
      if ((section === "coeff" || section === "svm") && /^Task\s*(?:,|\s)\s*(?:[aw]\d+|c0|b)\b/i.test(s)) {
        if (section === "coeff") model.fixIntercept = !/\bc0\b/.test(s);
        return;
      }
      if (section === "counts" && /^Task\s*(?:,|\s)\s*n_(?:samples|mats_train)\b/i.test(s)) { model.countsArePerFile = /\bn_samples\b/.test(s); return; }
      if (section === "features" && /^\d+\s*;/.test(s)) {
        var parts = s.split(";").map(function (x) { return x.trim(); });
        if (parts.length < 5) throw new Error("SISSO++: malformed feature metadata in " + entry.path + ".");
        model.descriptors.push({ index: Number(parts[0]), rpn: parts[3], literal: parts[4] });
      } else if ((section === "coeff" || section === "svm") && s.includes(",")) {
        var co = numericSuffix(s.replace(/,\s*$/, ""), section === "coeff" && model.fixIntercept ? dim : dim + 1);
        if (section === "coeff" && model.fixIntercept) co.push("0");
        if (co.length !== dim + 2) throw new Error("SISSO++: invalid coefficients in " + entry.path + ".");
        model.coefficients.push({ task: co[0], values: co.slice(1).map(function (v) { return num(v, "coefficients"); }) });
      } else if (section === "counts" && s.includes(",")) {
        var count = numericSuffix(s.replace(/,\s*$/, ""), 1);
        if (count.length !== 2) throw new Error("SISSO++: invalid task sample count.");
        var n = num(count[1], "task sample count");
        if (!Number.isSafeInteger(n) || n < 0) throw new Error("SISSO++: invalid task sample count.");
        model.counts.push({ task: count[0], n: n });
      }
    });
    model.descriptors.sort(function (a, b) { return a.index - b.index; });
    if (model.descriptors.length !== dim || model.descriptors.some(function (d, i) { return d.index !== i; }) ||
        !model.rows.length || !model.coefficients.length || !model.counts.length ||
        new Set(model.counts.map(function (t) { return t.task; })).size !== model.counts.length ||
        new Set(model.rows.map(function (r) { return r.id; })).size !== model.rows.length) {
      throw new Error("SISSO++: incomplete or duplicate model metadata/samples in " + entry.path + ".");
    }
    if (!model.classification && !model.logRegression && (model.rmse === null || model.maxae === null)) throw new Error("SISSO++: missing regression errors in " + entry.path + ".");
    if (model.classification && model.overlap === null && !model.nativeLoss) throw new Error("SISSO++: missing supported classification loss in " + entry.path + ".");
    if (model.classification && model.svmMisclassified !== undefined && model.svmMisclassified !== model.rows.filter(function (r) { return r.target !== r.prediction; }).length) throw new Error("SISSO++: SVM misclassification count disagrees with predicted classes in " + entry.path + ".");
    return model;
  }

  function selectRun(entries) {
    entries = entries.map(function (e) { return Object.assign({}, e, { path: normalizePath(e.path) }); });
    var allEntries = entries;
    if (new Set(entries.map(function (e) { return e.path; })).size !== entries.length) throw new Error("SISSO++: duplicate input paths.");
    var configs = entries.filter(function (e) { return /^sisso\.json$/i.test(base(e.path)); }).sort(function (a, b) {
      return a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path);
    });
    if (!configs.length) throw new Error("SISSO++: load sisso.json together with the data CSV and model files.");
    var root = configs[0].path.slice(0, -base(configs[0].path).length);
    if (configs.some(function (e) { return !e.path.startsWith(root); }) ||
        configs.filter(function (e) { return e.path.split("/").length === configs[0].path.split("/").length; }).length !== 1) {
      throw new Error("SISSO++: select one run folder at a time.");
    }
    entries = entries.filter(function (e) {
      return e.path.startsWith(root) && !configs.slice(1).some(function (c) {
        return e.path.startsWith(c.path.slice(0, -base(c.path).length));
      });
    });
    return { entries: entries, allEntries: allEntries, config: configs[0], root: root };
  }

  function prepare(entries, dimension) {
    var selected = selectRun(entries), configs = [selected.config], root = selected.root;
    entries = selected.entries;
    var config = parseConfig(configs[0].text);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("SISSO++: sisso.json must be an object.");
    var calc = config.calc_type || "regression";
    if (!["regression", "log_regression", "classification"].includes(calc)) throw new Error("SISSO++: unsupported calculation type " + calc + ".");
    var regression = calc !== "classification", logRegression = calc === "log_regression";
    var dataFile = config.data_file || "data.csv";
    if (typeof dataFile !== "string" || !dataFile.trim()) throw new Error("SISSO++: invalid data_file.");
    // Resolve only against files the user uploaded, including shared ../data.csv
    // used by the current official exec_test/default case. No path is fetched.
    var resolvedDataPath = normalizePath(root + dataFile);
    var dataEntries = selected.allEntries.filter(function (e) { return e.path === resolvedDataPath; });
    if (!dataEntries.length && !config.data_file_relative_to_json) dataEntries = selected.allEntries.filter(function (e) { return e.path === normalizePath(dataFile); });
    // Individual file selection does not retain directory paths.
    if (!dataEntries.length && !root && selected.allEntries.every(function (e) { return !e.path.includes("/"); })) {
      dataEntries = selected.allEntries.filter(function (e) { return e.path === base(dataFile); });
    }
    if (dataEntries.length !== 1) throw new Error("SISSO++: missing or ambiguous data_file " + dataFile + ".");
    var modelEntries = entries.filter(function (e) { return !!modelName(e.path); });
    var dimensions = Array.from(new Set(modelEntries.filter(function (e) { return modelName(e.path)[1].toLowerCase() === "train"; })
      .map(function (e) { return Number(modelName(e.path)[2]); }))).sort(function (a, b) { return a - b; });
    dimension = dimension === undefined || dimension === null ? dimensions[dimensions.length - 1] : Number(dimension);
    if (!dimensions.includes(dimension)) throw new Error("SISSO++: no training models for the selected dimension.");
    if (calc === "classification" && dimension !== 1 && dimension !== 2) throw new Error("SISSO++: classification currently supports 1D/2D models.");
    var parsed = modelEntries.filter(function (e) { return Number(modelName(e.path)[2]) === dimension; }).map(parseModel);
    var trains = parsed.filter(function (m) { return m.kind === "train"; }).sort(function (a, b) { return a.index - b.index; });
    var tests = parsed.filter(function (m) { return m.kind === "test"; });
    if (new Set(trains.map(function (m) { return m.index; })).size !== trains.length ||
        new Set(tests.map(function (m) { return m.index; })).size !== tests.length) throw new Error("SISSO++: duplicate model IDs; select one run.");
    if (parsed.some(function (m) { return m.classification !== !regression || !!m.logRegression !== logRegression; }) ||
        tests.some(function (m) { return !trains.some(function (t) { return t.index === m.index; }); })) throw new Error("SISSO++: model type or train/test pairing mismatch.");

    var data = csv(dataEntries[0].text);
    if (data.length < 2) throw new Error("SISSO++: empty data CSV.");
    var headers = data[0].map(function (s, i) { return (i === 0 ? s.replace(/^#\s*/, "") : s).replace(/\s+\([^]*\)$/, "").trim(); });
    if (new Set(headers).size !== headers.length || headers.some(function (s) { return !s; })) throw new Error("SISSO++: empty or duplicate CSV column names.");
    var property = config.property_key || "prop", targetIndex = headers.indexOf(property);
    var taskIndex = headers.indexOf(config.task_key || "task");
    if (targetIndex < 1 || taskIndex === 0 || targetIndex === taskIndex) throw new Error("SISSO++: property_key/task_key do not match distinct data columns.");
    var features = headers.filter(function (_, i) { return i > 0 && i !== targetIndex && i !== taskIndex; });
    if (!features.length || features.some(function (s) { return !/^[A-Za-z0-9_]+$/.test(s); })) throw new Error("SISSO++: primary feature names must be unique plain letters/digits/underscore tokens.");
    var featureIndices = features.map(function (s) { return headers.indexOf(s); });
    var byId = new Map();
    data.slice(1).forEach(function (r) {
      if (r.length !== headers.length || !r[0] || byId.has(r[0])) throw new Error("SISSO++: inconsistent CSV width or duplicate/empty sample ID.");
      byId.set(r[0], { id: r[0], target: num(r[targetIndex], "data CSV property"),
        task: taskIndex >= 0 ? r[taskIndex] : "all", values: featureIndices.map(function (i) { return num(r[i], "data CSV feature"); }) });
    });
    var taskLabels = trains[0].counts.map(function (c) { return c.task; });
    if (calc === "classification" && taskLabels.length !== 1) throw new Error("SISSO++: multi-task classification is not supported.");
    if (taskIndex < 0 && taskLabels.length !== 1) throw new Error("SISSO++: multi-task results require the task_key column in data CSV.");
    if (taskIndex < 0) byId.forEach(function (r) { r.task = taskLabels[0]; });
    var trainingIds = new Set(trains[0].rows.map(function (r) { return r.id; }));
    var testingIds = new Set(tests.length ? tests[0].rows.map(function (r) { return r.id; }) : []);
    if (Array.from(testingIds).some(function (id) { return trainingIds.has(id); })) throw new Error("SISSO++: training and test samples overlap.");
    var allExprs = [], idByExpr = new Map(), coeffRows = [], topRows = [], metaModels = [];
    var featureMap = Core.makeNameMap(features), rename = Core.buildRenamer(featureMap);
    parsed.forEach(function (m) {
      var expectedIds = m.kind === "train" ? trainingIds : testingIds;
      if (m.rows.length !== expectedIds.size || m.rows.some(function (r) { return !expectedIds.has(r.id); })) throw new Error("SISSO++: candidate models have different sample sets.");
      if (m.counts.length !== taskLabels.length || m.counts.some(function (c, i) { return c.task !== taskLabels[i]; })) throw new Error("SISSO++: inconsistent task order across models.");
      var coByTask = new Map();
      if (regression) {
        m.coefficients.forEach(function (c) {
          if (coByTask.has(c.task)) throw new Error("SISSO++: duplicate coefficient task.");
          coByTask.set(c.task, c.values);
        });
        if (coByTask.size !== taskLabels.length || taskLabels.some(function (s) { return !coByTask.has(s); })) throw new Error("SISSO++: coefficients do not match the task labels.");
      }
      var expressions = m.descriptors.map(function (d) { return expression(d, features); });
      var fns = expressions.map(function (e) { return Core.compileFormula(rename(e)); });
      var actualCounts = taskLabels.map(function () { return 0; });
      m.rows.forEach(function (r) {
        var raw = byId.get(r.id);
        if (!raw || !close(raw.target, r.target) || !taskLabels.includes(raw.task)) throw new Error("SISSO++: sample IDs, targets or tasks do not match data CSV (" + r.id + ").");
        actualCounts[taskLabels.indexOf(raw.task)]++;
        var coords = fns.map(function (fn, i) {
          var v = fn(function (letter) {
            var fi = featureMap.findIndex(function (f) { return f.new_name === letter; });
            if (fi < 0) throw new Error("SISSO++: descriptor references an unknown feature.");
            return raw.values[fi];
          });
          if (!Number.isFinite(v) || !close(v, r.coords[i])) throw new Error("SISSO++: descriptor coordinates do not match model file (" + m.path + ", " + r.id + ").");
          return v;
        });
        if (regression) {
          var co = coByTask.get(raw.task), prediction = logRegression ? Math.exp(co[dimension]) : co[dimension];
          for (var i = 0; i < dimension; i++) {
            if (logRegression && !(coords[i] > 0 && r.target > 0)) throw new Error("SISSO++: log regression requires positive descriptor and target values.");
            if (logRegression) prediction *= Math.pow(coords[i], co[i]);
            else prediction += co[i] * coords[i];
          }
          if (!close(prediction, r.prediction)) throw new Error("SISSO++: predictions do not match coefficients (" + m.path + ", " + r.id + ").");
        }
      });
      // Current n_samples counts describe this file; legacy n_mats_train headers
      // can repeat training counts in a test file.
      if ((m.kind === "train" || m.countsArePerFile) && m.counts.some(function (c, i) { return c.n !== actualCounts[i] || m.kind === "train" && c.n <= 0; })) throw new Error("SISSO++: task sample counts do not match the samples.");
      if (m.kind !== "train") return;
      var ids = expressions.map(function (e) {
        if (!idByExpr.has(e)) { allExprs.push(e); idByExpr.set(e, allExprs.length); }
        return idByExpr.get(e);
      });
      var rank = m.index + 1;
      if (regression) {
        var values = [];
        taskLabels.forEach(function (task) { var co = coByTask.get(task); values.push(co[dimension]); values.push.apply(values, co.slice(0, dimension)); });
        coeffRows.push(rank + " " + values.join(" "));
        var rawMetrics = logRegression ? Core.computeMetrics(m.rows.map(function (r) { return r.target; }), m.rows.map(function (r) { return r.prediction; })) : null;
        topRows.push(rank + " " + (rawMetrics ? rawMetrics.rmse : m.rmse) + " " + (rawMetrics ? rawMetrics.maxae : m.maxae) + " ( " + ids.join(" ") + " )");
      } else topRows.push(rank + " " + (m.overlap === null ? "NA" : m.overlap) + " NA ( " + ids.join(" ") + " )");
      var pairedTest = tests.find(function (t) { return t.index === m.index; });
      if (pairedTest && (pairedTest.descriptors.some(function (d, i) { return expression(d, features) !== expressions[i]; }) ||
          JSON.stringify(pairedTest.coefficients) !== JSON.stringify(m.coefficients))) throw new Error("SISSO++: paired train/test model definitions differ.");
      metaModels.push({ rank: rank, file: m.path, nativeLoss: m.nativeLoss || null, nativeTestLoss: pairedTest ? pairedTest.nativeLoss || null : null, svm: calc === "classification" ? {
        boundaries: m.coefficients, train: m.rows.map(function (r) { return [encodeURIComponent(r.id), r.prediction]; }),
        verify: pairedTest ? pairedTest.rows.map(function (r) { return [encodeURIComponent(r.id), r.prediction]; }) : [] } : null });
    });
    function samples(ids) { return Array.from(ids).map(function (id) { var row = byId.get(id); if (!row) throw new Error("SISSO++: missing sample in CSV."); return row; }); }
    var training = samples(trainingIds), testing = samples(testingIds);
    var classValues = calc === "classification" ? Array.from(new Set(training.map(function (r) { return r.target; }))).sort(function (a, b) { return a - b; }) : [];
    if (calc === "classification" && (classValues.length < 2 || testing.some(function (r) { return !classValues.includes(r.target); }))) throw new Error("SISSO++: invalid training/test categories.");
    if (calc === "classification" && parsed.some(function (m) { return m.rows.some(function (r) { return !classValues.includes(r.prediction); }); })) throw new Error("SISSO++: SVM predicted class is absent from the training categories.");
    function groupIndex(r) { return calc === "classification" ? classValues.indexOf(r.target) : taskLabels.indexOf(r.task); }
    training.sort(function (a, b) { return groupIndex(a) - groupIndex(b); });
    var counts = (calc === "classification" ? classValues : taskLabels).map(function (_, i) { return training.filter(function (r) { return groupIndex(r) === i; }).length; });
    function freshName(name) { while (features.includes(name)) name = "_" + name; return name; }
    var header = [freshName("sample_id")].concat(regression ? [freshName("target")] : [], features);
    function table(rows) { return header.join(" ") + "\n" + rows.map(function (r) {
      return [encodeURIComponent(r.id)].concat(regression ? [r.target] : [], r.values).join(" ");
    }).join("\n") + "\n"; }
    var texts = { train: table(training), uspace: allExprs.join("\n") + "\n",
      top: (regression ? "SISSO++ Rank RMSE MaxAE Feature_ID" : "rank #data_overlap size_overlap feature_ID SISSO++") + "\n" + topRows.join("\n") + "\n",
      sissoin: "! Imported from SISSO++\nptype=" + (calc === "classification" ? 2 : 1) + "\nntask=" + taskLabels.length +
        "\ndesc_dim=" + dimension + "\nnsf=" + features.length + "\ntask_weighting=2\nnsample=" +
        (calc === "classification" ? "(" + counts.join(",") + ")" : counts.join(",")) + "\n" };
    if (testing.length) texts.verify = table(testing);
    if (regression) texts.coeff = "Model_ID coefficients\n" + coeffRows.join("\n") + "\n";
    else {
      function labels(rows) { return JSON.stringify({ class_order: classValues.map(String), rows: rows.map(function (r) {
        return { id: encodeURIComponent(r.id), class: classValues.indexOf(r.target) };
      }) }); }
      texts.trainlabels = labels(training);
      if (testing.length) texts.verifylabels = labels(testing);
    }
    var info = { version: 1, engine: "SISSO++", dimension: dimension, dimensions: dimensions, calcType: calc, logRegression: logRegression,
      targetName: property, taskLabels: taskLabels, dataFile: dataEntries[0].path, models: metaModels,
      sampleNames: Array.from(byId.keys()).map(function (id) { return [encodeURIComponent(id), id]; }),
      verifyTaskIndices: testing.map(function (r) { return taskLabels.indexOf(r.task); }), config: config };
    texts.sissopp = JSON.stringify(info);
    return { texts: texts, info: info };
  }

  function metadata(text) {
    if (!text) return null;
    var meta = JSON.parse(text);
    if (!meta || meta.engine !== "SISSO++" || meta.version !== 1 || !Array.isArray(meta.sampleNames) || !Array.isArray(meta.models) || !Array.isArray(meta.taskLabels)) throw new Error("Invalid SISSO++ import metadata.");
    return meta;
  }
  function decorate(result, text) {
    var meta = metadata(text);
    if (!meta) return result;
    var names = new Map(meta.sampleNames);
    [result.train, result.verify].concat((result.tasks || []).map(function (t) { return t.data; })).forEach(function (data) {
      if (data) data.names = data.names.map(function (id) { if (!names.has(id)) throw new Error("SISSO++: project sample metadata mismatch."); return names.get(id); });
    });
    result.meta.sourceEngine = "SISSO++";
    result.meta.targetName = meta.targetName;
    result.meta.sissoPlusPlus = meta;
    if (result.meta.multiTask) result.meta.taskSizeSource = "SISSO++ model files";
    result.columns.forEach(function (column) { if (column.role === "target") column.original = meta.targetName; });
    if (result.tasks) result.tasks.forEach(function (t, i) { t.label = meta.taskLabels[i]; });
    if (result.meta.tasks) result.meta.tasks.forEach(function (t, i) { t.label = meta.taskLabels[i]; });
    result.models.forEach(function (model) {
      var record = meta.models.find(function (m) { return m.rank === model.rank; });
      if (!record) throw new Error("SISSO++: project model metadata mismatch.");
      model.sourceFile = record.file;
      model.nativeLoss = record.nativeLoss || null;
      model.nativeTestLoss = record.nativeTestLoss || null;
      if (record.svm) {
        model.svmBoundaries = record.svm.boundaries;
        model.svmPredictions = {};
        ["train", "verify"].forEach(function (key) { model.svmPredictions[key] = new Map(record.svm[key].map(function (r) { return [names.get(r[0]), r[1]]; })); });
      }
    });
    return result;
  }
  return { modelName: modelName, isCandidate: isCandidate, parseCsv: csv, parseConfig: parseConfig, parseModel: parseModel,
    selectRun: selectRun, prepare: prepare, metadata: metadata, decorate: decorate };
});
