# NexBot — DECISIONS

## 2026-08-15 — Android Connect companion uses a native shell

- **Choice:** Build Connect as a native Android app that stores pairing data
  locally and embeds the NexBot client. Include the official WireGuard tunnel
  library, but require a host-issued configuration before activating a tunnel.
- **Why:** The phone needs a real Android VPN permission flow. A browser PWA
  cannot own that flow or safely provision a peer.
- **Reverse if:** Charles chooses a browser-only LAN product and drops remote
  access.

## 2026-08-15 — Connect provisions a host-access WireGuard tunnel

- **Choice:** The desktop host owns the WireGuard server key and peer config in
  `~/.nexbot/wireguard`. Each paired Android device generates its own key pair,
  sends only its public key to a device-scoped endpoint, and must pass
  Android's `VpnService.prepare` consent before connecting.
- **Why:** A mobile browser cannot create a system VPN, and the host must keep
  the client private key off the desktop. The tunnel routes only `10.77.0.1`
  so NexBot is reachable without silently becoming a full-device VPN.
- **Reverse if:** We move to a hosted relay or a browser-only LAN product.

## 2026-08-14 — Interrupted turns are durable and resumable

- **Choice:** Every provider turn gets a SQLite job row. `session.started` checkpoints the provider cursor. A process exit marks running jobs interrupted and shows Resume / Retry actions. Resume uses Claude/Codex native cursors and transcript replay for Grok; ordinary new turns still start without a cursor.
- **Why:** `pending-turns.json` could report a dead turn but could not restore it. The provider drivers already expose the continuation needed for an explicit recovery action.
- **Reverse if:** Charles wants every restart to discard active work again, or wants provider session history disabled even for an interrupted job.

## 2026-08-14 — Encrypt secrets at rest; auth off-loopback

- **Choice:** Secret fields in `~/.nexbot/config.json` (`xai.key`, `composio.key`, `composio.apiKey`, `box.token`) are AES-256-GCM envelopes. The wrapping key is `~/.nexbot/master.key` (DPAPI CurrentUser on Windows when not under test; raw+ACL fallback). Empty string or null on PUT clears a key. Legacy plaintext is migrated on load.
- **Choice:** Non-loopback clients cannot call `/api/*` without a token. Loopback stays trusted. Exemptions: `GET /api/health`, webhooks (own secret), `/api/internal` (per-boot comms token), static files. Phone surface (`POST /api/steer/jobs`, `GET /api/steer/bots`, `GET /api/events`) accepts the steer token. `GET /api/steer` no longer leaks the token off-loopback. Phone link is `/m.html#token=` (hash, not query).
- **Why:** A live Composio key sat in plaintext JSON. Binding `0.0.0.0` for phone/LAN opened bots, messages, computer/exec, and GET /api/steer with no auth.
- **Reverse if:** Charles wants OS-keychain-only (no sibling master.key) or mutual TLS on the harness.


## 2026-08-14 — Task-scoped coordination is equal across bots

- **Choice:** CoS remains the single global coordinator, but every active bot on a peer-agent capable driver can use `ask_bot` and `send_bot` inside its assigned task. Each task carries a delegation path, a four-hop limit, and a 24-message budget. The harness rejects cycles and messages from a bot that does not own the active task path.
- **Why:** A role should define coordination scope and reporting duties. It should not remove planning or delegation tools from specialists.
- **Reverse if:** Charles wants stricter per-role permissions or a different task budget.

## 2026-08-14 — Cannot hide the Chief of Staff

- **Choice:** `PATCH /api/bots/:id` with `hidden: true` on the last CoS is **400** `{ error: "cannot hide the Chief of Staff" }`. Hidden specialists stay off jobs/steer/ask_bot; `POST /messages` to a hidden specialist still runs (sidebar hide ≠ mute). Sidebar disables Hide on CoS so the optimistic client does not strand the seat.
- **Why:** Hidden bots are not teammates. Hiding CoS left the seat occupied (no replacement, DELETE still 409) but unreachable to `/api/jobs` fight-X.
- **Reverse if:** Charles wants CoS hideable and jobs to still reach a hidden CoS.


## 2026-08-14 — Hidden bots stay off the team surface; memory PUT is bounded

