/* Heavy post-evaluation is isolated from rendering and cancelled by termination. */
importScripts("sisso-core.js", "sisso-classification.js", "sisso-evaluation.js", "sisso-evaluation-batch.js");
self.onmessage = async function (event) {
  try {
    var job = event.data;
    self.postMessage({ stage: "computing" });
    var report = job.batch ? await SissoEvaluationBatch.evaluateAll(job.result, job.config, { onProgress: function (progress) { self.postMessage({ stage: "batch", progress: progress }); } }) :
      job.bundle ? SissoEvaluation.evaluateBundle(job.bundle, job.datasetId, job.config) : SissoEvaluation.evaluate(job.result, job.model, job.config);
    if (self.crypto && self.crypto.subtle) {
      var source = JSON.stringify(job, function (_, v) { return ArrayBuffer.isView(v) ? Array.from(v) : v; });
      var digest = await self.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      report.manifest.inputSHA256 = Array.from(new Uint8Array(digest), function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    }
    self.postMessage({ report: report });
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
