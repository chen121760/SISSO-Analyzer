# Post-evaluation / 后评价

After loading a SISSO run, open **Post-evaluation / 后评价** in the navigation.
Select one model, dataset and prediction rule, then click **Evaluate / 开始评价**.
The calculation runs in a Web Worker; Cancel, navigating away, or changing a
setting terminates it. Single-model evaluation fits only the selected candidate.
**Evaluate all candidates / 批量评价全部候选** screens every candidate under the
same protocol; classification runs both geometry and auxiliary Logistic.
Configuration and imported prediction bundles are saved with the project;
older version-1 projects continue to open without evaluation settings.

Use a local HTTP server if your browser blocks workers under `file://`:

```powershell
cd E:\uspex-jw\SISSO-Analyzer
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765`. Files and calculations remain local. All code is
client-side; no new CDN, service, dependency or server-side training is required.

## Interpretation

- **Official YES/NO** remains the original SISSO geometrical evidence. It does
  not become a prediction label or T/F. See [SISSO DI.f90](https://github.com/rouyang2017/SISSO/blob/master/src/DI.f90).
- **Training domains + rejection** fits 1D intervals or 2D convex hulls using
  training labels only. Exactly one hit gives a class; multiple hits are
  `ambiguous`; no hit is `out-of-domain`. Nonfinite descriptors are `invalid`.
  Point and line-segment domains are supported. The tolerance is `1e-10` after
  per-axis max-absolute training scaling, and is included in the manifest.
  This is a new declared prediction rule, not a reproduction of SISSO's bwidth
  algorithm. Geometry prediction is disabled if any class has `isconvex=0`.
- **Auxiliary Logistic** fits multinomial logistic regression on the selected
  SISSO descriptors, with training-only mean/population-standard-deviation
  scaling. The objective is mean cross entropy + `lambda/2 * sum(slopes²)`;
  intercepts are unpenalized. Default lambda is 0.01. Full-batch deterministic
  optimization stops at gradient norm below `1e-7`: binary classification uses
  damped Newton on the equivalent log-odds objective (maximum 100 iterations),
  and multiclass uses full-batch gradient descent (maximum 4000 steps). The fit,
  convergence flag and transformations are exported. This auxiliary classifier
  changes the prediction rule; it is not official SISSO classification.
- **T/F** is true/false only for accepted predictions with known labels.
  Rejected, invalid and unlabelled rows have blank correctness. Confusion matrices
  include a rejection column. Overall accuracy divides by **all labelled rows**;
  selective accuracy divides by **accepted labelled rows**. Coverage divides by
  **all input rows**, including unlabelled rows. Recall/F1 penalize rejection.
  MCC uses an extra rejection category (zero true support); undefined MCC is
  blank. Balanced accuracy and macro F1 are withheld if any declared class is
  absent; per-class support remains visible. Precision is zero if no prediction
  selects a class; recall is undefined for zero support. Binary TP/TN/FP/FN show
  accepted decisions, with rejected positives and negatives separately.
- **ROC/PR** require continuous scores and both positive and negative labelled
  samples. Ties are processed as one threshold. Binary Logistic uses log-odds to
  avoid saturated probability ties; multiclass ranking uses one-vs-rest
  probabilities. Changing the decision threshold does not change the scores or
  curves. AP uses recall increments weighted by precision, not trapezoidal PR
  area. Geometry-only decisions have no ROC/AP. See the official
  [ROC](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.roc_curve.html)
  and [AP definitions](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html).
- **Probability diagnosis** reports Brier, log loss (probability floor `1e-15`)
  and ten equal-width reliability bins for the selected one-vs-rest class.
  Binary Brier uses one positive-class probability; multiclass Brier sums over
  classes. These metrics use only rows with known labels and complete valid
  probability vectors; their count is shown. No probability recalibration is
  silently fitted. The auxiliary classifier's probabilities are uncalibrated;
  externally calibrated probabilities may be imported. See
  [calibration documentation](https://scikit-learn.org/stable/modules/calibration.html).
- **Regression** preserves the existing metrics and adds bias, median/P90/P95
  absolute error (linear-interpolated empirical quantiles), optional tolerance
  hit rate, and `1 − MSE_model/MSE_training-mean` baseline skill. Multi-task
  baselines use the corresponding task's training mean. Post-evaluation metrics
  use finite truth/prediction/residual pairs and disclose valid/invalid coverage;
  the original ranking-table metric policy is unchanged. Baseline skill is
  unavailable without a baseline or when its MSE is zero. Feature range checks
  and residual plots expose extrapolation and systematic error; they do not
  establish a validated applicability domain. Compare models on the same cohort.
- **Bootstrap** uses percentile intervals at 2.5% and 97.5%, fixed seed, and
  frozen predictions. Reported valid replicate counts expose undefined metrics
  (e.g. one-class resamples). Complete `group` fields select group resampling;
  otherwise the assumption is IID rows. These are exploratory conditional
  intervals, not selection-adjusted confidence intervals or proof of independence.

Training metrics describe fit. `verify.dat` defaults to selection validation.
Changing a role to test is a declaration, not proof of an independent split.
Selecting among 5000 models on the same 77 verification labels invalidates a
final-test interpretation. Preserve a held-out test set. See
[Cawley & Talbot (2010)](https://jmlr.org/papers/v11/cawley10a.html).

## Batch screening and ranking / 批量评价和排序

The batch button evaluates **all** current SISSO candidates. Classification
fits each rule using training labels and training-only preprocessing, then
reports both training and selected-dataset metrics. Positive class, L2 penalty,
decision threshold and dataset are fixed across candidates. The single-model
rank input is ignored; per-candidate Bootstrap is disabled. Use single-model
inspection for uncertainty or complete ROC/PR curves of a shortlist.

The table ranks accuracy, coverage, ROC AUC, AP and other available metrics;
regression candidates support error/baseline metrics. A rule filter and minimum
coverage threshold can be changed without refitting. Equal primary values share
a place, ordered by original SISSO rank and rule for reproducibility. No hidden
weighted aggregate defines a universal winner. Unavailable metrics, failed fits,
and nonconverged fits are retained below eligible candidates. AUC/AP eligibility
requires scores for **all labelled evaluation rows**, protecting comparisons
against silently dropping invalid predictions. Geometry provides no ROC/AP.

Only 100 rows render at a time. Progress counts model/rule evaluations (5000
candidates × 2 rules = 10000 evaluations); Cancel terminates the worker. Reused
descriptor projections use a bounded 1024-entry LRU cache. Batch summaries keep
counts and metrics instead of every candidate's sample rows/curves. Inspection
opens the single-model evaluator, with a return button for the cached ranking.
Ranking CSV exports all rows and both train/evaluation metrics; JSON also saves
the protocol, candidate status and input manifest. Ranking filters persist with
the project; computed batch results are exported, rather than silently stored
in IndexedDB with the raw SISSO run.

These rankings use the selected dataset's labels for **selection validation**,
even if it was originally called test. After screening 5000 candidates, the
leader's observed validation score is optimistic. An independent held-out test
or full-pipeline nested/grouped validation is still needed. Conditional Bootstrap
intervals of shortlisted models do not adjust for this selection.

Run the complete user example locally:

```powershell
node tools/evaluation-batch-case.mjs 2D2F-1K.zip local-evaluation/batch
python tools/verify-evaluation-batch.py local-evaluation/batch
```

This writes 10000 summaries, a sortable CSV, leaders for each metric, per-rule
Pareto trade-offs, selected models' detailed reports and independent audit inputs.
All successful summaries are compared with the single-model evaluator. NumPy
independently checks leaders and predefined dispersed ranks. Results contain
sample data and remain under the Git-ignored local-evaluation directory.

## Imported prediction bundles

The expandable import control accepts JSON up to 20 MiB. Required fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `taskType` | `classification` or `regression` |
| `modelId` | Reproducible frozen model or CV pipeline identifier |
| `trainingIds` | Complete unique sample IDs used to fit the frozen model |
| `classes` | Classification only: unique labels in score/probability column order |
| `datasets` | Named datasets with `id`, `role`, `rows` |
| `exchangeable` | Explicit exchangeability declaration for split conformal |
| `frozenBeforeCalibration` | Explicit declaration that the model and preprocessing were frozen before calibration |

Each row contains unique string `id`, numeric `yTrue` and `yPred` (or explicit
`null`). Classification values are zero-based class indices. Optional `scores`
and `probabilities` have one finite entry per class. Probabilities must be in
[0, 1] and sum to one within `1e-8`. If scores are omitted, probabilities supply
ranking scores. Imported yPred is preserved: the UI does not retune its threshold.
Optional regression `baseline` must be a prediction from a predefined baseline
fitted without evaluation labels. Optional string `group` must be present on all
rows of a dataset or none. IDs and supplied groups must be disjoint across
calibration and evaluation datasets. Evaluation IDs cannot overlap declared
training IDs. Identical underlying samples under different IDs cannot be detected.

Minimal regression example (illustrative, not a real case):

```json
{
  "schemaVersion": 1,
  "taskType": "regression",
  "modelId": "frozen-model-v1",
  "trainingIds": ["train-a", "train-b"],
  "datasets": [{
    "id": "held-out", "role": "test",
    "rows": [
      {"id": "test-a", "yTrue": 1.2, "yPred": 1.1, "baseline": 1.5},
      {"id": "test-b", "yTrue": 2.4, "yPred": 2.8, "baseline": 1.5}
    ]
  }]
}
```

For classification, add `classes: ["low", "high"]` and use rows such as
`{"id":"test-a","yTrue":1,"yPred":0,"scores":[0.8,0.2],"probabilities":[0.8,0.2]}`.
Provide actual held-out predictions, not the true class as a score.

### Cross-validation import

A `role: "fold"` dataset additionally needs its own `trainingIds` and
`descriptorSelection: "within-fold"` or `"fixed"`. Each fold is reported
separately; repeated sample IDs across folds are rejected, so repeated CV runs
must be imported as separate bundles. `within-fold` means the producer reran
**all SISSO descriptor selection inside each fold**; `fixed` only assesses
the subsequent fit. The browser does not run SISSO or verify the producer's
declaration. It does not pretend that refitting a downstream classifier on
whole-data-selected descriptors is full-pipeline CV.

### Split conformal

Supply exactly one separate `role: "calibration"` dataset for the same frozen
model, and set both declarations above to true. Only a separate test/validation
dataset can receive conformal output. Calibration scores are `abs(y−prediction)`
for regression and `1−p_true` for classification. The threshold is the
`ceil((n_cal+1)*(1−alpha))` order statistic. If that rank exceeds calibration n,
the region is unbounded / all classes; JSON explicitly marks `unbounded=true`
instead of claiming a finite interval. Regression intervals and classification
sets, observed coverage, evaluated count, width / mean set size are exported.
Every calibration row must have a usable labelled prediction.

These outputs require exchangeability and calibration independence. Fitting a
probability calibrator on the same rows used to construct conformal sets does
not satisfy the frozen-model requirement. Use separate data if both are needed.
No independent calibration data means no claimed guarantee. See
[Angelopoulos & Bates](https://arxiv.org/abs/2107.07511).

## Architecture and verification

- `js/sisso-evaluation.js`: pure UMD computation, metric metadata, strict import
  validation, frozen-prediction uncertainty and conformal helpers.
- `js/evaluation-worker.js`: selected-model/batch computation, SHA-256 input manifest
  where secure-context Web Crypto is available, cancellation by termination.
- `js/evaluation-ui.js`: existing styles and English/Chinese labels; separate
  workspace, charts, tables and CSV/JSON export. Data is inserted as text.
- `app.js`: only navigation and project persistence hooks; original pipelines
  and official SISSO evidence remain available.
- `js/sisso-evaluation-batch.js`: shared batch engine for browser/Node, cached
  projections, cohort-aware eligibility, stable metric ranking and summary CSV.

Run `node test/evaluation.test.mjs` and all existing `test/*.test.mjs` suites.
Run the provided real archive locally:

```powershell
node tools/evaluation-case.mjs 2D2F-1K.zip local-evaluation
python tools/verify-evaluation.py local-evaluation
```

The second command needs NumPy and independently checks the binary fit with
Newton optimization, pairwise ROC AUC, AP, probability metrics and confusion
counts. `local-evaluation/case-report.md` links the case protocol to all saved
CSV/JSON results; that directory is ignored by Git because it contains sample
data. No results are automatically pushed or merged.
