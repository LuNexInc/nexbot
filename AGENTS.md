# NexBot — project rules

LuNex Inc agent messaging desktop + harness. Public publish target: **LuNexInc/nexbot**.

## What this is

Telegram-style UI where each chat is a local AI agent CLI (Claude Code, Codex, Grok Build).
Forked and rebranded from  (MIT). Attribution in `NOTICE` and `LICENSE`.

## Source of truth

- **Canonical:** this folder in `AI Projects` (`nexbot\`). No nested `.git` here.
- **Publish:** `LuNexInc/nexbot` — local clone `_publish/nexbot-repo` (gitignored). Sync tracked source into the publish clone, then push. Do not implement only in the publish clone.
- Before any release/tag: run workspace preflight (`nexbot` is in `.tools/publish-targets.json`).

## Hard product rules

1. **No shipped third-party analytics** without Charles's explicit OK (PostHog was stripped).
2. **Secrets only in** `~/.nexbot/config.json` or env — never commit keys.
3. **Harness binds 127.0.0.1 only.** Do not open it to LAN without auth design.
4. **Keep MIT attribution** to  /   when redistributing.
5. **Windows desktop packaging is not done.** Do not claim multi-platform installers yet.
6. Follow root workspace `AGENTS.md` (handoff, STE writing, no `git add -A`).

## Dev

```powershell
pnpm install
pnpm dev:server
pnpm dev
pnpm typecheck
pnpm test
```

Node 24+, pnpm. macOS for Electron desktop features (speech helper, CUA TCC).

## Related LuNex products

- **Basiliskos** (`hydra-gateway` → `LuNexInc/basiliskos`): multi-backend Claude window controller.
- **Grokulator** (`LuNexInc/grokulator`): Grok Build desktop host.
- **NexBot** is the multi-bot *messaging* shell — different job from Basiliskos.

## MAP / DECISIONS

See `MAP.md` and `DECISIONS.md` in this folder.
