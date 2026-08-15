# Architecture

## Decision summary

ElevenLabs Generator is a single-operator, one-page Next.js application. It accepts human-authored text, proxies narrowly scoped ElevenLabs operations through server-only route handlers, and keeps the working recipe, imported rows, and generated audio in the current browser tab.

It has no SQLite or cloud database, durable queue, server filesystem storage, projects, in-app user accounts, history, translation, or Frase Uno integration. The deployed application is a CLI-created Vercel preview protected by Vercel Authentication. On the chosen Hobby protection model, it is never Git-deployed or promoted to the stable production domain.

## Runtime topology

```text
Authenticated desktop or iPhone browser
    |
    | HTTPS, same origin
    v
Next.js page + Node.js route handlers on a protected Vercel preview
    |
    | server-only ELEVENLABS_API_KEY
    v
ElevenLabs Shared Voice Library, account voices, previews, and TTS

Browser memory only
    +-- current recipe and test clip
    +-- parsed import rows and per-row status
    +-- generated audio blobs
    +-- client-built ZIP and share/download actions
```

Vercel Authentication is the outer access boundary. Route handlers remain responsible for same-origin mutation checks, input validation, provider-response validation, URL allowlisting, response limits, error redaction, and cache prevention. The ElevenLabs key is never sent to the browser.

## Deployment model

The Vercel project is created and linked for manual CLI use, not connected to GitHub for automatic deployments. `vercel.json` sets `git.deploymentEnabled` to `false` as a repository-level safeguard.

Every release is created from a verified checkout with `vercel deploy` and is therefore a Preview deployment. `vercel --prod`, `vercel deploy --prod`, and `vercel promote` are forbidden under this access model. This distinction matters because Vercel treats pushes to a connected production branch—normally `main`—as Production deployments, while Hobby Standard Protection leaves the production domain public.

Only Preview and Development receive `ELEVENLABS_API_KEY`; Production receives no provider credential. Vercel Authentication with Standard Protection must be enabled before the preview URL is used.

## One-page client

The page has four connected sections:

1. **Voice browser** — shared and account voices, explicit search/filter/sort/pagination, one active preview that stops when browse context changes, Copy voice ID, and Add & use.
2. **Recipe and test** — voice ID/name, model, language, output format, seed, stability, similarity, style, speed, speaker boost, and a one-phrase calibration action.
3. **Text and import** — one phrase per nonempty pasted line or browser-parsed TXT/CSV/TSV/JSON, with invalid/duplicate-row review.
4. **Generate and download** — a visible queue, progress, playback, individual retry/download, cancellation of requests not yet started, a client-built ZIP, and iPhone share fallback.

The browser is deliberately the workflow authority. It processes no more than 100 pending rows in one generation chunk and sends no more than two TTS requests concurrently. A refresh, navigation, crash, or closed tab loses all working state and audio. The interface must state that behavior before generation.

## Server interfaces

All route handlers run in the Node.js runtime, are same-origin, return `Cache-Control: private, no-store`, and expose sanitized errors only.

### `GET /api/voices/shared`

Forwards the supported Shared Voice Library search, filter, sort, and pagination inputs. Provider results are normalized but never persisted or ranked by the application.

### `GET /api/voices/account`

Returns normalized voices available to the configured ElevenLabs account.

### `GET /api/voices/shared/preview?url=...`

Streams prerecorded preview media from narrowly allowed official ElevenLabs hosts. The route must reject unsafe protocols, credentials, hosts, redirects, unexpected content types, and oversized media. Range requests are preserved so mobile playback can seek normally. The ElevenLabs API key is not attached to storage-preview requests.

### `POST /api/voices/shared/:publicOwnerId/:voiceId/add`

Performs the explicit add-to-account mutation and returns the resulting account voice ID. The page loads that returned ID and the selected voice's display name into the recipe; it must not assume the public-library ID is synthesizable.

### `POST /api/speech`

Accepts exactly one text value and one complete recipe snapshot. It validates a maximum 5,000-character phrase, identifiers, model, output format, language, seed, and numeric settings, then streams one bounded `audio/*` response. JSON request bodies are capped at 32 KiB. It never writes audio or job metadata to disk.

The streamed response is capped at 12 MiB and includes `X-Content-Type-Options: nosniff`. The handler stops reading and returns a sanitized failure when provider metadata or bytes violate the contract.

