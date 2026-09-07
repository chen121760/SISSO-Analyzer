// pareto_export.test.mjs — regression tests for the Pareto CSV export.
//
// The UI (app.js) renders the 2D/3D Pareto charts from the same pure helpers
// exercised here: SissoCore.paretoFront2D/3D produce the front that the chart
// highlights, and SissoCore.paretoExportRows turns the chart's own point /
// ghost / front arrays into CSV rows (the export deliberately never re-derives
// anything, so rows and flags match the plot 1:1). This file verifies:
//
//   1. front computation on hand-crafted points (2D + 3D, minimize/maximize)
//   2. exported rows: count, header, metric values, is_pareto and excluded
//      flags — including ghost points that never join the front
//   3. RFC 4180 CSV escaping
//   4. full-run consistency on the built-in demo run (232 models): the export
//      row set equals the points the chart would plot, and every is_pareto
//      flag matches an independent naive re-derivation of the front
//
// Run: node test/pareto_export.test.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");
const demoData = require("../js/demo-data.js").DEMO_DATA;

let failures = 0;
function check(label, actual, expected, tol = 1e-12) {
  const pass = Math.abs(actual - expected) <= tol;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${actual}, want ${expected} (tol ${tol})`);
}
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}
function assertEqStr(actual, expected, label) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    console.log(`    --- actual ---\n${String(actual)}\n    --- expected ---\n${String(expected)}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Pareto front on hand-crafted points
// ---------------------------------------------------------------------------

// 2D, both minimize: r1(10,10) is dominated by r4(9,9); front = {2,4,3}
// sorted along x (8, 9, 12).
{
  const pts = [
    { rank: 1, x: 10, y: 10 },
    { rank: 2, x: 8, y: 12 },
    { rank: 3, x: 12, y: 8 },
    { rank: 4, x: 9, y: 9 },
  ];
  const front = core.paretoFront2D(pts, true, true);
  assertEqStr(front.map((p) => p.rank).join(","), "2,4,3", "front2D minimize/minimize ranks");
}

// 2D, x maximize (larger better) + y minimize: only r2(10,0) and r4(20,5)
// survive; sorted by descending x -> [4,2].
{
  const pts = [
    { rank: 1, x: 0, y: 0 },
    { rank: 2, x: 10, y: 0 },
    { rank: 3, x: 5, y: 3 },
    { rank: 4, x: 20, y: 5 },
  ];
  const front = core.paretoFront2D(pts, false, true);
  assertEqStr(front.map((p) => p.rank).join(","), "4,2", "front2D maximize/minimize ranks");
}

// 3D, all minimize: r2(2,2,2), r3(1,2,3), r4(3,1,2) are each dominated by
// r1(1,1,1); r5(0.5,3,1) trades a worse y for a better x/z and survives.
{
  const pts = [
    { rank: 1, x: 1, y: 1, z: 1 },
    { rank: 2, x: 2, y: 2, z: 2 },
    { rank: 3, x: 1, y: 2, z: 3 },
    { rank: 4, x: 3, y: 1, z: 2 },
    { rank: 5, x: 0.5, y: 3, z: 1 },
  ];
  const front = core.paretoFront3D(pts, true, true, true);
  assertEqStr(front.map((p) => p.rank).join(","), "1,5", "front3D minimize ranks");
}

// 3D, z maximize: A(1,1,1) beats B(2,2,2) on x/y but loses on z -> both stay.
{
  const pts = [
    { rank: 1, x: 1, y: 1, z: 1 },
    { rank: 2, x: 2, y: 2, z: 2 },
  ];
  const front = core.paretoFront3D(pts, true, true, false);
  assertEqStr(front.map((p) => p.rank).join(","), "1,2", "front3D maximize-z keeps both");
}

// ---------------------------------------------------------------------------
// 2. Exported rows: count / header / values / is_pareto / excluded
// ---------------------------------------------------------------------------

{
  const pts = [
    { rank: 1, x: 10, y: 10, m: { formulaOriginal: "(1) + (2)*(f_a)" } },
    { rank: 2, x: 8, y: 12, m: { formulaOriginal: "(3) + (4)*(f_b)" } },
    { rank: 3, x: 12, y: 8, m: { formulaOriginal: "(5) + (6)*(f_c)" } },
    { rank: 4, x: 9, y: 9, m: { formulaOriginal: "(7) + (8)*(f_d)" } },
  ];
  // A ghost with better coordinates than every point: it is drawn but must
  // never join the front and must be flagged excluded=1.
  const ghosts = [{ rank: 99, x: 1, y: 1, m: { formulaOriginal: "(0) + (1)*(f_z)" } }];
  const front = core.paretoFront2D(pts, true, true); // ranks 2,4,3
  const axes = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "verify", metric: "rmse" },
  ];
  const rows = core.paretoExportRows(pts, ghosts, front, axes);

  assertEqStr(
    JSON.stringify(rows[0]),
    JSON.stringify(["rank", "formula", "x_dataset", "x_metric", "x_value",
      "y_dataset", "y_metric", "y_value", "is_pareto", "excluded"]),
    "2D export header"
  );
  assert(rows.length === 6, `2D export row count = 4 pts + 1 ghost + header (got ${rows.length - 1})`);
  const byRank = {};
  for (const r of rows.slice(1)) byRank[r[0]] = r;
  assert(byRank[1][2] === "train" && byRank[1][3] === "rmse" && byRank[1][4] === 10, "row1 x dataset/metric/value");
  assert(byRank[1][5] === "verify" && byRank[1][6] === "rmse" && byRank[1][7] === 10, "row1 y dataset/metric/value");
  assert(byRank[1][1] === "(1) + (2)*(f_a)", "row1 formula");
  assert(byRank[1][8] === 0 && byRank[1][9] === 0, "row1 is_pareto=0 excluded=0 (eligible, not front)");
  assert(byRank[2][8] === 1 && byRank[2][9] === 0, "row2 is_pareto=1 excluded=0");
  assert(byRank[4][8] === 1, "row4 is_pareto=1 (front)");
  assert(byRank[99][8] === 0 && byRank[99][9] === 1, "ghost row is_pareto=0 excluded=1");
}

