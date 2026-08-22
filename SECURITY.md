# Security Policy

## Reporting a vulnerability

Do **not** open a public issue for security problems. Email **charles.3ready@gmail.com**
(LuNex / 3Ready) or use GitHub private vulnerability reporting on this repo if enabled.

## Scope notes for researchers

- The harness server binds **127.0.0.1** by default and trusts the local user. Non-loopback
  clients must present the harness token (or the steer token on the phone surface). Anything that
  makes a non-local caller drive `/api` without a token, or lets one local *unprivileged
  other user* drive it, is a vulnerability.
- API keys live encrypted in `~/.nexbot/config.json` and are write-only through the API
  (`configured` booleans out, never values). Any path that echoes a stored secret back — API
  response, SSE event, log line, argv visible in `ps` — is a vulnerability. A plaintext secret
  surviving on disk after a save is a vulnerability.
- Agents run real CLIs (`claude`, `codex`, `grok`) with the user's own privileges, and the permission
  broker is the consent layer for risky actions. Bypasses of the broker (approving without a user
  decision, spoofing the broker socket) are vulnerabilities.
- Spawning must never route user-influenced strings through a shell. Report any `shell: true` /
  `cmd.exe` string-building you find.
- NexBot does not ship third-party product analytics. Adding cloud telemetry without opt-in is a
  product bug.
