# SISSO-Analyzer

Interactive web analyzer for [SISSO](https://github.com/rouyang2017/SISSO) results.
Pure client-side — nothing is uploaded to a server; all parsing and computation runs in the browser.

**Live demo**: https://chen121760.github.io/SISSO-Analyzer/

## Scope

- Supports **regression** tasks only.
- Multi-objective and classification tasks are **not yet** supported.

## Features

- Upload the five SISSO result files — drag files, an entire folder, or a
  `.zip` / `.tar.gz` / `.tgz` / `.tar` / `.gz` archive (auto-detected and extracted).
- Sortable overview (rank, RMSE, MaxAE, R², Spearman's ρ) with table and thumbnail grid views.
  The tables (overview, favourites-only view, Pareto front) scroll horizontally
  when there are more columns than fit, so narrower windows no longer crush the
  cells.
- **Analysis health check** before the heavy parse: required files, train/verify feature alignment,
  duplicate sample names, non-numeric / NaN / Inf cells, model descriptors that reference missing
  features, and descriptor hazards (division by zero, log/sqrt outside their domain) are reported
  as compact Passed / Warning / Error rows. Only real blockers stop the run — everything else is a
  warning, and a broken `verify.dat` is simply ignored (train-only mode) instead of failing.
- Per-model detail: formula, fit statistics, interactive ECharts scatter plot, and point inspector.
  A **Export CSV** button in the detail dialog downloads the model's per-sample
  rows as **two CSV files** so train and verify plot cleanly in any tool:
  `sisso-model-{rank}-train.csv` and `sisso-model-{rank}-verify.csv` (the
  latter only when a `verify.dat` was analysed). Each file is rectangular
  (`sample / true / pred / error`) — no empty column blocks to skip — with the
  exact numbers behind the scatter and the error histogram, exported with full
  floating-point precision.
- **Copy models for AI comparison**: the main results table and the Pareto
  front table each get a checkbox column plus a *Copy selected (n)* bar — tick
  the models you want and one click copies a text block per model
  (`modelN：<LaTeX formula>` followed by `RMSE_train / RMSE_verify /
  MaxAE / R² / ρ` lines), ready to paste straight into an AI prompt. A
  **Favourites** toolbar toggle narrows the table/grid list to starred models
  (the same table then supports the batch copy).
- **Formula export — Copy as…**: the detail dialog keeps its plain-text
  *Copy formula* button and adds a small dropdown to copy the SISSO model
  formula as **Plain text**, **LaTeX**, or **Microsoft Word / PowerPoint
  (Office UnicodeMath)**. All three formats are rendered from ONE shared
  expression AST (`Core.formulaAst` → `formulaToPlain` / `formulaToLatex` /
  `formulaToUnicodeMath`), so brackets, precedence, fractions, powers and
  `sqrt`/`log`/`exp`/`abs` are handled identically instead of being stitched
  from per-format string replacements. Feature/variable names are preserved.
  The Office output pastes into a Word/PowerPoint equation box (Alt + =).
- **Error distribution** tab in the model detail — residual histogram
  (`error = predicted − true`) computed from the already-evaluated predictions
  (no model re-run), with a Train/Verify dataset toggle (when a `verify.dat` is
  loaded), a clear 0-error mark, per-bin tooltips (error range + sample count)
  and beside-chart statistics (samples, mean/median error, population std dev).
  The shared engine helpers `errorSeries` / `residualStats` / `errorHistogram`
  keep the residual math and binning out of the chart code.
- **Feature & descriptor usage + batch favourite/exclude** (in the **Units / 量纲**
  view): the usage tables show how often each train feature and each descriptor
  (Uspace expression) appears across the candidate models — sort by count,
  share or name, and see both the model count and the percentage. Each row has
  **Favourite matching** / **Exclude matching** toggles that flag every model
  containing that feature or descriptor in one step; clicking the same button
  again undoes that batch (an **Undo** bar at the top also reverses the latest
  batch actions). Batch ops write to the same favourite / excluded state as the
  table rows, detail dialog, Pareto and Compare, so the two never
  desynchronise. Feature hits are whole-identifier matches (a feature
  `A` never matches `AA`/`A1`), and descriptors are matched through a
  canonicalised expression (whitespace / redundant parentheses ignored). The
  Units view no longer requires `SISSO.out`: dimension groups need it, the
  usage tables do not.
- **Favourite / Exclude every model** — star and eye buttons in the model table and in the detail
  dialog (both stay in sync from one source of truth). Favourites get a golden highlight on the
  Pareto chart; excluded models drop out of lists, the Pareto front and the Compare picker by
  default, and a "Show excluded" toggle brings them back so they can be restored. Flags are saved
  into the project (older saved projects keep working).
- **Pareto front**: every X/Y/Z axis is an independent **dataset + metric** pair — pick e.g.
  Train RMSE × Train MaxAE, or Train RMSE × Verify RMSE when a `verify.dat` is loaded (a
  train-only run works fine; Verify simply appears as an extra dataset option). Plot all
  models and the non-dominated front, click any point/row to open its detail card, and switch
  to **3D** for a three-objective front. Two axes are never allowed to use the same
  dataset + metric.
- **Generalization-gap (Δ) metrics**: with a `verify.dat` loaded, four Δ columns
  (`ΔRMSE`, `ΔMaxAE`, `ΔR²`, `Δρ`) appear in the results table and can be sorted
  and range-filtered like any other metric, and the Pareto X/Y/Z dropdowns can
  use them from the **Δ gap (validation − train)** group. All four share ONE
  engine definition (`Core.metricValue(…, "delta", …)`) with a uniform sign
  convention — **positive = validation performed worse than training, smaller is
  better**; hovering the column header / Pareto option shows the exact formula.
  The Pareto X/Y/Z dropdowns plot the gap's **magnitude |Δ|** (only the size of
  the gap trades off against the other objectives; direction stays visible in
  the signed table columns). A train-only run simply hides the Δ metrics
  instead of showing garbage.
- **Export the current Pareto chart (2D or 3D) as CSV** — every plotted model point (not just the
  front) with its rank, formula, each axis' dataset/metric/value, plus `is_pareto` / `excluded`
  flags, ready to re-plot in Origin, Python or MATLAB. The exported rows, values and flags come
  from the exact data the chart was rendered from.
- **Compare models**: pick any number of eligible models. With exactly **two models** selected, a
  scatter comes first — both models drawn on the shared predicted-vs-true chart (the same
  implementation as the model detail dialog, train and verify points together) — followed by the
  coloured formulas and the side-by-side metric table for every selected model.
- Upload the optional `SISSO.in` to show run cards: feature count (`nsf`), descriptor dimension (`desc_dim`) and complexity (`fcomplexity`).
- Every run is auto-saved to the browser's project history and can be reopened anytime — no
  need to re-upload the run folder.
- English / Chinese UI, light / dark theme, and a left-navigation shell layout (USPEX-Analyzer style).

## Run locally

```bash
python -m http.server 8080
# or
npx serve .
```

Open http://localhost:8080.

## Tests

```bash
node test/pareto_export.test.mjs      # Pareto front + CSV export (self-contained, uses demo data)
node test/pareto_axes.test.mjs        # dataset+metric Pareto axes: train-only / train+verify, 2D / 3D
node test/health_check.test.mjs       # analysis health check: healthy / header mismatch / NaN / bad descriptors
node test/model_state_compare.test.mjs # favourite/exclude state, project round-trip, Compare matrices
node test/usage_batch.test.mjs         # feature/descriptor usage + matching, batch fav/excl, undo
node test/error_distribution.test.mjs  # residual values, residual stats, histogram binning
node test/formula_export.test.mjs      # formula AST -> Plain / LaTeX / UnicodeMath (precedence, brackets)
node test/delta_metrics.test.mjs       # Δ = train→validation gap values, sign, sorting, train-only
node test/verify_against_sisso.mjs    # engine vs real SISSO numbers (needs a local SISSO run next to the repo)
```

`verify_against_sisso.mjs` reads real SISSO result files that live outside the repository, so on a
fresh clone the other four tests run out of the box.

## Deploy

100% static — no backend. Enable GitHub Pages from the `main` branch root.

## Citation

If this tool helps your research, please cite SISSO:

> R. Ouyang, S. Curtarolo, E. Ahmetcik, M. Scheffler, and L. M. Ghiringhelli, Phys. Rev. Mater. 2, 083802 (2018).

## Author

[chen121760](https://chen121760.github.io/) · [SISSO](https://github.com/rouyang2017/SISSO)
