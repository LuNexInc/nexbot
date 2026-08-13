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

**How to preview:** Quit installed NexBot (tray → Quit) if you need the source harness — else Vite talks to 0.3.8's :8799. Then `pnpm dev:server` and `pnpm dev` → http://127.0.0.1:5199. Optional `pnpm dev:desktop` (NexBot-dev, Vite UI). If EADDRINUSE / port busy: quit the tray app first. Vite :5199 is UI only. Do not `pnpm package:win` to preview.

Requirements: **Node 24+**, **pnpm**, and at least one of [`claude`](https://claude.com/claude-code),
[`codex`](https://github.com/openai/codex), or [`grok`](https://x.ai/cli) on PATH.

Optional keys (App Settings → gear): Composio Connect (`ck_…`), Composio API (`ak_…`).
NexBot does not use a cloud desktop (no Box). Local CUA drives this PC.

```sh
pnpm typecheck
pnpm test
pnpm package:win    # NSIS installer + portable .exe under release/
pnpm package:mac    # macOS (on a Mac)
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
| Drivers | `server/drivers/` | Claude, Codex, Grok, cloud computer |
| Harness | `server/harness/` | Registry + event bus |
| API | `server/index.ts` | Bots, turns, approvals, connectors, config |
| App | `src/` | Chat UI |
| Desktop | `electron/` | macOS shell, dictation, CUA bridge |

## Security notes

- Local harness has **no auth** (trusts the machine user). Bind is `127.0.0.1` only.
- Agents run with your user privileges. Approve shell and computer actions deliberately.
- Report issues per `SECURITY.md`.

## License

[MIT](LICENSE) © 2026 LuNex Inc.