// 3D rows: same shared exporter, three axis groups. minimize x/y, maximize z:
// r2(2,2,0.5) is dominated by r1(1,1,1); r3(0.5,3,2) survives on x/z.
{
  const pts = [
    { rank: 1, x: 1, y: 1, z: 1, m: { formulaOriginal: "(a)" } },
    { rank: 2, x: 2, y: 2, z: 0.5, m: { formulaOriginal: "(b)" } },
    { rank: 3, x: 0.5, y: 3, z: 2, m: { formulaOriginal: "(c)" } },
  ];
  const front = core.paretoFront3D(pts, true, true, false); // z maximize
  const axes = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "verify", metric: "rmse" },
    { code: "z", dataset: "train", metric: "r2" },
  ];
  const rows = core.paretoExportRows(pts, [], front, axes);
  assertEqStr(
    JSON.stringify(rows[0]),
    JSON.stringify(["rank", "formula", "x_dataset", "x_metric", "x_value",
      "y_dataset", "y_metric", "y_value", "z_dataset", "z_metric", "z_value",
      "is_pareto", "excluded"]),
    "3D export header"
  );
  assert(rows.length === 4, `3D export row count (got ${rows.length - 1} pts)`);
  const row1 = rows[1], row2 = rows[2], row3 = rows[3];
  assert(row1[8] === "train" && row1[9] === "r2" && row1[10] === 1, "row1 z dataset/metric/value");
  assert(row1[11] === 1 && row1[12] === 0, "row1 is_pareto=1 excluded=0");
  assert(row2[11] === 0 && row2[12] === 0, "row2 dominated: is_pareto=0 excluded=0");
  assert(row3[11] === 1 && row3[12] === 0, "row3 is_pareto=1 excluded=0");
  assert(row2[1] === "(b)" && row3[1] === "(c)", "row formulas copied");
}

// ---------------------------------------------------------------------------
// 3. RFC 4180 CSV escaping
// ---------------------------------------------------------------------------
{
  const csv = core.rowsToCsv([
    ["rank", "formula"],
    [1, "plain, no trouble"],
    [2, 'has "quote" and, comma'],
    [3, "line\nbreak"],
  ]);
  assertEqStr(
    csv,
    "rank,formula\r\n" +
      '1,"plain, no trouble"\r\n' +
      '2,"has ""quote"" and, comma"\r\n' +
      '3,"line\nbreak"\r\n',
    "rowsToCsv escaping"
  );
  assertEqStr(core.rowsToCsv([]), "", "rowsToCsv([]) empty");
  assertEqStr(core.rowsToCsv([[null, undefined, 0.5, "x"]]), ",,0.5,x\r\n", "rowsToCsv null/undefined fields");
}

