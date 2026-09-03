# SISSO-Analyzer

Interactive web analyzer for [SISSO](https://github.com/rouyang2017/SISSO) results.
Pure client-side — nothing is uploaded to a server; all parsing and computation runs in the browser.

## Scope

- Supports **regression** tasks only.
- Multi-objective and classification tasks are **not yet** supported.

## Features

- Upload the five SISSO result files — drag files, an entire folder, or a
  `.zip` / `.tar.gz` / `.tgz` / `.tar` / `.gz` archive (auto-detected and extracted).
- Sortable overview (rank, RMSE, MaxAE, R², Spearman's ρ) with table and thumbnail grid views.
- Per-model detail: formula, fit statistics, interactive ECharts scatter plot, and point inspector.
- CSV export and English / Chinese UI toggle.

## Run locally

```bash
python -m http.server 8080
# or
npx serve .
```

Open http://localhost:8080.

## Deploy

100% static — no backend. Enable GitHub Pages from the `main` branch root.
Live: https://chen121760.github.io/SISSO-Analyzer/

## Related

- [SISSO](https://github.com/rouyang2017/SISSO) — the regression engine this analyzer reads results from.
