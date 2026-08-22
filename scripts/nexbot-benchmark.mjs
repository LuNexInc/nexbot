import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreAttempts } from "../server/evaluation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const base = value("--url", process.env.NEXBOT_URL || "http://127.0.0.1:8799").replace(/\/$/, "");
const suitePath = resolve(value("--suite", join(here, "..", "benchmarks", "core.json")));
const outputPath = resolve(value("--out", join(here, "..", "outputs", `benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)));
const suite = JSON.parse(readFileSync(suitePath, "utf8"));
const runs = Math.max(1, Number(value("--runs", suite.runs || 3)));

async function api(path, init) {
  const response = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    signal: init?.signal || AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

const hydrated = await api("/api/bots");
const requestedBot = value("--bot", suite.bot || "Luna");
const bot = hydrated.bots.find((row) => row.id === requestedBot || String(row.name).toLowerCase() === String(requestedBot).toLowerCase());
if (!bot) throw new Error(`Benchmark bot not found: ${requestedBot}`);

const attempts = [];
for (const testCase of suite.cases || []) {
  for (let run = 1; run <= runs; run += 1) {
    const nonce = `bench_${Date.now()}_${testCase.id}_${run}`;
    const startedAt = Date.now();
    await api(`/api/bots/${bot.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: testCase.prompt, clientNonce: nonce, delivery: "queue" }),
    });
    let job = null;
    const deadline = Date.now() + Number(suite.timeoutMs || 180_000);
    while (Date.now() < deadline) {
      const current = await api(`/api/bots/${bot.id}`);
      const userMessage = current.bot.messages.find((message) => message.clientNonce === nonce);
      const jobs = (await api("/api/jobs?all=1")).jobs;
      job = userMessage ? jobs.find((row) => row.messageId === userMessage.id) : null;
      if (job && ["completed", "failed", "interrupted"].includes(job.status)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    if (!job) throw new Error(`${testCase.id} run ${run} did not produce a job before timeout`);
    const finalBot = (await api(`/api/bots/${bot.id}`)).bot;
    const userIndex = finalBot.messages.findIndex((message) => message.id === job.messageId);
    const reply = finalBot.messages.slice(userIndex + 1).filter((message) => message.role === "bot" && message.kind === "text").map((message) => message.text || "").join("\n");
    const receipts = (await api(`/api/execution-receipts?jobId=${encodeURIComponent(job.id)}&limit=500`)).receipts || [];
    const successfulTools = receipts.filter((receipt) => receipt.status === "succeeded").length;
    const verifiedStateChanges = receipts.filter((receipt) => receipt.verification === "changed").length;
    const required = testCase.expected || {};
    const requiredTextMatched = (required.replyIncludes || []).every((needle) => reply.includes(needle));
    const durationMs = Math.max(0, Number(job.updatedAt || Date.now()) - Number(job.createdAt || startedAt));
    const ok = job.status === "completed"
      && requiredTextMatched
      && successfulTools >= Number(required.minSuccessfulTools || 0)
      && verifiedStateChanges >= Number(required.minStateChanges || 0)
      && (!required.maxDurationMs || durationMs <= Number(required.maxDurationMs));
    attempts.push({ caseId: testCase.id, run, jobId: job.id, ok, durationMs, successfulTools, verifiedStateChanges, requiredTextMatched, reply });
    process.stdout.write(`${ok ? "PASS" : "FAIL"} ${testCase.id} run ${run} (${durationMs} ms, ${successfulTools} successful tool(s))\n`);
  }
}

const report = { suite: suitePath, bot: { id: bot.id, name: bot.name }, base, createdAt: new Date().toISOString(), attempts, scores: scoreAttempts(attempts) };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2));
process.stdout.write(`Benchmark report: ${outputPath}\n`);
process.exitCode = attempts.every((attempt) => attempt.ok) ? 0 : 1;
