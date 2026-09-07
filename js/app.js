/*
 * app.js — SISSO-Analyzer UI.
 *
 * Flow: upload files -> classify into roles -> run SissoCore.runPipeline ->
 * render KPI strip + sortable table + thumbnail grid -> detail dialog with an
 * ECharts scatter plot + point inspector showing a sample's feature values.
 */
(function () {
  "use strict";

  var Core = window.SissoCore;
  var I18N = window.I18N;
  var echarts = window.echarts;
  var HealthCheck = window.HealthCheck;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var state = {
    files: {},      // role -> {name, file}
    texts: {},      // role -> raw text (captured at analyze time)
    result: null,   // pipeline result
    projectId: null,
    sortKey: "rank",
    sortAsc: true,
    topN: 100,
    loadAll: false,
    view: "table",  // "table" | "grid" | "pareto" | "units"
    chart: null,    // echarts instance
    currentModel: null,
    colorKey: "",   // "" = class colors; otherwise a column letter to color by
    detailTab: "scatter",   // detail dialog chart view: "scatter" (predicted vs
                            // true) or "error" (residual histogram)
    errorDataset: "train",  // residual histogram dataset: "train" | "verify"
    errorChart: null,       // echarts instance for the residual histogram
    paretoX: null,  // Pareto axis spec: { dataset, metric } — e.g. {train, rmse}
    paretoY: null,  // (legacy sessions stored bare metric keys; coerceParetoAxes migrates)
    paretoChart: null,  // echarts instance for the Pareto view
    paretoMode: "2d",   // "2d" | "3d"
    paretoZ: null,  // third axis spec: { dataset, metric } (3D only)
    health: null,   // latest HealthCheck report: { level, checks, dropVerify }
    showExcluded: false,  // when true, excluded models show again (so users can restore them)
    favOnly: false,       // when true, the table / grid list shows favourite models only
    // Batch "copy selected models for AI comparison" per table view. Keyed by
    // the view that owns the checkboxes so the main table and the Pareto table
    // keep independent selections. Reset when a new run is analysed.
    batchSel: { table: new Set(), pareto: new Set() },
    // Undo history of the batch favourite / exclude actions made from the
    // Units view's usage tables (one entry per action, most recent last).
    batchOps: [],
    // Usage-table view state (per analysis): sort key / direction and the
    // "show all rows" expansion for each panel ("feature" | "descriptor").
    usageSort: { feature: { by: "count", asc: false }, descriptor: { by: "count", asc: false } },
    usageExpanded: { feature: false, descriptor: false },
    compareSel: [],       // ranks currently selected in the Compare view
    compareChart: null,      // echarts instance for the Compare overlay chart
    // table configuration (persisted)
    hiddenCols: {},   // column id -> true when hidden from the table
    // filters (per analysis; reset when a new run is analysed)
    filter: {
      active: false,
      includeMode: "any",     // "any" | "only": model must contain at least one
                              // included feature ("any") or only included ones
                              // ("only")
      include: null,          // Set<featureName> kept in the formula
      exclude: null,          // Set<featureName> forbidden from the formula
      numeric: {},            // column id -> { min: number|null, max: number|null }
    },
  };

  var COLS_PREF_KEY = "sisso-table-cols";
  var errorHistCache = null; // last histogram layout (for bar-width refit on resize)

  // ---------------------------------------------------------------------------
  // Theme (system / light / dark) + citation data
  // ---------------------------------------------------------------------------
  var THEME_STORAGE = "sisso-theme";
  var CITATION_TEXT =
    "R. Ouyang, S. Curtarolo, E. Ahmetcik, M. Scheffler, and L. M. Ghiringhelli, " +
    "Phys. Rev. Mater. 2, 083802 (2018).";

  var ICON_MONITOR =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M8 21h8M12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";
  var ICON_SUN =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";
  var ICON_MOON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";

  // Small inline icons for the model-state controls (favourite / exclude) and
  // the Compare navigation entry.
  var ICON_STAR =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M12 2.35l2.91 6.02 6.6.95-4.78 4.66 1.13 6.58L12 17.34l-5.86 3.22 1.13-6.58L2.49 9.32l6.6-.95z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
    "</svg>";
  var ICON_STAR_FILL =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M12 2.35l2.91 6.02 6.6.95-4.78 4.66 1.13 6.58L12 17.34l-5.86 3.22 1.13-6.58L2.49 9.32l6.6-.95z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>' +
    "</svg>";
  var ICON_EYE =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/>' +
    "</svg>";
  var ICON_EYE_OFF =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M4 3l16 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    "</svg>";
  var ICON_COMPARE =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
    '<path d="M4 20h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M9 4v16M15 4v16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M9 7.5L6 10.5M9 7.5l3 3M15 7.5l-3 3M15 7.5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";

  var theme = { preference: "system", resolved: "light" };
  var themeColors = null;

  function resolveTheme(pref) {
    if (pref === "light" || pref === "dark") return pref;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function nextThemePreference(pref, resolved) {
    if (pref === "system") return resolved === "dark" ? "light" : "dark";
    if (pref === "light") return "dark";
    return "system";
  }

  function themeTitleKey() {
    if (theme.preference === "light") return "themeLight";
    if (theme.preference === "dark") return "themeDark";
    return "themeSystem";
  }

  function getThemeColors() {
    if (themeColors) return themeColors;
    var cs = window.getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var s = cs.getPropertyValue(name);
      return (s && s.trim()) || fallback;
    }
    themeColors = {
      train: v("--color-train", "#1e40af"),
      verify: v("--color-verify", "#d97706"),
      text: v("--color-text", "#0f172a"),
      textSoft: v("--color-text-soft", "#475569"),
      axis: v("--chart-axis", "#cbd5e1"),
      grid: v("--chart-grid", "#e2e8f0"),
      identity: v("--chart-identity", "#94a3b8"),
      chartText: v("--chart-text", "#475569"),
      chartEmpty: v("--chart-empty", "#64748b"),
      font: v("--font-body", "sans-serif"),
    };
    return themeColors;
  }

  function updateThemeButton() {
    var btn = $("#btn-theme");
    if (!btn) return;
    var icon = ICON_MONITOR;
    if (theme.preference === "light") icon = ICON_MOON;
    else if (theme.preference === "dark") icon = ICON_SUN;
    btn.innerHTML = icon;
    var label = I18N.t(themeTitleKey());
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function refreshThemeDependentUI() {
    themeColors = null;
    if (!state.result) return;
    if (state.view === "grid") renderGrid();
    if (state.view === "pareto") renderPareto();
    if (state.currentModel && !$("#dialog-backdrop").hidden) {
      renderCurrentDetailChart();
    }
  }

  function applyTheme() {
    theme.resolved = resolveTheme(theme.preference);
    document.documentElement.setAttribute("data-theme", theme.resolved);
    updateThemeButton();
    refreshThemeDependentUI();
  }

  function cycleTheme() {
    theme.preference = nextThemePreference(theme.preference, theme.resolved);
    try {
      window.localStorage && window.localStorage.setItem(THEME_STORAGE, theme.preference);
    } catch (e) { /* ignore */ }
    applyTheme();
  }

  function setCiteOpen(open) {
    var popover = $("#cite-popover");
    if (!popover) return;
    popover.hidden = !open;
    var btn = $("#btn-cite");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  var FILE_ROLES = [
    { role: "train", i18n: "fileTrain", required: true, optional: false,
      match: function (n) { return /^train\.dat$/i.test(n); } },
    { role: "verify", i18n: "fileVerify", required: false, optional: true,
      match: function (n) { return /^verify\.dat$/i.test(n); } },
    { role: "uspace", i18n: "fileUspace", required: true, optional: false,
      match: function (n) { return /^Uspace\.expressions$/i.test(n); } },
    { role: "coeff", i18n: "fileCoeff", required: true, optional: false,
      match: function (n) { return /top.*D00.*_coeff/i.test(n); } },
    { role: "top", i18n: "fileTop", required: true, optional: false,
      match: function (n) { return /^top.*D00/i.test(n) && !/_coeff/i.test(n); } },
    { role: "sissoin", i18n: "fileSissoIn", required: false, optional: true,
      match: function (n) { return /^SISSO\.in$/i.test(n); } },
    { role: "sissoout", i18n: "fileSissoOut", required: false, optional: true,
      match: function (n) { return /^SISSO\.out$/i.test(n); } },
  ];

  // Pareto metrics: label key + whether smaller-is-better.
  var PARETO_METRICS = [
    { key: "rmse", label: "sortRMSE", minimize: true },
    { key: "maxae", label: "sortMaxAE", minimize: true },
    { key: "r2", label: "sortR2", minimize: false },
    { key: "rho", label: "sortRho", minimize: false },
  ];
  function paretoMetricDef(key) {
    for (var i = 0; i < PARETO_METRICS.length; i++) {
      if (PARETO_METRICS[i].key === key) return PARETO_METRICS[i];
    }
    return PARETO_METRICS[0];
  }

  // ---------------------------------------------------------------------------
  // SISSO.in parsing (run settings: features / dimension / complexity)
  // ---------------------------------------------------------------------------
  function parseSissoIn(text) {
    var out = { nsample: null, nsf: null, descDim: null, fcomplexity: null, ptype: null };
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      // strip comments: '!' (Fortran style) and '#' / '//' as tolerated extras
      var line = lines[i];
      var cut = line.length;
      var b1 = line.indexOf("!");
      var b2 = line.indexOf("#");
      if (b1 >= 0 && b1 < cut) cut = b1;
      if (b2 >= 0 && b2 < cut) cut = b2;
      var core = line.slice(0, cut).trim();
      if (!core) continue;
      var eq = core.indexOf("=");
      if (eq < 1) continue;
      var key = core.slice(0, eq).trim().toLowerCase().replace(/^[^a-z0-9]+/, "");
      var val = core.slice(eq + 1).trim();
      // accept numbers that may sit inside parens / comma lists / trailing ';'
      var nums = (val.match(/[+-]?\d+(?:\.\d+)?(?:[de][+-]?\d+)?/gi) || [])
        .map(function (s) { return parseFloat(s.replace(/[de]/i, "e")); });
      if (!nums.length) continue;
      // SISSO renamed its keywords over versions, so accept the common aliases.
      switch (key) {
        case "nsample": case "n_sample": case "nsamples": case "nsets":
          out.nsample = nums[0]; break;
        case "nsf": case "n_features": case "nsf_":
          out.nsf = nums[0]; break;
        case "desc_dim": case "dimension": case "descriptor_dim":
          out.descDim = nums[0]; break;
        case "fcomplexity": case "maxcomplexity": case "complexity": case "n_rung":
          out.fcomplexity = nums[0]; break;
        case "ptype":
          out.ptype = nums[0]; break;
      }
    }
    return out;
  }

  // Complexity fallback: when SISSO.in did not provide fcomplexity, estimate the
  // feature-space complexity as the largest number of operators found in the
  // Uspace expressions actually used by the top models.
  function estimateMaxComplexity(uspaceText, usedIds) {
    if (!uspaceText || !usedIds || !usedIds.size) return null;
    var lines = String(uspaceText).split(/\r?\n/);
    var maxC = null;
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var id = i + 1;
      if (!usedIds.has(id)) continue;
      var idx = lines[i].indexOf("SIS_score");
      var expr = (idx >= 0 ? lines[i].slice(0, idx) : lines[i]).trim();
      var ops = expr.match(/(?:\bexp\b|\bsqrt\b|\bcbrt\b|\blog\b|\babs\b)|[+\-*/^]/g);
      var c = ops ? ops.length : 0;
      // a leading unary minus is not a binary operator
      if (expr.charAt(0) === "-") c = Math.max(0, c - 1);
      if (maxC === null || c > maxC) maxC = c;
    }
    return maxC;
  }

  function collectUsedFeatureIds(result) {
    var set = new Set();
    if (result && result.models) {
      result.models.forEach(function (m) {
        (m.featureIds || []).forEach(function (fid) { set.add(fid); });
      });
    }
    return set;
  }

  // ---------------------------------------------------------------------------
  // Project persistence (mirrors USPEX-Analyzer): JSON export/import + recent
  // projects stored in IndexedDB.
  // ---------------------------------------------------------------------------
  var DB_NAME = "sisso-analyzer";
  var DB_STORE = "projects";

  function makeProjectId() {
    return "proj_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function dbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("indexedDB unavailable")); return; }
      var req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function dbPut(rec) {
    return dbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(rec);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function dbAll() {
    return dbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
        req.onsuccess = function () {
          var rows = req.result || [];
          rows.sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); });
          resolve(rows);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function dbDelete(id) {
    return dbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function defaultRoleFileName(role) {
    var names = { train: "train.dat", verify: "verify.dat", uspace: "Uspace.expressions",
      coeff: "top1D00_coeff", top: "top1D00", sissoin: "SISSO.in", sissoout: "SISSO.out" };
    return names[role] || (role + ".txt");
  }

  function makeProjectJson() {
    var res = state.result;
    if (!res) return null;
    var files = {};
    FILE_ROLES.forEach(function (r) {
      var t = state.texts[r.role];
      if (t === undefined || t === null) return;
      var name = state.files[r.role] ? state.files[r.role].name : defaultRoleFileName(r.role);
      files[r.role] = { name: name, text: t };
    });
    var info = res.meta.sissoIn || null;
    return {
      version: 1,
      kind: "sisso-analyzer-project",
      id: state.projectId || null,
      savedAt: new Date().toISOString(),
      targetName: res.meta.targetName || "",
      nModels: res.meta.nModels || 0,
      nTrain: res.meta.nTrain || 0,
      nFeatures: res.meta.nFeatures || 0,
      dim: info && info.descDim !== null ? info.descDim : null,
      complexity: info && info.fcomplexity !== null ? info.fcomplexity : null,
      features: (info && info.nsf !== null ? info.nsf : res.meta.nFeatures) || 0,
      files: files,
      // favourite / excluded per model (compact; empty for untouched models,
      // absent in projects saved before this feature existed)
      modelStates: Core.modelStatesToJSON(res.modelStates),
    };
  }

  function projectTitle(p) {
    var name = p && p.targetName ? p.targetName : "SISSO project";
    var tag = [];
    if (p && p.dim !== null && p.dim !== undefined) tag.push(p.dim + "D");
    if (p && p.complexity !== null && p.complexity !== undefined) tag.push("C" + p.complexity);
    if (tag.length) name += " (" + tag.join(" ") + ")";
    return name;
  }

  // Assign a stable id/display name to a project JSON.
  function finalizeProject(p) {
    if (!p) return null;
    if (!p.id) p.id = state.projectId = makeProjectId();
    else state.projectId = p.id;
    p.name = projectTitle(p);
    return p;
  }

  // Store the current analysis into the browser's recent list (IndexedDB).
  // Mirrors USPEX-Analyzer: every successful upload is auto-saved.
  function storeProjectLocally() {
    var p = finalizeProject(makeProjectJson());
    if (!p) return Promise.resolve(false);
    return dbPut(p).then(function () {
      renderRecentList();
      return true;
    }).catch(function (err) {
      console.warn("IndexedDB save failed:", err);
      renderRecentList();
      return false;
    });
  }

  // Restore a saved project: rebuild the raw texts and re-run the pipeline,
  // so every view (table, grid, KPI cards, SISSO.in info) is reproduced.
  function applyProject(p, silent) {
    if (!p || p.kind !== "sisso-analyzer-project" || !p.files || typeof p.files !== "object") {
      toast(I18N.t("errProject"));
      return;
    }
    var roleTexts = {};
    var ok = true;
    FILE_ROLES.forEach(function (r) {
      var rec = p.files[r.role];
      if (rec && typeof rec.text === "string") {
        roleTexts[r.role] = rec.text;
        state.files[r.role] = { name: rec.name || defaultRoleFileName(r.role), file: null };
      }
    });
    ["train", "uspace", "coeff", "top"].forEach(function (need) {
      if (roleTexts[need] === undefined) ok = false;
    });
    if (!ok) { toast(I18N.t("errProject")); return; }
    state.projectId = p.id || null;
    try {
      processTexts(roleTexts, { modelStates: p && p.modelStates });
      if (!silent) toast(I18N.t("loadedOk"));
    } catch (err) {
      console.error(err);
      toast(I18N.t("errProject") + " " + (err && err.message ? err.message : ""));
    }
  }

  // Session persistence: remember the active project + UI state so a refresh
  // brings the user back to the same place instead of the upload page.
  var SESSION_KEY = "sisso-session";
  function persistSession() {
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({
        projectId: state.projectId || null,
        view: state.view || "table",
        sortKey: state.sortKey || "rank",
        sortAsc: !!state.sortAsc,
        topN: state.topN || 100,
        loadAll: !!state.loadAll,
        colorKey: state.colorKey || "",
        favOnly: !!state.favOnly,
        paretoX: state.paretoX || null,
        paretoY: state.paretoY || null,
        paretoZ: state.paretoZ || null,
        paretoMode: state.paretoMode || "2d",
      }));
    } catch (e) { /* ignore */ }
  }
  function clearSession() {
    try { window.localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
  function restoreSession() {
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
    if (!saved || !saved.projectId) return;
    dbAll().then(function (rows) {
      var rec = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === saved.projectId) { rec = rows[i]; break; }
      }
      if (!rec) return;
      try {
        applyProject(rec, true);
        if (!state.result) return;
        var want = saved.view === "grid" || saved.view === "pareto" || saved.view === "units" ||
          saved.view === "compare" ? saved.view : "table";
        state.view = want;
        state.sortKey = (saved.sortKey || "rank") || "rank";
        state.sortAsc = saved.sortAsc !== false;
        state.topN = saved.topN && saved.topN > 0 ? saved.topN : 100;
        state.loadAll = !!saved.loadAll;
        state.colorKey = saved.colorKey || "";
        state.favOnly = !!saved.favOnly;
        state.paretoMode = saved.paretoMode === "3d" ? "3d" : "2d";
        // Legacy sessions stored paretoX/paretoY as bare metric keys (train /
        // verify implied) and paretoZ as {metric, set}; coerceParetoAxes migrates
        // them to {dataset, metric} specs valid for the datasets actually loaded.
        state.paretoX = saved.paretoX;
        state.paretoY = saved.paretoY;
        state.paretoZ = saved.paretoZ;
        coerceParetoAxes();
        renderControls();
        populateColorSelect();
        renderModels();
        if (state.view === "pareto") renderPareto();
        if (state.view === "units") renderUnits();
        if (state.view === "compare") renderCompare();
        persistSession();
      } catch (err) {
        console.warn("session restore failed:", err);
      }
    }).catch(function () {});
  }

  function fmtSavedTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch (e) { return ""; }
  }

  function renderRecentList() {
    dbAll().then(function (rows) {
      var box = $("#recent-box");
      var list = $("#recent-list");
      if (!box || !list) return;
      var show = !!(rows && rows.length);
      // Always show the panel so users know where saved projects live; an empty
      // state explains what's going on instead of silently hiding everything.
      box.hidden = false;
      var empty = $("#recent-empty");
      if (empty) {
        empty.hidden = show;
        if (!show) empty.textContent = I18N.t("recentEmpty");
      }
      var viewUp = $("#view-upload");
      if (viewUp) viewUp.classList.toggle("has-recent", show);
      if (!show) { list.innerHTML = ""; return; }
      list.innerHTML = "";
      rows.slice(0, 12).forEach(function (rec) {
        var li = el("li", "recent-item");
        var wrap = el("div");
        wrap.appendChild(el("div", "recent-item__name", rec.targetName || rec.name || "SISSO project"));
        // Backward-compatible summary: derive dimension/complexity/features from
        // the stored SISSO.in when an older record does not carry these fields.
        var sissoRec = rec.files && rec.files.sissoin ? rec.files.sissoin : null;
        var sinfo = (sissoRec && typeof sissoRec.text === "string") ? parseSissoIn(sissoRec.text) : null;
        var dim = rec.dim != null ? rec.dim : (sinfo && sinfo.descDim != null ? sinfo.descDim : null);
        var cplx = rec.complexity != null ? rec.complexity : (sinfo && sinfo.fcomplexity != null ? sinfo.fcomplexity : null);
        var feat = rec.features != null ? rec.features
          : (sinfo && sinfo.nsf != null ? sinfo.nsf : (rec.nFeatures != null ? rec.nFeatures : null));
        var summaryParts = [];
        if (dim !== null && dim !== undefined) summaryParts.push(dim + "D");
        if (cplx !== null && cplx !== undefined) summaryParts.push("C" + cplx);
        if (feat !== null && feat !== undefined) summaryParts.push(feat + " " + I18N.t("kpiFeatures"));
        summaryParts.push(I18N.format("recentMeta", {
          n: rec.nModels != null ? rec.nModels : "-",
          time: fmtSavedTime(rec.savedAt),
        }));
        wrap.appendChild(el("div", "recent-item__meta", summaryParts.join(" · ")));
        li.appendChild(wrap);

        var actions = el("div", "recent-item__actions");
        var open = el("button", "btn btn--secondary", I18N.t("recentOpen"));
        open.type = "button";
        open.addEventListener("click", function () { applyProject(rec); });
        var del = el("button", "btn btn--ghost", I18N.t("recentDelete"));
        del.type = "button";
        del.addEventListener("click", function () {
          dbDelete(rec.id).then(renderRecentList).catch(function () {});
        });
        actions.appendChild(open);
        actions.appendChild(del);
        li.appendChild(actions);
        list.appendChild(li);
      });
    }).catch(function () {
      // IndexedDB unavailable — show an explicit message instead of hiding the panel.
      var box = $("#recent-box");
      var empty = $("#recent-empty");
      if (box) box.hidden = false;
      if (empty) { empty.hidden = false; empty.textContent = I18N.t("recentUnavailable"); }
      var list = $("#recent-list");
      if (list) list.innerHTML = "";
      var viewUp = $("#view-upload");
      if (viewUp) viewUp.classList.remove("has-recent");
    });
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      node.textContent = I18N.t(node.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (node) {
      var label = I18N.t(node.getAttribute("data-i18n-title"));
      node.setAttribute("title", label);
      node.setAttribute("aria-label", label);
    });
    document.documentElement.lang = I18N.getLocale() === "zh" ? "zh" : "en";
    updateThemeButton();
    refreshDynamicLabels();
  }

  function refreshDynamicLabels() {
    var btn = $("#btn-lang");
    if (btn) btn.textContent = I18N.getLocale() === "zh" ? "EN" : "中文";
    renderFileList();
    renderControls();
    renderCount();
    populateColorSelect();
    renderRecentList();
    refreshHealthPanels();
    syncDetailStateButtons();
    syncExcludedToggleUI();
    syncFavOnlyUI();
    if (state.view === "compare" && state.result) renderCompare();
  }

  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  // Shared clipboard writer with an explicit toast message (formula copies and
  // the batch model-copy bar both use this).
  function writeClipboard(text, doneMsg) {
    if (!text) return;
    var ok = function () { toast(doneMsg || I18N.t("copied")); };
    var fail = function () { toast(I18N.t("errUnknown")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fail);
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); }
      catch (e) { fail(); }
      document.body.removeChild(ta);
    }
  }

  // Full-screen loading overlay with a spinner (High severity per ui-ux-pro-max:
  // show feedback for operations > 300ms).
  function showLoading(textKey) {
    var overlay = $("#loading-overlay");
    if (overlay) {
      $("#loading-text").textContent = I18N.t(textKey || "analyzing");
      overlay.hidden = false;
    }
  }
  function hideLoading() {
    var overlay = $("#loading-overlay");
    if (overlay) overlay.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Analysis health check UI — compact Passed / Warning / Error report.
  //
  // Healthy/warning runs are reported with a short-lived toast only. The only
  // thing that stays on screen is the blocking-error report on the upload page
  // (it disappears once the user changes files or re-runs).
  // ---------------------------------------------------------------------------
  function clearHealthPanels() {
    var a = $("#health-block");
    if (a) a.hidden = true;
  }

  function countHealth(report) {
    var out = { pass: 0, warning: 0, error: 0 };
    if (report && report.checks) {
      report.checks.forEach(function (ch) {
        if (ch.level === "error") out.error++;
        else if (ch.level === "warning") out.warning++;
        else out.pass++;
      });
    }
    return out;
  }

  function renderHealthReport(report, box) {
    if (!box) return;
    box.innerHTML = "";
    if (!report || !report.checks || !report.checks.length) {
      box.hidden = true;
      return;
    }
    var head = el("div", "health-box__head");
    head.appendChild(el("span", "health-box__title", I18N.t("healthTitle")));
    var c = countHealth(report);
    head.appendChild(el("span", "health-box__summary",
      I18N.format("healthSummary", { p: c.pass, w: c.warning, e: c.error })));
    box.appendChild(head);
    report.checks.forEach(function (ch) {
      var row = el("div", "health-row health-row--" + ch.level);
      var badgeKey = ch.level === "error"
        ? "healthError" : ch.level === "warning" ? "healthWarning" : "healthPass";
      row.appendChild(el("span", "health-badge health-badge--" + ch.level, I18N.t(badgeKey)));
      row.appendChild(el("span", "health-msg", ch.message));
      box.appendChild(row);
    });
    box.hidden = false;
  }

  // After a successful run only blocking errors deserve persistent space — they
  // live in the upload panel. Passed/warning health is transient (toast in the
  // caller), so the results header stays clean.
  function refreshHealthPanels() {
    var blocked = !!(state.health && state.health.level === "error");
    var blockBox = $("#health-block");
    if (blocked) renderHealthReport(state.health, blockBox);
    else if (blockBox) blockBox.hidden = true;
  }

  // Short-lived health summary after a healthy/warning run; the first warning
  // message is included so users still see *why* without a permanent panel.
  function toastHealthSummary() {
    var hc = state.health;
    if (!hc) return;
    var c = countHealth(hc);
    var detail = "";
    for (var i = 0; i < hc.checks.length; i++) {
      if (hc.checks[i].level === "warning") {
        detail = " · " + hc.checks[i].message;
        break;
      }
    }
    toast(I18N.format("healthToast", { p: c.pass, w: c.warning, e: c.error }) + detail);
  }

  // ---------------------------------------------------------------------------
  // Per-model favourite / excluded state.
  //
  // Single source of truth: state.result.modelStates — a map of
  // rank -> { favorite, excluded }. The table, the detail dialog, the Pareto
  // view and the Compare view all read this one map, so the two control points
  // stay in sync by construction. makeProjectJson()/applyProject() move it into
  // the saved project; projects saved before this feature simply have no map
  // and deserialize to "nothing favourite / excluded".
  // ---------------------------------------------------------------------------
  var _projectSaveTimer = null;
  function scheduleProjectSaveSoon() {
    if (!state.result || !state.result.meta) return;
    clearTimeout(_projectSaveTimer);
    _projectSaveTimer = setTimeout(function () { storeProjectLocally(); }, 600);
  }

  function modelStates() {
    return state.result ? state.result.modelStates : null;
  }

  function ensureModelState(rank) {
    var st = modelStates();
    if (!st) return null;
    var s = st[rank];
    if (!s) s = st[rank] = { favorite: false, excluded: false };
    return s;
  }

  function isFavoriteModel(m) { return Core.modelFavorite(modelStates(), m); }
  function isExcludedModel(m) { return Core.modelExcluded(modelStates(), m); }

  function excludedModelCount() {
    var st = modelStates();
    var n = 0;
    if (st && state.result) {
      for (var i = 0; i < state.result.models.length; i++) {
        var s = st[state.result.models[i].rank];
        if (s && s.excluded) n++;
      }
    }
    return n;
  }

  // The one place that writes model state; everything else re-renders from it.
  function applyModelState(rank, patch) {
    if (!state.result) return;
    var s = ensureModelState(rank);
    if (!s) return;
    if (patch.favorite !== undefined) s.favorite = !!patch.favorite;
    if (patch.excluded !== undefined) s.excluded = !!patch.excluded;
    scheduleProjectSaveSoon();
    refreshStateUI();
  }

  function toggleShowExcluded() {
    state.showExcluded = !state.showExcluded;
    refreshStateUI();
  }

  // Re-render whatever is currently on screen after a model-state change so
  // table / detail / Pareto / Compare (and the Units view's live batch counts)
  // all reflect the same source of truth.
  function refreshStateUI() {
    syncDetailStateButtons();
    syncExcludedToggleUI();
    syncFavOnlyUI();
    if (state.view === "table" || state.view === "grid") renderModels();
    else if (state.view === "pareto") renderPareto();
    else if (state.view === "compare") renderCompare();
    else if (state.view === "units") renderUnits();
  }

  // The results-toolbar "show excluded" toggle (also drives the Compare picker
  // visibility through the same flag).
  function syncExcludedToggleUI() {
    var btn = $("#btn-excluded");
    if (!btn) return;
    var n = excludedModelCount();
    btn.textContent = I18N.t(state.showExcluded ? "excludedHiddenBtn" : "excludedShowBtn");
    btn.classList.toggle("is-active", state.showExcluded);
    btn.disabled = !state.showExcluded && n === 0;
    btn.title = n ? I18N.format("excludedTooltip", { n: n }) : I18N.t("excludedNone");
    btn.setAttribute("aria-pressed", state.showExcluded ? "true" : "false");
  }

  // Favourite / exclude buttons inside the model detail dialog.
  function syncDetailStateButtons() {
    var m = state.currentModel;
    if (!m) return;
    var favBtn = $("#btn-detail-fav");
    var exclBtn = $("#btn-detail-excl");
    if (favBtn) {
      var fav = isFavoriteModel(m);
      favBtn.innerHTML = fav ? ICON_STAR_FILL : ICON_STAR;
      favBtn.classList.toggle("is-active", fav);
      favBtn.setAttribute("aria-pressed", fav ? "true" : "false");
      favBtn.title = I18N.t(fav ? "actionUnfavorite" : "actionFavorite");
      favBtn.setAttribute("aria-label", I18N.t(fav ? "actionUnfavorite" : "actionFavorite"));
    }
    if (exclBtn) {
      var excl = isExcludedModel(m);
      exclBtn.innerHTML = excl ? ICON_EYE_OFF : ICON_EYE;
      exclBtn.classList.toggle("is-active", excl);
      exclBtn.setAttribute("aria-pressed", excl ? "true" : "false");
      exclBtn.title = I18N.t(excl ? "actionRestore" : "actionExclude");
      exclBtn.setAttribute("aria-label", I18N.t(excl ? "actionRestore" : "actionExclude"));
    }
  }

  // Row icon button (favourite or exclude) used in the models table.
  function makeStateIconButton(kind, m) {
    var isFav = kind === "fav";
    var active = isFav ? isFavoriteModel(m) : isExcludedModel(m);
    var b = el("button", "icon-btn" + (active ? " is-active" : ""), null);
    b.type = "button";
    var titleKey = isFav
      ? (active ? "actionUnfavorite" : "actionFavorite")
      : (active ? "actionRestore" : "actionExclude");
    b.title = I18N.t(titleKey);
    b.setAttribute("aria-label", I18N.t(titleKey));
    b.innerHTML = isFav ? (active ? ICON_STAR_FILL : ICON_STAR)
      : (active ? ICON_EYE_OFF : ICON_EYE);
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isFav) applyModelState(m.rank, { favorite: !active });
      else applyModelState(m.rank, { excluded: !active });
    });
    return b;
  }

  // Attach an inline spinner + disabled state to a button during an async op.
  function setButtonLoading(btn, isLoading, loadingText) {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.dataset.prevHtml = btn.innerHTML;
      var spin = document.createElement("span");
      spin.className = "btn-spinner";
      spin.setAttribute("aria-hidden", "true");
      btn.innerHTML = "";
      btn.appendChild(spin);
      if (loadingText) btn.appendChild(document.createTextNode(" " + loadingText));
    } else {
      btn.classList.remove("is-loading");
      if (btn.dataset.prevHtml !== undefined) {
        btn.innerHTML = btn.dataset.prevHtml;
        delete btn.dataset.prevHtml;
      }
    }
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return I18N.t("noVerify");
    if (typeof v !== "number") return v;
    if (!Number.isFinite(v)) return "∞";
    return v.toFixed(digits === undefined ? 4 : digits);
  }

  // Short, human-friendly axis-tick label. ECharts puts the exact boundary
  // value on the outermost ticks (e.g. 8.785202191971592) — trim that noise.
  function fmtTick(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "";
    var a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e7)) return v.toExponential(2).replace("e+", "e");
    var s = String(parseFloat(v.toFixed(4)));
    return s === "-0" ? "0" : s;
  }

  // ---------------------------------------------------------------------------
  // File classification
  // ---------------------------------------------------------------------------
  function classify(name) {
    for (var i = 0; i < FILE_ROLES.length; i++) {
      if (FILE_ROLES[i].match(name)) return FILE_ROLES[i].role;
    }
    return null;
  }

  function basename(path) {
    var parts = String(path).split(/[\\/]/);
    return parts[parts.length - 1];
  }

  function ingestFiles(fileList) {
    clearHealthPanels(); // stale health report no longer applies to the new file set
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      var name = f.webkitRelativePath ? basename(f.webkitRelativePath) : f.name;
      var role = classify(name);
      if (!role) continue;
      state.files[role] = { name: name, file: f };
    }
    renderFileList();
    renderRunButton();
  }

  function hasAllRequired() {
    return FILE_ROLES.every(function (r) {
      return r.optional || state.files[r.role];
    });
  }

  function renderRunButton() {
    $("#btn-run").disabled = !hasAllRequired();
  }

  // ---------------------------------------------------------------------------
  // Built-in example demo ("try the model" without any upload)
  // ---------------------------------------------------------------------------
  // DEMO_DATA (js/demo-data.js) holds the sanitized example run as strings;
  // we rebuild File objects and feed them through the exact upload pipeline so
  // a demo behaves like a real analysis (auto-saved to recent projects too).
  var DEMO_DEFS = [
    { role: "train", key: "train", file: "train.dat" },
    { role: "verify", key: "verify", file: "verify.dat" },
    { role: "uspace", key: "uspace", file: "Uspace.expressions" },
    { role: "top", key: "top", file: "top0232_D001" },
    { role: "coeff", key: "coeff", file: "top0232_D001_coeff" },
    { role: "sissoin", key: "sissoin", file: "SISSO.in" },
    { role: "sissoout", key: "sissoout", file: "SISSO.out" },
  ];

  function loadDemo() {
    var data = window.DEMO_DATA;
    if (!data) { toast(I18N.t("demoErr")); return; }
    var btn = $("#btn-demo");
    if (btn) setButtonLoading(btn, true, I18N.t("demoLoading"));
    // Let the spinner paint before the (synchronous-heavy) analysis starts.
    setTimeout(function () {
      try {
        state.files = {};
        DEMO_DEFS.forEach(function (def) {
          if (data[def.key] === undefined) return;
          state.files[def.role] = {
            name: def.file,
            file: new File([data[def.key]], def.file, { type: "text/plain" }),
          };
        });
        renderFileList();
        renderRunButton();
        run().then(function () {
          if (btn) setButtonLoading(btn, false);
        });
      } catch (err) {
        console.error(err);
        toast(I18N.t("demoErr"));
        if (btn) setButtonLoading(btn, false);
      }
    }, 30);
  }

  // ---------------------------------------------------------------------------
  // Archive & folder extraction
  // ---------------------------------------------------------------------------
  var ARCHIVE_RE = /\.(zip|tar\.gz|tgz|tar|gz)$/i;

  function isArchive(name) {
    return ARCHIVE_RE.test(name);
  }

  // Read a File into a Uint8Array.
  function fileToBytes(file) {
    return file.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  // Gunzip a File via the native DecompressionStream (gzip).
  function gunzipFile(file) {
    if (typeof DecompressionStream !== "function") {
      return Promise.reject(new Error("gzip unsupported in this browser"));
    }
    try {
      var ds = new DecompressionStream("gzip");
      var stream = file.stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Parse a tar archive (Uint8Array) into [{name, bytes}].
  // Handles GNU/ustar long-name entries (typeflag "L") and the ustar prefix.
  function parseTar(data) {
    var out = [];
    var pos = 0;
    var textDecoder = new TextDecoder();

    function cstr(view, off, len) {
      var end = off;
      while (end < off + len && view[end] !== 0) end++;
      return textDecoder.decode(view.subarray(off, end));
    }
    function octal(view, off, len) {
      var s = cstr(view, off, len).trim();
      return s ? parseInt(s, 8) : 0;
    }

    var pendingLongName = null;
    while (pos + 512 <= data.length) {
      var block = data.subarray(pos, pos + 512);
      if (block.every(function (b) { return b === 0; })) break;

      var nameField = cstr(block, 0, 100);
      var size = octal(block, 124, 12);
      var typeflag = String.fromCharCode(block[156] || 48); // '0' = regular
      var prefix = cstr(block, 345, 155);
      var bodyStart = pos + 512;

      if (typeflag === "L") {
        // GNU long name: the body is the (NUL-terminated) real filename.
        pendingLongName = cstr(data.subarray(bodyStart, bodyStart + size), 0, size);
      } else if (typeflag === "0" || typeflag === "\u0000" || typeflag === " " ||
                 typeflag === "7") {
        // Regular file (or contiguous file '7' in old GNU tar).
        var fullName = pendingLongName !== null ? pendingLongName
          : (prefix ? prefix + "/" : "") + nameField;
        pendingLongName = null;
        var content = data.subarray(bodyStart, bodyStart + size);
        out.push({ name: fullName, bytes: content.slice() });
      } else {
        // directory ('5'), symlink ('2'), pax ('x'/'g'), etc. — skip.
        pendingLongName = null;
      }

      pos = bodyStart + Math.ceil(size / 512) * 512;
    }
    return out;
  }

  // Expand a single archive file into [{name, file}] (or [] if not an archive).
  async function expandArchive(file) {
    var name = file.name.toLowerCase();

    if (name.endsWith(".zip")) {
      if (typeof window.JSZip !== "function") {
        throw new Error("zip support (JSZip) not loaded");
      }
      var zip = await window.JSZip.loadAsync(file);
      var out = [];
      var entries = zip.files;
      for (var path in entries) {
        var ze = entries[path];
        if (ze.dir) continue;
        var bn = basename(path);
        if (!bn) continue;
        var blob = await ze.async("blob");
        out.push({ name: bn, file: new File([blob], bn) });
      }
      return out;
    }

    if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
      var gunzipped = await gunzipFile(file);
      return parseTar(gunzipped).map(function (e) {
        var bn = basename(e.name);
        return { name: bn, file: new File([e.bytes], bn) };
      });
    }

    if (name.endsWith(".tar")) {
      var bytes = await fileToBytes(file);
      return parseTar(bytes).map(function (e) {
        var bn = basename(e.name);
        return { name: bn, file: new File([e.bytes], bn) };
      });
    }

    if (name.endsWith(".gz")) {
      var gz = await gunzipFile(file);
      var base = basename(file.name).replace(/\.gz$/i, "");
      return [{ name: base, file: new File([gz], base) }];
    }

    return [];
  }

  // Recursively collect all files from DataTransfer items (supports folders).
  function itemsToFiles(items) {
    var results = [];
    var pending = [];

    function addFile(f) { results.push(f); }
    function readDir(entry) {
      return new Promise(function (resolve) {
        var reader = entry.createReader();
        var all = [];
        (function readBatch() {
          reader.readEntries(function (entries) {
            if (!entries.length) { resolve(all); return; }
            all = all.concat(entries);
            readBatch();
          }, function () { resolve(all); });
        })();
      });
    }
    function walk(entry) {
      return new Promise(function (resolve) {
        if (entry.isFile) {
          entry.file(function (f) { addFile(f); resolve(); }, function () { resolve(); });
        } else if (entry.isDirectory) {
          readDir(entry).then(function (entries) {
            var chain = Promise.resolve();
            entries.forEach(function (e) { chain = chain.then(function () { return walk(e); }); });
            chain.then(resolve);
          });
        } else { resolve(); }
      });
    }

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) pending.push(walk(entry));
      else if (item.getAsFile) { var f = item.getAsFile(); if (f) addFile(f); }
    }
    return Promise.all(pending).then(function () { return results; });
  }

  // Accepts: a FileList, an array of File, or a DataTransferItemList.
  // Expands archives and folders, classifies every file, and updates state.
  async function ingest(items) {
    var files = [];
    if (items instanceof FileList || Array.isArray(items)) {
      files = Array.prototype.slice.call(items);
    } else if (items && typeof items.length === "number") {
      // DataTransferItemList
      files = await itemsToFiles(items);
    }

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f) continue;
      var name = f.webkitRelativePath ? basename(f.webkitRelativePath) : f.name;
      if (isArchive(name)) {
        var role = classify(name);
        // A bare .gz whose basename (sans .gz) matches a role is still handled
        // by expansion; the expanded entry is classified below.
        try {
          var expanded = await expandArchive(f);
          expanded.forEach(function (e) {
            var r = classify(e.name);
            if (r) state.files[r] = { name: e.name, file: e.file };
          });
          // If the archive itself already matched a role and expanded nothing,
          // keep the archive as the role (should not normally happen).
          if (role && !expanded.length) state.files[role] = { name: name, file: f };
        } catch (err) {
          console.error("archive expand failed for " + name + ":", err);
          toast("Failed to read archive " + name + ": " + err.message);
        }
        continue;
      }
      var role2 = classify(name);
      if (role2) state.files[role2] = { name: name, file: f };
    }
    renderFileList();
    renderRunButton();
  }

  function renderFileList() {
    var list = $("#file-list");
    list.innerHTML = "";
    FILE_ROLES.forEach(function (r) {
      var item = el("li", "file-item");
      var dot = el("span", "file-item__dot");
      var name = el("span", "file-item__name");
      var roleTag = el("span", "file-item__role");
      name.textContent = I18N.t(r.i18n);
      roleTag.textContent = r.required ? I18N.t("required") : I18N.t("optional");
      var got = state.files[r.role];
      if (got) {
        dot.classList.add("is-ok");
        name.textContent += " · " + got.name;
      } else if (r.required) {
        dot.classList.add("is-missing");
      } else {
        dot.classList.add("is-warn");
      }
      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(roleTag);
      list.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // Unit (dimension) matrix — group train.dat features by their unit vector
  // ---------------------------------------------------------------------------
  // unitRows: one row per feature column (train.dat order after name+target).
  // featureNames: the original column names in the same order.
  function buildUnitInfo(unitRows, featureNames) {
    var nBasis = unitRows.length ? unitRows[0].length : 0;
    var groups = Core.groupUnitRows(unitRows);

    // Stable ordering: non-dimensionless groups keep first-appearance order
    // (= funit basis order); the dimensionless (all-zero) group goes last.
    var ordered = [];
    var dimless = null;
    groups.forEach(function (g) {
      if (g.dimensionless) dimless = g;
      else ordered.push(g);
    });
    if (dimless) ordered.push(dimless);

    var nameToGroup = {};   // feature name -> group index
    var groupMeta = ordered.map(function (g, gi) {
      var members = g.rows.map(function (r) { return featureNames[r]; });
      members.forEach(function (name) { nameToGroup[name] = gi; });
      // Display range in 1-based feature numbering (matches SISSO.in funit).
      var first = g.rows[0] + 1, last = g.rows[g.rows.length - 1] + 1;
      return {
        idx: gi,
        vector: g.vector.slice(),
        dimensionless: g.dimensionless,
        n: g.rows.length,
        first: first,
        last: last,
        rangeText: first === last ? String(first) : (first + "–" + last),
        members: members,
      };
    });
    return {
      nBasis: nBasis,
      groups: groupMeta,
      nameToGroup: nameToGroup,
    };
  }

  // Colour the feature-name tokens inside a model formula according to their
  // dimension group. Falls back to plain text when no unit info exists.
  var FORMULA_TOKEN_RE = /([A-Za-z_][A-Za-z0-9_]*)/g;
  function colorizeFormula(text) {
    if (!text) return document.createTextNode("");
    var frag = document.createDocumentFragment();
    var units = state.result && state.result.meta && state.result.meta.units;
    var map = units ? units.nameToGroup : null;
    var last = 0;
    FORMULA_TOKEN_RE.lastIndex = 0;
    var m;
    while ((m = FORMULA_TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var token = m[1];
      if (map && Object.prototype.hasOwnProperty.call(map, token)) {
        var span = document.createElement("span");
        span.className = "unit-token unit-g" + map[token];
        span.textContent = token;
        span.title = units.groups[map[token]].dimensionless ? "dimensionless" : "unit group " + (map[token] + 1);
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(token));
      }
      last = m.index + token.length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  function setFormulaContent(node, text) {
    if (!node) return;
    node.textContent = "";
    node.appendChild(colorizeFormula(text));
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  async function run() {
    var btn = $("#btn-run");
    setButtonLoading(btn, true, I18N.t("analyzing"));
    showLoading("analyzing");

    try {
      var roleTexts = {};
      roleTexts.train = await readFileAsText(state.files.train.file);
      roleTexts.uspace = await readFileAsText(state.files.uspace.file);
      roleTexts.coeff = await readFileAsText(state.files.coeff.file);
      roleTexts.top = await readFileAsText(state.files.top.file);
      if (state.files.verify) roleTexts.verify = await readFileAsText(state.files.verify.file);
      if (state.files.sissoin) roleTexts.sissoin = await readFileAsText(state.files.sissoin.file);
      if (state.files.sissoout) roleTexts.sissoout = await readFileAsText(state.files.sissoout.file);

      // a fresh analyze run starts a brand-new project identity
      state.projectId = null;

      // let the UI paint the "analyzing" state before the synchronous parse
      await new Promise(function (r) { setTimeout(r, 30); });

      // Analysis health check — catch data / parse problems with a compact
      // Passed / Warning / Error report BEFORE the heavy pipeline. Only real
      // blockers (error level) stop the run; warnings continue and are shown
      // with the results. A broken verify.dat is dropped (train-only mode).
      clearHealthPanels();
      state.health = HealthCheck.check({
        train: roleTexts.train,
        verify: roleTexts.verify,
        top: roleTexts.top,
        coeff: roleTexts.coeff,
        uspace: roleTexts.uspace,
      });
      if (state.health.level === "error") {
        renderHealthReport(state.health, $("#health-block"));
        toast(I18N.t("healthBlocked"));
        return; // stays on the upload view with the report visible
      }
      if (state.health.dropVerify) delete roleTexts.verify;

      processTexts(roleTexts);
      // Healthy/warning runs: one short-lived toast, no permanent panel.
      toastHealthSummary();
    } catch (err) {
      console.error(err);
      toast(I18N.t("errParse") + " " + (err && err.message ? err.message : ""));
    } finally {
      setButtonLoading(btn, false);
      hideLoading();
      renderRunButton();
    }
  }

  // Shared analysis entry point used by a fresh upload (run) and by loading a
  // saved project. `init` may carry { modelStates } so favourites/exclusions
  // saved inside a project JSON are restored onto the freshly rebuilt models.
  function processTexts(roleTexts, init) {
    var files = {};
    files.trainText = roleTexts.train;
    files.uspaceText = roleTexts.uspace;
    files.coeffText = roleTexts.coeff;
    files.topText = roleTexts.top;
    if (roleTexts.verify !== undefined) files.verifyText = roleTexts.verify;

    // keep the raw texts so the project can be saved / re-exported later
    state.texts = {};
    FILE_ROLES.forEach(function (r) {
      if (roleTexts[r.role] !== undefined) state.texts[r.role] = roleTexts[r.role];
    });

    state.result = Core.runPipeline(files);
    // Single source of truth for per-model favourite / excluded flags. A saved
    // project may bring one along (pruned to the ranks that still exist);
    // otherwise every model starts unflagged.
    state.result.modelStates = Core.normalizeModelStates(init && init.modelStates,
      new Set(state.result.models.map(function (m) { return m.rank; })));

    // Parse the unit (dimension) matrix from SISSO.out, when provided, and map
    // every train.dat feature column to its dimension group. Rows of the unit
    // matrix are in train.dat feature-column order (column 1 == the first
    // feature after name + target), matching how SISSO.in's funit=(...) ranges
    // are written. Uspace expressions use the original feature names, so we key
    // by name to colour model formulas.
    var unitInfo = null;
    if (roleTexts.sissoout !== undefined) {
      var unitRows = Core.parseUnitMatrix(roleTexts.sissoout);
      if (unitRows) {
        var featureNames = Core.readHeaderNames(roleTexts.train).slice(2);
        unitInfo = buildUnitInfo(unitRows, featureNames);
      }
    }
    state.result.meta.units = unitInfo;

    // Usage statistics (feature & descriptor frequency across the candidate
    // models) are derived once per run and cached on the result; the Units
    // view renders from here, and batch ops match models with these helpers.
    state.result.usage = Core.usageReport(state.result);

    // A fresh analysis starts with no filter and the default sort.
    state.filter = newEmptyFilter();
    state.sortKey = "rank";
    state.sortAsc = true;
    state.loadAll = false;
    state.topN = 100;
    state.showExcluded = false;
    state.favOnly = false;
    state.batchSel = { table: new Set(), pareto: new Set() };
    state.batchOps = [];
    state.usageSort = { feature: { by: "count", asc: false }, descriptor: { by: "count", asc: false } };
    state.usageExpanded = { feature: false, descriptor: false };
    state.compareSel = [];
    disposeCompareChart();

    // Enrich the run metadata with SISSO.in settings, with safe fallbacks so
    // the dimension / complexity cards still show when SISSO.in is missing or
    // uses an older keyword:
    //  - dimension  <- desc_dim (SISSO.in), else from the top file name (top2D00)
    //  - complexity <- fcomplexity (SISSO.in), else estimated from the used
    //                  Uspace feature expressions (# of operators)
    var info = roleTexts.sissoin !== undefined ? parseSissoIn(roleTexts.sissoin) : null;
    if (!info) {
      info = { nsample: null, nsf: null, descDim: null, fcomplexity: null, ptype: null };
    }
    var topName = state.files.top ? String(state.files.top.name) : "";
    var mDim = /^top\s*(\d+)\s*D/i.exec(topName);
    if (info.descDim === null && mDim) {
      info.descDim = parseInt(mDim[1], 10);
      info.descDimFromName = true;
    }
    if (info.fcomplexity === null) {
      var est = estimateMaxComplexity(roleTexts.uspace, collectUsedFeatureIds(state.result));
      if (est !== null) {
        info.fcomplexity = est;
        info.cplxEstimated = true;
      }
    }
    state.result.meta.sissoIn = info;

    showResults();

    // Auto-save into the browser's recent list (like USPEX-Analyzer) — no
    // manual "Save project" click needed.
    storeProjectLocally();
    // Remember this project as the active session so a refresh restores it.
    persistSession();
  }

  // ---------------------------------------------------------------------------
  // Results rendering
  // ---------------------------------------------------------------------------
  // Left-nav state: upload ("Load results") vs. loaded run + sub-views.
  function setNavState(hasResults) {
    var t = $("#view-table-btn"), g = $("#view-grid-btn"), p = $("#view-pareto-btn"),
        c = $("#view-compare-btn"), u = $("#view-units-btn");
    var home = $("#btn-nav-home");
    if (hasResults) {
      document.body.classList.add("has-results");
      if (home) home.classList.remove("is-active");
      if (t) t.disabled = false;
      if (g) g.disabled = false;
      if (p) p.disabled = false; // available for train-only runs too; hidden in renderControls when no result
      if (c) c.disabled = false;
      if (u) u.disabled = false; // unit gating happens in renderControls
    } else {
      document.body.classList.remove("has-results");
      if (home) home.classList.add("is-active");
      [t, g, p, c, u].forEach(function (b) {
        if (b) { b.disabled = true; b.classList.remove("is-active"); }
      });
    }
  }

  function showResults() {
    $("#view-upload").hidden = true;
    $("#view-results").hidden = false;
    $("#btn-reset").hidden = false;
    setNavState(true);

    var res = state.result;
    var ctx = $("#app-context");
    if (ctx) {
      var label = res.meta.targetName || "";
      if (res.meta.sissoIn && res.meta.sissoIn.descDim !== null) label += " · " + res.meta.sissoIn.descDim + "D";
      ctx.textContent = label;
      ctx.hidden = !label;
    }

    if (res.meta.validationNote === "in-sample") {
      var w = $("#warning");
      w.textContent = I18N.t("inSampleWarning");
      w.hidden = false;
    } else {
      $("#warning").hidden = true;
    }

    renderKpis();
    renderControls();
    populateColorSelect();
    renderFilterSummary();
    renderModels();
    refreshHealthPanels();
  }

  function renderKpis() {
    var res = state.result;
    var strip = $("#kpi-strip");
    strip.innerHTML = "";
    var info = res.meta.sissoIn || null;
    var fromIn = I18N.t("projectFromSissoIn");
    var kpis = [
      [I18N.t("kpiModels"), res.meta.nModels],
      [I18N.t("kpiTrain"), res.meta.nTrain],
      [I18N.t("kpiVerify"), res.meta.nVerify || I18N.t("noVerify")],
    ];
    // Number of features: prefer SISSO.in's nsf when the file was uploaded,
    // otherwise fall back to the column count of train.dat.
    if (info && info.nsf !== null) {
      kpis.push([I18N.t("kpiFeatures"), info.nsf, fromIn]);
    } else {
      kpis.push([I18N.t("kpiFeatures"), res.meta.nFeatures]);
    }
    // Dimension & complexity: SISSO.in (desc_dim / fcomplexity) when available,
    // with fallbacks from the top-file name and the used feature expressions.
    if (info && info.descDim !== null) {
      kpis.push([I18N.t("kpiDim"), info.descDim, info.descDimFromName ? "" : fromIn]);
    }
    if (info && info.fcomplexity !== null) {
      kpis.push([I18N.t("kpiComplexity"), info.fcomplexity,
        info.cplxEstimated ? I18N.t("complexityEstimated") : fromIn]);
    }

    kpis.forEach(function (k) {
      var card = el("div", "kpi");
      card.appendChild(el("div", "kpi__label", k[0]));
      card.appendChild(el("div", "kpi__value", String(k[1])));
      if (k[2]) card.title = k[2];
      strip.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Table columns — a single description drives the header, cell rendering,
  // column management, numeric filters and column-header sorting.
  //   id        stable column id, also used as the sort key ("rmse-train")
  //   label()   dynamic i18n label (called with no args)
  //   numeric   true => value comes from model metrics, numeric filterable
  //   metric    metrics key (rmse/maxae/r2/rho) — undefined for rank/formula
  //   dataset   "train" | "verify" — undefined for rank/formula
  //   get(m)    returns the raw value of the column for a model
  // ---------------------------------------------------------------------------
  var COL_METRICS = [
    { metric: "rmse", labelKey: "metricRMSE" },
    { metric: "maxae", labelKey: "metricMaxAE" },
    { metric: "r2", labelKey: "metricR2" },
    { metric: "rho", labelKey: "metricRho" },
  ];

  function metricValue(m, metric, dataset) {
    // Single source of truth: everything reads through SissoCore.metricValue
    // (which also implements the "delta" generalization-gap pseudo-dataset), so
    // table / filter / sort / Pareto can never disagree about a value.
    var v = Core.metricValue(m, dataset, metric);
    return Number.isFinite(v) ? v : null;
  }

  // Short display dataset tag for delta columns ("ΔRMSE (V−T)" …).
  function deltaColLabel(metricLabelKey) {
    return "Δ" + I18N.t(metricLabelKey) + " (" + I18N.t("detailDeltaShort") + ")";
  }

  // Explicit per-metric definition text (shown as a tooltip on delta columns,
  // filter rows and Pareto delta options) so the sign convention is never
  // guessed: positive always means validation performed worse than training.
  function deltaMetricDefinition(metricKey, metricLabelKey) {
    var label = "Δ" + I18N.t(metricLabelKey);
    return I18N.format(metricKey === "r2" || metricKey === "rho"
      ? "deltaDefInv" : "deltaDefDiff", { label: label });
  }

  function buildTableColumns() {
    var hasVerify = !!(state.result && state.result.verify);
    // Column order in the overview table: batch-check, rank, model formula,
    // ACTIONS, then the train / verify / Δ metric columns — the row actions
    // (View · favourite · exclude) sit right after the formula, not at the end.
    var cols = [
      { id: "rank", label: function () { return I18N.t("colRank"); }, numeric: false, get: function (m) { return m.rank; } },
      { id: "formula", label: function () { return I18N.t("colFormula"); }, numeric: false, get: function (m) { return m.formulaOriginal; } },
      {
        id: "actions", label: function () { return I18N.t("colActions"); }, numeric: false, get: function () { return null; },
      },
    ];
    COL_METRICS.forEach(function (d) {
      cols.push({
        id: d.metric + "-train", label: function () { return I18N.t(d.labelKey) + " (" + I18N.t("detailTrain") + ")"; },
        numeric: true, metric: d.metric, dataset: "train",
        get: function (m) { return metricValue(m, d.metric, "train"); },
      });
      if (hasVerify) {
        cols.push({
          id: d.metric + "-verify", label: function () { return I18N.t(d.labelKey) + " (" + I18N.t("detailVerify") + ")"; },
          numeric: true, metric: d.metric, dataset: "verify",
          get: function (m) { return metricValue(m, d.metric, "verify"); },
        });
        cols.push({
          id: d.metric + "-delta", label: function () { return deltaColLabel(d.labelKey); },
          hint: function () { return deltaMetricDefinition(d.metric, d.labelKey); },
          numeric: true, metric: d.metric, dataset: "delta",
          get: function (m) { return metricValue(m, d.metric, "delta"); },
        });
      }
    });
    return cols;
  }

  // Columns the user has hidden (state.hiddenCols, persisted). "actions" is
  // structural and can never be hidden.
  function visibleTableColumns() {
    return buildTableColumns().filter(function (c) {
      return c.id === "actions" || !state.hiddenCols[c.id];
    });
  }

  // Resolve a column id ("rmse-train") back to a definition (used by numeric
  // filters, which are keyed by the same ids).
  function tableColumnById(id) {
    var cols = buildTableColumns();
    for (var i = 0; i < cols.length; i++) if (cols[i].id === id) return cols[i];
    return null;
  }

  // Load all <-> Top N toggle: "Load all" renders every filtered model, and
  // toggling back restores the default window (state.topN).
  function syncLoadAllButton() {
    var btn = $("#btn-load-all");
    if (!btn) return;
    btn.textContent = state.loadAll ? I18N.t("loadTop") : I18N.t("loadAll");
    btn.title = state.loadAll ? I18N.t("loadTopTitle") : I18N.t("loadAllTitle");
  }

  // Grid view has no column headers, so the toolbar sort control is the
  // sorting surface there; table view keeps header-click sorting and hides
  // this duplicate. Both write the same state.sortKey / state.sortAsc, so a
  // sort started in either view is preserved when switching.
  function syncGridSortUI() {
    var keySel = $("#grid-sort-key");
    if (!keySel || !state.result) return;
    keySel.innerHTML = "";
    buildTableColumns().forEach(function (c) {
      if (c.id !== "rank" && !c.numeric) return;
      var o = el("option", null, c.label());
      o.value = c.id;
      keySel.appendChild(o);
    });
    // Never let the UI point at a key that has no option (e.g. a verify sort
    // restored from a session without verify data) — fall back to rank.
    if (!keySel.querySelector('option[value="' + state.sortKey + '"]')) {
      state.sortKey = "rank";
      state.sortAsc = true;
    }
    keySel.value = state.sortKey;
    var dirBtn = $("#grid-sort-dir");
    if (dirBtn) {
      dirBtn.textContent = state.sortAsc ? "▲" : "▼";
      dirBtn.title = I18N.t("sortDir");
      dirBtn.setAttribute("aria-label", I18N.t("sortDir") + (state.sortAsc ? " ▲" : " ▼"));
    }
  }

  function renderControls() {
    // Sorting is column-header driven (click a header to sort); no dropdowns.
    syncLoadAllButton();

    // Keep the Pareto axes valid for the datasets that actually exist in the
    // current run, then rebuild the three axis selects. Every axis is now a
    // (dataset, metric) pair: dataset options are derived from the run (Train,
    // plus Verify when a verify file was analysed), so a train-only run can
    // plot e.g. Train RMSE × Train MaxAE. Metric direction stays preset
    // (↓ smaller better, ↑ bigger better).
    coerceParetoAxes();
    var datasets = paretoDatasets();
    var axisSelects = [
      ["#pareto-x", "paretoX"],
      ["#pareto-y", "paretoY"],
      ["#pareto-z", "paretoZ"],
    ];
    for (var si = 0; si < axisSelects.length; si++) {
      var s = $(axisSelects[si][0]);
      if (!s) continue;
      var key = axisSelects[si][1];
      var spec = state[key];
      s.innerHTML = "";
      for (var di = 0; di < datasets.length; di++) {
        var isDeltaGroup = datasets[di] === "delta";
        var group = el("optgroup");
        group.label = isDeltaGroup ? I18N.t("paretoDeltaGroup")
          : I18N.t(datasets[di] === "verify" ? "detailVerify" : "detailTrain");
        for (var mi = 0; mi < PARETO_METRICS.length; mi++) {
          var d = PARETO_METRICS[mi];
          // Delta is defined "smaller = better" for all four metrics, so the
          // ↑/↓ arrows always point down there. The Pareto chart trades off the
          // gap MAGNITUDE (|Δ|), never its direction.
          var minim = isDeltaGroup || d.minimize;
          var opt = el("option", null, (isDeltaGroup ? "|Δ" : "") + I18N.t(d.label) + (isDeltaGroup ? "|" : "") + (minim ? " ↓" : " ↑"));
          opt.value = datasets[di] + "|" + d.key;
          if (isDeltaGroup) {
            opt.title = deltaAxisDefinition(d.key, d.label);
          }
          group.appendChild(opt);
        }
        s.appendChild(group);
      }
      if (spec) {
        s.value = spec.dataset + "|" + spec.metric;
        // hovering the axis select explains the sign convention for Δ axes
        s.title = spec.dataset === "delta"
          ? deltaAxisDefinition(spec.metric, paretoMetricDef(spec.metric).label)
          : "";
      }
    }
    var zField = $("#pareto-z-field");
    if (zField) zField.hidden = state.paretoMode !== "3d";
    var modeBtn = $("#pareto-mode-btn");
    if (modeBtn) {
      modeBtn.textContent = state.paretoMode === "2d" ? I18N.t("paretoMode3D") : I18N.t("paretoMode2D");
    }

    // view toggle (Pareto works with train-only runs as well)
    var res = state.result;
    $("#view-table-btn").classList.toggle("is-active", state.view === "table");
    $("#view-grid-btn").classList.toggle("is-active", state.view === "grid");
    $("#view-pareto-btn").classList.toggle("is-active", state.view === "pareto");
    $("#view-compare-btn").classList.toggle("is-active", state.view === "compare");
    $("#view-units-btn").classList.toggle("is-active", state.view === "units");
    $("#view-pareto-btn").disabled = !res;
    $("#view-compare-btn").disabled = !res;
    // The Units / dimension view hosts the dimension groups (needs SISSO.out)
    // AND the feature & descriptor usage tables (which only need the models),
    // so it is available for every analysed run.
    $("#view-units-btn").disabled = !res;
    $("#table-wrap").hidden = state.view !== "table";
    $("#grid-wrap").hidden = state.view !== "grid";
    $("#pareto-wrap").hidden = state.view !== "pareto";
    $("#compare-wrap").hidden = state.view !== "compare";
    $("#units-wrap").hidden = state.view !== "units";
    // The Filter control is meaningful in the list views, on the Pareto scatter
    // (filtered/excluded models become faint "ghosts" that never join the front)
    // and on the Compare picker (same eligible model set). The Load-all toggle
    // and the "showing N of M" note are list-view only. Units is its own layout
    // and shows none of this chrome.
    var showListChrome = state.view === "table" || state.view === "grid";
    var showFilterChrome = showListChrome || state.view === "pareto" || state.view === "compare";
    var resToolbar = document.querySelector("#view-results .toolbar");
    if (resToolbar) resToolbar.hidden = !showFilterChrome;
    var countNote = $("#count-note");
    if (countNote) countNote.hidden = !showListChrome;
    var loadAllRow = $("#load-all-row");
    if (loadAllRow) loadAllRow.hidden = !showListChrome;

    // View-aware toolbar controls:
    //  - thumbnails: sorting via the toolbar (no headers to click)
    //  - table:      sorting via headers, and Columns applies only here
    var sortField = $("#grid-sort-field");
    if (sortField) sortField.hidden = state.view !== "grid";
    var colsAnchor = $("#cols-anchor");
    if (colsAnchor) colsAnchor.hidden = state.view !== "table";
    var favOnlyBtn = $("#btn-fav-only");
    if (favOnlyBtn) favOnlyBtn.hidden = !showListChrome; // list views only
    syncExcludedToggleUI();
    syncFavOnlyUI();
    syncGridSortUI();
  }

  // ---------------------------------------------------------------------------
  // Model query pipeline: all models -> filter -> sort -> visible slice.
  // Table and grid both consume visibleModels(), so filters apply to both.
  // ---------------------------------------------------------------------------

  // Which unit groups does a model's formula use? Scans the formula tokens
  // against the unit name->group map (same map that colours the tokens).
  var _groupCache = new WeakMap();
  function modelUnitGroups(m) {
    var units = state.result && state.result.meta && state.result.meta.units;
    if (!units || !units.nameToGroup) return null;
    var cached = _groupCache.get(m);
    if (cached) return cached;
    var map = units.nameToGroup;
    var set = new Set();
    var text = m.formulaOriginal || "";
    FORMULA_TOKEN_RE.lastIndex = 0;
    var tok;
    while ((tok = FORMULA_TOKEN_RE.exec(text)) !== null) {
      var g = map[tok[1]];
      if (g !== undefined) set.add(g);
    }
    var arr = Array.from(set).sort(function (a, b) { return a - b; });
    _groupCache.set(m, arr);
    return arr;
  }

  function newEmptyFilter() {
    return { active: false, includeMode: "any", include: null, exclude: null, numeric: {} };
  }

  // Which features does a model formula use? Same token scan + name map that
  // colours formulas; cached per model object.
  var _featCache = new WeakMap();
  function modelFeatures(m) {
    var units = state.result && state.result.meta && state.result.meta.units;
    if (!units || !units.nameToGroup) return null;
    var cached = _featCache.get(m);
    if (cached) return cached;
    var map = units.nameToGroup;
    var arr = [];
    var text = m.formulaOriginal || "";
    FORMULA_TOKEN_RE.lastIndex = 0;
    var tok;
    while ((tok = FORMULA_TOKEN_RE.exec(text)) !== null) {
      if (Object.prototype.hasOwnProperty.call(map, tok[1]) && arr.indexOf(tok[1]) < 0) arr.push(tok[1]);
    }
    _featCache.set(m, arr);
    return arr;
  }

  // Numeric / text constraints keyed by column id: { "<colId>": {min,max} }.
  function filterNumericMatch(m) {
    var f = state.filter;
    for (var colId in f.numeric) {
      if (!Object.prototype.hasOwnProperty.call(f.numeric, colId)) continue;
      var cond = f.numeric[colId];
      if (!cond || (cond.min == null && cond.max == null)) continue;
      var col = tableColumnById(colId);
      if (!col || !col.get) continue;
      var v = col.get(m);
      if (v === null || v === undefined || !Number.isFinite(v)) return false; // "—" never matches a range
      if (cond.min != null && v < cond.min) return false;
      if (cond.max != null && v > cond.max) return false;
    }
    return true;
  }

  // Feature-level include/exclude filter:
  //   exclude: the formula must not contain any excluded feature.
  //   include (mode "any"):  it must contain at least one included feature.
  //   include (mode "only"): every feature in it must be included.
  // When the unit map is unavailable (no SISSO.out) feature filters are inert.
  function filterFeatureMatch(m) {
    var f = state.filter;
    if (!f.include && !f.exclude) return true;
    var feats = modelFeatures(m);
    if (!feats || !feats.length) return true; // unknown unit space: not filterable
    if (f.exclude && f.exclude.size) {
      for (var i = 0; i < feats.length; i++) if (f.exclude.has(feats[i])) return false;
    }
    if (f.include && f.include.size) {
      if (f.includeMode === "only") {
        for (var j = 0; j < feats.length; j++) if (!f.include.has(feats[j])) return false;
      } else {
        var hit = false;
        for (var k = 0; k < feats.length; k++) if (f.include.has(feats[k])) { hit = true; break; }
        if (!hit) return false;
      }
    }
    return true;
  }

  function modelPassesFilter(m) {
    if (!state.filter.active) return true;
    return filterNumericMatch(m) && filterFeatureMatch(m);
  }

  // Model-level exclusion rides on top of the (feature/numeric) filter: by
  // default excluded models take no part in the list views, the Pareto front or
  // the Compare picker. Turning "show excluded" on brings them back into the
  // lists (marked) so users can restore them.
  function modelVisibleByExclusion(m) {
    return state.showExcluded || !isExcludedModel(m);
  }

  function filteredModels() {
    if (!state.result) return [];
    var applyFeature = state.filter.active;
    return state.result.models.filter(function (m) {
      if (!modelVisibleByExclusion(m)) return false;
      if (state.favOnly && !isFavoriteModel(m)) return false;
      if (applyFeature && !modelPassesFilter(m)) return false;
      return true;
    });
  }

  function sortedModels() {
    if (!state.result) return [];
    var list = filteredModels();
    var asc = state.sortAsc;
    // sortKey format: "rank" or "<metric>-<dataset>", e.g. "rmse-verify" or
    // "rmse-delta" (delta = the train→validation generalization gap). All
    // metric reads go through the same Core.metricValue accessor as the table
    // cells and the Pareto axes, so sorting can never disagree with the display.
    var sk = state.sortKey.split("-");
    var metric = sk[0];
    var dataset = sk.length > 1 ? sk[1] : "";
    var metricKey = (dataset === "verify" || dataset === "delta" || dataset === "train")
      && (metric === "rmse" || metric === "maxae" || metric === "r2" || metric === "rho")
      ? metric : null;

    // Normalise non-finite metrics to a deterministic endpoint so NaN values
    // never poison the comparator (which would make sort order unstable).
    // Endpoints sit on the metric's own "worse" side; for delta every metric is
    // smaller-better (a larger gap = worse), matching its rmse/maxae behaviour.
    function key(m) {
      if (!metricKey) return m.rank;
      var v = Core.metricValue(m, dataset, metricKey);
      if (Number.isFinite(v)) return v;
      return Core.metricSortEndpoint(metricKey, dataset);
    }

    list.sort(function (a, b) {
      var va = key(a), vb = key(b);
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return a.rank - b.rank;
    });
    return list;
  }

  function visibleModels() {
    var list = sortedModels();
    var n = state.loadAll ? list.length : Math.min(state.topN, list.length);
    return { list: list, total: list.length, shown: n };
  }

  function renderCount() {
    if (!state.result) { $("#count-note").textContent = ""; return; }
    var vis = visibleModels();
    if (state.filter.active) {
      $("#count-note").textContent = I18N.format("loadedFilteredCount", {
        shown: vis.shown,
        total: vis.total,
        all: state.result.meta.nModels,
      });
    } else {
      $("#count-note").textContent = I18N.format("loadedCount", {
        shown: vis.shown,
        total: vis.total,
      });
    }
  }

  // Render the models view. When the visible set is large (e.g. "load all"),
  // show a loading overlay and defer the heavy DOM build so the spinner paints
  // first and the UI does not appear frozen.
  var renderSeq = 0;
  function renderModels() {
    if (!state.result) return;
    var vis = visibleModels();
    var seq = ++renderSeq;

    renderCount();
    var listView = state.view === "table" || state.view === "grid";
    $("#empty-state").hidden = !listView || vis.shown > 0;

    if (vis.shown > 400) {
      showLoading("rendering");
      // Defer to let the overlay/spinner paint before the synchronous DOM build.
      setTimeout(function () {
        if (seq !== renderSeq) return; // a newer render superseded this one
        renderTable();
        renderGrid();
        hideLoading();
      }, 40);
    } else {
      renderTable();
      renderGrid();
    }
  }

  // ---------------------------------------------------------------------------
  // Batch "copy selected models" for AI comparison.
  //
  // The main results table and the Pareto table each get a checkbox column plus
  // a slim bar ("Copy selected (n)"). Copying builds one text block per chosen
  // model — the model formula (LaTeX, falling back to the original ASCII when
  // the formula does not parse) plus its fit statistics per dataset — so the
  // whole selection can be pasted straight into an AI prompt for comparison.
  // Selections live in state.batchSel, keyed per table view, and are reset on
  // every new analysis.
  // ---------------------------------------------------------------------------

  function batchSelSet(viewKey) {
    if (!state.batchSel) state.batchSel = { table: new Set(), pareto: new Set() };
    if (!state.batchSel[viewKey]) state.batchSel[viewKey] = new Set();
    return state.batchSel[viewKey];
  }

  function makeBatchCheckbox(m, viewKey) {
    var set = batchSelSet(viewKey);
    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "batch-check";
    box.dataset.rank = String(m.rank);
    box.checked = set.has(m.rank);
    box.setAttribute("aria-label", I18N.format("batchSelAria", { rank: m.rank }));
    // Never let a checkbox interaction open the model detail on the row behind it.
    box.addEventListener("click", function (e) { e.stopPropagation(); });
    box.addEventListener("keydown", function (e) { e.stopPropagation(); });
    return box;
  }

  function fmtBatchMetric(v) {
    return (typeof v === "number" && Number.isFinite(v)) ? String(Number(v.toPrecision(7))) : "NaN";
  }

  // One text block per model (see the function header for the format).
  function batchModelText(m) {
    var formula = m.formulaOriginal;
    try { formula = Core.formulaToLatex(m.formulaOriginal); } catch (e) { /* unparsable formula → keep original text */ }
    var lines = ["model" + m.rank + "：" + formula];
    var metricDefs = [["rmse", "RMSE"], ["maxae", "MaxAE"], ["r2", "R2"], ["rho", "rho"]];
    var datasets = ["train"];
    if (m.metricsVerify) datasets.push("verify");
    metricDefs.forEach(function (def) {
      datasets.forEach(function (ds) {
        var ms = ds === "verify" ? m.metricsVerify : m.metricsTrain;
        lines.push(def[1] + "_" + ds + ": " + fmtBatchMetric(ms ? ms[def[0]] : NaN));
      });
    });
    return lines.join("\n");
  }

  function batchModelsToText(models) {
    if (!models || !models.length) return "";
    return models.map(batchModelText).join("\n\n") + "\n";
  }

  // Create the "copy selected (n)" bar for one table and wire checkbox events.
  //   viewKey   "table" | "pareto" (state.batchSel key)
  //   entries   [{ m, box }] for every visible row of that table
  //   headBox   the "select all visible" checkbox in the header (may be null)
  // Returns the bar element (caller appends it above the table).
  function createBatchBar(viewKey, entries, headBox) {
    var set = batchSelSet(viewKey);
    var bar = el("div", "batch-bar");
    var countLbl = el("span", "batch-bar__count", "");
    var clearBtn = el("button", "btn btn--ghost btn--sm", I18N.t("compareClear"));
    clearBtn.type = "button";
    var copyBtn = el("button", "btn btn--primary btn--sm", "");
    copyBtn.type = "button";
    copyBtn.disabled = true;
    bar.appendChild(countLbl);
    bar.appendChild(clearBtn);
    bar.appendChild(copyBtn);

    function sync() {
      var n = 0;
      for (var i = 0; i < entries.length; i++) {
        if (set.has(entries[i].m.rank)) n++;
      }
      countLbl.textContent = I18N.format("batchSelCount", { n: n });
      copyBtn.textContent = I18N.format("batchCopy", { n: n });
      copyBtn.disabled = n === 0;
      if (headBox) {
        var all = entries.length > 0 && n === entries.length;
        headBox.checked = all;
        headBox.indeterminate = !all && n > 0;
      }
    }

    // Each visible row's checkbox keeps the shared rank set in sync.
    for (var ei = 0; ei < entries.length; ei++) {
      (function (ent) {
        ent.box.addEventListener("change", function () {
          if (ent.box.checked) set.add(ent.m.rank); else set.delete(ent.m.rank);
          sync();
        });
      })(entries[ei]);
    }
    if (headBox) {
      headBox.addEventListener("change", function () {
        var want = headBox.checked;
        for (var i = 0; i < entries.length; i++) {
          var box = entries[i].box;
          box.checked = want;
          if (want) set.add(entries[i].m.rank); else set.delete(entries[i].m.rank);
        }
        sync();
      });
    }
    clearBtn.addEventListener("click", function () {
      for (var i = 0; i < entries.length; i++) {
        set.delete(entries[i].m.rank);
        entries[i].box.checked = false;
      }
      sync();
    });
    copyBtn.addEventListener("click", function () {
      var models = [];
      for (var i = 0; i < entries.length; i++) {
        if (set.has(entries[i].m.rank)) models.push(entries[i].m);
      }
      if (!models.length) return;
      writeClipboard(batchModelsToText(models), I18N.format("batchCopied", { n: models.length }));
    });

    sync();
    return bar;
  }

  // Favourites-only list toggle ("收藏页面"): filters the table/grid to starred
  // models while staying composable with the feature filter + exclusions.
  function favouriteModelCount() {
    return state.result ? state.result.models.filter(isFavoriteModel).length : 0;
  }
  function toggleFavOnly() {
    state.favOnly = !state.favOnly;
    refreshStateUI();
  }
  function syncFavOnlyUI() {
    var btn = $("#btn-fav-only");
    if (!btn) return;
    var n = favouriteModelCount();
    btn.textContent = I18N.t("favOnlyBtn");
    btn.classList.toggle("is-active", state.favOnly);
    btn.disabled = !state.favOnly && n === 0;
    btn.title = n ? I18N.format("favOnlyHint", { n: n }) : I18N.t("favOnlyNone");
    btn.setAttribute("aria-pressed", state.favOnly ? "true" : "false");
  }

  // ---------------------------------------------------------------------------
  // Table
  // ---------------------------------------------------------------------------
  function renderTable() {
    var vis = visibleModels();
    var wrap = $("#table-wrap");
    wrap.innerHTML = "";

    var table = el("table", "models-table");
    var thead = el("thead");
    var hr = el("tr");
    var cols = visibleTableColumns();

    // Batch-copy selection column ("select all visible" lives in the header).
    var entries = [];
    var selTh = el("th", "batch-th", null);
    var headBox = document.createElement("input");
    headBox.type = "checkbox";
    headBox.className = "batch-check batch-check--head";
    headBox.setAttribute("aria-label", I18N.t("batchSelAllAria"));
    if (vis.shown <= 0) headBox.disabled = true;
    selTh.appendChild(headBox);
    hr.appendChild(selTh);

    cols.forEach(function (c) {
      var th = el("th", null, null);
      var sortable = c.numeric || c.id === "rank";
      if (sortable) {
        th.classList.add("th-sortable");
        th.setAttribute("tabindex", "0");
        th.setAttribute("role", "button");
        th.setAttribute("aria-label", I18N.format("sortByCol", { col: c.label() }));
        if (state.sortKey === c.id) {
          th.classList.add("is-sorted");
          th.classList.add(state.sortAsc ? "is-sorted-asc" : "is-sorted-desc");
          th.setAttribute("aria-sort", state.sortAsc ? "ascending" : "descending");
        }
        th.addEventListener("click", function () { sortByColumn(c.id); });
        th.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortByColumn(c.id); }
        });
      } else {
        th.classList.add("th-static");
      }
      if (c.hint) th.title = c.hint();
      var label = el("span", "th-label", c.label());
      th.appendChild(label);
      if (sortable) {
        var caret = el("span", "th-caret");
        caret.setAttribute("aria-hidden", "true");
        th.appendChild(caret);
      }
      if (c.numeric) th.classList.add("th-num");
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    vis.list.slice(0, vis.shown).forEach(function (m) {
      var tr = el("tr");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", I18N.t("detailRank") + " " + m.rank);
      if (isExcludedModel(m)) tr.classList.add("is-excluded");
      if (isFavoriteModel(m)) tr.classList.add("is-fav");

      var box = makeBatchCheckbox(m, "table");
      var selTd = el("td", "batch-cell");
      selTd.appendChild(box);
      tr.appendChild(selTd);
      entries.push({ m: m, box: box });

      cols.forEach(function (c) {
        var td;
        if (c.id === "formula") {
          td = el("td", "formula-cell");
          setFormulaContent(td, m.formulaOriginal);
        } else if (c.id === "actions") {
          td = el("td", "row-actions");
          var btn = el("button", "btn btn--secondary btn--sm", I18N.t("view"));
          btn.addEventListener("click", function (e) { e.stopPropagation(); openDetail(m.rank); });
          td.appendChild(btn);
          td.appendChild(makeStateIconButton("fav", m));
          td.appendChild(makeStateIconButton("excl", m));
        } else if (c.numeric) {
          var v = c.get(m);
          td = el("td", "num", fmt(v, 4));
          if (v === null || v === undefined || Number.isNaN(v)) td.classList.add("is-empty");
        } else {
          td = el("td", "num", String(c.get(m)));
        }
        tr.appendChild(td);
      });

      tr.addEventListener("click", function () { openDetail(m.rank); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(m.rank); }
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(createBatchBar("table", entries, headBox));
    wrap.appendChild(table);
  }

  // Column-header sorting: clicking a column sorts ascending, clicking the
  // already-sorted column toggles asc <-> desc. Column ids equal sort keys,
  // so this reuses the same pipeline.
  function sortByColumn(colId) {
    if (state.sortKey === colId) {
      state.sortAsc = !state.sortAsc;
    } else {
      state.sortKey = colId;
      state.sortAsc = true;
    }
    renderModels();
  }

  // ---------------------------------------------------------------------------
  // Thumbnail grid (SVG mini scatter, no per-card ECharts instance)
  // Thumbnails are lazy-rendered on scroll via IntersectionObserver so "load
  // all" does not freeze the UI building hundreds of SVGs at once.
  // ---------------------------------------------------------------------------
  var thumbObserver = null;

  function ensureThumbObserver() {
    if (thumbObserver || typeof IntersectionObserver === "undefined") return;
    thumbObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var card = entry.target;
        var placeholder = card.querySelector(".skeleton");
        if (!placeholder) { thumbObserver.unobserve(card); return; }
        placeholder.replaceWith(buildThumb(card.__model));
        thumbObserver.unobserve(card);
      });
    }, { rootMargin: "200px" });
  }

  // One metric row on a thumbnail card: label + train value + verify value.
  // Train / verify numbers are tinted like the scatter points (blue/amber).
  function appendMetricLine(container, label, trainValue, verifyValue) {
    var row = el("div", "metric-line");
    row.appendChild(el("span", "metric-line__label", label));
    var vals = el("span", "metric-line__values");
    vals.appendChild(el("span", "metric-line__val is-train", fmt(trainValue, 3)));
    if (verifyValue !== undefined) {
      vals.appendChild(el("span", "metric-line__sep", "/"));
      vals.appendChild(el("span", "metric-line__val is-verify", fmt(verifyValue, 3)));
    }
    row.appendChild(vals);
    container.appendChild(row);
  }

  function renderGrid() {
    var res = state.result;
    var vis = visibleModels();
    var grid = $("#grid-wrap");
    grid.innerHTML = "";
    ensureThumbObserver();

    vis.list.slice(0, vis.shown).forEach(function (m) {
      var card = el("div", "model-card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", I18N.t("detailRank") + " " + m.rank);
      card.__model = m;

      // Skeleton placeholder first; the actual SVG is drawn when visible.
      var placeholder = el("div", "model-card__thumb skeleton");
      card.appendChild(placeholder);

      var body = el("div", "model-card__body");
      body.appendChild(el("div", "model-card__title", "Model " + m.rank));
      var metrics = el("div", "model-card__metrics");
      appendMetricLine(metrics, "RMSE",
        m.metricsTrain.rmse, m.metricsVerify ? m.metricsVerify.rmse : undefined);
      appendMetricLine(metrics, "ρ",
        m.metricsTrain.rho, m.metricsVerify ? m.metricsVerify.rho : undefined);
      body.appendChild(metrics);
      card.appendChild(body);

      card.addEventListener("click", function () { openDetail(m.rank); });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(m.rank); }
      });
      grid.appendChild(card);

      if (thumbObserver) {
        thumbObserver.observe(card);
      } else {
        placeholder.replaceWith(buildThumb(m));
      }
    });
  }

  function buildThumb(m) {
    var res = state.result;
    var C = getThemeColors();
    var W = 230, H = 150, pad = 16;
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.classList.add("model-card__thumb");

    var allX = [], allY = [];
    var trainPts = buildPoints(res.train, m.predTrain, "train");
    var verifyPts = res.verify ? buildPoints(res.verify, m.predVerify, "verify") : [];
    trainPts.concat(verifyPts).forEach(function (p) { allX.push(p[0]); allY.push(p[1]); });
    if (!allX.length) return svg;

    var x0 = Math.min.apply(null, allX), x1 = Math.max.apply(null, allX);
    var y0 = Math.min.apply(null, allY), y1 = Math.max.apply(null, allY);
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    if (y0 === y1) { y0 -= 1; y1 += 1; }

    function sx(v) { return pad + (v - x0) / (x1 - x0) * (W - 2 * pad); }
    function sy(v) { return H - pad - (v - y0) / (y1 - y0) * (H - 2 * pad); }

    // identity line
    var lo = Math.min(x0, y0), hi = Math.max(x1, y1);
    var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", sx(lo)); line.setAttribute("y1", sy(lo));
    line.setAttribute("x2", sx(hi)); line.setAttribute("y2", sy(hi));
    line.setAttribute("stroke", C.identity); line.setAttribute("stroke-dasharray", "3 3");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    drawPts(svg, trainPts, C.train, "circle", sx, sy);
    drawPts(svg, verifyPts, C.verify, "triangle", sx, sy);

    return svg;
  }

  function drawPts(svg, pts, color, shape, sx, sy) {
    var cap = 400;
    for (var i = 0; i < pts.length && i < cap; i++) {
      var node;
      if (shape === "circle") {
        node = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        node.setAttribute("r", "2.2");
        node.setAttribute("cx", sx(pts[i][0]));
        node.setAttribute("cy", sy(pts[i][1]));
      } else {
        node = document.createElementNS("http://www.w3.org/2000/svg", "path");
        var x = sx(pts[i][0]), y = sy(pts[i][1]), r = 3;
        node.setAttribute("d",
          "M" + x + " " + (y - r) + " L" + (x + r) + " " + (y + r) +
          " L" + (x - r) + " " + (y + r) + " Z");
      }
      node.setAttribute("fill", color);
      node.setAttribute("opacity", "0.65");
      svg.appendChild(node);
    }
  }

  function buildPoints(data, pred, source) {
    var res = state.result;
    var y = Array.from(data.cols[res.meta.targetLetter]);
    var pts = [];
    for (var i = 0; i < data.n; i++) {
      // Skip non-finite points: they cannot be plotted and would poison the
      // axis-range computation (NaN propagates through Math.min/max).
      if (!Number.isFinite(pred[i]) || !Number.isFinite(y[i])) continue;
      pts.push([pred[i], y[i], data.names[i], source, i]);
    }
    return pts;
  }

  // ---------------------------------------------------------------------------
  // Detail dialog
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Pareto front: train metric (x) vs verify metric (y)
  // ---------------------------------------------------------------------------
  // Split Pareto-eligible points into the models allowed to build the front and
  // "ghosts" — models that are drawn faintly but never take part in the front
  // computation. A model becomes a ghost when it fails the active feature
  // filter OR is excluded (per-model state); clicking a ghost still opens its
  // detail, where the exclusion can be restored.
  function paretoSplit(pts) {
    var filterOn = !!(state.filter && state.filter.active);
    var included = [], ghosts = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var ghost = isExcludedModel(p.m) || (filterOn && !modelPassesFilter(p.m));
      if (ghost) ghosts.push(p);
      else included.push(p);
    }
    return { pts: included, ghosts: ghosts };
  }

  // Favourite models get an obvious golden-diamond marker on the Pareto chart
  // (works for both 2D and 3D data items). Ghosts keep their faint style.
  function withFavMark(datum, p) {
    if (!isFavoriteModel(p.m)) return datum;
    datum.itemStyle = { color: "#f6b100", borderColor: "#5a4400", borderWidth: 0.7 };
    datum.symbol = "diamond";
    return datum;
  }

  // Theme colours arrive as CSS-resolved strings ("rgb(r,g,b)" or "#rrggbb");
  // return the same colour with the given alpha for faint/faded point styles.
  function withAlpha(cssColor, alpha) {
    var m = /^rgba?\(([^)]+)\)$/.exec(cssColor || "");
    if (m) {
      var p = m[1].split(",").map(function (s) { return parseFloat(s); });
      return "rgba(" + Math.round(p[0]) + "," + Math.round(p[1]) + "," + Math.round(p[2]) + "," + alpha + ")";
    }
    m = /^#([0-9a-f]{6})$/i.exec(cssColor || "");
    if (m) {
      var n = parseInt(m[1], 16);
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
    }
    return cssColor;
  }

  // ---------------------------------------------------------------------------
  // Pareto axes — every axis is a { dataset, metric } pair.
  //
  // Datasets are derived from the run actually loaded ("train" always, plus
  // "verify" when a verify file was analysed), so the Pareto view no longer
  // requires train + verify data — a train-only run can plot e.g. Train RMSE ×
  // Train MaxAE. Choosing the *same* dataset + metric for two axes is rejected
  // in the UI. The engine keeps its metricsTrain / metricsVerify fields; this
  // module is the single place that maps a dataset token onto them (through
  // SissoCore.metricValue), which is why no other code adds per-dataset
  // branches.
  // ---------------------------------------------------------------------------

  // Axis dataset tokens available in this run: real datasets ("train", plus
  // "verify" when a verify file was analysed) and the "delta" pseudo-dataset
  // (train → validation gap, only meaningful when validation data exists).
  // Keeping "delta" out of Core.availableDatasets avoids making it a real
  // dataset anywhere else (compare matrix, default axes, etc.).
  function paretoDatasets() {
    var ds = Core.availableDatasets(state.result);
    if (state.result && state.result.verify) ds = ds.concat(["delta"]);
    return ds;
  }

  function paretoIsMetric(k) {
    return PARETO_METRICS.some(function (d) { return d.key === k; });
  }

  // Migrate a legacy/external axis value into a {dataset, metric} spec valid
  // for the loaded run. Accepts the new object form, the old bare metric key
  // (dataset implied) and the very old { metric, set } form used by paretoZ.
  function paretoNormalizeAxis(v, fallback) {
    var spec = { dataset: fallback.dataset, metric: fallback.metric };
    if (v) {
      var ds = typeof v.dataset === "string" && v.dataset
        ? v.dataset : (typeof v.set === "string" && v.set ? v.set : "");
      if (ds && paretoDatasets().indexOf(ds) >= 0) spec.dataset = ds;
      var m = typeof v === "string" ? v : (v && typeof v.metric === "string" ? v.metric : "");
      if (m && paretoIsMetric(m)) spec.metric = m;
    }
    return spec;
  }

  // Keep the three stored Pareto axes valid for the loaded run, and pairwise
  // distinct on the axes the current mode actually shows. Runs after every
  // analysis / project restore / render, so legacy sessions and train-only
  // projects always end up with sensible, non-duplicate axes.
  function coerceParetoAxes() {
    var res = state.result;
    if (!res) return;
    var datasets = paretoDatasets();
    var dim = state.paretoMode === "3d" ? 3 : 2;
    var fallbackDs = datasets.indexOf("verify") >= 0 ? "verify" : "train";
    var specs = [
      paretoNormalizeAxis(state.paretoX, { dataset: "train", metric: "rmse" }),
      paretoNormalizeAxis(state.paretoY, { dataset: fallbackDs, metric: "rmse" }),
      paretoNormalizeAxis(state.paretoZ, { dataset: "train", metric: "r2" }),
    ];
    // Preference pool of every (dataset, metric) combo present in this run,
    // used to replace any duplicate axis with the next free default.
    var pool = [];
    PARETO_METRICS.forEach(function (d) {
      datasets.forEach(function (ds) { pool.push({ dataset: ds, metric: d.key }); });
    });
    var used = [], next = 0;
    for (var i = 0; i < dim; i++) {
      var s = specs[i];
      var dup = used.some(function (u) {
        return u.dataset === s.dataset && u.metric === s.metric;
      });
      if (dup) {
        while (next < pool.length && used.some(function (u) {
          return u.dataset === pool[next].dataset && u.metric === pool[next].metric;
        })) next++;
        if (next < pool.length) {
          s = { dataset: pool[next].dataset, metric: pool[next].metric };
          next++;
        } else {
          break; // cannot happen: >= 2 train combos are always available
        }
      }
      used.push(s);
      specs[i] = s;
    }
    state.paretoX = specs[0];
    state.paretoY = specs[1];
    state.paretoZ = specs[2];
  }

  // Current axes as full defs: code "x"/"y"/(2D) + "z" (3D), dataset, metric
  // key, minimize direction and i18n label key.
  function paretoCurrentAxisDefs() {
    var dim = state.paretoMode === "3d" ? 3 : 2;
    var keys = ["paretoX", "paretoY", "paretoZ"];
    var codes = ["x", "y", "z"];
    var defs = [];
    for (var i = 0; i < dim; i++) {
      var a = state[keys[i]] || { dataset: "train", metric: "rmse" };
      var d = paretoMetricDef(a.metric);
      var dataset = a.dataset === "verify" ? "verify"
        : a.dataset === "delta" ? "delta" : "train";
      defs.push({
        code: codes[i],
        dataset: dataset,
        metric: d.key,
        label: d.label,
        // Every Δ metric is defined as "positive = worse on validation", so a
        // smaller gap is always better regardless of the underlying metric.
        minimize: dataset === "delta" ? true : d.minimize,
      });
    }
    return defs;
  }

  // One point collector for both dimensions: read every axis' metric value via
  // the shared engine accessor and keep a point only when all values are
  // finite (same membership rule the charts and the CSV export use).
  // Delta axes plot the ABSOLUTE gap |Δ| — the direction of the gap is ignored
  // on the Pareto chart (only its magnitude trades off against the other axes);
  // the signed Δ stays in the table / filters / sorting.
  function paretoCollectPoints(defs) {
    var res = state.result;
    var pts = [];
    res.models.forEach(function (m) {
      var pt = { rank: m.rank, m: m };
      var ok = true;
      for (var i = 0; i < defs.length; i++) {
        var v = Core.metricValue(m, defs[i].dataset, defs[i].metric);
        if (!Number.isFinite(v)) { ok = false; break; }
        if (defs[i].dataset === "delta") v = Math.abs(v);
        pt[defs[i].code] = v;
      }
      if (ok) pts.push(pt);
    });
    return { defs: defs, pts: pts };
  }

  function paretoComputed() {
    return paretoCollectPoints(paretoCurrentAxisDefs());
  }

  // Non-dominated (Pareto-optimal) set for the chosen "better" directions.
  // Both Pareto charts and the CSV export call these, and both delegate to the
  // engine (SissoCore.paretoFront2D/3D), so the exported is_pareto flags are
  // always computed by the exact code path that produced the plotted front.
  function computeParetoFront1(pts, xDef, yDef) {
    return Core.paretoFront2D(pts, xDef.minimize, yDef.minimize);
  }

  function computeParetoFront3D(pts, xDef, yDef, zDef) {
    return Core.paretoFront3D(pts, xDef.minimize, yDef.minimize, zDef.minimize);
  }

  // Short axis dataset tag: Train / Verify / Δ (validation − train).
  function paretoDatasetLabel(dataset) {
    if (dataset === "delta") return I18N.t("detailDelta");
    return I18N.t(dataset === "verify" ? "detailVerify" : "detailTrain");
  }

  // Dataset-aware axis display name: "RMSE (Train) ↓" — reads the dataset the
  // axis actually points at, so any axis can sit on any dataset/pseudo-dataset.
  // Delta axes plot the magnitude and always show "↓" (smaller |Δ| is better).
  function paretoAxisTitle(def) {
    var label = def.dataset === "delta"
      ? "|Δ" + I18N.t(def.label) + "|"
      : I18N.t(def.label);
    return label + " (" + paretoDatasetLabel(def.dataset) + ") " +
      (def.minimize ? "↓" : "↑");
  }

  // Full definition text for a delta axis (used as the option/axis tooltip).
  // Pareto shows the absolute value, so only the magnitude is traded off.
  function deltaAxisDefinition(metricKey, metricLabelKey) {
    return deltaMetricDefinition(metricKey, metricLabelKey) +
      " " + I18N.t("deltaAbsNote");
  }

  // Axis range that follows the actual data (with a little breathing room),
  // instead of ECharts' forced-zero auto range.
  function paretoAxisBounds(vals) {
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (lo === hi) {
      var d = Math.abs(hi) * 0.05 || 1;
      lo -= d; hi += d;
    }
    var pad = (hi - lo) * 0.05;
    return { min: lo - pad, max: hi + pad };
  }

  function renderPareto3D() {
    var res = state.result;
    if (!res) return;
    var computed = paretoComputed();
    var defs = computed.defs; // x, y, z
    var split = paretoSplit(computed.pts);
    var pts = split.pts, ghosts = split.ghosts;
    var front = computeParetoFront3D(pts, defs[0], defs[1], defs[2]);
    var ghostOn = ghosts.length > 0;

    $("#pareto-count").textContent = ghostOn
      ? I18N.format("paretoCountFiltered", { n: front.length, m: pts.length, t: computed.pts.length })
      : I18N.format("paretoCount", { n: front.length });

    var dom = $("#pareto-chart");
    var C = getThemeColors();
    if (state.paretoChart) { state.paretoChart.dispose(); }
    state.paretoChart = echarts.init(dom);

    var viewPts = computed.pts;
    var xb = paretoAxisBounds(viewPts.map(function (p) { return p.x; }));
    var yb = paretoAxisBounds(viewPts.map(function (p) { return p.y; }));
    var zb = paretoAxisBounds(viewPts.map(function (p) { return p.z; }));

    var allData = pts.map(function (p) { return withFavMark({ value: [p.x, p.y, p.z], rank: p.rank }, p); });
    var ghostData = ghosts.map(function (p) { return { value: [p.x, p.y, p.z], rank: p.rank, ghost: true }; });
    var frontData = front.map(function (p) { return withFavMark({ value: [p.x, p.y, p.z], rank: p.rank }, p); });
    var frontPath = front.slice().sort(function (a, b) { return a.x - b.x; })
      .map(function (p) { return [p.x, p.y, p.z]; });

    function axis3D(name, b) {
      return {
        name: name,
        type: "value",
        min: b ? b.min : undefined,
        max: b ? b.max : undefined,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { lineStyle: { color: C.grid } },
      };
    }

    state.paretoChart.setOption({
      animation: true,
      textStyle: { fontFamily: C.font },
      tooltip: {
        formatter: function (params) {
          var d = params.data;
          if (!d || d.rank == null) return "";
          var rows = [
            "<strong>" + I18N.t("detailRank") + " " + d.rank + "</strong>",
            paretoAxisTitle(defs[0]) + ": " + fmt(d.value[0], 4),
            paretoAxisTitle(defs[1]) + ": " + fmt(d.value[1], 4),
            paretoAxisTitle(defs[2]) + ": " + fmt(d.value[2], 4),
          ];
          if (d.ghost) rows.push('<span style="opacity:.65">' + I18N.t("paretoGhostNote") + "</span>");
          return rows.join("<br/>");
        },
      },
      grid3D: {
        boxWidth: 120,
        boxDepth: 120,
        boxHeight: 80,
        axisPointer: { lineStyle: { color: C.train } },
        light: {
          main: { intensity: 1.2, shadow: false },
          ambient: { intensity: 0.3 },
        },
        viewControl: {
          distance: 220,
          alpha: 20,
          beta: 40,
          panSensitivity: 0,
          rotateSensitivity: 1,
          zoomSensitivity: 1,
        },
      },
      xAxis3D: axis3D(paretoAxisTitle(defs[0]), xb),
      yAxis3D: axis3D(paretoAxisTitle(defs[1]), yb),
      zAxis3D: axis3D(paretoAxisTitle(defs[2]), zb),
      legend: {
        data: (function () {
          var names = [I18N.t("paretoAll"), I18N.t("paretoFront")];
          if (ghostOn) {
            names.unshift({
              name: I18N.t("paretoGhost"),
              icon: "circle",
              itemStyle: { color: withAlpha(C.textSoft, 0.35) },
            });
          }
          return names;
        })(),
        top: 8,
        textStyle: { color: C.chartText },
      },
      series: (function () {
        var s = [];
        if (ghostOn) {
          s.push({
            name: I18N.t("paretoGhost"),
            type: "scatter3D",
            data: ghostData,
            symbolSize: 5,
            itemStyle: { color: withAlpha(C.textSoft, 0.18) },
          });
        }
        s.push({
          name: I18N.t("paretoAll"),
          type: "scatter3D",
          data: allData,
          symbolSize: 6,
          itemStyle: { color: C.textSoft, opacity: 0.55 },
        });
        s.push({
          name: "_frontLine",
          type: "line3D",
          data: frontPath,
          lineStyle: { color: C.train, width: 2 },
          silent: true,
        });
        s.push({
          name: I18N.t("paretoFront"),
          type: "scatter3D",
          data: frontData,
          symbolSize: 10,
          itemStyle: { color: C.train, opacity: 1 },
        });
        return s;
      })(),
    });

    state.paretoChart.off("click");
    state.paretoChart.on("click", function (params) {
      var rank = params.data && params.data.rank;
      if (rank != null) openDetail(rank);
    });

    renderParetoTable(front, defs);
  }

  // Front table shared by the 2D and 3D Pareto views: one numeric column per
  // axis def (rank + formula + axes + actions), rows open the model detail.
  function renderParetoTable(front, defs) {
    var wrap = $("#pareto-table-wrap");
    wrap.innerHTML = "";
    var table = el("table", "models-table");
    var thead = el("thead");
    var hr = el("tr");

    // Batch-copy selection column ("select all visible" lives in the header).
    var entries = [];
    var selTh = el("th", "batch-th", null);
    var headBox = document.createElement("input");
    headBox.type = "checkbox";
    headBox.className = "batch-check batch-check--head";
    headBox.setAttribute("aria-label", I18N.t("batchSelAllAria"));
    if (!front.length) headBox.disabled = true;
    selTh.appendChild(headBox);
    hr.appendChild(selTh);

    var headers = [I18N.t("colRank"), I18N.t("colFormula")];
    defs.forEach(function (d) { headers.push(paretoAxisTitle(d)); });
    headers.push(I18N.t("colActions"));
    headers.forEach(function (label, i) {
      var th = el("th", null, label);
      if (i >= 2 && i <= headers.length - 2) th.style.textAlign = "right";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    front.forEach(function (p) {
      var tr = el("tr");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      var box = makeBatchCheckbox(p.m, "pareto");
      var selTd = el("td", "batch-cell");
      selTd.appendChild(box);
      tr.appendChild(selTd);
      entries.push({ m: p.m, box: box });
      tr.appendChild(el("td", "num", String(p.rank)));
      var fcTd = el("td", "formula-cell");
      setFormulaContent(fcTd, p.m.formulaOriginal);
      tr.appendChild(fcTd);
      defs.forEach(function (d) {
        tr.appendChild(el("td", "num", fmt(p[d.code], 4)));
      });
      var td = el("td");
      var btn = el("button", "btn btn--secondary btn--sm", I18N.t("view"));
      btn.type = "button";
      btn.addEventListener("click", function (e) { e.stopPropagation(); openDetail(p.rank); });
      td.appendChild(btn);
      tr.appendChild(td);
      tr.addEventListener("click", function () { openDetail(p.rank); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(p.rank); }
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(createBatchBar("pareto", entries, headBox));
    wrap.appendChild(table);
  }

  // ---------------------------------------------------------------------------
  // Pareto CSV export — one shared path for the 2D and 3D charts.
  //
  // The export replays the *exact* computations the current chart was rendered
  // from (paretoComputed -> paretoSplit -> computeParetoFront*) and hands
  // those same arrays to SissoCore.paretoExportRows, so the exported point
  // set, metric values and is_pareto flags always match the plot 1:1 — ghosts
  // (models the active filter excluded from the front) are exported too, with
  // excluded=1, exactly as they are drawn. Nothing is recomputed here.
  // ---------------------------------------------------------------------------

  // Text download helper (also usable for other CSV exports later on).
  function downloadTextFile(fileName, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function exportParetoCsv() {
    var res = state.result;
    if (!res) return;
    coerceParetoAxes();
    var computed = paretoComputed();
    var defs = computed.defs;
    var split = paretoSplit(computed.pts);
    var front = defs.length === 3
      ? computeParetoFront3D(split.pts, defs[0], defs[1], defs[2])
      : computeParetoFront1(split.pts, defs[0], defs[1]);

    // Axis descriptors mirror the axes currently shown and their dataset /
    // metric tokens, so the CSV header documents what X/Y(/Z) contain.
    var axes = defs.map(function (d) {
      return { code: d.code, dataset: d.dataset, metric: d.metric };
    });

    var rows = Core.paretoExportRows(split.pts, split.ghosts, front, axes);
    var mode = state.paretoMode === "3d" ? "3d" : "2d";
    var fileName = "sisso-pareto-" + mode + "-" + axes
      .map(function (a) { return a.code + "-" + a.dataset + "-" + a.metric; })
      .join("_") + ".csv";
    downloadTextFile(fileName, Core.rowsToCsv(rows), "text/csv;charset=utf-8");
    toast(I18N.format("paretoCsvExported", { n: rows.length - 1, file: fileName }));
  }

  // ---------------------------------------------------------------------------
  // Units (dimension) view — one card per unit group, coloured like the
  // formula tokens, with the member features listed.
  // ---------------------------------------------------------------------------
  function vectorText(vec) {
    return vec.map(function (v) { return v === Math.round(v) ? String(Math.round(v)) : String(v); }).join(" ");
  }

  // ---------------------------------------------------------------------------
  // Column manager + filter panels (table toolbar popovers)
  // ---------------------------------------------------------------------------
  function setPopover(anchorSel, popSel, open) {
    var anchor = document.querySelector(anchorSel);
    var pop = document.querySelector(popSel);
    var btn = anchor ? anchor.querySelector("button") : null;
    if (pop) pop.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function closeAllPopovers(exceptSel) {
    [["#filter-anchor", "#filter-pop"], ["#cols-anchor", "#cols-pop"]].forEach(function (pair) {
      if (pair[1] !== exceptSel) setPopover(pair[0], pair[1], false);
    });
  }

  // --- Column manager ------------------------------------------------
  function renderColsPanel() {
    var pop = $("#cols-pop");
    if (!pop) return;
    pop.innerHTML = "";
    var cols = buildTableColumns().filter(function (c) { return c.id !== "actions"; });

    var intro = el("p", "pop-label", I18N.t("colsIntro"));
    pop.appendChild(intro);

    var list = el("div", "pop-list");
    cols.forEach(function (c) {
      var lab = el("label", "check-row");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = !state.hiddenCols[c.id];
      cb.addEventListener("change", function () {
        if (cb.checked) delete state.hiddenCols[c.id];
        else state.hiddenCols[c.id] = true;
        persistColPrefs();
        if (state.view === "table") renderTable();
        renderCount();
      });
      var span = el("span", null, c.label());
      if (c.hint) span.title = c.hint();
      lab.appendChild(cb);
      lab.appendChild(span);
      list.appendChild(lab);
    });
    pop.appendChild(list);

    var footer = el("div", "pop-footer");
    var reset = el("button", "btn btn--ghost btn--sm", I18N.t("colsReset"));
    reset.type = "button";
    reset.addEventListener("click", function () {
      state.hiddenCols = {};
      persistColPrefs();
      renderColsPanel();
      if (state.view === "table") renderTable();
      renderCount();
    });
    footer.appendChild(reset);
    pop.appendChild(footer);
  }

  function persistColPrefs() {
    try { window.localStorage.setItem(COLS_PREF_KEY, JSON.stringify(state.hiddenCols)); } catch (e) { /* ignore */ }
  }
  function restoreColPrefs() {
    state.hiddenCols = {};
    try {
      var raw = window.localStorage.getItem(COLS_PREF_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        Object.keys(o).forEach(function (k) { if (o[k]) state.hiddenCols[k] = true; });
      }
    } catch (e) { /* ignore */ }
  }

  // --- Filter model helpers (feature-level include/exclude) ------------
  // The panel edits a working copy (filterDraft); nothing affects the table
  // until Apply is pressed. This lets the user check many boxes at once
  // without the table rebuilding on every click.
  var filterDraft = null;

  function emptyFilterDraft() {
    return { includeMode: "any", include: new Set(), exclude: new Set(), numeric: {} };
  }
  function cloneFilter(src) {
    var d = emptyFilterDraft();
    if (!src) return d;
    d.includeMode = src.includeMode || "any";
    (src.include || []).forEach(function (n) { d.include.add(n); });
    (src.exclude || []).forEach(function (n) { d.exclude.add(n); });
    Object.keys(src.numeric || {}).forEach(function (k) {
      var c = src.numeric[k];
      if (c && (c.min != null || c.max != null)) d.numeric[k] = { min: c.min != null ? c.min : null, max: c.max != null ? c.max : null };
    });
    return d;
  }
  function draftIsEmpty(d) {
    return !d || (!d.include.size && !d.exclude.size && !Object.keys(d.numeric).length);
  }
  function draftDiffersFromApplied() {
    if (!state.filter || !filterDraft) return true;
    if ((state.filter.includeMode || "any") !== filterDraft.includeMode) return true;
    function eqSet(a, b) {
      if (a.size !== b.size) return false;
      var it = a.values(), x;
      while (!(x = it.next()).done) if (!b.has(x.value)) return false;
      return true;
    }
    if (!eqSet(state.filter.include || new Set(), filterDraft.include)) return true;
    if (!eqSet(state.filter.exclude || new Set(), filterDraft.exclude)) return true;
    var ak = Object.keys(state.filter.numeric || {}), bk = Object.keys(filterDraft.numeric);
    if (ak.length !== bk.length) return true;
    for (var i = 0; i < ak.length; i++) {
      var k = ak[i];
      var a = state.filter.numeric[k], b = filterDraft.numeric[k];
      if (!b) return true;
      if ((a.min == null ? null : a.min) !== (b.min == null ? null : b.min)) return true;
      if ((a.max == null ? null : a.max) !== (b.max == null ? null : b.max)) return true;
    }
    return false;
  }

  // Apply the draft to the real filter and rebuild the visible model list.
  function applyFilterDraft() {
    if (!filterDraft) return;
    state.filter = cloneFilter(filterDraft);
    state.filter.active = !draftIsEmpty(state.filter);
    updateApplyVisual();
    applyFilterAndRender();
  }

  function setFeatureInDraft(name, mode) {
    if (mode === "include") { filterDraft.include.add(name); filterDraft.exclude.delete(name); }
    else if (mode === "exclude") { filterDraft.exclude.add(name); filterDraft.include.delete(name); }
    else { filterDraft.include.delete(name); filterDraft.exclude.delete(name); }
  }

  // --- Filter panel ---------------------------------------------------
  function renderFilterPanel() {
    var pop = $("#filter-pop");
    if (!pop) return;
    pop.innerHTML = "";
    // Reset the working copy to the currently applied filter each time the
    // panel opens, so closing without Apply keeps the previous result.
    filterDraft = cloneFilter(state.filter);
    var units = state.result && state.result.meta && state.result.meta.units;

    // Metric range section
    var numTitle = el("p", "pop-label", I18N.t("filterMetrics"));
    pop.appendChild(numTitle);
    var numGrid = el("div", "pop-grid");
    var numCols = buildTableColumns().filter(function (c) { return c.numeric; });
    numCols.forEach(function (c) {
      var cond = filterDraft.numeric[c.id] || { min: null, max: null };
      var row = el("label", "range-row");
      var lab = el("span", "range-row__label", c.label());
      if (c.hint) lab.title = c.hint();
      row.appendChild(lab);
      var minIn = el("input", "input range-row__input");
      minIn.type = "number";
      minIn.placeholder = I18N.t("filterMin");
      if (cond.min != null) minIn.value = cond.min;
      minIn.addEventListener("change", function () {
        cond.min = minIn.value === "" ? null : parseFloat(minIn.value);
        storeDraftNumeric(c.id, cond.min, cond.max);
        updateApplyVisual();
      });
      var maxIn = el("input", "input range-row__input");
      maxIn.type = "number";
      maxIn.placeholder = I18N.t("filterMax");
      if (cond.max != null) maxIn.value = cond.max;
      maxIn.addEventListener("change", function () {
        cond.max = maxIn.value === "" ? null : parseFloat(maxIn.value);
        storeDraftNumeric(c.id, cond.min, cond.max);
        updateApplyVisual();
      });
      row.appendChild(minIn);
      row.appendChild(maxIn);
      numGrid.appendChild(row);
    });
    pop.appendChild(numGrid);

    // Unit-group section (only when SISSO.out was loaded)
    if (units) {
      var gTitle = el("p", "pop-label", I18N.t("filterGroups"));
      pop.appendChild(gTitle);

      // include matching mode (any / only) — edits the draft only
      var seg = el("div", "segmented seg-group-mode");
      [["any", I18N.t("filterModeAny")], ["only", I18N.t("filterModeOnly")]].forEach(function (o) {
        var b = el("button", "segmented__btn" + (filterDraft.includeMode === o[0] ? " is-active" : ""), o[1]);
        b.type = "button";
        b.addEventListener("click", function () {
          filterDraft.includeMode = o[0];
          seg.querySelectorAll(".segmented__btn").forEach(function (x) { x.classList.remove("is-active"); });
          b.classList.add("is-active");
          updateApplyVisual();
        });
        seg.appendChild(b);
      });
      pop.appendChild(seg);

      var hint = el("p", "pop-note", I18N.t("filterModeHint"));
      pop.appendChild(hint);

      var gl = el("div", "pop-list group-list");
      units.groups.forEach(function (g) {
        gl.appendChild(buildFilterGroupRow(g));
      });
      pop.appendChild(gl);
    } else {
      var noUnits = el("p", "pop-note", I18N.t("unitsEmpty"));
      pop.appendChild(noUnits);
    }

    // Panel hint + footer with Apply / Clear
    var ph = el("p", "pop-note pop-note--apply", I18N.t("filterPanelHint"));
    pop.appendChild(ph);

    var footer = el("div", "pop-footer pop-footer--split");
    var clear = el("button", "btn btn--ghost btn--sm", I18N.t("filterClear"));
    clear.type = "button";
    clear.addEventListener("click", function () {
      filterDraft = emptyFilterDraft();
      if (!state.filter.active && draftIsEmpty(state.filter)) return;
      applyFilterDraft();
    });
    footer.appendChild(clear);

    var apply = el("button", "btn btn--primary btn--sm btn-filter-apply", I18N.t("filterApply"));
    apply.type = "button";
    apply.addEventListener("click", function () { applyFilterDraft(); });
    footer.appendChild(apply);
    pop.appendChild(footer);
    updateApplyVisual();
  }

  // Highlight the Apply button while the draft holds changes that have not
  // been committed (i.e. the table has not been re-filtered yet).
  function updateApplyVisual() {
    var btn = document.querySelector("#filter-pop .btn-filter-apply");
    if (!btn) return;
    btn.classList.toggle("is-dirty", draftDiffersFromApplied());
  }

  function storeDraftNumeric(colId, min, max) {
    if (min == null && max == null) delete filterDraft.numeric[colId];
    else filterDraft.numeric[colId] = { min: min == null ? null : min, max: max == null ? null : max };
  }

  // One row per unit group: batch include/exclude + expandable member list.
  function buildFilterGroupRow(g) {
    var row = el("div", "fgroup" + (g.dimensionless ? " fgroup--dimless" : ""));
    row.setAttribute("data-gi", g.idx);

    var head = el("div", "fgroup__head");
    var sw = el("span", "unit-group__swatch unit-g" + g.idx);
    sw.setAttribute("aria-hidden", "true");
    head.appendChild(sw);

    var title = el("span", "fgroup__title",
      (g.dimensionless ? I18N.t("unitsDimless") : I18N.format("unitsGroupName", { n: g.idx + 1 })) +
      " · " + g.n);
    head.appendChild(title);

    var badge = el("span", "fgroup__badge");
    badge.hidden = true;
    head.appendChild(badge);

    // Shared UI context for local (no-rebuild) updates while drafting.
    var ctx = {
      row: row, g: g, badge: badge,
      allIn: null, allOut: null,
      featureBtns: [],
    };

    var allIn = el("button", "fbtn fbtn--in", I18N.t("filterGroupAllIn"));
    allIn.type = "button";
    allIn.title = I18N.t("filterGroupAllInTitle");
    allIn.addEventListener("click", function () {
      var allKept = ctx.g.members.every(function (name) { return filterDraft.include.has(name); });
      // second click on an already fully-kept group clears the whole group
      ctx.g.members.forEach(function (name) { setFeatureInDraft(name, allKept ? null : "include"); });
      refreshGroupUI(ctx);
    });
    ctx.allIn = allIn;
    head.appendChild(allIn);

    var allOut = el("button", "fbtn fbtn--out", I18N.t("filterGroupAllOut"));
    allOut.type = "button";
    allOut.title = I18N.t("filterGroupAllOutTitle");
    allOut.addEventListener("click", function () {
      var allDropped = ctx.g.members.every(function (name) { return filterDraft.exclude.has(name); });
      ctx.g.members.forEach(function (name) { setFeatureInDraft(name, allDropped ? null : "exclude"); });
      refreshGroupUI(ctx);
    });
    ctx.allOut = allOut;
    head.appendChild(allOut);

    var toggle = el("button", "fgroup__toggle", "▸");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", function () {
      var body = row.querySelector(".fgroup__body");
      var open = !body.hidden;
      body.hidden = open;
      toggle.textContent = open ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", String(!open));
    });
    head.appendChild(toggle);

    row.appendChild(head);

    var body = el("div", "fgroup__body");
    body.hidden = true;
    g.members.forEach(function (name) {
      var fe = buildFilterFeatureRow(name, ctx);
      body.appendChild(fe.row);
      ctx.featureBtns.push(fe);
    });
    row.appendChild(body);

    refreshGroupUI(ctx); // initial state from draft
    return row;
  }

  // One feature row inside an expanded group: name + include / exclude.
  // Clicks edit the draft and refresh only this row + its group badge.
  function buildFilterFeatureRow(name, ctx) {
    var frow = el("div", "frow");
    var nm = el("span", "frow__name", name);
    nm.title = name;
    frow.appendChild(nm);

    var inBtn = el("button", "fbtn fbtn--in fbtn--sm", I18N.t("filterKeep"));
    inBtn.type = "button";
    inBtn.addEventListener("click", function () {
      var nowIn = filterDraft.include.has(name);
      setFeatureInDraft(name, nowIn ? null : "include");
      refreshRowUI(name, inBtn, outBtn);
      refreshGroupUI(ctx);
    });
    frow.appendChild(inBtn);

    var outBtn = el("button", "fbtn fbtn--out fbtn--sm", I18N.t("filterDrop"));
    outBtn.type = "button";
    outBtn.addEventListener("click", function () {
      var nowOut = filterDraft.exclude.has(name);
      setFeatureInDraft(name, nowOut ? null : "exclude");
      refreshRowUI(name, inBtn, outBtn);
      refreshGroupUI(ctx);
    });
    frow.appendChild(outBtn);

    refreshRowUI(name, inBtn, outBtn);
    return { row: frow, name: name, inBtn: inBtn, outBtn: outBtn };
  }

  function refreshRowUI(name, inBtn, outBtn) {
    inBtn.classList.toggle("is-active", filterDraft.include.has(name));
    outBtn.classList.toggle("is-active", filterDraft.exclude.has(name));
  }

  // Recompute a group header's badge + all-buttons from the draft only.
  function refreshGroupUI(ctx) {
    var nIn = 0, nOut = 0;
    ctx.g.members.forEach(function (name) {
      if (filterDraft.include.has(name)) nIn++;
      if (filterDraft.exclude.has(name)) nOut++;
    });
    ctx.allIn.classList.toggle("is-active", nIn === ctx.g.n && nIn > 0);
    ctx.allOut.classList.toggle("is-active", nOut === ctx.g.n && nOut > 0);
    var parts = [];
    if (nIn) parts.push(I18N.format("filterInCount", { n: nIn }));
    if (nOut) parts.push(I18N.format("filterOutCount", { n: nOut }));
    ctx.badge.textContent = parts.join(" / ");
    ctx.badge.hidden = !(nIn || nOut);
    updateApplyVisual();
  }

  function applyFilterAndRender() {
    renderFilterSummary();
    renderModels();
    // The Pareto scatter reflects the same filter: filtered-out / excluded
    // models stay as faint ghosts, and the front is rebuilt from the eligible
    // set only.
    if (state.view === "pareto" && state.result) renderPareto();
    if (state.view === "compare" && state.result) renderCompare();
  }

  // Summary chip next to the Filter button: e.g. "2 in · 3 out · 1 range".
  function renderFilterSummary() {
    var f = state.filter;
    var summary = $("#filter-summary");
    if (!summary) return;
    var nNum = 0;
    for (var k in f.numeric) if (Object.prototype.hasOwnProperty.call(f.numeric, k) &&
        (f.numeric[k].min != null || f.numeric[k].max != null)) nNum++;
    var parts = [];
    if (f.include && f.include.size) parts.push(I18N.format("filterInCount", { n: f.include.size }));
    if (f.exclude && f.exclude.size) parts.push(I18N.format("filterOutCount", { n: f.exclude.size }));
    if (nNum) parts.push(I18N.format(nNum === 1 ? "filterRulesCount" : "filterRulesCountPlural", { n: nNum }));
    summary.textContent = parts.join(" · ");
    summary.hidden = !(f.active && parts.length);
    var btn = $("#btn-filter");
    if (btn) btn.classList.toggle("is-active-filter", f.active && parts.length > 0);
  }

  // ---------------------------------------------------------------------------
  // Units / dimension view: dimension-group cards (from SISSO.out) + feature &
  // descriptor usage tables with batch favourite / exclude actions.
  // ---------------------------------------------------------------------------
  var USAGE_ROW_CAP = 60; // rows shown per usage panel before "show all"

  function renderUnits() {
    var res = state.result;
    if (!res) return;
    renderUnitGroups(res);
    renderUnitsUsage(res);
  }

  function renderUnitGroups(res) {
    var wrap = $("#units-groups");
    var empty = $("#units-empty");
    if (!wrap) return;
    if (!res.meta || !res.meta.units) {
      wrap.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    var units = res.meta.units;
    wrap.innerHTML = "";
    var grid = el("div", "units__cards");
    units.groups.forEach(function (g) {
      var card = el("article", "unit-group");
      card.className = "unit-group unit-g" + g.idx;

      var head = el("div", "unit-group__head");
      var swatch = el("span", "unit-group__swatch");
      swatch.setAttribute("aria-hidden", "true");
      head.appendChild(swatch);

      var txt = el("div", "unit-group__title");
      var name = el("div", "unit-group__name");
      name.textContent = g.dimensionless
        ? I18N.t("unitsDimless")
        : I18N.format("unitsGroupName", { n: g.idx + 1 });
      txt.appendChild(name);

      var meta = el("div", "unit-group__meta");
      meta.textContent = I18N.format("unitsGroupMeta", {
        range: g.rangeText,
        n: g.n,
      });
      txt.appendChild(meta);
      head.appendChild(txt);

      var vec = el("div", "unit-group__vector");
      vec.textContent = I18N.t("unitsVector") + " " + vectorText(g.vector);
      vec.title = I18N.t("unitsVectorTitle");
      head.appendChild(vec);

      card.appendChild(head);

      var members = el("div", "unit-group__members");
      g.members.forEach(function (nameText) {
        var chip = el("span", "unit-group__chip");
        chip.textContent = nameText;
        members.appendChild(chip);
      });
      card.appendChild(members);

      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  // ---- feature & descriptor usage panels ------------------------------------

  // Usage stats are precomputed once per run (state.result.usage); this render
  // builds the two sortable tables and wires the per-row batch actions and the
  // undo bar. Matching always goes through Core (identifier-boundary token
  // match for features, canonical expression compare for descriptors) — never
  // a raw substring scan.
  function renderUnitsUsage(res) {
    var root = $("#units-usage");
    if (!root) return;
    root.innerHTML = "";
    var usage = res && res.usage;
    if (!usage || !usage.totalModels) return;

    var sec = el("section", "usage");
    var head = el("div", "usage__head");
    head.appendChild(el("h3", "usage__title", I18N.t("unitsUsageTitle")));
    head.appendChild(el("p", "usage__hint", I18N.t("unitsUsageHint")));
    sec.appendChild(head);

    var undoBar = buildUsageUndoBar();
    if (undoBar) sec.appendChild(undoBar);

    var grid = el("div", "usage__grid");
    grid.appendChild(buildUsagePanel("feature", usage));
    grid.appendChild(buildUsagePanel("descriptor", usage));
    sec.appendChild(grid);
    root.appendChild(sec);
  }

  function usageSortState(kind) {
    var s = (state.usageSort && state.usageSort[kind]) || null;
    if (!s) s = { by: "count", asc: false };
    return s;
  }

  function sortUsageRows(rows, kind) {
    var s = usageSortState(kind);
    var by = s.by;
    var dir = s.asc ? 1 : -1;
    var sorted = rows.slice();
    sorted.sort(function (a, b) {
      if (by === "name") {
        var an = a.name != null ? a.name : a.expr;
        var bn = b.name != null ? b.name : b.expr;
        return (an < bn ? -1 : an > bn ? 1 : 0) * dir;
      }
      var va = by === "count" ? a.count : a.ratio;
      var vb = by === "count" ? b.count : b.ratio;
      if (va === vb) return 0;
      return (va < vb ? -1 : 1) * dir;
    });
    return sorted;
  }

  // A feature name coloured by its dimension group when unit data exists.
  function usageFeatureLabelNode(name) {
    var units = state.result && state.result.meta && state.result.meta.units;
    if (units && units.nameToGroup &&
        Object.prototype.hasOwnProperty.call(units.nameToGroup, name)) {
      var gi = units.nameToGroup[name];
      var span = el("span", "unit-token unit-g" + gi, name);
      span.title = units.groups[gi].dimensionless
        ? I18N.t("unitsDimless")
        : I18N.format("unitsGroupName", { n: gi + 1 });
      return span;
    }
    return document.createTextNode(name);
  }

  function usageWhatShort(what) {
    var s = String(what == null ? "" : what);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  }

  // Count of the matching models that do not already carry the flag `op` sets.
  function usageWouldChange(op, matching) {
    var test = op === "favorite" ? isFavoriteModel : isExcludedModel;
    var n = 0;
    for (var i = 0; i < matching.length; i++) if (!test(matching[i])) n++;
    return n;
  }

  // How many models a batch entry can still restore (i.e. still carry the flag
  // the batch set). A batch whose flags were all changed by hand since is
  // "stale" — nothing left to undo.
  function batchRestorableCount(entry) {
    var st = modelStates();
    if (!st || !entry || !entry.entries) return 0;
    var n = 0;
    for (var i = 0; i < entry.entries.length; i++) {
      var e = entry.entries[i];
      var s = st[e.rank];
      if (!s) continue;
      if (e.setFavorite && s.favorite === true) n++;
      if (e.setExcluded && s.excluded === true) n++;
    }
    return n;
  }

  // Most recent batch entry that can still be undone. `kind`/`what`/`op`
  // optionally restrict it to one target + flag (the per-row toggles); with
  // kind == null it is the newest undoable action overall (the undo bar).
  // Stale entries (nothing left to restore) are dropped while scanning so they
  // never shadow a fresh batch of the same pairing.
  function latestRestorableEntry(kind, what, op) {
    var ops = state.batchOps;
    if (!ops || !ops.length) return null;
    for (var i = ops.length - 1; i >= 0; i--) {
      var e = ops[i];
      if (batchRestorableCount(e) === 0) { ops.splice(i, 1); continue; }
      if (kind == null) return e;
      if (e.kind === kind && e.what === what && e.op === op) return e;
    }
    return null;
  }

  // One usage row's star / eye button works as a toggle: the first click
  // applies the batch ("select every matching model"), a second click on the
  // same button undoes that exact batch again — no second state system, both
  // go through the shared modelStates map.
  function makeUsageActButton(kind, what, matching, op) {
    var isFav = op === "favorite";
    var pending = latestRestorableEntry(kind, what, op);
    var btn = el("button", "btn btn--secondary btn--sm usage-act", null);
    btn.type = "button";

    if (pending) {
      // Undo mode: this batch is applied — clicking again reverts it.
      var nRestore = batchRestorableCount(pending);
      btn.classList.add("is-active", isFav ? "usage-act--fav" : "usage-act--excl");
      var undoIcon = el("span", "usage-act__icon", null);
      undoIcon.setAttribute("aria-hidden", "true");
      undoIcon.innerHTML = isFav ? ICON_STAR_FILL : ICON_EYE;
      btn.appendChild(undoIcon);
      btn.appendChild(el("span", "usage-act__n", String(nRestore)));
      var undoTitle = I18N.format(isFav ? "usageUndoFavTitle" : "usageUndoExclTitle", {
        what: usageWhatShort(what),
        n: nRestore,
      });
      btn.title = undoTitle;
      btn.setAttribute("aria-label", undoTitle);
      btn.addEventListener("click", function () {
        undoUsageEntry(pending);
      });
      return btn;
    }

    // Apply mode (first click = select): number of models that would be newly
    // flagged; disabled when every matching model already carries the flag.
    var nWill = usageWouldChange(op, matching);
    btn.classList.toggle("is-idle", nWill === 0);
    var icon = el("span", "usage-act__icon", null);
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = isFav ? ICON_STAR : ICON_EYE_OFF;
    btn.appendChild(icon);
    btn.appendChild(el("span", "usage-act__n", String(nWill)));
    var title = I18N.format(isFav ? "usageFavBtnTitle" : "usageExclBtnTitle", {
      what: usageWhatShort(what),
      n: nWill,
    });
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.disabled = nWill === 0;
    btn.addEventListener("click", function () {
      usageBatchApply(kind, what, op, matching);
    });
    return btn;
  }

  // The single writer for batch favourite / exclude. It mutates the SAME
  // modelStates map the table / detail / Pareto / Compare flags read from
  // (Core.batchSetModelStates), records an undo entry, then refreshStateUI
  // re-syncs every view.
  function usageBatchApply(kind, what, op, matching) {
    var res = state.result;
    if (!res) return;
    var ranks = [];
    for (var i = 0; i < matching.length; i++) {
      var m = matching[i];
      var s = res.modelStates && res.modelStates[m.rank];
      var flagged = op === "favorite" ? !!(s && s.favorite) : !!(s && s.excluded);
      if (!flagged) ranks.push(m.rank);
    }
    if (!ranks.length) { toast(I18N.t("usageNoChange")); return; }
    var patch = op === "favorite" ? { favorite: true } : { excluded: true };
    var entries = Core.batchSetModelStates(modelStates(), ranks, patch);
    if (!entries.length) { toast(I18N.t("usageNoChange")); return; }
    state.batchOps.push({ kind: kind, what: what, op: op, n: entries.length, entries: entries });
    if (state.batchOps.length > 20) state.batchOps.shift();
    scheduleProjectSaveSoon();
    toast(I18N.format(op === "favorite" ? "usageFavDone" : "usageExclDone", {
      n: entries.length,
      what: usageWhatShort(what),
    }));
    refreshStateUI();
  }

  // Undo one batch action (restores the shared map; a flag the user changed
  // since the batch is preserved), then forgets it so the row button returns
  // to "apply" mode.
  function undoUsageEntry(entry) {
    if (!entry) return;
    var idx = state.batchOps.indexOf(entry);
    if (idx >= 0) state.batchOps.splice(idx, 1);
    var restored = Core.undoBatchModels(modelStates(), entry.entries);
    scheduleProjectSaveSoon();
    if (restored) toast(I18N.t("usageUndoOk"));
    refreshStateUI();
  }

  // Undo the most recent undoable batch action (the undo bar).
  function undoLastUsageBatch() {
    undoUsageEntry(latestRestorableEntry(null));
  }

  function buildUsageUndoBar() {
    var rec = latestRestorableEntry(null);
    if (!rec) return null;
    var bar = el("div", "usage-undo");
    var txt = el("span", "usage-undo__text", I18N.format(
      rec.op === "favorite" ? "usageUndoFav" : "usageUndoExcl", {
        n: rec.n,
        what: usageWhatShort(rec.what),
      }));
    bar.appendChild(txt);
    if (state.batchOps.length > 1) {
      var more = el("span", "usage-undo__more",
        I18N.format("usageUndoMore", { n: state.batchOps.length - 1 }));
      bar.appendChild(more);
    }
    var btn = el("button", "btn btn--secondary btn--sm", I18N.t("usageUndoBtn"));
    btn.type = "button";
    btn.title = I18N.t("usageUndoBtnTitle");
    btn.addEventListener("click", undoLastUsageBatch);
    bar.appendChild(btn);
    return bar;
  }

  // Sort segmented control inside one usage panel (count / share / name); a
  // click re-sorts, clicking the active key flips the direction.
  function buildUsageSortControl(kind, panel) {
    var seg = el("div", "segmented usage-sort", null);
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", I18N.t("usageSortLabel"));
    var defs = [
      ["count", I18N.t("usageSortCount")],
      ["share", I18N.t("usageSortShare")],
      ["name", I18N.t("usageSortName")],
    ];
    defs.forEach(function (def) {
      var cur = usageSortState(kind);
      var active = cur.by === def[0];
      var arrow = active ? (cur.asc ? " ↑" : " ↓") : "";
      var b = el("button", "segmented__btn" + (active ? " is-active" : ""), def[1] + arrow);
      b.type = "button";
      b.addEventListener("click", function () {
        var st = usageSortState(kind);
        if (st.by === def[0]) {
          st.asc = !st.asc; // clicking the active key flips the direction
        } else {
          state.usageSort[kind] = { by: def[0], asc: def[0] === "name" };
        }
        // repaint only the two usage panels (keeps the undo bar + groups)
        renderUnitsUsage(state.result);
      });
      seg.appendChild(b);
    });
    return seg;
  }

  function buildUsagePanel(kind, usage) {
    var isFeat = kind === "feature";
    var rows = isFeat ? usage.features : usage.descriptors;
    var panel = el("article", "usage-panel");

    var head = el("div", "usage-panel__head");
    head.appendChild(el("h4", "usage-panel__title", I18N.t(
      isFeat ? "unitsUsageFeatureTitle" : "unitsUsageDescriptorTitle")));
    var meta = el("div", "usage-panel__meta", isFeat
      ? I18N.format("usageMetaFeatures", {
        used: rows.length,
        total: usage.featureNames.length,
        n: usage.totalModels,
      })
      : I18N.format("usageMetaDescriptors", {
        n: rows.length,
        m: usage.totalModels,
      }));
    head.appendChild(meta);
    head.appendChild(buildUsageSortControl(kind, panel));
    panel.appendChild(head);

    if (!rows.length) {
      panel.appendChild(el("p", "usage-panel__empty", I18N.t(
        isFeat ? "usageNoFeatures" : "usageNoDescriptors")));
      return panel;
    }

    var expanded = !!(state.usageExpanded && state.usageExpanded[kind]);
    var sorted = sortUsageRows(rows, kind);
    var shown = expanded ? sorted : sorted.slice(0, USAGE_ROW_CAP);

    var table = document.createElement("table");
    table.className = "usage-table";
    var thead = document.createElement("thead");
    var thr = document.createElement("tr");
    var itemColLabel = I18N.t(isFeat ? "usageColItemFeature" : "usageColItemDescriptor");
    [itemColLabel, I18N.t("usageColCount"), I18N.t("usageColShare"), ""].forEach(function (txt, ci) {
      var th = document.createElement("th");
      th.textContent = txt;
      if (ci === 0) th.className = "usage-table__item";
      if (ci === 3) th.className = "usage-table__actions";
      thr.appendChild(th);
    });
    thead.appendChild(thr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    shown.forEach(function (row) {
      tbody.appendChild(buildUsageRow(kind, row, isFeat));
    });
    table.appendChild(tbody);
    panel.appendChild(table);

    if (rows.length > USAGE_ROW_CAP) {
      var foot = el("div", "usage-panel__foot");
      var toggle = el("button", "btn btn--ghost btn--sm", I18N.format(
        expanded ? "usageShowTop" : "usageShowAll", {
          n: expanded ? USAGE_ROW_CAP : rows.length,
        }));
      toggle.type = "button";
      toggle.addEventListener("click", function () {
        if (!state.usageExpanded) state.usageExpanded = { feature: false, descriptor: false };
        state.usageExpanded[kind] = !state.usageExpanded[kind];
        renderUnitsUsage(state.result);
      });
      foot.appendChild(toggle);
      panel.appendChild(foot);
    }
    return panel;
  }

  function buildUsageRow(kind, row, isFeat) {
    var what = isFeat ? row.name : row.expr;
    var tr = document.createElement("tr");

    var itemTd = document.createElement("td");
    itemTd.className = "usage-table__item";
    if (isFeat) {
      itemTd.appendChild(usageFeatureLabelNode(row.name));
    } else {
      var code = document.createElement("code");
      code.className = "usage-table__expr";
      setFormulaContent(code, row.expr);
      code.title = row.expr;
      itemTd.appendChild(code);
    }
    tr.appendChild(itemTd);

    var numTd = document.createElement("td");
    numTd.className = "usage-table__num";
    numTd.textContent = String(row.count);
    tr.appendChild(numTd);

    var shareTd = document.createElement("td");
    shareTd.className = "usage-table__share";
    shareTd.textContent = (row.ratio * 100).toFixed(1) + "%";
    tr.appendChild(shareTd);

    var actTd = document.createElement("td");
    actTd.className = "usage-table__actions";
    var matching = isFeat
      ? Core.modelsWithFeature(state.result.models, row.name)
      : Core.modelsWithDescriptor(state.result.models, row.expr);
    actTd.appendChild(makeUsageActButton(kind, what, matching, "favorite"));
    actTd.appendChild(makeUsageActButton(kind, what, matching, "exclude"));
    tr.appendChild(actTd);

    return tr;
  }

  function renderPareto() {
    var res = state.result;
    if (!res) return;
    if (state.paretoMode === "3d") { renderPareto3D(); return; }
    var computed = paretoComputed();
    var defs = computed.defs; // x, y
    var split = paretoSplit(computed.pts);
    var pts = split.pts, ghosts = split.ghosts;
    var front = computeParetoFront1(pts, defs[0], defs[1]);
    var ghostOn = ghosts.length > 0;

    $("#pareto-count").textContent = ghostOn
      ? I18N.format("paretoCountFiltered", { n: front.length, m: pts.length, t: computed.pts.length })
      : I18N.format("paretoCount", { n: front.length });

    var dom = $("#pareto-chart");
    var C = getThemeColors();
    if (state.paretoChart) { state.paretoChart.dispose(); }
    state.paretoChart = echarts.init(dom);

    var allData = pts.map(function (p) { return withFavMark({ value: [p.x, p.y], rank: p.rank }, p); });
    var ghostData = ghosts.map(function (p) { return { value: [p.x, p.y], rank: p.rank, ghost: true }; });
    var frontLine = front.map(function (p) { return [p.x, p.y]; });
    var frontData = front.map(function (p) { return withFavMark({ value: [p.x, p.y], rank: p.rank }, p); });
    // Axis bounds must cover the ghosts too — they stay visible (faintly) so
    // they must not fall outside the plotted range.
    var viewPts = computed.pts;
    var xb = paretoAxisBounds(viewPts.map(function (p) { return p.x; }));
    var yb = paretoAxisBounds(viewPts.map(function (p) { return p.y; }));

    state.paretoChart.setOption({
      animation: true,
      textStyle: { fontFamily: C.font },
      tooltip: {
        trigger: "item",
        formatter: function (params) {
          var d = params.data;
          if (!d || d.rank == null) return "";
          var rows = [
            "<strong>" + I18N.t("detailRank") + " " + d.rank + "</strong>",
            paretoAxisTitle(defs[0]) + ": " + fmt(d.value[0], 4),
            paretoAxisTitle(defs[1]) + ": " + fmt(d.value[1], 4),
          ];
          if (d.ghost) rows.push('<span style="opacity:.65">' + I18N.t("paretoGhostNote") + "</span>");
          return rows.join("<br/>");
        },
      },
      legend: {
        data: (function () {
          var names = [I18N.t("paretoAll"), I18N.t("paretoFront")];
          if (ghostOn) {
            names.unshift({
              name: I18N.t("paretoGhost"),
              icon: "circle",
              itemStyle: {
                color: "transparent",
                borderColor: withAlpha(C.textSoft, 0.6),
                borderWidth: 1.4,
              },
            });
          }
          return names;
        })(),
        top: 8,
        textStyle: { color: C.chartText },
      },
      grid: { left: 70, right: 28, top: 48, bottom: 64 },
      xAxis: {
        name: paretoAxisTitle(defs[0]),
        type: "value",
        min: xb ? xb.min : undefined,
        max: xb ? xb.max : undefined,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { lineStyle: { color: C.grid } },
      },
      yAxis: {
        name: paretoAxisTitle(defs[1]),
        type: "value",
        min: yb ? yb.min : undefined,
        max: yb ? yb.max : undefined,
        nameLocation: "middle",
        nameGap: 44,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { lineStyle: { color: C.grid } },
      },
      dataZoom: [{ type: "inside" }],
      series: (function () {
        var s = [];
        // Ghosts: filtered-out models drawn as faint hollow rings — they stay
        // inspectable (click opens the detail) but never join the front.
        if (ghostOn) {
          s.push({
            name: I18N.t("paretoGhost"),
            type: "scatter",
            data: ghostData,
            symbolSize: 8,
            itemStyle: {
              color: withAlpha(C.textSoft, 0.10),
              borderColor: withAlpha(C.textSoft, 0.55),
              borderWidth: 1,
            },
            emphasis: {
              itemStyle: {
                color: withAlpha(C.textSoft, 0.20),
                borderColor: withAlpha(C.textSoft, 0.9),
                borderWidth: 1.6,
              },
            },
            z: 1,
          });
        }
        s.push({
          name: I18N.t("paretoAll"),
          type: "scatter",
          data: allData,
          symbolSize: 8,
          itemStyle: { color: C.textSoft, opacity: 0.5 },
          z: 2,
        });
        s.push({
          name: "_frontLine",
          type: "line",
          data: frontLine,
          symbol: "none",
          lineStyle: { color: C.train, width: 2 },
          silent: true,
          showSymbol: false,
          tooltip: { show: false },
          z: 4,
        });
        s.push({
          name: I18N.t("paretoFront"),
          type: "scatter",
          data: frontData,
          symbol: "circle",
          symbolSize: 10,
          itemStyle: { color: C.train, opacity: 0.95 },
          z: 5,
        });
        return s;
      })(),
    });

    state.paretoChart.off("click");
    state.paretoChart.on("click", function (params) {
      if (params.data && params.data.rank != null) openDetail(params.data.rank);
    });

    renderParetoTable(front, defs);
  }

  // ---------------------------------------------------------------------------
  // Compare view — two-model scatter first, then formulas, then metrics.
  //
  // The picker lists the same eligible model set as the table/grid (feature
  // filter + model exclusion apply; "show excluded" brings them back for
  // restore). Selection is kept in state.compareSel (ranks) — no second copy of
  // model data. The metrics table is built by SissoCore.compareMetricRows (the
  // same numbers the detail pages show), formulas reuse the existing
  // setFormulaContent token renderer, and the two-model scatter IS the detail
  // dialog's chart (buildModelScatterOption) with two models.
  // ---------------------------------------------------------------------------
  function candidateCompareModels() {
    return filteredModels();
  }

  function comparedModels() {
    var cand = candidateCompareModels();
    return cand.filter(function (m) { return state.compareSel.indexOf(m.rank) >= 0; });
  }

  function disposeCompareChart() {
    if (state.compareChart) {
      state.compareChart.dispose();
      state.compareChart = null;
    }
  }

  function renderCompare() {
    var box = $("#compare-wrap");
    if (!box || !state.result) return;
    disposeCompareChart();
    box.innerHTML = "";
    box.hidden = false;

    var head = el("div", "compare__head");
    head.appendChild(el("h2", "compare__title", I18N.t("compareTitle")));
    head.appendChild(el("p", "compare__hint", I18N.t("compareHint")));
    box.appendChild(head);
    box.appendChild(el("p", "compare__count compare__count--line",
      I18N.format("compareCount", { n: state.compareSel.length, m: candidateCompareModels().length })));

    box.appendChild(buildComparePicker());
    var body = el("div", "compare__body");
    body.id = "compare-body";
    box.appendChild(body);
    renderComparePanels();
  }

  function buildComparePicker() {
    var cand = candidateCompareModels();
    var wrap = el("div", "compare__picker");
    var head = el("div", "compare__picker-head");
    head.appendChild(el("span", "compare__picker-title", I18N.t("comparePick")));
    var tools = el("div", "compare__picker-tools");
    var addFav = el("button", "btn btn--secondary btn--sm", I18N.t("compareAddFavs"));
    addFav.type = "button";
    addFav.disabled = !cand.some(function (m) { return isFavoriteModel(m); });
    addFav.addEventListener("click", function () {
      cand.forEach(function (m) {
        if (isFavoriteModel(m) && state.compareSel.indexOf(m.rank) < 0) {
          if (state.compareSel.length < 30) state.compareSel.push(m.rank);
        }
      });
      renderCompare();
    });
    tools.appendChild(addFav);
    var addAll = el("button", "btn btn--secondary btn--sm", I18N.t("compareAddAll"));
    addAll.type = "button";
    addAll.addEventListener("click", function () {
      var wanted = cand.length > 30 ? 30 : cand.length;
      for (var i = 0; i < cand.length && state.compareSel.length < wanted; i++) {
        if (state.compareSel.indexOf(cand[i].rank) < 0) state.compareSel.push(cand[i].rank);
      }
      renderCompare();
    });
    tools.appendChild(addAll);
    var clear = el("button", "btn btn--ghost btn--sm", I18N.t("compareClear"));
    clear.type = "button";
    clear.addEventListener("click", function () {
      state.compareSel = [];
      renderCompare();
    });
    tools.appendChild(clear);
    head.appendChild(tools);
    wrap.appendChild(head);

    var list = el("div", "compare__picker-list");
    if (!cand.length) {
      list.appendChild(el("p", "compare__picker-empty", I18N.t("compareNoCandidates")));
    } else {
      var shown = cand.length > 1000 ? cand.slice(0, 1000) : cand;
      if (shown !== cand) {
        list.appendChild(el("p", "compare__picker-empty",
          I18N.format("comparePickCapped", { n: cand.length })));
      }
      shown.forEach(function (m) {
        var label = el("label", "compare__row" + (isExcludedModel(m) ? " is-excluded" : ""));
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = state.compareSel.indexOf(m.rank) >= 0;
        cb.value = String(m.rank);
        cb.addEventListener("change", function () {
          if (cb.checked) {
            if (state.compareSel.indexOf(m.rank) < 0) state.compareSel.push(m.rank);
          } else {
            state.compareSel = state.compareSel.filter(function (r) { return r !== m.rank; });
          }
          renderComparePanels();
        });
        label.appendChild(cb);
        var txt = el("span", null, "");
        var frag = el("span", null, null);
        var badge = el("span", "compare__rank", "R" + m.rank);
        txt.appendChild(badge);
        var formulaPreview = el("span", "compare__preview");
        setFormulaContent(formulaPreview, m.formulaOriginal);
        txt.appendChild(formulaPreview);
        if (isFavoriteModel(m)) txt.appendChild(el("span", "state-tag state-tag--fav", I18N.t("favTag")));
        if (isExcludedModel(m)) txt.appendChild(el("span", "state-tag state-tag--excl", I18N.t("exclTag")));
        label.appendChild(txt);
        label.appendChild(frag);
        list.appendChild(label);
      });
    }
    wrap.appendChild(list);
    return wrap;
  }

  function metricLabelOf(row) {
    var d = I18N.t(row.dataset === "verify" ? "detailVerify" : "detailTrain");
    var m = row.metric === "rmse" ? I18N.t("metricRMSE")
      : row.metric === "maxae" ? I18N.t("metricMaxAE")
      : row.metric === "r2" ? I18N.t("metricR2") : I18N.t("metricRho");
    return m + " (" + d + ")";
  }

  // Order on the page: two-model scatter first, then formulas, then metrics.
  function renderComparePanels() {
    var body = $("#compare-body");
    if (!body || !state.result) return;
    body.innerHTML = "";
    var models = comparedModels();
    if (!models.length) {
      body.appendChild(el("p", "compare__empty", I18N.t("compareEmpty")));
      return;
    }

    // 1) two-model overlay scatter (the same chart the detail dialog uses). The
    // placeholder is attached first; renderCompareScatter() initialises it once
    // it is part of the live DOM.
    if (models.length === 2) {
      var scatterSec = el("div", "compare__section");
      scatterSec.appendChild(el("h3", "compare__section-title", I18N.t("detailChartTitle")));
      var chartWrap = el("div", "compare__lines");
      var chartDom = el("div", "chart chart--compare");
      chartDom.id = "compare-lines-chart";
      chartWrap.appendChild(chartDom);
      scatterSec.appendChild(chartWrap);
      body.appendChild(scatterSec);
    }

    // 2) formulas side by side (reuse the token-colouring renderer)
    var fSec = el("div", "compare__section");
    fSec.appendChild(el("h3", "compare__section-title", I18N.t("compareFormulas")));
    var grid = el("div", "compare-formulas");
    models.forEach(function (m) {
      var card = el("div", "compare-formula-card");
      var h = el("div", "compare-formula-card__head");
      h.appendChild(el("span", "compare__rank", "R" + m.rank));
      if (isFavoriteModel(m)) h.appendChild(el("span", "state-tag state-tag--fav", I18N.t("favTag")));
      if (isExcludedModel(m)) h.appendChild(el("span", "state-tag state-tag--excl", I18N.t("exclTag")));
      card.appendChild(h);
      var code = el("div", "compare-formula-card__code");
      setFormulaContent(code, m.formulaOriginal);
      card.appendChild(code);
      grid.appendChild(card);
    });
    fSec.appendChild(grid);
    body.appendChild(fSec);

    // 3) metrics side by side
    var mSec = el("div", "compare__section");
    mSec.appendChild(el("h3", "compare__section-title", I18N.t("compareMetrics")));
    var tWrap = el("div", "compare__table-wrap");
    var table = el("table", "models-table compare-table");
    var thead = el("thead");
    var hr = el("tr");
    hr.appendChild(el("th", null, ""));
    models.forEach(function (m) {
      var th = el("th", "num", "R" + m.rank + (isFavoriteModel(m) ? " ★" : ""));
      th.title = m.formulaOriginal;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var rows = Core.compareMetricRows(models);
    var tbody = el("tbody");
    rows.forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", null, metricLabelOf(row)));
      row.values.forEach(function (v) {
        var td = el("td", "num", fmt(v, 4));
        if (v === null || Number.isNaN(v) || typeof v !== "number") td.classList.add("is-empty");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tWrap.appendChild(table);
    mSec.appendChild(tWrap);
    body.appendChild(mSec);

    // Everything is attached — safe to init the scatter now.
    renderCompareScatter();
  }

  // Draw the shared predicted-vs-true scatter for the two compared models. The
  // option comes from buildModelScatterOption — the exact function the detail
  // dialog uses (renderChart) — so there is exactly one scatter implementation.
  function renderCompareScatter() {
    var node = document.getElementById("compare-lines-chart");
    if (!node) return;
    var models = comparedModels();
    if (models.length !== 2) return;
    if (state.compareChart) { state.compareChart.dispose(); }
    state.compareChart = echarts.init(node);
    var option = buildModelScatterOption(models, { colorBy: false });
    if (!option) {
      state.compareChart.setOption({
        title: { text: I18N.t("emptyChart"), left: "center", top: "middle", textStyle: { fontSize: 14 } },
      });
      return;
    }
    state.compareChart.setOption(option);
  }

  function openDetail(rank) {
    var res = state.result;
    var m = null;
    for (var i = 0; i < res.models.length; i++) {
      if (res.models[i].rank === rank) { m = res.models[i]; break; }
    }
    if (!m) return;
    state.currentModel = m;

    $("#dialog-title").textContent = I18N.t("detailRank") + " " + m.rank;
    setFormulaContent($("#formula-code"), m.formulaOriginal);
    renderMetricGrid(m);
    syncDetailStateButtons();

    // Make the dialog visible BEFORE initialising ECharts: a chart initialised
    // inside a hidden container gets a 0-height layout and renders squashed.
    var copyMenu = $("#copy-menu");
    if (copyMenu) { copyMenu.hidden = true; var copyBtn = $("#btn-copy-as"); if (copyBtn) copyBtn.setAttribute("aria-expanded", "false"); }
    $("#dialog-backdrop").hidden = false;
    document.body.style.overflow = "hidden";
    syncDetailTabUI();
    renderCurrentDetailChart();
  }

  function closeDetail() {
    $("#dialog-backdrop").hidden = true;
    document.body.style.overflow = "";
    if (state.chart) { state.chart.dispose(); state.chart = null; }
    if (state.errorChart) { state.errorChart.dispose(); state.errorChart = null; }
  }

  function renderMetricGrid(m) {
    var grid = $("#metric-grid");
    grid.innerHTML = "";
    var hasVerify = !!m.metricsVerify;
    var rows = [
      ["RMSE", m.metricsTrain.rmse, hasVerify ? m.metricsVerify.rmse : null],
      ["MaxAE", m.metricsTrain.maxae, hasVerify ? m.metricsVerify.maxae : null],
      ["R²", m.metricsTrain.r2, hasVerify ? m.metricsVerify.r2 : null],
      ["ρ", m.metricsTrain.rho, hasVerify ? m.metricsVerify.rho : null],
    ];
    rows.forEach(function (r) {
      var card = el("div", "metric-card");
      card.appendChild(el("div", "metric-card__label", r[0] + " · " + I18N.t("detailTrain")));
      card.appendChild(el("div", "metric-card__value", fmt(r[1], 4)));
      grid.appendChild(card);
      if (hasVerify) {
        var vc = el("div", "metric-card");
        vc.appendChild(el("div", "metric-card__label", r[0] + " · " + I18N.t("detailVerify")));
        vc.appendChild(el("div", "metric-card__value", fmt(r[2], 4)));
        grid.appendChild(vc);
      }
    });
  }

  // Column the scatter points are currently colored by (target or a feature).
  function colorSelectCol() {
    var res = state.result;
    if (!res || !state.colorKey) return null;
    for (var i = 0; i < res.columns.length; i++) {
      var c = res.columns[i];
      if (c.role !== "name" && c.letter === state.colorKey) return c;
    }
    return null;
  }

  // Fill the "Color by" dropdown with every numeric column (target + features).
  function populateColorSelect() {
    var sel = $("#color-key");
    if (!sel || !state.result) return;
    if (state.colorKey && !colorSelectCol()) state.colorKey = "";
    sel.innerHTML = "";
    var none = el("option", null, I18N.t("colorNone"));
    none.value = "";
    sel.appendChild(none);
    state.result.columns.forEach(function (c) {
      if (c.role === "name") return;
      var opt = el("option", null, c.original);
      opt.value = c.letter;
      sel.appendChild(opt);
    });
    sel.value = state.colorKey || "";
  }

  // Shared "predicted vs true" scatter — ONE implementation used by:
  //   • the model detail dialog (renderChart with a single model), and
  //   • the Compare view (renderCompareScatter with exactly two models),
  // so the two-model overlay is literally the same chart the user sees when
  // opening a model, not a second scatter implementation.
  function buildModelScatterOption(models, cfg) {
    var res = state.result;
    var C = getThemeColors();
    var single = models.length === 1;
    var colorBy = !!cfg.colorBy;
    var m0 = models[0];

    // Per-model point lists for both datasets.
    var modelPts = models.map(function (m) {
      return {
        m: m,
        train: buildPoints(res.train, m.predTrain, "train"),
        verify: res.verify ? buildPoints(res.verify, m.predVerify, "verify") : [],
      };
    });
    var total = modelPts.reduce(function (n, mp) {
      return n + mp.train.length + mp.verify.length;
    }, 0);
    if (total === 0) return null;

    // Optional color-by-parameter mapping (single-model detail view only).
    var colorCol = null;
    var colorRange = null;
    var colorMid = null;
    if (colorBy && single) {
      colorCol = colorSelectCol();
      if (colorCol) {
        var cvals = [];
        function pushColorCol(data) {
          if (!data || !data.cols) return;
          var col = data.cols[colorCol.letter];
          if (!col) return;
          for (var ci = 0; ci < data.n; ci++) {
            if (col[ci] !== undefined && Number.isFinite(col[ci])) cvals.push(col[ci]);
          }
        }
        pushColorCol(res.train);
        if (res.verify) pushColorCol(res.verify);
        if (cvals.length) {
          var cvLo = Math.min.apply(null, cvals);
          var cvHi = Math.max.apply(null, cvals);
          if (cvLo === cvHi) {
            var cvPad = Math.max(Math.abs(cvLo) * 0.01, 1e-12);
            cvLo -= cvPad; cvHi += cvPad;
          }
          colorRange = { min: cvLo, max: cvHi };
          colorMid = (cvLo + cvHi) / 2;
        }
      }
    }
    function colorVal(data, row) {
      if (!colorRange) return null;
      var col = data.cols ? data.cols[colorCol.letter] : null;
      var v = col ? col[row] : NaN;
      return (v !== undefined && Number.isFinite(v)) ? v : colorMid;
    }

    // Axis range follows all points of every model/dataset.
    var allX = [], allY = [];
    modelPts.forEach(function (mp) {
      mp.train.concat(mp.verify).forEach(function (p) { allX.push(p[0]); allY.push(p[1]); });
    });
    var lo = Math.min.apply(null, allX.concat(allY));
    var hi = Math.max.apply(null, allX.concat(allY));
    if (lo === hi) { lo -= 1; hi += 1; }
    var padSpan = (hi - lo) * 0.06;
    lo -= padSpan; hi += padSpan;

    var MODEL_COLORS = ["#4c8df6", "#e05d44", "#2ea043", "#b58900", "#a371f7", "#12a5b0", "#e06a9e", "#6b8e23"];
    var series = [];
    var legendNames = [];
    var dataSources = ["train", "verify"];

    modelPts.forEach(function (mp, mi) {
      var modelColor = single ? null : MODEL_COLORS[mi % MODEL_COLORS.length];
      dataSources.forEach(function (ds) {
        var pts = mp[ds];
        if (!pts.length) return;
        var isV = ds === "verify";
        var setName = I18N.t(isV ? "detailVerify" : "detailTrain");
        var sName = single ? setName : "R" + mp.m.rank + " " + setName;
        var data = pts.map(function (p) {
          var item = { value: [p[0], p[1]], name: p[2], raw: p };
          if (colorRange) item.value.push(colorVal(isV ? res.verify : res.train, p[4]));
          return item;
        });
        var itemStyle;
        if (single) {
          itemStyle = colorRange
            ? { opacity: 0.85 }
            : { color: isV ? C.verify : C.train, opacity: 0.7 };
        } else {
          itemStyle = { color: modelColor, opacity: 0.75 };
        }
        series.push({
          name: sName,
          type: "scatter",
          data: data,
          symbol: isV ? "triangle" : "circle",
          symbolSize: isV ? 11 : 9,
          itemStyle: itemStyle,
        });
        legendNames.push(sName);
      });
    });
    series.push({
      name: I18N.t("detailIdentity"),
      type: "line",
      data: [[lo, lo], [hi, hi]],
      symbol: "none",
      lineStyle: { color: C.identity, type: "dashed", width: 1 },
      silent: true,
      tooltip: { show: false },
    });
    legendNames.push(I18N.t("detailIdentity"));

    var option = {
      animation: true,
      color: single ? [C.train, C.verify] : MODEL_COLORS,
      textStyle: { fontFamily: C.font },
      tooltip: {
        trigger: "item",
        formatter: function (params) {
          if (params.seriesType === "line") return "";
          var p = params.data;
          var pred = p.value[0], truth = p.value[1];
          var lines = [];
          if (single) {
            lines.push("<strong>" + (p.name || "") + "</strong>");
          } else {
            lines.push("<strong>" + params.seriesName + " · " + (p.name || "") + "</strong>");
          }
          lines.push(
            I18N.t("detailPredicted") + ": " + fmt(pred, 4),
            I18N.t("detailTrue") + ": " + fmt(truth, 4),
            I18N.t("detailError") + ": " + fmt(pred - truth, 4)
          );
          if (colorRange && p.value && p.value.length > 2) {
            lines.push(colorCol.original + ": " + fmt(p.value[2], 4));
          }
          return lines.join("<br/>");
        },
      },
      legend: { data: legendNames, top: 8, type: "scroll", textStyle: { color: C.chartText } },
      grid: { left: 56, right: 24, top: 48, bottom: 64 },
      xAxis: {
        name: I18N.t("detailPredicted"),
        type: "value",
        min: lo,
        max: hi,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick, showMinLabel: false, showMaxLabel: false },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { lineStyle: { color: C.grid } },
      },
      yAxis: {
        name: I18N.t("detailTrue"),
        type: "value",
        min: lo,
        max: hi,
        nameLocation: "middle",
        nameGap: 40,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick, showMinLabel: false, showMaxLabel: false },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { lineStyle: { color: C.grid } },
      },
      dataZoom: [
        { type: "inside" },
        {
          type: "slider",
          height: 22,
          bottom: 8,
          borderColor: C.axis,
          backgroundColor: "transparent",
          fillerColor: "rgba(100, 116, 139, 0.22)",
          handleStyle: { color: C.axis, borderColor: C.axis },
          textStyle: { color: C.chartText, fontSize: 11 },
          dataBackground: { lineStyle: { color: C.axis }, areaStyle: { color: C.grid } },
          selectedDataBackground: { lineStyle: { color: C.axis }, areaStyle: { color: C.grid } },
        },
      ],
      toolbox: {
        feature: {
          saveAsImage: {
            title: I18N.t("detailExportPng"),
            name: single ? "sisso_analyzer_model_" + m0.rank : "sisso_analyzer_compare_" + models.map(function (m) { return m.rank; }).join("_"),
          },
        },
        right: 12,
        top: 4,
      },
      series: series,
    };
    if (colorRange) {
      var hasVerifyScatter = modelPts.some(function (mp) { return mp.verify.length > 0; });
      option.grid.right = 70;
      option.visualMap = {
        type: "continuous",
        min: colorRange.min,
        max: colorRange.max,
        dimension: 2,
        seriesIndex: hasVerifyScatter ? [0, 1] : [0],
        calculable: true,
        orient: "vertical",
        right: 4,
        top: "middle",
        itemHeight: 180,
        textStyle: { color: C.chartText },
        formatter: function (v) { return fmtTick(v); },
        inRange: { color: ["#2563eb", "#06b6d4", "#22c55e", "#facc15", "#ef4444"] },
      };
    }
    return option;
  }

  // ---------------------------------------------------------------------------
  // Detail chart views — segmented "Predicted vs true" / "Error distribution"
  // switcher plus the residual histogram module. The residual statistics and
  // binning come from the shared engine helpers (Core.errorSeries / residualStats
  // / errorHistogram); this section only turns their output into a chart option.
  // ---------------------------------------------------------------------------

  // Whether the loaded run carries verify predictions for this model.
  function modelHasVerify(m) {
    var res = state.result;
    return !!(res && res.verify && m && m.predVerify && m.metricsVerify);
  }

  // Which residual dataset is actually available ("verify" collapses to "train"
  // on a train-only run or when the model has no verify predictions).
  function availableErrorDataset() {
    return state.errorDataset === "verify" && modelHasVerify(state.currentModel)
      ? "verify" : "train";
  }

  // Show/hide the DOM for the active detail chart view + dataset toggle
  // (tab active state, scatter vs histogram containers, dataset segmented
  // control). Never touches chart instances — rendering happens separately.
  function syncDetailTabUI() {
    var isErr = state.detailTab === "error";
    var pred = $("#tab-predicted");
    var err = $("#tab-error");
    if (pred) pred.classList.toggle("is-active", !isErr);
    if (err) err.classList.toggle("is-active", isErr);
    $("#scatter-controls").hidden = isErr;
    $("#error-controls").hidden = !isErr;
    $("#chart").hidden = isErr;
    $("#error-view").hidden = !isErr;
    var hasV = modelHasVerify(state.currentModel);
    $("#ds-verify").hidden = !hasV;
    if (!hasV && state.errorDataset === "verify") state.errorDataset = "train";
    $("#ds-train").classList.toggle("is-active", state.errorDataset === "train");
    $("#ds-verify").classList.toggle("is-active", state.errorDataset === "verify");
  }

  // Render whichever detail view is active. Both renderers dispose + re-init
  // their own ECharts instance, so this is safe to call after theme changes and
  // after opening / switching tabs.
  function renderCurrentDetailChart() {
    var m = state.currentModel;
    if (!m || $("#dialog-backdrop").hidden) return;
    if (state.detailTab === "error") renderErrorDistribution(m);
    else renderChart(m);
  }

  function switchDetailTab(tab) {
    if (tab !== "scatter" && tab !== "error") tab = "scatter";
    if (state.detailTab === tab) return;
    // Dispose the instance of the view being left: ECharts instances must not
    // survive in a display:none container (resizes would misbehave).
    if (tab === "error") {
      if (state.chart) { state.chart.dispose(); state.chart = null; }
    } else {
      if (state.errorChart) { state.errorChart.dispose(); state.errorChart = null; }
    }
    state.detailTab = tab;
    syncDetailTabUI();
    renderCurrentDetailChart();
  }

  // Human-readable number for stat cards: up to 5 significant digits, keeping
  // small residuals (e.g. 1.2e-4) readable without fixed-decimal rounding.
  function fmtSig(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "—";
    if (v === 0) return "0";
    return String(Number(v.toPrecision(5)));
  }

  // Stats column next to the histogram: samples, mean/median error and the
  // population standard deviation, computed by the engine helpers.
  function renderErrorStats(stats, hist) {
    var box = $("#error-stats");
    if (!box) return;
    box.innerHTML = "";
    box.appendChild(el("h4", "error-stats__title", I18N.t("errStatsTitle")));
    function card(labelKey, value, hintKey) {
      var c = el("div", "error-stat-card");
      var lab = el("div", "error-stat-card__label", I18N.t(labelKey));
      if (hintKey) {
        lab.title = I18N.t(hintKey);
        lab.setAttribute("aria-label", I18N.t(hintKey));
      }
      c.appendChild(lab);
      c.appendChild(el("div", "error-stat-card__value", value));
      box.appendChild(c);
    }
    card("errStatSamples", String(hist && hist.ok ? hist.n : 0));
    card("errStatMean", fmtSig(stats.mean));
    card("errStatMedian", fmtSig(stats.median));
    card("errStatStd", fmtSig(stats.std), "errStdHint");
    if (hist && hist.excluded > 0) {
      var ig = el("div", "error-stat-card");
      ig.appendChild(el("div", "error-stat-card__label", I18N.t("errStatIgnored")));
      ig.appendChild(el("div", "error-stat-card__value", String(hist.excluded)));
      box.appendChild(ig);
    }
  }

  // ECharts option for the residual histogram. Pure formatting: every number
  // (residuals, bins, stats) was computed by Core helpers, never in here.
  function buildErrorHistogramOption(m, dataset, stats, hist) {
    if (!hist || !hist.ok) return null;
    var C = getThemeColors();
    var isV = dataset === "verify";
    var dsColor = isV ? C.verify : C.train;
    var ZERO_COLOR = "#e11d48"; // red accent marks the 0-error reference

    // x-domain = bin edges plus margin; pull 0 into view when the residuals are
    // not systematically far away (that would squash the histogram).
    var spread = hist.max - hist.min;
    var margin = Math.max(hist.binWidth, spread * 0.05);
    var lo = hist.min - margin;
    var hi = hist.max + margin;
    if (hist.min > 0 && hist.min <= Math.max(spread * 1.5, hist.binWidth * 6)) lo = 0;
    if (hist.max < 0 && -hist.max <= Math.max(spread * 1.5, hist.binWidth * 6)) hi = 0;
    var zeroVisible = lo <= 0 && 0 <= hi;

    var data = hist.bins.map(function (b, i) {
      var item = {
        value: [b.center, b.count],
        bin: b,
        isZeroBin: i === hist.zeroBin,
      };
      // Highlight the bin whose half-open range contains 0 (when zero is in range).
      if (i === hist.zeroBin) item.itemStyle = { color: ZERO_COLOR, opacity: 0.9 };
      return item;
    });

    var option = {
      animation: true,
      textStyle: { fontFamily: C.font },
      color: [dsColor],
      tooltip: {
        trigger: "item",
        formatter: function (params) {
          var d = params.data;
          if (!d || !d.bin) return "";
          var bin = d.bin;
          var pct = stats.n ? (bin.count / stats.n * 100) : 0;
          var lines = [
            "<strong>" + I18N.format("errBinRange", { lo: fmtTick(bin.start), hi: fmtTick(bin.end) }) + "</strong>",
            I18N.format("errBinCount", { n: bin.count, pct: (Math.round(pct * 10) / 10).toString() }),
          ];
          if (d.isZeroBin) lines.push(I18N.t("errZeroMark") + " ✓");
          return lines.join("<br/>");
        },
      },
      grid: { left: 56, right: 24, top: 44, bottom: 56 },
      xAxis: {
        name: I18N.t("detailError"),
        nameLocation: "middle",
        nameGap: 30,
        type: "value",
        min: lo,
        max: hi,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick, showMinLabel: false, showMaxLabel: false },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { show: false },
      },
      yAxis: {
        name: I18N.t("errStatSamples"),
        nameLocation: "middle",
        nameGap: 38,
        type: "value",
        min: 0,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [{
        name: isV ? I18N.t("detailVerify") : I18N.t("detailTrain"),
        type: "bar",
        data: data,
        itemStyle: { opacity: 0.9 },
      }],
      toolbox: {
        feature: {
          saveAsImage: {
            title: I18N.t("detailExportPng"),
            name: "sisso_analyzer_error_r" + m.rank + "_" + dataset,
          },
        },
        right: 12,
        top: 4,
      },
    };
    if (zeroVisible) {
      option.series[0].markLine = {
        symbol: ["none", "none"],
        silent: true,
        label: { formatter: I18N.t("errZeroMark"), color: ZERO_COLOR, fontSize: 11, position: "insideEndTop" },
        lineStyle: { color: ZERO_COLOR, type: "dashed", width: 1.2 },
        data: [{ xAxis: 0 }],
      };
    }
    return option;
  }

  // After the first setOption, ask ECharts for the exact pixel span of one bin
  // (convertToPixel reflects the real laid-out grid) and set touching bar
  // widths so adjacent bins fill the axis without gaps.
  function fitErrorBarWidths(chart, hist) {
    if (!chart || !hist || !hist.ok) return;
    try {
      var a = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [hist.start, 0]);
      var b = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [hist.start + hist.binWidth, 0]);
      var w = (b && b[0]) - (a && a[0]);
      if (Number.isFinite(w) && w > 0.5) {
        chart.setOption({ series: [{ barWidth: w }] });
      }
    } catch (e) { /* non-fatal: default bar width still shows */ }
  }

  // Compute residuals + stats + histogram from EXISTING predictions (no model
  // re-run) and draw the error-distribution view into #chart-error.
  function renderErrorDistribution(m) {
    var res = state.result;
    var dom = $("#chart-error");
    if (!m || !res || !dom) return;

    var dataset = availableErrorDataset();
    var isV = dataset === "verify";
    var data = isV ? res.verify : res.train;
    var pred = isV ? m.predVerify : m.predTrain;
    var yTrue = Array.from(data.cols[res.meta.targetLetter]);
    var errors = Core.errorSeries(pred, yTrue);
    var stats = Core.residualStats(errors);
    var hist = Core.errorHistogram(errors);
    errorHistCache = hist;
    renderErrorStats(stats, hist);

    if (state.errorChart) { state.errorChart.dispose(); }
    state.errorChart = echarts.init(dom);
    var option = buildErrorHistogramOption(m, dataset, stats, hist);
    if (!option) {
      state.errorChart.setOption({
        title: { text: I18N.t("emptyChart"), left: "center", top: "middle", textStyle: { fontSize: 14, color: getThemeColors().chartEmpty } },
      });
      return;
    }
    state.errorChart.setOption(option);
    fitErrorBarWidths(state.errorChart, hist);
  }

  function renderChart(m) {
    var C = getThemeColors();
    var dom = $("#chart");
    if (state.chart) { state.chart.dispose(); }
    state.chart = echarts.init(dom);

    var option = buildModelScatterOption([m], { colorBy: true });
    if (!option) {
      state.chart.setOption({
        title: { text: I18N.t("emptyChart"), left: "center", top: "middle", textStyle: { fontSize: 14, color: C.chartEmpty } },
      });
      return;
    }
    state.chart.setOption(option);
    state.chart.on("click", function (params) {
      if (params.seriesType === "scatter" && params.data) {
        openInspector(params.data.raw);
      }
    });
  }

  function resizeChart() {
    if (state.chart) state.chart.resize();
    if (state.errorChart) {
      state.errorChart.resize();
      if (errorHistCache) fitErrorBarWidths(state.errorChart, errorHistCache);
    }
    if (state.paretoChart) state.paretoChart.resize();
    if (state.compareChart) state.compareChart.resize();
  }

  // ---------------------------------------------------------------------------
  // Point inspector
  // ---------------------------------------------------------------------------
  function openInspector(point) {
    // point = [pred, true, sampleName, source, rowIndex]
    var res = state.result;
    var pred = point[0], truth = point[1], name = point[2];
    var source = point[3], rowIndex = point[4];

    var data = source === "verify" && res.verify ? res.verify : res.train;
    if (rowIndex < 0 || rowIndex >= data.n) return;

    $("#inspector-title").textContent = I18N.t("detailPointTitle") + " · " + name;

    var body = $("#inspector-body");
    body.innerHTML = "";
    body.appendChild(el("div", "inspector__pred",
      I18N.t("detailPredicted") + " " + fmt(pred, 4) + " · " +
      I18N.t("detailTrue") + " " + fmt(truth, 4)));

    var scroll = el("div", "feature-scroll");
    var table = el("table");
    var thead = el("thead");
    var hr = el("tr");
    hr.appendChild(el("th", null, "Feature"));
    hr.appendChild(el("th", null, "Value"));
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");

    res.columns.forEach(function (c) {
      if (c.role !== "feature") return;
      var tr = el("tr");
      tr.appendChild(el("td", null, c.original));
      var val = data.cols[c.letter] ? data.cols[c.letter][rowIndex] : null;
      tr.appendChild(el("td", "num", val === undefined || Number.isNaN(val) ? "—" : fmt(val, 6)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    body.appendChild(scroll);

    $("#inspector-backdrop").hidden = false;
  }

  function closeInspector() {
    $("#inspector-backdrop").hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // Prevent the browser from navigating away if a file is dropped outside
    // the dropzone (default action for file drops is to open the file).
    ["dragover", "drop"].forEach(function (ev) {
      window.addEventListener(ev, function (e) { e.preventDefault(); });
    });

    // upload
    var dz = $("#dropzone");
    $("#btn-browse").addEventListener("click", function (e) {
      e.stopPropagation();
      $("#input-files").click();
    });
    $("#btn-folder").addEventListener("click", function (e) {
      e.stopPropagation();
      $("#input-folder").click();
    });
    dz.addEventListener("click", function () { $("#input-files").click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#input-files").click(); }
    });
    $("#input-files").addEventListener("change", function (e) {
      ingest(e.target.files);
    });
    $("#input-folder").addEventListener("change", function (e) {
      ingest(e.target.files);
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove("is-dragover");
      });
    });
    dz.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;

      // Detect whether a directory is being dropped. Only in that case do we
      // need the (async, WebKit-only) webkitGetAsEntry traversal. For plain
      // files we always prefer dataTransfer.files, which is synchronous and
      // reliable across browsers — using items/entry for plain files is the
      // path that silently produced nothing in real drags.
      var hasDirectory = false;
      if (dt.items && dt.items.length) {
        for (var i = 0; i < dt.items.length; i++) {
          var it = dt.items[i];
          if (it.kind === "file" && it.webkitGetAsEntry) {
            try {
              var entry = it.webkitGetAsEntry();
              if (entry && entry.isDirectory) { hasDirectory = true; break; }
            } catch (err) { /* ignore; fall back to files */ }
          }
        }
      }

      if (hasDirectory) {
        ingest(dt.items);
      } else if (dt.files && dt.files.length) {
        ingest(dt.files);
      }
    });

    // run / reset / home nav
    $("#btn-run").addEventListener("click", run);
    $("#btn-demo").addEventListener("click", loadDemo);
    // If the demo payload is missing (e.g. deployment without demo-data.js),
    // hide the demo strip so no dead button is shown.
    if (!window.DEMO_DATA) {
      var demoPanel = $("#demo-panel");
      if (demoPanel) demoPanel.hidden = true;
    }
    $("#btn-reset").addEventListener("click", function () {
      state.files = {};
      state.texts = {};
      state.result = null;
      state.projectId = null;
      state.health = null;
      clearHealthPanels();
      state.compareSel = [];
      disposeCompareChart();
      state.view = "table";
      state.paretoMode = "2d";
      if (state.paretoChart) { state.paretoChart.dispose(); state.paretoChart = null; }
      $("#view-results").hidden = true;
      $("#view-upload").hidden = false;
      $("#btn-reset").hidden = true;
      var ctx = $("#app-context");
      if (ctx) ctx.hidden = true;
      setNavState(false);
      clearSession();
      renderFileList();
      renderRunButton();
      renderRecentList();
    });
    $("#btn-nav-home").addEventListener("click", function () {
      if (state.result) $("#btn-reset").click();
    });

    // language
    $("#btn-lang").addEventListener("click", function () {
      I18N.setLocale(I18N.getLocale() === "zh" ? "en" : "zh");
      closeAllPopovers(null);
      applyI18n();
      if (state.result) {
        renderKpis();
        renderControls(); // rebuild i18n option labels + view-aware controls
        renderModels();
        renderFilterSummary();
        if (state.view === "pareto") renderPareto();
        if (state.view === "units") renderUnits();
      }
    });

    // theme
    $("#btn-theme").addEventListener("click", cycleTheme);

    // cite popover
    $("#btn-cite").addEventListener("click", function (e) {
      e.stopPropagation();
      setCiteOpen($("#cite-popover").hidden);
    });
    document.addEventListener("click", function (e) {
      var popover = $("#cite-popover");
      if (popover.hidden) return;
      var cite = $("#cite");
      if (cite && !cite.contains(e.target)) setCiteOpen(false);
    });
    $("#btn-cite-copy").addEventListener("click", function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(CITATION_TEXT).then(function () {
        var btn = $("#btn-cite-copy");
        btn.textContent = I18N.t("citeCopied");
        setTimeout(function () { btn.textContent = I18N.t("citeCopy"); }, 2000);
      });
    });

    // filter / column popovers
    $("#btn-filter").addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = $("#filter-pop");
      closeAllPopovers("#filter-pop");
      if (pop.hidden) { renderFilterPanel(); setPopover("#filter-anchor", "#filter-pop", true); }
      else setPopover("#filter-anchor", "#filter-pop", false);
    });
    $("#btn-cols").addEventListener("click", function (e) {
      e.stopPropagation();
      var pop = $("#cols-pop");
      closeAllPopovers("#cols-pop");
      if (pop.hidden) { renderColsPanel(); setPopover("#cols-anchor", "#cols-pop", true); }
      else setPopover("#cols-anchor", "#cols-pop", false);
    });
    document.addEventListener("click", function (e) {
      var inside = e.target.closest && e.target.closest(".pop-anchor");
      if (!inside) closeAllPopovers(null);
    });
    $("#btn-load-all").addEventListener("click", function () {
      state.loadAll = !state.loadAll;
      renderControls();
      renderModels();
    });
    // Grid toolbar sorting — routes through sortByColumn() so it shares the
    // exact pipeline (and cross-view state) with the table column headers.
    $("#grid-sort-key").addEventListener("change", function (e) {
      if (!e.target.value) return;
      sortByColumn(e.target.value);
      syncGridSortUI();
    });
    $("#grid-sort-dir").addEventListener("click", function () {
      sortByColumn(state.sortKey); // same key toggles asc <-> desc
      syncGridSortUI();
    });
    $("#view-table-btn").addEventListener("click", function () {
      state.view = "table";
      renderControls();
      renderModels();
    });
    $("#view-grid-btn").addEventListener("click", function () {
      state.view = "grid";
      renderControls();
      renderModels();
    });
    $("#view-pareto-btn").addEventListener("click", function () {
      if (!state.result) return;
      state.view = "pareto";
      renderControls();
      renderPareto();
    });
    $("#view-compare-btn").addEventListener("click", function () {
      if (!state.result) return;
      state.view = "compare";
      renderControls();
      renderCompare();
    });
    $("#view-units-btn").addEventListener("click", function () {
      if (!state.result) return;
      state.view = "units";
      renderControls();
      renderUnits();
    });
    // "Show excluded" (list views + Compare picker share this single flag).
    $("#btn-excluded").addEventListener("click", function () {
      toggleShowExcluded();
    });
    // "Favourites only" — the table/grid list narrows to starred models, and
    // the same table then supports the batch model-copy checkboxes.
    $("#btn-fav-only").addEventListener("click", function () {
      toggleFavOnly();
    });

    // Pareto axis selects: a value is "<dataset>|<metric>". Selecting the same
    // dataset + metric on two visible axes is rejected with a toast so the
    // front always spans distinct objectives.
    function axisValue(spec) {
      return (spec && spec.dataset ? spec.dataset : "train") + "|" + (spec && spec.metric ? spec.metric : "rmse");
    }
    function setParetoAxis(which, e) {
      var parts = String(e.target.value || "train|rmse").split("|");
      var spec = { dataset: parts[0] || "train", metric: parts[1] || "rmse" };
      var others = [];
      if (which !== "paretoX") others.push(state.paretoX);
      if (which !== "paretoY") others.push(state.paretoY);
      if (state.paretoMode === "3d" && which !== "paretoZ") others.push(state.paretoZ);
      for (var i = 0; i < others.length; i++) {
        if (others[i] && others[i].dataset === spec.dataset && others[i].metric === spec.metric) {
          e.target.value = axisValue(state[which]); // revert — identical axis forbidden
          toast(I18N.t("paretoDuplicateAxes"));
          return;
        }
      }
      state[which] = spec;
      renderPareto();
    }
    $("#pareto-x").addEventListener("change", function (e) { setParetoAxis("paretoX", e); });
    $("#pareto-y").addEventListener("change", function (e) { setParetoAxis("paretoY", e); });
    $("#pareto-z").addEventListener("change", function (e) { setParetoAxis("paretoZ", e); });
    $("#pareto-mode-btn").addEventListener("click", function () {
      state.paretoMode = state.paretoMode === "2d" ? "3d" : "2d";
      coerceParetoAxes(); // make the third axis distinct before rendering 3D
      renderControls();
      renderPareto();
    });
    $("#btn-pareto-export").addEventListener("click", exportParetoCsv);

    // color-by-parameter on the detail scatter plot
    $("#color-key").addEventListener("change", function (e) {
      state.colorKey = e.target.value || "";
      if (state.currentModel && !$("#dialog-backdrop").hidden && state.detailTab !== "error") {
        renderChart(state.currentModel);
      }
    });

    // detail chart view tabs: Predicted vs true ⇄ Error distribution
    $("#tab-predicted").addEventListener("click", function () { switchDetailTab("scatter"); });
    $("#tab-error").addEventListener("click", function () { switchDetailTab("error"); });
    // residual dataset toggle inside the error view
    $("#ds-train").addEventListener("click", function () {
      state.errorDataset = "train";
      syncDetailTabUI();
      renderCurrentDetailChart();
    });
    $("#ds-verify").addEventListener("click", function () {
      state.errorDataset = "verify";
      syncDetailTabUI();
      renderCurrentDetailChart();
    });

    // dialogs
    $("#dialog-close").addEventListener("click", closeDetail);
    $("#dialog-backdrop").addEventListener("click", function (e) {
      if (e.target === this) closeDetail();
    });
    // Favourite / exclude from the detail dialog — same source of truth as the
    // table rows, so both stay in sync (refreshStateUI re-renders the lists).
    $("#btn-detail-fav").addEventListener("click", function () {
      var m = state.currentModel;
      if (!m) return;
      applyModelState(m.rank, { favorite: !isFavoriteModel(m) });
    });
    $("#btn-detail-excl").addEventListener("click", function () {
      var m = state.currentModel;
      if (!m) return;
      applyModelState(m.rank, { excluded: !isExcludedModel(m) });
    });
    $("#inspector-close").addEventListener("click", closeInspector);
    $("#inspector-backdrop").addEventListener("click", function (e) {
      if (e.target === this) closeInspector();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var copyMenu = $("#copy-menu");
        if (copyMenu && !copyMenu.hidden) { setCopyMenuOpen(false); return; }
        if (!$("#inspector-backdrop").hidden) closeInspector();
        else if (!$("#dialog-backdrop").hidden) closeDetail();
        else if (!$("#cite-popover").hidden) setCiteOpen(false);
      }
    });

    // Copy formula — plain text button (unchanged behaviour) plus a small
    // "Copy as…" dropdown for Plain / LaTeX / Office (UnicodeMath) exports.
    // All exports derive from ONE parser + AST in the engine (Core.formulaAst
    // / formulaToPlain / formulaToLatex / formulaToUnicodeMath).
    // okKey may be a plain key ("copied") or a "{fmt}" template key; when
    // msgOverride is provided it wins (used by the batch model-copy bar).
    function copyFormulaText(text, okKey, fmtLabel, msgOverride) {
      if (text == null || text === "") return;
      var msg = msgOverride != null
        ? msgOverride
        : (fmtLabel ? I18N.format(okKey, { fmt: fmtLabel }) : I18N.t(okKey));
      writeClipboard(text, msg);
    }

    function copyFormatLabel(kind) {
      return I18N.t(kind === "latex" ? "copyLatex" : kind === "office" ? "copyOffice" : "copyPlain");
    }

    function formulaExportFor(kind) {
      var m = state.currentModel;
      if (!m) return null;
      if (kind === "plain") return m.formulaOriginal; // untouched legacy text
      try {
        return kind === "latex" ? Core.formulaToLatex(m.formulaOriginal)
          : kind === "office" ? Core.formulaToUnicodeMath(m.formulaOriginal)
          : null;
      } catch (e) {
        toast(I18N.format("copyErr", { fmt: copyFormatLabel(kind) }));
        return null;
      }
    }

    function setCopyMenuOpen(open) {
      var menu = $("#copy-menu");
      if (!menu) return;
      menu.hidden = !open;
      var btn = $("#btn-copy-as");
      if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    $("#btn-copy").addEventListener("click", function () {
      var m = state.currentModel;
      if (!m) return;
      setCopyMenuOpen(false);
      copyFormulaText(m.formulaOriginal, "copied");
    });

    $("#btn-copy-as").addEventListener("click", function (e) {
      e.stopPropagation();
      var menu = $("#copy-menu");
      if (menu) setCopyMenuOpen(menu.hidden);
    });

    $("#copy-menu").addEventListener("click", function (e) {
      var item = e.target && e.target.closest ? e.target.closest("[data-copy-kind]") : null;
      if (!item) return;
      var kind = item.getAttribute("data-copy-kind");
      var text = formulaExportFor(kind);
      if (text == null) return; // conversion error already toasted
      setCopyMenuOpen(false);
      copyFormulaText(text, "copyToast", copyFormatLabel(kind));
    });

    // Close the menu on outside clicks / Escape (Escape handler above already
    // closes dialogs; menu is inside the dialog so handle a global click here).
    document.addEventListener("click", function (e) {
      var menu = $("#copy-menu");
      if (!menu || menu.hidden) return;
      var anchor = $("#btn-copy-as");
      if (e.target && anchor && (e.target === anchor || anchor.contains(e.target))) return;
      if (e.target && anchor && anchor.parentNode && anchor.parentNode.contains(e.target)) return;
      setCopyMenuOpen(false);
    });

    // Persist UI state after any control change/click (view, sort, pareto, …),
    // so even a mid-session refresh restores the exact screen.
    document.addEventListener("change", function (e) {
      if (state.result && e.target && e.target.closest && e.target.closest(".select, .input")) {
        setTimeout(persistSession, 0);
      }
    });
    document.addEventListener("click", function (e) {
      if (state.result && e.target && e.target.closest &&
          e.target.closest(".nav-item, .btn, .segmented__btn")) {
        setTimeout(persistSession, 0);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init() {
    bindEvents();
    window.addEventListener("resize", resizeChart);

    // Restore the theme preference and follow the OS theme when set to "system".
    try {
      var p = window.localStorage && window.localStorage.getItem(THEME_STORAGE);
      theme.preference = p === "light" || p === "dark" ? p : "system";
    } catch (e) { /* ignore */ }
    applyTheme();
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onSystemTheme = function () {
        if (theme.preference === "system") applyTheme();
      };
      if (mq.addEventListener) mq.addEventListener("change", onSystemTheme);
      else if (mq.addListener) mq.addListener(onSystemTheme);
    }

    applyI18n();
    restoreColPrefs();
    renderFileList();
    renderRunButton();
    renderRecentList();

    // Remember the current session when leaving the page, and restore the last
    // session (project + view state) on load so a refresh doesn't lose it.
    window.addEventListener("beforeunload", persistSession);
    window.addEventListener("pagehide", persistSession);
    restoreSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
