# NexBot Connect Android decisions

## Native shell first

The first Android milestone is a native shell with local pairing storage and
the full NexBot web client. This keeps the desktop UI and API contract shared.

## VPN boundary

The app includes the official embeddable WireGuard tunnel library, but it does
not enable a tunnel without a host-issued configuration. The next milestone
must add host key generation, peer provisioning, endpoint selection, and the
Android `VpnService.prepare` permission flow together.
