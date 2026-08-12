# NexBot — MAP

Last verified: 2026-08-12

## Open first

| Need | Path |
|------|------|
| Product rules | `AGENTS.md` |
| Settled choices | `DECISIONS.md` |
| Upstream credit | `NOTICE`, `LICENSE` |
| Harness HTTP + SSE | `server/index.ts` |
| Config / data dir | `server/config.ts` → `~/.nexbot` |
| Drivers | `server/drivers/` |
| React shell | `src/App.tsx`, `src/state/store.tsx` |
| Electron main | `electron/main.mjs` |
| Analytics stubs | `src/lib/analytics.ts` |
| Builder id | `electron-builder.yml` → `com.lunexinc.nexbot` |

## Layout

```
nexbot/
  server/          harness (Node, 127.0.0.1:8799)
  src/             React UI (Vite :5199)
  electron/        macOS desktop shell
  dist-server/     compiled harness (may lag source — rebuild with pnpm build:server)
  docs/            design notes (upstream + local)
```

## Out of scope for this map

Release binary pipelines, Windows installer, Composio/Box account setup (user keys).