// ---------------------------------------------------------------------------
// 4. Full-run consistency on the built-in demo run (232 models)
// ---------------------------------------------------------------------------

// Independent naive front oracle written directly from the definition of
// dominance (no shared code with the engine helpers under test).
function dominates2D(p, q, minX, minY) {
  const sx = (minX ? q.x : -q.x) - (minX ? p.x : -p.x); // q minus p on the x axis
  const sy = (minY ? q.y : -q.y) - (minY ? p.y : -p.y);
  return sx <= 0 && sy <= 0 && (sx < 0 || sy < 0);
}
function dominates3D(p, q, minX, minY, minZ) {
  const sx = (minX ? q.x : -q.x) - (minX ? p.x : -p.x);
  const sy = (minY ? q.y : -q.y) - (minY ? p.y : -p.y);
  const sz = (minZ ? q.z : -q.z) - (minZ ? p.z : -p.z);
  return sx <= 0 && sy <= 0 && sz <= 0 && (sx < 0 || sy < 0 || sz < 0);
}
function oracleFrontRanks(pts, dominates) {
  const out = new Set();
  for (const p of pts) {
    let dom = false;
    for (const q of pts) {
      if (q.rank !== p.rank && dominates(p, q)) { dom = true; break; }
    }
    if (!dom) out.add(p.rank);
  }
  return out;
}

const res = core.runPipeline({
  trainText: demoData.train,
  verifyText: demoData.verify,
  topText: demoData.top,
  coeffText: demoData.coeff,
  uspaceText: demoData.uspace,
});
console.log(`\ndemo run: ${res.meta.nModels} models, ${res.meta.nTrain} train, ${res.meta.nVerify} verify`);

function finite(x) { return Number.isFinite(x); }

// Emulate app.js paretoPoints()/paretoPoints3D(): points that have finite
// metric values on the chosen axes are the points the chart plots.
function collect2D(keyX, keyY) {
  const pts = [];
  for (const m of res.models) {
    const x = m.metricsTrain[keyX];
    const y = m.metricsVerify[keyY];
    if (finite(x) && finite(y)) pts.push({ rank: m.rank, x, y, m });
  }
  return pts;
}
function collect3D(keyX, keyY, keyZ, zSet) {
  const pts = [];
  for (const m of res.models) {
    const x = m.metricsTrain[keyX];
    const y = m.metricsVerify[keyY];
    const z = zSet === "verify" ? m.metricsVerify[keyZ] : m.metricsTrain[keyZ];
    if (finite(x) && finite(y) && finite(z)) pts.push({ rank: m.rank, x, y, z, m });
  }
  return pts;
}

function assertExportConsistent({ pts, ghosts, axes, front, dims }) {
  const rows = core.paretoExportRows(pts, ghosts, front, axes);
  const allRanks = pts.concat(ghosts).map((p) => p.rank);
  const exportedRanks = rows.slice(1).map((r) => r[0]);

  assert(rows.length - 1 === allRanks.length,
    `exported ${rows.length - 1} model rows = ${allRanks.length} plotted points`);
  assertEqStr(exportedRanks.join(","), allRanks.join(","),
    `${dims}D export keeps chart point order (pts first, then ghosts)`);

  const byRank = {};
  for (const r of rows.slice(1)) byRank[r[0]] = r;
  const sourceByRank = {};
  for (const p of pts.concat(ghosts)) sourceByRank[p.rank] = p;

  // values and formulas must be copied verbatim from the plotted points
  let valuesOk = true, formulasOk = true;
  for (const rank of allRanks) {
    const p = sourceByRank[rank];
    const r = byRank[rank];
    for (const a of axes) {
      const vi = 2 + axes.indexOf(a) * 3 + 2; // rank, formula, then triples
      if (r[vi] !== p[a.code]) valuesOk = false;
    }
    if (r[1] !== p.m.formulaOriginal) formulasOk = false;
  }
  assert(valuesOk, `${dims}D exported metric values equal plotted values`);
  assert(formulasOk, `${dims}D exported formulas equal model formulas`);
}

