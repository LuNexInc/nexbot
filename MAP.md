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
| Windows CLI spawn | `server/cli-spawn.ts` |
| Drivers | `server/drivers/` |
| React shell | `src/App.tsx`, `src/state/store.tsx` |
| Electron main | `electron/main.mjs` |
| Analytics stubs | `src/lib/analytics.ts` |
| Builder | `electron-builder.yml` → `com.lunexinc.nexbot` |
| Windows installer | `pnpm package:win` → `release\NexBot-Setup-*.exe` |

## Layout

```
nexbot/
  server/          harness (Node, 127.0.0.1:8799)
  src/             React UI (Vite :5199)
  electron/        desktop shell (Windows + macOS)
  dist-server/     compiled harness (rebuild with pnpm build:server)
  release/         installers (gitignored)
  docs/            design notes
```

## Out of scope for this map

Code-signed Authenticode certs, Composio/Box account setup (user keys).
