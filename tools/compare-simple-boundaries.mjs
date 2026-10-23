// Usage: node tools/compare-simple-boundaries.mjs run.zip /tmp/simple-boundaries.csv
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Zip = require("../js/jszip.min.js");
const Class = require("../js/sisso-classification.js");
const Core = require("../js/sisso-core.js");
const E = require("../js/sisso-evaluation.js");
const Simple = require("../js/sisso-simple-boundaries.js");
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node tools/compare-simple-boundaries.mjs run.zip output.csv");
const zip = await Zip.loadAsync(fs.readFileSync(input));
const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
const configs = names.filter(n => /(^|\/)SISSO\.in$/.test(n)).sort((a, b) => a.split("/").length - b.split("/").length);
if (!configs.length) throw new Error("Missing SISSO.in");
if (configs.length > 1 && configs[0].split("/").length === configs[1].split("/").length) throw new Error("Multiple outer runs; supply one run archive.");
const prefix = configs[0].slice(0, -"SISSO.in".length);
const roles = { train: "train.dat", verify: "verify.dat", sissoin: "SISSO.in", trainlabels: "train_labels.json", verifylabels: "verify_labels.json", uspace: "SIS_subspaces/Uspace.expressions" };
const texts = {};
for (const [role, name] of Object.entries(roles)) if (zip.files[prefix + name]) texts[role] = await zip.files[prefix + name].async("string");
const top = names.filter(n => n.startsWith(prefix) && /^Models\/top\d+_D002$/.test(n.slice(prefix.length)));
if (top.length !== 1) throw new Error("Expected one outer-run Models/top*_D002 file.");
texts.top = await zip.files[top[0]].async("string");
const result = Class.runPipeline(texts);
if (result.classes.length !== 2 || result.meta.sissoIn.descDim !== 2 || !Class.hasVerificationLabels(result)) {
  throw new Error("This experiment requires binary 2D classification and complete verification labels.");
}
const rows = [];
const metrics = (points, fit) => E.classificationMetrics(points.map(p => Object.assign({ id: p.name, yTrue: p.classIndex }, Simple.predict(fit, p.coords))), 2, 1);
const start = Date.now();
for (const model of result.models) {
  let train, verify, projectionError;
  try { train = Class.projectModel(result, model, "train"); verify = Class.projectModel(result, model, "verify"); }
  catch (error) { projectionError = error; }
  for (const family of Simple.families) {
    const row = { rank: model.rank, family, status: "ok", error: "", descriptors: model.descriptors.map(d => d.original) };
    try {
      if (projectionError) throw projectionError;
      const fit = Simple.fit(train, family), expression = Simple.formula(fit);
      row.status = fit.converged ? "ok" : "nonconverged";
      row.parameterCount = expression.parameterCount;
      row.formula = expression.text;
      row.train = metrics(train, fit);
      row.verify = metrics(verify, fit);
    } catch (error) { row.status = "failed"; row.error = error.message; }
    rows.push(row);
  }
  if (rows.length % 3000 === 0) console.error(`${rows.length} / ${result.models.length * 3} fits; ${Math.round((Date.now() - start) / 1000)} s`);
}
const columns = ["rank", "family", "status", "error", "parameterCount", "d1", "d2", "trainAccuracy", "verifyAccuracy", "verifyBalancedAccuracy", "verifyMacroF1", "verifyCoverage", "formula"];
const cells = rows.map(r => [r.rank, r.family, r.status, r.error, r.parameterCount, ...r.descriptors,
  r.train?.accuracy, r.verify?.accuracy, r.verify?.balancedAccuracy, r.verify?.macroF1, r.verify?.coverage, r.formula]);
fs.writeFileSync(output, Core.rowsToCsv([columns, ...cells]));
const summary = { models: result.models.length, train: result.train.n, verify: result.verify.n, lambda: .01, threshold: .5,
  interpretation: "Selection validation on fixed SISSO descriptors; no independent-test claim.", elapsedSeconds: (Date.now() - start) / 1000, families: {} };
for (const family of Simple.families) {
  const subset = rows.filter(r => r.family === family);
  const eligible = subset.filter(r => r.status === "ok" && r.verify.coverage === 1 && Number.isFinite(r.verify.balancedAccuracy));
  eligible.sort((a, b) => b.verify.balancedAccuracy - a.verify.balancedAccuracy || b.verify.macroF1 - a.verify.macroF1 || a.rank - b.rank);
  summary.families[family] = { completed: eligible.length, failed: subset.filter(r => r.status === "failed").length,
    nonconverged: subset.filter(r => r.status === "nonconverged").length, incompleteCoverage: subset.filter(r => r.verify && r.verify.coverage < 1).length,
    best: eligible.slice(0, 3).map(r => ({ rank: r.rank, trainAccuracy: r.train.accuracy, verifyAccuracy: r.verify.accuracy,
      balancedAccuracy: r.verify.balancedAccuracy, macroF1: r.verify.macroF1, descriptors: r.descriptors, formula: r.formula })) };
}
fs.writeFileSync(output + ".json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
