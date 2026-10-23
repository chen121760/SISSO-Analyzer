/* Loaded only after the user enables RBF-SVM. No remote computation. */
"use strict";
importScripts("sisso-core.js", "sisso-classification.js", "sisso-svm.js", "vendor/libsvm.js");

var batchToken = 0;
self.onmessage = function (event) {
  var message = event.data;
  if (message.type === "boundary") {
    try {
      var mesh = SissoSVM.boundary(message.fit, message.bounds, 128);
      self.postMessage({ type: "boundary", id: message.id, key: message.key, mesh: mesh });
    } catch (error) {
      self.postMessage({ type: "boundaryError", id: message.id, key: message.key, error: error.message });
    }
    return;
  }
  if (message.type !== "start") return;
  var token = ++batchToken, result, config, index = 0;
  try {
    config = SissoSVM.options(message.options);
    result = SissoClassification.runPipeline(message.texts);
    if (result.meta.sissoIn.descDim !== 2) throw new Error("svmOnly2D");
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, error: error.message });
    return;
  }
  function step() {
    if (token !== batchToken) return;
    if (index === result.models.length) { self.postMessage({ type: "done", id: message.id }); return; }
    var model = result.models[index++], summary;
    try { summary = SissoSVM.trainModel(result, model, config, libsvm); }
    catch (error) { summary = { rank: model.rank, status: "failed", error: error.message }; }
    self.postMessage({ type: "model", id: message.id, summary: summary, completed: index });
    setTimeout(step, 0); // let boundary requests and cancellation run between fits
  }
  step();
};
