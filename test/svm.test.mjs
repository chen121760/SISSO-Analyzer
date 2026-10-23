import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CLASS_TEXTS } from "./classification.test.mjs";
import { workerHarness } from "./svm-harness.mjs";

const require = createRequire(import.meta.url);
const Engine = require("../js/sisso-svm.js");
const Classification = require("../js/sisso-classification.js");
const { context, tasks, messages, drain } = workerHarness();
const SVM = context.libsvm;
const plain = (v) => JSON.parse(JSON.stringify(v));
const files = { ...CLASS_TEXTS,
  verify: "name x z\nv0 .2 .1\nv1 5.1 5.2\nv2 5.3 5.3\n",
  verifylabels: JSON.stringify({ class_order: ["low", "high"], rows: [
    { id: "v2", class: 1 }, { id: "v0", class: 0 }, { id: "v1", class: 1 },
  ] }),
};
const result = Classification.runPipeline(files);
const trained = Engine.trainModel(result, result.models[0], {}, SVM);
assert.equal(trained.train.accuracy, 1);
assert.equal(trained.verify.accuracy, 1);
assert.equal(trained.verify.balancedAccuracy, 1);
assert.equal(trained.verify.macroF1, 1);
assert.equal(trained.verify.n, 3);
assert.ok(Math.abs(trained.fit.gamma - 0.5) < 1e-12);
assert.equal(trained.fit.cost, 1);
console.log("PASS real LIBSVM RBF train/verification scores and labels joined by sample ID");

const changedVerify = Classification.runPipeline({ ...files,
  verify: "name x z\nv0 -1e8 5e8\nv1 3e8 -6e8\nv2 4e8 7e8\n",
  verifylabels: JSON.stringify({ class_order: ["low", "high"], rows: [
    { id: "v0", class: 1 }, { id: "v1", class: 0 }, { id: "v2", class: 0 },
  ] }),
});
const changed = Engine.trainModel(changedVerify, changedVerify.models[0], {}, SVM);
assert.deepEqual(changed.fit, trained.fit);
assert.deepEqual(changed.train, trained.train);
assert.notEqual(changed.verify.accuracy, trained.verify.accuracy);
const withoutVerify = Classification.runPipeline({ ...CLASS_TEXTS, verify: undefined, verifylabels: undefined });
const absent = Engine.trainModel(withoutVerify, withoutVerify.models[0], {}, SVM);
assert.deepEqual(absent.fit, trained.fit);
assert.equal(absent.verify, null);
const unlabeled = Classification.runPipeline({ ...files, verifylabels: undefined });
const unlabeledFit = Engine.trainModel(unlabeled, unlabeled.models[0], {}, SVM);
assert.equal(unlabeledFit.verify, null);
assert.equal(unlabeledFit.verifyIssue, "svmVerificationLabels");
const invalidVerify = Classification.runPipeline({ ...files, verify: files.verify.replace("v1 5.1 5.2", "v1 1000 5.2") });
const invalidScore = Engine.trainModel(invalidVerify, invalidVerify.models[1], {}, SVM);
assert.equal(invalidScore.verify, null);
assert.equal(invalidScore.verifyIssue, "svmInvalidVerification");
console.log("PASS verification data/labels cannot change scaler, fit or training scores; absent/unlabeled/nonfinite verification is not scored");

const xorFiles = {
  train: "name x z\na -1 -1\nb 1 1\nc -1 1\nd 1 -1\n",
  sissoin: "ptype=2\nntask=1\nnsample=(2,2)\nnsf=2\ndesc_dim=2\n",
  top: "rank #data_overlap size_overlap feature_ID\n1 4 1 (1 2)\n", uspace: "x\nz\n",
};
const xor = Classification.runPipeline(xorFiles);
const nonlinear = Engine.trainModel(xor, xor.models[0], { cost: 10, gamma: 1 }, SVM);
assert.equal(nonlinear.train.accuracy, 1, "XOR requires a nonlinear separator");
const bounds = Engine.domain(Classification.projectModel(xor, xor.models[0], "train"));
const mesh = Engine.boundary(nonlinear.fit, bounds, 81, SVM);
assert.ok(mesh.segments.length > 40);
assert.ok(mesh.segments.every((s) => s.length === 4 && s.every(Number.isFinite)));
assert.ok(mesh.segments.every((s) => s[0] >= bounds[0][0] && s[0] <= bounds[0][1] && s[1] >= bounds[1][0] && s[1] <= bounds[1][1]));
assert.throws(() => Engine.boundary(nonlinear.fit, [[1, 1], [0, 1]], 81, SVM));
console.log("PASS nonlinear XOR classification and finite decision-boundary mesh in original d1/d2 units");

