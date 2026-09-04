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
      fileSissoOut: "SISSO.out (unit matrix)",
      missingFiles: "Missing required files:",
      verifyOptionalNote: "verify.dat is optional — if omitted, only train metrics are shown.",
      run: "Analyze",
      analyzing: "Analyzing…",
      rendering: "Rendering models…",

      // example demo (built-in run, no upload needed)
      demoTitle: "No data handy? Try the example model",
      demoBtn: "Load example model",
      demoLoading: "Loading…",
      demoErr: "The example model could not be loaded.",
      stepReading: "Reading files…",
      stepParsing: "Parsing SISSO outputs…",
      stepEvaluating: "Evaluating {n} models…",
      reset: "Load new results",
      navHome: "Load results",

      // project save / load
      saveProject: "Save project",
      loadProject: "Load project…",
      savedOk: "Project saved",
      loadedOk: "Project loaded",
      savedFileOnly: "Saved as file — browser storage unavailable; reopen it with “Load project…”",
      errProject: "Invalid or unsupported project file",
      recentTitle: "Saved projects",
      recentEmpty: "No saved projects here yet — they are stored per browser & address, and every analysis is added here automatically.",
      recentUnavailable: "Browser storage is unavailable here, so saved projects cannot be kept in this browser.",
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
      kpiTrain: "train samples",
      kpiVerify: "verify samples",
      kpiFeatures: "Features",
      kpiDim: "Dimension",
      kpiComplexity: "Complexity",
      kpiTopRho: "Best ρ",

      // controls
      sortBy: "Sort by",
      sortDir: "Sort direction",
      sortRank: "Rank",
      sortRMSE: "RMSE",
      sortMaxAE: "MaxAE",
      sortR2: "R²",
      sortRho: "Spearman ρ",
      asc: "Ascending",
      desc: "Descending",
      topN: "Show",
      loadAll: "Load all",
      loadTop: "Show top 100",
      loadAllTitle: "Show every filtered model",
      loadTopTitle: "Show only the first 100 sorted models",
      loadedCount: "Showing {shown} of {total} models",
      viewTable: "Table",
      viewGrid: "Thumbnails",
      viewPareto: "Pareto",
      viewUnits: "Units",
      paretoX: "train metric (X)",
      paretoY: "verify metric (Y)",
      paretoNote: "Click a point or row to open that model.",
      paretoCount: "{n} Pareto-optimal models",
      paretoCountFiltered: "{n} Pareto-optimal · {m} of {t} match the filter",
      paretoGhost: "Filtered out",
      paretoGhostNote: "filtered out — excluded from the Pareto front",
      paretoRequireVerify: "Pareto view needs verify.dat",
      paretoAll: "All models",
      paretoFront: "Pareto front",
      paretoZ: "Third metric (Z)",
      paretoMode2D: "2D",
      paretoMode3D: "3D",
      exportCsv: "Export CSV",
      exported: "models.csv exported",
      toolbarSort: "Sort & filter",
      toolbarView: "View",
      toolbarData: "Data",
      paretoControlsLabel: "Axes & mode",
      sideSummary: "Run summary",
      sideView: "View",

      // units / dimension view
      unitsTitle: "Dimension groups",
      unitsHint:
        "Each train.dat feature column carries a unit vector printed in SISSO.out. " +
        "Columns sharing the same vector belong to the same dimension group and share a colour — " +
        "the same colour marks the same dimension in every model formula.",
      unitsEmpty:
        "No dimension info: SISSO.out was not loaded. Add it to the result files and analyse again.",
      unitsRequireOut: "Units view needs SISSO.out — load it with the result files.",
      unitsGroupName: "Unit group {n}",
      unitsDimless: "Dimensionless",
      unitsGroupMeta: "train columns {range} · {n} features",
      unitsVector: "unit vector",
      unitsVectorTitle: "Unit vector on the SISSO unit basis (see funit= in SISSO.in)",

      // table
      colRank: "Rank",
      colFormula: "Model formula",
      colFeatures: "Feature ids",
      colTrain: "train",
      colVerify: "verify",
      colActions: "Actions",
      view: "View",
      metricRMSE: "RMSE",
      metricMaxAE: "MaxAE",
      metricR2: "R²",
      metricRho: "ρ",
      noVerify: "—",

      // table toolbar: columns & filter
      colsBtn: "Columns",
      colsIntro: "Show or hide table columns",
      colsReset: "Reset columns",
      filterBtn: "Filter",
      filterMetrics: "Metric ranges",
      filterGroups: "Unit groups (features)",
      filterModeAny: "any",
      filterModeOnly: "only",
      filterModeHint: "Inclusive features: any = formula contains at least one kept feature · only = formula uses nothing but kept features. Excluded features are always forbidden.",
      filterGroupAllIn: "Keep all",
      filterGroupAllOut: "Drop all",
      filterKeep: "Keep",
      filterDrop: "Drop",
      filterInCount: "{n} kept",
      filterOutCount: "{n} dropped",
      filterRulesCount: "{n} range",
      filterRulesCountPlural: "{n} ranges",
      filterApply: "Apply filters",
      filterPanelHint:
        "Choose any number of criteria below — the table updates once, when you press Apply.",
      filterMin: "min",
      filterMax: "max",
      filterClear: "Clear filters",
      sortByCol: "Sort by {col}",
      loadedFilteredCount: "Showing {shown} of {total} models ({all} in total)",

      // detail
      detailRank: "Model",
      detailFormula: "Formula",
      detailMetrics: "Fit statistics",
      detailCopy: "Copy formula",
      copied: "Copied",
      detailChartTitle: "Predicted vs true",
      detailTrain: "train",
      detailVerify: "verify",
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
      colorBy: "Color by",
      colorNone: "None — set colors",
      colorHint: "circle = train, triangle = verify",

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
      fileTop: "top-D file (top*D00*)",
      fileCoeff: "coefficient file (*_coeff)",
      fileUspace: "Uspace.expressions",
      fileSissoIn: "SISSO.in（运行设置）",
      fileSissoOut: "SISSO.out（量纲矩阵）",
      missingFiles: "缺少必填文件：",
      verifyOptionalNote: "verify.dat 为可选——若省略，只展示训练集指标。",
      run: "开始分析",
      analyzing: "分析中…",
      rendering: "正在渲染模型…",

      // example demo (内置示例运行，无需上传)
      demoTitle: "没有自己的数据？一键试试示例模型",
      demoBtn: "载入示例模型",
      demoLoading: "载入中…",
      demoErr: "示例模型载入失败。",
      stepReading: "正在读取文件…",
      stepParsing: "正在解析 SISSO 输出…",
      stepEvaluating: "正在评估 {n} 个模型…",
      reset: "载入新结果",
      navHome: "载入结果",

      saveProject: "保存项目",
      loadProject: "载入项目…",
      savedOk: "项目已保存",
      loadedOk: "项目已载入",
      savedFileOnly: "仅保存为文件——浏览器本地存储不可用，之后可用“载入项目…”打开",
      errProject: "无效或不受支持的项目文件",
      recentTitle: "已保存的项目",
      recentEmpty: "这里还没有项目——项目按浏览器与访问地址分别保存，每次分析都会自动出现在这里。",
      recentUnavailable: "当前环境无法使用浏览器本地存储，因此无法在此浏览器中保留项目。",
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
      sortDir: "排序方向",
      sortRank: "排名",
      sortRMSE: "RMSE",
      sortMaxAE: "MaxAE",
      sortR2: "R²",
      sortRho: "Spearman ρ",
      asc: "升序",
      desc: "降序",
      topN: "显示",
      loadAll: "加载全部",
      loadTop: "只显示前 100",
      loadAllTitle: "显示筛选后的全部模型",
      loadTopTitle: "只显示排序后的前 100 个模型",
      loadedCount: "当前显示 {shown} / {total} 个模型",
      viewTable: "表格",
      viewGrid: "缩略图",
      viewPareto: "Pareto 前沿",
      viewUnits: "量纲",
      paretoX: "训练集指标 (X)",
      paretoY: "验证集指标 (Y)",
      paretoNote: "点击散点或表格行查看该模型详情。",
      paretoCount: "{n} 个 Pareto 最优模型",
      paretoCountFiltered: "{n} 个 Pareto 最优 · 符合筛选 {m}/{t}",
      paretoGhost: "已筛除",
      paretoGhostNote: "已被筛选排除，不参与 Pareto 前沿构建",
      paretoRequireVerify: "Pareto 视图需要 verify.dat",
      paretoAll: "所有模型",
      paretoFront: "Pareto 前沿",
      paretoZ: "第三指标 (Z)",
      paretoMode2D: "2D",
      paretoMode3D: "3D",
      exportCsv: "导出 CSV",
      exported: "已导出 models.csv",
      toolbarSort: "排序与筛选",
      toolbarView: "视图",
      toolbarData: "数据",
      paretoControlsLabel: "坐标轴与模式",
      sideSummary: "运行概览",
      sideView: "视图",

      unitsTitle: "量纲分组",
      unitsHint:
        "train.dat 的每个特征列都带有一个 SISSO.out 中打印的单位向量。" +
        "单位向量相同的列属于同一量纲组，并用同一种颜色标注——" +
        "在所有模型公式里，同一种颜色即表示同一量纲。",
      unitsEmpty:
        "没有量纲信息：未载入 SISSO.out。请把它加入结果文件后重新分析。",
      unitsRequireOut: "量纲视图需要 SISSO.out——请连同结果文件一起载入。",
      unitsGroupName: "量纲组 {n}",
      unitsDimless: "无量纲",
      unitsGroupMeta: "train 列 {range} · 共 {n} 个特征",
      unitsVector: "单位向量",
      unitsVectorTitle: "SISSO 单位基上的单位向量（见 SISSO.in 中 funit=）",

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

      colsBtn: "列",
      colsIntro: "显示或隐藏表格列",
      colsReset: "重置列",
      filterBtn: "筛选",
      filterMetrics: "指标范围",
      filterGroups: "量纲组（特征）",
      filterModeAny: "包含任一",
      filterModeOnly: "只含这些",
      filterModeHint:
        "保留特征（+）语义：任一 = 公式至少包含一个保留特征；只含这些 = 公式只由保留特征组成。排除特征（−）始终被禁止出现。",
      filterGroupAllIn: "全部保留",
      filterGroupAllOut: "全部排除",
      filterKeep: "保留",
      filterDrop: "排除",
      filterInCount: "保留 {n}",
      filterOutCount: "排除 {n}",
      filterRulesCount: "{n} 个范围",
      filterRulesCountPlural: "{n} 个范围",
      filterApply: "应用筛选",
      filterPanelHint: "可先勾选任意多个条件，最后点击一次「应用筛选」才会更新表格。",
      filterMin: "最小",
      filterMax: "最大",
      filterClear: "清除筛选",
      sortByCol: "按 {col} 排序",
      loadedFilteredCount: "显示 {shown} / {total} 个模型（共 {all}）",

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
      colorBy: "按参数着色",
      colorNone: "无——按集合配色",
      colorHint: "圆形 = 训练集，三角形 = 验证集",

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
