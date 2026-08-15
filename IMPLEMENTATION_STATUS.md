# Implementation Status

Last updated: 2026-08-14

## Current checkpoint

The adapted, non-text-AI Frase Uno Voice Foundry is implemented as a standalone local application: user-authored batch import, plain server-side ElevenLabs TTS, explicit operator-directed Shared Voice Library browse/preview/add, credit-free mock generation mode, rapid human keep/discard review, persistent generation, and stable hardcode-ready ZIP export.

No OpenAI integration, phrase-generation AI, semantic scoring, automated voice recommendation, voice design/remix/cloning, similar-voice search, speech-to-speech, cloud database, deployment, or automatic downstream-repository mutation is included.

## Verification record

The full source gate passed on macOS/Apple Silicon with Node 22-compatible tooling and pnpm 11 on 2026-08-14. The workspace compilers, Vitest runner, Vite, and tsup were invoked directly from the installed lockfile dependencies. Recorded result:

- all five TypeScript workspace projects passed typechecking
- 10 Vitest files passed, 50 tests total
- the React/Vite production build passed (343.31 kB JavaScript, 59.85 kB CSS before gzip)
- the bundled Fastify production server build passed (167.58 kB) and contains its workspace packages
- the generated `audio-map.ts` fixture passed a standalone TypeScript 7 compile

The API workflow tests exercise a real temporary SQLite database and filesystem through Fastify injection. They cover project creation, multipart import (including file-first ordering), locked profiles, calibration enforcement, playable mock WAV plus byte ranges, keep/discard review, exact-recipe reuse, stale-text invalidation, restart/list recovery data, export creation, and export idempotency. Provider unit tests cover response validation, PCM handling, usage accounting, retry metadata, redacted errors, Shared Voice normalization/filtering, optional server-side browse authentication, key-required account mutation, preview range behavior, redirect rejection, URL allowlisting, and size limits.

The packaged server was also started successfully on `127.0.0.1:4317` against isolated temporary paths. Browser verification covered the empty first-project state, project creation, an 8-row CSV preview/commit, playable mock audio, keyboard keep/discard with automatic advance, and clean console output. The API then completed calibration, confirmed the first-pass gate and exact-result reuse, created a mock-labeled ZIP, verified its SHA-256 inventory, compiled its generated TypeScript map, repeated the identical export without overwrite, restarted the server, and confirmed projects, decisions, jobs, and exports persisted.

The final paired-LAN build was then exercised through the Mac's real private IPv4 address with a 390 × 844 phone viewport and isolated temporary state. A bad pairing code was rejected; the terminal-only per-run code paired successfully; the phone view created a project, uploaded and committed the 8-row sample, created and locked a mock profile, generated eight playable clips, saved one keep and one discard, created a one-asset hardcode-ready ZIP, and streamed its download after an access recheck. Restarting the server invalidated the old session while preserving the project and export, **Disconnect this iPhone** revoked access, and an audio request made after a later restart received 401 and automatically returned the UI to the pairing gate. The browser console had no errors. All temporary phone-verification data was removed afterward.

The Shared Voice Library was separately verified in the built application at 390 × 844. An isolated populated provider fixture rendered the browse/account tabs, filters, sort, cost/plan flags, and voice card; its preview played through the range-capable local proxy, language filtering produced and recovered from an empty state, account selection filled the voice ID/name and auto-derived profile label, the page had no horizontal overflow, and the browser console stayed clean. A real credential-free catalog attempt from this Mac returned 401, so the live UI's clear connection guidance was also verified; configured-key browse behavior remains contract-tested without exposing the key or making a paid request.

The focused LAN suite covers default versus opt-in binding, forged forwarding and Host headers, exact same-origin mutations, private-source enforcement, protected health/audio/export routes, 24-hour IP-bound sessions, unpairing, expiry, cookie flags, pairing throttles, and general LAN API throttling. An independent security audit found no authentication bypass.

A generated 10,000-row CSV also previewed and committed successfully (the server logged about 162 ms for preview and 283 ms for commit). Page 20 of 20 returned 500 phrases, stable-ID search found row 9,999, and an identical re-import preview correctly reported 10,000 collisions and zero importable rows.

The Mac initially had only about 117 MB free and SQLite reported `SQLITE_FULL`. Cleanup restored roughly 7 GiB of internal free space, and generated audio/export roots were moved to the external Extreme SSD, which had roughly 268 GiB free at the final check. Continue monitoring both volumes before a large real generation run because SQLite metadata remains on the Mac unless configured otherwise.

## Deliverables

| Area | Status | Verification note |
| --- | --- | --- |
| pnpm workspace and TypeScript packages | Verified | Typecheck and production builds passed |
| Stable IDs, normalization, hashing, and provider-specific recipe fingerprints | Verified | Unit/API regressions cover deterministic identity and cache safety |
| Local Fastify server and paired-LAN boundary | Verified | Loopback is the default; explicit LAN mode bound the real private interface, blocked unpaired APIs, and rejected forged/missing Origin and invalid Host requests |
| iPhone pairing and responsive workflow | Verified | Phone viewport completed pair, import, mock generation, audio review, export/download, restart expiry, and disconnect |
| SQLite schema and migrations | Verified | Temporary-database workflows and recovery/list tests passed |
| CSV, TSV, TXT, and JSON batch import | Verified | Parser/API tests, validation, idempotency, and multipart ordering passed |
| Shared Voice Library browser | Verified with provider fixture; live auth path contract-tested | Search/filter/sort/pagination, single preview player, add/select flow, iPhone layout, and credential isolation covered |
| Versioned, locked voice profiles | Verified in mock mode | Manual voice ID, account-voice selection, and shared-to-account selection supported |
| ElevenLabs plain TTS adapter | Contract-tested | No paid request was sent |
| Mock TTS provider | Verified | Deterministic playable WAV, no credential or paid request |
| Persistent queue, retries, cancellation, and exact-result reuse | Verified | Regression tests include recovery, circuit breaker, and duplicate guards |
| Rapid audio review and targeted regeneration | Verified | Browser playback and `K`/`X` shortcuts persisted and advanced correctly; API regeneration tests passed |
| ZIP export, checksums, CSV, manifest, profile, and TypeScript map | Verified | End-to-end export and repeated-export tests passed |
| Operator, import, architecture, paired-LAN, and recovery docs | Present | Aligned with the implemented workflow and trusted-Wi-Fi limits |
| CSV/TXT fixtures and large-sample generator | Verified | Sample browser import and generated 10,000-row API import passed |

## Deliberately unrun

No authenticated ElevenLabs account mutation or paid TTS generation was run because the user did not provide a key or authorize spending provider credits. Before a large paid batch:

1. Free adequate disk space for SQLite, audio, and ZIP exports.
2. Keep `TTS_PROVIDER=mock` for a local practice pass.
3. Set `TTS_PROVIDER=elevenlabs` and the key only in `.env`.
4. Run one short, explicitly reviewed phrase.
5. Confirm voice, format, character usage, logs, and export provenance.
6. Only then start calibrated chunks of the large batch.

Real-provider smoke tests are intentionally excluded from automated tests and normal CI.
