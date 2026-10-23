import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Emulate only the worker host surface. The actual browser bundle, projection
// code, SVM engine and worker protocol all execute unmodified in this context.
export function workerHarness(engine) {
  const tasks = [], messages = [];
  const context = vm.createContext({
    URL, location: { href: "http://localhost/js/sisso-svm-worker.js" + (engine === "simple" ? "?engine=simple" : "") },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(fn) { tasks.push(fn); return tasks.length; }, clearTimeout() {},
    postMessage(message) { messages.push(structuredClone(message)); },
  });
  vm.runInContext("self = globalThis; class WorkerGlobalScope { static [Symbol.hasInstance]() { return true; } }", context);
  context.importScripts = (...files) => {
    for (const name of files) vm.runInContext(fs.readFileSync(path.join(ROOT, "js", name), "utf8"), context, { filename: name });
  };
  context.importScripts("sisso-svm-worker.js");
  return { context, tasks, messages, drain() { while (tasks.length) tasks.shift()(); } };
}
