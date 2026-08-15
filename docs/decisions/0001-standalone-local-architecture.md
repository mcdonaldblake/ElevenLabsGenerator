# ADR 0001: Standalone Local Architecture

- Status: Accepted; network-binding details amended by [ADR 0003](0003-opt-in-paired-lan-access.md)
- Date: 2026-08-13

## Context

Voice Foundry produces project-specific prerecorded audio and handles an ElevenLabs API key, high-volume local files, review decisions, and resumable work. It is an internal operator tool, not a user-facing Frase Uno feature.

Putting this workflow inside the production Frase Uno application would mix production and authoring concerns, increase the amount of code and secrets exposed to deployment, and make local file export and long-running job recovery harder. Hosting it on a network would also require authentication, authorization, secret storage, tenant isolation, audit controls, and operational infrastructure that a single-user workstation tool does not need.

## Decision

Build Voice Foundry as an independent pnpm workspace with:

- a React/Vite browser interface
- a Fastify server bound to `127.0.0.1`
- a local SQLite database for metadata and workflow state
- local filesystem storage for generated audio and exports
- a persistent server-side TTS queue
- a provider boundary with mock and ElevenLabs plain-TTS implementations

The tool has no cloud deployment, Supabase dependency, cloud storage, or application-level login. Its security boundary is the local workstation plus loopback binding.

The ElevenLabs API key remains in the server process environment. It is not sent to the browser, stored in SQLite, written into exports, or intentionally included in logs. Imported filenames and provider metadata are untrusted; the server controls all persisted paths.

Exports are immutable handoff artifacts. The tool produces a ZIP with stable paths and metadata, but it never writes into the Frase Uno production repository automatically.

## Consequences

### Benefits

- Authoring failures and unfinished work cannot directly mutate production code.
- SQLite and local audio can survive application restarts without cloud services.
- The API key stays out of browser bundles and production deployment.
- The operator can back up, inspect, and move a complete local workspace.
- Mock mode can exercise the workflow without paid provider traffic.

### Costs and constraints

- The operator is responsible for workstation access, backups, and manual export integration.
- There is no supported internet, multi-user, or collaborative mode. ADR 0003 permits an explicitly enabled, paired iPhone on the same trusted private network.
- Unpaired all-interface binding, using a tunnel, or placing the server behind a reverse proxy invalidates the security assumptions.
- SQLite metadata and generated-audio files must be backed up and restored together.
- A future hosted edition would require a new architecture decision and a real authentication/authorization design.

## Rejected alternatives

### Add the workflow to Frase Uno

Rejected because production application code should not own provider authoring credentials, large generation queues, or local export staging.

### Use a serverless or cloud-hosted application

Rejected because it expands the threat model and operational surface without helping the single-operator workflow.

### Store audio in SQLite

Rejected because large binary blobs complicate database size, streaming, backup inspection, and direct export. SQLite stores metadata and application-controlled paths instead.

## Verification required

Before production use, verify that normal startup listens only on loopback; paired-LAN startup blocks unpaired API access and accepts a valid session; browser traffic never contains the ElevenLabs key; runtime files remain below configured roots; and a stopped-process backup/restore retains review and audio state.
