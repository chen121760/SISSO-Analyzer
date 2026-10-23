# Synthetic SISSO++ examples

These small virtual data sets exercise the importer. They are **not results
obtained by running SISSO++**, and do not demonstrate the scientific quality or
selection behavior of the SISSO algorithm. Coefficients, coordinates and SVM
class predictions are deterministic examples chosen for testing.

The format follows the official repository's current default branch at commit
[`43b99110118a51b9f4983b02c8d781ae6f25456c`](https://gitlab.com/sissopp_developers/sissopp/-/commit/43b99110118a51b9f4983b02c8d781ae6f25456c),
checked on 2026-10-22. The reference sources are
[`tests/exec_test/default/sisso.json`](https://gitlab.com/sissopp_developers/sissopp/-/blob/43b99110118a51b9f4983b02c8d781ae6f25456c/tests/exec_test/default/sisso.json),
[`tests/exec_test/classification/sisso.json`](https://gitlab.com/sissopp_developers/sissopp/-/blob/43b99110118a51b9f4983b02c8d781ae6f25456c/tests/exec_test/classification/sisso.json),
and the `write` / `write_coefs` methods in
[`Model.cpp`](https://gitlab.com/sissopp_developers/sissopp/-/blob/43b99110118a51b9f4983b02c8d781ae6f25456c/src/descriptor_identifier/model/Model.cpp),
[`ModelRegressor.cpp`](https://gitlab.com/sissopp_developers/sissopp/-/blob/43b99110118a51b9f4983b02c8d781ae6f25456c/src/descriptor_identifier/model/ModelRegressor.cpp)
and [`ModelClassifier.cpp`](https://gitlab.com/sissopp_developers/sissopp/-/blob/43b99110118a51b9f4983b02c8d781ae6f25456c/src/descriptor_identifier/model/ModelClassifier.cpp).
Log models additionally follow
[`tests/exec_test/log_reg/sisso.json`](https://gitlab.com/sissopp_developers/sissopp/-/blob/43b99110118a51b9f4983b02c8d781ae6f25456c/tests/exec_test/log_reg/sisso.json)
and [`ModelLogRegressor.cpp`](https://gitlab.com/sissopp_developers/sissopp/-/blob/43b99110118a51b9f4983b02c8d781ae6f25456c/src/descriptor_identifier/model/ModelLogRegressor.cpp).

Select **one example folder** in the analyzer, or zip that folder and drop the
archive onto the upload area:

- `regression`: 1D/2D models, a quoted sample ID, and the official shared
  `../data.csv` configuration layout. Select the `regression` directory, so both
  `data.csv` and the `default` subdirectory are included.
- `multi-task`: two task-specific formulas and a test set whose task order
  differs from the training blocks.
- `classification-1d`: convex-hull overlap and an incorrect SVM prediction are
  separate facts; the SVM class is not an official SISSO YES/NO marker.
- `classification-2d`: two separated triangular training hulls and one test point.
- `log-regression` and `log-multi-task`: multiplicative models with separate
  native log losses and metrics computed on the original target scale.
- `classification-davies-bouldin`, `classification-silhouette`, and
  `classification-calinski-harabasz`: native classification losses without an
  invented convex-hull overlap score.

The nine ZIP archives are ready to drop into the analyzer. Regenerate both the
folders and ZIP files with `node tools/generate-sisso-plus-plus-fixtures.mjs`.
Run `node test/sisso_plus_plus.test.mjs` and `node test/ui_smoke.test.mjs` to verify
the numbers, import flow, saved projects and existing SISSO behavior.
