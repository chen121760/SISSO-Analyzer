// usage_batch.test.mjs — feature / descriptor usage frequency + batch
// favourite / exclude (single source of truth) on the shared engine.
//
// Covered:
//   1. pipeline attaches per-term descriptor records (original + renamed text)
//   2. feature matching is identifier-boundary (a feature "A" never matches
//      inside "AA" / "A1" / "BA"), and is restricted to real descriptor text
//   3. descriptor matching compares NORMALISED expressions, so "(A + AA)" and
//      "(A+AA)" are the same descriptor
//   4. featureUsage / descriptorUsage counts across candidate models (with the
//      synthetic run whose expected numbers are hand-checked below)
//   5. batch favourite / exclude write the shared state map; models that
//      already carry the flag are not re-recorded
//   6. undo restores the map; a flag the user changed after the batch survives
//   7. state sync: modelFavorite / modelExcluded reflect the batch immediately
//      and the pre-batch values after undo
//
// Run: node test/usage_batch.test.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");

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
function assertDeep(actual, expected, label) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}

// ---------------------------------------------------------------------------
// Synthetic SISSO run. Feature columns deliberately overlap as name prefixes
// (A, A1, AA, A2, BA) so a naive substring match for "A" would over-count;
// identifiers are A A1 AA A2 BA C D  (renamed to c..i).
// ---------------------------------------------------------------------------
const TRAIN =
  "name target A A1 AA A2 BA C D\n" +
  "s1 1 0.1 2 3 4 5 6 7\n" +
  "s2 2 0.2 2.5 3.5 4.5 5.5 6.5 7.5\n" +
  "s3 3 0.3 2.6 3.6 4.6 5.6 6.6 7.6\n" +
  "s4 4 0.4 2.7 3.7 4.7 5.7 6.7 7.7";

// Uspace line id == physical line number (no blank lines inside).
const USPACE = [
  "(A)",            // 1
  "(A1)",           // 2
  "(AA)",           // 3
  "(A2)",           // 4
  "(A + AA)",       // 5  spelling variant of id 6
  "(A+AA)",         // 6
  "(AA*BA)/(A2)",   // 7
  "(C*D)",          // 8
  "(A1+BA)",        // 9
].join("\n");

const TOP =
  "        Rank        RMSE       MaxAE  Feature_ID\n" +
  "           1    0.100000    0.500000  ( 1 6)\n" +   // A + A+AA
  "           2    0.200000    0.600000  ( 2 5)\n" +   // A1 + (A + AA)
  "           3    0.300000    0.700000  ( 3 7)\n" +   // AA + AA*BA/A2
  "           4    0.400000    0.800000  ( 5 9)\n" +   // A+AA + A1+BA
  "           5    0.500000    0.900000  ( 7 8)";      // AA*BA/A2 + C*D

const COEFF =
  "Model_ID, [(c_i,i=0,n)_j,j=1,ntask]\n" +
  "           1   1.0  0.5  0.5\n" +
  "           2   1.0  0.5  0.5\n" +
  "           3   1.0  0.5  0.5\n" +
  "           4   1.0  0.5  0.5\n" +
  "           5   1.0  0.5  0.5";

const res = core.runPipeline({
  trainText: TRAIN,
  topText: TOP,
  coeffText: COEFF,
  uspaceText: USPACE,
});
const ranks = new Set(res.models.map((m) => m.rank));
const byRank = {};
res.models.forEach((m) => { byRank[m.rank] = m; });

// ---------------------------------------------------------------------------
// 1. pipeline descriptor records
// ---------------------------------------------------------------------------
assertEq(res.meta.nModels, 5, "synthetic run has 5 models");
assertEq(byRank[1].descriptors.length, 2, "model 1 has two descriptor records");
assertDeep(byRank[1].descriptors.map((d) => d.id), [1, 6], "model 1 descriptor ids");
assertEq(byRank[1].descriptors[0].original, "(A)", "descriptor original text kept verbatim");
assertEq(byRank[1].descriptors[0].renamed, "(c)", "descriptor renamed to feature letters");
assertEq(byRank[1].descriptors[1].renamed, "(c+e)", "complex descriptor renamed letters");
assertEq(byRank[2].descriptors[1].original, "(A + AA)", "spacing variant stored as-is");
assertEq(byRank[2].descriptors[1].renamed, "(c + e)", "spacing variant renamed with spacing");

