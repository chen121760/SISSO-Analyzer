/* Worker lifecycle, per-run results and a small on-demand boundary cache. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sisso-svm.js"), root);
  else root.SissoSVMController = factory(root.SissoSVM, root);
})(typeof self !== "undefined" ? self : this, function (Engine, root) {
  "use strict";
  function create(callbacks) {
    callbacks = callbacks || {};
    var engine = callbacks.engine || Engine;
    var worker = null, pending = new Set();
    var api = { enabled: false, status: "idle", id: 0, completed: 0, total: 0, failed: 0,
      error: null, config: engine.options(), results: new Map(), boundaries: new Map(), boundaryErrors: new Map() };
    function notify(kind, summary) { if (callbacks.change) callbacks.change(kind, summary); }
    function terminate() {
      if (worker) { worker.terminate(); worker = null; }
      api.id++; pending.clear();
    }
    function fail(error) { terminate(); api.status = "error"; api.error = error; notify("error"); }
    function ensureWorker() {
      if (worker) return worker;
      try {
        var current = callbacks.workerFactory ? callbacks.workerFactory() : new root.Worker(callbacks.workerURL || "js/sisso-svm-worker.js");
        worker = current;
        current.onerror = function (event) {
          if (event.preventDefault) event.preventDefault();
          if (worker === current) fail("svmWorkerError");
        };
        current.onmessage = function (event) {
          var m = event.data;
          if (worker !== current || m.id !== api.id) return;
          if (m.type === "model") {
            api.results.set(m.summary.rank, m.summary); api.completed = m.completed;
            if (m.summary.status === "failed") api.failed++;
            notify("model", m.summary);
          } else if (m.type === "done") { api.status = "done"; notify("done"); }
          else if (m.type === "error") fail(m.error || "svmWorkerError");
          else if (m.type === "boundary" || m.type === "boundaryError") {
            pending.delete(m.key);
            var cache = m.type === "boundary" ? api.boundaries : api.boundaryErrors;
            if (cache.size >= 8) cache.delete(cache.keys().next().value);
            cache.set(m.key, m.type === "boundary" ? m.mesh : m.error);
            if (callbacks.boundary) callbacks.boundary(m.key);
          }
        };
        return worker;
      } catch (error) { fail("svmWorkerError"); return null; }
    }
    api.reset = function () {
      terminate(); api.enabled = false; api.status = "idle"; api.completed = 0; api.total = 0; api.failed = 0; api.error = null;
      api.results.clear(); api.boundaries.clear(); api.boundaryErrors.clear();
    };
    api.disable = function () { api.reset(); notify("disabled"); };
    api.start = function (texts, total, config) {
      config = engine.options(config);
      api.reset(); api.enabled = true; api.status = "running"; api.total = total; api.config = config;
      var current = ensureWorker();
      if (current) { current.postMessage({ type: "start", id: api.id, texts: texts, options: config }); notify("start"); }
    };
    api.stop = function () {
      terminate(); api.status = "cancelled"; notify("cancelled");
    };
    api.boundaryKey = function (rank, bounds) { return JSON.stringify([rank, bounds]); };
    api.requestBoundary = function (rank, bounds) {
      var summary = api.results.get(rank), key = api.boundaryKey(rank, bounds);
      if (!api.enabled || !summary || summary.status !== "ready" || api.status === "error") return key;
      if (api.boundaries.has(key) || api.boundaryErrors.has(key) || pending.has(key)) return key;
      var current = ensureWorker();
      if (current) {
        pending.add(key);
        current.postMessage({ type: "boundary", id: api.id, key: key, fit: summary.fit, bounds: bounds });
      }
      return key;
    };
    return api;
  }
  return { create: create };
});
