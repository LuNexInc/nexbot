# NexBot — MAP

Last verified: 2026-08-22

## Stay-local workflow

Computer use is this PC only (CUA + tray keepalive). No Cloudflare / Huawei / Oracle / Box.

1. **Assign** — chat, `@Name` for a parallel job, or phone on the same LAN `http://<this-pc>:8799/m.html`.
2. **Act** — CUA on this desktop. Files: `~/.nexbot/desk/<bot>/inbox` and `out`. Optional Memory: `~/.nexbot/memory/<id>/profile.md` + `log/YYYY-MM.md` (not the chat log).
3. **Watch** — Computer panel, Open in window, or `/watch.html`.
4. **Leave** — close the window; tray keeps cron, webhook, and file-watch routines. Toast when a turn finishes.
5. **Do not** sleep, log off, or Quit if the job must finish.
6. **After reboot** — task `NexBot keepalive` starts `--hidden`. Overdue routines replay. `pending-turns.json` orphans are settled before HTTP/SSE. Chat transcripts persist in `~/.nexbot/store.db` (SQLite WAL + FTS5; JSON imported on first start).

## How to preview

1. Quit installed NexBot if you need the source harness (tray → Quit) — else Vite talks to 0.3.8's :8799 and server/ changes will not show.
2. `pnpm dev:server` → :8799 (source)
3. `pnpm dev` → http://127.0.0.1:5199
4. Optional `pnpm dev:desktop` (NexBot-dev profile, Vite UI)
5. If EADDRINUSE / port busy: quit the tray app first. Vite :5199 is UI only.
6. Do not `pnpm package:win` to preview.

## Open first

| Need | Path |
|------|------|
| Product rules | `AGENTS.md` |
| Settled choices | `DECISIONS.md` |
| License | `LICENSE` |
| Harness HTTP + SSE | `server/index.ts` (bootstrap, auth gate, events/wipe/artifacts) + `server/web/` route modules: `internal-routes.ts` (peer-agent comms), `bot-routes.ts` (roster/chat/takeover/memory/computer), `routine-routes.ts` (cron/webhooks/skills), `access-routes.ts` (steer/harness/Connect/WireGuard), `platform-routes.ts` (jobs/config/credentials/connectors/feed). Shared state: `server/web/context.ts`. |
| Turn recovery | `server/jobs.ts` + `server/recovery.ts` — SQLite job rows, provider checkpoints, Resume/Retry cards |
| Agent coordination | `server/task-context.ts` — equal bot delegation with bounded task scope; `server/handoff-promise.ts` — guaranteed ping-back on a queued handoff (`send_bot` and the autoRoute busy path) resolving the delegator in its thread with the result + ⚠ caveat; `ask_bot`/`send_bot` relays carry the peer's ⚠ caveat; group-thread copies get the member's ⚠ caveat propagated |
| Busy message control | `server/turn-queue.ts` + `src/components/Composer.tsx` — durable FIFO queue, next-turn steer, or interrupt-and-replace |
| Execution evidence | `server/execution-evidence.ts` + `src/components/ExecutionRail.tsx` — durable receipts and CUA frame-change evidence |
| Claim-vs-evidence truthfulness | `server/claim-evidence.ts` + `server/claim-feedback.ts` + `server/verify-request.ts` + `src/components/ChatView.tsx` honesty badge — reconcile a reply's claims against its receipts; `unverified`/`partially-verified` caveat, verify-next-time feedback, and a one-shot verify-only pass; ⚠ caveat threaded into `ask_bot` relays and CoS completion reports; token-ceiling guard in `server/index.ts` interrupt path |
| Risk permissions | `server/risk-policy.ts` — low-risk reads and reversible local work can proceed; destructive, external, financial, credential, and unknown actions ask |
| Operator takeover | `server/cua-gate-proxy.ts` + `POST/DELETE /api/bots/:id/takeover` — blocks new bot computer actions until control is released |
| Credential grants | `server/credentials.ts` + `server/credential-proxy.ts` — encrypted vault and per-bot grants; focused-field fill does not return the secret to chat |
| Structured memory | `server/memory-facts.ts` — source, date, validity, confidence, and FTS retrieval for time-aware facts |
| Custom ACP providers | `server/drivers/acp/generic.ts` + `/api/instances` — add or remove a CLI-based ACP instance |
| Health checks | `server/doctor.ts` + `scripts/nexbot.mjs` — `pnpm run doctor` in source or `nexbot doctor` from an installed package |
| Benchmarks | `server/evaluation.ts` + `benchmarks/core.json` + `scripts/nexbot-benchmark.mjs` — repeated live turns scored from jobs and execution receipts |
| Last CoS | `DELETE /api/bots/:id` of the only Luna/Chief of Staff is **409**; `PATCH hidden: true` on that seat is **400**; groups cannot take the CoS name |
| Config / data dir | `server/config.ts` → `~/.nexbot` |
| Windows CLI spawn | `server/cli-spawn.ts` |
| Drivers | `server/drivers/` |
| React shell | `src/App.tsx`, `src/state/store.tsx` |
| Electron main | `electron/main.mjs` |
| Analytics stubs | `src/lib/analytics.ts` |
| Builder | `electron-builder.yml` → `com.lunexinc.nexbot` |
| Windows installer | `pnpm package:win` → `release\NexBot-Setup-*.exe` |
| Android Connect | `connect-android\` → native pairing shell, peer provisioning, and Android VPN consent flow |

| Skills | `server/skills.ts` → `~/.nexbot/skills` |
| Connectors | `src/components/PluginsPanel.tsx` (Composio catalog) |
| Routines | cron, signed webhook (`webhookSecret` required, `x-nexbot-secret`), `POST /api/webhooks/github`, file watch (no `..` in `watchPath`) — `server/routines.ts`. DELETE bot drops its routines. |
| Memory | `~/.nexbot/memory/<id>/profile.md` + `log/YYYY-MM.md`. PUT caps each file at 16KB; prompt clips 8k. |
| Steer token | `server/steer.ts` → `/m.html?token=` |
| Capabilities | `server/capabilities.ts` + `desktop:capabilities` |
| Default model | `server/selection.ts` `pickDefaultSelection` — Grok first, then Codex; Claude only if sole available |
| Hidden bots | Skipped by @mention fanout, `/api/jobs`, `/api/steer/jobs`, `ask_bot`, and group `memberIds`. Phone `/m.html` hides them. User `POST /messages` still runs. Cannot hide the last CoS. |
| Group members | POST create and PATCH require 2–6 existing visible non-group bots (not fake ids). |

## Layout

```
nexbot/
  server/          harness (Node, 127.0.0.1:8799); routes in server/web/
  src/             React UI (Vite :5199)
  electron/        desktop shell (Windows + macOS)
  dist-server/     compiled harness (rebuild with pnpm build:server)
  release/         installers (gitignored)
  docs/            design notes
```

## Out of scope for this map

Code-signed Authenticode certs, Composio/Box account setup (user keys).
