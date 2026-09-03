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
    view: "table",  // "table" | "grid" | "pareto"
    chart: null,    // echarts instance
    currentModel: null,
    colorKey: "",   // "" = class colors; otherwise a column letter to color by
    paretoX: "rmse",    // train metric for the Pareto scatter (x)
    paretoY: "rmse",    // verify metric for the Pareto scatter (y)
    paretoChart: null,  // echarts instance for the Pareto view
    paretoMode: "2d",   // "2d" | "3d"
    paretoZ: { metric: "r2", set: "train" },  // third objective (metric + dataset)
  };

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
    if (state.currentModel && !$("#dialog-backdrop").hidden) renderChart(state.currentModel);
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
      coeff: "top1D00_coeff", top: "top1D00", sissoin: "SISSO.in" };
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
  function applyProject(p) {
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
      processTexts(roleTexts);
      toast(I18N.t("loadedOk"));
    } catch (err) {
      console.error(err);
      toast(I18N.t("errProject") + " " + (err && err.message ? err.message : ""));
    }
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
  }

  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 3500);
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
  // Pipeline run
  // ---------------------------------------------------------------------------
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

      // a fresh analyze run starts a brand-new project identity
      state.projectId = null;

      // let the UI paint the "analyzing" state before the synchronous parse
      await new Promise(function (r) { setTimeout(r, 30); });

      processTexts(roleTexts);
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
  // saved project. roleTexts: { train, uspace, coeff, top, verify?, sissoin? }.
  function processTexts(roleTexts) {
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
    state.sortKey = "rank";
    state.sortAsc = true;
    state.loadAll = false;
    state.topN = 100;

    showResults();

    // Auto-save into the browser's recent list (like USPEX-Analyzer) — no
    // manual "Save project" click needed; that button only exports a .json.
    storeProjectLocally();
  }

  // ---------------------------------------------------------------------------
  // Results rendering
  // ---------------------------------------------------------------------------
  // Left-nav state: upload ("Load results") vs. loaded run + sub-views.
  function setNavState(hasResults) {
    var t = $("#view-table-btn"), g = $("#view-grid-btn"), p = $("#view-pareto-btn");
    var home = $("#btn-nav-home");
    if (hasResults) {
      document.body.classList.add("has-results");
      if (home) home.classList.remove("is-active");
      if (t) t.disabled = false;
      if (g) g.disabled = false;
      if (p) p.disabled = false; // verify gating happens in renderControls
    } else {
      document.body.classList.remove("has-results");
      if (home) home.classList.add("is-active");
      [t, g, p].forEach(function (b) {
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
    renderModels();
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

  function renderControls() {
    // Sort key options: rank, then each metric on the train set and (when a
    // verify set exists) on the verify set too. Note: ρ = Spearman's ρ.
    var keySel = $("#sort-key");
    keySel.innerHTML = "";
    var hasVerify = !!(state.result && state.result.verify);
    var metricDefs = [
      ["rmse", "sortRMSE"],
      ["maxae", "sortMaxAE"],
      ["r2", "sortR2"],
      ["rho", "sortRho"],
    ];
    var opts = [["rank", I18N.t("sortRank")]];
    metricDefs.forEach(function (m) {
      var label = I18N.t(m[1]);
      opts.push([m[0] + "-train", label + " (" + I18N.t("detailTrain") + ")"]);
      if (hasVerify) {
        opts.push([m[0] + "-verify", label + " (" + I18N.t("detailVerify") + ")"]);
      }
    });
    opts.forEach(function (o) {
      var opt = el("option", null, o[1]);
      opt.value = o[0];
      if (o[0] === state.sortKey) opt.selected = true;
      keySel.appendChild(opt);
    });

    var dirSel = $("#sort-dir");
    dirSel.innerHTML = "";
    [["asc", I18N.t("asc")], ["desc", I18N.t("desc")]].forEach(function (o) {
      var opt = el("option", null, o[1]);
      opt.value = o[0];
      if ((o[0] === "asc") === state.sortAsc) opt.selected = true;
      dirSel.appendChild(opt);
    });

    $("#top-n").value = state.topN;

    // Pareto axis selects — metric direction is preset (↓ smaller better,
    // ↑ bigger better).
    [["#pareto-x", state.paretoX], ["#pareto-y", state.paretoY]].forEach(function (pair) {
      var s = $(pair[0]);
      if (!s) return;
      s.innerHTML = "";
      PARETO_METRICS.forEach(function (d) {
        var opt = el("option", null, I18N.t(d.label) + (d.minimize ? " ↓" : " ↑"));
        opt.value = d.key;
        s.appendChild(opt);
      });
      s.value = pair[1];
    });

    // third Pareto axis (metric + dataset) and 2D/3D toggle
    var zSel = $("#pareto-z");
    if (zSel) {
      zSel.innerHTML = "";
      PARETO_METRICS.forEach(function (d) {
        [["train", "detailTrain"], ["verify", "detailVerify"]].forEach(function (s) {
          var opt = el("option", null, I18N.t(d.label) + " (" + I18N.t(s[1]) + ") " + (d.minimize ? "↓" : "↑"));
          opt.value = d.key + "|" + s[0];
          zSel.appendChild(opt);
        });
      });
      zSel.value = state.paretoZ.metric + "|" + state.paretoZ.set;
    }
    var zField = $("#pareto-z-field");
    if (zField) zField.hidden = state.paretoMode !== "3d";
    var modeBtn = $("#pareto-mode-btn");
    if (modeBtn) {
      modeBtn.textContent = state.paretoMode === "2d" ? I18N.t("paretoMode3D") : I18N.t("paretoMode2D");
    }

    // view toggle (pareto only meaningful when a verify set exists)
    var hasVerify = !!(state.result && state.result.verify);
    $("#view-table-btn").classList.toggle("is-active", state.view === "table");
    $("#view-grid-btn").classList.toggle("is-active", state.view === "grid");
    $("#view-pareto-btn").classList.toggle("is-active", state.view === "pareto");
    $("#view-pareto-btn").disabled = !hasVerify;
    $("#table-wrap").hidden = state.view !== "table";
    $("#grid-wrap").hidden = state.view !== "grid";
    $("#pareto-wrap").hidden = state.view !== "pareto";
    // Sort/filter toolbar and the "showing N of M" note only make sense for the
    // table/grid views — Pareto always plots every model.
    var resToolbar = document.querySelector("#view-results .toolbar");
    if (resToolbar) resToolbar.hidden = state.view === "pareto";
    var countNote = $("#count-note");
    if (countNote) countNote.hidden = state.view === "pareto";
  }

  function sortedModels() {
    if (!state.result) return [];
    var res = state.result;
    var list = res.models.slice();
    var asc = state.sortAsc;
    // sortKey format: "rank" or "<metric>-<train|verify>", e.g. "rmse-verify".
    var sk = state.sortKey.split("-");
    var metric = sk[0];
    var isVerify = sk[1] === "verify";

    // Normalise non-finite metrics to a deterministic endpoint so NaN values
    // never poison the comparator (which would make sort order unstable).
    function key(m) {
      if (metric === "rank") return m.rank;
      var ms = isVerify ? (m.metricsVerify || null) : m.metricsTrain;
      switch (metric) {
        case "rmse": return (ms && Number.isFinite(ms.rmse)) ? ms.rmse : Infinity;
        case "maxae": return (ms && Number.isFinite(ms.maxae)) ? ms.maxae : Infinity;
        case "r2": return (ms && Number.isFinite(ms.r2)) ? ms.r2 : -Infinity;
        case "rho": return (ms && Number.isFinite(ms.rho)) ? ms.rho : 0;
        default: return m.rank;
      }
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
    return { list: list, shown: n };
  }

  function renderCount() {
    if (!state.result) { $("#count-note").textContent = ""; return; }
    var vis = visibleModels();
    $("#count-note").textContent = I18N.format("loadedCount", {
      shown: vis.shown,
      total: state.result.meta.nModels,
    });
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
    $("#empty-state").hidden = vis.shown > 0;

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
  // Table
  // ---------------------------------------------------------------------------
  function renderTable() {
    var res = state.result;
    var vis = visibleModels();
    var wrap = $("#table-wrap");
    wrap.innerHTML = "";

    var table = el("table", "models-table");
    var thead = el("thead");
    var hr = el("tr");
    var cols = [
      [I18N.t("colRank"), "rank", "left"],
      [I18N.t("colFormula"), "formula", "left"],
      [I18N.t("metricRMSE") + " (" + I18N.t("detailTrain") + ")", null, "right"],
      [I18N.t("metricMaxAE") + " (" + I18N.t("detailTrain") + ")", null, "right"],
      [I18N.t("metricR2") + " (" + I18N.t("detailTrain") + ")", null, "right"],
      [I18N.t("metricRho") + " (" + I18N.t("detailTrain") + ")", null, "right"],
      [I18N.t("metricRMSE") + " (" + I18N.t("detailVerify") + ")", null, "right"],
      [I18N.t("metricMaxAE") + " (" + I18N.t("detailVerify") + ")", null, "right"],
      [I18N.t("metricRho") + " (" + I18N.t("detailVerify") + ")", null, "right"],
      [I18N.t("colActions"), null, "left"],
    ];
    cols.forEach(function (c) {
      var th = el("th", null, c[0]);
      if (c[2] === "right") th.style.textAlign = "right";
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

      tr.appendChild(el("td", "num", String(m.rank)));
      tr.appendChild(el("td", "formula-cell", m.formulaOriginal));
      tr.appendChild(el("td", "num", fmt(m.metricsTrain.rmse, 4)));
      tr.appendChild(el("td", "num", fmt(m.metricsTrain.maxae, 4)));
      tr.appendChild(el("td", "num", fmt(m.metricsTrain.r2, 4)));
      tr.appendChild(el("td", "num", fmt(m.metricsTrain.rho, 4)));
      tr.appendChild(el("td", "num", fmt(m.metricsVerify ? m.metricsVerify.rmse : null, 4)));
      tr.appendChild(el("td", "num", fmt(m.metricsVerify ? m.metricsVerify.maxae : null, 4)));
      tr.appendChild(el("td", "num", fmt(m.metricsVerify ? m.metricsVerify.rho : null, 4)));

      var td = el("td");
      var btn = el("button", "btn btn--secondary btn--sm", I18N.t("view"));
      btn.addEventListener("click", function (e) { e.stopPropagation(); openDetail(m.rank); });
      td.appendChild(btn);
      tr.appendChild(td);

      tr.addEventListener("click", function () { openDetail(m.rank); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(m.rank); }
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
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
  function paretoPoints() {
    var res = state.result;
    var xDef = paretoMetricDef(state.paretoX);
    var yDef = paretoMetricDef(state.paretoY);
    var pts = [];
    res.models.forEach(function (m) {
      if (!m.metricsTrain || !m.metricsVerify) return;
      var x = m.metricsTrain[xDef.key];
      var y = m.metricsVerify[yDef.key];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      pts.push({ rank: m.rank, x: x, y: y, m: m });
    });
    return { xDef: xDef, yDef: yDef, pts: pts };
  }

  // Non-dominated (Pareto-optimal) set for the chosen "better" directions.
  function computeParetoFront1(pts, xDef, yDef) {
    function nx(p) { return xDef.minimize ? p.x : -p.x; }
    function ny(p) { return yDef.minimize ? p.y : -p.y; }
    var nonDom = pts.filter(function (p) {
      return !pts.some(function (q) {
        if (q.rank === p.rank) return false;
        return nx(q) <= nx(p) && ny(q) <= ny(p) && (nx(q) < nx(p) || ny(q) < ny(p));
      });
    });
    return nonDom.slice().sort(function (a, b) {
      return (nx(a) - nx(b)) || (a.rank - b.rank);
    });
  }

  function paretoAxisName(def, whichKey) {
    return I18N.t(def.label) + " (" + I18N.t(whichKey) + ") " + (def.minimize ? "↓" : "↑");
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

  function modelMetric(m, metricKey, set) {
    var s = set === "verify" ? m.metricsVerify : m.metricsTrain;
    return s ? s[metricKey] : NaN;
  }

  function paretoPoints3D() {
    var res = state.result;
    var xDef = paretoMetricDef(state.paretoX);
    var yDef = paretoMetricDef(state.paretoY);
    var zDef = paretoMetricDef(state.paretoZ.metric);
    var pts = [];
    res.models.forEach(function (m) {
      var x = modelMetric(m, xDef.key, "train");
      var y = modelMetric(m, yDef.key, "verify");
      var z = modelMetric(m, zDef.key, state.paretoZ.set);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        pts.push({ rank: m.rank, x: x, y: y, z: z, m: m });
      }
    });
    return { xDef: xDef, yDef: yDef, zDef: zDef, pts: pts };
  }

  function computeParetoFront3D(pts, xDef, yDef, zDef) {
    var sx = xDef.minimize ? 1 : -1;
    var sy = yDef.minimize ? 1 : -1;
    var sz = zDef.minimize ? 1 : -1;
    function n(p) { return { x: p.x * sx, y: p.y * sy, z: p.z * sz }; }
    return pts.filter(function (p) {
      return !pts.some(function (q) {
        if (q.rank === p.rank) return false;
        var a = n(p), b = n(q);
        return b.x <= a.x && b.y <= a.y && b.z <= a.z && (b.x < a.x || b.y < a.y || b.z < a.z);
      });
    });
  }

  function paretoZLabel(zDef, zSet) {
    return I18N.t(zDef.label) + " (" + I18N.t(zSet === "verify" ? "detailVerify" : "detailTrain") + ") " + (zDef.minimize ? "↓" : "↑");
  }

  function renderPareto3D() {
    var computed = paretoPoints3D();
    var pts = computed.pts, xDef = computed.xDef, yDef = computed.yDef, zDef = computed.zDef;
    var front = computeParetoFront3D(pts, xDef, yDef, zDef);

    $("#pareto-count").textContent = I18N.format("paretoCount", { n: front.length });

    var dom = $("#pareto-chart");
    var C = getThemeColors();
    if (state.paretoChart) { state.paretoChart.dispose(); }
    state.paretoChart = echarts.init(dom);

    var xb = paretoAxisBounds(pts.map(function (p) { return p.x; }));
    var yb = paretoAxisBounds(pts.map(function (p) { return p.y; }));
    var zb = paretoAxisBounds(pts.map(function (p) { return p.z; }));

    var allData = pts.map(function (p) { return { value: [p.x, p.y, p.z], rank: p.rank }; });
    var frontData = front.map(function (p) { return { value: [p.x, p.y, p.z], rank: p.rank }; });
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
          return [
            "<strong>" + I18N.t("detailRank") + " " + d.rank + "</strong>",
            paretoAxisName(xDef, "detailTrain") + ": " + fmt(d.value[0], 4),
            paretoAxisName(yDef, "detailVerify") + ": " + fmt(d.value[1], 4),
            paretoZLabel(zDef, state.paretoZ.set) + ": " + fmt(d.value[2], 4),
          ].join("<br/>");
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
      xAxis3D: axis3D(paretoAxisName(xDef, "detailTrain"), xb),
      yAxis3D: axis3D(paretoAxisName(yDef, "detailVerify"), yb),
      zAxis3D: axis3D(paretoZLabel(zDef, state.paretoZ.set), zb),
      legend: {
        data: [I18N.t("paretoAll"), I18N.t("paretoFront")],
        top: 8,
        textStyle: { color: C.chartText },
      },
      series: [
        {
          name: I18N.t("paretoAll"),
          type: "scatter3D",
          data: allData,
          symbolSize: 6,
          itemStyle: { color: C.textSoft, opacity: 0.55 },
        },
        {
          name: "_frontLine",
          type: "line3D",
          data: frontPath,
          lineStyle: { color: C.train, width: 2 },
          silent: true,
        },
        {
          name: I18N.t("paretoFront"),
          type: "scatter3D",
          data: frontData,
          symbolSize: 10,
          itemStyle: { color: C.train, opacity: 1 },
        },
      ],
    });

    state.paretoChart.off("click");
    state.paretoChart.on("click", function (params) {
      var rank = params.data && params.data.rank;
      if (rank != null) openDetail(rank);
    });

    renderParetoTable3D(front, xDef, yDef, zDef);
  }

  function renderParetoTable3D(front, xDef, yDef, zDef) {
    var wrap = $("#pareto-table-wrap");
    wrap.innerHTML = "";
    var table = el("table", "models-table");
    var thead = el("thead");
    var hr = el("tr");
    [I18N.t("colRank"), I18N.t("colFormula"),
     paretoAxisName(xDef, "detailTrain"), paretoAxisName(yDef, "detailVerify"),
     paretoZLabel(zDef, state.paretoZ.set), I18N.t("colActions")].forEach(function (label, i) {
      var th = el("th", null, label);
      if (i >= 2 && i <= 4) th.style.textAlign = "right";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    front.forEach(function (p) {
      var tr = el("tr");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.appendChild(el("td", "num", String(p.rank)));
      tr.appendChild(el("td", "formula-cell", p.m.formulaOriginal));
      tr.appendChild(el("td", "num", fmt(p.x, 4)));
      tr.appendChild(el("td", "num", fmt(p.y, 4)));
      tr.appendChild(el("td", "num", fmt(p.z, 4)));
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
    wrap.appendChild(table);
  }

  function renderPareto() {
    var res = state.result;
    if (!res || !res.verify) return;
    if (state.paretoMode === "3d") { renderPareto3D(); return; }
    var computed = paretoPoints();
    var pts = computed.pts, xDef = computed.xDef, yDef = computed.yDef;
    var front = computeParetoFront1(pts, xDef, yDef);

    $("#pareto-count").textContent = I18N.format("paretoCount", { n: front.length });

    var dom = $("#pareto-chart");
    var C = getThemeColors();
    if (state.paretoChart) { state.paretoChart.dispose(); }
    state.paretoChart = echarts.init(dom);

    var allData = pts.map(function (p) { return { value: [p.x, p.y], rank: p.rank }; });
    var frontLine = front.map(function (p) { return [p.x, p.y]; });
    var frontData = front.map(function (p) { return { value: [p.x, p.y], rank: p.rank }; });
    var xb = paretoAxisBounds(pts.map(function (p) { return p.x; }));
    var yb = paretoAxisBounds(pts.map(function (p) { return p.y; }));

    state.paretoChart.setOption({
      animation: true,
      textStyle: { fontFamily: C.font },
      tooltip: {
        trigger: "item",
        formatter: function (params) {
          var d = params.data;
          if (!d || d.rank == null) return "";
          return [
            "<strong>" + I18N.t("detailRank") + " " + d.rank + "</strong>",
            I18N.t("detailTrain") + " " + I18N.t(xDef.label) + ": " + fmt(d.value[0], 4),
            I18N.t("detailVerify") + " " + I18N.t(yDef.label) + ": " + fmt(d.value[1], 4),
          ].join("<br/>");
        },
      },
      legend: {
        data: [I18N.t("paretoAll"), I18N.t("paretoFront")],
        top: 8,
        textStyle: { color: C.chartText },
      },
      grid: { left: 70, right: 28, top: 48, bottom: 64 },
      xAxis: {
        name: paretoAxisName(xDef, "detailTrain"),
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
        name: paretoAxisName(yDef, "detailVerify"),
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
      series: [
        {
          name: I18N.t("paretoAll"),
          type: "scatter",
          data: allData,
          symbolSize: 8,
          itemStyle: { color: C.textSoft, opacity: 0.5 },
        },
        {
          name: "_frontLine",
          type: "line",
          data: frontLine,
          symbol: "none",
          lineStyle: { color: C.train, width: 2 },
          silent: true,
          showSymbol: false,
          tooltip: { show: false },
          z: 4,
        },
        {
          name: I18N.t("paretoFront"),
          type: "scatter",
          data: frontData,
          symbol: "circle",
          symbolSize: 10,
          itemStyle: { color: C.train, opacity: 0.95 },
          z: 5,
        },
      ],
    });

    state.paretoChart.off("click");
    state.paretoChart.on("click", function (params) {
      if (params.data && params.data.rank != null) openDetail(params.data.rank);
    });

    // front table
    var wrap = $("#pareto-table-wrap");
    wrap.innerHTML = "";
    var table = el("table", "models-table");
    var thead = el("thead");
    var hr = el("tr");
    [I18N.t("colRank"), I18N.t("colFormula"),
     paretoAxisName(xDef, "detailTrain"), paretoAxisName(yDef, "detailVerify"),
     I18N.t("colActions")].forEach(function (label, i) {
      var th = el("th", null, label);
      if (i === 2 || i === 3) th.style.textAlign = "right";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el("tbody");
    front.forEach(function (p) {
      var tr = el("tr");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.appendChild(el("td", "num", String(p.rank)));
      tr.appendChild(el("td", "formula-cell", p.m.formulaOriginal));
      tr.appendChild(el("td", "num", fmt(p.x, 4)));
      tr.appendChild(el("td", "num", fmt(p.y, 4)));
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
    wrap.appendChild(table);
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
    $("#formula-code").textContent = m.formulaOriginal;
    renderMetricGrid(m);

    // Make the dialog visible BEFORE initialising ECharts: a chart initialised
    // inside a hidden container gets a 0-height layout and renders squashed.
    $("#dialog-backdrop").hidden = false;
    document.body.style.overflow = "hidden";
    renderChart(m);
  }

  function closeDetail() {
    $("#dialog-backdrop").hidden = true;
    document.body.style.overflow = "";
    if (state.chart) { state.chart.dispose(); state.chart = null; }
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

  function renderChart(m) {
    var res = state.result;
    var C = getThemeColors();
    var dom = $("#chart");
    if (state.chart) { state.chart.dispose(); }
    state.chart = echarts.init(dom);

    var trainPts = buildPoints(res.train, m.predTrain, "train");
    var verifyPts = res.verify ? buildPoints(res.verify, m.predVerify, "verify") : [];

    if (!trainPts.length && !verifyPts.length) {
      state.chart.setOption({
        title: { text: I18N.t("emptyChart"), left: "center", top: "middle", textStyle: { fontSize: 14, color: C.chartEmpty } },
      });
      return;
    }

    // Optional color-by-parameter mapping. When active, points are coloured by
    // the chosen column's value; train/verify remain distinguishable by shape.
    var colorCol = colorSelectCol();
    var colorRange = null;
    var colorMid = null;
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
    function colorVal(data, row) {
      if (!colorRange) return null;
      var col = data.cols ? data.cols[colorCol.letter] : null;
      var v = col ? col[row] : NaN;
      return (v !== undefined && Number.isFinite(v)) ? v : colorMid;
    }

    var trainData = trainPts.map(function (p) {
      var item = { value: [p[0], p[1]], name: p[2], raw: p };
      if (colorRange) item.value.push(colorVal(res.train, p[4]));
      return item;
    });
    var verifyData = verifyPts.map(function (p) {
      var item = { value: [p[0], p[1]], name: p[2], raw: p };
      if (colorRange) item.value.push(colorVal(res.verify, p[4]));
      return item;
    });

    var allX = [], allY = [];
    trainPts.concat(verifyPts).forEach(function (p) { allX.push(p[0]); allY.push(p[1]); });
    var lo = Math.min.apply(null, allX.concat(allY));
    var hi = Math.max.apply(null, allX.concat(allY));
    if (lo === hi) { lo -= 1; hi += 1; }
    var padSpan = (hi - lo) * 0.06;
    lo -= padSpan; hi += padSpan;

    var series = [{
      name: I18N.t("detailTrain"),
      type: "scatter",
      data: trainData,
      symbol: "circle",
      symbolSize: 9,
      itemStyle: colorRange ? { opacity: 0.85 } : { color: C.train, opacity: 0.7 },
    }];
    if (verifyData.length) {
      series.push({
        name: I18N.t("detailVerify"),
        type: "scatter",
        data: verifyData,
        symbol: "triangle",
        symbolSize: 11,
        itemStyle: colorRange ? { opacity: 0.85 } : { color: C.verify, opacity: 0.7 },
      });
    }
    series.push({
      name: I18N.t("detailIdentity"),
      type: "line",
      data: [[lo, lo], [hi, hi]],
      symbol: "none",
      lineStyle: { color: C.identity, type: "dashed", width: 1 },
      silent: true,
      tooltip: { show: false },
    });

    var option = {
      animation: true,
      color: [C.train, C.verify],
      textStyle: { fontFamily: C.font },
      tooltip: {
        trigger: "item",
        formatter: function (params) {
          if (params.seriesType === "line") return "";
          var p = params.data;
          var pred = p.value[0], truth = p.value[1];
          var lines = [
            "<strong>" + (p.name || "") + "</strong>",
            I18N.t("detailPredicted") + ": " + fmt(pred, 4),
            I18N.t("detailTrue") + ": " + fmt(truth, 4),
            I18N.t("detailError") + ": " + fmt(pred - truth, 4),
          ];
          if (colorRange && p.value && p.value.length > 2) {
            lines.push(colorCol.original + ": " + fmt(p.value[2], 4));
          }
          return lines.join("<br/>");
        },
      },
      legend: {
        data: [I18N.t("detailTrain"), I18N.t("detailVerify"), I18N.t("detailIdentity")],
        top: 8,
        textStyle: { color: C.chartText },
      },
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
          dataBackground: {
            lineStyle: { color: C.axis },
            areaStyle: { color: C.grid },
          },
          selectedDataBackground: {
            lineStyle: { color: C.axis },
            areaStyle: { color: C.grid },
          },
        },
      ],
      toolbox: {
        feature: {
          saveAsImage: { title: I18N.t("detailExportPng"), name: "sisso_analyzer_model_" + m.rank },
        },
        right: 12,
        top: 4,
      },
      series: series,
    };
    if (colorRange) {
      option.grid.right = 70;
      option.visualMap = {
        type: "continuous",
        min: colorRange.min,
        max: colorRange.max,
        dimension: 2,
        seriesIndex: verifyData.length ? [0, 1] : [0],
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
    state.chart.setOption(option);
    state.chart.on("click", function (params) {
      if (params.seriesType === "scatter" && params.data) {
        openInspector(params.data.raw);
      }
    });
  }

  function resizeChart() {
    if (state.chart) state.chart.resize();
    if (state.paretoChart) state.paretoChart.resize();
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
    $("#btn-reset").addEventListener("click", function () {
      state.files = {};
      state.texts = {};
      state.result = null;
      state.projectId = null;
      state.view = "table";
      state.paretoMode = "2d";
      if (state.paretoChart) { state.paretoChart.dispose(); state.paretoChart = null; }
      $("#view-results").hidden = true;
      $("#view-upload").hidden = false;
      $("#btn-reset").hidden = true;
      var ctx = $("#app-context");
      if (ctx) ctx.hidden = true;
      setNavState(false);
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
      applyI18n();
      if (state.result) {
        renderKpis();
        renderModels();
        if (state.view === "pareto") renderPareto();
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

    // controls
    $("#sort-key").addEventListener("change", function (e) {
      state.sortKey = e.target.value;
      renderModels();
    });
    $("#sort-dir").addEventListener("change", function (e) {
      state.sortAsc = e.target.value === "asc";
      renderModels();
    });
    $("#top-n").addEventListener("change", function (e) {
      var v = parseInt(e.target.value, 10);
      state.topN = Number.isFinite(v) && v > 0 ? v : 100;
      state.loadAll = false;
      renderModels();
    });
    $("#btn-load-all").addEventListener("click", function () {
      state.loadAll = true;
      renderModels();
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
      if (!state.result || !state.result.verify) {
        toast(I18N.t("paretoRequireVerify"));
        return;
      }
      state.view = "pareto";
      renderControls();
      renderPareto();
    });
    $("#pareto-x").addEventListener("change", function (e) {
      state.paretoX = e.target.value || "rmse";
      renderPareto();
    });
    $("#pareto-y").addEventListener("change", function (e) {
      state.paretoY = e.target.value || "rmse";
      renderPareto();
    });
    $("#pareto-z").addEventListener("change", function (e) {
      var parts = (e.target.value || "r2|train").split("|");
      state.paretoZ = { metric: parts[0] || "r2", set: parts[1] || "train" };
      renderPareto();
    });
    $("#pareto-mode-btn").addEventListener("click", function () {
      state.paretoMode = state.paretoMode === "2d" ? "3d" : "2d";
      renderControls();
      renderPareto();
    });

    // color-by-parameter on the detail scatter plot
    $("#color-key").addEventListener("change", function (e) {
      state.colorKey = e.target.value || "";
      if (state.currentModel && !$("#dialog-backdrop").hidden) {
        renderChart(state.currentModel);
      }
    });

    // dialogs
    $("#dialog-close").addEventListener("click", closeDetail);
    $("#dialog-backdrop").addEventListener("click", function (e) {
      if (e.target === this) closeDetail();
    });
    $("#inspector-close").addEventListener("click", closeInspector);
    $("#inspector-backdrop").addEventListener("click", function (e) {
      if (e.target === this) closeInspector();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!$("#inspector-backdrop").hidden) closeInspector();
        else if (!$("#dialog-backdrop").hidden) closeDetail();
        else if (!$("#cite-popover").hidden) setCiteOpen(false);
      }
    });

    // copy formula
    $("#btn-copy").addEventListener("click", function () {
      var m = state.currentModel;
      if (!m) return;
      navigator.clipboard.writeText(m.formulaOriginal).then(function () {
        toast(I18N.t("copied"));
      });
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
    renderFileList();
    renderRunButton();
    renderRecentList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
