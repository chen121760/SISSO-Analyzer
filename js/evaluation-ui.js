/* A separate post-evaluation workspace; the existing ranked-model views stay intact. */
(function (root) {
  "use strict";
  var E = root.SissoEvaluation, B = root.SissoEvaluationBatch, Core = root.SissoCore, active = null;
  var words = {
    en: {
      title: "Post-evaluation", back: "Back to models", intro: "Evaluate a selected model or screen all candidates using one fixed protocol. Official SISSO YES/NO remains separate from predicted correctness.",
      batchRun: "Evaluate all candidates", batchCsv: "Export ranking CSV", batchTitle: "Candidate ranking", batchBack: "Back to candidate ranking", batchHint: "Batch classification evaluates both geometry and Logistic using the displayed lambda, threshold and positive class. It ignores the single-model rank and skips bootstrap. Evaluation labels are used for selection.",
      batchAccuracy: "Accuracy", batchSelective: "Accepted accuracy", batchCoverage: "Coverage", batchTrain: "Train", batchGeometry: "Geometry + rejection", batchLogistic: "Aux. Logistic", batchDefinitions: "Accuracy divides by all labelled samples, with rejection counted as incorrect. Coverage divides by all input samples. AUC/AP use the selected positive class.",
      sortMetric: "Rank by", minCoverage: "Minimum coverage (0–1)", methodFilter: "Prediction rule filter", allMethods: "All rules", inspect: "Inspect", previous: "Previous 100", next: "Next 100", batchFailed: "Failed / nonconverged", rankingEligible: "Eligible for this ranking", trainAccuracy: "Training accuracy", trainAuc: "Training AUC", trainAp: "Training AP", gapAccuracy: "Train − evaluation accuracy", scoreN: "Scored / labelled", batchProgress: "Candidate evaluations completed", batchExcluded: "Excluded entries remain below eligible rows; unavailable scores are not zero. Ties share a place and use SISSO rank for stable display.",
      rank: "Model rank", dataset: "Dataset", role: "Declared data role", method: "Prediction rule", geometry: "Training domains + rejection", logistic: "Descriptors + auxiliary logistic classifier",
      positive: "Positive / one-vs-rest class", threshold: "Binary probability threshold", lambda: "L2 penalty (mean loss)", tolerance: "Regression absolute tolerance (optional)",
      bootstrap: "Bootstrap replicates (0–2000)", seed: "Random seed", alpha: "Conformal error rate α", run: "Evaluate", cancel: "Cancel", computing: "Computing selected model…",
      pending: "Choose settings and select Evaluate. Changing settings clears old results.", csv: "Export sample CSV", json: "Export evaluation JSON", import: "Import prediction bundle JSON", native: "Use current SISSO run", external: "Imported predictions",
      importHint: "Advanced: import frozen predictions, disjoint calibration data or out-of-fold predictions. See the format guide.", format: "Prediction bundle format",
      protocol: "Training is an in-sample diagnosis. If you select a model, rule or threshold using verification labels, that set is validation data. An independent test set must be held out from these choices.",
      count: "Samples", labelled: "Labelled", accepted: "Accepted labelled", rejected: "Rejected labelled", valid: "Valid pairs", invalid: "Invalid pairs", probabilityN: "Probability evaluation rows",
      metrics: "Metrics", metric: "Metric", value: "Value", requires: "Requirement / unavailable reason", cm: "Confusion matrix", normalize: "Normalize by true class", trueClass: "True class → predicted class", abstain: "Rejected / invalid", perClass: "Per-class results", support: "Support",
      rows: "Sample decisions (first 100; export includes all)", id: "Sample", truth: "True", predicted: "Predicted", correct: "T / F", status: "Status", official: "Official YES / NO", residual: "Residual", score: "Positive-class score",
      definitions: "Accuracy uses all labelled rows: rejection counts as incorrect. Selective accuracy uses accepted labelled rows only. Recall and F1 penalize rejection. MCC treats rejection as an extra predicted category. Undefined metrics are shown as —.",
      rankNote: "ROC / PR use scores, independent of the chosen decision threshold. AP uses recall-weighted precision increments, not trapezoidal PR area. AUC and AP here are one-vs-rest for the chosen class.",
      rocMissing: "ROC / PR unavailable: provide finite continuous scores and both positive and negative labelled samples. Geometry rejection alone does not supply ranking scores.",
      residualTitle: "Residual vs predicted value", xAxis: "Residual plot horizontal axis", predictedAxis: "Predicted value", reliability: "Probability reliability (one-vs-rest)", probability: "Mean predicted probability", frequency: "Observed positive fraction", probabilityNote: "These are uncalibrated auxiliary probabilities or imported probabilities. Brier / log loss assess probability quality; the reliability plot diagnoses calibration. Binary Brier uses one positive-class probability; multiclass uses the sum over classes.",
      uncertainty: "95% conditional bootstrap intervals", intervalNote: "Frozen predictions are resampled with a fixed seed. These intervals do not include descriptor/model selection uncertainty. Grouped bundles resample groups; otherwise rows are assumed independent.",
      conformal: "Split conformal", conformalMissing: "Requires imported independent calibration predictions. This run does not invent a calibration split from training or verification data.", folds: "Imported fold results", foldNote: "Within-fold means the producer declares descriptor selection was rerun inside each fold. Fixed descriptors only assess the downstream fit. Import does not independently verify provenance.",
      manifest: "Reproducibility and assumptions", unavailableWorker: "Background evaluation could not start. Open the app through a local HTTP server, then retry (see the format guide).", error: "Evaluation failed: ",
      train: "Training / in-sample", validation: "Selection validation", test: "Held-out test (declared)", calibration: "Calibration", fold: "Out-of-fold",
      coverage: "Prediction / valid-pair coverage", accuracy: "Accuracy (all labelled)", selectiveAccuracy: "Accuracy (accepted only)", balancedAccuracy: "Balanced accuracy", macroF1: "Macro F1", mcc: "MCC (with rejection)", auc: "ROC AUC", ap: "Average precision", brier: "Brier score", logLoss: "Log loss",
      rmse: "RMSE", mae: "MAE", maxae: "Max AE", r2: "R²", rho: "Spearman ρ", medianAE: "Median AE", p90AE: "P90 AE", p95AE: "P95 AE", bias: "Mean residual", toleranceRate: "Tolerance hit rate", baselineSkill: "MSE skill vs training mean", domain: "Outside training feature ranges", domainNote: "Range checks are extrapolation flags, not proof of applicability. Missing / invalid features are counted separately. Metrics use finite pairs; compare models on a common cohort.",
      precision: "Precision", recall: "Recall", f1: "F1", tp: "TP", tn: "TN", fp: "FP", fn: "FN", rejectedPositive: "Rejected positive", rejectedNegative: "Rejected negative"
    },
    zh: {
      title: "后评价", back: "返回模型", intro: "评价所选模型，或在固定方案下批量筛选全部候选。SISSO 官方 YES/NO 与预测是否正确分开记录。",
      batchRun: "批量评价全部候选", batchCsv: "导出排名 CSV", batchTitle: "候选模型后评价排名", batchBack: "返回批量排名", batchHint: "分类批量评价同时运行几何规则和 Logistic，统一使用显示的正则化、阈值及正类；忽略单模型排名，不逐个运行 Bootstrap。本轮使用评价标签筛选模型。",
      batchAccuracy: "准确率", batchSelective: "已判定准确率", batchCoverage: "覆盖率", batchTrain: "训练", batchGeometry: "几何＋拒判", batchLogistic: "辅助 Logistic", batchDefinitions: "准确率以全部有标签样本为分母，拒判计为未正确；覆盖率以全部输入样本为分母；AUC/AP 使用所选正类。",
      sortMetric: "排序指标", minCoverage: "最低覆盖率（0–1）", methodFilter: "预测规则筛选", allMethods: "全部规则", inspect: "查看详情", previous: "上一页 100 条", next: "下一页 100 条", batchFailed: "失败 / 未收敛", rankingEligible: "符合本次排序条件", trainAccuracy: "训练准确率", trainAuc: "训练 AUC", trainAp: "训练 AP", gapAccuracy: "训练 − 评价准确率", scoreN: "有效分数 / 有标签", batchProgress: "已完成候选评价", batchExcluded: "不符合排序条件的条目保留在末尾，不可用指标不会当作零分。并列分数共享名次，按原 SISSO 排名稳定显示。",
      rank: "模型排名", dataset: "数据集", role: "声明的数据用途", method: "预测规则", geometry: "训练域判定 + 拒判", logistic: "描述符 + 辅助 Logistic 分类器",
      positive: "正类 / One-vs-rest 类别", threshold: "二分类概率阈值", lambda: "L2 惩罚系数（平均损失）", tolerance: "回归绝对容差（可选）", bootstrap: "Bootstrap 次数（0–2000）", seed: "随机种子", alpha: "Conformal 错误率 α", run: "开始评价", cancel: "取消", computing: "正在计算所选模型…",
      pending: "设置参数后点击“开始评价”。修改配置会清除旧结果。", csv: "导出逐样本 CSV", json: "导出评价 JSON", import: "导入预测数据 JSON", native: "使用当前 SISSO 结果", external: "外部预测数据",
      importHint: "进阶：导入固定模型预测、独立校准数据或折外预测。格式见说明文档。", format: "预测数据格式说明",
      protocol: "训练集用于拟合诊断。如果使用验证标签选择模型、判定规则或阈值，该数据集就是调参验证集。独立测试集必须未参与这些选择。",
      count: "总样本", labelled: "有标签", accepted: "已判定且有标签", rejected: "拒判且有标签", valid: "有效预测对", invalid: "无效预测对", probabilityN: "概率评价样本数",
      metrics: "评价指标", metric: "指标", value: "数值", requires: "所需条件 / 不可用原因", cm: "混淆矩阵", normalize: "按真实类别归一化", trueClass: "真实类别 → 预测类别", abstain: "拒判 / 无效", perClass: "各类别结果", support: "样本数",
      rows: "逐样本结果（前 100 条；导出包含全部）", id: "样本", truth: "真实值", predicted: "预测值", correct: "T / F", status: "判定状态", official: "官方 YES / NO", residual: "残差", score: "正类连续分数",
      definitions: "总体准确率以全部有标签样本为分母，拒判计为未正确。选择性准确率只统计已判定样本。Recall/F1 包含拒判损失。MCC 把拒判作为额外预测类别。未定义的指标显示为 —。",
      rankNote: "ROC/PR 使用连续分数，不随当前判定阈值改变。AP 按召回率增量加权，采用非梯形积分定义；这里显示所选类别的 One-vs-rest AUC 与 AP。",
      rocMissing: "ROC/PR 不可用：需要有限连续分数且同时含正负样本。仅有几何拒判结果不能产生有效的排序曲线。",
      residualTitle: "残差与预测值", xAxis: "残差图横轴", predictedAxis: "预测值", reliability: "概率可靠性（One-vs-rest）", probability: "平均预测概率", frequency: "实际正类比例", probabilityNote: "概率来自未经校准的辅助分类器或外部输入。Brier / Log loss 衡量概率质量，可靠性图诊断校准情况。二分类 Brier 使用单个正类概率，多分类使用各类平方误差之和。",
      uncertainty: "95% 条件 Bootstrap 区间", intervalNote: "使用固定种子重采样固定模型的预测，不包含描述符筛选和模型选择的不确定性。有完整 group 字段时按组重采样，否则假设样本独立。",
      conformal: "Split conformal 评价", conformalMissing: "需要导入独立校准集预测；不会把训练集或现有验证集自动当作独立校准集。", folds: "折外评价结果", foldNote: "within-fold 表示数据提供者声明每折重新筛选了描述符；fixed 仅评价固定描述符下的后续拟合。导入工具无法独立核实来源。",
      manifest: "复现信息与适用条件", unavailableWorker: "后台计算未能启动。请通过本地 HTTP 服务打开应用后重试，操作见格式说明。", error: "评价失败：",
      train: "训练 / 拟合诊断", validation: "调参验证", test: "独立测试（用户声明）", calibration: "校准", fold: "折外预测",
      coverage: "预测 / 有效对覆盖率", accuracy: "准确率（全部有标签）", selectiveAccuracy: "准确率（仅已判定）", balancedAccuracy: "平衡准确率", macroF1: "Macro F1", mcc: "MCC（包含拒判）", auc: "ROC AUC", ap: "Average precision", brier: "Brier 分数", logLoss: "Log loss",
      rmse: "RMSE", mae: "MAE", maxae: "Max AE", r2: "R²", rho: "Spearman ρ", medianAE: "绝对误差中位数", p90AE: "P90 绝对误差", p95AE: "P95 绝对误差", bias: "平均残差（偏差）", toleranceRate: "容差命中率", baselineSkill: "相对训练均值的 MSE 改善", domain: "超出训练特征范围", domainNote: "范围检查只提示外推，不能证明适用性。缺失或无效特征单独计数。误差指标统计有限预测对；比较模型时应使用相同样本集合。",
      precision: "Precision", recall: "Recall", f1: "F1", tp: "TP", tn: "TN", fp: "FP", fn: "FN", rejectedPositive: "正类拒判", rejectedNegative: "负类拒判"
    }
  };
  function t(key) { var lang = root.I18N.getLocale(); return (words[lang] || words.en)[key] || key; }
  function el(tag, text, cls) { var n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
  function number(v) { return v === null || v === undefined || !Number.isFinite(v) ? "—" : Number(v.toPrecision(6)).toString(); }
  function table(parent, headings, rows) {
    var wrap = el("div", undefined, "evaluation-scroll"), tab = el("table", undefined, "class-table"), head = el("thead"), hr = el("tr"), body = el("tbody");
    headings.forEach(function (h) { var th = el("th", h); th.scope = "col"; hr.appendChild(th); }); head.appendChild(hr); tab.appendChild(head);
    rows.forEach(function (r) { var tr = el("tr"); r.forEach(function (v) { var td = el("td"); if (v && typeof v === "object" && v.tagName) td.appendChild(v); else td.textContent = v === null || v === undefined ? "—" : String(v); tr.appendChild(td); }); body.appendChild(tr); });
    tab.appendChild(body); wrap.appendChild(tab); parent.appendChild(wrap); return wrap;
  }
  function button(parent, label, handler, primary) { var b = el("button", label, "btn " + (primary ? "btn--primary" : "btn--secondary")); b.type = "button"; b.addEventListener("click", handler); parent.appendChild(b); return b; }
  function note(parent, text) { parent.appendChild(el("p", text, "class-note")); }
  function close() {
    if (!active) return;
    var a = active; if (a.worker) a.worker.terminate();
    a.charts.forEach(function (c) { c.dispose(); });
    root.removeEventListener("resize", a.resize);
    a.hidden.forEach(function (r) { r.node.hidden = r.hidden; });
    a.activeNav.forEach(function (n) { n.classList.add("is-active"); });
    a.node.remove(); active = null;
    var b = document.getElementById("btn-evaluation"); if (b) { b.classList.remove("is-active"); b.removeAttribute("aria-current"); b.focus(); }
  }
  function download(name, text, mime) { var url = URL.createObjectURL(new Blob([text], { type: mime })), a = el("a"); a.href = url; a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  function open(result, saved, onChange) {
    close();
    var node = el("section", undefined, "view evaluation"), title = el("h1", t("title")); title.id = "evaluation-title"; node.setAttribute("aria-labelledby", title.id);
    var a = active = { result: result, saved: saved || {}, onChange: onChange, node: node, charts: [], worker: null, hidden: [], report: null };
    ["view-results", "view-classification", "view-upload"].forEach(function (id) { var n = document.getElementById(id); a.hidden.push({ node: n, hidden: n.hidden }); n.hidden = true; });
    a.activeNav = Array.from(document.querySelectorAll(".nav-item.is-active"));
    a.activeNav.forEach(function (n) { n.classList.remove("is-active"); });
    document.getElementById("main").appendChild(node); document.getElementById("btn-evaluation").classList.add("is-active");
    document.getElementById("btn-evaluation").setAttribute("aria-current", "page");
    a.resize = function () { a.charts.forEach(function (c) { c.resize(); }); }; root.addEventListener("resize", a.resize);
    var header = el("div", undefined, "class-header"); header.appendChild(title); button(header, t("back"), close); node.appendChild(header);
    note(node, t("intro")); note(node, t("protocol"));
    var savedConfig;
    try { savedConfig = E.config(a.saved.config); } catch (_) { savedConfig = E.config(); }
    a.config = savedConfig; a.bundle = a.saved.bundle || null;
    if (a.bundle) { try { E.validateBundle(a.bundle); } catch (_) { a.bundle = null; } }
    var advanced = el("details"), summary = el("summary", t("import")); advanced.appendChild(summary); note(advanced, t("importHint"));
    var link = el("a", t("format")); link.href = "docs/post-evaluation.md"; link.target = "_blank"; link.rel = "noopener"; advanced.appendChild(link);
    var file = el("input"); file.type = "file"; file.accept = ".json,application/json"; file.setAttribute("aria-label", t("import")); advanced.appendChild(file);
    var importError = el("p"); importError.setAttribute("role", "alert"); advanced.appendChild(importError);
    file.addEventListener("change", async function () {
      try { var f = file.files[0]; if (!f) return; if (f.size > 20 * 1024 * 1024) throw new Error("Maximum bundle size: 20 MiB.");
        var bundle = E.validateBundle(JSON.parse(await f.text())); if (active !== a) return;
        a.bundle = bundle; a.config.dataset = bundle.datasets[0].id; importError.textContent = ""; buildControls(); invalidate(); save();
      } catch (e) { importError.textContent = e.message; }
    });
    button(advanced, t("native"), function () { a.bundle = null; a.config.dataset = result.verify ? "verify" : "train"; buildControls(); invalidate(); save(); }); node.appendChild(advanced);
    var controls = el("div", undefined, "evaluation-controls"), actions = el("div", undefined, "class-controls"), status = el("p", t("pending"), "class-note"), output = el("div");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); node.appendChild(controls); node.appendChild(actions); node.appendChild(status); node.appendChild(output);
    var run = button(actions, t("run"), runJob, true), batchRun = button(actions, t("batchRun") + " (" + result.models.length + ")", function () { runJob(true); });
    var cancel = button(actions, t("cancel"), function () { invalidate(); }); cancel.hidden = true;
    var csv = button(actions, t("csv"), function () { if (a.report) download(a.report.kind ? "sisso-candidate-ranking.csv" : "sisso-evaluation-samples.csv", "\uFEFF" + (a.report.kind ? B.csv(a.report, a.config.batchRanking) : E.csv(a.report)), "text/csv;charset=utf-8"); }); csv.disabled = true;
    var json = button(actions, t("json"), function () { if (a.report) download("sisso-evaluation.json", JSON.stringify(a.report.kind ? Object.assign({}, a.report, { ranking: a.config.batchRanking }) : a.report, null, 2), "application/json"); }); json.disabled = true;
    var backBatch = button(actions, t("batchBack"), function () { var r = a.batchReport; if (r) { invalidate(true); show(r); } }); backBatch.hidden = true;
    function save() { a.onChange({ config: Object.assign({}, a.config), bundle: a.bundle }); }
    function invalidate(keepBatch) {
      if (a.worker) a.worker.terminate(); a.worker = null; a.report = null;
      if (!keepBatch) a.batchReport = null;
      a.charts.forEach(function (c) { c.dispose(); }); a.charts = []; output.textContent = ""; status.textContent = t("pending"); run.disabled = false; batchRun.disabled = !!a.bundle; cancel.hidden = true; backBatch.hidden = true; csv.disabled = json.disabled = true;
    }
    function field(key, options, type) {
      var label = el("label", undefined, "evaluation-field"); label.appendChild(el("span", t(key)));
      var input = el(options ? "select" : "input", undefined, "select");
      if (options) options.forEach(function (pair) { var o = el("option", pair[1]); o.value = String(pair[0]); input.appendChild(o); });
      else { input.type = "number"; input.step = type === "integer" ? "1" : "any"; }
      input.value = a.config[key] === null || a.config[key] === undefined ? "" : String(a.config[key]);
      if (options && !options.some(function (o) { return String(o[0]) === input.value; })) { input.value = String(options[0][0]); a.config[key] = options[0][0]; }
      a.fields[key] = function () { a.config[key] = options && type !== "integer" ? input.value : input.value === "" ? null : Number(input.value); };
      input.addEventListener(options ? "change" : "input", function () {
        a.fields[key]();
        if (key === "dataset") { a.config.role = input.value === "train" || /^t\d+$/.test(input.value) ? "train" : "validation"; buildControls(); }
        if (key === "method") buildControls(); invalidate(); save();
      }); label.appendChild(input); controls.appendChild(label); return input;
    }
    function buildControls() {
      controls.textContent = "";
      a.fields = {};
      batchRun.disabled = !!a.bundle;
      var task = a.bundle ? a.bundle.taskType : result.taskType || "regression", classes = a.bundle ? a.bundle.classes : result.classes;
      if (!a.bundle) { if (!a.config.rank) a.config.rank = result.models[0].rank; field("rank", null, "integer"); }
      var datasets = a.bundle ? a.bundle.datasets.map(function (d) { return [d.id, d.id + " · " + t(d.role)]; }) : Core.availableDatasets(result).map(function (d) { return [d, d]; });
      field("dataset", datasets);
      var inSample = !a.bundle && (a.config.dataset === "train" || /^t\d+$/.test(a.config.dataset));
      if (inSample) a.config.role = "train";
      if (!a.bundle) field("role", (inSample ? ["train"] : ["validation", "test", "calibration"]).map(function (r) { return [r, t(r)]; })).disabled = inSample;
      if (task === "classification") {
        if (!a.bundle) field("method", [["geometry", t("geometry")], ["logistic", t("logistic")]]);
        field("positiveClass", classes.map(function (c, i) { return [i, c]; }), "integer");
        // The displayed label differs from the persisted config key.
        controls.lastChild.firstChild.textContent = t("positive");
        if (!a.bundle) { if (classes.length === 2) field("threshold"); field("lambda"); }
      } else field("tolerance");
      field("bootstrap", null, "integer"); field("seed", null, "integer"); if (a.bundle) field("alpha");
    }
    function show(r) {
      a.report = r; csv.disabled = json.disabled = false;
      csv.textContent = t(r.kind === "sisso-batch-evaluation" ? "batchCsv" : "csv");
      if (r.kind === "sisso-batch-evaluation") {
        a.batchReport = r; backBatch.hidden = true; status.textContent = t("batchProgress") + ": " + r.manifest.completed + " / " + r.manifest.total;
        renderBatch(r, output, function (entry) { a.config.rank = entry.rank; a.config.method = entry.method === "regression" ? "geometry" : entry.method; buildControls(); runJob(); });
      } else { backBatch.hidden = !a.batchReport; status.textContent = r.manifest.method; renderReport(r, output); }
    }
    function runJob(batchMode) {
      batchMode = batchMode === true;
      invalidate(true);
      try {
        Object.keys(a.fields).forEach(function (key) { a.fields[key](); });
        var c = E.config(a.config), job;
        if (batchMode && a.bundle) throw new Error("Batch screening needs the current SISSO candidate models.");
        if (batchMode) job = { batch: true, result: { taskType: result.taskType, classes: result.classes, train: result.train, verify: result.verify, tasks: result.tasks, meta: result.meta, columns: result.columns, models: result.models }, config: c };
        else if (a.bundle) job = { bundle: a.bundle, datasetId: c.dataset, config: c };
        else {
          var model = result.models.find(function (m) { return m.rank === Number(c.rank); }); if (!model) throw new Error("Model rank does not exist.");
          // Do not clone the other 4999 models or their predictions into the worker.
          job = { result: { taskType: result.taskType, classes: result.classes, train: result.train, verify: result.verify, tasks: result.tasks, meta: result.meta, columns: result.columns }, model: model, config: c };
        }
        var worker = a.worker = new Worker("js/evaluation-worker.js"); run.disabled = batchRun.disabled = true; cancel.hidden = false; status.textContent = t("computing"); save();
        worker.onmessage = function (ev) {
          if (active !== a || a.worker !== worker) return;
          if (ev.data.stage) { status.textContent = ev.data.progress ? t("batchProgress") + ": " + ev.data.progress.completed + " / " + ev.data.progress.total : t("computing"); return; }
          a.worker.terminate(); a.worker = null; run.disabled = false; batchRun.disabled = !!a.bundle; cancel.hidden = true;
          if (ev.data.error) { status.textContent = t("error") + ev.data.error; return; }
          show(ev.data.report);
        };
        worker.onerror = function () { if (active === a && a.worker === worker) { invalidate(); status.textContent = t("unavailableWorker"); } };
        a.worker.postMessage(job);
      } catch (e) { invalidate(); status.textContent = t("error") + e.message; }
    }
    buildControls(); if (!a.bundle) note(node, t("batchHint")); title.tabIndex = -1; title.focus();
  }
  function renderBatch(r, parent, inspect) {
    var a = active, state = Object.assign({ metric: r.taskType === "classification" ? "accuracy" : "rmse", method: "all", minCoverage: 0 }, a.config.batchRanking || {}), page = 0;
    a.config.batchRanking = state;
    parent.appendChild(el("h2", t("batchTitle"))); note(parent, t("batchDefinitions")); note(parent, t("batchExcluded"));
    var controls = el("div", undefined, "evaluation-controls"), summary = el("p", undefined, "class-note"), body = el("div"), pager = el("div", undefined, "class-controls");
    parent.appendChild(controls); parent.appendChild(summary); parent.appendChild(body); parent.appendChild(pager);
    function field(key, label, choices) {
      var wrap = el("label", undefined, "evaluation-field"), input = el(choices ? "select" : "input", undefined, "select"); wrap.appendChild(el("span", label));
      if (choices) choices.forEach(function (p) { var option = el("option", p[1]); option.value = p[0]; input.appendChild(option); });
      else { input.type = "number"; input.min = "0"; input.max = "1"; input.step = "0.05"; }
      input.value = String(state[key]); input.addEventListener(choices ? "change" : "input", function () {
        state[key] = choices ? input.value : Number(input.value); page = 0; draw(); a.onChange({ config: Object.assign({}, a.config), bundle: a.bundle });
      }); wrap.appendChild(input); controls.appendChild(wrap);
    }
    var keys = r.taskType === "classification" ? ["accuracy", "coverage", "auc", "ap", "selectiveAccuracy", "balancedAccuracy", "macroF1", "mcc", "brier", "logLoss"] : ["rmse", "mae", "r2", "p95AE", "coverage", "baselineSkill"];
    if (keys.indexOf(state.metric) < 0) state.metric = keys[0];
    field("metric", t("sortMetric"), keys.map(function (k) { return [k, t(k)]; }));
    field("method", t("methodFilter"), [["all", t("allMethods")]].concat(r.manifest.methods.map(function (m) { return [m, t(m)]; })));
    field("minCoverage", t("minCoverage"));
    var previous = button(pager, t("previous"), function () { page--; draw(); }), pageText = el("span"); pager.appendChild(pageText);
    var next = button(pager, t("next"), function () { page++; draw(); });
    function draw() {
      body.textContent = "";
      var ranking;
      try { ranking = B.rankRows(r, state); } catch (error) { summary.textContent = error.message; return; }
      summary.textContent = t("rankingEligible") + ": " + ranking.eligible + " / " + ranking.total + " · " + t("batchFailed") + ": " + r.manifest.errors + " / " + r.manifest.nonconverged;
      var pages = Math.max(1, Math.ceil(ranking.total / 100)); page = Math.max(0, Math.min(page, pages - 1));
      previous.disabled = page === 0; next.disabled = page === pages - 1; pageText.textContent = (page + 1) + " / " + pages;
      var metrics = r.taskType === "classification" ? ["accuracy", "coverage", "auc", "ap", "selectiveAccuracy"] : ["rmse", "mae", "r2", "p95AE", "coverage"];
      var trainKeys = r.taskType === "classification" ? ["accuracy", "auc", "ap"] : ["rmse", "mae", "r2"];
      function heading(k) { return k === "accuracy" ? t("batchAccuracy") : k === "coverage" ? t("batchCoverage") : k === "selectiveAccuracy" ? t("batchSelective") : k === "ap" ? "AP" : t(k); }
      var scroll = table(body, ["#", "SISSO #", t("method")].concat(metrics.map(heading), trainKeys.map(function (k) { return t("batchTrain") + " " + heading(k); }), [t("status"), t("scoreN"), t("inspect")]), ranking.rows.slice(page * 100, (page + 1) * 100).map(function (entry) {
        var row = entry.row, cell = el("button", t("inspect"), "btn btn--secondary btn--sm"); cell.type = "button"; cell.disabled = row.status === "error";
        cell.title = row.descriptors.join("; "); cell.addEventListener("click", function () { inspect(row); });
        return [entry.place === null ? "—" : entry.place, row.rank, row.method === "geometry" ? t("batchGeometry") : row.method === "logistic" ? t("batchLogistic") : row.method].concat(metrics.map(function (k) { return number(row.evaluation && row.evaluation[k]); }), trainKeys.map(function (k) { return number(row.train && row.train[k]); }), [row.error || row.status, row.evaluation ? row.evaluation.scoreN + " / " + (row.evaluation.labelled || 0) : "—", cell]);
      }));
      scroll.classList.add("evaluation-batch-table");
    }
    draw();
    var manifest = el("details"); manifest.appendChild(el("summary", t("manifest"))); manifest.appendChild(el("pre", JSON.stringify({ config: r.config, manifest: r.manifest }, null, 2))); parent.appendChild(manifest);
  }
  function chart(parent, title, data, xName, yName, type, baseline, step) {
    var box = el("div", undefined, "evaluation-plot"), heading = el("h3", title), canvas = el("div", undefined, "class-chart");
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", title); box.appendChild(heading); box.appendChild(canvas); parent.appendChild(box);
    var instance = root.echarts.init(canvas), style = getComputedStyle(document.documentElement), color = style.getPropertyValue("--color-train").trim(), text = style.getPropertyValue("--color-text").trim();
    instance.setOption({ animation: false, textStyle: { color: text }, tooltip: { trigger: "item" }, grid: { left: 65, right: 30, top: 40, bottom: 65 },
      xAxis: { type: "value", name: xName, nameLocation: "middle", nameGap: 40, axisLabel: { color: text } },
      yAxis: { type: "value", name: yName, axisLabel: { color: text } },
      series: [{ type: type || "line", data: data, symbolSize: 5, showSymbol: type === "scatter", step: step || false, itemStyle: { color: color } }].concat(baseline ? [{ type: "line", data: baseline, symbol: "none", lineStyle: { type: "dashed", color: text }, silent: true }] : []) });
    active.charts.push(instance); return box;
  }
  function renderReport(r, parent) {
    var a = active, m = r.metrics;
    parent.appendChild(el("h2", t("metrics")));
    var countKeys = r.taskType === "classification" ? ["n", "labelled", "accepted", "rejected", "probabilityN"] : ["n", "valid", "invalid"];
    table(parent, countKeys.map(function (k) { return t(k === "n" ? "count" : k); }), [countKeys.map(function (k) { return number(m[k]); })]);
    table(parent, [t("metric"), t("value"), t("requires")], E.registry.filter(function (meta) { return meta.task === r.taskType || meta.task === "both"; }).map(function (meta) { return [t(meta.key), number(m[meta.key]), m[meta.key] === null ? meta.requires : ""]; }));
    if (r.taskType === "classification") {
      note(parent, t("definitions")); parent.appendChild(el("h2", t("cm")));
      var label = el("label", undefined, "evaluation-check"), toggle = el("input"); toggle.type = "checkbox"; label.appendChild(toggle); label.appendChild(el("span", t("normalize"))); parent.appendChild(label);
      var matrix = el("div"); parent.appendChild(matrix);
      function drawMatrix() { matrix.textContent = ""; table(matrix, [t("trueClass")].concat(r.classes, [t("abstain")]), (toggle.checked ? m.normalized : m.confusion).map(function (row, i) { return [r.classes[i]].concat(row.map(number)); })); }
      toggle.addEventListener("change", drawMatrix); drawMatrix();
      if (m.binary) table(parent, Object.keys(m.binary).map(t), [Object.values(m.binary).map(number)]);
      parent.appendChild(el("h3", t("perClass")));
      table(parent, [t("trueClass"), t("support"), t("precision"), t("recall"), t("f1")], m.perClass.map(function (p) { return [r.classes[p.classIndex], p.support, number(p.precision), number(p.recall), number(p.f1)]; }));
      var ranking = m.ranking[r.config.positiveClass], plots = el("div", undefined, "evaluation-plots"); parent.appendChild(plots);
      if (ranking && ranking.available) {
        chart(plots, "ROC · AUC " + number(ranking.auc) + " · n=" + ranking.n, ranking.roc, "FPR", "TPR", "line", [[0, 0], [1, 1]]);
        chart(plots, "Precision–Recall · AP " + number(ranking.ap), ranking.pr, "Recall", "Precision", "line", [[0, ranking.prevalence], [1, ranking.prevalence]], "start"); note(parent, t("rankNote"));
      } else note(parent, t("rocMissing"));
      if (m.probabilityN) {
        chart(parent, t("reliability"), m.reliability.filter(function (b) { return b.n; }).map(function (b) { return [b.probability, b.frequency, b.n]; }), t("probability"), t("frequency"), "scatter", [[0, 0], [1, 1]]);
        table(parent, ["Bin", "n", t("probability"), t("frequency")], m.reliability.map(function (b) { return [b.lower + "–" + b.upper, b.n, number(b.probability), number(b.frequency)]; })); note(parent, t("probabilityNote"));
      }
    } else {
      var plot = el("div"), field = el("label", t("xAxis"), "evaluation-field"), select = el("select", undefined, "select");
      var options = [["prediction", t("predictedAxis")]];
      if (!a.bundle) {
        var data = Core.datasetData(a.result, r.config.dataset);
        Object.keys(data.cols).filter(function (key) { return key !== a.result.meta.targetLetter && typeof data.cols[key][0] === "number"; }).forEach(function (key) {
          var column = (a.result.columns || []).find(function (c) { return c.letter === key; });
          options.push([key, column ? column.original + " (" + key + ")" : key]);
        });
      }
      options.forEach(function (pair) { var o = el("option", pair[1]); o.value = pair[0]; select.appendChild(o); }); select.value = "prediction"; field.appendChild(select); parent.appendChild(field); parent.appendChild(plot);
      var residualChart = null;
      function drawResidual() {
        if (residualChart) { residualChart.dispose(); a.charts = a.charts.filter(function (c) { return c !== residualChart; }); } plot.textContent = "";
        var pairs = r.rows.map(function (row, i) { return [select.value === "prediction" ? row.yPred : data.cols[select.value][i], row.residual]; }).filter(function (p) { return p.every(Number.isFinite); });
        chart(plot, t("residualTitle"), pairs, select.value === "prediction" ? t("predictedAxis") : select.value, t("residual"), "scatter"); residualChart = a.charts[a.charts.length - 1];
      }
      select.addEventListener("change", drawResidual); drawResidual();
      if (r.applicability) { parent.appendChild(el("h3", t("domain"))); table(parent, [t("count"), t("domain"), t("invalid")], [[r.rows.length, r.applicability.outside, r.applicability.invalid]]); }
      note(parent, t("domainNote"));
    }
    if (r.uncertainty) {
      parent.appendChild(el("h2", t("uncertainty"))); note(parent, t("intervalNote"));
      if (r.uncertainty.intervals) table(parent, [t("metric"), "2.5%", "97.5%", "Valid replicates"], Object.entries(r.uncertainty.intervals).map(function (pair) { return [t(pair[0]), number(pair[1].low), number(pair[1].high), pair[1].validReplicates + " / " + r.uncertainty.repeats]; }));
      else note(parent, r.uncertainty.unavailable);
    }
    parent.appendChild(el("h2", t("conformal")));
    if (r.conformal && r.conformal.available) { table(parent, ["α", "Calibration n", "Coverage", "Evaluated n", "Width", "Mean set size", "Unbounded"], [[r.conformal.alpha, r.conformal.calibrationN, number(r.conformal.coverage), r.conformal.evaluatedN, number(r.conformal.width), number(r.conformal.meanSetSize), r.conformal.unbounded]]); note(parent, r.conformal.assumption); }
    else note(parent, r.conformal ? r.conformal.reason : t("conformalMissing"));
    if (r.folds && r.folds.length) {
      parent.appendChild(el("h2", t("folds"))); note(parent, t("foldNote"));
      var keys = r.taskType === "classification" ? ["accuracy", "macroF1", "auc", "ap"] : ["rmse", "mae", "r2"];
      table(parent, ["Fold", "Descriptor selection"].concat(keys.map(t)), r.folds.map(function (f) { return [f.id, f.descriptorSelection].concat(keys.map(function (k) { return number(f.metrics[k]); })); }));
    }
    var details = el("details"), summary = el("summary", t("rows")); details.appendChild(summary); parent.appendChild(details);
    var classTask = r.taskType === "classification";
    table(details, [t("id"), t("truth"), t("predicted"), classTask ? t("correct") : t("residual"), t("status"), classTask ? t("official") : "Baseline", classTask ? t("score") : "Domain"], r.rows.slice(0, 100).map(function (row) {
      return [row.id, classTask ? r.classes[row.yTrue] : number(row.yTrue), classTask ? r.classes[row.yPred] : number(row.yPred), classTask ? (row.correct === null ? "—" : row.correct ? "T" : "F") : number(row.residual), row.status,
        classTask ? row.officialClassified : number(row.baseline), classTask ? number(row.scores && row.scores[r.config.positiveClass]) : row.domain];
    }));
    var manifest = el("details"); manifest.appendChild(el("summary", t("manifest"))); manifest.appendChild(el("pre", JSON.stringify({ config: r.config, manifest: r.manifest }, null, 2))); parent.appendChild(manifest);
  }
  root.SissoEvaluationUI = { open: open, close: close, isOpen: function () { return !!active; } };
})(typeof self !== "undefined" ? self : this);
