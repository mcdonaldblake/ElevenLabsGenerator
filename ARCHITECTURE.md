# Architecture

## Decision summary

Frase Uno Voice Foundry is a single-user, local-only browser application with a separate local server. It accepts phrases written outside the application, sends pending or kept text to ElevenLabs' ordinary text-to-speech endpoint, supports rapid human review, and creates a stable export for manual integration into another program.

The adapted build has no built-in text AI. No component generates or evaluates language, and there is no OpenAI adapter. ElevenLabs is isolated behind a server-side provider boundary for plain TTS and explicit operator-directed Shared Voice Library browse, preview, filter, and add-to-account actions. Mock generation remains available for offline workflow checks; opening the public library is an explicit remote action.

The default runtime is loopback-only. A deliberately enabled LAN mode supports a single operator reviewing from an iPhone on the same trusted private network; non-loopback clients must establish a short-lived pairing session before any project, audio, export, or provider API is reachable.

## Runtime topology

```text
Mac browser on loopback       Paired iPhone on trusted private Wi-Fi
          |                                  |
          |                          HTTP + session cookie
          +------------------+---------------+
                             v
Fastify server on 127.0.0.1 by default
or 0.0.0.0 only in explicit paired-LAN mode
    |           |              |
    |           |              +--> ElevenLabs TTS + Shared Voice Library APIs
    |           +-----------------> Local generated-audio/export files
    +-----------------------------> Local SQLite database
```

The browser never receives the ElevenLabs key. The server reads it from the process environment and sends it for account actions, text-to-speech, and Shared Voice catalog requests when configured; keyless catalog access is attempted when no key exists because provider behavior varies. Approved storage-preview requests never send the key, and transient catalog results are not persisted. In mock mode, no paid TTS request should be made.

## Components

### `apps/web`

The operator interface owns interaction state, not authoritative production state. Its responsibilities are batch import, deterministic filtering, voice-profile entry/locking, job submission, progress display, audio playback, keep/discard review, targeted regeneration, and export download.

The browser must treat all API responses as untrusted and must not construct filesystem paths or provider requests directly.

### `apps/server`

The local Fastify process is the only trusted application boundary. It validates requests, owns SQLite and filesystem writes, holds provider secrets, runs the persistent queue, streams local audio, and builds exports.

The process binds to `127.0.0.1` unless paired-LAN mode is explicitly enabled. In LAN mode, loopback requests remain trusted for Mac convenience, while every non-loopback API request requires an unguessable in-memory session created with the per-run pairing code. This is a local-device pairing boundary, not a cloud identity or multi-user account system.

### `packages/domain`

Shared domain functions cover behavior that must remain deterministic:

- Unicode-aware Spanish phrase normalization
- accent-insensitive comparison keys used for review assistance
- stable, path-safe phrase identifiers
- SHA-256 hashing
- deterministic TTS job fingerprints
- CSV escaping and word counts

Normalization supports duplicate detection and lookup. It must not silently replace the original display text or the explicitly supplied synthesis text.

### `packages/schemas`

Zod schemas define validated application inputs such as voice settings, TTS batch submission, phrase edits, keep/discard decisions, and export requests. Provider responses require validation at the adapter boundary before they become domain records.

### `packages/export-format`

Export helpers create safe audio filenames and deterministic metadata representations. The TypeScript map uses stable asset IDs rather than Spanish phrase text as object keys or filenames.

## Main data flow

### 1. Import

```text
CSV, TSV, TXT, or JSON bytes
    -> UTF-8, size, and row-count checks
    -> format parser
    -> row validation
    -> source SHA-256 + source row
    -> supplied or source-derived stable phrase ID
    -> original display/synthesis text retained
    -> duplicate/comparison information
    -> SQLite transaction
```

The importer accepts user-authored data only. It performs deterministic parsing and validation; it does not rewrite or complete phrases. Default limits are 25,000,000 bytes and 100,000 parsed rows. A missing ID can be derived consistently from the source hash and row number. A supplied ID is normalized to a safe path segment, and an existing stable ID is skipped on commit for idempotent re-import.

### 2. Voice profile

A profile snapshots the exact TTS recipe: ElevenLabs voice ID, provider model ID, language code, output format, stability, similarity boost, style, speed, and speaker-boost setting. Generated takes reference that versioned recipe so exported audio remains auditable.

The operator can choose an account voice, enter a valid ElevenLabs voice ID explicitly, or browse the public Shared Voice Library. Shared-library search, filters, pagination, and prerecorded previews are deterministic provider metadata; results are not ranked or recommended by AI and are not persisted locally. Adding a selected shared voice is an explicit, authenticated action. Voice Design, remix, cloning, and similar-voice search remain outside the application.

