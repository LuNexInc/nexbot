# NexBot Connect Android

This is the native Android companion for NexBot. It is part of the NexBot
repository and uses the existing Connect pairing API.

## Rules

- Keep device tokens in Android private storage. Do not log or commit them.
- Do not ship a VPN switch until the host provisioning API returns a valid
  WireGuard configuration and the Android permission flow is tested.
- Build with `gradlew.bat assembleDebug` from this folder.
- Keep unrelated NexBot changes untouched.
