# Getting started with NexBot

A short guide for the installed app. NexBot is a chat app where every contact
is a real AI agent running on this PC through a provider CLI you already have.

## 1. Install a provider CLI and sign in

NexBot drives local agent CLIs with your existing logins — it never sits
between you and a provider account. Install at least one:

- **Claude Code** — `npm i -g @anthropic-ai/claude-code`, then run `claude` once and sign in.
- **Codex** — `npm i -g @openai/codex`, then run `codex` once and sign in.
- **Grok** — install from <https://x.ai/cli>, then run `grok` once and sign in.

Windows note: the CLIs install as `.cmd` shims; NexBot resolves and spawns
them correctly — just make sure they are on PATH.

## 2. First run

Launch NexBot. The first-run wizard:

1. Asks what to call you (email is optional — NexBot ships no analytics).
2. Checks which provider CLIs are signed in and picks a default model.
3. Sets up your Chief of Staff — the teammate that routes work to specialists.

Every step is skippable, and `Escape` exits the wizard at any time.

## 3. Chat, delegate, watch

- Message a teammate directly, or `@Name` inside any chat to loop in a
  specialist. The composer supports multi-line: `Enter` sends, `Shift+Enter`
  starts a new line.
- `Ctrl+K` searches teammates **and** message history; picking a history hit
  jumps to that exact message.
- A busy teammate accepts queued (`queue`), next-turn (`steer`), or
  interrupting (`replace`) messages from the composer.
- Grant a teammate the local computer and watch it work in the Computer
  panel; risky actions always ask first.

## 4. Check health

`App Settings → gear → doctor` (or `nexbot doctor` from an install) verifies
the local store, queue, jobs, computer-use driver, and provider readiness in
one report. If a teammate cannot start, run doctor first.

## 5. Where your data lives

Everything stays on this PC under `~/.nexbot`:

| Path | Contents |
|------|----------|
| `store.db` | Transcripts and roster (SQLite, FTS-searchable) |
| `memory/<bot>/` | Durable per-bot memory |
| `desk/<bot>/` | Files a bot reads and produces |
| `config.json` | Encrypted keys and settings |

## 6. Phone or tablet access

From the same Wi-Fi (or a private WireGuard tunnel), pair the NexBot Connect
Android app or open the mobile surface — see [`remote-access.md`](remote-access.md)
and [`connect-android.md`](connect-android.md). The PC remains the agent host;
no cloud AI or hosted database is involved.

## Troubleshooting quick hits

- **"No AI provider is ready"** — no CLI is installed/signed in. Install one
  from step 1, then rerun doctor.
- **Port 8799 busy** — another NexBot harness is running (tray). Quit it from
  the tray menu before starting a second one.
- **A turn seems stuck** — use Stop in the chat header; the watchdog also
  settles silent turns on its own.
- **Something looks wrong** — `~/.nexbot/events/` and `~/.nexbot/native/`
  hold per-thread NDJSON logs that a bug report can point at.