- **Choice:** Hidden bots are not teammates: `/api/jobs`, `/api/steer/jobs`, and `ask_bot` skip/404 them; group POST/PATCH `memberIds` must be existing visible non-group bots (same check on create as PATCH). `PUT /api/bots/:id/memory` is **400** above 16KB per file; the turn prompt clips profile and log to 8k. Message attachments are base64 `data` only — a `files[].path` is not copied off this PC. `POST .../computer/exec` uses the environ deny-list.
- **Why:** The sidebar, mention picker, and `list_bots` already hide them; raw HTTP could still job a hidden id, mint a group with fake members, dump a megabyte into the system prompt, or copy `config.json` into a desk inbox.
- **Reverse if:** Charles wants hidden bots to keep taking phone/jobs, or unbounded memory files.


## 2026-08-14 — Last CoS, bot-delete routines, signed webhooks, group CoS names

- **Choice:** `DELETE /api/bots/:id` returns **409** `{ error: "cannot delete the last Chief of Staff" }` for Luna / name / title CoS. Routines for that bot are deleted with it (`deleteRoutinesForBot` + `syncFileWatches`). Webhook routines require `webhookSecret`; unsigned `POST /api/webhooks/github` and hook URLs **401/skip**. File `watchPath` with `..` is **400**. Groups cannot be named/renamed onto the CoS identity (demote to Specialist); `PATCH kind` is **400**. Description-only is not a CoS identity.
- **Why:** One CoS is a delete/create/rename policy, not a prompt. Dead bots must not keep cron/hooks. Localhost webhooks without a secret were fireable by any process.
- **Reverse if:** Charles wants to allow deleting Luna, unsigned GitHub hooks, or CoS-named group threads.


## 2026-08-13 — Busy second message is 409 drop, not queued

- **Choice:** `POST /api/bots/:id/messages` while the bot is busy returns **409** `{ error: "the bot is already working — interrupt it first" }`. The client should interrupt first. The second message is dropped, not queued.
- **Why:** `startTurn` is explicit interrupt-to-replace (one in-flight turn per bot). Composer already locks while busy; Stop calls `POST /interrupt`.
- **Reverse if:** Charles wants a queue of pending user messages behind a running turn.

## 2026-08-13 — Per-bot memory, team seeds, A2A bubbles, event routines, Connectors

- **Choice:** Memory is `~/.nexbot/memory/<id>/profile.md` plus `log/YYYY-MM.md` (migrate old `<id>.md`). Seed Chief of Staff and Research without wiping existing bots (Forge/Index/Desk still first-run only). Agent-to-agent ask_bot shows real chat bubbles with a teammate nameplate in the main thread. Routines gain webhook + file-watch triggers beside cron. Connectors page is the plugins marketplace (light frost).
- **Why:** CoS asked for the competitor-gap follow-up.
- **Reverse if:** Charles wants a single memory file again, or cron-only routines.


## 2026-08-13 — No third-party product name in the app

- **Choice:** Strip the old product name from UI, README, About, CONTRIBUTING, AGENTS, runtime migration, and `docs/research`. LICENSE copyright is **© 2026 LuNex Inc** only.
- **Why:** Charles: remove all traces; copyright is LuNex Inc.
- **Reverse if:** Charles later asks to restore a second copyright line.

## 2026-08-13 — Slices 1–8 (no agy)

- **Choice:** Ship onboarding/role seeds, turn watchdog + usage chip, group threads, save-last-turn skills, local skills page, signed /m.html steer, DesktopCapabilities, paste images + idle-frame filter. Skip Google Antigravity `agy`.
- **Why:** Charles: build all except 9.
- **Reverse if:** He wants approvals back on steer, or LAN bind by default.

## 2026-08-13 — Light glass chrome

- **Choice:** Light frost (paper `#E8EAEE`, white glass, graphite ink). Dark glass dropped.
- **Why:** Charles: no dark glass; make light glass.
- **Reverse if:** He wants dark mode later as a toggle.

## 2026-08-13 — Stay local (no cloud Computer)

- **Choice:** Computer use stays on this PC (CUA + keepalive). Do not wire Cloudflare Computer, Huawei ECS, Oracle Always Free, or box.ascii.dev.
- **Why:** Charles, after a free-trial scope: stay local.
- **Reverse if:** He later wants a second always-on box because this PC sleeps.

## 2026-08-13 — Competitor slice (routines, tray, memory, desk, team)

- **Choice:** Ship routines (in-process, tray must stay), optional per-bot memory, `~/.nexbot/desk/<id>`, parallel @mention / `/api/jobs`, file inbox, roster search, finish toasts, `/m.html` phone assign, engine-down chip.
- **Why:** Charles asked to build the Grok Bot gap list without a cloud VM.
- **Reverse if:** Tray-stay-alive is wrong; then restore quit-on-close.

## 2026-08-13 — Auto-allow, no model history, pop-out screen

