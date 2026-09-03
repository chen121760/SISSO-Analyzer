# SISSO Viewer

Interactive web explorer for [SISSO](https://github.com/rouyang2017/SISSO) regression results.
Pure client-side — nothing is uploaded to a server; all parsing and computation runs in the
browser. Works offline and deploys directly to GitHub Pages.

## Features

- **Flexible upload** — drop the result files, drag an **entire folder**, or drop a
  **`.zip` / `.tar.gz` / `.tgz` / `.tar` / `.gz`** archive; the app auto-detects and
  extracts the five SISSO files (`train.dat`, optional `verify.dat`, `top*D00*`,
  `top*D00*_coeff`, `SIS_subspaces/Uspace.expressions`).
- **Sortable overview** — rank models by rank, RMSE, MaxAE, R² or Spearman's ρ; show the
  top-N (default 100) or load all.
- **Table + thumbnail grid** views for quick scanning.
- **Detail view per model** — the formula block, fit statistics (RMSE / MaxAE / R² / ρ for
  train and verify), and an interactive ECharts scatter plot (zoom, pan, tooltip, PNG export).
- **Point inspector** — click any point to see that sample's full feature vector.
- **CSV export** of the currently displayed models.
- **English / Chinese** interface toggle.
- Detects when `verify.dat` is byte-identical to `train.dat` and flags the verify metrics as
  in-sample.

## Run locally

No build step. Serve the folder with any static server:

```bash
# Python
python -m http.server 8080 --directory sisso-viewer

# Node
npx serve sisso-viewer
```

Then open http://localhost:8080.

> **Note on `file://`**: opening `index.html` directly by double-clicking works for the
> core flow (all parsing runs in the browser), but browsers treat `file://` URLs as a
> unique security origin and may log harmless warnings. For the best experience, serve
> the folder as above.

## Deploy to GitHub Pages

1. Push the `sisso-viewer/` folder to a GitHub repository.
2. In the repo, enable GitHub Pages and point it at the branch / folder that contains
   `index.html` (for example, the repo root if you push the contents of `sisso-viewer/`
   directly, or use `/docs`).

Because the app is 100% static, it needs no backend.

## Regression test

A Node script verifies that the JavaScript engine reproduces SISSO's own numbers exactly
(reads the real data files next to this project):

```bash
node test/verify_against_sisso.mjs
```

The test asserts, among other things, that for **all 1000 models** the recomputed training
RMSE equals the value SISSO reported (within floating-point rounding).

## Design system

Built against the "Data-Dense Dashboard" style (ui-ux-pro-max): Fira Sans / Fira Code,
blue data palette (`#1E40AF`) with amber highlights (`#D97706`), light `#F8FAFC` background,
WCAG AA contrast, full keyboard navigation, reduced-motion support, and a table alternative
for every chart (accessibility).