## Import and generation data flow

```text
typed lines or local file
    -> browser UTF-8/size/row validation
    -> normalize { id?, filename?, text }
    -> show invalid rows and duplicate keys
    -> add accepted rows to current-tab queue
    -> explicit test or Generate next 100 action
    -> browser scheduler (concurrency 2)
    -> one /api/speech request per phrase
    -> in-memory Blob + playable object URL
```

Import does not trigger provider work. A request that fails before a clear provider result is not retried automatically because the provider may already have charged for it. Successful sibling requests remain playable and downloadable. The operator can explicitly retry a failed row after assessing that risk.

The browser revokes old object URLs whenever a clip is replaced or the page unmounts. Cancel stops work that has not started but allows the current pair to finish, because aborting the browser request cannot guarantee that an already received provider request was not billed.

## Export flow

```text
successful in-tab clips + their generation-time recipe snapshots
    -> sanitize imported IDs/filenames
    -> resolve collisions with deterministic numeric suffixes
    -> audio files + manifest.csv + manifest.json + recipe.json
    -> ZIP assembled in browser
    -> Web Share API when supported, otherwise browser download
```

Imported files and completed ZIPs never pass through a Vercel Function. A downloaded or shared file is the only durable copy the application creates. The operator is responsible for moving it into the destination app and for removing sensitive files from the phone or computer.

Audio entries live under `audio/` in the ZIP; the three manifest files remain at its root. A ZIP is created only when all selected clips share one recipe fingerprint, and `recipe.json` is written from the immutable generation-time snapshot rather than whatever settings are currently visible.

## Trust and security model

### Trusted configuration

- Checked-in application code
- Vercel Authentication and Standard Protection configuration
- `ELEVENLABS_API_KEY` stored as a sensitive Preview/Development environment variable
- The authenticated operator's current browser tab

### Untrusted data

- URL parameters, headers, request bodies, and imported files
- Provider metadata, errors, audio headers, and preview URLs
- User-supplied IDs and filenames
- ZIP entry names and downstream extraction tools

### Required controls

- Vercel Authentication on every preview deployment
- Automatic Git deployments disabled in `vercel.json`; releases created only with non-production `vercel deploy`
- No Production secret and no promotion to the unprotected Hobby production domain
- Server-only credentials with minimum ElevenLabs permissions
- Exact same-origin checks on all mutations
- Strict schemas at client, HTTP, and provider boundaries
- Preview-host allowlist, redirect rejection, Range support, and media-size limits
- TTS input and audio-response limits
- `private, no-store` responses and no secrets in logs or errors
- `X-Content-Type-Options: nosniff` and a 12 MiB speech-response ceiling
- Safe ZIP paths with no absolute paths, traversal, control characters, or silent collisions
- Paid-action labels, double-submit prevention, concurrency two, and no automatic ambiguous retry

Vercel Authentication protects access but does not create in-app users, saved workspaces, or durable sessions. Anyone granted access to the Vercel project may be able to reach the tool and spend ElevenLabs credits through its server-side key; access membership must therefore remain narrow.

## Mock boundary

The mock provider supports deterministic unit, route, and browser verification without credentials or paid requests. It is enabled only by an explicit local/test configuration. A deployed preview must fail clearly when the real key is missing rather than silently generating mock output.

Real-provider smoke testing is never part of normal automation. It requires explicit operator authorization, one short phrase, and confirmation of the chosen voice and settings before the request.

## Non-goals

- Database-backed recovery, cloud object storage, background jobs, project history, or multi-user collaboration
- Frase Uno fields, lesson plans, translation, rewriting, categorization, or downstream-repository mutation
- AI voice recommendations, Voice Design, Voice Remix, cloning, similar-voice search, or speech-to-speech
- Production deployment while the selected Hobby protection excludes the production domain
- Automatic retry, regeneration, audio normalization, or provider-cost optimization

## Related documentation

- [Operator guide](docs/operator-guide.md)
- [Import format](docs/import-format.md)
- [Session lifetime and downloads](docs/session-and-downloads.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)
- [ADR 0001: Standalone protected preview](docs/decisions/0001-standalone-vercel-preview.md)
- [ADR 0002: Human-authored phrases only](docs/decisions/0002-human-authored-phrases-only.md)
- [ADR 0003: Vercel Authentication boundary](docs/decisions/0003-vercel-authentication.md)
