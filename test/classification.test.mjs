import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const Class = require("../js/sisso-classification.js");
const Core = require("../js/sisso-core.js");
const Health = require("../js/health-check.js");

export const CLASS_TEXTS = {
  train: "name x z\na 0 0\nb 1 0\nc 0 1\nd 5 5\ne 6 5\nf 5 6\n",
  verify: "name x z\nv 2 3\n",
  sissoin: "ptype=2\nntask=1\nnsample=(3,3)\nnsf=2\ndesc_dim=2\nisconvex=(1,1)\nbwidth=.001\n",
  top: "rank #data_overlap size_overlap feature_ID\n1 0 -5.25 (1 2)\n2 1 0.25 (2 3)\n",
  uspace: "x N_overlap=1 S_overlap=0\nz N_overlap=2 S_overlap=.2\nexp(x) N_overlap=2 S_overlap=.3\n",
  classdesc: "index classified? descriptor_1 descriptor_2\n1 YES 0 0\n2 YES 1 0\n3 YES 0 1\n4 YES 5 5\n5 YES 6 5\n6 YES 5 6\n",
  classhull: "The coordinates (x,y) of 2D-vertices arranged in clockwise direction\nHull 1\n0 0\n1 0\n0 1\nHull 2\n5 5\n6 5\n5 6\n",
  trainlabels: JSON.stringify({ class_order: ["low", "high"], rows: ["f", "e", "d", "c", "b", "a"].map((id, i) => ({ id, class: i < 3 ? 1 : 0 })) }),
  verifylabels: JSON.stringify({ class_order: ["low", "high"], rows: [{ id: "v", class: 1 }] }),
};

export function archiveTexts(archive, prefix = "") {
  const bytes = gunzipSync(fs.readFileSync(archive));
  const names = { train: "train.dat", verify: "verify.dat", sissoin: "SISSO.in", sissoout: "SISSO.out",
    top: prefix ? "Models/top0005_D002" : "Models/top5000_D002", uspace: "SIS_subspaces/Uspace.expressions",
    classdesc: "Models/data_top1/desc_D002.dat", classhull: "convex2D_hull",
    trainlabels: "train_labels.json", verifylabels: "verify_labels.json" };
  const wanted = new Map(Object.entries(names).map(([role, name]) => [prefix + name, role]));
  const texts = {};
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const cstr = (start, len) => header.subarray(start, start + len).toString("utf8").split("\0")[0];
    const size = parseInt(cstr(124, 12).trim(), 8) || 0;
    const name = (cstr(345, 155) ? cstr(345, 155) + "/" : "") + cstr(0, 100);
    if (wanted.has(name)) texts[wanted.get(name)] = bytes.subarray(offset + 512, offset + 512 + size).toString("utf8");
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return texts;
}

export const ARCHIVE = path.join(path.dirname(fileURLToPath(import.meta.url)), "Ref file class", "2D1f-class.tar.gz");

export function runTests() {
const result = Class.runPipeline(CLASS_TEXTS);
assert.equal(result.meta.nFeatures, 2);
assert.equal(result.columns[1].role, "feature");
assert.deepEqual(result.train.labels, [0, 0, 0, 1, 1, 1]);
assert.deepEqual(result.classes, ["low", "high"]);
assert.equal(result.hasClassNames, true);
const swapLabels = (text) => {
  const doc = JSON.parse(text); doc.class_order.reverse(); doc.rows.forEach((row) => { row.class = 1 - row.class; }); return JSON.stringify(doc);
};
const reorderedTrain = "name x z\nd 5 5\ne 6 5\nf 5 6\na 0 0\nb 1 0\nc 0 1\n";
const swapped = Class.runPipeline({ ...CLASS_TEXTS, train: reorderedTrain,
  classdesc: undefined, classhull: undefined, trainlabels: swapLabels(CLASS_TEXTS.trainlabels), verifylabels: swapLabels(CLASS_TEXTS.verifylabels) });
assert.deepEqual(swapped.classes, ["high", "low"]);
assert.equal(Class.projectModel(swapped, swapped.models[0], "train")[0].classIndex, 0);
assert.equal(Class.projectModel(swapped, swapped.models[0], "verify")[0].classIndex, 0);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, train: reorderedTrain, classdesc: undefined, classhull: undefined }), /class block mismatch/);
const reversedAxes = Class.runPipeline({ ...CLASS_TEXTS, uspace: CLASS_TEXTS.uspace.replace(/^x /, "(-x) "), classdesc: undefined, classhull: undefined });
assert.deepEqual(reversedAxes.train.labels, result.train.labels);
assert.equal(Class.projectModel(reversedAxes, reversedAxes.models[0], "train")[1].coords[0], -1);
const generic = Class.runPipeline({ ...CLASS_TEXTS, trainlabels: undefined, verifylabels: undefined });
assert.equal(generic.hasClassNames, false);
assert.deepEqual(generic.classes, ["Class 1", "Class 2"]);
assert.equal(result.models[0].sizeOverlap, -5.25);
assert.deepEqual(Class.projectModel(result, result.models[0], "verify")[0], {
  name: "v", index: 1, coords: [2, 3], classIndex: 1, finite: true, classified: null,
});
assert.equal(Class.projectModel(result, result.models[1], "train")[0].classified, null);
assert.equal(result.models[0].official.length, 6);
assert.equal(result.models[0].hulls.length, 2);
const nonconvex = Class.runPipeline({ ...CLASS_TEXTS,
  sissoin: CLASS_TEXTS.sissoin.replace("isconvex=(1,1)", "isconvex=(0,1)"),
  classhull: "Hull 2\n5 5\n6 5\n5 6\n" });