const multi = Classification.runPipeline({ ...xorFiles,
  train: "name x z\na -5 -5\nb -4 -5\nc 0 5\nd 1 5\ne 5 -5\nf 6 -5\n",
  sissoin: xorFiles.sissoin.replace("(2,2)", "(2,2,2)"),
});
const multiFit = Engine.trainModel(multi, multi.models[0], {}, SVM);
assert.equal(multiFit.train.accuracy, 1);
assert.equal(multiFit.train.macroF1, 1);
assert.ok(Engine.boundary(multiFit.fit, Engine.domain(Classification.projectModel(multi, multi.models[0], "train")), 41, SVM).segments.length > 0);
const constant = Classification.runPipeline({ ...xorFiles, train: xorFiles.train.replaceAll(/[-]?1 [-]?1/g, "0 5") });
const constantFit = Engine.trainModel(constant, constant.models[0], {}, SVM);
assert.equal(constantFit.fit.gamma, 1);
assert.equal(constantFit.train.accuracy, 0.5);
assert.equal(Engine.boundary(constantFit.fit, [[-1, 1], [4, 6]], 21, SVM).segments.length, 0);
const oneActive = Classification.runPipeline({ ...xorFiles, train: "name x z\na -2 5\nb -1 5\nc 1 5\nd 2 5\n" });
assert.ok(Math.abs(Engine.trainModel(oneActive, oneActive.models[0], {}, SVM).fit.gamma - 1) < 1e-12);
const huge = Classification.runPipeline({ ...xorFiles, train: "name x z\na -1e308 -1e308\nb -9e307 -9e307\nc 9e307 9e307\nd 1e308 1e308\n" });
assert.equal(Engine.trainModel(huge, huge.models[0], {}, SVM).train.accuracy, 1);
assert.ok(Engine.domain(Classification.projectModel(huge, huge.models[0], "train")).flat().every(Number.isFinite));
assert.equal(Engine.measure([0, 0, 0, 1], [0, 0, 0, 0], 2).accuracy, .75);
assert.equal(Engine.measure([0, 0, 0, 1], [0, 0, 0, 0], 2).balancedAccuracy, .5);
assert.ok(Math.abs(Engine.measure([0, 0, 0, 1], [0, 0, 0, 0], 2).macroF1 - 3 / 7) < 1e-12);
assert.equal(Engine.measure([0, 0], [0, 0], 2).balancedAccuracy, 1);
assert.equal(Engine.measure([0, 0], [0, 0], 2).macroF1, .5);
for (const config of [{ cost: 0 }, { cost: Infinity }, { gamma: -1 }, { gamma: "" }, { gamma: NaN }, { cost: 1e9 }]) assert.throws(() => Engine.options(config));
const oneD = Classification.runPipeline({ ...xorFiles,
  sissoin: xorFiles.sissoin.replace("desc_dim=2", "desc_dim=1"), top: xorFiles.top.replace("(1 2)", "(1)"),
});
assert.throws(() => Engine.trainModel(oneD, oneD.models[0], {}, SVM), /svmOnly2D/);
console.log("PASS multiclass, imbalance, absent validation categories, constant/extreme descriptors and input guards");

const summaries = new Map([
  [1, { status: "ready", train: { accuracy: .8 }, verify: { accuracy: 0 } }],
  [2, { status: "ready", train: { accuracy: 1 }, verify: { accuracy: .9 } }],
  [3, { status: "failed" }], [4, { status: "ready", train: { accuracy: .8 }, verify: null }],
]);
const models = [5, 4, 3, 2, 1].map((rank) => ({ rank }));
assert.deepEqual(models.slice().sort((a, b) => Engine.compare(a, b, "svm-train-accuracy", summaries)).map((m) => m.rank), [2, 1, 4, 3, 5]);
assert.deepEqual(models.slice().sort((a, b) => Engine.compare(a, b, "svm-verify-accuracy", summaries)).map((m) => m.rank), [2, 1, 3, 4, 5]);
console.log("PASS score sorting is descending, deterministic and puts missing/failed values last (zero is valid)");

context.onmessage({ data: { type: "start", id: 7, texts: files, options: {} } });
assert.equal(messages[0].type, "model");
context.onmessage({ data: { type: "boundary", id: 7, key: "selected", fit: messages[0].summary.fit, bounds } });
assert.equal(messages.at(-1).type, "boundary");
drain();
assert.equal(messages.at(-1).type, "done");
assert.equal(messages.filter((m) => m.type === "model").length, 2);
assert.deepEqual(messages.filter((m) => m.type === "model").map((m) => m.summary.status), ["ready", "ready"]);
messages.length = 0;
context.onmessage({ data: { type: "start", id: 8, texts: files, options: {} } });
context.onmessage({ data: { type: "start", id: 9, texts: xorFiles, options: {} } });
drain();
assert.equal(messages.filter((m) => m.id === 8 && m.type === "model").length, 1);
assert.equal(messages.at(-1).id, 9);
const partlyInvalid = { ...files, uspace: files.uspace.replace("exp(x)", "sqrt(-x)") };
messages.length = 0;
context.onmessage({ data: { type: "start", id: 10, texts: partlyInvalid, options: {} } });
drain();
assert.deepEqual(messages.filter((m) => m.type === "model").map((m) => m.summary.status), ["ready", "failed"]);
assert.equal(messages.at(-1).type, "done");
assert.equal(tasks.length, 0);
console.log("PASS actual worker batches every model, serves boundaries between fits, ignores obsolete jobs and isolates model failures");
