# Computer use (CUA) in NexBot

Local computer control uses **trycua `cua-driver`** only. Cloud bots use Box +
`server/computer-proxy.ts` (loopback computer-server on the VM).

## Local (this PC)

1. Electron main (`electron/cua.mjs`) resolves `cua-driver` / `cua-driver.exe`:
   - `CUA_DRIVER_PATH`
   - packaged `Resources/cua-driver.exe`
   - official install paths (`%LOCALAPPDATA%\Programs\Cua\cua-driver\bin` on Windows)
   - PATH
2. Starts **EmbeddedCuaDriverHost** when possible so permissions attribute to NexBot.
3. Writes `%APPDATA%\NexBot\cua-connection.json` (MCP spawn contract).
4. Harness reads that file each turn and injects MCP server `computer` into agent CLIs.

### Install driver (Windows)

```powershell
# one-liner can fail under some shells; use a file:
irm https://cua.ai/driver/install.ps1 -OutFile $env:TEMP\cua-install.ps1
powershell -File $env:TEMP\cua-install.ps1 -Release latest
# or from the repo:
pnpm cua:install
```

### Package

`scripts/stage-cua-driver.mjs` copies the host binary into `vendor/cua-driver/`
before `electron-builder` so installers can ship it when present.

## Cloud (Box)

Unchanged path: provision box → bootstrap xdotool/CUA python on the VM →
`computer-proxy` MCP tools over Box API.
