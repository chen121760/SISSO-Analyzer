import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { workerHarness } from "./svm-harness.mjs";
import { regressionEntries, multiTaskEntries, classificationEntries, classification2DEntries, logRegressionEntries, alternativeClassificationEntries } from "./sisso_plus_plus_fixtures.mjs";

const require = createRequire(import.meta.url);
const PP = require("../js/sisso-plus-plus.js"), Core = require("../js/sisso-core.js");
const Classification = require("../js/sisso-classification.js");
const Evaluation = require("../js/sisso-evaluation.js"), Batch = require("../js/sisso-evaluation-batch.js");
const SVM = require("../js/sisso-svm.js");
const plain = value => JSON.parse(JSON.stringify(value));

function prepare(entries, dimension = 1) {
  const { texts, info } = PP.prepare(entries, dimension);
  const result = info.calcType === "classification" ? Classification.runPipeline(texts) : Core.runPipeline({
    trainText: texts.train, verifyText: texts.verify, coeffText: texts.coeff,
    topText: texts.top, uspaceText: texts.uspace, sissoInText: texts.sissoin,
    verifyTaskIndices: info.verifyTaskIndices, logRegression: info.logRegression,
  });
  return { texts, result: PP.decorate(result, texts.sissopp) };
}

for (const [name, entries, dimension, expectedRmse] of [
  ["ordinary regression", regressionEntries(), 1, 1],
  ["2D regression", regressionEntries(), 2, 8],
  ["multi-task regression", multiTaskEntries(), 1, 0],
  ["log regression", logRegressionEntries(), 1, 0],
  ["multi-task log regression", logRegressionEntries(true), 1, 0],
  ["1D classification", classificationEntries(), 1],
  ["2D classification", classification2DEntries(), 2],
  ...["Davies Bouldin", "Sil Score", "Calinski Harabasz"].map(loss => [loss, alternativeClassificationEntries(loss), 2]),
]) {
  const { result } = prepare(entries, dimension);
  const model = result.models[0], config = { dataset: "verify", positiveClass: 1, bootstrap: 0 };
  const original = plain({ meta: result.meta, model, nativePredictions: model.svmPredictions ? {
    train: Array.from(model.svmPredictions.train), verify: Array.from(model.svmPredictions.verify),
  } : null });
  const batch = await Batch.evaluateAll(result, config);
  assert.ok(batch.rows.every(row => row.status === "ok"), JSON.stringify(batch.rows));
  for (const row of batch.rows) {
    const report = Evaluation.evaluate(result, model, { ...config, ...(result.taskType === "classification" ? { method: row.method } : {}) });
    for (const key of ["accuracy", "coverage", "auc", "ap", "rmse", "mae", "baselineSkill"]) {
      if (report.metrics[key] !== undefined) assert.equal(row.evaluation[key], report.metrics[key], name + ": " + key);
    }
    assert.deepEqual(report.rows.map(row => row.id), result.verify.names);
    if (expectedRmse !== undefined) assert.ok(Math.abs(report.metrics.rmse - expectedRmse) < 1e-12, name);
    if (name === "multi-task regression") assert.deepEqual(report.rows.map(row => row.baseline), [6.5, 4]);
    if (name === "multi-task log regression") assert.deepEqual(report.rows.map(row => row.baseline), [7.5, 5]);
  }
  assert.deepEqual(plain({ meta: result.meta, model, nativePredictions: model.svmPredictions ? {
    train: Array.from(model.svmPredictions.train), verify: Array.from(model.svmPredictions.verify),
  } : null }), original, name + ": auxiliary evaluation mutated native results");
  console.log("PASS SISSO++ " + name + ": batch/single parity, original IDs, immutable native results");
}

for (const entries of [classification2DEntries(), alternativeClassificationEntries()]) {
  const { texts, result } = prepare(entries, 2), model = result.models[0];
  const original = Array.from(model.svmPredictions.verify);
  const worker = workerHarness();
  const expected = SVM.trainModel(result, model, {}, worker.context.libsvm);
  worker.context.onmessage({ data: { type: "start", id: 42, texts, options: {} } });
  worker.drain();
  const errors = worker.messages.filter(message => message.type === "error");
  assert.deepEqual(errors, []);
  const message = worker.messages.find(message => message.type === "model");
  assert.equal(message.summary.status, "ready");
  assert.deepEqual(plain(message.summary), plain(expected));
  assert.equal(message.summary.train.accuracy, 1);
  assert.equal(message.summary.verify.accuracy, 1);
  assert.ok(worker.messages.some(message => message.type === "done"));
  assert.deepEqual(Array.from(model.svmPredictions.verify), original);
}
console.log("PASS SISSO++ native SVM predictions stay separate from real RBF-SVM worker fits");
