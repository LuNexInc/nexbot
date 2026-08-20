#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);
const commands = {
  doctor: "nexbot-doctor.mjs",
  benchmark: "nexbot-benchmark.mjs",
};

if (!command || !(command in commands)) {
  process.stderr.write("Usage: nexbot <doctor|benchmark> [options]\n");
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, [join(here, commands[command]), ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`NexBot ${command} failed to start: ${result.error.message}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
