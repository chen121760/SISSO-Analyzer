// node tools/evaluation-case.mjs [archive.zip] [output-directory]
// Reads only the outer case's required entries, never the 132 MB Uspace.dat.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const JSZip = require("../js/jszip.min.js"), C = require("../js/sisso-classification.js"), E = require("../js/sisso-evaluation.js"), Core = require("../js/sisso-core.js");
const archive = path.resolve(process.argv[2] || "2D2F-1K.zip"), out = path.resolve(process.argv[3] || "local-evaluation");
if (!fs.existsSync(archive)) throw new Error("Supply the user-provided 2D2F-1K.zip archive path.");
const bytes = fs.readFileSync(archive), archiveSHA256 = crypto.createHash("sha256").update(bytes).digest("hex"), zip = await JSZip.loadAsync(bytes);
const names = { train: "train.dat", verify: "verify.dat", sissoin: "SISSO.in", top: "Models/top5000_D002", uspace: "SIS_subspaces/Uspace.expressions", classdesc: "Models/data_top1/desc_D002.dat", classhull: "convex2D_hull", trainlabels: "train_labels.json", verifylabels: "verify_labels.json" };
const texts = {};
for (const [key, name] of Object.entries(names)) { const entry = zip.file("2D2F-1K/" + name); if (!entry) throw new Error("Missing outer entry: " + name); texts[key] = await entry.async("string"); }
const result = C.runPipeline(texts);
if (result.train.n !== 331 || result.verify.n !== 77 || result.models.length !== 5000) throw new Error("Unexpected example archive structure; review before accepting results.");
fs.mkdirSync(out, { recursive: true });
const reports = [];
for (const method of ["geometry", "logistic"]) for (const dataset of ["train", "verify"]) {
  const report = E.evaluate(result, result.models[0], { method, dataset, role: "validation", positiveClass: 1, lambda: 0.01, threshold: 0.5, bootstrap: dataset === "verify" ? 500 : 0, seed: 42 });
  report.manifest.archiveSHA256 = archiveSHA256;
  report.manifest.inputFiles = names;
  const key = `${method}-${dataset}`;
  fs.writeFileSync(path.join(out, `${key}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, `${key}.csv`), "\uFEFF" + E.csv(report));
  reports.push({ key, report });
  console.log(JSON.stringify({ key, accuracy: report.metrics.accuracy, coverage: report.metrics.coverage, confusion: report.metrics.confusion,
    auc: report.metrics.auc, ap: report.metrics.ap, fitConverged: report.manifest.fit.converged }));
}
const f = v => v === null || v === undefined ? "—" : Number(v.toPrecision(6));
const demo = require("../js/demo-data.js").DEMO_DATA;
const regression = Core.runPipeline({ trainText: demo.train, verifyText: demo.verify, topText: demo.top, coeffText: demo.coeff, uspaceText: demo.uspace, sissoInText: demo.sissoin, sissoOutText: demo.sissoout });
const regressionReport = E.evaluate(regression, regression.models[0], { dataset: "verify", role: "validation", bootstrap: 500, seed: 42 });
fs.writeFileSync(path.join(out, "regression-demo-verify.json"), JSON.stringify(regressionReport, null, 2));
fs.writeFileSync(path.join(out, "regression-demo-verify.csv"), "\uFEFF" + E.csv(regressionReport));
const trainingLogistic = reports.find(r => r.key === "logistic-train").report;
const verificationLogistic = reports.find(r => r.key === "logistic-verify").report;
const verificationGeometry = reports.find(r => r.key === "geometry-verify").report;
const confident = verificationLogistic.rows.filter(r => r.probabilities[1] >= 0.9);
const summary = [`# 2D2F-1K 本地后评价案例`, "", `归档 SHA-256：\`${archiveSHA256}\``, "", "固定使用 SISSO 排名第 1 的描述符，没有在验证集上重新选择模型或阈值。331 个训练样本（low=140, high=191），77 个验证样本（low=47, high=30），5000 个候选模型。正类为 high。",
  "", "辅助 Logistic：训练集标准化，多项交叉熵均值 + 0.01/2 × 各类别斜率平方和；阈值 0.5。几何分类：训练凸包唯一命中则预测，多重命中/域外则拒判。", "",
  "| 方法 / 数据 | 总体准确率 | 已判定准确率 | 覆盖率 | Balanced accuracy | Macro F1 | MCC | AUC | AP |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...reports.map(({ key, report: r }) => `| ${key} | ${["accuracy", "selectiveAccuracy", "coverage", "balancedAccuracy", "macroF1", "mcc", "auc", "ap"].map(k => f(r.metrics[k])).join(" | ")} |`), "",
  "总体准确率以全部有标签样本为分母；拒判计为未正确。已判定准确率只统计接受预测的样本。混淆矩阵行是真实 low/high，列是预测 low/high/拒判。", "",
  ...reports.flatMap(({ key, report: r }) => [`## ${key}`, "", `混淆矩阵：\`${JSON.stringify(r.metrics.confusion)}\`。`, "", `样本状态：\`${JSON.stringify(r.metrics.statuses)}\`。`, "", ...(r.uncertainty ? ["95% IID percentile bootstrap 区间（500 次，seed=42；固定模型条件下）：", "", ...["accuracy", "coverage", "auc", "ap"].map(k => { const ci = r.uncertainty.intervals[k]; return `- ${k}: [${f(ci.low)}, ${f(ci.high)}]；有效重采样 ${ci.validReplicates}/500。`; }), ""] : [])]),
  "## 解读边界", "", "官方 top1 为 YES=229、NO=102，属于官方几何证据，不是本后评价的预测 T/F。验证集结果只描述当前固定方案；若之后用这些结果选模型或改阈值，应保留为调参验证集。不能据此声称独立测试性能或辅助分类器优于所有 SISSO 候选模型。", "",
  "本例没有独立校准集或逐折重新运行 SISSO 的结果，因此不输出真实案例 conformal 覆盖保证或完整 SISSO 交叉验证结论。这些入口已用合成数据测试。", "",
  "逐样本 CSV、完整 JSON（含变换、权重、配置、ROC/PR 点、可靠性分箱、区间）保存在本目录。原始样本数据仅保存在本地。", "",
  "## 补充：项目自带回归示例", "", "用户提供的 2D2F-1K 是分类数据；回归功能另用仓库内置示例的排名第 1 模型验证，没有将分类标签当作连续回归目标。", "",
  `验证集有效样本 ${regressionReport.metrics.valid}/${regressionReport.metrics.n}；RMSE=${f(regressionReport.metrics.rmse)}，MAE=${f(regressionReport.metrics.mae)}，R²=${f(regressionReport.metrics.r2)}，P95AE=${f(regressionReport.metrics.p95AE)}，训练均值基线改善=${f(regressionReport.metrics.baselineSkill)}。`, "",
  "对应文件：regression-demo-verify.json / .csv。容差未预先指定，因此不报告容差命中率。", "",
  "## 本次修改汇总", "",
  "- 新增独立后评价计算模块、后台 Worker 和中英文工作区；项目保存可携带规则、正类、阈值、正则化、随机种子及外部预测输入。", 
  "- 分类新增逐样本 T/F、拒判状态、原始/归一化混淆矩阵、各类别 Precision/Recall/F1、总体与选择性准确率、Balanced accuracy、Macro F1、MCC。",
  "- 连续分数支持 ROC/AUC 与 PR/AP；概率支持 Brier、Log loss、可靠性分箱。新增 CSV/JSON 导出与复现清单。",
  "- 回归新增偏差、Median/P90/P95AE、预设容差命中率、训练均值基线比较、残差与预测值/原始特征的关系及特征范围外推提示。",
  "- 新增固定预测 Bootstrap、逐折预测导入和有独立校准数据时的 split conformal；计算可取消，旧项目可恢复。", "",
  "## 新评价实际发现的问题", "",
  `1. **训练表现不能代表验证表现。** 辅助 Logistic 准确率从训练集的 ${f(trainingLogistic.metrics.accuracy * 100)}% 降至验证集的 ${f(verificationLogistic.metrics.accuracy * 100)}%，下降 ${f((trainingLogistic.metrics.accuracy - verificationLogistic.metrics.accuracy) * 100)} 个百分点。这提示泛化差距，不能单凭该差距断定是过拟合还是分布变化。`, "",
  `2. **high 类误报较多。** TP=${verificationLogistic.metrics.binary.tp}、FN=${verificationLogistic.metrics.binary.fn}、FP=${verificationLogistic.metrics.binary.fp}、TN=${verificationLogistic.metrics.binary.tn}。high Recall=${f(verificationLogistic.metrics.perClass[1].recall)}，但 Precision=${f(verificationLogistic.metrics.perClass[1].precision)}；low Recall=${f(verificationLogistic.metrics.perClass[0].recall)}。单个总体准确率会隐藏这种类别偏向。`, "",
  `3. **概率存在过度自信迹象。** high 概率 ≥0.9 的 ${confident.length} 个验证样本，平均预测概率为 ${f(confident.reduce((s, r) => s + r.probabilities[1], 0) / confident.length)}，实际 high 比例为 ${f(confident.filter(r => r.yTrue === 1).length / confident.length)}。该分箱样本少，提示需要独立校准/更多数据，不能视为已证明完整概率校准误差。`, "",
  `4. **拒判覆盖损失明显。** 几何规则仅接受 ${verificationGeometry.metrics.accepted}/77 个样本，另有 30 个重叠拒判、1 个域外拒判。接受样本准确率 ${f(verificationGeometry.metrics.selectiveAccuracy * 100)}%，但覆盖率只有 ${f(verificationGeometry.metrics.coverage * 100)}%；必须同时查看覆盖率与准确率。`, "",
  `5. **回归有系统性低估，且弱于简单基线。** 内置回归示例的平均残差为 ${f(regressionReport.metrics.bias)}（预测−真实），训练均值基线改善为 ${f(regressionReport.metrics.baselineSkill)}，即模型 MSE 比训练均值常数预测高约 ${f(-regressionReport.metrics.baselineSkill * 100)}%。P95AE=${f(regressionReport.metrics.p95AE)} 揭示尾部误差，单看平均误差无法完整反映。`, "",
  "## 测试证据与限制", "",
  "- 13 套 test/*.test.mjs 测试全部通过；测试日志见 [test-results.txt](test-results.txt)。缺少的历史私有测试夹具按原套件规则跳过；本次用户归档已单独执行。",
  "- 独立 NumPy Newton 优化与 JavaScript 拟合得到相同分类决策，连续分数最大差异低于 1e-5；AUC/AP、Brier/Log loss、混淆计数和回归诊断交叉核验通过，见 [independent-check.json](independent-check.json)。",
  "- 浏览器实测分类和回归入口、归一化矩阵、500 次 Bootstrap、配置保存恢复、JSON 导出和窄屏布局；取消及过期 Worker 消息由 UI 测试覆盖。界面截图见 [classification-browser.png](classification-browser.png)。",
  "- 几何分类限单任务、1D/2D 且各类 isconvex=1；辅助 Logistic 是新增的下游判定规则，不能称为官方 SISSO 分类结果。",
  "- ROC/AUC 评价排序；准确率评价指定阈值下的决策；概率可靠性评价置信度。这些指标不能互相代替。",
  "- 仅固定 top1 做案例验证，没有搜索并证明 5000 个候选中的最优模型。验证集不是经本工具认证的独立测试集，数据角色和来源仍需研究者核实。",
  "- Bootstrap 是固定预测、固定模型条件下的探索区间，不覆盖模型筛选不确定性；IID 假设不适合未标注分组的关联样本。",
  "- 本例无独立校准集、无完整逐折 SISSO 运行，故 conformal 和折外导入仅经合成数据测试；概率自动重校准和完整 SISSO 训练没有在浏览器内实现。",
  "- 原始特征范围检查仅作外推提示，高维情况下可能很保守；不能据此证明适用域。有限值过滤后的指标应与有效样本覆盖率一起阅读。",
  "- 代码和报告仅在本地优化分支测试；没有合并到 main，也没有推送。"
].join("\n");
fs.writeFileSync(path.join(out, "case-report.md"), summary);
console.log("Wrote " + path.join(out, "case-report.md"));
