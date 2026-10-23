import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { regressionEntries, multiTaskEntries, classificationEntries, classification2DEntries, logRegressionEntries, alternativeClassificationEntries, model } from "./sisso_plus_plus_fixtures.mjs";
const require = createRequire(import.meta.url);
const PP = require("../js/sisso-plus-plus.js");
const Core = require("../js/sisso-core.js");
const Classification = require("../js/sisso-classification.js");
const Health = require("../js/health-check.js");

function pipeline(texts) {
  const meta = PP.metadata(texts.sissopp);
  const health = Health.check({ ...texts, sissoIn: texts.sissoin, verifyTaskIndices: meta.verifyTaskIndices, logRegression: meta.logRegression });
  assert.notEqual(health.level, "error", JSON.stringify(health));
  const result = meta.calcType === "classification" ? Classification.runPipeline(texts) : Core.runPipeline({
    trainText: texts.train, verifyText: texts.verify, topText: texts.top, coeffText: texts.coeff,
    uspaceText: texts.uspace, sissoInText: texts.sissoin, verifyTaskIndices: meta.verifyTaskIndices, logRegression: meta.logRegression,
  });
  return PP.decorate(result, texts.sissopp);
}

const one = PP.prepare(regressionEntries(), 1);
const result = pipeline(one.texts);
assert.deepEqual(result.train.names, ["A", "B"]);
assert.deepEqual(result.verify.names, ["sample C, test"]);
assert.deepEqual(Array.from(result.models[0].predTrain), [3, 5]);
assert.deepEqual(Array.from(result.models[0].predVerify), [7]);
assert.equal(result.models[0].metricsVerify.rmse, 1);
assert.equal(result.meta.targetName, "prop");
assert.equal(result.meta.sourceEngine, "SISSO++");
const two = PP.prepare(regressionEntries());
assert.equal(two.info.dimension, 2);
assert.deepEqual(two.info.dimensions, [1, 2]);
assert.deepEqual(Array.from(pipeline(two.texts).models[0].predVerify), [16]);
assert.equal(pipeline(two.texts).models[0].metricsVerify.rmse, 8);

const mt = PP.prepare(multiTaskEntries());
assert.deepEqual(mt.info.verifyTaskIndices, [1, 0]);
const multi = pipeline(mt.texts);
assert.deepEqual(multi.train.names, ["a", "c", "b", "d"]);
assert.deepEqual(multi.verify.names, ["e", "f"]);
assert.deepEqual(Array.from(multi.models[0].predVerify), [11, 7]);
assert.equal(multi.models[0].metricsVerify.rmse, 0);
assert.deepEqual(multi.tasks.map(t => t.label), ["alpha", "beta"]);
assert.deepEqual(multi.tasks[0].data.names, ["a", "c"]);
assert.deepEqual(pipeline(PP.prepare(multiTaskEntries().map(e => ({ ...e, text: e.text.replaceAll("alpha", "Task A") }))).texts).tasks.map(t => t.label), ["Task A", "beta"]);
assert.deepEqual(Core.availableDatasets(multi), ["train", "verify", "t1", "t2"]);
assert.throws(() => Core.validateVerifyTasks([0, 2], 2, 2), /task mapping/);
assert.throws(() => Core.validateVerifyTasks([0], 2, 2), /task mapping/);

const classTexts = PP.prepare(classificationEntries()).texts;
const classes = pipeline(classTexts);
assert.deepEqual(classes.train.names, ["A", "B", "C", "D"]);
assert.deepEqual(classes.train.labels, [0, 0, 1, 1]);
assert.equal(classes.models[0].dataOverlap, 2);
assert.equal(classes.models[0].sizeOverlap, null);
assert.equal(classes.models[0].official, undefined);
assert.equal(Classification.projectModel(classes, classes.models[0], "train").find(p => p.name === "B").svmPrediction, 1);
assert.equal(Classification.projectModel(classes, classes.models[0], "train").find(p => p.name === "B").classified, null);
assert.equal(Classification.hasVerificationLabels(classes), true);
const exportRows = Classification.exportRows(classes, classes.models[0], "both");
assert.equal(exportRows[0].at(-1), "SISSO++_SVM_predicted_class");
assert.equal(exportRows.at(-1).at(-1), 1);
const classes2D = pipeline(PP.prepare(classification2DEntries()).texts);
assert.equal(classes2D.models[0].dataOverlap, 0);
assert.deepEqual(Classification.projectModel(classes2D, classes2D.models[0], "verify")[0].coords, [3.5, 0.2]);
assert.equal(Classification.rebuildHulls(Classification.projectModel(classes2D, classes2D.models[0], "train"), classes2D.classes.length, 2).length, 2);
for (const taskMode of [false, true]) {
  for (const loss of ["LOG_RMSE", "MSLE"]) {
    const logarithmic = pipeline(PP.prepare(logRegressionEntries(taskMode, loss)).texts);
    const expected = taskMode ? [12, 18] : [18];
    logarithmic.models[0].predVerify.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12));
    assert.ok(logarithmic.models[0].metricsVerify.rmse < 1e-12);
    assert.equal(logarithmic.models[0].nativeLoss.name, loss);
    assert.equal(logarithmic.models[0].nativeTestLoss.name, loss);
    assert.match(logarithmic.models[0].formulaOriginal, /exp\(/);
  }
}
for (const loss of ["Davies Bouldin", "Sil Score", "Calinski Harabasz"]) {
  const alt = pipeline(PP.prepare(alternativeClassificationEntries(loss)).texts);
  assert.equal(alt.models[0].dataOverlap, null);
  assert.equal(alt.models[0].sizeOverlap, null);
  assert.equal(alt.models[0].nativeLoss.value, 0.25);
  assert.match(alt.models[0].nativeLoss.name, new RegExp(loss));
  assert.equal(Classification.projectModel(alt, alt.models[0], "verify")[0].svmPrediction, 1);
}

