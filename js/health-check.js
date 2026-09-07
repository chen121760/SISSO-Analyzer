/*
 * health-check.js — lightweight Analysis Health Check.
 *
 * Runs on the uploaded SISSO result texts BEFORE the heavy pipeline, so data /
 * parsing problems are caught with a compact Passed / Warning / Error report
 * instead of an obscure crash mid-analysis. Pure and DOM-free (UMD): the same
 * file runs in the browser and under Node for automated tests.
 *
 * Design rules:
 *  - It reuses SissoCore's parsers (readHeaderNames, parseDataFile, parseTopFile,
 *    parseCoeffFile, parseUspace, buildRenamer, compileFormula, ...) so the
 *    checks agree exactly with what the pipeline will do — normal projects are
 *    neither re-interpreted nor changed.
 *  - Only problems that would make the pipeline unable to compute are
 *    "error" (blocking). Everything else is a "warning": analysis continues and
 *    the UI shows the warning. A broken verify.dat is downgraded to train-only
 *    (dropVerify) instead of blocking the whole run.
 *  - Every executed check produces an entry, so the UI can render a simple
 *    list of Passed / Warning / Error rows with short explanations.
 *
 * Public API:
 *   check(files) -> { level: "pass"|"warning"|"error",
 *                     dropVerify: boolean,
 *                     checks: [{ id, level: "pass"|"warning"|"error", message }] }
 *   where files = { train, verify?, top, coeff, uspace } (raw texts).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./sisso-core.js"));
  } else {
    root.HealthCheck = factory(root.SissoCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  function newReport() {
    return { checks: [], dropVerify: false };
  }

  function add(report, level, id, message, extra) {
    var entry = { id: id, level: level, message: message };
    if (extra && extra.dropVerify) {
      entry.dropVerify = true;
      report.dropVerify = true;
    }
    report.checks.push(entry);
  }

  function addPass(report, id, message) { add(report, "pass", id, message, {}); }
  function addWarn(report, id, message, extra) { add(report, "warning", id, message, extra || {}); }
  function addErr(report, id, message) { add(report, "error", id, message, {}); }

  // Recompute the overall level from the entries (error > warning > pass).
  function finalize(report) {
    var level = "pass";
    for (var i = 0; i < report.checks.length; i++) {
      if (report.checks[i].level === "error") { level = "error"; break; }
      if (report.checks[i].level === "warning") level = "warning";
    }
    report.level = level;
    return report;
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function shortExpr(expr, max) {
    var s = String(expr).replace(/\s+/g, " ").trim();
    max = max || 48;
    if (s.length > max) s = s.slice(0, max - 1) + "…";
    return s;
  }

  function firstFew(arr, k) {
    k = k || 3;
    var out = [];
    for (var i = 0; i < arr.length && out.length < k; i++) out.push(arr[i]);
    return out;
  }

  // Attach per-column letters + original names to a parsed data file so the
  // integrity helpers never rebuild the name map.
  function attachMeta(data, nameMap) {
    data._letters = {};
    data._originals = {};
    for (var c = 1; c < nameMap.length; c++) {
      data._letters[c] = nameMap[c].new_name;
      data._originals[c] = nameMap[c].original_name;
    }
    data._nCols = nameMap.length;
  }

  // Returns the duplicate names (empty when the file is clean).
  function findDuplicateNames(data) {
    var seen = {};
    var dups = [];
    for (var i = 0; i < data.n; i++) {
      var name = data.names[i];
      if (seen[name] === undefined) {
        seen[name] = [i];
      } else {
        if (seen[name].length === 1) dups.push(name);
        seen[name].push(i);
      }
    }
    return dups;
  }

  // Returns the number of bad cells (0 when clean).
  function findBadCells(data) {
    var bad = 0;
    for (var r = 0; r < data.n; r++) {
      for (var c = 1; c < data._nCols; c++) {
        var v = data.cols[data._letters[c]][r];
        if (!Number.isFinite(v)) bad++;
      }
    }
    return bad;
  }

  function firstBadCellSamples(data, k) {
    var out = [];
    for (var r = 0; r < data.n && out.length < k; r++) {
      for (var c = 1; c < data._nCols && out.length < k; c++) {
        if (!Number.isFinite(data.cols[data._letters[c]][r])) {
          out.push('row "' + data.names[r] + '" / "' + data._originals[c] + '"');
        }
      }
    }
    return out;
  }

  function dataIntegrityChecks(data, fileLabel, report, prefix) {
    var dups = findDuplicateNames(data);
    if (dups.length) {
      addWarn(report, prefix + "-duplicates",
        fileLabel + " has duplicate sample name(s): " + firstFew(dups).join(", ") +
        (dups.length > 3 ? " …" : "") + " (rows may be ambiguous in plots).");
    } else {
      addPass(report, prefix + "-duplicates", "No duplicate sample names in " + fileLabel + ".");
    }

    var bad = findBadCells(data);
    if (bad > 0) {
      addWarn(report, prefix + "-numeric",
        fileLabel + " contains " + bad + " non-numeric / NaN / Inf value(s) (first: " +
        firstBadCellSamples(data, 3).join(", ") +
        ") — affected models may evaluate to non-finite predictions.");
    } else {
      addPass(report, prefix + "-numeric",
        "All numeric values in " + fileLabel + " are finite.");
    }
  }

  // Header / width check between train.dat and verify.dat. Because parseDataFile
  // parses verify against the train header, any difference (count, names, order)
  // silently misaligns columns — such a verify file is flagged and dropped rather
  // than blocking or corrupting the run.
  function checkVerify(verifyText, trainHeader, report) {
    var verifyHeader = Core.readHeaderNames(verifyText);
    var reason = null;

    if (verifyHeader.length !== trainHeader.length) {
      reason = "verify.dat has " + verifyHeader.length + " column(s) but train.dat has " +
        trainHeader.length + " — their feature sets do not line up.";
    } else {
      for (var i = 0; i < trainHeader.length; i++) {
        if (verifyHeader[i] !== trainHeader[i] && reason === null) {
          reason = "verify.dat columns differ from train.dat (first at column " + (i + 1) +
            ': "' + trainHeader[i] + '" vs "' + verifyHeader[i] + '").';
        }
      }
      if (reason === null) {
        var verifyData = null;
        try {
          verifyData = Core.parseDataFile(verifyText, Core.makeNameMap(trainHeader));
        } catch (err) {
          reason = "verify.dat could not be parsed: " + (err && err.message ? err.message : err);
        }
        if (reason === null) {
          attachMeta(verifyData, Core.makeNameMap(trainHeader));
          addPass(report, "verify-consistency",
            "verify.dat header matches train.dat (name + target + feature columns in the same order).");
          dataIntegrityChecks(verifyData, "verify.dat", report, "verify");
          return;
        }
      }
    }

    addWarn(report, "verify-consistency",
      reason + " verify.dat will be ignored for this analysis (train-only mode).",
      { dropVerify: true });
  }

  // top / coeff / Uspace cross-checks + descriptor probes.
  function checkModels(F, nameMap, report, trainData) {
    var top = Core.parseTopFile(F.top);
    var coeffs = Core.parseCoeffFile(F.coeff);

    if (top.ranks.length !== coeffs.length) {
      addErr(report, "models",
        "Row-count mismatch: " + top.ranks.length + " models in the top file but " +
        coeffs.length + " rows in the coefficient file.");
      return;
    }
    if (top.ranks.length === 0) {
      addWarn(report, "models", "The top-ranked file contains no models — nothing to analyse.");
      return;
    }

    // Every feature id referenced by the top models must exist in Uspace.
    var needed = new Set();
    top.featureLists.forEach(function (ids) {
      ids.forEach(function (id) { needed.add(id); });
    });

    var uspace;
    try {
      uspace = Core.parseUspace(F.uspace, Core.buildRenamer(nameMap), needed);
    } catch (err) {
      addErr(report, "models",
        "Feature-name / Uspace setup failed: " + (err && err.message ? err.message : err));
      return;
    }

    var missingIds = [];
    var present = [];
    var neededList = Array.from(needed).sort(function (a, b) { return a - b; });
    for (var i = 0; i < neededList.length; i++) {
      var fid = neededList[i];
      if (uspace.idToRenamed.has(fid)) {
        present.push({
          id: fid,
          renamed: uspace.idToRenamed.get(fid),
          orig: uspace.idToOrig.get(fid),
        });
      } else {
        missingIds.push(fid);
      }
    }
    if (missingIds.length) {
      addErr(report, "models",
        "Descriptor reference(s) " + firstFew(missingIds).join(", ") +
        (missingIds.length > 3 ? " …" : "") + " point to features missing from Uspace.expressions " +
        "(file defines " + uspace.totalFeatures + ").");
      return;
    }

    probeDescriptors(present, trainData, nameMap, report);
    addPass(report, "models",
      top.ranks.length + " model(s) read; coefficient rows match and every referenced " +
      "descriptor exists in Uspace.expressions.");
  }

  // Compile each needed descriptor and evaluate it over the train samples to
  // spot divide-by-zero / log / sqrt / overflow hazards (the same arithmetic the
  // pipeline uses, but per-feature and before model assembly).
  function probeDescriptors(present, trainData, nameMap, report) {
    if (!trainData || !present.length) return;
    var featureSet = {};
    for (var i = 2; i < nameMap.length; i++) featureSet[nameMap[i].new_name] = true;

    var offending = [];
    for (var p = 0; p < present.length; p++) {
      var e = present[p];
      var fn;
      try {
        fn = Core.compileFormula(e.renamed);
      } catch (err) {
        addWarn(report, "descriptors",
          'Descriptor #' + e.id + ' "' + shortExpr(e.orig) + '" is not a valid expression (' +
          (err && err.message ? err.message : "syntax error") + ").");
        continue;
      }
      var bad = 0;
      for (var r = 0; r < trainData.n; r++) {
        var v;
        try {
          v = fn(Core.makeFeatureGetter(trainData.cols, featureSet, r));
        } catch (err2) {
          v = NaN;
        }
        if (!Number.isFinite(v)) bad++;
      }
      if (bad > 0) {
        offending.push({ id: e.id, expr: e.orig, bad: bad, rows: trainData.n });
      }
    }

    if (offending.length) {
      var parts = firstFew(offending, 3).map(function (o) {
        return '#' + o.id + ' "' + shortExpr(o.expr) + '" (' + o.bad + "/" + o.rows + " rows)";
      });
      addWarn(report, "descriptors",
        offending.length + " descriptor(s) produce non-finite values on some train samples — " +
        "possible division by zero or log/sqrt outside their domain: " + parts.join("; ") +
        (offending.length > 3 ? "; …" : "") + ".");
    } else {
      addPass(report, "descriptors",
        "All " + present.length + " referenced descriptor(s) compiled and stay finite on the train samples.");
    }
  }

  // ---------------------------------------------------------------------------
  // Main entry
  // ---------------------------------------------------------------------------

  function check(files) {
    var report = newReport();
    var F = files || {};

    var required = [
      { key: "train", label: "train.dat" },
      { key: "uspace", label: "Uspace.expressions" },
      { key: "coeff", label: "coefficient file" },
      { key: "top", label: "top-ranked file" },
    ];
    var missing = [];
    for (var qi = 0; qi < required.length; qi++) {
      var text = F[required[qi].key];
      if (typeof text !== "string" || !text.trim()) missing.push(required[qi].label);
    }
    if (missing.length) {
      addErr(report, "required",
        "Missing required file(s): " + missing.join(", ") + " — analysis cannot run.");
      return finalize(report);
    }

    // --- train.dat structure -------------------------------------------------
    var headerNames = Core.readHeaderNames(F.train);
    if (headerNames.length < 3) {
      addErr(report, "train-columns",
        "train.dat header has only " + headerNames.length +
        " column(s); expected at least name + target + 1 feature.");
      return finalize(report);
    }
    var nameMap = Core.makeNameMap(headerNames);
    var trainData;
    try {
      trainData = Core.parseDataFile(F.train, nameMap);
    } catch (err) {
      addErr(report, "train-rows",
        "train.dat could not be parsed: " + (err && err.message ? err.message : err));
      return finalize(report);
    }
    attachMeta(trainData, nameMap);
    addPass(report, "train-parse",
      "train.dat parsed: " + trainData.n + " sample(s) × " + nameMap.length + " column(s).");

    // --- train integrity -----------------------------------------------------
    dataIntegrityChecks(trainData, "train.dat", report, "train");

    // --- verify.dat consistency (only when a verify file was uploaded) -------
    if (F.verify !== undefined && F.verify !== null && String(F.verify).trim()) {
      checkVerify(F.verify, headerNames, report);
    }

    // --- top / coeff / uspace consistency -----------------------------------
    checkModels(F, nameMap, report, trainData);

    return finalize(report);
  }

  return { check: check };
});
