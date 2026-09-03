/*
 * i18n.js — Chinese / English UI strings.
 *
 * Usage: I18N.t(key) returns the string for the current locale.
 *        I18N.setLocale('en' | 'zh') switches and persists to localStorage.
 */
(function (root) {
  "use strict";

  var strings = {
    en: {
      appTitle: "SISSO-Analyzer",
      appSubtitle: "Interactive analyzer for SISSO regression results",

      // theme
      themeLight: "Light theme",
      themeDark: "Dark theme",
      themeSystem: "Follow system theme",

      // cite & author
      citeTitle: "Cite SISSO",
      citeIntro: "If this tool helps your research, please cite SISSO:",
      citeCopy: "Copy citation",
      citeCopied: "Copied",
      contactAuthor: "Contact author",

      // upload
      uploadTitle: "Load SISSO results",
      uploadHint: "Drop the result files, a whole folder, or a .zip / .tar.gz archive here — or click to browse.",
      browseFiles: "Browse files",
      browseFolder: "Select folder",
      required: "required",
      optional: "optional",
      fileTrain: "train.dat",
      fileVerify: "verify.dat",
      fileTop: "top-D file (top*D00*)",
      fileCoeff: "coefficient file (*_coeff)",
      fileUspace: "Uspace.expressions",
      fileSissoIn: "SISSO.in (run settings)",
      missingFiles: "Missing required files:",
      verifyOptionalNote: "verify.dat is optional — if omitted, only train metrics are shown.",
      run: "Analyze",
      analyzing: "Analyzing…",
      rendering: "Rendering models…",
      stepReading: "Reading files…",
      stepParsing: "Parsing SISSO outputs…",
      stepEvaluating: "Evaluating {n} models…",
      reset: "Load new results",

      // project save / load
      saveProject: "Save project",
      loadProject: "Load project…",
      savedOk: "Project saved",
      loadedOk: "Project loaded",
      savedFileOnly: "Saved as file — browser storage unavailable; reopen it with “Load project…”",
      errProject: "Invalid or unsupported project file",
      recentTitle: "Saved projects",
      recentEmpty: "No saved projects yet — open results and click “Save project” to keep them here.",
      recentOpen: "Open",
      recentDelete: "Delete",
      recentMeta: "{n} models · {time}",
      projectFromSissoIn: "from SISSO.in",
      complexityEstimated: "estimated from model features",

      // status
      inSampleWarning:
        "verify.dat is identical to train.dat — verify metrics are in-sample, not out-of-sample.",

      // KPI
      kpiModels: "Models",
      kpiTrain: "Train samples",
      kpiVerify: "Verify samples",
      kpiFeatures: "Features",
      kpiDim: "Dimension",
      kpiComplexity: "Complexity",
      kpiTopRho: "Best ρ",

      // controls
      sortBy: "Sort by",
      sortRank: "Rank",
      sortRMSE: "RMSE",
      sortMaxAE: "MaxAE",
      sortR2: "R²",
      sortRho: "Spearman ρ",
      asc: "Ascending",
      desc: "Descending",
      topN: "Show",
      loadAll: "Load all",
      loadedCount: "Showing {shown} of {total} models",
      viewTable: "Table",
      viewGrid: "Thumbnails",
      exportCsv: "Export CSV",
      exported: "models.csv exported",

      // table
      colRank: "Rank",
      colFormula: "Model formula",
      colFeatures: "Feature ids",
      colTrain: "Train",
      colVerify: "Verify",
      colActions: "Actions",
      view: "View",
      metricRMSE: "RMSE",
      metricMaxAE: "MaxAE",
      metricR2: "R²",
      metricRho: "ρ",
      noVerify: "—",

      // detail
      detailRank: "Model",
      detailFormula: "Formula",
      detailMetrics: "Fit statistics",
      detailCopy: "Copy formula",
      copied: "Copied",
      detailChartTitle: "Predicted vs true",
      detailTrain: "Train",
      detailVerify: "Verify",
      detailIdentity: "y = x",
      detailPointTitle: "Sample",
      detailPointClose: "Close",
      detailFeatureValues: "Feature values ({n})",
      detailPredicted: "Predicted",
      detailTrue: "True",
      detailError: "Error",
      detailEmpty: "Select a model to see its fit plot.",
      detailBack: "Back to list",
      detailExportPng: "Save PNG",

      // errors
      errParse: "Failed to analyze the files.",
      errNoTrain: "train.dat is required.",
      errUnknown: "Something went wrong.",

      // empty states
      emptyGrid: "No models to display.",
      emptyChart: "No data.",

      // a11y
      closeDialog: "Close",
    },
    zh: {
      appTitle: "SISSO-Analyzer",
      appSubtitle: "SISSO 回归结果的交互式分析工具",

      themeLight: "浅色主题",
      themeDark: "深色主题",
      themeSystem: "跟随系统主题",

      citeTitle: "引用 SISSO",
      citeIntro: "如果本工具对您的研究有帮助，请引用 SISSO：",
      citeCopy: "复制引用",
      citeCopied: "已复制",
      contactAuthor: "联系作者",

      uploadTitle: "载入 SISSO 结果",
      uploadHint: "将结果文件、整个文件夹或 .zip / .tar.gz 压缩包拖到这里，或点击浏览。",
      browseFiles: "浏览文件",
      browseFolder: "选择目录",
      required: "必填",
      optional: "可选",
      fileTrain: "train.dat",
      fileVerify: "verify.dat",
      fileTop: "top-D 文件（top*D00*）",
      fileCoeff: "系数文件（*_coeff）",
      fileUspace: "Uspace.expressions",
      fileSissoIn: "SISSO.in（运行设置）",
      missingFiles: "缺少必填文件：",
      verifyOptionalNote: "verify.dat 为可选——若省略，只展示训练集指标。",
      run: "开始分析",
      analyzing: "分析中…",
      rendering: "正在渲染模型…",
      stepReading: "正在读取文件…",
      stepParsing: "正在解析 SISSO 输出…",
      stepEvaluating: "正在评估 {n} 个模型…",
      reset: "载入新结果",

      saveProject: "保存项目",
      loadProject: "载入项目…",
      savedOk: "项目已保存",
      loadedOk: "项目已载入",
      savedFileOnly: "仅保存为文件——浏览器本地存储不可用，之后可用“载入项目…”打开",
      errProject: "无效或不受支持的项目文件",
      recentTitle: "已保存的项目",
      recentEmpty: "还没有保存的项目——先分析结果，再点“保存项目”即可存到这里。",
      recentOpen: "打开",
      recentDelete: "删除",
      recentMeta: "{n} 个模型 · {time}",
      projectFromSissoIn: "来自 SISSO.in",
      complexityEstimated: "按模型特征估算",

      inSampleWarning:
        "verify.dat 与 train.dat 完全相同——verify 指标为样本内结果，并非留出验证。",

      kpiModels: "模型数",
      kpiTrain: "训练样本",
      kpiVerify: "验证样本",
      kpiFeatures: "特征数",
      kpiDim: "维度",
      kpiComplexity: "复杂度",
      kpiTopRho: "最佳 ρ",

      sortBy: "排序依据",
      sortRank: "排名",
      sortRMSE: "RMSE",
      sortMaxAE: "MaxAE",
      sortR2: "R²",
      sortRho: "Spearman ρ",
      asc: "升序",
      desc: "降序",
      topN: "显示",
      loadAll: "加载全部",
      loadedCount: "当前显示 {shown} / {total} 个模型",
      viewTable: "表格",
      viewGrid: "缩略图",
      exportCsv: "导出 CSV",
      exported: "已导出 models.csv",

      colRank: "排名",
      colFormula: "模型公式",
      colFeatures: "特征编号",
      colTrain: "训练",
      colVerify: "验证",
      colActions: "操作",
      view: "查看",
      metricRMSE: "RMSE",
      metricMaxAE: "MaxAE",
      metricR2: "R²",
      metricRho: "ρ",
      noVerify: "—",

      detailRank: "模型",
      detailFormula: "公式",
      detailMetrics: "拟合统计",
      detailCopy: "复制公式",
      copied: "已复制",
      detailChartTitle: "预测值 vs 真实值",
      detailTrain: "训练集",
      detailVerify: "验证集",
      detailIdentity: "y = x",
      detailPointTitle: "样本",
      detailPointClose: "关闭",
      detailFeatureValues: "特征值（{n}）",
      detailPredicted: "预测值",
      detailTrue: "真实值",
      detailError: "误差",
      detailEmpty: "选择一个模型查看其拟合散点图。",
      detailBack: "返回列表",
      detailExportPng: "保存 PNG",

      errParse: "分析文件失败。",
      errNoTrain: "需要 train.dat。",
      errUnknown: "出现错误。",

      emptyGrid: "没有可显示的模型。",
      emptyChart: "无数据。",

      closeDialog: "关闭",
    },
  };

  var locale = "en";
  try {
    var saved = root.localStorage && root.localStorage.getItem("sisso-locale");
    if (saved === "en" || saved === "zh") locale = saved;
  } catch (e) { /* ignore */ }

  var I18N = {
    setLocale: function (l) {
      locale = l === "zh" ? "zh" : "en";
      try {
        root.localStorage && root.localStorage.setItem("sisso-locale", locale);
      } catch (e) { /* ignore */ }
    },
    getLocale: function () { return locale; },
    t: function (key) {
      return (strings[locale] && strings[locale][key]) || strings.en[key] || key;
    },
    format: function (key, params) {
      var s = I18N.t(key);
      Object.keys(params || {}).forEach(function (k) {
        s = s.replace("{" + k + "}", params[k]);
      });
      return s;
    },
  };

  root.I18N = I18N;
})(typeof self !== "undefined" ? self : this);