// 2D config 1: x = train RMSE (min), y = verify MaxAE (min)
{
  const pts = collect2D("rmse", "maxae");
  const ghosts = pts.filter((p) => p.rank % 50 === 0);   // simulated filter
  const eligible = pts.filter((p) => p.rank % 50 !== 0);
  const front = core.paretoFront2D(eligible, true, true);
  const axes = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "verify", metric: "maxae" },
  ];
  assertExportConsistent({ pts: eligible, ghosts, axes, front, dims: "2" });

  // engine front == naive oracle front (over the eligible set)
  const oracle = oracleFrontRanks(eligible, (p, q) => dominates2D(p, q, true, true));
  const engineSet = new Set(front.map((p) => p.rank));
  assertEqStr([...oracle].sort().join(","), [...engineSet].sort().join(","),
    "2D(rmse,maxae) engine front == naive oracle");

  // and the is_pareto column matches the oracle row by row
  const rows = core.paretoExportRows(eligible, ghosts, front, axes);
  let flagsOk = true;
  for (const r of rows.slice(1)) {
    const isFront = oracle.has(r[0]);
    if (r[8] !== (isFront ? 1 : 0)) flagsOk = false;
    if (r[0] % 50 === 0) { if (r[9] !== 1 || r[8] !== 0) flagsOk = false; }
    else if (r[9] !== 0) flagsOk = false;
  }
  assert(flagsOk, "2D(rmse,maxae) is_pareto/excluded flags match oracle + ghost rule");
  console.log(`   -> ${rows.length - 1} rows, ${front.length} on the front, ${ghosts.length} ghost(s)`);
}

// 2D config 2: both axes maximize (x = train R2, y = verify Spearman rho)
{
  const pts = collect2D("r2", "rho");
  const front = core.paretoFront2D(pts, false, false);
  const axes = [
    { code: "x", dataset: "train", metric: "r2" },
    { code: "y", dataset: "verify", metric: "rho" },
  ];
  assertExportConsistent({ pts, ghosts: [], axes, front, dims: "2" });
  const oracle = oracleFrontRanks(pts, (p, q) => dominates2D(p, q, false, false));
  const engineSet = new Set(front.map((p) => p.rank));
  assertEqStr([...oracle].sort().join(","), [...engineSet].sort().join(","),
    "2D(r2,rho) engine front == naive oracle");
  console.log(`   -> ${pts.length} rows, ${front.length} on the front`);
}

// 3D config: x = train RMSE (min), y = verify RMSE (min), z = train R2 (max)
{
  const pts = collect3D("rmse", "rmse", "r2", "train");
  const ghosts = pts.filter((p) => p.rank % 70 === 0);
  const eligible = pts.filter((p) => p.rank % 70 !== 0);
  const front = core.paretoFront3D(eligible, true, true, false);
  const axes = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "verify", metric: "rmse" },
    { code: "z", dataset: "train", metric: "r2" },
  ];
  assertExportConsistent({ pts: eligible, ghosts, axes, front, dims: "3" });

  const oracle = oracleFrontRanks(eligible, (p, q) => dominates3D(p, q, true, true, false));
  const engineSet = new Set(front.map((p) => p.rank));
  assertEqStr([...oracle].sort().join(","), [...engineSet].sort().join(","),
    "3D(rmse,rmse,r2-train) engine front == naive oracle");

  const rows = core.paretoExportRows(eligible, ghosts, front, axes);
  let flagsOk = true;
  for (const r of rows.slice(1)) {
    const isFront = oracle.has(r[0]);
    if (r[11] !== (isFront ? 1 : 0)) flagsOk = false;
    if (r[0] % 70 === 0) { if (r[12] !== 1 || r[11] !== 0) flagsOk = false; }
    else if (r[12] !== 0) flagsOk = false;
  }
  assert(flagsOk, "3D is_pareto/excluded flags match oracle + ghost rule");
  console.log(`   -> ${rows.length - 1} rows, ${front.length} on the front, ${ghosts.length} ghost(s)`);
}

// the CSV text must round-trip through a real CSV parse back to these numbers
{
  const pts = collect2D("rmse", "rmse");
  const front = core.paretoFront2D(pts, true, true);
  const axes = [
    { code: "x", dataset: "train", metric: "rmse" },
    { code: "y", dataset: "verify", metric: "rmse" },
  ];
  const rows = core.paretoExportRows(pts, [], front, axes);
  const text = core.rowsToCsv(rows);
  const parsed = text.trim().split(/\r?\n/).map((l) => l.split(","));
  assert(parsed.length === rows.length, "CSV text line count == exported row count");
  assert(parsed[0].length === rows[0].length, "CSV text column count == exported column count");
  const p2 = rows[2];
  assert(parseFloat(parsed[2][4]) === p2[4] && parseFloat(parsed[2][8]) === p2[8],
    "CSV numeric cells survive a naive round-trip parse");
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
