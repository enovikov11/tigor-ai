#!/usr/bin/env node
// Zero-dependency CDP smoke harness for a local static web app.
// Node >= 18 has a global WebSocket, so no puppeteer is needed.
//
// Usage:
//   node cdp_probe.mjs <chromium-binary> <url> <probe.mjs> [waitMs=4500]
//
// - Spawns headless Chromium with remote debugging, waits for the target.
// - Enables Page/Runtime/Log/Network, navigates to <url>, waits <waitMs>.
// - Dynamic-imports <probe.mjs> and calls its default export with
//     { eval: (js) => Promise<value>, page: {url} }
//   The probe should return a plain object of observations/assertions.
// - Prints the probe result, then all console messages, exceptions, and
//   failed network requests. Exits 1 if the probe returns a `failures` array
//   (non-empty) or if any page exception was captured.

import { spawn } from "node:child_process";

const [chromium, url, probePath] = process.argv.slice(2);
const WAIT = Number(process.argv[5] || 4500);
if (!chromium || !url || !probePath) {
  console.error("usage: node cdp_probe.mjs <chromium> <url> <probe.mjs> [waitMs]");
  process.exit(2);
}

const PORT = 9222 + (Math.floor(Math.random() * 100));
const profile = "/tmp/cdp-profile-" + process.pid;

const chrome = spawn(chromium, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox",
  "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
  "--window-size=1280,900", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
let chromeOut = "";
chrome.stdout.on("data", d => (chromeOut += d));
chrome.stderr.on("data", d => (chromeOut += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error("could not reach CDP. chrome:\n" + chromeOut.slice(-1500));
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error("ws err")); });

let msgId = 0; const pending = new Map();
const consoleMsgs = []; const exceptions = []; const failedReq = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") {
    const t = (m.params.args || []).map(a => a.value != null ? a.value : (a.description || a.unserializableValue || "")).join(" ");
    consoleMsgs.push({ type: m.params.type, text: String(t) });
  } else if (m.method === "Runtime.exceptionThrown") {
    exceptions.push(m.params.exceptionDetails.exception?.description || JSON.stringify(m.params.exceptionDetails));
  } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    consoleMsgs.push({ type: "log-error", text: m.params.entry.text });
  } else if (m.method === "Network.loadingFailed") {
    failedReq.push(m.params.requestId + " " + (m.params.errorText || ""));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, { resolve }); ws.send(JSON.stringify({ id, method, params }));
});
async function evalJS(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails));
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send("Page.enable"); await send("Runtime.enable");
await send("Log.enable"); await send("Network.enable");
await send("Page.navigate", { url });
await sleep(WAIT);

let result = { probe: "not run" };
try {
  const probe = (await import("file://" + probePath)).default;
  result = await probe({ eval: evalJS, page: { url } });
} catch (e) {
  result = { probeError: String(e && e.stack || e) };
}

console.log("PROBE RESULT:");
console.log(JSON.stringify(result, null, 2));
console.log("\nCONSOLE:");
for (const c of consoleMsgs) console.log("  [" + c.type + "]", c.text.slice(0, 300));
console.log("\nEXCEPTIONS:");
for (const e of exceptions) console.log("  " + String(e).slice(0, 300));
if (failedReq.length) { console.log("\nFAILED REQUESTS:"); for (const f of failedReq) console.log("  " + f); }

const failed = Array.isArray(result.failures) ? result.failures : [];
if (failed.length) { console.log("\nSMOKE FAILURES:\n  - " + failed.join("\n  - ")); }
else if (exceptions.length) { console.log("\nSMOKE FAILED (page exceptions) "); }
else console.log("\nSMOKE OK (no failures, no page exceptions)");

try { ws.close(); } catch (_) {}
chrome.kill("SIGTERM");
process.exit(failed.length || exceptions.length ? 1 : 0);
