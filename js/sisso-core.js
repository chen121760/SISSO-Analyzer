/*
 * sisso-core.js — pure computation engine for SISSO result analysis.
 *
 * A faithful JavaScript port of the logic in sisso_post.py, with two
 * additions: (1) Spearman's rho, and (2) a safe recursive-descent formula
 * evaluator that replaces Python's eval().
 *
 * It is environment-agnostic (UMD) so the same code runs in the browser and
 * under Node.js for automated testing against SISSO's own numbers.
 *
 * Public API:
 *   makeNameMap(headerNames) -> [{original_name, new_name, char_len}, ...]
 *   parseTopFile(text)        -> {ranks, rmses, maxaes, featureLists}
 *   parseCoeffFile(text)      -> number[][]
 *   runPipeline(files)        -> full analysis result (see below)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SissoCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  var FUNCS = {
    log: Math.log,
    exp: Math.exp,
    sqrt: Math.sqrt,
    abs: Math.abs,
    cbrt: Math.cbrt,
  };

  function letterSeries(n) {
    var a = "abcdefghijklmnopqrstuvwxyz";
    if (n <= 26) return a.slice(0, n).split("");
    if (n > 702) {
      throw new Error("More than 702 columns are not supported by the letter scheme (a..zz).");
    }
    var out = a.split("");
    for (var i = 0; i < 26; i++) {
      for (var j = 0; j < 26; j++) {
        out.push(a[i] + a[j]);
        if (out.length >= n) return out;
      }
    }
    return out;
  }

  function readHeaderNames(text) {
    var first = text.split(/\r?\n/, 1)[0] || "";
    return first.trim().split(/\s+/);
  }

  function makeNameMap(names) {
    var letters = letterSeries(names.length);
    return names.map(function (n, i) {
      return { original_name: n, new_name: letters[i], char_len: n.length };
    });
  }

  // ---------------------------------------------------------------------------
  // Feature renamer — single compiled alternation, longest name first, with
  // identifier boundaries. Identical semantics to the Python FeatureRenamer.
  // ---------------------------------------------------------------------------

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildRenamer(nameMap) {
    var ordered = nameMap.slice().sort(function (a, b) {
      return b.char_len - a.char_len; // longest first
    });
    for (var i = 0; i < ordered.length; i++) {
      if (!/^[A-Za-z0-9_]+$/.test(ordered[i].original_name)) {
        throw new Error(
          "Feature name '" + ordered[i].original_name +
          "' is not a plain [A-Za-z0-9_]+ token."
        );
      }
    }
    var lookup = {};
    ordered.forEach(function (r) {
      lookup[r.original_name] = r.new_name;
    });
    var alternation = ordered
      .map(function (r) { return escapeRegExp(r.original_name); })
      .join("|");
    var pattern = new RegExp(
      "(?<![A-Za-z0-9_])(?:" + alternation + ")(?![A-Za-z0-9_])", "g"
    );
    return function rename(expr) {
      return expr.replace(pattern, function (m) { return lookup[m]; });
    };
  }

  // ---------------------------------------------------------------------------
  // Parser of SISSO output files
  // ---------------------------------------------------------------------------

  function parseTopFile(text) {
    var lines = text.split(/\r?\n/);
    var ranks = [], rmses = [], maxaes = [], featureLists = [];
    for (var i = 1; i < lines.length; i++) { // skip header
      var line = lines[i];
      if (!line || !line.trim()) continue;
      var parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      var rank = parseInt(parts[0], 10);
      var rmse = parseFloat(parts[1]);
      var maxae = parseFloat(parts[2]);
      var modelExpr = parts.slice(3).join(" ");
      var ids;
      var m = modelExpr.match(/\(\s*(.*?)\s*\)/);
      if (m) {
        ids = (m[1].match(/\d+/g) || []).map(Number);
      } else {
        ids = (modelExpr.match(/\d+/g) || []).map(Number);
        if (ids.length && ids[0] === rank) ids.shift();
      }
      ranks.push(rank);
      rmses.push(rmse);
      maxaes.push(maxae);
      featureLists.push(ids);
    }
    return { ranks: ranks, rmses: rmses, maxaes: maxaes, featureLists: featureLists };
  }

  function parseCoeffFile(text) {
    var lines = text.split(/\r?\n/);
    var coeffs = [];
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i];
      if (!line || !line.trim()) continue;
      var parts = line.trim().split(/\s+/);
      coeffs.push(parts.slice(1).map(Number)); // skip model index
    }
    return coeffs;
  }

  // Scan Uspace.expressions and keep only the lines whose feature id is in
  // `neededIds` (a Set). Id == physical line number, matching the Python
  // build_feature_csv indexing.
  function parseUspace(text, renamer, neededIds) {
    var lines = text.split(/\r?\n/);
    var idToRenamed = new Map();
    var idToOrig = new Map();
    var totalFeatures = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      var id = i + 1;
      totalFeatures++;
      if (!neededIds.has(id)) continue;
      var idx = line.indexOf("SIS_score");
      var expr = (idx >= 0 ? line.slice(0, idx) : line).trim();
      idToOrig.set(id, expr);
      idToRenamed.set(id, renamer(expr));
    }
    return { idToRenamed: idToRenamed, idToOrig: idToOrig, totalFeatures: totalFeatures };
  }

  // ---------------------------------------------------------------------------
  // Formula evaluator (recursive descent; no eval)
  // ---------------------------------------------------------------------------

  function tokenize(src) {
    var re = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9]*|[()+\-*/^]/g;
    var toks = [];
    var m;
    while ((m = re.exec(src))) {
      if (/^\s+$/.test(m[0])) continue;
      toks.push(m[0]);
    }
    return toks;
  }

  function isNumberToken(t) {
    return t !== undefined && /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t);
  }
  function isIdentToken(t) {
    return t !== undefined && /^[A-Za-z][A-Za-z0-9]*$/.test(t);
  }

  // compileFormula(src) -> (get) => number, where get(letter) returns the value
  // of a variable. The parser builds an AST and evaluates it, so there is no
  // eval() and no closure-scoping surprises.
  function compileFormula(src) {
    var toks = tokenize(src);
    var p = 0;
    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function expect(t) {
      var v = next();
      if (v !== t) throw new Error("expected '" + t + "' but got '" + v + "'");
      return v;
    }

    function parseExpr() {
      var left = parseTerm();
      while (peek() === "+" || peek() === "-") {
        var op = next();
        var right = parseTerm();
        left = { type: "bin", op: op, left: left, right: right };
      }
      return left;
    }
    function parseTerm() {
      var left = parseUnary();
      while (peek() === "*" || peek() === "/") {
        var op = next();
        var right = parseUnary();
        left = { type: "bin", op: op, left: left, right: right };
      }
      return left;
    }
    function parseUnary() {
      if (peek() === "-") { next(); return { type: "unary", op: "-", arg: parseUnary() }; }
      if (peek() === "+") { next(); return parseUnary(); }
      return parsePower();
    }
    function parsePower() {
      var base = parseAtom();
      if (peek() === "^") {
        next();
        return { type: "pow", base: base, exp: parseUnary() };
      }
      return base;
    }
    function parseAtom() {
      var t = next();
      if (t === undefined) throw new Error("unexpected end of formula");
      if (t === "(") { var e = parseExpr(); expect(")"); return e; }
      if (isNumberToken(t)) return { type: "num", value: parseFloat(t) };
      if (isIdentToken(t)) {
        if (peek() === "(") {
          var fn = FUNCS[t];
          if (!fn) throw new Error("unknown function '" + t + "'");
          next(); // consume '('
          var arg = parseExpr();
          expect(")");
          return { type: "call", fn: fn, arg: arg };
        }
        return { type: "var", name: t };
      }
      throw new Error("unexpected token '" + t + "'");
    }

    var root = parseExpr();
    if (p < toks.length) throw new Error("trailing tokens after expression");

    function evalNode(node, get) {
      switch (node.type) {
        case "num": return node.value;
        case "var": return get(node.name);
        case "unary": return -evalNode(node.arg, get);
        case "bin":
          var l = evalNode(node.left, get);
          var r = evalNode(node.right, get);
          if (node.op === "+") return l + r;
          if (node.op === "-") return l - r;
          if (node.op === "*") return l * r;
          return l / r;
        case "pow": return Math.pow(evalNode(node.base, get), evalNode(node.exp, get));
        case "call": return node.fn(evalNode(node.arg, get));
        default: throw new Error("unknown AST node " + node.type);
      }
    }

    return function (get) { return evalNode(root, get); };
  }

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  function rank(arr) {
    var n = arr.length;
    var idx = new Array(n);
    for (var i = 0; i < n; i++) idx[i] = i;
    idx.sort(function (a, b) {
      return (arr[a] - arr[b]) || (a - b);
    });
    var r = new Array(n);
    for (var i = 0; i < n; ) {
      var j = i + 1;
      while (j < n && arr[idx[j]] === arr[idx[i]]) j++;
      var avg = (i + j - 1) / 2; // average (0-based) rank for ties
      for (var k = i; k < j; k++) r[idx[k]] = avg;
      i = j;
    }
    return r;
  }

  function pearson(x, y) {
    var n = x.length;
    if (n === 0) return NaN;
    var mx = 0, my = 0;
    for (var i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    var cov = 0, vx = 0, vy = 0;
    for (var j = 0; j < n; j++) {
      var dx = x[j] - mx, dy = y[j] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    if (vx === 0 || vy === 0) return NaN;
    return cov / Math.sqrt(vx * vy);
  }

  function spearman(x, y) {
    return pearson(rank(x), rank(y));
  }

  function computeMetrics(yTrue, yPred) {
    var n = yTrue.length;
    if (n === 0) return { rmse: NaN, maxae: NaN, r2: NaN, rho: NaN, ok: false };
    var s2 = 0, maxAbs = -Infinity, allFinite = true;
    var my = 0;
    for (var i = 0; i < n; i++) my += yTrue[i];
    my /= n;
    var ssTot = 0;
    for (var j = 0; j < n; j++) {
      var e = yPred[j] - yTrue[j];
      if (!Number.isFinite(e)) allFinite = false;
      s2 += e * e;
      var a = Math.abs(e);
      if (a > maxAbs) maxAbs = a;
      var d = yTrue[j] - my;
      ssTot += d * d;
    }
    var rmse = Math.sqrt(s2 / n);
    var r2 = ssTot === 0 ? NaN : 1 - s2 / ssTot;
    var rho = spearman(yTrue, yPred);
    var ok = allFinite && Number.isFinite(rmse) && Number.isFinite(maxAbs);
    return {
      rmse: ok ? rmse : NaN,
      maxae: ok ? maxAbs : NaN,
      r2: Number.isFinite(r2) ? r2 : NaN,
      rho: Number.isFinite(rho) ? rho : NaN,
      ok: ok,
    };
  }

  // ---------------------------------------------------------------------------
  // Data file parsing
  // ---------------------------------------------------------------------------

  // nameMap letters: index 0 = sample name (kept as string), index 1 = target
  // property, index 2.. = features. Returns column-major numeric arrays keyed
  // by letter (excluding the name column) plus the sample names.
  function parseDataFile(text, nameMap) {
    var lines = text.replace(/\r\n?/g, "\n").split("\n");
    // drop trailing empty lines
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var nCols = nameMap.length;
    var cols = {};
    for (var i = 1; i < nCols; i++) {
      cols[nameMap[i].new_name] = new Float64Array(lines.length - 1);
    }
    var names = new Array(lines.length - 1);
    for (var r = 1; r < lines.length; r++) {
      var parts = lines[r].trim().split(/\s+/);
      if (parts.length !== nCols) {
        throw new Error(
          "Data row " + r + " has " + parts.length + " columns, expected " + nCols +
          ". The file may be corrupted or use a different layout."
        );
      }
      names[r - 1] = parts[0];
      for (var c = 1; c < nCols; c++) {
        cols[nameMap[c].new_name][r - 1] = parseFloat(parts[c]);
      }
    }
    return {
      n: names.length,
      names: names,
      cols: cols,
      featureLetters: nameMap.slice(2).map(function (r) { return r.new_name; }),
    };
  }

  function makeColumns(nameMap) {
    return nameMap.map(function (r, i) {
      return {
        letter: r.new_name,
        original: r.original_name,
        role: i === 0 ? "name" : i === 1 ? "target" : "feature",
      };
    });
  }

  function makeFeatureGetter(cols, featureSet, rowIndex) {
    return function (letter) {
      return featureSet[letter] ? cols[letter][rowIndex] : NaN;
    };
  }

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  // files: { trainText, verifyText?, topText, coeffText, uspaceText }
  function runPipeline(files) {
    var headerNames = readHeaderNames(files.trainText);
    var nameMap = makeNameMap(headerNames);
    var renamer = buildRenamer(nameMap);

    var top = parseTopFile(files.topText);
    var coeffs = parseCoeffFile(files.coeffText);
    if (top.ranks.length !== coeffs.length) {
      throw new Error(
        "Row-count mismatch: " + top.ranks.length + " models in top file but " +
        coeffs.length + " rows in coefficient file."
      );
    }

    // Only rename features actually referenced by the top models (not the
    // whole 100k-line Uspace), which keeps parsing near-instant.
    var needed = new Set();
    top.featureLists.forEach(function (ids) {
      ids.forEach(function (id) { needed.add(id); });
    });
    var uspace = parseUspace(files.uspaceText, renamer, needed);

    var models = [];
    for (var mi = 0; mi < top.ranks.length; mi++) {
      var ids = top.featureLists[mi];
      var co = coeffs[mi];
      if (co.length !== ids.length + 1) {
        throw new Error(
          "Model " + (mi + 1) + ": expected " + (ids.length + 1) +
          " coefficients (intercept + " + ids.length + " features) but found " +
          co.length + "."
        );
      }
      var const0 = co[0];
      var termsNew = [], termsOrig = [];
      for (var k = 0; k < ids.length; k++) {
        var fid = ids[k];
        var fNew = uspace.idToRenamed.get(fid);
        var fOrig = uspace.idToOrig.get(fid);
        if (fNew === undefined) {
          throw new Error("Model " + (mi + 1) + ": feature id " + fid + " missing from Uspace.expressions.");
        }
        termsNew.push("(" + co[k + 1] + ")*(" + fNew + ")");
        termsOrig.push("(" + co[k + 1] + ")*(" + fOrig + ")");
      }
      models.push({
        rank: top.ranks[mi],
        formula: "(" + const0 + ") + " + termsNew.join(" + "),
        formulaOriginal: "(" + const0 + ") + " + termsOrig.join(" + "),
        featureIds: ids.slice(),
        rmseSisso: top.rmses[mi],
        maxaeSisso: top.maxaes[mi],
        predTrain: null,
        predVerify: null,
        metricsTrain: null,
        metricsVerify: null,
      });
    }

    var train = parseDataFile(files.trainText, nameMap);
    var verify = files.verifyText ? parseDataFile(files.verifyText, nameMap) : null;
    var targetLetter = nameMap[1].new_name; // 'b'
    var yTrain = Array.from(train.cols[targetLetter]);
    var yVerify = verify ? Array.from(verify.cols[targetLetter]) : null;

    // The formula evaluator must only ever see the *feature* columns, never the
    // sample-id or the target property. This prevents a malformed formula from
    // silently reading the answer it is supposed to predict.
    var featureSet = {};
    train.featureLetters.forEach(function (letter) { featureSet[letter] = true; });

    models.forEach(function (model) {
      var fn;
      try {
        fn = compileFormula(model.formula);
      } catch (err) {
        model.error = "formula compile failed: " + err.message;
        return;
      }
      var predTrain = new Float64Array(train.n);
      for (var i = 0; i < train.n; i++) {
        predTrain[i] = fn(makeFeatureGetter(train.cols, featureSet, i));
      }
      model.predTrain = predTrain;
      model.metricsTrain = computeMetrics(yTrain, predTrain);
      if (!model.metricsTrain.ok) {
        model.error = model.error || "non-finite predictions on train set";
      }

      if (verify) {
        var predVerify = new Float64Array(verify.n);
        for (var j = 0; j < verify.n; j++) {
          predVerify[j] = fn(makeFeatureGetter(verify.cols, featureSet, j));
        }
        model.predVerify = predVerify;
        model.metricsVerify = computeMetrics(yVerify, predVerify);
      }
    });

    var sameAsTrain = files.verifyText && files.verifyText.trim() === files.trainText.trim();
    return {
      meta: {
        nTrain: train.n,
        nVerify: verify ? verify.n : 0,
        nFeatures: nameMap.length - 2,
        nModels: models.length,
        targetLetter: targetLetter,
        targetName: nameMap[1].original_name,
        validationNote: sameAsTrain ? "in-sample" : null,
      },
      columns: makeColumns(nameMap),
      train: train,
      verify: verify,
      models: models,
    };
  }

  return {
    FUNCS: FUNCS,
    letterSeries: letterSeries,
    readHeaderNames: readHeaderNames,
    makeNameMap: makeNameMap,
    buildRenamer: buildRenamer,
    parseTopFile: parseTopFile,
    parseCoeffFile: parseCoeffFile,
    parseUspace: parseUspace,
    compileFormula: compileFormula,
    computeMetrics: computeMetrics,
    spearman: spearman,
    pearson: pearson,
    parseDataFile: parseDataFile,
    makeFeatureGetter: makeFeatureGetter,
    runPipeline: runPipeline,
  };
});
