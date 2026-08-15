# Remote access on a private network

NexBot can serve the same app to a phone or tablet on the same Wi-Fi. The PC
stays on and keeps the agents, files, and local database. The browser device
only displays the app and sends requests to the PC.

## Source checkout

Open two PowerShell windows in the NexBot folder.

In the first window:

```powershell
$env:NEXBOT_BIND = "0.0.0.0"
pnpm dev:server
```

In the second window:

```powershell
$env:NEXBOT_BIND = "0.0.0.0"
pnpm dev
```

Open NexBot on the PC at `http://127.0.0.1:5199`, then open Settings → General
→ Phone and tablet. Copy a Wi-Fi address and open it on the phone or tablet.
The address includes a local pairing token. NexBot removes the token from the
address bar after the device saves it.

If the installed desktop build runs the server, launch the desktop app with
`NEXBOT_BIND=0.0.0.0` in its environment and restart the app. The packaged
server uses port `8799`. The settings panel shows the correct link for the
current build.

## Safety

Use a trusted private Wi-Fi network. NexBot uses HTTP on the local network and
the link contains a device access token. Use **Rotate access link** after
sharing the link with the wrong device. For access away from home, connect the
phone to the PC through a private VPN. Do not forward NexBot's port from the
router to the public internet.

The PWA shell can be installed from the browser's Add to Home Screen command.
API responses and chat data are not cached by the service worker. The PC must
remain available for the PWA to load and send messages.
