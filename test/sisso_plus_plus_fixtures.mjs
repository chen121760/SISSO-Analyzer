// Synthetic examples following upstream 43b99110118a51b9f4983b02c8d781ae6f25456c:
// src/descriptor_identifier/model/{Model,ModelRegressor,ModelClassifier}.cpp.
// They are not outputs from actually running the SISSO++ executable.
export function model({ dim = 1, coefficients = ["all, 2, 1,"], counts = null,
  descriptors = ["0; 0; AA; 0; x; $x$; x; x; x"], rows, classification = false, rmse = 0, maxae = 0,
  fixIntercept = false, excluded = [], overlap = 2, svmMisclassified = 1 }) {
  return [
    "# " + (classification ? "[x]" : "c0 + a0 * x"),
    "# Property Label: $prop$; Unit of the Property: eV",
    classification ? `# # Samples in Convex Hull Overlap Region: ${overlap};# Samples SVM Misclassified: ${svmMisclassified}` : `# RMSE: ${rmse}; Max AE: ${maxae}`,
    classification ? "# Decision Boundaries" : "# Coefficients",
    "# Task " + Array.from({ length: dim }, (_, i) => "a" + i).join(" ") + (fixIntercept ? "" : " c0"),
    ...coefficients.map(s => "# " + s),
    "# Feature Rung, Units, and Expressions", ...descriptors.map(s => {
      const fields = s.split(";");
      if (fields.length === 8) fields.splice(7, 0, fields[4]); // Current writer includes R expression.
      return "# " + fields.join(";");
    }),
    "# Number of Samples Per Task", "# Task, n_samples", ...(counts || ["all, " + rows.length]).map(s => "# " + s),
    ...(excluded.length ? ["# Excluded Indexes: [ " + excluded.join(", ") + " ]"] : []),
    "# Sample ID, Property Value, Property Value (EST), Feature 0 Value",
    ...rows, "",
  ].join("\n");
}

export function regressionEntries() {
  return [
    { path: "run/sisso.json", text: JSON.stringify({ property_key: "prop", data_file: "data.csv", calc_type: "regression", desc_dim: 2 }) },
    { path: "run/data.csv", text: 'sample,prop (eV),x (AA)\nA,3,1\nB,5,2\n"sample C, test",8,3\n' },
    { path: "run/models/train_dim_1_model_0.dat", text: model({ rows: ["A,3,3,1", "B,5,5,2"] }) },
    { path: "run/models/test_dim_1_model_0.dat", text: model({ rows: ['sample C, test,8,7,3'], rmse: 1, maxae: 1 }) },
    { path: "run/models/train_dim_2_model_0.dat", text: model({ dim: 2, coefficients: ["all, 2, 1, 1,"],
      descriptors: ["0; 0; AA; 0; x; $x$; x; x", "1; 1; AA^2; 0|sq; (x^2); $x^2$; x.^2; x"],
      rows: ["A,3,4,1,1", "B,5,9,2,4"], rmse: Math.sqrt(8.5), maxae: 4 }) },
    { path: "run/models/test_dim_2_model_0.dat", text: model({ dim: 2, coefficients: ["all, 2, 1, 1,"],
      descriptors: ["0; 0; AA; 0; x; $x$; x; x", "1; 1; AA^2; 0|sq; (x^2); $x^2$; x.^2; x"],
      rows: ['sample C, test,8,16,3,9'], rmse: 8, maxae: 8 }) },
  ];
}

export function multiTaskEntries() {
  const common = { coefficients: ["alpha, 2, 1,", "beta, 3, -1,"], counts: ["alpha, 2", "beta, 2"] };
  return [
    { path: "sisso.json", text: JSON.stringify({ property_key: "prop", task_key: "task", calc_type: "regression" }) },
    { path: "data.csv", text: "sample,task,prop,x\na,alpha,3,1\nb,beta,5,2\nc,alpha,5,2\nd,beta,8,3\ne,beta,11,4\nf,alpha,7,3\n" },
    { path: "train_dim_1_model_0.dat", text: model({ ...common, rows: ["a,3,3,1", "b,5,5,2", "c,5,5,2", "d,8,8,3"] }) },
    { path: "test_dim_1_model_0.dat", text: model({ ...common, counts: ["alpha, 1", "beta, 1"], excluded: [0, 2], rows: ["e,11,11,4", "f,7,7,3"] }) },
  ];
}

