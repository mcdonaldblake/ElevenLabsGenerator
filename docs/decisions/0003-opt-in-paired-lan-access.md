# ADR 0003: Opt-In Paired LAN Access

- Status: Accepted
- Date: 2026-08-13
- Amends: [ADR 0001](0001-standalone-local-architecture.md)

## Context

Audio review is faster on a phone, but binding the existing local API to the network without an access check would expose phrase text, generated audio, exports, and ElevenLabs controls to every device that can reach the Mac. A hosted identity system would be disproportionate for a single-operator workstation tool.

## Decision

Keep loopback-only binding as the default. Add an explicit iPhone/LAN startup mode that:

- binds the server to all local interfaces only for that process run
- prints private-network URLs and a per-run pairing code on the Mac
- lets loopback requests continue without pairing
- exposes only static application assets and access-status/pairing endpoints to an unpaired network client
- requires an in-memory, expiring, HTTP-only, SameSite session cookie for every other non-loopback API request
- rate-limits failed pairing attempts and applies private/local Host and same-origin mutation checks
- ignores forwarding headers and never returns or persists the pairing code

The mode is intended only for a Mac and iPhone on the same trusted, non-isolated private Wi-Fi. It is ordinary local HTTP, not an internet authentication or encryption scheme.

## Consequences

The operator can import, review, play audio, generate TTS, and download exports from iPhone Safari while the Mac owns the database, files, and ElevenLabs key. Restarting the server intentionally invalidates phone sessions and generates a new code.

The operator must not use this mode on an untrusted network, enable router port forwarding, expose it through a tunnel or reverse proxy, or treat pairing as a multi-user authorization system. A future remotely hosted edition still requires a separate architecture and full identity, authorization, TLS, tenant isolation, and operations design.

Unpairing revokes future server access but cannot remotely erase a ZIP already downloaded to the phone or browser-cached content. Sensitive phone downloads and website data require separate device-side cleanup.
