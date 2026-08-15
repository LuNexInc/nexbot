# NexBot — project rules

LuNex Inc agent messaging desktop + harness. Public publish target: **LuNexInc/nexbot**.

## What this is

Telegram-style UI where each chat is a local AI agent CLI (Claude Code, Codex, Grok Build).

## Source of truth

- **Canonical:** this folder in `AI Projects` (`nexbot\`). No nested `.git` here.
- **Publish:** `LuNexInc/nexbot` — local clone `_publish/nexbot-repo` (gitignored). Sync tracked source into the publish clone, then push. Do not implement only in the publish clone.
- Before any release/tag: run workspace preflight (`nexbot` is in `.tools/publish-targets.json`).

## Hard product rules

1. **No shipped third-party analytics** without Charles's explicit OK (PostHog was stripped).
2. **Secrets** live encrypted in `~/.nexbot/config.json` (wrapping key `master.key`) or env — never commit keys, never echo them.
3. **Harness binds 127.0.0.1 by default.** Off-loopback bind requires the harness token (or steer token on the phone surface). Do not open LAN without that.
4. **LICENSE** copyright is © 2026 LuNex Inc. Do not put third-party product names in the UI, README, or About panel.
5. **Windows is supported** for harness + Electron shell + NSIS/portable packages. Local CUA uses installed/bundled `cua-driver` (trycua) on Windows, macOS, and Linux.
6. Follow root workspace `AGENTS.md` (handoff, STE writing, no `git add -A`).

## Dev

```powershell
pnpm install
pnpm dev:server   # 127.0.0.1:8799 — quit installed tray first if you need source
pnpm dev          # Vite UI :5199
pnpm dev:desktop  # optional: NexBot-dev profile, Vite UI
pnpm typecheck
pnpm test
pnpm package:win  # release installer — not the UI preview path
```

**How to preview:** Quit installed NexBot (tray → Quit) if you need the source harness — else Vite talks to 0.3.8's :8799. Then `pnpm dev:server` and `pnpm dev` → http://127.0.0.1:5199. Optional `pnpm dev:desktop` (NexBot-dev, Vite UI). If EADDRINUSE / port busy: quit the tray app first. Vite :5199 is UI only. Do not `pnpm package:win` to preview.

Node 24+, pnpm. Windows and macOS desktop shells. macOS still owns native speech helper + CUA TCC.

## Related LuNex products

- **Basiliskos** (`hydra-gateway` → `LuNexInc/basiliskos`): multi-backend Claude window controller.
- **Grokulator** (`LuNexInc/grokulator`): Grok Build desktop host.
- **NexBot** is the multi-bot *messaging* shell — different job from Basiliskos.

## MAP / DECISIONS

See `MAP.md` and `DECISIONS.md` in this folder.