### 3. TTS queue

```text
phrase + profile + seed
    -> deterministic fingerprint
    -> queued job
    -> provider adapter (mock or ElevenLabs)
    -> temporary file
    -> hash and metadata
    -> atomic move into generated-audio storage
    -> persisted audio take
```

The fingerprint includes synthesis text and every material voice setting. A successful identical recipe can be reused rather than submitted and billed again. The queue is persisted so state can be reconciled after restart. Provider concurrency and retry behavior remain server concerns.

### 4. Human review

Each phrase has an explicit review decision:

- `pending`: no final operator decision
- `kept`: a chosen take may be included in export
- `discarded`: omitted from export

The UI is optimized for keyboard and sequential playback, but SQLite is authoritative. A new regeneration creates a new take; it does not overwrite the original response. The operator, not a scoring model, chooses the take.

### 5. Export

```text
kept phrases with selected takes
    -> dry-run validation
    -> stable filenames and paths
    -> copied audio
    -> manifest, phrases CSV, TypeScript map, checksums/profile report
    -> new immutable export directory
    -> ZIP download
```

An export should contain only explicitly kept assets with a selected take. IDs and paths are sanitized, collisions are rejected, and each copied file is hashed. Existing exports are not silently overwritten. Export does not write into the downstream Frase Uno repository.

The generated TypeScript map is meant to make manual hardcoding mechanical:

```ts
export const FRASE_UNO_AUDIO = {
  "correct-continue-001": "/audio/correct-continue/correct-continue-001.mp3",
} as const;
```

## Persistence boundaries

SQLite stores relational metadata and workflow state. Audio is stored as files, never database blobs. Paths in SQLite are application-controlled relative paths, and untrusted filenames are never used directly.

The default runtime tree is expected to resemble:

```text
data/
  voice-foundry.sqlite
  generated-audio/
  exports/
```

SQLite sidecar files such as `voice-foundry.sqlite-wal` and `voice-foundry.sqlite-shm` may exist while the server is running. Backups should be made with the server stopped unless an application-level snapshot mechanism is later implemented.

## Trust and security model

### Trusted

- The person at the local workstation
- The local Fastify process and checked-out application code
- Application-created paths under configured data roots

### Untrusted or external

- Imported CSV, TSV, TXT, or JSON bytes
- Browser request bodies
- Unpaired devices on the local network
- Provider responses and provider-supplied metadata
- ZIP entry names and downstream extraction tools

### Required controls

- Loopback binding by default; all-interface binding only after explicit paired-LAN opt-in
- Private/local Host validation, same-origin mutation checks, and no forwarded-header trust
- Rate-limited pairing and short-lived HTTP-only, SameSite session cookies for non-loopback clients
- Server-side secrets only; no keys in browser payloads or SQLite
- Structured log redaction
- Zod validation at HTTP and provider boundaries
- Safe path segments and fixed storage roots
- Atomic file writes and export creation
- File hashes in export metadata
- Conservative limits on file size, phrase count, characters, and TTS concurrency

The pairing code and sessions exist only in server memory and are reset on restart. They protect a trusted local-network workflow but do not encrypt local HTTP traffic or make internet exposure safe. Public Wi-Fi, router port forwarding, tunnels, and reverse proxies invalidate the security model.

## Failure and restart behavior

- Imported phrases and successful audio takes should survive normal restarts.
- A completed fingerprint should not be regenerated unless the operator explicitly requests a new recipe or forced take.
- Partial provider files should not appear as successful takes.
- Retryable rate-limit and network errors should retain sanitized diagnostics and be retried with bounded backoff.
- Permanent validation errors should stop retrying that job.
- Canceling queued work must not delete successful audio.

These behaviors require integration verification; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Non-goals

- Generating, paraphrasing, translating, or AI-reviewing phrases
- Semantic similarity or automated quality ranking
- AI voice recommendations, similar-voice search, Voice Design, Voice Remix, or cloning
- Speech-to-speech conversion
- Cloud hosting, internet access, durable user accounts, or team workspaces
- Editing a production repository automatically
- Automatic aggressive audio normalization

## Related documentation

- [Operator guide](docs/operator-guide.md)
- [Import format](docs/import-format.md)
- [Backup and restore](docs/backup-and-restore.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)
- [ADR 0001: Standalone local architecture](docs/decisions/0001-standalone-local-architecture.md)
- [ADR 0002: Human-authored phrases only](docs/decisions/0002-human-authored-phrases-only.md)
- [ADR 0003: Opt-in paired LAN access](docs/decisions/0003-opt-in-paired-lan-access.md)
