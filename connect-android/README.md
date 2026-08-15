# NexBot Connect for Android

This project builds the native Android companion for NexBot.

## Build

```powershell
cd connect-android
.\gradlew.bat assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Pair

Open the app and paste a NexBot Connect pairing link from the desktop app.
The app saves the host URL and device token in private Android storage, then
opens the full NexBot client in a WebView.

The `nexbot://pair?url=...` deep link is also supported.

## VPN status

The official WireGuard tunnel library is included. The host-side WireGuard
provisioning API is not part of this milestone, so the app does not start a
tunnel yet. A tunnel must never start from an untrusted or incomplete config.
