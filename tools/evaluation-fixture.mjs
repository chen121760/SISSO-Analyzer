import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const JSZip = require("../js/jszip.min.js"), C = require("../js/sisso-classification.js");
export async function loadClassificationCase(archive) {
  const bytes = fs.readFileSync(archive), zip = await JSZip.loadAsync(bytes);
  const names = { train: "train.dat", verify: "verify.dat", sissoin: "SISSO.in", top: "Models/top5000_D002", uspace: "SIS_subspaces/Uspace.expressions", classdesc: "Models/data_top1/desc_D002.dat", classhull: "convex2D_hull", trainlabels: "train_labels.json", verifylabels: "verify_labels.json" };
  const texts = {};
  for (const [key, name] of Object.entries(names)) { const entry = zip.file("2D2F-1K/" + name); if (!entry) throw new Error("Missing outer entry: " + name); texts[key] = await entry.async("string"); }
  const result = C.runPipeline(texts);
  if (result.train.n !== 331 || result.verify.n !== 77 || result.models.length !== 5000) throw new Error("Unexpected example archive structure.");
  return { result, names, archiveSHA256: crypto.createHash("sha256").update(bytes).digest("hex") };
}
