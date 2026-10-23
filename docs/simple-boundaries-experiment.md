# Simple classification boundaries — experiment

This branch tests fixed-size binary classification rules on two SISSO descriptors.
`js/sisso-simple-boundaries.js` reuses the browser's Logistic solver and exports
`fit`, `predict` and `formula` through CommonJS or `SissoSimpleBoundaries`.
The classification page offers **Enable simple boundaries for all models**
alongside RBF-SVM. Both can run at the same time, with independent controls,
workers, scores and cancellation.

Select a template and regularization, then click **Retrain all models** to
apply changes. Existing scores remain tied to the previous fit until then.
The candidate table and thumbnails show both classifiers; score sorting and
ranking CSV include the selected simple template. Model details show both
metric tables and decision functions, with copy, text export and zoom.
The simple formula is expanded by default.

The descriptor plot overlays a dashed simple boundary and a solid RBF-SVM
boundary. Pareto axes can compare the two classifiers or different metrics
from either classifier. Missing verification scores are omitted from the
front. Changing labels or loading a new run invalidates both classifiers.

| Family | Decision score g(d1,d2) | Score coefficients |
| --- | --- | --- |
| Linear | b0 + b1 d1 + b2 d2 | 3 |
| Parabolic (`quadratic`) | b0 + b1 d1 + b2 d1² + b3 d2 | 4 |
| Reciprocal | b0 + b1/d1 + b2 d2 | 3 |

Class 1 is selected when g >= 0, otherwise class 0. The parabolic template
represents d2 as a quadratic in d1 when its d2 coefficient is nonzero; it is
not a general rotated quadratic curve. Descriptor order is preserved.

Training uses the existing binary Logistic objective with default lambda = 0.01 and
threshold = 0.5. Coordinate scaling and feature standardization are fitted on
training points only. Full-precision score coefficients are exported in the
original descriptor units. Normalized coordinates are retained explicitly if
unit conversion would overflow or erase a nonzero coefficient.

Reciprocal fits reject training points with |d1 / training-max-abs-d1| <= 1e-12.
Verification points meeting that condition receive `invalid`. The webpage
withholds verification scores for the entire candidate when any prediction is
invalid, matching the SVM comparison policy. No training rows are silently
removed. Nonconverged fits have no webpage scores. The command-line experiment
below additionally records invalid-row coverage and excludes incomplete
cohorts from its shortlist.

To compare every candidate in one native SISSO archive:

```sh
node tools/compare-simple-boundaries.mjs test/2D2F-1K.zip /tmp/simple-boundaries.csv
node test/simple_boundaries.test.mjs
```

The script requires complete binary verification labels, selects the outer run
and leaves nested smoke runs unused. It writes all candidate/family results to
CSV and a summary to `<output.csv>.json`. Top candidates are selected by
verification balanced accuracy, then Macro-F1 and original rank. Failed fits
and incomplete coverage are reported rather than assigned a zero score.

These are selection-validation results on fixed SISSO descriptors. This
experiment does not rerun descriptor selection inside cross-validation and
does not establish independent-test performance or physical interpretation.
The full model's complexity also includes the d1 and d2 expressions.