assert.equal(nonconvex.models[0].hulls[0], undefined);
assert.equal(nonconvex.models[0].hulls[1].length, 3);
assert.equal(Core.parseUspace("(N_overlap^2) SIS_score=1", Core.buildRenamer(Core.makeNameMap(["N_overlap"])), new Set([1])).idToOrig.get(1), "(N_overlap^2)");
assert.equal(Class.exportRows(result, result.models[0], "train")[1].at(-2), "YES");
assert.equal(Core.parseSissoIn("ptype=2\nnsample=(3,3)").ntask, null);
const multiClass = Class.runPipeline({ ...CLASS_TEXTS, train: "name x z\na 0 0\nb 1 1\nc 2 2\n",
  verify: undefined, classdesc: undefined, classhull: undefined, trainlabels: undefined, verifylabels: undefined,
  sissoin: CLASS_TEXTS.sissoin.replace("nsample=(3,3)", "nsample=(1,1,1)").replace("isconvex=(1,1)", "isconvex=(1,1,1)"),
  top: "rank #data_overlap size_overlap feature_ID\n1 6 1 (1 2)\n" });
assert.equal(multiClass.models[0].dataOverlap, 6);
assert.equal(Health.check({ ...CLASS_TEXTS, sissoIn: CLASS_TEXTS.sissoin }).level, "pass");
const unlabeled = Class.runPipeline({ ...CLASS_TEXTS, verifylabels: undefined });
assert.equal(Class.projectModel(unlabeled, unlabeled.models[0], "verify")[0].classIndex, null);
assert.equal(Health.check({ ...CLASS_TEXTS, sissoIn: CLASS_TEXTS.sissoin, verifylabels: undefined }).level, "warning");
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, sissoin: CLASS_TEXTS.sissoin.replace("(3,3)", "(2,3)") }), /add up/);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, trainlabels: CLASS_TEXTS.trainlabels.replace('"class":1', '"class":0') }), /mismatch/);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, classdesc: CLASS_TEXTS.classdesc.replace("YES 0 0", "YES 9 0") }), /do not match/);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, classhull: CLASS_TEXTS.classhull.replace("Hull 1\n0 0\n1 0\n0 1", "Hull 1\n5 5\n6 5\n5 6") }), /does not match/);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, verify: "name z x\nv 2 3\n" }), /same order/);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, train: CLASS_TEXTS.train.replace("a 0 0", "a 0oops 0") }), /invalid numeric/);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, uspace: CLASS_TEXTS.uspace.replace("exp(x)", "exp(unknown)") }), /Unknown feature/);
assert.throws(() => Class.runPipeline({ ...CLASS_TEXTS, sissoin: CLASS_TEXTS.sissoin.replace("ntask=1", "ntask=2") }), /ntask=1/);
const oneD = Class.runPipeline({ ...CLASS_TEXTS, classhull: undefined, classdesc: undefined,
  sissoin: CLASS_TEXTS.sissoin.replace("desc_dim=2", "desc_dim=1"),
  top: "rank #data_overlap size_overlap feature_ID\n1 0 -1 (1)\n" });
assert.equal(Class.projectModel(oneD, oneD.models[0], "train")[0].coords.length, 1);
console.log("PASS classification schema, labels by ID, negative score, projections, official evidence and malformed inputs");

if (fs.existsSync(ARCHIVE)) {
  const files = archiveTexts(ARCHIVE);
  const real = Class.runPipeline(files);
  assert.equal(real.models.length, 5000);
  assert.equal(real.train.n, 331);
  assert.equal(real.verify.n, 77);
  assert.equal(real.meta.nFeatures, 265);
  assert.deepEqual(real.meta.sissoIn.classCounts, [209, 122]);
  assert.deepEqual(real.models[0].featureIds, [17339, 17348]);
  assert.equal(real.models[0].dataOverlap, 109);
  assert.equal(real.models[0].sizeOverlap, 0.61683);
  assert.equal(real.models[0].official.filter((p) => p.classified === "NO").length, 109);
  assert.equal(real.models[0].official.slice(0, 209).filter((p) => p.classified === "NO").length, 55);
  for (const i of [0, 1, 99, 4999]) {
    assert.equal(Class.projectModel(real, real.models[i], "verify").length, 77);
  }
  console.log("PASS production archive: 5000 models / 331 train / 77 verify / 265 features / top1 109 overlap / matched official coordinates");
  const smoke = Class.runPipeline(archiveTexts(ARCHIVE, "_class_smoke/"));
  assert.equal(smoke.models.length, 5);
  assert.equal(smoke.models[0].sizeOverlap, -240.93924);
  console.log("PASS smoke archive: 5 models / negative separation score / matched official coordinates");
} else console.log("SKIP private production classification archive (not in checkout)");
}
if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runTests();
