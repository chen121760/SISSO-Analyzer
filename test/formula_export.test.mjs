// formula_export.test.mjs — Formula copy formats derived from ONE parser/AST.
//
// The model-detail dialog's "Copy as…" menu offers Plain text (the untouched
// legacy string), LaTeX and Word/PowerPoint Office UnicodeMath. All three
// textual targets come from Core.formulaAst (a single expression AST shared
// with the evaluator's dialect), rendered by Core.formulaToPlain /
// formulaToLatex / formulaToUnicodeMath. These tests pin down:
//   1. the shared precedence / parenthesisation contract (parse -> plain ->
//      re-parse must be identity; plain of tricky expressions is exact),
//   2. exact LaTeX output for typical SISSO expressions (incl. fractions,
//      powers, sqrt/log/exp/abs and their precedence),
//   3. exact Office UnicodeMath output for the same expressions,
//   4. real demo model formulas convert without loss.
//
// Run: node test/formula_export.test.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../js/sisso-core.js");
const demoData = require("../js/demo-data.js").DEMO_DATA;

let failures = 0;
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}
function assertEq(actual, expected, label) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}
function assertThrows(fn, label) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) failures++;
  console.log(`${threw ? "PASS" : "FAIL"}  ${label}`);
}

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// 1. shared AST: parse -> plain -> parse must be the identity; plain text is
//    exact for a table of parenthesisation / precedence-sensitive cases.
// ---------------------------------------------------------------------------
{
  // exact canonical plain outputs — these encode the parenthesisation rules
  const plainCases = [
    ["a+b*c", "a+b*c"],                 // * binds tighter than +
    ["(a+b)*c", "(a+b)*c"],             // lost without parens
    ["a*(b+c)", "a*(b+c)"],
    ["a-b-c", "a-b-c"],                 // ((a-b)-c) left-assoc
    ["a-(b-c)", "a-(b-c)"],             // must keep parens
    ["(a-b)-c", "a-b-c"],
    ["a+b-c", "a+b-c"],
    ["a/(b*c)", "a/(b*c)"],
    ["(a+b)/(c-d)", "(a+b)/(c-d)"],
    ["a/b/c", "a/b/c"],                 // ((a/b)/c)
    ["a/(b/c)", "a/(b/c)"],
    ["a^b^c", "a^b^c"],                 // a^(b^c) right-assoc
    ["(a^b)^c", "(a^b)^c"],             // must keep parens
    ["x^(-2)", "x^(-2)"],
    ["x^2*y", "x^2*y"],
    ["-(a+b)", "-(a+b)"],
    ["(-a)*b", "(-a)*b"],
    ["-a/b", "(-a)/b"],
    ["2*(x+1)", "2*(x+1)"],
    ["(-7.042753903)+(0.1613175959)*((f_138))", "(-7.042753903)+0.1613175959*f_138"],
    ["0.5*(x1+x2)^2/x3", "0.5*(x1+x2)^2/x3"],
  ];
  for (const [src, want] of plainCases) {
    assertEq(core.formulaToPlain(src), want, `plain(${src})`);
  }
  // parse(plain(x)) ≡ parse(x) for every case → parens never change meaning
  const tricky = [
    "a+b*c", "(a+b)*c", "a*(b+c)", "a-b-c", "a-(b-c)", "(a-b)-c",
    "a+b-c", "a/(b*c)", "(a+b)/(c-d)", "a/b/c", "a/(b/c)",
    "a^b^c", "(a^b)^c", "x^(-2)", "x^2*y", "-(a+b)", "(-a)*b",
    "-a/b", "2*(x+1)", "sqrt(a+b)*c", "(sqrt(a)+b)/c", "exp(x^2)",
    "log(x1/x2)", "abs(a-b)", "cbrt(z)", "(-7.042753903)+(0.1613175959)*((f_138))",
    "0.5*(x1+x2)^2/x3", "e^(x+1)", "x1*x2/(x3+x4)", "1/(1+exp(-z))",
  ];
  for (const src of tricky) {
    const plain = core.formulaToPlain(src);
    assert(deepEq(core.formulaAst(plain), core.formulaAst(src)),
      `roundtrip parse(plain(${src})) ≡ parse(${src}) [plain=${plain}]`);
  }
}