// ---------------------------------------------------------------------------
// 2. feature matching: whole-identifier only
// ---------------------------------------------------------------------------
assertDeep(core.modelsWithFeature(res.models, "A").map((m) => m.rank), [1, 2, 4],
  "feature 'A' matches only models whose descriptors contain the token A (never AA/A1/A2/BA)");
assert(core.modelUsesFeature(byRank[3], "AA"), "model 3 uses AA");
assert(!core.modelUsesFeature(byRank[3], "A"), "model 3 with 'AA'/'AA*BA/A2' does not contain 'A'");
assert(!core.modelUsesFeature(byRank[1], "A1"), "'(A)' / '(A+AA)' does not contain A1");
assert(!core.modelUsesFeature(byRank[5], "A"), "C*D + AA*BA/A2 does not contain A");
assert(core.modelUsesFeature(byRank[5], "BA"), "AA*BA/A2 does contain BA");

// ---------------------------------------------------------------------------
// 3. descriptor matching: normalised expressions
// ---------------------------------------------------------------------------
assertEq(core.normalizeDescriptorText("(A + AA)"), "A+AA", "spacing normalised away");
assertEq(core.normalizeDescriptorText("  A+AA "), "A+AA", "padding normalised away");
assertDeep(core.modelsWithDescriptor(res.models, "(A+AA)").map((m) => m.rank), [1, 2, 4],
  "searching '(A+AA)' matches the '(A + AA)' spelling too");
assertDeep(core.modelsWithDescriptor(res.models, "A + AA").map((m) => m.rank), [1, 2, 4],
  "searching 'A + AA' matches both spellings");
assertDeep(core.modelsWithDescriptor(res.models, "(AA*BA)/(A2)").map((m) => m.rank), [3, 5],
  "nested expression matches by canonical form");
assertEq(core.modelsWithDescriptor(res.models, "A2").length, 0,
  "a bare sub-expression 'A2' is not a whole descriptor");

// ---------------------------------------------------------------------------
// 4. usage statistics (hand-checked frequencies)
// ---------------------------------------------------------------------------
{
  const rows = core.featureUsage(res.models, ["A", "A1", "AA", "A2", "BA", "C", "D"]);
  const want = { A: 3, A1: 2, AA: 5, A2: 2, BA: 3, C: 1, D: 1 };
  const got = {};
  rows.forEach((r) => { got[r.name] = r.count; });
  let countsOk = Object.keys(want).length === rows.length;
  for (const k of Object.keys(want)) if (got[k] !== want[k]) countsOk = false;
  assert(countsOk, "featureUsage counts per model");
  assertEq(rows[0].name, "AA", "features sorted by count (desc)");
  assertEq(rows[0].count, 5, "top feature used by all five models");
  assertEq(rows[0].ratio, 1, "top feature share is 5/5");
  assertEq(rows.find((r) => r.name === "C").ratio, 0.2, "1-of-5 feature share is 0.2");
}
{
  const rows = core.descriptorUsage(res.models);
  const byKey = {};
  rows.forEach((r) => { byKey[r.key] = r; });
  assertEq(byKey["A+AA"].count, 3, "both spellings collapse into one descriptor row");
  assertEq(byKey["A+AA"].expr, "(A + AA)", "most common spelling is shown");
  assertEq(byKey["AA*BA/A2"].count, 2, "compound descriptor used by models 3 & 5");
  assertEq(byKey["A1+BA"].count, 1, "single-use descriptor");
  assert(byKey["A2"] === undefined, "no model uses the bare feature A2 as a descriptor");
  assertEq(rows[0].key, "A+AA", "descriptors sorted by count (desc)");
}
{
  const report = core.usageReport(res);
  assertEq(report.totalModels, 5, "usageReport total models");
  assertDeep(report.featureNames, ["A", "A1", "AA", "A2", "BA", "C", "D"], "usageReport feature names");
  assertEq(report.features.length, 7, "usageReport feature rows");
  assertEq(report.descriptors.length, 7, "usageReport descriptor rows");
}