export function classificationEntries() {
  const common = { classification: true, coefficients: ["all__0.0_1.0, 1, -2.5,"], counts: ["all, 4"] };
  return [
    { path: "sisso.json", text: JSON.stringify({ property_key: "Class", calc_type: "classification" }) },
    { path: "data.csv", text: "sample,Class,x\nA,0,1\nC,1,3\nB,0,4\nD,1,5\nV,1,2.8\n" },
    { path: "train_dim_1_model_0.dat", text: model({ ...common, rows: ["A,0,0,1", "C,1,1,3", "B,0,1,4", "D,1,1,5"] }) },
    { path: "test_dim_1_model_0.dat", text: model({ ...common, svmMisclassified: 0, counts: ["all, 1"], rows: ["V,1,1,2.8"] }) },
  ];
}

export function classification2DEntries() {
  const common = { dim: 2, classification: true, overlap: 0, svmMisclassified: 0,
    coefficients: ["all__0.0_1.0,1,0,-2,"],
    descriptors: ["0;0;Unitless;0;x;$x$;x;x;x", "1;0;Unitless;1;z;$z$;z;z;z"] };
  return [
    { path: "sisso.json", text: '{"property_key":"prop", "calc_type":"classification", "desc_dim":2, "data_file_relative_to_json":true, "opset":["add","sub","mult","div","sin","cos","six_pow"]}' },
    { path: "data.csv", text: "sample,prop,x,z\nA,0,0,0\nB,0,1,0\nC,0,0,1\nD,1,3,0\nE,1,4,0\nF,1,3,1\nV,1,3.5,0.2\n" },
    { path: "models/train_dim_2_model_0.dat", text: model({ ...common, rows: ["A,0,0,0,0", "B,0,0,1,0", "C,0,0,0,1", "D,1,1,3,0", "E,1,1,4,0", "F,1,1,3,1"] }) },
    { path: "models/test_dim_2_model_0.dat", text: model({ ...common, excluded: [0,1,2,3,4,5], rows: ["V,1,1,3.5,0.2"] }) },
  ];
}

export function logRegressionEntries(multiTask = false, loss = "LOG_RMSE") {
  const co = multiTask ? [`alpha,2,${Math.log(2)},`, `beta,1,${Math.log(3)},`] : [`all,2,${Math.log(2)},`];
  const input = multiTask ? "sample,task,prop,x\na,alpha,2,1\nb,beta,6,2\nc,alpha,8,2\nd,beta,9,3\ne,beta,12,4\nf,alpha,18,3\n" :
    "sample,prop,x\nA,2,1\nB,8,2\nV,18,3\n";
  function output(rows, counts) {
    return model({ coefficients: co, rows, counts }).replace(/^# RMSE:[^\n]+/m,
      loss === "MSLE" ? "# MSLE: 0" : "# LOG_RMSE: 0; Max AE: 0").replace(/^# c0 \+ a0 \* x/m, "# exp(c0) * (x)^a0");
  }
  return [
    { path: "sisso.json", text: JSON.stringify({ property_key: "prop", task_key: "task", calc_type: "log_regression", fix_intercept: false }) },
    { path: "data.csv", text: input },
    { path: "train_dim_1_model_0.dat", text: output(multiTask ? ["a,2,2,1", "b,6,6,2", "c,8,8,2", "d,9,9,3"] : ["A,2,2,1", "B,8,8,2"], multiTask ? ["alpha,2", "beta,2"] : ["all,2"]) },
    { path: "test_dim_1_model_0.dat", text: output(multiTask ? ["e,12,12,4", "f,18,18,3"] : ["V,18,18,3"], multiTask ? ["alpha,1", "beta,1"] : ["all,1"]) },
  ];
}

export function alternativeClassificationEntries(loss = "Davies Bouldin") {
  return classification2DEntries().map(e => e.path.endsWith("sisso.json") ? {
    ...e, text: JSON.stringify({ ...JSON.parse(e.text), project_type: "loss", loss_type: loss === "Davies Bouldin" ? "davies_bouldin" : loss === "Sil Score" ? "silhouette" : "calinski_harabasz" }),
  } : !e.path.endsWith(".dat") ? e : {
    ...e, text: e.text.replace(/^# # Samples in Convex Hull Overlap Region:[^\n]+/m,
      "# " + loss + (loss === "Sil Score" ? (e.path.includes("test_") ? " Test" : " Train") : e.path.includes("test_") ? " Test" : "") + " Loss : 0.25;# Samples SVM Misclassified: 0"),
  });
}
