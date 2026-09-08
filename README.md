# SISSO-Analyzer

Interactive web analyzer for [SISSO](https://github.com/rouyang2017/SISSO) results. Pure client-side — nothing is uploaded; all parsing and computation runs in the browser.

**Live demo**: https://chen121760.github.io/SISSO-Analyzer/

## Scope

Regression tasks only. Multi-objective and classification tasks are not yet supported.

## Features

- Load the five SISSO result files by drag & drop, folder, or archive (`.zip` / `.tar.gz` / …).
- Sortable overview table and thumbnail grid (rank, RMSE, MaxAE, R², Spearman's ρ) with favourites-only view.
- Health check before parsing — missing files, misaligned or non-numeric samples, unsafe descriptors — reported as Passed / Warning / Error; only real blockers stop the run.
- Per-model detail: formula, fit statistics, interactive scatter plot, point inspector, residual histogram, and per-sample CSV export.
- Copy a formula as plain text, LaTeX, or Word / PowerPoint (UnicodeMath).
- Batch tools: checkbox selection with **Copy selected** for AI prompts, and feature / descriptor usage with one-click favourite / exclude matching.
- Pareto front: any dataset × metric axes (train / verify / Δ gap), 2D & 3D, click-to-inspect, and CSV export of every plotted point.
- Compare models side by side — formulas, metric table, and (for two models) a shared scatter; the winning value of each metric is bolded.
- Optional `SISSO.in` shows run cards (`nsf`, `desc_dim`, `fcomplexity`).
- Auto-saved run history; favourite / exclude flags persist in saved projects.
- English / 中文 UI, light / dark theme.

## Run locally

```bash
python -m http.server 8080
# or
npx serve .
```

Open http://localhost:8080.

## Tests

```bash
node test/pareto_export.test.mjs
node test/pareto_axes.test.mjs
node test/health_check.test.mjs
node test/model_state_compare.test.mjs
node test/usage_batch.test.mjs
node test/error_distribution.test.mjs
node test/formula_export.test.mjs
node test/delta_metrics.test.mjs
```

All tests use bundled demo data and run out of the box. `test/verify_against_sisso.mjs` additionally checks the engine against real SISSO numbers and needs a local SISSO run next to the repo.

## Deploy

100% static — no backend. Enable GitHub Pages from the `main` branch root.

## Citation

If this tool helps your research, please cite SISSO:

> R. Ouyang, S. Curtarolo, E. Ahmetcik, M. Scheffler, and L. M. Ghiringhelli, Phys. Rev. Mater. 2, 083802 (2018).

## Author

[chen121760](https://chen121760.github.io/) · [SISSO](https://github.com/rouyang2017/SISSO)
