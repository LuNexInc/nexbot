# NexBot — DECISIONS

## 2026-08-12 — Product name NexBot under LuNexInc

- **Choice:** Public product name **NexBot**; GitHub **LuNexInc/nexbot**; workspace folder `nexbot\`.
- **Why:** Short LuNex-aligned name; distinct from Basiliskos and Grokulator.
- **Reverse if:** Charles renames the brand line.

## 2026-08-12 — MIT fork of , not clean rewrite

- **Choice:** Start from  v0.1.7 source; rebrand; keep MIT + NOTICE.
- **Why:** Working harness and drivers exist; rewrite would delay a usable LuNex line.
- **Reverse if:** License conflict or architectural dead-end forces rewrite.

## 2026-08-12 — Strip shipped PostHog / vendor email identify

- **Choice:** `src/lib/analytics.ts` is local no-ops; remove `posthog-js` dependency.
- **Why:** LuNex product should not send telemetry to upstream PostHog project; privacy default.
- **Reverse if:** Charles wants opt-in LuNex-owned analytics with a LuNex project key.

## 2026-08-12 — Data dir ~/.nexbot with migration

- **Choice:** Primary data `~/.nexbot`; migrate from `~/.` / `~/.opengrokbot` once.
- **Why:** Clean product identity without stranding early testers of the upstream app.
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
  - Local CUA still macOS-first (cloud Box computers work on Windows)
- **Reverse if:** Named pipes break under a specific Windows SKU; fall back to TCP localhost with a token.
