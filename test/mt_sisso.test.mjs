// mt_sisso.test.mjs — multi-task (MT-SISSO) support in the analysis engine.
//
// MT-SISSO (SISSO 3.5, ntask > 1) reuses the single-task file names but changes
// two things the analyzer has to understand:
//   1. train.dat = one header + the task blocks stacked vertically, whose sizes
//      come from SISSO.in's `nsample=n1,n2,…` (or SISSO.out's task line);
//   2. the *_coeff file stores, per model row, ntask consecutive blocks of
//      [c0, c1 … cn] — one block per task — over a descriptor set shared by
//      every task.
// These tests pin down:
//   • the SISSO.in / SISSO.out task parsing (with single-task compatibility),
//   • coefficient splitting into per-task blocks,
//   • per-task metrics, the pooled "train" dataset, and SISSO's own overall
//     score (task_weighting = 1 and 2),
//   • the real `dontUpdate/MT-SISSO` fixture, when it is present: every one of
//     its 1000 models must reproduce SISSO's own overall RMSE / MaxAE.
//
// Run: node test/mt_sisso.test.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let failures = 0;
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}
function assertEq(actual, expected, label) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assertClose(actual, expected, tol, label) {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${actual}, want ${expected} (±${tol})`);
}

// ---------------------------------------------------------------------------
// 1. SISSO.in / SISSO.out task parsing
// ---------------------------------------------------------------------------
{
  const mtIn = [
    "ptype=1                !Property type 1: regression, 2:classification.",
    "ntask=3                !(R&C) Multi-task learning (MTL) is invoked if >1.",
    "scmt=.false.           !(R) Sign-Constrained MTL is invoked if .true.",
    "task_weighting=1       !(R) MTL only: 1 = every task counts the same; 2 = weighted by n_i/sum(n).",
    "desc_dim=2",
    "nsample=42,33,28       !(R) Samples per task, in the order they appear in train.dat.",
    "nsf= 244               !(R&C) Number of scalar features provided in the file train.dat",
    "fcomplexity=1",
  ].join("\n");
  const info = core.parseSissoIn(mtIn);
  assertEq(info.ntask, 3, "MT SISSO.in: ntask = 3");
  assertEq(info.nsample, 42, "MT SISSO.in: legacy nsample keeps the first count");
  assertEq(JSON.stringify(info.nsamples), JSON.stringify([42, 33, 28]), "MT SISSO.in: full nsample list");
  assertEq(info.taskWeighting, 1, "MT SISSO.in: task_weighting = 1");
  assertEq(info.scmt, false, "MT SISSO.in: scmt = .false.");
  assertEq(info.descDim, 2, "MT SISSO.in: desc_dim = 2");
  assertEq(info.nsf, 244, "MT SISSO.in: nsf = 244");
  assertEq(info.fcomplexity, 1, "MT SISSO.in: fcomplexity = 1");

  // Single-task file: nothing about tasks must leak into the old fields.
  const stIn = "ptype=1\ndesc_dim=1\nnsample=75\nnsf=244\nfcomplexity=2\nscmt=.true.\n";
  const st = core.parseSissoIn(stIn);
  assertEq(st.nsample, 75, "single-task SISSO.in: nsample = 75");
  assertEq(st.ntask, 1, "single-task SISSO.in: ntask collapses to 1");
  assertEq(st.scmt, true, "single-task SISSO.in: scmt = .true.");
  assertEq(st.descDim, 1, "single-task SISSO.in: desc_dim = 1");
  assertEq(st.fcomplexity, 2, "single-task SISSO.in: fcomplexity = 2");

  const out = core.parseSissoOutTasks([
    "Standard Deviation (sqrt[sum(y-y_mean)^2/n]) of the target property of task 001:    0.95967",
    "Standard Deviation (sqrt[sum(y-y_mean)^2/n]) of the target property of task 002:    0.99516",
    "Standard Deviation (sqrt[sum(y-y_mean)^2/n]) of the target property of task 003:    0.70563",
    "Property type:     1",
    "Number of tasks:        3",
    "Number of samples for the task(s):     42    33    28",
    "Task_weighting:        1",
    "Sign-constrained multi-task learning:      F",
  ].join("\n"));
  assertEq(out.ntask, 3, "SISSO.out: Number of tasks = 3");
  assertEq(JSON.stringify(out.nsamples), JSON.stringify([42, 33, 28]), "SISSO.out: task sample counts");
  assertEq(out.taskWeighting, 1, "SISSO.out: Task_weighting = 1");
  assertEq(out.scmt, false, "SISSO.out: sign-constrained = F");
  assertEq(out.taskStd.length, 3, "SISSO.out: three task standard deviations");
  assertClose(out.taskStd[0], 0.95967, 1e-9, "SISSO.out: task 1 std");

  assertEq(core.parseSissoOutTasks("nothing here"), null, "SISSO.out without task info → null");
}

// ---------------------------------------------------------------------------
// 2. coefficient rows split into per-task blocks
// ---------------------------------------------------------------------------
{
  const blocks = core.taskCoeffBlocks([-10.37427074, 0.2807626516, 0.00169723831,
    -7.832704237, 0.1539633203, 0.0009200336929,
    -7.30803393, 0.03538233926, 0.001956967702], 3);
  assertEq(blocks.length, 3, "taskCoeffBlocks: three blocks");
  assertEq(blocks[0].length, 3, "taskCoeffBlocks: intercept + 2 descriptors");
  assertClose(blocks[0][0], -10.37427074, 0, "taskCoeffBlocks: block 1 intercept");
  assertClose(blocks[1][0], -7.832704237, 0, "taskCoeffBlocks: block 2 intercept");
  assertClose(blocks[2][0], -7.30803393, 0, "taskCoeffBlocks: block 3 intercept");
  assertEq(core.taskCoeffBlocks([1, 2, 3], 2), null, "taskCoeffBlocks: non-multiple → null");
}

// ---------------------------------------------------------------------------
// 3. hand-made two-task run: per-task metrics, pooled dataset, aggregation
// ---------------------------------------------------------------------------
const MT_TRAIN = `name target f1
A1 1 1
A2 2 2
A3 3 3
B1 5 4
B2 7 5
`;
const MT_TOP = "Rank RMSE MaxAE Feature_ID\n" +
  "1 1.118034 2.0 ( 1)\n" +
  "2 2.309401 3.0 ( 1)\n";
const MT_COEFF = "Model_ID, [(c_i,i=0,n)_j,j=1,ntask]\n" +
  "1 0 1 0 1\n" +
  "2 1 0 0 2\n";
const MT_USPACE = "(f1) SIS_score = 0.9\n(f2) SIS_score = 0.5\n";
const MT_IN = "ptype=1\nntask=2\ntask_weighting=1\ndesc_dim=1\nnsample=3,2\nnsf=2\n";
const MT_OUT = "Number of tasks:        2\n" +
  "Number of samples for the task(s):     3    2\n" +
  "Task_weighting:        1\n";

function runMt(over) {
  return core.runPipeline(Object.assign({
    trainText: MT_TRAIN,
    topText: MT_TOP,
    coeffText: MT_COEFF,
    uspaceText: MT_USPACE,
    sissoInText: MT_IN,
    sissoOutText: MT_OUT,
  }, over || {}));
}

// The same fixture in the pipeline's own file-key spelling (used where a test
// needs the raw key names rather than the runMt() shorthand).
function baseFiles() {
  return {
    trainText: MT_TRAIN,
    topText: MT_TOP,
    coeffText: MT_COEFF,
    uspaceText: MT_USPACE,
    sissoInText: MT_IN,
    sissoOutText: MT_OUT,
  };
}

{
  const res = runMt();
  assertEq(res.meta.multiTask, true, "MT run: meta.multiTask");
  assertEq(res.meta.ntask, 2, "MT run: meta.ntask = 2");
  assertEq(JSON.stringify(res.meta.nsamples), JSON.stringify([3, 2]), "MT run: meta.nsamples");
  assertEq(res.meta.taskSizeSource, "SISSO.in", "MT run: task sizes come from SISSO.in");
  assertEq(JSON.stringify(core.availableDatasets(res)), JSON.stringify(["train", "t1", "t2"]),
    "MT run: datasets are train + t1 + t2");
  assertEq(res.verify, null, "MT run: no verify dataset");
  assertEq(res.tasks.length, 2, "MT run: two task slices");
  assertEq(res.tasks[0].n, 3, "MT run: task 1 has 3 rows");
  assertEq(res.tasks[1].n, 2, "MT run: task 2 has 2 rows");
  assertEq(res.tasks[1].start, 3, "MT run: task 2 starts at row 3");
  assertEq(res.tasks[0].label, "task_001", "MT run: task 1 label");
  assertEq(res.tasks[0].data.n, 3, "MT run: task 1 dataset slice");

  const m1 = res.models[0];
  const m2 = res.models[1];
  // task A: y = f1 exactly; task B: y − f1 = 1, 2  →  RMSE sqrt(2.5)
  assertClose(core.metricValue(m1, "t1", "rmse"), 0, 1e-12, "model 1 task 1 RMSE = 0");
  assertClose(core.metricValue(m1, "t2", "rmse"), Math.sqrt(2.5), 1e-12, "model 1 task 2 RMSE = sqrt(2.5)");
  assertClose(core.metricValue(m1, "t2", "maxae"), 2, 1e-12, "model 1 task 2 MaxAE = 2");
  // pooled over all five rows: sqrt(5/5) = 1
  assertClose(core.metricValue(m1, "train", "rmse"), 1, 1e-12, "model 1 pooled RMSE = 1");
  // SISSO's own overall score (task-balanced): sqrt((0 + 2.5)/2)
  assertClose(m1.overallRmse, Math.sqrt(1.25), 1e-12, "model 1 SISSO overall RMSE = sqrt(1.25)");
  assertClose(m1.overallMaxae, 2, 1e-12, "model 1 SISSO overall MaxAE = 2");
  assertEq(m1.overallRmse !== m1.metricsTrain.rmse, true,
    "MT run: SISSO overall RMSE differs from the pooled RMSE");

  // model 2: task A pred = 1 → errors 0,−1,−2 ; task B pred = 2*f1 → 3, 3
  assertClose(core.metricValue(m2, "t1", "rmse"), Math.sqrt(5 / 3), 1e-12, "model 2 task 1 RMSE");
  assertClose(core.metricValue(m2, "t2", "rmse"), 3, 1e-12, "model 2 task 2 RMSE = 3");
  assertClose(m2.overallRmse, Math.sqrt((5 / 3 + 9) / 2), 1e-12, "model 2 SISSO overall RMSE");
  assertClose(m2.overallMaxae, 3, 1e-12, "model 2 SISSO overall MaxAE = 3");

  // formulas: one per task, sharing descriptors, with the task's coefficients
  assertEq(m1.formulasOriginalByTask.length, 2, "MT run: two formulas per model");
  assertEq(m1.formulasOriginalByTask[0], "(0) + (1)*((f1))",
    "MT run: task 1 formula uses task 1 coefficients");
  assertEq(m1.formulasOriginalByTask[1], "(0) + (1)*((f1))",
    "MT run: task 2 formula is built for task 2");
  assertEq(m2.formulasOriginalByTask[1], "(0) + (2)*((f1))",
    "MT run: model 2 task 2 formula carries coefficient 2");
  assertEq(m1.descriptors.length, 1, "MT run: descriptors are shared across tasks");

  // legacy aliases stay meaningful: "train" is the pooled dataset
  assertEq(m1.metricsTrain, m1.metrics.train, "MT run: metricsTrain aliases the pooled metrics");
  assertEq(m1.predTrain, m1.pred.train, "MT run: predTrain aliases the pooled predictions");
  assertEq(m1.metricsVerify, null, "MT run: metricsVerify stays null without verify.dat");
  assertEq(m1.pred.train.length, 5, "MT run: pooled predictions cover every row");
  assertClose(m1.pred.train[4], 5, 1e-12, "MT run: pooled prediction of the last row");

  // task slices are row-aligned views of train.dat
  const taskData = core.datasetData(res, "t2");
  assertEq(taskData.names[0], "B1", "MT run: task 2 slice keeps sample names");
  assertClose(taskData.cols[res.meta.targetLetter][0], 5, 0, "MT run: task 2 slice keeps the target");

  // the same accessors the UI reads agree with the metric map
  assertClose(core.metricValue(m2, "t2", "rmse"), m2.metrics.t2.rmse, 0,
    "MT run: metricValue matches the metric map");
  assertEq(core.modelPrediction(m2, "t2").length, 2, "MT run: modelPrediction returns the task series");
}

// ---------------------------------------------------------------------------
// 4. task_weighting = 2 makes SISSO's overall RMSE the pooled RMSE
// ---------------------------------------------------------------------------
{
  const res = runMt({ sissoInText: MT_IN.replace("task_weighting=1", "task_weighting=2") });
  assertEq(res.meta.taskWeighting, 2, "weighted MT run: task_weighting = 2");
  const m2 = res.models[1];
  assertClose(m2.overallRmse, m2.metricsTrain.rmse, 1e-12,
    "weighted MT run: overall RMSE == pooled RMSE (w_i = n_i/N)");
  assertClose(m2.overallRmse, Math.sqrt(4.6), 1e-12, "weighted MT run: overall RMSE = sqrt(4.6)");
}

// ---------------------------------------------------------------------------
// 5. task sizes fall back to SISSO.out, and mismatch / absence are loud
// ---------------------------------------------------------------------------
{
  const res = runMt({ sissoInText: undefined });
  assertEq(res.meta.taskSizeSource, "SISSO.out", "MT run: falls back to SISSO.out task sizes");
  assertEq(res.meta.ntask, 2, "MT run: ntask from SISSO.out");

  let threw = null;
  try { runMt({ sissoInText: undefined, sissoOutText: undefined }); } catch (e) { threw = e; }
  assert(threw && /task/i.test(threw.message),
    "MT run without task sizes → explanatory error");

  threw = null;
  try { runMt({ sissoInText: MT_IN.replace("nsample=3,2", "nsample=2,2") }); } catch (e) { threw = e; }
  assert(threw && /stacked|add up|row/i.test(threw.message),
    "MT run with mismatching sample counts → explanatory error");
}

// ---------------------------------------------------------------------------
// 6. aggregation helper directly
// ---------------------------------------------------------------------------
{
  const ms = [{ rmse: 0, maxae: 0 }, { rmse: Math.sqrt(2.5), maxae: 2 }];
  assertClose(core.aggregateTaskMetrics(ms, [3, 2], 1).rmse, Math.sqrt(1.25), 1e-12,
    "aggregateTaskMetrics: task-balanced RMSE");
  assertClose(core.aggregateTaskMetrics(ms, [3, 2], 2).rmse, 1, 1e-12,
    "aggregateTaskMetrics: sample-weighted RMSE == pooled");
  assertClose(core.aggregateTaskMetrics(ms, [3, 2], 1).maxae, 2, 1e-12,
    "aggregateTaskMetrics: MaxAE = max over tasks");
}

// ---------------------------------------------------------------------------
// 7. single-task behaviour is untouched (demo run keeps train + verify)
// ---------------------------------------------------------------------------
{
  const demo = require("../js/demo-data.js").DEMO_DATA;
  const res = core.runPipeline({
    trainText: demo.train,
    verifyText: demo.verify,
    topText: demo.top,
    coeffText: demo.coeff,
    uspaceText: demo.uspace,
  });
  assertEq(!!res.meta.multiTask, false, "single-task run: multiTask flag is false");
  assertEq(res.meta.ntask, 1, "single-task run: ntask = 1");
  assertEq(res.tasks, null, "single-task run: no task slices");
  assertEq(JSON.stringify(core.availableDatasets(res)), JSON.stringify(["train", "verify"]),
    "single-task run: datasets stay train + verify");
  assertEq(!!res.models[0].formulasByTask, false, "single-task run: no per-task formulas");
  assertEq(!!res.models[0].metrics.verify, true, "single-task run: metrics map carries verify");
  assertEq(!!res.models[0].metricsTrain, true, "single-task run: metricsTrain still populated");
}

// ---------------------------------------------------------------------------
// 8. the real MT-SISSO fixture (skipped when dontUpdate/ is not checked out)
// ---------------------------------------------------------------------------
{
  const dir = path.join(ROOT, "dontUpdate", "MT-SISSO");
  const trainPath = path.join(dir, "train.dat");
  if (!fs.existsSync(trainPath)) {
    console.log("SKIP  real MT-SISSO fixture not present (dontUpdate/MT-SISSO)");
  } else {
    const read = (p) => fs.readFileSync(path.join(dir, p), "utf8");
    const res = core.runPipeline({
      trainText: read("train.dat"),
      topText: read(path.join("Models", "top1000_D002")),
      coeffText: read(path.join("Models", "top1000_D002_coeff")),
      uspaceText: read(path.join("SIS_subspaces", "Uspace.expressions")),
      sissoInText: read("SISSO.in"),
      sissoOutText: read("SISSO.out"),
    });
    assertEq(res.meta.multiTask, true, "fixture: multi-task run detected");
    assertEq(res.meta.ntask, 3, "fixture: 3 tasks");
    assertEq(JSON.stringify(res.meta.nsamples), JSON.stringify([42, 33, 28]), "fixture: task sizes");
    assertEq(res.meta.nTrain, 103, "fixture: 103 stacked rows");
    assertEq(res.meta.nModels, 1000, "fixture: 1000 models");
    assertEq(res.meta.targetName, "log10_D_cm2_s", "fixture: target column");
    assertClose(res.meta.taskStd[0], 0.95967, 1e-9, "fixture: task 1 target std from SISSO.out");

    // SISSO.out's top-1 model, per task, to the printed precision.
    const m1 = res.models[0];
    assertClose(core.metricValue(m1, "t1", "rmse"), 0.6548266835, 1e-9, "fixture: model 1 task 1 RMSE");
    assertClose(core.metricValue(m1, "t2", "rmse"), 0.6567790992, 1e-9, "fixture: model 1 task 2 RMSE");
    assertClose(core.metricValue(m1, "t3", "rmse"), 0.5027017991, 1e-9, "fixture: model 1 task 3 RMSE");
    assertClose(core.metricValue(m1, "t1", "maxae"), 2.673185371, 1e-8, "fixture: model 1 task 1 MaxAE");
    assertClose(m1.overallRmse, 0.609061, 5e-7, "fixture: model 1 overall RMSE matches SISSO");
    assertClose(m1.overallMaxae, 2.673185, 5e-7, "fixture: model 1 overall MaxAE matches SISSO");

    // Every model must reproduce the aggregate SISSO wrote in the top file.
    // This is the strongest possible check of the coefficient layout: the top
    // file's RMSE / MaxAE columns are the task-aggregated scores.
    let worstRmse = 0, worstMaxae = 0, mismatch = 0;
    for (const m of res.models) {
      const dr = Math.abs(m.overallRmse - m.rmseSisso);
      const dm = Math.abs(m.overallMaxae - m.maxaeSisso);
      if (dr > worstRmse) worstRmse = dr;
      if (dm > worstMaxae) worstMaxae = dm;
      if (dr > 5e-7 || dm > 5e-7) mismatch++;
    }
    assertEq(mismatch, 0, `fixture: all 1000 models reproduce SISSO's overall RMSE/MaxAE (worst Δ ${worstRmse.toExponential(2)} / ${worstMaxae.toExponential(2)})`);

    // The pooled "train" dataset is a genuine all-sample view, not an aggregate.
    const pooled = res.models[0].metricsTrain;
    assertClose(pooled.rmse, Math.sqrt((42 * 0.6548266835 ** 2 + 33 * 0.6567790992 ** 2 + 28 * 0.5027017991 ** 2) / 103),
      1e-6, "fixture: pooled RMSE is the sample-weighted (all-rows) RMSE");

    // Task slices really are the stacked blocks of train.dat.
    assertEq(res.tasks[0].data.names[0], "06ee38fa_Li8O8Ti2", "fixture: task 1 first sample");
    assertEq(res.tasks[1].data.names[0], res.train.names[42], "fixture: task 2 starts at row 43");
    assertEq(res.tasks[2].data.names[0], res.train.names[75], "fixture: task 3 starts at row 76");
  }
}

