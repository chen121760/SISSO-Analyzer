import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Controller = require("../js/sisso-svm-controller.js");
const workers = [], updates = [];
class Worker {
  constructor() { this.sent = []; this.stopped = false; workers.push(this); }
  postMessage(message) { this.sent.push(message); }
  terminate() { this.stopped = true; }
  emit(data) { this.onmessage({ data }); }
}
const ctl = Controller.create({ workerFactory: () => new Worker(), change: (kind) => updates.push(kind) });
assert.equal(ctl.enabled, false);
assert.equal(workers.length, 0, "no worker/library/training until explicit activation");
ctl.start({ train: "training" }, 2, { cost: 2 });
const first = workers[0], id = ctl.id;
assert.equal(first.sent[0].type, "start");
assert.equal(ctl.status, "running");
const summary = { rank: 1, status: "ready", fit: { serialized: "fitted" }, train: { accuracy: .9 } };
first.emit({ type: "model", id, completed: 1, summary });
assert.equal(ctl.results.size, 1);
ctl.stop();
assert.ok(first.stopped);
assert.equal(ctl.status, "cancelled");
assert.equal(ctl.results.size, 1);
first.emit({ type: "model", id, completed: 2, summary: { rank: 2 } });
assert.equal(ctl.results.size, 1);
const key = ctl.requestBoundary(1, [[0, 1], [0, 1]]), second = workers[1];
assert.equal(second.sent[0].type, "boundary");
ctl.requestBoundary(1, [[0, 1], [0, 1]]);
assert.equal(second.sent.length, 1, "do not duplicate pending boundary requests");
second.emit({ type: "boundary", id: ctl.id, key, mesh: { segments: [[0, 0, 1, 1]] } });
ctl.requestBoundary(1, [[0, 1], [0, 1]]);
assert.equal(second.sent.length, 1, "reuse cached boundary");
for (let i = 1; i < 12; i++) {
  const k = ctl.requestBoundary(1, [[0, i + 1], [0, 1]]);
  second.emit({ type: "boundary", id: ctl.id, key: k, mesh: { segments: [] } });
}
assert.equal(ctl.boundaries.size, 8);
assert.throws(() => ctl.start({}, 2, { cost: -1 }));
assert.equal(ctl.results.size, 1, "invalid settings do not discard completed scores");
ctl.start({}, 2, {});
assert.ok(second.stopped);
assert.equal(ctl.results.size, 0);
const third = workers[2];
third.emit({ type: "model", id: ctl.id, completed: 1, summary: { rank: 1, status: "failed", error: "svmInvalidCoordinates" } });
third.emit({ type: "model", id: ctl.id, completed: 2, summary });
third.emit({ type: "done", id: ctl.id });
assert.equal(ctl.completed, 2);
assert.equal(ctl.failed, 1);
assert.equal(ctl.status, "done");
ctl.reset();
assert.ok(third.stopped);
assert.equal(ctl.enabled, false);
assert.equal(ctl.results.size, 0);
assert.equal(ctl.boundaries.size, 0);
ctl.start({}, 2, {});
workers[3].onerror({ preventDefault() {} });
assert.equal(ctl.status, "error");
assert.equal(ctl.error, "svmWorkerError");
ctl.disable();
assert.equal(ctl.enabled, false);
assert.equal(updates.at(-1), "disabled");
console.log("PASS explicit opt-in, immediate cancellation, stale-message rejection, retry, per-run reset, failure handling and bounded boundary cache");
