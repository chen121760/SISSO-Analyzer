# Simple classification boundaries — experiment

This branch tests fixed-size binary classification rules on two SISSO descriptors.
`js/sisso-simple-boundaries.js` reuses the browser's Logistic solver and exports
`fit`, `predict` and `formula` through CommonJS or `SissoSimpleBoundaries`.
The prototype is not yet connected to the page controls.

| Family | Decision score g(d1,d2) | Score coefficients |
| --- | --- | --- |
| Linear | b0 + b1 d1 + b2 d2 | 3 |
| Parabolic (`quadratic`) | b0 + b1 d1 + b2 d1² + b3 d2 | 4 |
| Reciprocal | b0 + b1/d1 + b2 d2 | 3 |

Class 1 is selected when g >= 0, otherwise class 0. The parabolic template
represents d2 as a quadratic in d1 when its d2 coefficient is nonzero; it is
not a general rotated quadratic curve. Descriptor order is preserved.

Training uses the existing binary Logistic objective with lambda = 0.01 and
threshold = 0.5. Coordinate scaling and feature standardization are fitted on
training points only. Full-precision score coefficients are exported in the
original descriptor units. Normalized coordinates are retained explicitly if
unit conversion would overflow or erase a nonzero coefficient.

Reciprocal fits reject training points with |d1 / training-max-abs-d1| <= 1e-12.
Verification points meeting that condition receive `invalid`, with reduced
coverage. No training rows are silently removed, and comparisons retain the
entire verification cohort. Nonconverged fits are recorded separately.

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