const nested = regressionEntries().concat(regressionEntries().map(e => ({ ...e, path: e.path.replace("run/", "run/nested/") })));
assert.equal(PP.prepare(nested, 1).info.models.length, 1);
assert.throws(() => PP.prepare(regressionEntries().concat(regressionEntries().map(e => ({ ...e, path: e.path.replace("run/", "other/") })))), /one run/);
assert.deepEqual(pipeline(JSON.parse(JSON.stringify(one.texts))).verify.names, result.verify.names);
assert.throws(() => PP.prepare(regressionEntries().map(e => e.path.endsWith("data.csv") ? { ...e, text: e.text.replace("A,3,1", "A,99,1") } : e), 1), /targets/);
assert.throws(() => PP.prepare(regressionEntries().map(e => e.path.includes("test_dim_1") ? { ...e, text: e.text.replace("8,7,3", "8,99,3") } : e), 1), /predictions/);
assert.throws(() => PP.prepare(regressionEntries().map(e => e.path.includes("train_dim_1") ? { ...e, text: e.text.replace("A,3,3,1", "A,3,3,99") } : e), 1), /coordinates/);
assert.throws(() => PP.prepare(regressionEntries().map(e => e.path.endsWith("sisso.json") ? { ...e, text: '{"calc_type":"unrecognized_type"}' } : e)), /unsupported calculation/);
assert.throws(() => PP.prepare(regressionEntries().map(e => e.path.endsWith("sisso.json") ? { ...e, text: '{"data_file":"../../absent.csv"}' } : e)), /data_file/);
assert.throws(() => PP.prepare(regressionEntries().filter(e => !e.path.endsWith("data.csv"))), /data_file/);
assert.throws(() => PP.prepare(regressionEntries().concat([regressionEntries()[0]])), /duplicate input paths/);
assert.throws(() => PP.parseCsv('id,prop\n"unterminated,1'), /unterminated/);
assert.throws(() => PP.parseCsv('id,prop\n"bad"junk,1'), /closing quote/);
assert.deepEqual(PP.parseCsv('\uFEFFa,b\r\n"one,two","quoted ""word"""\r\n'), [["a", "b"], ["one,two", 'quoted "word"']]);
assert.throws(() => Core.compileFormula("1;2"), /unsupported character/);
assert.ok(Math.abs(Core.compileFormula("sin(a)^2+cos(a)^2")(() => 0.4) - 1) < 1e-12);
assert.throws(() => PP.parseModel({ path: "train_dim_1_model_0.dat", text: model({ rows: ["A,3,3,1", "A,3,3,1"] }) }), /duplicate/);
assert.deepEqual(PP.parseConfig('{/* comment */"url":"https://example.org/a//b",// comment\n"desc_dim":2}'), { url: "https://example.org/a//b", desc_dim: 2 });
assert.throws(() => PP.parseConfig('{/* never closed'), /unterminated/);
const sharedInput = regressionEntries().map(e => e.path.endsWith("data.csv") ? e : {
  ...e, path: e.path.replace("run/", "run/default/"),
  text: e.path.endsWith("sisso.json") ? '{"property_key":"prop", "data_file":"../data.csv", "data_file_relative_to_json":true, // official default case layout\n"desc_dim":2}' : e.text,
});
assert.equal(PP.prepare(sharedInput, 1).info.dataFile, "run/data.csv");
assert.equal(pipeline(PP.prepare(sharedInput, 1).texts).models[0].metricsVerify.rmse, 1);
const fixed = [
  { path: "sisso.json", text: '{"property_key":"prop","fix_intercept":true}' },
  { path: "data.csv", text: "sample,prop,x\nA,2,1\nB,4,2\nV,6,3\n" },
  { path: "train_dim_1_model_0.dat", text: model({ fixIntercept: true, coefficients: ["all,2,"], rows: ["A,2,2,1", "B,4,4,2"] }) },
  { path: "test_dim_1_model_0.dat", text: model({ fixIntercept: true, coefficients: ["all,2,"], rows: ["V,6,6,3"] }) },
];
assert.deepEqual(Array.from(pipeline(PP.prepare(fixed).texts).models[0].predVerify), [6]);
const extraCandidate = regressionEntries().concat([
  { path: "run/models/train_dim_1_model_4.dat", text: model({ coefficients: ["all,1,2,"], descriptors: ["0;1;AA^2;0|sq;(x^2);$x^2$;x.^2;x^2;x"], rows: ["A,3,3,1", "B,5,6,4"], rmse: Math.sqrt(0.5), maxae: 1 }) },
  { path: "run/models/test_dim_1_model_4.dat", text: model({ coefficients: ["all,1,2,"], descriptors: ["0;1;AA^2;0|sq;(x^2);$x^2$;x.^2;x^2;x"], rows: ["sample C, test,8,11,9"], rmse: 3, maxae: 3 }) },
]);
const ranked = pipeline(PP.prepare(extraCandidate, 1).texts);
assert.deepEqual(ranked.models.map(m => m.rank), [1, 5]);
assert.deepEqual(ranked.models.map(m => m.predVerify[0]), [7, 11]);
assert.match(ranked.models[1].sourceFile, /model_4/);
assert.equal(pipeline(PP.prepare(regressionEntries().filter(e => !e.path.includes("test_dim")), 1).texts).verify, null);
console.log("PASS SISSO++ ordinary/log regression, task-aware tests, classification losses/SVM semantics, dimensions, saved texts, nested runs and malformed-input checks");
