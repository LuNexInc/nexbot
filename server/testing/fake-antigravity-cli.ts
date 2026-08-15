#!/usr/bin/env node
// Fake of agy's print-mode stream-json protocol for the Antigravity driver.
// FAKE_ANTIGRAVITY_MODE: happy (default) | exit-early | hang | malformed.
import { writeFileSync } from "node:fs";

const mode = process.env.FAKE_ANTIGRAVITY_MODE ?? "happy";
const argv = process.argv.slice(2);
const argAfter = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? null);
};
const out = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");

if (process.env.FAKE_ANTIGRAVITY_DUMP) {
  writeFileSync(process.env.FAKE_ANTIGRAVITY_DUMP, JSON.stringify({ argv, env: process.env }, null, 2));
}

if (mode === "exit-early") {
  process.stderr.write("fake-antigravity: simulated crash before result\n");
  process.exit(3);
}

const conversationId = argAfter("--conversation") ?? "fake-antigravity-session";
const model = argAfter("--model") ?? "gemini-fake";
out({ event: "init", conversation_id: conversationId, init: { model } });

if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else {
  if (mode === "malformed") process.stdout.write("not json\n{broken\n");

out({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 1,
    state: "ACTIVE",
    step_type: "agent_response",
    text_delta: "hello from fake antigravity",
  },
});
out({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 2,
    state: "ACTIVE",
    step_type: "tool",
    tool_name: "run_command",
    tool_info: { name: "run_command", parameters: { CommandLine: "echo test" } },
  },
});
out({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 2,
    state: "DONE",
    step_type: "tool",
    tool_name: "run_command",
    tool_info: { name: "run_command", output: "test\r\n" },
  },
});
out({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 1,
    state: "DONE",
    step_type: "agent_response",
    usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2 },
  },
});
out({
  event: "result",
  result: {
    conversation_id: conversationId,
    status: "SUCCESS",
    response: "hello from fake antigravity",
    usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2 },
  },
});
  process.exit(0);
}
