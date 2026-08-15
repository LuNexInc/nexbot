# NexBot Connect Android decisions

## Native shell first

The first Android milestone is a native shell with local pairing storage and
the full NexBot web client. This keeps the desktop UI and API contract shared.

## VPN boundary

The app uses the official embeddable WireGuard tunnel library. The desktop
host owns the server key and peer file; Android generates and keeps the client
private key in app-private storage. The device public key is sent to the
device-scoped host endpoint, then Android uses `VpnService.prepare` before the
library brings the tunnel up.

The tunnel only routes `10.77.0.1/32` so it gives the phone access to NexBot,
not an unrequested full-device VPN. The app switches the WebView to the host
VPN address after connection and returns to the paired address after
disconnect.
