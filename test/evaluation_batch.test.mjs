import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CLASS_TEXTS } from "./classification.test.mjs";
const require = createRequire(import.meta.url);
const E = require("../js/sisso-evaluation.js"), B = require("../js/sisso-evaluation-batch.js"), C = require("../js/sisso-classification.js"), Core = require("../js/sisso-core.js");
const result = C.runPipeline({ ...CLASS_TEXTS, verify: "name x z\nv1 0.2 0.2\nv2 5.2 5.2\nv3 2 3\n", verifylabels: JSON.stringify({ class_order: ["low", "high"], rows: [{ id: "v1", class: 0 }, { id: "v2", class: 1 }, { id: "v3", class: 1 }] }) });
const original = structuredClone(result);
const progress = [];
const batch = await B.evaluateAll(result, { dataset: "verify", bootstrap: 500, seed: 42 }, { onProgress: p => progress.push(p), yieldControl: async () => {} });
assert.equal(batch.rows.length, 4);
assert.equal(batch.config.bootstrap, 0);
assert.equal(batch.manifest.errors, 0);
assert.equal(progress[0].completed, 0); assert.equal(progress.at(-1).completed, 4);
assert.deepEqual(result, original); // Neither scoring nor sorting mutates SISSO rankings.
for (const row of batch.rows) {
  const model = result.models.find(m => m.rank === row.rank);
  for (const dataset of ["train", "verify"]) {
    const single = E.evaluate(result, model, { dataset, method: row.method });
    const actual = dataset === "train" ? row.train : row.evaluation;
    for (const key of ["accuracy", "coverage", "auc", "ap", "mcc", "brier"]) assert.equal(actual[key], single.metrics[key], `${row.rank}/${row.method}/${dataset}/${key}`);
  }
}
const flipped = structuredClone(result); flipped.verify.labels = [1, 0, 0];
const changed = await B.evaluateAll(flipped, { dataset: "verify" });
assert.deepEqual(batch.rows.map(r => r.fit), changed.rows.map(r => r.fit));
assert.deepEqual(batch.rows.map(r => r.train), changed.rows.map(r => r.train));
assert.ok(batch.manifest.cache.hits > 0);
assert.ok(batch.manifest.cache.retainedEntries <= batch.manifest.cache.maxEntries);
assert.equal(B.rankRows(batch, { metric: "auc" }).eligible, 2); // Geometry is unavailable, not AUC=0.
assert.equal(B.rankRows(batch, { method: "geometry", minCoverage: 1 }).eligible, 0);
const partial = structuredClone(batch); const logistic = partial.rows.find(r => r.method === "logistic"); logistic.evaluation.scoreN--;
assert.equal(B.rankRows(partial, { metric: "auc" }).eligible, 1);
logistic.status = "nonconverged";
assert.equal(B.rankRows(partial, { metric: "accuracy" }).eligible, 3);
assert.throws(() => B.rankRows(batch, { minCoverage: -1 }), /coverage/);
assert.throws(() => B.rankRows(batch, { metric: "maxae" }), /Unsupported/);
assert.equal((await B.evaluateAll(result, { dataset: "train" })).config.role, "train");
const tied = structuredClone(batch); tied.rows.reverse(); tied.rows.forEach(r => { r.evaluation.accuracy = 0.5; });
const sorted = B.rankRows(tied);
assert.deepEqual(sorted.rows.map(e => e.row.rank), [1, 1, 2, 2]);
assert.deepEqual(sorted.rows.map(e => e.place), [1, 1, 1, 1]);
const broken = structuredClone(result); broken.models[1].descriptors[0].renamed = "unknownFeature";
const errors = await B.evaluateAll(broken, { dataset: "verify" });
// Unknown features evaluate nonfinite or fail fitting; neither may become a ranked AUC.
assert.equal(B.rankRows(errors, { metric: "auc" }).eligible, 1);
const unsupported = structuredClone(result); unsupported.meta.sissoIn.isconvex = [0, 1];
const unsupportedBatch = await B.evaluateAll(unsupported, { dataset: "verify" });
assert.equal(unsupportedBatch.manifest.errors, 2);
assert.equal(unsupportedBatch.rows.filter(r => r.method === "logistic" && r.status === "ok").length, 2);
await assert.rejects(B.evaluateAll(result, {}, { isCancelled: () => true }), { name: "AbortError" });
await assert.rejects(B.evaluateAll(result, { methods: ["geometry", "geometry"] }), /methods/);
const serialized = B.csv(batch, { metric: "ap" });
assert.equal(serialized.split("\r\n").length, 5); assert.ok(serialized.includes("evaluation_ap"));
const dangerous = structuredClone(batch); dangerous.rows[0].descriptors = ["=bad"];
assert.ok(B.csv(dangerous).includes("descriptors"));
const regression = Core.runPipeline({ trainText: "name y x\na 1 1\nb 2 2\nc 3 3\n", verifyText: "name y x\nv 4 4\n", uspaceText: "x SIS_score=1\n", topText: "Rank RMSE MaxAE Feature_ID\n1 0 0 ( 1)\n2 1 1 ( 1)\n", coeffText: "Model_ID, coefficients\n1 0 1\n2 1 1\n" });
const regressionBatch = await B.evaluateAll(regression, { dataset: "verify" });
assert.equal(regressionBatch.rows.length, 2); assert.equal(B.rankRows(regressionBatch).rows[0].row.rank, 1);
assert.equal(regressionBatch.rows[1].evaluation.rmse, 1);
console.log("PASS batch: single-model parity, label isolation, caching, cancellation, tie order, coverage/cohort gates, failures, CSV and regression");