// ---------------------------------------------------------------------------
// 2. LaTeX output — exact expected strings for typical SISSO expressions
// ---------------------------------------------------------------------------
{
  const cases = [
    ["a+b*c", "a + b \\cdot c"],
    ["(a+b)*c", "(a + b) \\cdot c"],
    ["a*(b+c)", "a \\cdot (b + c)"],
    ["a-b-c", "a - b - c"],
    ["a-(b-c)", "a - (b - c)"],
    ["a/(b*c)", "\\frac{a}{b \\cdot c}"],
    ["(a+b)/(c-d)", "\\frac{a + b}{c - d}"],
    ["a/(b/c)", "\\frac{a}{\\frac{b}{c}}"],
    ["a^b^c", "a^{b^{c}}"],
    ["(a^b)^c", "(a^{b})^{c}"],
    ["x^(-2)", "x^{-2}"],
    ["x^2", "x^{2}"],
    ["-(a+b)", "-(a + b)"],
    ["(-a)*b", "(-a) \\cdot b"],
    ["sqrt(x+1)", "\\sqrt{x + 1}"],
    ["cbrt(z)", "\\sqrt[3]{z}"],
    ["exp(x+1)", "e^{x + 1}"],
    ["exp(x)", "e^{x}"],
    ["abs(a-b)", "\\left|a - b\\right|"],
    ["log(x1/x2)", "\\log(\\frac{\\mathrm{x1}}{\\mathrm{x2}})"],
    ["(-7.042753903)+(0.1613175959)*((f_138))",
      "(-7.042753903) + 0.1613175959 \\cdot \\mathrm{f\\_138}"],
    ["1E21", "1\\times 10^{21}"],
    ["1E-7", "1\\times 10^{-7}"],
  ];
  for (const [src, want] of cases) {
    assertEq(core.formulaToLatex(src), want, `latex(${src})`);
  }
  // variable names are preserved (underscores escaped, multi-char upright)
  assert(core.formulaToLatex("NValence_nonLi_mean + f_001").includes("\\mathrm{NValence\\_nonLi\\_mean}"),
    "latex keeps feature names with underscores");
}

// ---------------------------------------------------------------------------
// 3. Office UnicodeMath output — exact expected strings
// ---------------------------------------------------------------------------
{
  const cases = [
    ["a+b*c", "a+b*c"],
    ["(a+b)*c", "(a+b)*c"],
    ["a*(b+c)", "a*(b+c)"],
    ["a/(b*c)", "a/(b*c)"],
    ["(a+b)/(c-d)", "(a+b)/(c-d)"],
    ["a^b^c", "a^(b^c)"],          // group the superscript chain
    ["(a^b)^c", "(a^b)^c"],
    ["x^(-2)", "x^(-2)"],
    ["x^2", "x^2"],
    ["-(a+b)", "-(a+b)"],
    ["(-a)*b", "(-a)*b"],
    ["sqrt(x+1)", "\\sqrt(x+1)"],
    ["cbrt(z)", "\\sqrt(3&z)"],
    ["exp(x+1)", "e^(x+1)"],
    ["exp(x)", "e^x"],
    ["abs(a-b)", "|a-b|"],
    ["log(x1/x2)", "log(x1/x2)"],
    ["(-7.042753903)+(0.1613175959)*((f_138))", "(-7.042753903)+0.1613175959*f_138"],
    ["1E21", "1×10^(21)"],
    ["1E-7", "1×10^(-7)"],
  ];
  for (const [src, want] of cases) {
    assertEq(core.formulaToUnicodeMath(src), want, `umath(${src})`);
  }
  // Office format also preserves variable names verbatim
  assert(core.formulaToUnicodeMath("NValence_nonLi_mean").includes("NValence_nonLi_mean"),
    "umath keeps feature names verbatim");
}

// ---------------------------------------------------------------------------
// 4. real demo formulas convert; latex/umath/plain all derive from the AST
// ---------------------------------------------------------------------------
{
  const res = core.runPipeline({
    trainText: demoData.train,
    verifyText: demoData.verify,
    topText: demoData.top,
    coeffText: demoData.coeff,
    uspaceText: demoData.uspace,
  });
  let allOk = true;
  for (const m of res.models) {
    const plain = core.formulaToPlain(m.formulaOriginal);
    const latex = core.formulaToLatex(m.formulaOriginal);
    const umath = core.formulaToUnicodeMath(m.formulaOriginal);
    // plain must reparse to the same tree as the original string
    if (!deepEq(core.formulaAst(plain), core.formulaAst(m.formulaOriginal))) allOk = false;
    if (typeof latex !== "string" || !latex.length) allOk = false;
    if (typeof umath !== "string" || !umath.length) allOk = false;
  }
  assert(allOk, `all ${res.models.length} demo models convert to plain/latex/umath consistently`);
  const m0 = res.models[0];
  assertEq(core.formulaToLatex(m0.formulaOriginal),
    "(-7.042753903) + 0.1613175959 \\cdot \\mathrm{f\\_138}",
    "demo R1 latex snapshot");
  assertEq(core.formulaToUnicodeMath(m0.formulaOriginal),
    "(-7.042753903)+0.1613175959*f_138",
    "demo R1 umath snapshot");
}

// ---------------------------------------------------------------------------
// 5. errors: garbage input must throw, not silently emit broken markup
// ---------------------------------------------------------------------------
assertThrows(() => core.formulaToLatex("a**b"), "double star throws");
assertThrows(() => core.formulaToLatex("(a+b"), "unclosed paren throws");
assertThrows(() => core.formulaToLatex("a b"), "adjacent identifiers throw");
assertThrows(() => core.formulaToLatex(""), "empty input throws");

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
