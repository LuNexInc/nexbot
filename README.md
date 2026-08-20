# NexBot

**Your own team of AI bots, in a chat app.**

LuNex Inc's open-source agent messaging shell. Each sidebar contact is a real local agent
(`claude`, `codex`, or `grok` CLI) with its own personality, model, optional local computer (this PC),
and connected apps.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Electron](https://img.shields.io/badge/Electron-Windows%20·%20macOS-2B2E3A?logo=electron&logoColor=9FEAF9)
![License](https://img.shields.io/badge/license-MIT-38d591)

## Why NexBot

- **Bring your own agents.** Uses CLIs already installed and logged in — no proxy account in the middle.
- **Local first.** Harness server on `127.0.0.1`. Transcripts and keys in `~/.nexbot`.
- **No shipped analytics.** Optional local profile only. No PostHog token in the client.
- **LuNex product.** Public source: [LuNexInc/nexbot](https://github.com/LuNexInc/nexbot).

## Quick start (from source)

```sh
git clone https://github.com/LuNexInc/nexbot && cd nexbot
pnpm install

pnpm dev:server    # harness → 127.0.0.1:8799 (quit installed tray first if you need source)
pnpm dev           # app → http://127.0.0.1:5199
pnpm dev:desktop   # optional: NexBot-dev profile, Vite UI
```

To use the full app from a phone or tablet on the same Wi-Fi, follow
[`docs/remote-access.md`](docs/remote-access.md). The PC remains the local
agent host, so no cloud AI or hosted database is required.

**How to preview:** Quit installed NexBot (tray → Quit) if you need the source harness — else Vite talks to 0.3.8's :8799. Then `pnpm dev:server` and `pnpm dev` → http://127.0.0.1:5199. Optional `pnpm dev:desktop` (NexBot-dev, Vite UI). If EADDRINUSE / port busy: quit the tray app first. Vite :5199 is UI only. Do not `pnpm package:win` to preview.

Requirements: **Node 24+**, **pnpm**, and at least one of [`claude`](https://claude.com/claude-code),
[`codex`](https://github.com/openai/codex), or [`grok`](https://x.ai/cli) on PATH.

Optional keys (App Settings → gear): Composio Connect (`ck_…`), Composio API (`ak_…`).
NexBot does not use a cloud desktop (no Box). Local CUA drives this PC.

```sh
pnpm typecheck
pnpm test
pnpm run doctor     # local store, CUA, queue, jobs, and provider readiness
pnpm package:win    # NSIS installer + portable .exe under release/
pnpm package:mac    # macOS (on a Mac)
```

Busy bots accept durable `queue`, next-turn `steer`, and interrupting `replace`
messages. Execution receipts distinguish a tool attempt from a verified state
change. App Settings also provides operator takeover, an encrypted per-bot
credential vault, custom ACP providers, and the same doctor report.

The live benchmark sends real turns and writes its report under `outputs/`.
Run it against a disposable profile or an intended test bot because it uses
provider quota and adds benchmark messages to that bot's transcript.

```sh
pnpm run benchmark -- --bot Luna --runs 3
```

## Status

| Area | Status |
|------|--------|
| Harness + Claude/Codex/Grok drivers | Windows + Unix (`.cmd` spawn fixed) |
| Windows Electron shell | 0.3.0 — NSIS + portable |
| macOS Electron shell | Present |
| Local CUA (drive this PC) | Windows + macOS + Linux via trycua; no cloud Box |
| Product analytics | Removed (no-op local stubs) |

## How it works

Two processes. The React app sends typed HTTP commands and folds one SSE event stream. The harness
owns agent processes and normalizes each provider protocol into one event stream (NDJSON per thread).

| Layer | Path | Role |
|-------|------|------|
| Drivers | `server/drivers/` | Claude, Codex, Grok, and generic ACP |
| Harness | `server/harness/` | Registry + event bus |
| API | `server/index.ts` | Bots, turns, approvals, connectors, config |
| App | `src/` | Chat UI |
| Desktop | `electron/` | macOS shell, dictation, CUA bridge |

## Security notes

- Loopback is trusted. Non-loopback API clients need the configured access token.
- Agents run with your user privileges. High-risk actions require approval by default.
- Credential values are encrypted and granted per bot. Focused-field fill does not return a value to the model.
- Report issues per `SECURITY.md`.

## License

[MIT](LICENSE) © 2026 LuNex Inc.
