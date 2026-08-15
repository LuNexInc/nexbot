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

The app includes the official embeddable WireGuard tunnel library. The host
provisioning side still needs to generate a server key, register the Android
peer, select a reachable endpoint, and return a complete configuration. The
app does not enable a tunnel until that configuration and the Android VPN
permission are present.
