# Sub8 vs NexBot

Researched 18 August 2026. Sub8 site header reports **v0.3.12** (18 Aug 2026). GitHub tag `v0.3.12` (`9d090ac`) matches `package.json` version `0.3.12`. NexBot in this workspace is **0.3.9** (`package.json`).

No public prices appear on [sub8.grok.me](https://sub8.grok.me) or in [sub8bot/Sub8](https://github.com/sub8bot/Sub8). This note does not invent any.

Sources: Sub8 marketing site, Sub8 `README.md`, `architecture.md`, `package.json`, v0.3.12 release notes, and server modules (`agent.mjs`, `vault.mjs`, `host-cli.mjs`, `isolation.mjs`, `routines.mjs`, `local-llm.mjs`). NexBot: `README.md`, `AGENTS.md`, `MAP.md`, `DECISIONS.md`, plus `server/` and `electron/` as cited.

## What Sub8 is

**Pitch.** Sub8 sells a bot that works like a person, on a machine that is not yours. The site headline is “A bot that works like you do.” Each Sub8 gets a private Linux desktop. You chat. It clicks, types, and browses. The assistant “never sits on your Mac.” It never sees your files, browser, or host machine.

**Product surface.** Chat on the left, a live desktop on the right, a rail of bots with octopus faces. You can take the mouse. The stream is view-only until you grab it. The bot stops. You drive. You hand it back. Standing routines keep jobs (changelogs, inboxes, reports) running without a new prompt every time. A password vault stores logins, grants them per bot, and pastes into the focused field so secrets never show up in chat.

**How you run it.** Install the desktop app (macOS signed and notarized, Windows installer or portable zip, Linux AppImage or tarball). Then give each bot a computer with Docker or Colima. Talk and watch.

**Architecture.** Sub8 (`sub8bot` package) is a thin Electron window over a local Express server. The UI is vanilla JS in `web/`. The server binds `127.0.0.1:8787` (falls back to 8791–8793). Packaged data lives under the app userData folder (`SUB8BOT_DATA` / Application Support/Sub8/data). Persistence is JSON: `bots.json`, `settings.json`, `conversations/<id>.json`, last screenshots, JSONL traces. The repo README: “Local desktop assistants that live on their own Linux computers.”

**Computer model.** Isolation is the product. Each bot boots `linuxserver/webtop:ubuntu-xfce` as `localbot-<prefix>`, XFCE plus noVNC from host port 13100 up. Screenshots are 1024×768. Clicks are pixels on that image. Two tunnels: outside computer-use (screenshot / click / type via xdotool / scrot) and inside `docker exec` shell. `isolation.mjs` rejects host paths (`/Users`, `/Library`, `/Applications`, `/home/dan`). Computer actions require a container name that starts with `localbot-`. Grok Build runs *inside* the bot computer. Host OAuth is copied into the VM (`pushHostGrokAuth`). Claude and Codex run *on the host*, then drive the VM only through an MCP server (`computer`, `shell`, `vault_list`, `vault_fill`). The architecture one-liner: the UI is a client, the Node server is the brain, Docker is the bot’s hands, Grok decides what to do.

**Harnesses (site + `agent.mjs` `HARNESS_PROVIDERS`).** Grok Build (inside the computer), Claude (host CLI), Codex (host CLI), Ollama (local OpenAI-compatible), LM Studio (listed live), SpaceXAI (Grok over `https://api.x.ai/v1`, default `grok-4.6`). v0.3.12 adds current time, date, timezone, locale, and currency on every turn, and a Qwen 3.x chat-template workaround for LM Studio.

**What it is not.** Not a hosted cloud desktop. Not a multi-agent job coordinator with a Chief of Staff. Not a phone/LAN product. Not affiliated with xAI (README). Repo created 16 August 2026. Author field: Daniel Farina. About 14 stars at research time. No license field on the GitHub API.

## What NexBot is

**Pitch.** NexBot is LuNex Inc’s open-source agent messaging shell. `README.md`: “Your own team of AI bots, in a chat app.” Each sidebar contact is a real local agent CLI (`claude`, `codex`, or `grok`) with its own personality, model, optional local computer (this PC), and connected apps. Bring your own agents. No proxy account in the middle. Local first. No shipped analytics.

**Architecture.** Two processes. The React 19 / Vite app talks HTTP plus one SSE stream. The Node harness (`server/index.ts`) owns agent processes and normalizes each provider protocol into one event stream. Bind is `127.0.0.1:8799` by default. Off-loopback bind requires the harness token, or the steer token on the phone surface (`AGENTS.md`, `DECISIONS.md` 2026-08-14). Data lives in `~/.nexbot`: encrypted `config.json` (AES-256-GCM, wrapping key `master.key`, DPAPI on Windows), SQLite WAL + FTS5 transcripts (`store.db`), skills, memory, desk inboxes, routines.

**Computer model.** Stay local. `MAP.md` and `DECISIONS.md` (2026-08-13): computer use is this PC only (trycua `cua-driver` + tray keepalive). No Cloudflare Computer, Huawei ECS, Oracle Always Free, or box.ascii.dev. `server/box.ts` and `/api/bots/:id/computer` still exist but the UI and `startTurn` do not use them. Electron (`electron/cua.mjs`) hosts `cua-driver` so OS permissions attribute to NexBot. Agents run with your user privileges. You approve shell and computer actions deliberately (`README.md` security notes). Default modes are auto-allow (`bypassPermissions` / `fullAuto`).

**Team model.** Seed roster (Forge / Index / Desk, plus Chief of Staff and Research). Equal `ask_bot` / `send_bot` inside a task (four hops, 24-message budget). Last CoS cannot be deleted or hidden. Hidden specialists stay off jobs and mentions. Busy second message is **409** drop, not a queue. Interrupted turns persist as SQLite jobs with Resume / Retry. Groups are 2–6 visible bots.

**Surfaces.** Electron on Windows and macOS (NSIS + portable; Linux package script exists). Browser UI on `:5199`. Phone assign on the LAN at `/m.html` with a hash steer token. Android Connect companion with a host-owned WireGuard tunnel to `10.77.0.1` only. Computer panel, Open in window, `/watch.html`. Tray keeps cron, webhook, and file-watch routines after you close the window. Windows task `NexBot keepalive` starts `--hidden` after reboot.

**Hard product rules.** No shipped third-party analytics. Secrets never committed. LICENSE © 2026 LuNex Inc. Do not put third-party product names in the UI, README, or About. Public target: [LuNexInc/nexbot](https://github.com/LuNexInc/nexbot).

## Head-to-head

### Computer isolation

Sub8 isolates each bot on a disposable Linux XFCE desktop. The host is out of bounds by design. NexBot drives *this* PC through trycua. Isolation is a privilege and path problem (user-level agent, environ deny-list, no `files[].path` copy off this machine), not a VM boundary.

That is the whole product fork. Sub8’s marketing is “never on your Mac.” NexBot’s settled choice is “stay local (no cloud Computer)” after a free-trial scope (`DECISIONS.md` 2026-08-13). Reversing either product means reversing its thesis.

### Agent backends

Sub8 picks a brain per bot against the same Docker computer: Grok Build in-VM, Claude/Codex on the host via MCP, Ollama, LM Studio, SpaceXAI API.

NexBot is a multi-driver harness for installed CLIs. `server/drivers/` includes Claude, Codex, Grok, ACP Grok, Hermes, Antigravity, plus leftover box-agent paths. Default pick is Grok first, then Codex; Claude only if it is the sole available driver (`selection.ts`, `MAP.md`). Composio Connect is the connector catalog. There is no first-class Ollama or LM Studio harness in the same sense as Sub8. NexBot talks to real CLI session protocols (stream-json, resume cursors). Sub8’s Claude/Codex path is a one-shot host spawn that drives MCP tools, then returns text.

### Desktop control

Sub8: screenshot-then-click on a 1024×768 webtop. Live noVNC iframe. Take control sets an in-memory flag (`control.mjs`) that refuses computer tools until you give the desk back. Restarting the server clears that flag. Teach mode posts demonstration frames. Releasing the computer starts a turn again (v0.3.12).

NexBot: CUA MCP on the real desktop. Computer panel and `/watch.html` show this-PC frames. There is no first-class “you have the mouse, the bot waits” control lock like Sub8’s `/control`. Cloud Box CUA remains in code but is unused. Mid-task chat is harsher: a second `POST /messages` while busy is 409. Interrupt replaces the turn. Sub8 turns extra lines into nudges, and treats questions as a side orchestrator reply so work continues.

### Secrets

Sub8 has a real password vault (`vault.mjs`): AES-256-GCM `vault.enc`, wrapping key from `SUB8BOT_VAULT_KEY`, macOS Keychain (`Sub8VaultKey`), or `data/.vault.key`. Groups, accounts, per-bot grants. Tools `vault_list` and `vault_fill` paste into the VM. Chat, shell, clipboard, and type paths redact or block known passwords. The bot is told never to print a secret.

NexBot encrypts *app* secrets (`xai.key`, Composio keys, leftover `box.token`) in `~/.nexbot/config.json`. GET `/api/config` returns configured-or-not booleans only. There is no per-site login vault, no per-bot grant list, and no paste-into-field path for Gmail or X. Agents that need a site password either use a connected app (Composio), type it from context, or ask you. That is the largest capability gap that does not fight stay-local.

### Routines

Both keep standing jobs while the process lives.

Sub8: interval routines on the bot record (`intervalMs`, group keys like `x-inbox` / `email` / `flights`). Natural-language parse (“every hour”, “daily”). Default is one standing brief. Weak chat lines (“check again”) are refused as rewrites. Hidden turns fire from an in-process timer. No webhook or file-watch kinds in `routines.mjs`.

NexBot: cron, signed webhook (`webhookSecret` required, `x-nexbot-secret`), `POST /api/webhooks/github`, and file watch (no `..` in `watchPath`). Tray must stay. Overdue routines replay after reboot. Delete bot drops its routines. Optional `onComplete` fan-out to another bot. Stronger ops surface, less “say a schedule in chat and it becomes the job.”

### Surfaces

Sub8: desktop app plus localhost web. Avatar catalog at `/tool.html`. macOS dictation helper. Auto-update via `electron-updater` to GitHub Releases. No phone, no LAN token, no Android VPN, no group threads.

NexBot: desktop, browser, LAN phone (`/m.html#token=`), Android Connect + WireGuard, `/watch.html`, tray keepalive, finish toasts. Group threads. Skills page. Connectors marketplace. Semantic routing and task-scoped A2A. More surfaces, more team chrome.

### Data locality

Both are local-first. Neither requires a hosted AI database.

Sub8 stores JSON under app userData. Conversations are per-bot JSON arrays. Vault is a separate sealed file. API is localhost-only (`architecture.md` security map). Isolation tests live in `test/tunnels.mjs` and `test/vault.mjs`.

NexBot stores the durable graph in `~/.nexbot` (SQLite + encrypted config + markdown memory). Memory PUT is capped at 16KB per file. Phone and LAN are explicit and token-gated. Wipe password stays out of config APIs. Attachments are base64 only.

Sub8 still calls cloud models (SpaceXAI / xAI) unless you pick Ollama or LM Studio. NexBot still calls whatever the installed CLI is signed into. “Local” means the desk and the transcripts, not the weights.

### Stack

| Layer | Sub8 0.3.12 | NexBot 0.3.9 |
| --- | --- | --- |
| UI | Vanilla `web/app.js`, Three.js octopus | React 19, Vite, light glass, initial discs |
| Server | Express, JS modules | TypeScript harness, Vitest |
| Desktop | Electron 37, `electron-builder` | Electron 43, `electron-builder` |
| Computer | Docker Webtop + noVNC | trycua `cua-driver` on this PC |
| Data | JSON files | SQLite WAL + FTS5 |
| Runtime | Node 20+, npm | Node 24+, pnpm |
| Platforms | macOS (signed/notarized), Windows, Linux | Windows + macOS first; Linux package exists |
| License | None declared on the public repo | MIT © 2026 LuNex Inc |

Same shape: Electron shell, local Node API, SSE, bot rail, routines. Different computer, different language, different team model. NexBot `DECISIONS.md` (2026-08-12) records starting from an MIT desktop harness and stripping the old product name. Sub8’s tree still uses `grok-bot.js`, `prompts/grok-bot-system.txt`, and “legacy OctoBot / Sub8Bot” data migration. Treat them as cousins in the same category, not as the same codebase.

## Steal list for NexBot

Copy only if it does not undo stay-local / this-PC CUA.

### Copy (fits this PC)

1. **Password vault with per-bot grants.** Encrypted store, grant list, `vault_fill` that pastes into the focused field, redaction in chat and shell. This is Sub8’s best idea and it works on a real desktop as well as a VM.
2. **Take control / give back.** A human-is-driving flag that pauses CUA until you return the desk. NexBot’s live panel already shows the screen. The missing piece is exclusive mouse ownership.
3. **Mid-turn questions without 409.** Keep interrupt-to-replace as the default for a new *task*. Allow a short question to get a side reply while CUA continues. Sub8’s nudge vs question split is the UX people expect from a person at a desk.
4. **Refuse weak routine rewrites.** NexBot already has cron, webhooks, and file watch. Steal the “standing brief, not the last chat line” guard so a routine does not collapse into “check again.”
5. **Optional Ollama / LM Studio brains.** Detect local OpenAI-compatible servers. Useful when the installed CLIs are out of quota. Does not require a VM.
6. **Locale clock on every turn.** v0.3.12 injects time, date, timezone, locale, and currency. Cheap, and routines need it.
7. **Secret-aware tool blocks.** If a known vault password appears in `type`, clipboard write, or shell, refuse and tell the model to fill instead.
8. **Packaging polish.** Signed notarized macOS, portable zip, AppImage. NexBot already ships NSIS and portable Windows. The steal is release completeness, not Docker.

### Do not copy (fights stay-local / this-PC CUA)

1. **Per-bot Docker Linux desktops.** That is Sub8’s product. It is the opposite of “CUA on this desktop” (`MAP.md`).
2. **“Never sees your files” as the default security story.** NexBot’s job is this machine: vault wiki, desk inbox, installed CLIs, local files. A webtop cannot see `~/.nexbot` or the workspace on purpose.
3. **Grok Build inside a container with host OAuth copied in.** NexBot already runs `grok` on the host. Copying auth into Docker is a second session store and a stay-local leak path.
4. **Webtop / noVNC as the computer.** NexBot already rejected cloud Box. A local Box-shaped Linux is still not this PC.
5. **Host-path string blocks as the isolation model.** `/Users` denylist is theater on Windows and useless if the agent is supposed to edit the workspace.
6. **Cartoon octopus faces and mood catalog.** `DECISIONS.md` locked construction-N initial discs. Do not reintroduce mascots.
7. **Re-wiring Box / cloud computer** to “match Sub8.” Sub8 is not a cloud VM. Matching it by hosting desktops would reverse the 2026-08-13 stay-local decision.

### Maybe later (only if Charles reverses stay-local)

A *second* always-on Linux box for untrusted browsing and throwaway accounts. Sub8 is a decent existence proof. `DECISIONS.md` already names the reverse condition: you want a second always-on box because this PC sleeps. Until then, keep Box code unused.

## Verdict for Charles

**Complement, and a watch-list competitor. Do not ignore. Do not pivot.**

Same category: a local Electron chat rail of bots that can use a computer and keep routines. Opposite computer thesis. Sub8 is the isolated-Linux-desk cousin. NexBot is the this-PC team shell with real CLI drivers, CoS coordination, phone/LAN, and encrypted app config.

You do not need to out-Sub8 Sub8. A Docker webtop per bot would make NexBot worse at the job you already chose (drive this PC, keep transcripts and keys here, talk to installed `claude` / `codex` / `grok`). Steal the vault, the mouse handoff, and the mid-task chat manners. Leave the octopus and the containers.

Ignore only if you treat Sub8 as a Mac toy. It is not. It ships Windows and Linux, it has a clearer computer demo than NexBot’s CUA panel, and its site is a sharper one-sentence product than “team of AI bots.” People who want a sandboxed browser employee will pick it. People who want a Chief of Staff on this machine, with phone assign and Composio, still need NexBot.

No price war to track. Both are downloadable local apps. Watch `sub8bot/Sub8` releases and the site version chip. Next useful steal, if you want one built, is the vault plus Take control — on this PC, not in Docker.