// ---------------------------------------------------------------------------
// 9. the Analysis Health Check understands the multi-task layout
// ---------------------------------------------------------------------------
{
  const health = require("../js/health-check.js");
  const base = {
    train: MT_TRAIN,
    top: MT_TOP,
    coeff: MT_COEFF,
    uspace: MT_USPACE,
    sissoIn: MT_IN,
    sissoOut: MT_OUT,
  };
  const r = health.check(base);
  // The hand-made fixture deliberately gives the two tasks different target
  // levels (1–3 vs 5–7), so the pooled-R²/ρ caveat fires — that is the point of
  // the fixture, not a defect.
  assertEq(r.level, "warning", "MT health check: heterogeneous mini run warns");
  assertEq(r.checks.filter((c) => c.level === "error").length, 0,
    "MT health check: the heterogeneity warning is not blocking");
  const pooledWarn = (r.checks || []).find((c) => c.id === "mt-pooled");
  assert(pooledWarn && pooledWarn.level === "warning",
    "MT health check: mt-pooled warns for heterogeneous task targets");
  assert(/pooled R²/.test(pooledWarn.message), "MT health check: mt-pooled explains the pooled R²");
  const mtTasks = (r.checks || []).find((c) => c.id === "mt-tasks");
  assert(mtTasks && mtTasks.level === "pass", "MT health check: mt-tasks Passed");
  assert(mtTasks.message.includes("2 task(s)") && mtTasks.message.includes("3 + 2"),
    "MT health check: mt-tasks reports the split");
  assert(mtTasks.message.includes("verify.dat"), "MT health check: notes the absent verify.dat");
  const agg = (r.checks || []).find((c) => c.id === "mt-aggregate");
  assert(agg && agg.level === "pass", "MT health check: mt-aggregate Passed");
  assertEq(r.dropVerify, false, "MT health check: nothing to drop");

  // Same shape, but the tasks now overlap in target level (means 2.0 vs 2.5 with
  // within-task std 0.82 / 0.50) -> pooling R² / ρ stays legitimate, so the run
  // is clean.
  const HOM_TRAIN = "name target f1\nA1 1 1\nA2 2 2\nA3 3 3\nB1 3 4\nB2 2 5\n";
  const HOM_TOP = "Rank RMSE MaxAE Feature_ID\n1 1.581139 3.0 ( 1)\n2 4.804511 8.0 ( 1)\n";
  const hom = health.check(Object.assign({}, base, { train: HOM_TRAIN, top: HOM_TOP }));
  const homPooled = (hom.checks || []).find((c) => c.id === "mt-pooled");
  assert(homPooled && homPooled.level === "pass",
    "MT health check: overlapping tasks keep the pooled R² / ρ comparable");
  assertEq(hom.level, "pass", "MT health check: homogeneous mini run passes");

  // No task sizes anywhere -> the analysis cannot split train.dat: blocking.
  const noSizes = health.check({ train: MT_TRAIN, top: MT_TOP, coeff: MT_COEFF, uspace: MT_USPACE });
  assertEq(noSizes.level, "error", "MT health check: missing task sizes is an error");
  assert(noSizes.checks.some((c) => c.id === "models" && c.message.includes("SISSO.in")),
    "MT health check: the error names SISSO.in");

  // Counts that do not add up to the rows present -> blocking.
  const badSplit = health.check(Object.assign({}, base, { sissoIn: MT_IN.replace("nsample=3,2", "nsample=3,3") }));
  assertEq(badSplit.level, "error", "MT health check: inconsistent sample counts is an error");

  // A truncated (ragged) coefficient file is caught before the pipeline.
  const ragged = health.check(Object.assign({}, base, {
    coeff: "Model_ID, [(c_i,i=0,n)_j,j=1,ntask]\n1 0 1 0 1\n2 1 0 0\n",
  }));
  assertEq(ragged.level, "error", "MT health check: ragged coefficient rows is an error");

  // Declared-vs-derived bookkeeping: a SISSO.in that disagrees with the
  // coefficient layout is a warning naming the keyword (the layout wins).
  const wrongNtask = health.check(Object.assign({}, base, {
    sissoIn: MT_IN.replace("ntask=2", "ntask=3"),
  }));
  const ntaskEntry = wrongNtask.checks.find((c) => /declare ntask=3/.test(c.message));
  assert(ntaskEntry && ntaskEntry.level === "warning",
    "MT health check: declared ntask contradicting the coefficient layout warns");
  const wrongDim = health.check(Object.assign({}, base, {
    sissoIn: MT_IN.replace("desc_dim=1", "desc_dim=4"),
  }));
  const dimEntry = wrongDim.checks.find((c) => /desc_dim=4/.test(c.message));
  assert(dimEntry && dimEntry.level === "warning",
    "MT health check: declared desc_dim contradicting the ranked models warns");

  // A ranked-model file whose models disagree on the descriptor dimension is
  // ambiguous: the health check must block, because the pipeline cannot parse it.
  const mixedTop = "Rank RMSE MaxAE Feature_ID\n" +
    "1 1.118034 2.0 ( 1)\n2 2.309401 3.0 ( 1)\n";
  const mixedTopBad = mixedTop.replace("2 2.309401 3.0 ( 1)", "2 2.309401 3.0 ( 1  2)");
  const mixed = health.check(Object.assign({}, base, { top: mixedTopBad }));
  assertEq(mixed.level, "error", "MT health check: mixed descriptor dimensions block");
  assert(mixed.checks.some((c) => /mixes descriptor dimensions/.test(c.message)),
    "MT health check: the mixed-dimension error explains itself");

  // ptype=2 is a classification run: error metrics are undefined, so it blocks
  // instead of silently producing regression statistics from class labels.
  const cls = health.check(Object.assign({}, base, { sissoIn: MT_IN.replace("ptype=1", "ptype=2") }));
  assertEq(cls.level, "error", "MT health check: a classification run blocks");
  assert(cls.checks.some((c) => /ptype=2 \(classification\)/.test(c.message)),
    "MT health check: the ptype error names classification");
  let clsThrew = null;
  try { core.runPipeline(Object.assign({}, baseFiles(), { sissoInText: MT_IN.replace("ptype=1", "ptype=2") })); }
  catch (e) { clsThrew = e; }
  assert(clsThrew && clsThrew.code === "ptype", "MT pipeline: ptype=2 also throws");

  // A verify.dat supplied with a multi-task run cannot be scored (hold-out rows
  // carry no task identity): it is ignored, and the run exposes no verify
  // dataset — not a set of permanently empty verify / Δ columns.
  const withVerify = core.runPipeline(Object.assign({}, baseFiles(), { verifyText: MT_TRAIN }));
  assertEq(withVerify.meta.verifyIgnored, true, "MT + verify: the verify file is reported as ignored");
  assertEq(withVerify.verify, null, "MT + verify: result.verify is cleared");
  assertEq(JSON.stringify(core.availableDatasets(withVerify)), JSON.stringify(["train", "t1", "t2"]),
    "MT + verify: no verify / Δ columns are offered");
  const vh = health.check(Object.assign({}, base, { verify: MT_TRAIN }));
  const vEntry = vh.checks.find((c) => c.id === "mt-verify");
  assert(vEntry && vEntry.level === "warning", "MT + verify: the health check warns it was ignored");

  // Single-task runs are untouched: the mini fixture keeps its old shape.
  const single = health.check({
    train: "name target f1\ns1 10 2\ns2 12 3\n",
    top: "Rank RMSE MaxAE Feature_ID\n1 0.9 2.0 ( 1)\n",
    coeff: "Model_ID c0 c1\n1 -1.0 0.5\n",
    uspace: "(f1) SIS_score = 0.1\n",
  });
  assertEq(single.level, "pass", "single-task health check still passes");
  assertEq((single.checks || []).some((c) => c.id === "mt-tasks"), false,
    "single-task health check produces no mt-tasks row");
}

