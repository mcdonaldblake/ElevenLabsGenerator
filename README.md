# Frase Uno Voice Foundry

Frase Uno Voice Foundry is a standalone, local workstation tool for turning a user-written batch of phrases into reviewed audio files that are easy to hardcode into another program.

This adaptation intentionally removes built-in text AI. It does not write, rewrite, score, translate, categorize, or select phrases. The operator supplies the text, and every keep/discard decision remains human. Network features are limited to plain text-to-speech and explicit operator browsing, previewing, and selection from ElevenLabs' public Shared Voice Library. A mock provider is available for exercising the core workflow without an API key or paid requests.

The complete local workflow is implemented and covered by automated tests in mock mode. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the exact verification record and the deliberately unrun real-provider check.

## What the tool is for

1. Import a large UTF-8 CSV, TSV, TXT, or JSON file containing independently authored phrases.
2. Preserve stable phrase IDs and separate display text from optional synthesis text.
3. Choose an existing account voice, or explicitly browse the public Shared Voice Library and add one selected voice to the account, then configure the exact profile.
4. Generate one initial audio take per selected phrase using that profile, or use mock mode while testing the workflow.
5. Review clips rapidly and mark each phrase as kept, discarded, or still pending.
6. Regenerate only the phrases that need another delivery.
7. Download an export ZIP with stable filenames, audio, metadata, checksums, and a TypeScript audio map suitable for copying into another codebase.

The tool does not edit or deploy the Frase Uno application. Export is an explicit handoff: the operator downloads the ZIP, inspects it, and copies the selected assets into the destination program.

## Deliberate limits

- No OpenAI integration, prompt generation, semantic review, or automated phrase selection.
- Public Shared Voice Library browsing is deliberately user-directed: search, filters, pagination, preview, and adding one explicitly selected voice are supported. There is no AI ranking, recommendation, semantic search, Voice Design, Voice Remix, similar-voice search, speech-to-speech, or voice-cloning workflow.
- No Supabase, cloud database, cloud storage, telemetry, deployment, or multi-user collaboration.
- No cloud account, remote hosting, or multi-user access. Normal startup listens only on `127.0.0.1`; an explicit iPhone mode adds short-lived pairing for a trusted private Wi-Fi network.
- No automatic mutation of a downstream repository.

## Requirements

- Node.js 22 or newer
- pnpm 11.19 or a compatible pnpm 11 release
- An ElevenLabs API key for real speech generation or adding a Shared Voice to an account; some ElevenLabs connections also require it for public-library browsing
- A modern local browser
- For iPhone access: a Mac and iPhone on the same trusted, non-isolated Wi-Fi network

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:5173` for the development UI. A production-style `pnpm start` serves the built app at `http://127.0.0.1:4317`.

The checked-in environment example starts in mock mode:

```dotenv
TTS_PROVIDER=mock
```

Mock mode is the safest first run. It should exercise import, queue, review, and export behavior without consuming ElevenLabs credits. Mock audio is a workflow fixture, not production speech.

Profiles, job fingerprints, takes, and exports retain their provider provenance. After switching from mock mode to ElevenLabs, duplicate or create and lock a new profile while ElevenLabs mode is active; mock takes are never reused as paid-provider results. Mock ZIPs carry an explicit warning.

For real text-to-speech, edit the local `.env` file:

```dotenv
ELEVENLABS_API_KEY=your_local_key
TTS_PROVIDER=elevenlabs
```

Never commit `.env`. The server, not the browser, owns the API key.

Shared Voice Library browsing is initiated only when you open or search that picker. Results and provider preview URLs are not written to the local database. When a server-side key is configured, catalog requests use it because ElevenLabs may reject anonymous browsing; without a key, the server still attempts public access and reports clearly if ElevenLabs requires authentication. Preview audio is fetched through the local server from a narrowly approved ElevenLabs storage path and never receives the key. Adding a selected voice and generating speech also use the server-side key; account plan restrictions still apply.

For a production-style local run:

```bash
pnpm start
```

## Use it from an iPhone

Keep the Mac awake and connect the Mac and iPhone to the same trusted home or office Wi-Fi. From the repository root, run:

```bash
pnpm start:iphone
```

The terminal prints one or more private-network URLs and a pairing code. Open a printed URL in Safari on the iPhone, enter the code, and use the normal interface. The code itself is never returned to the browser, and the resulting browser session is kept in an HTTP-only cookie for up to 24 hours. Disconnecting, restarting the server, or reaching that limit requires pairing again.

macOS may ask whether Node can accept incoming connections the first time; choose **Allow**. Use a normal Safari tab. If Private Browsing asks permission to reveal the phone's address to the local server, approve it. If the phone cannot connect, confirm both devices are on the same Wi-Fi, pause any VPN, and check that the Wi-Fi does not isolate clients from each other.

This mode uses ordinary HTTP on the local network. Use it only on a network you trust—never public café, hotel, guest, or school Wi-Fi—and never port-forward, tunnel, reverse-proxy, or expose the printed URL to the internet. Stop the server when finished. Normal `pnpm start` returns to Mac-only loopback access. Disconnecting removes API access but cannot erase ZIPs already downloaded or content retained by Safari; delete sensitive phone downloads and website data separately.

## Day-to-day workflow

Start with [samples/phrases.csv](samples/phrases.csv) or [samples/phrases.txt](samples/phrases.txt), then follow the [operator guide](docs/operator-guide.md). All accepted batch formats are documented in [docs/import-format.md](docs/import-format.md).

For real batches, a cost-conscious sequence is:

1. Import and inspect the phrase count.
2. Configure the exact voice ID, model, output format, language, and delivery settings.
3. Generate a small calibration selection.
4. If it sounds right, create one first-pass take for the remaining phrases.
5. Keep good takes, discard unusable phrases, and regenerate only weak deliveries.
6. Preview export validation, create a new ZIP, and integrate it manually.

## Local data and security

Operational state lives below `data/` by default: SQLite metadata, imported-source records, generated audio, and exports. That directory and `.env` are ignored by Git.

The local workstation remains the security boundary:

- Use ordinary `pnpm start` for Mac-only work; it binds to `127.0.0.1`.
- Use `pnpm start:iphone` only when phone access is needed, and pair from a trusted private network.
- Do not manually bind it to a public interface, port-forward it, reverse-proxy it, or put it through a tunnel.
- Treat exports and backups as sensitive project data.
- Store the ElevenLabs key only in `.env` or the process environment.
- Review logs before sharing them, even though provider errors should be sanitized.

See [backup and restore](docs/backup-and-restore.md) for a conservative copy procedure.

## Repository layout

```text
apps/
  server/          Local Fastify API, persistence, queue, providers, exports
  web/             Local React/Vite operator interface
packages/
  domain/          Stable IDs, normalization, fingerprints, shared domain rules
  schemas/         Request and response validation
  export-format/   Deterministic filenames, CSV, and TypeScript map generation
data/              Local runtime state; ignored by Git
docs/              Operator, import, backup, and architecture notes
samples/           Safe import fixtures
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for data flow and trust boundaries.

## Development checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

Or run the combined check:

```bash
pnpm check
```

Current verification results are recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Recovery and support

If the application is stopped during a batch, do not delete `data/`. Restart the same checkout and inspect the queue before retrying work. Do not manually edit the SQLite database or rename generated audio files; IDs, hashes, and paths are linked.

For a clean test without touching real project state, make a backup and point the environment variables at separate test paths.
