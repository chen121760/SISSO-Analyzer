# SISSO-Analyzer

Experimental branch: [fixed-size classification boundaries](docs/simple-boundaries-experiment.md)
compares linear, parabolic and reciprocal rules using the existing Logistic solver.

Interactive web analyzer for [SISSO](https://github.com/rouyang2017/SISSO) and
[SISSO++](https://gitlab.com/sissopp_developers/sissopp) results. Pure client-side —
nothing is uploaded; all parsing and computation runs in the browser.

**Live demo**: https://chen121760.github.io/SISSO-Analyzer/

> **Companion tool:** Use [SISSO-Sage](https://github.com/chen121760/SISSO-Sage)
> when you want an AI assistant to review several candidate formulas using
> predictive evidence, feature metadata, and extraction code. Analyzer is for
> visual, manual exploration; Sage is for AI-assisted scientific review. The two
> tools are separate but can examine the same SISSO results.

## Watch the video

[![Watch SISSO-Analyzer and SISSO-Sage in action](promo/cover.png)](https://chen121760.github.io/SISSO-Analyzer/promo/)

**[Watch the overview](https://chen121760.github.io/SISSO-Analyzer/promo/)** · English narration · 1080p · 48 sec

[Download MP4](https://chen121760.github.io/SISSO-Analyzer/promo/sisso-promo-en.mp4) · [English subtitles](promo/sisso-promo-en.srt)

## Scope

Single-target and multi-task (MT-SISSO) **regression**, plus single-task **1D/2D
classification result analysis** (`ptype=2`). Multi-objective and multi-task
classification runs are not supported.

## Features

### SISSO++ imports

Load a SISSO++ run folder or archive containing `sisso.json`, its input data CSV,
and `models/train_dim_N_model_K.dat`. Choose a descriptor dimension before
Analyze. Matching `test_dim_N_model_K.dat` files establish the original test
split; a random hold-out is never reconstructed from `leave_out_frac`.
The data CSV can be shared through `../data.csv`, as in the current official
default case, provided that CSV is included in the uploaded folder or files.

Supported: single-task and multi-task ordinary/log regression (including explicit
task-aware test predictions), and single-task 1D/2D classification with convex-hull,
Davies–Bouldin, silhouette or Calinski–Harabasz losses. The importer
accepts commented configuration files and fixed-zero-intercept coefficient
rows. It checks sample IDs, targets, descriptor coordinates and regression
predictions against the input CSV and model metadata before analysis. Saved
projects retain the engine identity, original sample IDs and SVM predictions.

Log-regression formulas retain the native multiplicative form. `LOG_RMSE` / `MSLE`
remain separate native loss cards; the table's RMSE/MAE/MaxAE use the original
target scale. Log models require positive targets and descriptor values.

Classification preserves SISSO++ model order, available overlap counts and native SVM
predicted classes. These classes are separate from SISSO's `classified? YES/NO`
markers. The text model format does not supply `size_overlap`, so that field is
shown as unavailable. Non-hull classification losses are preserved independently;
no overlap count is invented for them. Hulls use the training samples only. The sample table and
CSV expose a separate **SISSO++ SVM predicted class** column.

Current limits: multi-task classification and classification above 2D are rejected
with an explanation. Unknown calculation/loss formats are also rejected.
Primary feature names must use letters, digits and underscores. Unit suffixes in
CSV headers are accepted; the SISSO unit-matrix view requires a native unit
matrix and is unavailable for these SISSO++ imports.

Nine [synthetic examples](demo/sisso-plus-plus/README.md) follow the latest
official source format verified at upstream commit
[`43b9911`](https://gitlab.com/sissopp_developers/sissopp/-/commit/43b99110118a51b9f4983b02c8d781ae6f25456c).
They are virtual importer fixtures, not a claim that SISSO++ was executed.

### SISSO features

- Load the SISSO result files by drag & drop, folder, or archive (`.zip` / `.tar.gz` / …).
- Sortable overview table and thumbnail grid (rank, RMSE, MAE, MaxAE, R², Spearman's ρ) with favourites-only view.
- Health check before parsing — missing files, misaligned or non-numeric samples, unsafe descriptors — reported as Passed / Warning / Error; only real blockers stop the run.
- Per-model detail: formula, fit statistics, interactive scatter plot, point inspector, residual histogram, and per-sample CSV export.
- Copy a formula as plain text, LaTeX, or Word / PowerPoint (UnicodeMath).
- Batch tools: checkbox selection with **Copy selected** for AI prompts, and feature / descriptor usage with one-click favourite / exclude matching.
- Pareto front: any dataset × metric axes (train / verify / task 1…N / Δ gap), 2D & 3D, click-to-inspect, and CSV export of every plotted point.
- Compare models side by side — formulas, metric table, and (for two models) a shared scatter; the winning value of each metric is bolded.
- Optional `SISSO.in` shows run cards (`nsf`, `desc_dim`, `fcomplexity`, and the task split of a multi-task run).
- Auto-saved run history; favourite / exclude flags persist in saved projects.
- English / 中文 UI, light / dark theme.

## Classification runs

1. Drop the result archive or select the run folder, including `SISSO.in`,
   `train.dat`, `Uspace.expressions` and `Models/top*_D00*`.
2. Click **Analyze**. Classification is detected automatically; no coefficient
   file is needed.
3. Browse the thumbnail grid or ranked table, then select a model to inspect
   its descriptors, category hulls and samples. Export rankings, hull vertices
   or sample coordinates as CSV.

Classification `train.dat` contains **name + features**, with no target column.
`nsample=(n1,n2,…)` in `SISSO.in` defines consecutive category blocks, as described
in the SISSO 3.5 guide, section 4.1. Optional `train_labels.json` and
`verify_labels.json` supply category mapping and validation labels. Their format is
`{"class_order":["A","B"],"rows":[{"id":"sample-id","class":0},…]}`;
rows are joined by ID, and training labels must agree with the category blocks.
Without complete validation labels, only training samples are shown.
The page and CSV use **Category 1, Category 2, …** as stable group labels.
Names from `class_order` are used to validate category mapping.
Reversing a descriptor axis does not change categories. Reordering category
blocks requires matching `nsample` counts and sample-ID label assignments.

**Hulls for every model.** The default view reconstructs each category's convex
hull from that model's training coordinates. **Rebuild hulls** repeats the
construction; **Hull source** can switch to the original SISSO hull when one
is supplied. Singleton and collinear groups render as a point or segment;
non-convex categories are shown as sample envelopes. Thumbnail previews always
use training reconstructions, are drawn when visible, and are paged in groups
of 100 models.

**Verification classes.** Use **Set classes / Edit classes** in the page header to assign
labels without writing JSON. Each training category has a count box; the last
category automatically receives the remaining samples. This fills consecutive
groups in `verify.dat` row order, like `nsample=(n1,n2,…)`. The preview shows row
ranges and boundary sample IDs.
Save that grouping directly, or choose **Adjust samples** for individual changes.
Counts must match the training category count and total the verification sample
count; zero is allowed for an absent category. Alternatively, select samples
and assign their category in bulk, or edit individual rows. **Save classes**
applies the labels and saves them with the project. **Export labels JSON** writes
an ID-based `verify_labels.json` for reuse. Partial labels can be saved with
`class:null`; only training data is displayed until every validation sample is
labeled. These assignments leave the training `nsample` and hulls unchanged.

**Training + verification.** With a fully labeled `verify.dat`, the default plot overlays both
datasets: category color/shape stays the same, filled markers are training and
hollow markers are verification. The dataset selector also supports either set
alone. Verification points never participate in hull construction. The sample
table and combined CSV retain dataset identity. There is no additional data
split: the imported training and verification files define it.

The classification table preserves SISSO's `#data_overlap` and `size_overlap`,
including negative separation scores. Lower values are preferred, with overlap
count taking priority. For two convex categories in 2D, positive size is the
overlap area divided by the smaller category area; negative size reports
separation distance. See the [official classification implementation](https://github.com/rouyang2017/SISSO/blob/master/src/DI.f90).

Optional `Models/data_top1/desc_D00*.dat` adds the engine's `classified?` YES/NO
markers after its coordinates have been checked against the selected top1
descriptors. Optional `convex2D_hull` draws the original top1 vertices in file
order. **NO means entry into another category domain; it is not a predicted
class.** Engine boundary tolerances and near-zero hull edges can materially
affect these statistics. The analyzer preserves the official geometry and
scores separately from its training-sample reconstructions. The separate
**Post-evaluation** workspace can assign predictions using an explicitly selected
training-domain rejection rule or an auxiliary Logistic classifier. Official
YES/NO is never interpreted as prediction accuracy.

Archives and folders containing a nested run (for example `_class_smoke/`) use
the outer run's files; nested run evidence is kept out of that analysis.

For classification T/F, confusion matrices, ROC/PR, probability diagnostics and
regression residual/tail-error evaluation, see the
[post-evaluation guide](docs/post-evaluation.md). It also documents local
bootstrap intervals, imported fold predictions and independent-calibration
conformal evaluation. Computation is local and cancellable.

Use **Evaluate all candidates / 批量评价全部候选** to screen the full ranked
model list with one fixed protocol, then sort accuracy, coverage, ROC AUC or AP.
Classification evaluates geometry and auxiliary Logistic separately; selected
candidate details remain available. Batch rankings are selection-validation
results and require a held-out test before final performance claims.

### Optional RBF-SVM classifier

For **2D classification** runs, manually check **Enable RBF-SVM for all models**.
The analyzer then trains a separate LIBSVM RBF C-SVC for every candidate using
only that candidate's `d1` and `d2`. This feature is off by default. Computation
runs locally in a Web Worker; the page stays usable and **Stop training**
immediately cancels fitting while retaining completed scores.

Each classifier standardizes its two coordinates using **training samples only**.
All candidates share the chosen **C** (default `1`), **base γ** (default `scale`,
i.e. inverse summed training variance after standardization), and **Boundary
complexity** (levels 1–5, default 3). Complexity multiplies base γ by
`4^(level - 3)` = `1/16, 1/4, 1, 4, 16`: higher levels allow more local,
flexible boundaries. This changes the fitted classifier, not drawing resolution.
Numeric C and base γ must be between `0.000001` and `1000000`. Settings are drafts
until **Retrain all models** is clicked; the previous plot and scores remain
visible with a reminder. Retraining replaces fits, scores and boundary caches.
Multiclass runs use LIBSVM's one-versus-one C-SVC.

The selected model's scatter plot overlays the dark **zero contour of the
continuous decision function `f(d1,d2) = 0`**, computed from the fitted support
vectors, coefficients, γ and ρ. In standardized coordinates `z`,
`f(z) = Σ coefficient_i exp(-γ ||z - SV_i||²) - ρ`. The chart stays in the
original d1/d2 units. Contours are found on demand using 128 × 128 samples,
marching squares and refined edge roots; class IDs are not interpolated to
construct the boundary. Multiclass runs show the active parts of pairwise
`f_ij = 0` contours, excluding contours hidden within another winning category.
Category colors, training/verification markers, SISSO hulls, and official overlap
scores retain their existing meaning. A model predicting one category across
the displayed range has no boundary in that range. Thumbnail cards retain the
training hull previews and add SVM accuracy; open any model to see its boundary.

Cards, the ranking table and model detail show **training** and, when fully
labeled, **verification** scores. The table and detail provide **accuracy,
balanced accuracy and Macro-F1**. Choose any score in **Sort by** after training
finishes or stops: higher scores come first, ties use official rank, and missing
or failed results go last. **Export ranks** follows this order and includes SVM
status, C, resolved γ, complexity, scores as fractions, and any missing-score reason.

Training scores are in-sample, not a generalization estimate. Verification
samples/labels never affect fitting or scaling. Balanced accuracy averages
recall over categories present in the evaluated dataset; Macro-F1 averages over
all training categories with undefined F1 set to zero. Set verification classes
with the existing **Set classes / Edit classes** controls when needed. Saving
new verification labels while SVM is enabled discards old scores and retrains.
Invalid training coordinates fail only that candidate; non-finite verification
coordinates suppress its verification scores instead of silently dropping rows.

Fits and scores are held for the current analysis only. Turning SVM off,
loading another run or refreshing clears them; enabling SVM is always manual.
After training, expand **Full RBF-SVM decision formula** in a model's detail to
view, copy or export its numeric decision functions. The text includes the SISSO
descriptors, training-only standardization, every support-vector term, class
mapping and multiclass voting/tie rules.
The formula viewer scrolls and supports 75–200% text zoom with a reset button;
zoom changes the display only and preserves the copied/exported coefficients.

While SVM is enabled, **Pareto front** supports training/verification accuracy,
balanced accuracy and Macro-F1 in 2D or 3D, as well as absolute train–verification
gaps. Scores are maximized and absolute gaps minimized. Numeric filters, excluded
models and CSV export use the same scores as the plot; incomplete or failed
scores are omitted. Training or cancelled jobs may show a partial front. Click
a point or row to return to that candidate's classification detail. Verification
axes require complete labels. Selecting models on verification scores still
requires a held-out test for final performance claims.

Serve this folder over HTTP as described below so the local worker can load.
The pinned browser library and licenses are in [`js/vendor`](js/vendor/README.md);
no CDN, backend or package installation is needed.

For a small reproducible nonlinear example, load all six files in
[`test/fixtures/rbf-svm`](test/fixtures/rbf-svm). At the default settings, model 1
has 100% training/verification accuracy, while model 2 has 50%.
For a visibly curved, closed `f(d1,d2)=0` boundary and complexity controls, use
the six files in [`test/fixtures/rbf-svm-circle`](test/fixtures/rbf-svm-circle).

## Multi-task runs (MT-SISSO)

MT-SISSO (`ntask > 1` in `SISSO.in`) reuses the single-task file names but
changes two things the analyzer has to know about. Everything else — the ranked
model file, `Uspace.expressions`, the point inspector, the usage tables — works
unchanged.

| | single-task | MT-SISSO |
|---|---|---|
| `train.dat` | one table | **one header, then the task blocks stacked vertically**, in `SISSO.in`'s `nsample=n1,n2,…` order |
| `verify.dat` | optional hold-out file | **not produced** — there is nothing to hold out |
| `Models/top*_coeff` | header `Model_ID c0 c1 …`; one row = `[c0, c1…cn]` | header `Model_ID, [(c_i,i=0,n)_j,j=1,ntask]`; one row = **ntask consecutive `[c0, c1…cn]` blocks**, one per task |
| descriptors | — | the Uspace descriptor set is **shared by every task**; only the coefficients differ |
| `Models/top*` `RMSE`/`MaxAE` | the model's score | the **task-aggregated** score: `RMSE = sqrt(Σ wᵢ·RMSEᵢ²)` (`wᵢ = 1/ntask` for `task_weighting=1`, `wᵢ = nᵢ/Σn` for `2`) and `MaxAE = maxᵢ MaxAEᵢ` |
| `SISSO.in` / `SISSO.out` | optional extras | **needed** — `ntask` / `nsample` is what splits the stacked `train.dat` back into tasks |

What the analyzer does with that:

- **Datasets.** A multi-task run exposes `train` = the whole pooled `train.dat`
  plus one dataset per task (`t1`, `t2`, …). Every view is dataset-driven, so the
  table gains a `RMSE (task n)` column per task, the Pareto axes let you trade a
  pooled metric against a per-task one, and the thumbnails overlay the tasks in
  distinct colours. The detail dialog's "Predicted vs true" scatter draws **every
  task at once — one series, colour and symbol per task** — and its dataset
  selector (`all` by default, plus each dataset on its own) narrows that down to
  a single task when you want a closer look; the same selector drives the
  residual histogram, whose statistics panel names the slice it describes.
  (The pooled series is left out of the "all" view because it is the exact
  concatenation of the task blocks — drawing it too would double every point.)
- **Formulas.** The model-formula column shows the task 1 coefficients; the
  detail dialog and *Copy formula* list every task's formula, and the CSV export
  writes one file per dataset (`sisso-model-{rank}-t1.csv`, …).
- **Two RMSEs, both shown.** *pooled* is the error over every sample in
  `train.dat`; *SISSO overall* is the task-aggregated number SISSO writes in the
  ranked-model file (shown verbatim, not recomputed). They differ whenever
  `task_weighting=1` and the tasks have different sizes.
- **Pooled R² / ρ are flagged.** R² and ρ are computed around the pooled mean, so
  on a multi-task run the between-task spread lands in the total sum of squares
  and both read optimistically — on the shipped example run the pooled R² is
  0.61 where the mean per-task R² is 0.53, even though all three tasks share one
  target property. Those columns therefore carry a tooltip, and the health check
  warns outright when the task targets sit further apart than they vary
  internally (`mt-pooled`), which is the case where pooling stops being
  defensible at all. The per-task values and SISSO's task-aggregated RMSE are the
  numbers to read.
- **Health check.** A multi-task run reports its task split (`42 + 33 + 28 = 103`),
  re-derives SISSO's overall RMSE / MaxAE for sampled models straight from the
  coefficient blocks, and cross-checks everything the run declares against the
  layout the files actually have (declared `ntask` / `desc_dim` vs. the
  coefficient rows). Because MaxAE = maxᵢ MaxAEᵢ holds in every weighting scheme,
  a MaxAE mismatch means the task split or block order was read wrongly and is
  **blocking**, while an RMSE-only mismatch is a different aggregation
  convention and stays a warning. Missing `SISSO.in`/`SISSO.out`, counts that do
  not add up to the rows in `train.dat`, a truncated coefficient file, a
  ranked-model file that mixes descriptor dimensions are all blocking errors.
  Classification uses its own parsing and health-check path. A `verify.dat` dropped in with an
  MT run is ignored with a warning — a hold-out row carries no task identity.

## Run locally

```bash
python -m http.server 8080
# or
npx serve .
```

Open http://localhost:8080.

## Tests

Dependency-free Node scripts (no `package.json`, no `node_modules`):

```bash
node test/mt_sisso.test.mjs     # MT-SISSO parsing / coefficients / aggregation
node test/ui_smoke.test.mjs     # the real app.js driven through a DOM shim
node test/classification.test.mjs # classification parsing, projections and official evidence
node test/svm.test.mjs            # real RBF-SVM fits, leakage guards, metrics and boundary worker
node test/svm_controller.test.mjs # opt-in, cancellation, stale jobs and boundary cache
node test/svm_decision.test.mjs   # continuous f=0 roots, native decision agreement and complexity
```

…plus the rest of `test/*.test.mjs`. The two suites above also use the
`dontUpdate/MT-SISSO` run as a fixture when it is present (it is not committed),
and skip that section otherwise. Against that fixture the analyzer reproduces
SISSO's own overall RMSE / MaxAE for **all 1000** ranked models to within the
6-decimal rounding of the ranked-model file — the strongest available check that
the multi-task coefficient layout is read correctly.


## About SISSO

SISSO-Analyzer works with output from [SISSO](https://github.com/rouyang2017/SISSO).
For details of the method, see:

> R. Ouyang, S. Curtarolo, E. Ahmetcik, M. Scheffler, and L. M. Ghiringhelli, Phys. Rev. Mater. 2, 083802 (2018).

## Maintainer

[chen121760](https://chen121760.github.io/)
