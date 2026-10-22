// ui_smoke.test.mjs — drives the real js/app.js through the browser UI paths
// under a minimal DOM shim, with no browser and no dependencies.
//
// The core-level suites (mt_sisso / health_check / pareto_* …) prove the numbers.
// This suite proves the *wiring* around them: that every view rebuilds for a
// multi-task (MT-SISSO) run — pooled dataset + per-task datasets — and that a
// single-task run still behaves exactly as before. It catches the class of bug a
// pure engine test cannot see (a stale identifier in a render function, a
// dataset token that never reaches the table, a CSV export that silently stops
// writing task files).
//
// How it reaches the app: app.js is an IIFE with no exports, so the loader
// injects a hook immediately before the closing `})();` — the production file
// stays untouched.
//
// Run: node test/ui_smoke.test.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { CLASS_TEXTS, ARCHIVE, archiveTexts } from "./classification.test.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}
function attempt(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (err) {
    failures++;
    const where = err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : String(err);
    console.log(`FAIL  ${label}: ${where}`);
  }
}

// ---------------------------------------------------------------------------
// Minimal DOM: enough of the Element / Document surface app.js touches.
// ---------------------------------------------------------------------------
class ClassList {
  constructor() { this.set = new Set(); }
  _parse(v) { String(v || "").split(/\s+/).filter(Boolean).forEach((c) => this.set.add(c)); }
  add(...c) { c.forEach((x) => this._parse(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) {
    const want = on === undefined ? !this.set.has(c) : !!on;
    if (want) this.set.add(c); else this.set.delete(c);
    return want;
  }
  get value() { return [...this.set].join(" "); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.classList = new ClassList();
    this._text = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this._listeners = {};
  }
  get className() { return this.classList.value; }
  set className(v) { this.classList.set.clear(); this.classList._parse(v); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return ""; }
  set innerHTML(v) { this.children = []; this._text = ""; }
  appendChild(c) { if (c) { c.parentNode = this; this.children.push(c); } return c; }
  insertBefore(c) { return this.appendChild(c); }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  replaceWith(c) {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) { this.parentNode.children[i] = c; c.parentNode = this.parentNode; }
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  dispatch(type, ev) { (this._listeners[type] || []).forEach((fn) => fn(ev || { target: this })); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains() { return false; }
  focus() {}
  blur() {}
  click() { this.dispatch("click"); }
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return { width: 600, height: 400, top: 0, left: 0 }; }
  get offsetWidth() { return 600; }
  get offsetHeight() { return 400; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get childNodes() { return this.children; }
}

// Boot the app once and hand back its internals plus the DOM registry.
function bootApp() {
  const registry = new Map();
  const reg = (sel) => {
    if (!registry.has(sel)) registry.set(sel, new El("div"));
    return registry.get(sel);
  };

  const document = {
    readyState: "complete",
    documentElement: new El("html"),
    body: new El("body"),
    createElement: (t) => new El(t),
    createElementNS: (ns, t) => new El(t),
    createTextNode: (t) => { const n = new El("#text"); n.textContent = t; return n; },
    createDocumentFragment: () => new El("#fragment"),
    querySelector: (sel) => reg(sel),
    querySelectorAll: () => [],
    getElementById: (id) => reg("#" + id),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  const chartStub = () => {
    const chart = {
      option: null,
      setOption(o) { this.option = o; },
      on() {}, off() {}, dispose() {}, resize() {},
      convertToPixel: () => [0, 0],
    };
    window.__lastChart = chart;
    return chart;
  };

  const window = {
    document,
    localStorage,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    echarts: { init: chartStub },
    Blob: class { constructor() {} },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    File: class { constructor(parts, name) { this.name = name; this._parts = parts; } },
    FileReader: class { readAsText(file) { this.result = (file._parts || []).join(""); if (this.onload) this.onload(); } },
    indexedDB: undefined, // IndexedDB being unavailable must not break the app
  };
  window.window = window;
  window.self = window;

  // app.js is an IIFE with no exports: inject a hook just before its closing
  // `})();` so the test can drive the internal render/export functions. The
  // shipped file is never modified.
  const raw = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const close = raw.lastIndexOf("})();");
  if (close < 0) throw new Error("app.js: could not find the IIFE closing marker");
  const hook = "\n" + [
    'window.__SISSO_APP__ = {',
    '  state: state, processTexts: processTexts, renderModels: renderModels,',
    '  renderTable: renderTable, renderGrid: renderGrid, renderPareto: renderPareto,',
    '  renderUnits: renderUnits, renderCompare: renderCompare, renderKpis: renderKpis,',
    '  renderControls: renderControls, openDetail: openDetail, closeDetail: closeDetail,',
    '  switchDetailTab: switchDetailTab, renderCurrentDetailChart: renderCurrentDetailChart,',
    '  exportModelCsv: exportModelCsv, exportParetoCsv: exportParetoCsv,',
    '  batchModelText: batchModelText, buildTableColumns: buildTableColumns,',
    '  visibleModels: visibleModels, openInspector: openInspector,',
    '  renderColsPanel: renderColsPanel, renderFilterPanel: renderFilterPanel,',
    '  makeProjectJson: makeProjectJson, applyProject: applyProject,',
    '  refreshDynamicLabels: refreshDynamicLabels,',
    '  renderClassification: renderClassification, ingest: ingest,',
    '  classificationGeometry: classificationGeometry, buildClassThumb: buildClassThumb,',
    '  classGeometryCache: classGeometryCache,',
    '};\n',
  ].join("\n");

  const load = (code, name) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "window", "document", "self", "localStorage", "console", "setTimeout",
      "clearTimeout", "URL", "Blob", "File", "FileReader", "echarts",
      code + "\n//# sourceURL=" + name
    );
    const testConsole = { ...console, warn(...args) {
      if (args[0] !== "IndexedDB save failed:") console.warn(...args);
    } };
    fn(window, document, window, localStorage, testConsole, window.setTimeout,
      window.clearTimeout, window.URL, window.Blob, window.File,
      window.FileReader, window.echarts);
  };

  // Same order as index.html.
  load(fs.readFileSync(path.join(ROOT, "js", "i18n.js"), "utf8"), "js/i18n.js");
  load(fs.readFileSync(path.join(ROOT, "js", "sisso-core.js"), "utf8"), "js/sisso-core.js");
  load(fs.readFileSync(path.join(ROOT, "js", "sisso-classification.js"), "utf8"), "js/sisso-classification.js");
  load(fs.readFileSync(path.join(ROOT, "js", "health-check.js"), "utf8"), "js/health-check.js");
  load(raw.slice(0, close) + hook + raw.slice(close), "js/app.js");

  if (!window.__SISSO_APP__) throw new Error("app.js did not expose its test hook");
  return { app: window.__SISSO_APP__, window, reg, document };
}

const { app, window, reg } = bootApp();
// IndexedDB is absent, so the recent-projects read rejects; that rejection is
// expected and must not fail the run.
process.on("unhandledRejection", () => {});

// Collect the files a download helper would write.
function captureDownloads(fn) {
  const files = [];
  const realAppend = window.document.body.appendChild.bind(window.document.body);
  window.document.body.appendChild = (n) => { files.push(n); return realAppend(n); };
  try { fn(); } finally { window.document.body.appendChild = realAppend; }
  return files;
}

// ---------------------------------------------------------------------------
// 1. synthetic two-task run — always available, exercises every MT path
// ---------------------------------------------------------------------------
const MT_TEXTS = {
  train: "name target f1\nA1 1 1\nA2 2 2\nA3 3 3\nB1 5 4\nB2 7 5\n",
  top: "Rank RMSE MaxAE Feature_ID\n1 1.118034 2.0 ( 1)\n2 2.309401 3.0 ( 1)\n",
  coeff: "Model_ID, [(c_i,i=0,n)_j,j=1,ntask]\n1 0 1 0 1\n2 1 0 0 2\n",
  uspace: "(f1) SIS_score = 0.9\n(f2) SIS_score = 0.5\n",
  sissoin: "ptype=1\nntask=2\ntask_weighting=1\ndesc_dim=1\nnsample=3,2\nnsf=2\n",
  sissoout: "Number of tasks:        2\n" +
    "Number of samples for the task(s):     3    2\nTask_weighting:        1\n",
};

attempt("MT(mini): full analysis + render path", () => app.processTexts(MT_TEXTS));
{
  const res = app.state.result;
  check(res.meta.multiTask === true, "MT(mini): flagged multi-task");
  const ids = app.buildTableColumns().map((c) => c.id);
  check(ids.indexOf("rmse-train") >= 0 && ids.indexOf("mae-t2") >= 0,
    "MT(mini): pooled + per-task metric columns exist");
  check(ids.indexOf("rmse-delta") < 0, "MT(mini): no Δ column without verify data");
  check(ids.indexOf("rmse-verify") < 0, "MT(mini): no verify column");
  check(app.buildTableColumns().find((c) => c.id === "formula").label().indexOf("task 1") >= 0,
    "MT(mini): formula column labelled as task 1 coefficients");
  attempt("MT(mini): sort by a task metric", () => {
    app.state.sortKey = "rmse-t2";
    check(app.visibleModels().list.length === 2, "MT(mini): sort keeps both models");
    app.state.sortKey = "rank";
  });
  attempt("MT(mini): detail dialog + dataset selector", () => {
    app.openDetail(res.models[0].rank);
    check(reg("#detail-ds-seg").children.length === 4,
      `MT(mini): All + pooled + 2 task buttons (got ${reg("#detail-ds-seg").children.length})`);
    check(app.state.detailDataset === "all", "MT(mini): the dialog defaults to all datasets");
    // The default view must not hide any task.
    const names = window.__lastChart.option.series.map((s) => s.name);
    check(names.indexOf("task 1") >= 0 && names.indexOf("task 2") >= 0,
      `MT(mini): default scatter draws every task (got ${names.join(", ")})`);
    check(names.indexOf("pooled") < 0, "MT(mini): default scatter omits the redundant pooled series");
    reg("#detail-ds-seg").children[3].dispatch("click");
    check(app.state.detailDataset === "t2", "MT(mini): task 2 selectable");
    const only = window.__lastChart.option.series.map((s) => s.name).filter((n) => n !== "y = x");
    check(only.length === 1 && only[0] === "task 2",
      `MT(mini): isolating task 2 draws exactly that series (got ${only.join(", ")})`);
    app.switchDetailTab("error");
    app.switchDetailTab("scatter");
    app.closeDetail();
  });
  attempt("MT(mini): Pareto / Units / Compare", () => {
    app.renderPareto();
    app.renderUnits();
    app.state.compareSel = [1, 2];
    app.renderCompare();
  });
  attempt("MT(mini): default Pareto axes contrast pooled vs task 1", () => {
    check(app.state.paretoX.dataset === "train" && app.state.paretoX.metric === "rmse",
      "MT(mini): X axis = pooled RMSE");
    check(app.state.paretoY.dataset === "t1" && app.state.paretoY.metric === "rmse",
      "MT(mini): Y axis = task 1 RMSE");
  });
  attempt("MT(mini): CSV exports cover every dataset", () => {
    const files = captureDownloads(() => app.exportModelCsv(res.models[0]));
    check(files.length === 3, `MT(mini): 3 CSVs (pooled + 2 tasks), got ${files.length}`);
    const pareto = captureDownloads(() => app.exportParetoCsv());
    check(pareto.length === 1, "MT(mini): Pareto CSV written");
  });
  attempt("MT(mini): batch copy lists per-task formulas and metrics", () => {
    const txt = app.batchModelText(res.models[0]);
    check(txt.indexOf("task_001") >= 0, "MT(mini): batch text labels task 1");
    check(txt.indexOf("RMSE_t2") >= 0, "MT(mini): batch text carries RMSE_t2");
  });
  attempt("MT(mini): KPI strip shows tasks + split", () => {
    app.renderKpis();
    const labels = reg("#kpi-strip").children.map((c) => c.children[0] && c.children[0].textContent);
    check(labels.indexOf("Tasks") >= 0 && labels.indexOf("Task split") >= 0,
      "MT(mini): KPI strip carries Tasks and Task split");
  });
  attempt("MT(mini): project JSON round-trip stays multi-task", () => {
    const json = app.makeProjectJson();
    app.applyProject(json, true);
    check(app.state.result.meta.multiTask === true, "MT(mini): restored project is multi-task");
  });
}

// ---------------------------------------------------------------------------
// 2. the real MT-SISSO fixture (skipped when dontUpdate/ is not checked out)
// ---------------------------------------------------------------------------
const DIR = path.join(ROOT, "dontUpdate", "MT-SISSO");
if (!fs.existsSync(path.join(DIR, "train.dat"))) {
  console.log("SKIP  real MT-SISSO fixture not present (dontUpdate/MT-SISSO)");
} else {
  const read = (p) => fs.readFileSync(path.join(DIR, p), "utf8");
  const texts = {
    train: read("train.dat"),
    uspace: read(path.join("SIS_subspaces", "Uspace.expressions")),
    top: read(path.join("Models", "top1000_D002")),
    coeff: read(path.join("Models", "top1000_D002_coeff")),
    sissoin: read("SISSO.in"),
    sissoout: read("SISSO.out"),
  };
  attempt("MT(fixture): 1000-model analysis + render path", () => app.processTexts(texts));
  const res = app.state.result;
  check(res.meta.ntask === 3 && res.meta.nTrain === 103, "MT(fixture): 3 tasks over 103 rows");
  check(app.buildTableColumns().map((c) => c.id).indexOf("rho-t3") >= 0,
    "MT(fixture): ρ column exists for task 3");
  attempt("MT(fixture): sort + filter on task metrics", () => {
    app.state.sortKey = "rmse-t3";
    const vis = app.visibleModels();
    const list = vis.list.slice(0, 5).map((m) => m.metrics.t3.rmse);
    check(list.every((v, i) => i === 0 || list[i - 1] <= v), "MT(fixture): rmse-t3 sorts ascending");
    const v = res.models[5].metrics.t1.rmse;
    app.state.filter = {
      active: true, includeMode: "any", include: null, exclude: null,
      numeric: { "rmse-t1": { min: v, max: v } },
    };
    const narrowed = app.visibleModels().total;
    check(narrowed > 0 && narrowed < 1000, `MT(fixture): rmse-t1 range filter narrows (${narrowed})`);
    app.state.filter = { active: false, includeMode: "any", include: null, exclude: null, numeric: {} };
    app.state.sortKey = "rank";
    app.renderModels();
  });
  attempt("MT(fixture): detail dialog across all four datasets", () => {
    app.openDetail(res.models[0].rank);
    check(reg("#detail-ds-seg").children.length === 5,
      `MT(fixture): All + pooled + 3 task buttons (got ${reg("#detail-ds-seg").children.length})`);
    // The headline fix: opening a model shows every task, not just one.
    const names = window.__lastChart.option.series.map((s) => s.name);
    const wanted = ["task 1", "task 2", "task 3"];
    check(wanted.every((w) => names.indexOf(w) >= 0),
      `MT(fixture): default scatter draws all three tasks (got ${names.join(", ")})`);
    check(names.indexOf("pooled") < 0, "MT(fixture): default scatter omits the redundant pooled series");
    check(window.__lastChart.option.series.filter((s) => s.type === "scatter").length === 3,
      "MT(fixture): exactly one scatter series per task");
    for (const i of [1, 2, 3]) {
      reg("#detail-ds-seg").children[i + 1].dispatch("click");
      check(app.state.detailDataset === "t" + i, `MT(fixture): task ${i} selectable`);
    }
    reg("#detail-ds-seg").children[0].dispatch("click");
    check(app.state.detailDataset === "all", "MT(fixture): can go back to all datasets");
    app.switchDetailTab("error");
    reg("#detail-ds-seg").children[1].dispatch("click");
    check(app.state.detailDataset === "train", "MT(fixture): pooled reselectable from the error tab");
    app.switchDetailTab("scatter");
    app.closeDetail();
  });
  attempt("MT(fixture): point inspector reads a task slice", () => {
    const data = window.SissoCore.datasetData(res, "t2");
    app.openInspector([1, 2, data.names[0], "t2", 0]);
  });
  attempt("MT(fixture): Pareto (2D + 3D) / Units / Compare / panels", () => {
    app.renderPareto();
    app.state.paretoMode = "3d";
    app.renderPareto();
    const pareto = captureDownloads(() => app.exportParetoCsv());
    check(pareto.length === 1 && String(pareto[0].download).indexOf("3d") >= 0,
      "MT(fixture): 3D Pareto CSV written");
    app.state.paretoMode = "2d";
    app.renderUnits();
    app.state.compareSel = [res.models[0].rank, res.models[1].rank];
    app.renderCompare();
    const rows = window.SissoCore.compareMetricRows(
      [res.models[0], res.models[1]], res);
    check(rows.length === 20, `MT(fixture): compare rows = 4 datasets x 5 metrics (got ${rows.length})`);
    app.renderColsPanel();
    app.renderFilterPanel();
    check(reg("#cols-pop").children.length >= 2, "MT(fixture): column panel lists rows");
  });
  attempt("MT(fixture): CSV export writes one file per dataset", () => {
    const files = captureDownloads(() => app.exportModelCsv(res.models[0]));
    check(files.length === 4, `MT(fixture): 4 CSVs (pooled + 3 tasks), got ${files.length}`);
    check(files.map((f) => f.download).join(",").indexOf("-t3.csv") >= 0,
      "MT(fixture): a task-3 CSV is among them");
  });
  attempt("MT(fixture): Chinese labels re-render for the task columns", () => {
    window.I18N.setLocale("zh");
    app.refreshDynamicLabels();
    const labels = app.buildTableColumns().map((c) => c.label());
    check(labels.some((l) => l.indexOf("任务 2") >= 0), "MT(fixture): zh labels use 任务");
    window.I18N.setLocale("en");
    app.refreshDynamicLabels();
  });
}

// ---------------------------------------------------------------------------
// 3. single-task demo — the historical behaviour must be untouched
// ---------------------------------------------------------------------------
{
  const demo = require("../js/demo-data.js").DEMO_DATA;
  attempt("ST: demo analysis + render path", () => app.processTexts({
    train: demo.train, verify: demo.verify, uspace: demo.uspace, top: demo.top,
    coeff: demo.coeff, sissoin: demo.sissoin, sissoout: demo.sissoout,
  }));
  const res = app.state.result;
  check(!res.meta.multiTask, "ST: demo run is not flagged multi-task");
  const ids = app.buildTableColumns().map((c) => c.id);
  check(ids.indexOf("rmse-train") >= 0 && ids.indexOf("rmse-verify") >= 0 &&
    ids.indexOf("rmse-delta") >= 0, "ST: train / verify / Δ columns unchanged");
  check(ids.indexOf("rmse-t1") < 0, "ST: no task columns on a single-task run");
  check(app.buildTableColumns().find((c) => c.id === "formula").label() === "Model formula",
    "ST: formula column keeps its plain label");
  attempt("ST: detail dialog keeps the train / verify toggle", () => {
    app.openDetail(res.models[0].rank);
    check(reg("#detail-ds-seg").children.length === 3,
      `ST: All + train + verify buttons (got ${reg("#detail-ds-seg").children.length})`);
    const names = window.__lastChart.option.series.map((s) => s.name);
    check(names.indexOf("train") >= 0 && names.indexOf("verify") >= 0,
      `ST: default scatter draws train + verify together (got ${names.join(", ")})`);
    reg("#detail-ds-seg").children[2].dispatch("click");
    check(app.state.detailDataset === "verify", "ST: verify selectable");
    const only = window.__lastChart.option.series.map((s) => s.name).filter((n) => n !== "y = x");
    check(only.length === 1 && only[0] === "verify",
      `ST: isolating verify draws exactly that series (got ${only.join(", ")})`);
    app.closeDetail();
  });
  attempt("ST: Pareto / Units / Compare", () => {
    app.renderPareto();
    app.renderUnits();
    app.state.compareSel = [res.models[0].rank, res.models[1].rank];
    app.renderCompare();
    check(app.state.paretoX.dataset === "train" && app.state.paretoX.metric === "rmse",
      "ST: X axis = train RMSE (unchanged)");
    check(app.state.paretoY.dataset === "verify" && app.state.paretoY.metric === "rmse",
      "ST: Y axis = verify RMSE (unchanged)");
  });
  attempt("ST: CSV export writes train + verify", () => {
    const files = captureDownloads(() => app.exportModelCsv(res.models[0]));
    check(files.length === 2, `ST: 2 CSVs (train + verify), got ${files.length}`);
  });
  attempt("ST: batch copy keeps the historical shape", () => {
    const txt = app.batchModelText(res.models[0]);
    check(/^model\d+：/.test(txt), "ST: batch text starts with the model tag");
    check(txt.indexOf("RMSE_train") >= 0 && txt.indexOf("RMSE_verify") >= 0,
      "ST: batch text covers train and verify");
    check(txt.indexOf("sisso_overall") < 0, "ST: no SISSO-overall lines on a single-task run");
  });
}

// 4. Classification uses the same upload, history and theme/language controls.
{
  attempt("Classification: analysis and render without a coefficient file", () => app.processTexts(CLASS_TEXTS));
  check(app.state.result.taskType === "classification", "Classification: independent task schema");
  check(reg("#view-results").hidden && !reg("#view-classification").hidden, "Classification: regression controls are hidden");
  check(reg("#view-table-btn").disabled && !reg("#view-classification-btn").disabled, "Classification: navigation matches task type");
  const points = window.__lastChart.option.series.filter((s) => s.type === "scatter");
  check(points.length === 3 && points.reduce((n, s) => n + s.data.length, 0) === 7, "Classification: default view overlays training and verification");
  check(points.some((s) => s.symbol.startsWith("empty")) && points.some((s) => !s.symbol.startsWith("empty")), "Classification: dataset membership uses filled / hollow symbols");
  check(points.every((s) => !/low|high/.test(s.name)), "Classification: legends use generic categories only");
  check(window.__lastChart.option.series.filter((s) => s.type === "line").length === 2, "Classification: reconstructed hull per category");
  attempt("Classification: every model has reconstructed training hulls", () => {
    app.state.classRank = 2; app.renderClassification();
    check(window.__lastChart.option.series.filter((s) => s.type === "line").length === 2, "Classification: model 2 draws reconstructed hulls");
    app.state.classHullMode = "official"; app.state.classRank = 1; app.renderClassification();
    check(window.__lastChart.option.series.filter((s) => s.type === "line").every((s) => s.lineStyle.type === "dashed"), "Classification: original hulls remain available separately");
    app.state.classHullMode = "rebuilt";
  });
  const project = app.makeProjectJson();
  check(project.files.classdesc && project.files.trainlabels && !project.files.coeff, "Classification: project preserves official evidence and labels");
  attempt("Classification: saved project round trip", () => app.applyProject(project));
  check(app.state.result.models[0].official.length === 6, "Classification: official markers survive restore");
  attempt("Classification: verification dataset and language refresh", () => {
    app.state.classDataset = "verify";
    window.I18N.setLocale("zh");
    app.refreshDynamicLabels();
    const scatter = window.__lastChart.option.series.filter((s) => s.type === "scatter");
    check(scatter.reduce((n, s) => n + s.data.length, 0) === 1, "Classification: verification projection drawn");
    check(scatter[0].data[0].value[3] === "", "Classification: verification has no invented YES/NO");
  });
  if (fs.existsSync(ARCHIVE)) {
    attempt("Classification: production archive full UI path", () => app.processTexts(archiveTexts(ARCHIVE)));
    check(app.state.result.models.length === 5000, "Classification: all 5000 production candidates loaded");
    check(window.__lastChart.option.series.filter((s) => s.type === "scatter").reduce((n, s) => n + s.data.length, 0) === 408,
      "Classification: all 331 training + 77 verification samples plotted");
    for (const model of app.state.result.models.slice(0, 251)) app.classificationGeometry(model);
    check(app.classGeometryCache.size <= 200, "Classification: preview cache is bounded for 5000 models");
    attempt("Classification: last model and verification projection", () => {
      app.state.classRank = 5000; app.state.classPage = 49; app.state.classDataset = "verify";
      app.renderClassification();
      check(window.__lastChart.option.series.filter((s) => s.type === "scatter").reduce((n, s) => n + s.data.length, 0) === 77,
        "Classification: model 5000 projects 77 verification samples");
    });
  }
  attempt("Classification: verification outliers stay inside thumbnail bounds", () => {
    app.processTexts({ ...CLASS_TEXTS, verify: "name x z\nv 1e6 -1e6\n" });
    const svg = app.buildClassThumb(app.state.result.models[0]);
    const circles = svg.children.filter((n) => n.tagName === "CIRCLE");
    check(circles.every((n) => Number(n.getAttribute("cx")) >= 0 && Number(n.getAttribute("cx")) <= 300 && Number(n.getAttribute("cy")) >= 0 && Number(n.getAttribute("cy")) <= 180), "Classification: thumbnail covers combined data ranges");
    check(svg.children.some((n) => n.getAttribute("fill") === "none" && n.getAttribute("stroke")), "Classification: thumbnail includes hollow verification markers");
  });
  attempt("Classification: verification label controls and persistence", () => {
    const nodes = (root) => [root, ...root.children.flatMap(nodes)];
    const find = (predicate) => nodes(reg("#view-classification")).find(predicate);
    const button = (key) => find((n) => n.tagName === "BUTTON" && n.textContent === window.I18N.t(key));
    const chartCount = () => window.__lastChart.option.series.filter((s) => s.type === "scatter").reduce((n, s) => n + s.data.length, 0);
    app.processTexts({ ...CLASS_TEXTS, trainlabels: undefined, classhull: undefined, classdesc: undefined, verifylabels: undefined,
      verify: "name x z\ng2 2 3\ng1 6 4\ng3 10 10\n",
      sissoin: CLASS_TEXTS.sissoin.replace("(3,3)", "(2,2,2)").replace("isconvex=(1,1)", "isconvex=(1,1,1)") });
    const originalHulls = JSON.stringify(app.classificationGeometry(app.state.result.models[0]).hulls);
    check(chartCount() === 6 && app.state.classDataset === "train", "Classification labels: unlabeled verification shows training only");
    app.state.classDataset = "both"; app.renderClassification();
    check(chartCount() === 6 && app.state.classDataset === "train", "Classification labels: invalid saved dataset is coerced to training");
    check(app.classificationGeometry(app.state.result.models[0]).verify.length === 0, "Classification labels: unlabeled verification is absent from preview geometry");
    const inputs = () => nodes(reg("#view-classification")).filter((n) => n.classList.contains("class-counts-input"));
    const input = inputs()[0], second = inputs()[1], last = inputs()[2];
    check(inputs().length === 3 && last.readOnly, "Classification labels: one box per category, last is automatic");
    input.value = "209"; second.value = "122"; input.dispatch("input");
    check(button("verificationFill").disabled && button("verificationSave").disabled && button("verificationExport").disabled && !app.state.result.verify.labels,
      "Classification labels: wrong counts disable apply and export without mutating classes");
    check(last.value === "", "Classification labels: overfilled counts never show a negative remainder");
    for (const invalid of ["-1", "0.5", "1e0", ""]) {
      input.value = invalid; second.value = "0"; input.dispatch("input");
      check(button("verificationSave").disabled && last.value === "", "Classification labels: invalid or missing count cannot be saved: " + invalid);
    }
    input.value = "3"; second.value = "0"; input.dispatch("input");
    check(last.value === "0" && !button("verificationSave").disabled, "Classification labels: automatic remainder can be zero");
    input.value = "1"; second.value = "0"; input.dispatch("input");
    check(last.value === "2", "Classification labels: final category receives remaining verification samples");
    check(!button("verificationFill").disabled, "Classification labels: zero-sized verification category accepted");
    check(nodes(find((n) => n.classList.contains("class-count-ranges"))).some((n) => n.textContent.includes("g2")), "Classification labels: counts preview identifies original row IDs");
    button("verificationFill").click();
    check(!app.state.result.verify.labels, "Classification labels: count preview remains a draft until saved");
    button("verificationSave").click();
    check(JSON.stringify(app.state.result.verify.labels) === "[0,2,2]" && chartCount() === 9, "Classification labels: counts save updates every chart category");
    check(app.classificationGeometry(app.state.result.models[0]).verify[1].classIndex === 2, "Classification labels: geometry cache refreshes after assignment");
    button("verificationEdit").click(); button("verificationManualMode").click();
    const rowClass = find((n) => n.tagName === "SELECT" && n.getAttribute("aria-label") === window.I18N.t("classificationCategories") + " · g1");
    rowClass.value = "1"; rowClass.dispatch("change");
    for (const id of ["g2", "g3"]) {
      const checkBox = find((n) => n.tagName === "INPUT" && n.getAttribute("aria-label") === window.I18N.t("verificationSelect") + " " + id);
      checkBox.checked = true; checkBox.dispatch("change");
    }
    const bulk = find((n) => n.tagName === "LABEL" && n.firstChild && n.firstChild.textContent === window.I18N.t("verificationBulkCategory")).lastChild;
    bulk.value = ""; bulk.dispatch("change"); button("verificationAssign").click(); button("verificationSave").click();
    check(JSON.stringify(app.state.result.verify.labels) === "[null,1,null]" && chartCount() === 6, "Classification labels: manual assignment follows IDs and partial labels hide verification");
    const partialProject = app.makeProjectJson(); app.applyProject(partialProject);
    check(JSON.stringify(app.state.result.verify.labels) === "[null,1,null]" && chartCount() === 6, "Classification labels: partial labels persist through project reload");
    button("verificationSetup").click(); button("verificationManualMode").click();
    const selectAll = find((n) => n.tagName === "INPUT" && n.getAttribute("aria-label") === window.I18N.t("verificationSelectAll"));
    selectAll.checked = true; selectAll.dispatch("change"); button("verificationAssign").click(); button("verificationSave").click();
    check(JSON.stringify(app.state.result.verify.labels) === "[0,0,0]" && chartCount() === 9, "Classification labels: bulk assignment completes verification labels");
    check(JSON.stringify(app.classificationGeometry(app.state.result.models[0]).hulls) === originalHulls, "Classification labels: verification edits leave training hulls unchanged");
    check(JSON.stringify(app.state.result.meta.sissoIn.classCounts) === "[2,2,2]", "Classification labels: training nsample stays unchanged");
    const completeProject = app.makeProjectJson(); app.applyProject(completeProject);
    check(chartCount() === 9, "Classification labels: complete classes restore the verification overlay");
    button("verificationEdit").click();
    button("verificationCountsMode").click();
    const countsInput = inputs()[0];
    countsInput.value = "0"; inputs()[1].value = "1"; countsInput.dispatch("input"); button("verificationSave").click();
    check(JSON.stringify(app.state.result.verify.labels) === "[1,2,2]", "Classification labels: count mode saves preview directly without manual adjustment");
  });
  reg("#btn-reset").dispatch("click");
  check(app.state.result === null && reg("#view-classification").hidden, "Classification: reset returns to upload");
  const demo = require("../js/demo-data.js").DEMO_DATA;
  attempt("Classification → regression: existing demo still renders", () => app.processTexts(demo));
  check(!app.state.result.taskType && reg("#view-classification").hidden && !reg("#view-results").hidden,
    "Classification → regression: views and navigation reset");
}

for (const reverse of [false, true]) {
  const entries = [
    ["train.dat", "bundle/train.dat", CLASS_TEXTS.train],
    ["SISSO.in", "bundle/SISSO.in", CLASS_TEXTS.sissoin],
    ["Uspace.expressions", "bundle/SIS_subspaces/Uspace.expressions", CLASS_TEXTS.uspace],
    ["top2_D002", "bundle/Models/top2_D002", CLASS_TEXTS.top],
    ["train.dat", "bundle/_class_smoke/train.dat", "name x z\nsmoke 99 99\n"],
    ["desc_D002.dat", "bundle/_class_smoke/Models/data_top1/desc_D002.dat", "wrong evidence"],
  ];
  if (reverse) entries.reverse();
  app.state.files = {};
  await app.ingest(entries.map(([name, fullPath, text]) => {
    const file = new window.File([text], name); file.webkitRelativePath = fullPath; return file;
  }));
  check(!app.state.files.classdesc, "Folder ingest: nested run cannot contribute evidence (reverse=" + reverse + ")");
  check(app.state.files.train.file._parts[0] === CLASS_TEXTS.train, "Folder ingest: production training data wins independent of order");
  check(!reg("#btn-run").disabled, "Folder ingest: classification needs no coefficient file");
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
