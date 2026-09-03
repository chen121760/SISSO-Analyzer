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
    files: {},      // role -> {name, text}
    result: null,   // pipeline result
    sortKey: "rank",
    sortAsc: true,
    topN: 100,
    loadAll: false,
    view: "table",  // "table" | "grid"
    chart: null,    // echarts instance
    currentModel: null,
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
  ];

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

  // Snap [lo, hi] outward to round boundaries (≈5 nice intervals) so the ticks
  // at the four corners of the plot read clean values (-8, -4, 0, …) instead
  // of full-precision floats.
  function niceAxisBounds(lo, hi) {
    var span = hi - lo;
    if (!(span > 0) || !Number.isFinite(span)) return { min: lo, max: hi };
    var mag = Math.pow(10, Math.floor(Math.log10(span / 5)));
    var norm = (span / 5) / mag;
    var nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    var step = nice * mag;
    return {
      min: Math.floor(lo / step - 1e-9) * step,
      max: Math.ceil(hi / step + 1e-9) * step,
    };
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
      var files = {};
      files.trainText = await readFileAsText(state.files.train.file);
      if (state.files.verify) files.verifyText = await readFileAsText(state.files.verify.file);
      files.uspaceText = await readFileAsText(state.files.uspace.file);
      files.coeffText = await readFileAsText(state.files.coeff.file);
      files.topText = await readFileAsText(state.files.top.file);

      // let the UI paint the "analyzing" state before the synchronous parse
      await new Promise(function (r) { setTimeout(r, 30); });

      state.result = Core.runPipeline(files);
      state.sortKey = "rank";
      state.sortAsc = true;
      state.loadAll = false;
      state.topN = 100;

      showResults();
    } catch (err) {
      console.error(err);
      toast(I18N.t("errParse") + " " + (err && err.message ? err.message : ""));
    } finally {
      setButtonLoading(btn, false);
      hideLoading();
      renderRunButton();
    }
  }

  // ---------------------------------------------------------------------------
  // Results rendering
  // ---------------------------------------------------------------------------
  function showResults() {
    $("#view-upload").hidden = true;
    $("#view-results").hidden = false;
    $("#btn-reset").hidden = false;

    var res = state.result;
    if (res.meta.validationNote === "in-sample") {
      var w = $("#warning");
      w.textContent = I18N.t("inSampleWarning");
      w.hidden = false;
    } else {
      $("#warning").hidden = true;
    }

    renderKpis();
    renderControls();
    renderModels();
  }

  function renderKpis() {
    var res = state.result;
    var strip = $("#kpi-strip");
    strip.innerHTML = "";
    var kpis = [
      [I18N.t("kpiModels"), res.meta.nModels],
      [I18N.t("kpiTrain"), res.meta.nTrain],
      [I18N.t("kpiVerify"), res.meta.nVerify || I18N.t("noVerify")],
      [I18N.t("kpiFeatures"), res.meta.nFeatures],
    ];
    // best rho (lowest = most negative correlation, or highest |rho|? show min rho by magnitude)
    var bestRho = null;
    res.models.forEach(function (m) {
      if (m.metricsTrain && Number.isFinite(m.metricsTrain.rho)) {
        if (bestRho === null || Math.abs(m.metricsTrain.rho) > Math.abs(bestRho)) {
          bestRho = m.metricsTrain.rho;
        }
      }
    });
    kpis.push([I18N.t("kpiTopRho"), bestRho === null ? I18N.t("noVerify") : fmt(bestRho, 4)]);

    kpis.forEach(function (k) {
      var card = el("div", "kpi");
      card.appendChild(el("div", "kpi__label", k[0]));
      card.appendChild(el("div", "kpi__value", String(k[1])));
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

    // view toggle
    $("#view-table-btn").classList.toggle("is-active", state.view === "table");
    $("#view-grid-btn").classList.toggle("is-active", state.view === "grid");
    $("#table-wrap").hidden = state.view !== "table";
    $("#grid-wrap").hidden = state.view !== "grid";
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
      ["RMSE (train)", null, "right"],
      ["MaxAE (train)", null, "right"],
      ["R² (train)", null, "right"],
      ["ρ (train)", null, "right"],
      ["RMSE (verify)", null, "right"],
      ["MaxAE (verify)", null, "right"],
      ["ρ (verify)", null, "right"],
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
      metrics.appendChild(el("span", null, "RMSE " + fmt(m.metricsTrain.rmse, 3)));
      metrics.appendChild(el("span", null, "ρ " + fmt(m.metricsTrain.rho, 3)));
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

    var trainData = trainPts.map(function (p) {
      return { value: [p[0], p[1]], name: p[2], raw: p };
    });
    var verifyData = verifyPts.map(function (p) {
      return { value: [p[0], p[1]], name: p[2], raw: p };
    });

    var allX = [], allY = [];
    trainPts.concat(verifyPts).forEach(function (p) { allX.push(p[0]); allY.push(p[1]); });
    var lo = Math.min.apply(null, allX.concat(allY));
    var hi = Math.max.apply(null, allX.concat(allY));
    if (lo === hi) { lo -= 1; hi += 1; }
    var padSpan = (hi - lo) * 0.06;
    lo -= padSpan; hi += padSpan;
    var bounds = niceAxisBounds(lo, hi);

    var series = [{
      name: I18N.t("detailTrain"),
      type: "scatter",
      data: trainData,
      symbol: "circle",
      symbolSize: 9,
      itemStyle: { color: C.train, opacity: 0.7 },
    }];
    if (verifyData.length) {
      series.push({
        name: I18N.t("detailVerify"),
        type: "scatter",
        data: verifyData,
        symbol: "triangle",
        symbolSize: 11,
        itemStyle: { color: C.verify, opacity: 0.7 },
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
          return [
            "<strong>" + (p.name || "") + "</strong>",
            I18N.t("detailPredicted") + ": " + fmt(pred, 4),
            I18N.t("detailTrue") + ": " + fmt(truth, 4),
            I18N.t("detailError") + ": " + fmt(pred - truth, 4),
          ].join("<br/>");
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
        min: bounds.min,
        max: bounds.max,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick },
        axisLine: { lineStyle: { color: C.axis } },
        splitLine: { lineStyle: { color: C.grid } },
      },
      yAxis: {
        name: I18N.t("detailTrue"),
        type: "value",
        min: bounds.min,
        max: bounds.max,
        nameLocation: "middle",
        nameGap: 40,
        nameTextStyle: { color: C.chartText },
        axisLabel: { color: C.chartText, formatter: fmtTick },
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
    state.chart.setOption(option);
    state.chart.on("click", function (params) {
      if (params.seriesType === "scatter" && params.data) {
        openInspector(params.data.raw);
      }
    });
  }

  function resizeChart() {
    if (state.chart) state.chart.resize();
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
  // CSV export
  // ---------------------------------------------------------------------------
  function exportCsv() {
    var res = state.result;
    var vis = visibleModels();
    var header = [
      "rank", "formula", "feature_ids",
      "RMSE_sisso", "MaxAE_sisso",
      "RMSE_train", "MaxAE_train", "R2_train", "rho_train",
      "RMSE_verify", "MaxAE_verify", "R2_verify", "rho_verify",
    ];
    var lines = [header.join(",")];
    vis.list.slice(0, vis.shown).forEach(function (m) {
      var row = [
        m.rank,
        '"' + m.formulaOriginal.replace(/"/g, '""') + '"',
        '"' + m.featureIds.join(" ") + '"',
        m.rmseSisso,
        m.maxaeSisso,
        m.metricsTrain.rmse,
        m.metricsTrain.maxae,
        m.metricsTrain.r2,
        m.metricsTrain.rho,
        m.metricsVerify ? m.metricsVerify.rmse : "",
        m.metricsVerify ? m.metricsVerify.maxae : "",
        m.metricsVerify ? m.metricsVerify.r2 : "",
        m.metricsVerify ? m.metricsVerify.rho : "",
      ];
      lines.push(row.join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "models.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast(I18N.t("exported"));
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

    // run / reset
    $("#btn-run").addEventListener("click", run);
    $("#btn-reset").addEventListener("click", function () {
      state.files = {};
      state.result = null;
      $("#view-results").hidden = true;
      $("#view-upload").hidden = false;
      $("#btn-reset").hidden = true;
      renderFileList();
      renderRunButton();
    });

    // language
    $("#btn-lang").addEventListener("click", function () {
      I18N.setLocale(I18N.getLocale() === "zh" ? "en" : "zh");
      applyI18n();
      if (state.result) { renderKpis(); renderModels(); }
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
    $("#btn-export").addEventListener("click", exportCsv);

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
