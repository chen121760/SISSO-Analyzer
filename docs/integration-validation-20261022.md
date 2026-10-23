# SISSO 功能整合与验证（2026-10-22）

后续已完成 SISSO++ 兼容处理及合并，见 [SISSO++ 兼容性合并验证](sisso-plus-plus-integration.md)。
本文记录的是首次整合时发现冲突并将该部分保留独立的状态。

整合前 `main` 与已 fetch 的 `origin/main` 均为
`6b22a6cba7a7a8aafb1368c3df6081599bbdfe5f`。
先在临时整合分支解决冲突并验证，再将本地 `main` 快进到验证结果，
从更新后的 `main` 创建 `codex/sisso-integration-test`。

## 纳入 main 的功能

| 来源 | 提交 | 功能 |
|---|---|---|
| `codex/sisso-rbf-svm` | `e8c0e7b38f88f05cd7cffd85fbcea6839bc7c5a2` | 可选 RBF-SVM、可调决策边界、分类指标与排序 |
| `codex/sisso-optimization` | `66a9c49fbf373d598ab1c607a15f0399473ef82f` | 单模型后评价、批量候选评价、指标排序；包含前序 `23a0367` |

两项功能的整合提交为 `58e18a2`。保留原功能提交及合并历史。

两个分支有 5 个文本冲突文件，按双方功能共存解决：

- `.gitignore`：保留本地评价输出忽略规则和合成 SVM 测试夹具例外。
- `README.md`：保留后评价、批量排序和 RBF-SVM 的说明。
- `index.html`：同时加载后评价与 SVM 模块，并保留后评价导航。
- `js/app.js`：载入或恢复项目时，同时取消后评价任务、恢复评价设置、重置 SVM 状态。
- `test/ui_smoke.test.mjs`：保留两套 UI 检查和对应模块加载；增加两类 Worker 共存的集成检查。

## SISSO++ 保持独立

`codex/sisso-plus-plus` 的 HEAD 仍为 `6b22a6c`，功能位于其工作区的未提交改动中。
使用独立临时索引创建工作区快照进行 `git merge-tree --write-tree` 预检，
没有提交、暂存、重置或改写原工作区。

该快照与整合结果有以下冲突，按本次要求不纳入 `main`：

- `index.html`
- `js/app.js`
- `test/ui_smoke.test.mjs`

预检前后核对了工作区状态及 61 个改动/新增文件的 SHA-256，均一致。
原开发目录为 `E:/uspex-jw/SISSO-Analyzer-sisso-plus-plus`。
这次验证不代表 SISSO++ 与整合版本已经兼容。

## 验证结果

1. `node --test --test-reporter=tap` 执行全部 17 个 `test/*.test.mjs` 文件，17 通过、0 失败。
   覆盖原回归/分类、MT-SISSO 合成数据、指标、导出、模型状态、后评价、批量排名和 RBF-SVM。
2. 新增集成检查：两类 Worker 独立运行；取消后评价不终止 SVM；重载项目终止两类任务；
   旧消息不能恢复旧结果；官方 SISSO 排名与分数保持原值；评价设置可以随项目恢复。
3. 使用本地 `2D2F-1K.zip` 执行 `tools/evaluation-case.mjs`，随后执行
   `tools/verify-evaluation.py`。独立 NumPy 拟合、分类决策、AUC/AP、概率指标、混淆计数及回归诊断通过。
4. 执行 `tools/evaluation-batch-case.mjs`：5000 个候选、10000 条评价全部与单模型路径一致，
   错误 0，未收敛 0。`tools/verify-evaluation-batch.py` 独立核验 12 个模型，
   连续分数最大差异约 `5.79e-6`，通过。
5. 合并索引没有未解决条目。项目代码的 `git diff --check` 通过；
   `js/vendor/libsvm.js` 原封保留来源分支已有的 4 处行末空白，未修改第三方库。

测试日志与包含样本的核验输出保存在被 Git 忽略的
`local-evaluation/integration-20261022/`。原始归档不加入提交。

历史私有分类归档和 `dontUpdate/MT-SISSO` 夹具不在当前工作区，
相应内部检查按原测试规则跳过；17 个测试文件通过不表示这些缺失夹具已被验证。
本次 UI 证据来自 DOM shim 自动化，未新增真实浏览器手工验收。
这些科学评价结果验证计算一致性，不构成独立测试集性能结论。

## 测试入口

在 `E:/uspex-jw/SISSO-Analyzer` 的 `codex/sisso-integration-test` 分支运行：

```powershell
python -m http.server 8080
```

浏览器打开 `http://localhost:8080`。回归/分类及批量后评价使用原导入入口；
RBF-SVM 可使用 `test/fixtures/rbf-svm` 或 `test/fixtures/rbf-svm-circle` 的合成样例。

本次更新本地分支，未推送远端。