// ---------------------------------------------------------------------------
// 10. the real fixture passes its own health check end to end
// ---------------------------------------------------------------------------
{
  const dir = path.join(ROOT, "dontUpdate", "MT-SISSO");
  if (!fs.existsSync(path.join(dir, "train.dat"))) {
    console.log("SKIP  real MT-SISSO fixture not present (dontUpdate/MT-SISSO)");
  } else {
    const read = (p) => fs.readFileSync(path.join(dir, p), "utf8");
    const health = require("../js/health-check.js");
    const r = health.check({
      train: read("train.dat"),
      top: read(path.join("Models", "top1000_D002")),
      coeff: read(path.join("Models", "top1000_D002_coeff")),
      uspace: read(path.join("SIS_subspaces", "Uspace.expressions")),
      sissoIn: read("SISSO.in"),
      sissoOut: read("SISSO.out"),
    });
    console.log("   fixture health: " + r.level + " — " + r.checks.map((c) => c.id + ":" + c.level[0]).join(" "));
    // The fixture repeats a structure at several temperatures, so duplicate
    // sample names are expected as a warning; nothing may be an error.
    assertEq(r.level, "warning", "fixture health check: no errors (duplicate names warn)");
    assertEq((r.checks || []).filter((c) => c.level === "error").length, 0,
      "fixture health check: zero blocking errors");
    const dup = (r.checks || []).find((c) => c.id === "train-duplicates");
    assert(dup && dup.level === "warning", "fixture health check: duplicate names warn as expected");
    const agg = (r.checks || []).find((c) => c.id === "mt-aggregate");
    assert(agg && agg.level === "pass", "fixture health check: task aggregation verified");
  }
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