- **Choice:** Default Claude `bypassPermissions`, Codex/ACP `fullAuto`. Permission cards auto-allow. Ordinary turns send no resume cursor; explicit recovery may resume one interrupted job. Live this-PC frames POST to `/preview` and `/watch.html` (app window or browser).
- **Why:** Charles asked to drop history pings, stop Allow/Deny, and surface work in a browser/app.
- **Reverse if:** He wants approvals back (`permissionMode: acceptEdits` / `fullAuto: false` in instance config).

## 2026-08-13 — Grok Bot parity minus cloud computer

- **Choice:** Keep BYO CLIs, Composio, local CUA, roster, keys. Drop **cloud Box** from product surface and turn dispatch.
- **Why:** Charles: same capabilities as Grok Bot, minus Cloud Computer.
- **Keep:** `server/box.ts` and `/api/bots/:id/computer` routes exist but are unused by the UI and `startTurn`.
- **Reverse if:** Charles wants a hosted desktop again.

## 2026-08-13 — Glass chrome + construction N (no mascot)

- **Choice:** Apple-glass / Emil materials; construction 4-node N as the mark; bot avatars are initial discs, not cartoon faces. Seed desk is Forge / Index / Desk.
- **Why:** Charles rejected workshop/origami and the generic silver letter. Glass + draftsman N is the locked look.
- **Reverse if:** Charles wants faces back or a different mark.

## 2026-08-12 — Product name NexBot under LuNexInc

- **Choice:** Public product name **NexBot**; GitHub **LuNexInc/nexbot**; workspace folder `nexbot\`.
- **Why:** Short LuNex-aligned name; distinct from Basiliskos and Grokulator.
- **Reverse if:** Charles renames the brand line.

## 2026-08-12 — MIT baseline, not clean rewrite

- **Choice:** Start from an MIT desktop harness; rebrand as NexBot.
- **Why:** Working harness and drivers exist; rewrite would delay a usable LuNex line.
- **Reverse if:** License conflict or architectural dead-end forces rewrite.

## 2026-08-12 — Strip shipped PostHog / vendor email identify

- **Choice:** `src/lib/analytics.ts` is local no-ops; remove `posthog-js` dependency.
- **Why:** LuNex product should not send telemetry to upstream PostHog project; privacy default.
- **Reverse if:** Charles wants opt-in LuNex-owned analytics with a LuNex project key.

## 2026-08-12 — Data dir ~/.nexbot with migration

- **Choice:** Primary data `~/.nexbot` only. No migration from other product folders.
- **Why:** Clean product identity.
- **Reverse if:** Migration causes collisions on dual-install machines (then copy, don't rename).

## 2026-08-12 — Milestone 1 stops at scaffold + public empty/seeded repo

- **Choice:** No Windows Electron port and no signed releases in M1.
- **Why:** Long task; ship identity + source tree first.
- **Next milestones (not approved until asked):** Windows harness verify; desktop shell; publish-targets; installer.
- **Superseded by:** 2026-08-12 Windows end-to-end port (below).

## 2026-08-12 — Windows end-to-end port (0.3.0)

- **Choice:** Full Windows support for harness, Electron shell, NSIS + portable packages.
- **How:**
  - `server/cli-spawn.ts` resolves `claude.cmd` / kills process trees via `taskkill /T`
  - Permission broker uses named pipes on Windows (`\\.\pipe\nexbot-perm-*`)
  - Electron title-bar overlay, single-instance, ms-settings privacy links
  - Dictation: Web Speech API on Windows; Swift helper remains macOS
  - Local CUA via trycua (see later decision)
- **Reverse if:** Named pipes break under a specific Windows SKU; fall back to TCP localhost with a token.

## 2026-08-12 — Identity cleanup → NexBot

- **Choice:** Product-facing identifiers: `window.nexbot`, `NexAvatar`, `NEX_*` tokens, CSS `nex-*`, MCP `mcp__nexbot`, box paths `/opt/nexbot` only.
- **Keep:** MIT copyright in `LICENSE`.
- **Dropped:** old dual-path data dirs, other-product userData names.
- **Reverse if:** none.

## 2026-08-12 — Local CUA via official cua-driver

- **Choice:** Electron resolves/embeds trycua `cua-driver` on Windows/macOS/Linux; package stages host binary; App Settings shows CUA mode.
- **Install (Windows):** `install.ps1 -Release latest` (pipe-to-iex can fail under constrained shells).
- **Reverse if:** trycua changes install layout; update `electron/cua.mjs` candidates.
