# NexBot Connect for Android

This project builds the native Android companion for NexBot.

## Build

```powershell
cd connect-android
.\gradlew.bat assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Pair

In the desktop app, enable **Private LAN mode**, restart NexBot, and choose
**Settings → Connect → Create code**. Enter the six-digit code in the Android
app with the host address, or use **Scan QR code**. The QR payload contains the
host address and short-lived code. The code is exchanged once for a device
token, which the app stores in private Android storage.

Legacy `nexbot://pair?url=...&token=...` links remain supported.

## VPN status

From the desktop app, open Settings > Connect and set up the private VPN.
WireGuard for Windows must be installed on the host. Pair the phone first,
then tap `Connect VPN`; NexBot fetches a device-scoped peer config and Android
shows its VPN consent prompt the first time. The app starts the official
WireGuard tunnel only after consent.

The VPN routes the NexBot host address only. For off-LAN use, set a reachable
endpoint, forward its UDP port to the host, and allow it through the host
firewall. If the host tool or endpoint is missing, the app shows the error and
leaves the tunnel off.
