# Built-in example run (demo)

This folder holds the **sanitized** dataset behind the "Try the example model"
button on the home page. Column labels, the target column and sample ids have
been replaced with neutral tokens (`f_001…`, `target`, `s0001…`), feature
columns were re-ordered with a fixed seed, and every reference to the original
labels inside `Uspace.expressions` / `SISSO.out` was rewritten consistently.
The numeric values are untouched, so this demo is numerically identical to the
original run (verified: all 232 models, zero metric difference).

Files:

| file | role |
|---|---|
| `train.dat` | training data (75 rows, 246 columns: name + target + 244 descriptors) |
| `verify.dat` | hold-out data (28 rows) |
| `SIS_subspaces/Uspace.expressions` | feature expressions referenced by the models |
| `Models/top0232_D001` | 232 ranked 1D models (RMSE / MaxAE / feature ids) |
| `Models/top0232_D001_coeff` | model coefficients |
| `SISSO.in` / `SISSO.out` | run settings & unit matrix (optional, enriches cards/units view) |

Regenerate (after editing the source job, e.g. a new model):

```bash
node tools/make-demo.js     # writes demo/* and js/demo-data.js
node tools/verify-demo.js   # leak check + numerical-identity check vs the source run
```

The source job lives under `dontUpdate/` and is **not** part of the demo;
`js/demo-data.js` is what actually ships with the page.