// ---------------------------------------------------------------------------
// 5/6/7. batch favourite / exclude + undo on the shared state map
// ---------------------------------------------------------------------------
{
  const states = core.normalizeModelStates(null, ranks);
  // favourite every model containing feature A (ranks 1, 2, 4)
  const favEntries = core.batchSetModelStates(
    states, core.modelsWithFeature(res.models, "A").map((m) => m.rank), { favorite: true });
  assertEq(favEntries.length, 3, "favourite batch touches the three A-models");
  assert(core.modelFavorite(states, byRank[1]) && core.modelFavorite(states, byRank[4]),
    "state sync: matching models read as favourites immediately");
  assert(!core.modelFavorite(states, byRank[3]) && !core.modelFavorite(states, byRank[5]),
    "non-matching models stay unfavourited");

  // second batch: exclude the A-models too (favourite flags must survive)
  const exclEntries = core.batchSetModelStates(
    states, core.modelsWithFeature(res.models, "A").map((m) => m.rank), { excluded: true });
  assertEq(exclEntries.length, 3, "exclude batch touches the same three models");
  assert(core.modelExcluded(states, byRank[1]) && core.modelExcluded(states, byRank[2]),
    "state sync: matching models read as excluded");
  assert(core.modelFavorite(states, byRank[1]), "favourite survives an independent exclude batch");
  assertEq(exclEntries[0].rank, 1, "undo entry records the rank");

  // an already-excluded model is not re-recorded
  const repeat = core.batchSetModelStates(states, [1, 3], { excluded: true });
  assertEq(repeat.length, 1, "already-excluded rank 1 skipped, only rank 3 recorded");

  // undo (LIFO): reverts the exclude batch, then the favourite batch
  assertEq(core.undoBatchModels(states, exclEntries), 3, "undo exclude restores three ranks");
  assert(!core.modelExcluded(states, byRank[1]), "undo cleared the excluded flag");
  assert(core.modelFavorite(states, byRank[2]), "favourites untouched by the exclude-undo");
  assert(core.modelExcluded(states, byRank[3]), "rank 3 (set later) stays excluded — not part of the undo");
  assertEq(core.undoBatchModels(states, favEntries), 3, "undo favourite restores three ranks");
  assert(!core.modelFavorite(states, byRank[1]) && !core.modelFavorite(states, byRank[4]),
    "after undo the favourite flags are back to false");
  assert(!core.modelExcluded(states, byRank[1]) && !core.modelExcluded(states, byRank[2]),
    "model 1 & 2 fully restored after both undos");
}

{
  // flags the user changed after the batch survive an undo
  const states = core.normalizeModelStates(null, ranks);
  const entries = core.batchSetModelStates(states, [1, 2], { favorite: true });
  assertEq(entries.length, 2, "favourite batch on ranks 1-2");
  states[1] = { favorite: false, excluded: false }; // user un-stars rank 1 afterwards
  assertEq(core.undoBatchModels(states, entries), 1, "undo skips rank 1 (user changed it)");
  assert(states[2].favorite === false, "rank 2 favourite reverted");
  assert(states[1].favorite === false, "rank 1 stays as the user left it");
}

{
  // batch no-op: everything already flagged -> no entries
  const states = core.normalizeModelStates(null, ranks);
  states[1] = { favorite: true, excluded: false };
  const entries = core.batchSetModelStates(states, [1], { favorite: true });
  assertEq(entries.length, 0, "no entry when the flag is already set");
  assertEq(Object.keys(core.modelStatesToJSON(states)).join(","), "1", "compact save still fine after no-op");
}

{
  // untouched ranks / empty batches create nothing
  const states = core.normalizeModelStates(null, ranks);
  assertEq(core.batchSetModelStates(states, [], { favorite: true }).length, 0, "empty batch is a no-op");
  assertEq(Object.keys(states).length, 0, "empty batch creates no state entries");
  assertEq(core.undoBatchModels(states, [{ rank: 999, setFavorite: true, favBefore: false }]), 0,
    "undo for a missing rank is a safe no-op");
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
