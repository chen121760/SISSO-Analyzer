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
- Per-model detail: formula, fit statistics, interactive ECharts scatter plot, and point inspector.
- CSV export, English / Chinese UI, and light / dark theme.

## Run locally

```bash
python -m http.server 8080
# or
npx serve .
```

Open http://localhost:8080.

## Deploy

100% static — no backend. Enable GitHub Pages from the `main` branch root.

## Citation

If this tool helps your research, please cite SISSO:

> R. Ouyang, S. Curtarolo, E. Ahmetcik, M. Scheffler, and L. M. Ghiringhelli, Phys. Rev. Mater. 2, 083802 (2018).

## Author

[chen121760](https://chen121760.github.io/) · [SISSO](https://github.com/rouyang2017/SISSO)
