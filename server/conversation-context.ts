// Durable conversation context for long-running NexBot chats.
// The SQLite transcript remains the source of truth. This file gives local
// CLI agents a compact recent window and a readable on-disk archive they can
// search when an older detail matters.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Message } from "./store.ts";
import { clipForTurn } from "./store.ts";
import { ensureMemory, memoryDir } from "./desk.ts";

export const COMPACT_CONTEXT_WINDOW = 10;
export const COMPACT_CONTEXT_TEXT_CAP = 2_000;
const ARCHIVE_FILE = "conversation-archive.md";
const SUMMARY_FILE = "conversation-summary.md";
const archiveQueue = new Map<string, Pick<Message, "id" | "at" | "role" | "kind" | "text">[]>();
const archiveState = new Map<string, { count: number }>();
let archiveScheduled = false;

export function conversationArchivePath(botId: string): string {
  return join(memoryDir(botId), ARCHIVE_FILE);
}

export function conversationSummaryPath(botId: string): string {
  return join(memoryDir(botId), SUMMARY_FILE);
}

function compactSummary(rows: Pick<Message, "id" | "at" | "role" | "text">[]): string {
  const older = rows.slice(0, -COMPACT_CONTEXT_WINDOW);
  const lines = older.map((message) => {
    const excerpt = (message.text ?? "").replace(/\s+/g, " ").trim().slice(0, 360);
    return `- ${new Date(message.at).toISOString()} · ${message.role === "user" ? "User" : "NexBot"}: ${excerpt}`;
  });
  const body = lines.join("\n");
  // This is an extractive rolling summary, not a second model call. Keep it
  // cheap and bounded; the archive still holds every complete message.
  const clipped = body.length > 48_000 ? `${body.slice(0, 24_000)}\n…\n${body.slice(-24_000)}` : body;
  return `# NexBot compact conversation summary\n\nOlder text turns are represented by short excerpts here. Read the full archive for exact wording.\n\n${clipped}\n`;
}

/** Rebuild the readable archive from the complete persisted transcript. */
export function writeConversationArchive(botId: string, messages: Pick<Message, "id" | "at" | "role" | "kind" | "text">[]): void {
  if (!botId) return;
  ensureMemory(botId);
  const rows = messages.filter((message) => message.kind === "text" && (message.text ?? "").trim());
  const body = rows
    .map((message) => {
      const role = message.role === "user" ? "User" : "NexBot";
      const at = new Date(message.at).toISOString();
      return `## ${at} · ${role} · ${message.id}\n\n${message.text!.trim()}\n`;
    })
    .join("\n");
  writeFileSync(
    conversationArchivePath(botId),
    `# NexBot conversation archive\n\nThis local file mirrors the complete text transcript. The SQLite transcript remains canonical. Search this file when the recent context does not contain an older detail.\n\n${body}`,
    "utf8",
  );
  writeFileSync(conversationSummaryPath(botId), compactSummary(rows), "utf8");
  archiveState.set(botId, { count: rows.length });
}

function drainArchiveQueue(): void {
  archiveScheduled = false;
  const jobs = [...archiveQueue.entries()];
  archiveQueue.clear();
  for (const [botId, messages] of jobs) {
    try {
      const rows = messages.filter((message) => message.kind === "text" && (message.text ?? "").trim());
      const path = conversationArchivePath(botId);
      const state = archiveState.get(botId);
      // Rebuild once after a process restart, then append only new rows. This
      // keeps long conversations durable without rewriting the full archive on
      // every turn.
      if (!state || !existsSync(path) || rows.length < state.count) {
        writeConversationArchive(botId, messages);
        continue;
      }
      const added = rows.slice(state.count);
      if (!added.length) continue;
      appendFileSync(
        path,
        added
          .map((message) => `\n## ${new Date(message.at).toISOString()} · ${message.role === "user" ? "User" : "NexBot"} · ${message.id}\n\n${message.text!.trim()}\n`)
          .join(""),
        "utf8",
      );
      state.count = rows.length;
      writeFileSync(conversationSummaryPath(botId), compactSummary(rows), "utf8");
    } catch {
      // The SQLite transcript remains canonical if a secondary archive write fails.
    }
  }
}

/** Ensure a fresh provider session can search a local copy immediately. */
export function ensureConversationArchive(
  botId: string,
  messages: Pick<Message, "id" | "at" | "role" | "kind" | "text">[],
): void {
  const path = conversationArchivePath(botId);
  if (!existsSync(path) || !existsSync(conversationSummaryPath(botId))) writeConversationArchive(botId, messages);
}

/** Update the readable archive after the turn, outside the request path. */
export function enqueueConversationArchive(
  botId: string,
  messages: Pick<Message, "id" | "at" | "role" | "kind" | "text">[],
): void {
  if (!botId) return;
  archiveQueue.set(botId, messages.map((message) => ({ ...message })));
  if (archiveScheduled) return;
  archiveScheduled = true;
  setImmediate(drainArchiveQueue);
}

export function readConversationArchive(botId: string): string {
  const path = conversationArchivePath(botId);
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

/**
 * Prompt text used only when a provider starts a fresh session. A resumed
 * provider already owns its recent context, so repeating these messages would
 * grow the provider context on every turn.
 */
export function freshSessionContextPrompt(
  botId: string,
  messages: Pick<Message, "kind" | "role" | "fromBot" | "text">[],
): string {
  const recent = clipForTurn(messages, {
    window: COMPACT_CONTEXT_WINDOW,
    textCap: COMPACT_CONTEXT_TEXT_CAP,
  });
  if (!recent.length) {
    return ` Compact conversation summary: ${conversationSummaryPath(botId)}. Full conversation archive: ${conversationArchivePath(botId)}. Use local file tools to search them when older context is needed.`;
  }
  const lines = recent.map((message) => `${message.role === "user" ? "User" : "NexBot"}: ${message.text}`);
  return ` Recent conversation (last ${recent.length} text messages):\n${lines.join("\n\n")}\n\nCompact conversation summary: ${conversationSummaryPath(botId)}. Full conversation archive: ${conversationArchivePath(botId)}. Use local file tools to search them when older context is needed.`;
}
