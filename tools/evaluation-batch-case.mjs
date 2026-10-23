// node tools/evaluation-batch-case.mjs [2D2F-1K.zip] [local-evaluation/batch]
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadClassificationCase } from "./evaluation-fixture.mjs";
const require = createRequire(import.meta.url), E = require("../js/sisso-evaluation.js"), B = require("../js/sisso-evaluation-batch.js");
const archive = path.resolve(process.argv[2] || "2D2F-1K.zip"), out = path.resolve(process.argv[3] || "local-evaluation/batch");
fs.mkdirSync(out, { recursive: true });
const { result, archiveSHA256 } = await loadClassificationCase(archive);
const c = { dataset: "verify", role: "validation", positiveClass: 1, lambda: 0.01, threshold: 0.5, bootstrap: 0, seed: 42 };
const batch = await B.evaluateAll(result, c, { yieldControl: async () => {}, onProgress: p => { if (p.completed % 1000 === 0) console.log(`Batch ${p.completed}/${p.total}`); } });
assert.equal(batch.rows.length, 10000);
assert.equal(new Set(batch.rows.map(r => r.rank)).size, 5000);
batch.manifest.archiveSHA256 = archiveSHA256;
fs.writeFileSync(path.join(out, "batch-results.json"), JSON.stringify(batch));
fs.writeFileSync(path.join(out, "batch-ranking.csv"), "\uFEFF" + B.csv(batch, { metric: "accuracy" }));
const rankingSpecs = {
  logisticAccuracy: { method: "logistic", metric: "accuracy", minCoverage: 1 },
  logisticAuc: { method: "logistic", metric: "auc", minCoverage: 1 },
  logisticAp: { method: "logistic", metric: "ap", minCoverage: 1 },
  geometryAccuracy: { method: "geometry", metric: "accuracy" },
  geometryCoverage: { method: "geometry", metric: "coverage" },
  geometryCovered80: { method: "geometry", metric: "accuracy", minCoverage: 0.8 }
};
const leaders = {};
for (const [key, spec] of Object.entries(rankingSpecs)) {
  const ranking = B.rankRows(batch, spec), eligible = ranking.rows.filter(e => e.eligible);
  leaders[key] = { spec, eligible: ranking.eligible, top: eligible.slice(0, 10).map(e => ({ place: e.place, ...e.row })), bestTies: eligible.length ? eligible.filter(e => e.place === 1).map(e => e.row.rank) : [] };
  console.log(key + " " + JSON.stringify(leaders[key].top.slice(0, 3).map(r => ({ rank: r.rank, accuracy: r.evaluation.accuracy, coverage: r.evaluation.coverage, auc: r.evaluation.auc, ap: r.evaluation.ap }))));
}
function front(method, metrics) {
  const rows = B.rankRows(batch, { method, metric: "accuracy" }).rows.filter(e => e.eligible && metrics.every(k => Number.isFinite(e.row.evaluation[k]))).map(e => e.row);
  const unique = new Map(); rows.forEach(r => { const key = metrics.map(k => r.evaluation[k]).join("/"); if (!unique.has(key)) unique.set(key, []); unique.get(key).push(r.rank); });
  const tuples = [...unique].map(([key, ranks]) => ({ values: key.split("/").map(Number), ranks }));
  return tuples.filter((p, i) => !tuples.some((q, j) => i !== j && q.values.every((v, k) => v >= p.values[k]) && q.values.some((v, k) => v > p.values[k])));
}
const pareto = { geometry: front("geometry", ["accuracy", "coverage"]), logistic: front("logistic", ["accuracy", "auc", "ap"]) };
fs.writeFileSync(path.join(out, "batch-leaders.json"), JSON.stringify({ leaders, pareto }, null, 2));
// Compare the new cached batch path to the established single-model path for
// every candidate and both rules; errors remain explicit, never silently skipped.
let parity = 0;
for (const row of batch.rows) {
  if (row.status === "error") continue;
  const report = E.evaluate(result, result.models.find(m => m.rank === row.rank), { ...c, method: row.method });
  for (const key of ["accuracy", "selectiveAccuracy", "coverage", "auc", "ap", "mcc", "brier", "logLoss"]) {
    const expected = report.metrics[key], actual = row.evaluation[key];
    assert.ok(expected === actual || Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) < 1e-12, `${row.rank}/${row.method}/${key}`);
  }
  parity++; if (parity % 2000 === 0) console.log(`Single-path parity ${parity}/10000`);
}
const selected = new Map();
for (const key of ["logisticAccuracy", "logisticAuc", "logisticAp", "geometryAccuracy", "geometryCoverage"]) { const row = leaders[key].top[0]; if (row) selected.set(row.method + "/" + row.rank, row); }
for (const method of ["geometry", "logistic"]) selected.set(method + "/1", batch.rows.find(r => r.method === method && r.rank === 1));
const logisticRows = batch.rows.filter(r => r.method === "logistic" && r.status === "ok" && r.evaluation.coverage === 1);
const bestAccuracy = Math.max(...logisticRows.map(r => r.evaluation.accuracy));
const accuracyRepresentative = logisticRows.filter(r => r.evaluation.accuracy === bestAccuracy).sort((a, b) => b.evaluation.auc - a.evaluation.auc || b.evaluation.ap - a.evaluation.ap || a.rank - b.rank)[0];
const nearAccuracyRepresentative = logisticRows.filter(r => r.evaluation.accuracy >= bestAccuracy - 1 / result.verify.n - 1e-12).sort((a, b) => b.evaluation.ap - a.evaluation.ap || b.evaluation.auc - a.evaluation.auc || a.rank - b.rank)[0];
for (const row of [accuracyRepresentative, nearAccuracyRepresentative]) selected.set(row.method + "/" + row.rank, row);
const audits = [];
// Leaders + deterministic ranks give the independent NumPy verifier diverse
// descriptors, instead of verifying only the favorable selections.
const auditRanks = new Set([1, 17, 499, 1501, 3001, 5000, ...[...selected.values()].map(r => r.rank)]);
for (const rank of [...auditRanks].sort((a, b) => a - b)) {
  const model = result.models.find(m => m.rank === rank);
  const train = E.evaluate(result, model, { ...c, dataset: "train", method: "logistic" });
  const verify = E.evaluate(result, model, { ...c, method: "logistic", bootstrap: 500 });
  audits.push({ rank, train, verify });
}
fs.writeFileSync(path.join(out, "independent-input.json"), JSON.stringify(audits));
for (const [key, row] of selected) {
  const report = E.evaluate(result, result.models.find(m => m.rank === row.rank), { ...c, method: row.method, bootstrap: 500 });
  fs.writeFileSync(path.join(out, key.replace("/", "-") + ".json"), JSON.stringify(report));
}
const verification = { candidates: 5000, evaluations: batch.rows.length, singlePathParity: parity, errors: batch.manifest.errors, nonconverged: batch.manifest.nonconverged, auditRanks: [...auditRanks], batchElapsedMs: batch.manifest.elapsedMs };
fs.writeFileSync(path.join(out, "batch-checks.json"), JSON.stringify(verification, null, 2));
const f = v => Number.isFinite(v) ? Number(v.toPrecision(6)) : "—";
const summary = ["# 5000 个候选模型批量后评价", "", `归档 SHA-256：\`${archiveSHA256}\`。`, "", "统一设置：331 个训练样本、77 个调参验证样本，正类 high；lambda=0.01，二分类阈值 0.5。每个候选分别使用训练集拟合几何域与辅助 Logistic，再评价同一验证集。没有用验证标签拟合或标准化，也没有逐候选调参。", "",
  `共 ${batch.rows.length} 条模型/规则评价；失败 ${batch.manifest.errors}，未收敛 ${batch.manifest.nonconverged}。批量计算耗时 ${(batch.manifest.elapsedMs / 1000).toFixed(2)} 秒（本机 Node，单进程；不包含解析、独立核验和输出）。`, "",
  "| 比较标准 | 原 SISSO 排名 | 验证准确率 | 覆盖率 | ROC AUC | AP | 训练准确率 |", "|---|---:|---:|---:|---:|---:|---:|",
  ...Object.entries(leaders).map(([key, l]) => { const r = l.top[0]; return r ? `| ${key} | ${r.rank} | ${[r.evaluation.accuracy, r.evaluation.coverage, r.evaluation.auc, r.evaluation.ap, r.train.accuracy].map(f).join(" | ")} |` : `| ${key} | 无合格候选 | — | — | — | — | — |`; }), "",
  "## 哪些模型更适合进一步验证", "",
  `- **固定 0.5 阈值、优先正确分类：Logistic 原排名 ${accuracyRepresentative.rank}。** 在 ${leaders.logisticAccuracy.bestTies.length} 个最高准确率并列候选中，按 AUC、AP 再择一个代表；其余并列模型仍保留，不声称该代表具有独立测试优势。`,
  `- **允许比最高准确率少正确 1 个验证样本、提高 PR 表现：Logistic 原排名 ${nearAccuracyRepresentative.rank}。** 这一筛选条件是明确的取舍规则，不是加权综合分。`,
  `- **优先连续排序 / 正类检索：Logistic 原排名 ${leaders.logisticAuc.top[0].rank}。** AUC 和 AP 在本次候选中最高；固定阈值决策却较弱，不能直接据此替换分类决策模型。`,
  `- **坚持几何域拒判：原排名 ${leaders.geometryCoverage.top[0].rank}。** 准确率与覆盖率形成唯一的几何 Pareto 指标组合，但本例没有几何候选达到 80% 覆盖率。`, "",
  "| 入选代表 | 准确率 | AUC | AP | Brier | Log loss |", "|---|---:|---:|---:|---:|---:|",
  ...[batch.rows.find(r => r.method === "logistic" && r.rank === 1), accuracyRepresentative, nearAccuracyRepresentative, leaders.logisticAuc.top[0]].map(r => `| Logistic ${r.rank} | ${[r.evaluation.accuracy, r.evaluation.auc, r.evaluation.ap, r.evaluation.brier, r.evaluation.logLoss].map(f).join(" | ")} |`), "",
  "更高准确率并不保证更好的概率：例如最高准确率代表的 Log loss 仍可能比原 top1 更差，说明少量高置信度错误需要继续检查。所有这些候选均来自同一验证集筛选，仍需新数据或嵌套验证。", "",
  "## 按指标分别排序的前 10 名", "",
  ...Object.entries(leaders).flatMap(([key, l]) => [`### ${key}`, "", `合格候选：${l.eligible}；并列第一的原排名：${l.bestTies.join(", ") || "无"}。`, "", "| 原排名 | 准确率 | 已接受准确率 | 覆盖率 | AUC | AP | train−verify 准确率 |", "|---:|---:|---:|---:|---:|---:|---:|", ...l.top.map(r => `| ${r.rank} | ${[r.evaluation.accuracy, r.evaluation.selectiveAccuracy, r.evaluation.coverage, r.evaluation.auc, r.evaluation.ap, r.gap.accuracy].map(f).join(" | ")} |`), ""]),
  "## 取舍与复现", "", `几何 accuracy/coverage 的 Pareto 前沿有 ${pareto.geometry.length} 组不同指标；Logistic accuracy/AUC/AP 的前沿有 ${pareto.logistic.length} 组不同指标。详见 batch-leaders.json；不把三个指标任意加权成一个所谓最佳分数。`, "",
  ...[...selected.values()].flatMap(r => [`### ${r.method} / SISSO ${r.rank}`, "", ...r.descriptors.map((d, i) => `- d${i + 1} = \`${d}\``), "", `验证混淆矩阵（行 low/high，列 low/high/拒判）：\`${JSON.stringify(r.evaluation.confusion)}\`。`, ""]),
  "## 证据与限制", "", `- ${parity} 条成功评价逐一与单模型入口比较，准确率、覆盖率、AUC/AP、MCC 和概率指标一致。完整结果见 [batch-results.json](batch-results.json)，可排序表见 [batch-ranking.csv](batch-ranking.csv)。`,
  "- 独立 NumPy 核验覆盖各标准领先候选及预设的分散排名，输出为 independent-check.json；不把软件一致性当作独立性能验证。",
  "- 几何规则没有连续分数，因此 AUC/AP 保持不可用；不能用官方 overlap 或 YES/NO 伪造 ROC。辅助 Logistic 规则与官方 SISSO 判定的含义不同。",
  "- 用同一 77 个标签筛选 5000 个候选会产生选择乐观偏差。本表是调参验证排序，不能宣称选出模型的独立测试性能。领先几名可能只相差 1 个样本或很少的排序对。",
  "- 参数与阈值全部固定。训练/验证差距只提示需检查的问题，不能据此确定过拟合或分布变化的因果来源。",
  "- 只对少量入选模型提供固定预测的 Bootstrap 区间；这些区间未调整 5000 次候选筛选，不应用来证明所选模型显著优于其他候选。",
  "- 分类排序按完整标签分母计算准确率，并列保留；AUC/AP 默认要求全部有标签样本均有有限分数。失败、未收敛和不可用分数在输出中保留。",
  "- 全部工作仅保留在本地优化分支，未合并到 main、未推送。"
].join("\n");
fs.writeFileSync(path.join(out, "batch-report.md"), summary);
console.log(JSON.stringify(verification));
