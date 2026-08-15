# NexBot Connect Android

The Android companion is a native shell for the NexBot client. It accepts a
pairing link from the desktop app, stores the device token in private Android
storage, and opens the full NexBot interface in a WebView.

Build it from the NexBot repository:

```powershell
cd connect-android
.\gradlew.bat assembleDebug
```

The debug APK is written to:

`connect-android\app\build\outputs\apk\debug\app-debug.apk`

The app includes the official embeddable WireGuard tunnel library. In the
desktop app, open Settings > Connect, install WireGuard for Windows, and enter
the host's reachable `name-or-ip:udp-port`. NexBot creates a host key pair and
peer configuration under `~/.nexbot/wireguard` and registers one peer per
paired device. The Android app generates its own private key, requests the
peer configuration, asks Android for `VpnService.prepare` consent, and starts
the tunnel only after consent.

This is a host-access VPN. It routes the NexBot host address (`10.77.0.1`),
not all phone traffic. Off-LAN access also needs a reachable endpoint, router
UDP forwarding, and a firewall rule. The NexBot host must listen on the LAN
interface (`Private LAN mode`) after a restart.

The host WireGuard service needs administrator rights. If WireGuard for
Windows is missing, Connect reports that prerequisite instead of pretending
that the VPN is ready.
