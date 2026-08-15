# NexBot Connect Android map

Last verified: 2026-08-15

- `app/src/main/java/com/lunexinc/nexbotconnect/MainActivity.java`: pairing UI and NexBot WebView shell.
- `app/src/main/java/com/lunexinc/nexbotconnect/PairingLink.java`: pairing URL validation and token extraction.
- `app/src/main/java/com/lunexinc/nexbotconnect/WireGuardTunnelController.java`: adapter for the embedded WireGuard tunnel library.
- `app/src/main/AndroidManifest.xml`: launcher and `nexbot://pair` deep link.
- `app/build.gradle`: Android and WireGuard dependencies.
