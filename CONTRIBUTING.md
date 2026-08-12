# Contributing to NexBot

NexBot is a LuNex Inc product. Canonical development lives in Charles's workspace folder
`AI Projects/nexbot`. The public repo is `LuNexInc/nexbot`.

## Provenance

This codebase started as a rebranded fork of [](https://github.com/-/)
(MIT). Keep attribution in `LICENSE` and `NOTICE` when you touch license headers or large copies.

## Dev setup

```sh
git clone https://github.com/LuNexInc/nexbot && cd nexbot
pnpm install

pnpm dev:server    # harness → 127.0.0.1:8799
pnpm dev           # app → http://127.0.0.1:5199
pnpm dev:desktop   # Electron (Windows or macOS)
pnpm package:win   # NSIS + portable under release/
```

Requirements: **Node 24+**, **pnpm**, and at least one agent CLI (`claude`, `codex`, or `grok`)
logged in. Packaged shells: Windows (`package:win`) and macOS (`package:mac`).

Data lives in `~/.nexbot/` (bots, transcripts, per-thread NDJSON event logs, config with keys).

## Tests

```sh
pnpm typecheck
pnpm test
```

Never point tests at a real `~/.nexbot` with production keys. Test setup redirects `HOME` to a temp dir.

## Security

Read `SECURITY.md`. Do not log secrets. Do not reintroduce shipped analytics tokens without an
explicit product decision and opt-in.
