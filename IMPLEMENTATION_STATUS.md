# Implementation Status

Last updated: 2026-08-15

## Current checkpoint

The standalone ElevenLabs Generator described in [ARCHITECTURE.md](ARCHITECTURE.md) is implemented as a one-page Next.js application with browser-only working state and narrowly scoped ElevenLabs route handlers.

The rewrite removes the former Fastify, SQLite, local-filesystem, persistent queue, project/review, LAN-pairing, Frase Uno, translation, and hardcoded TypeScript-map architecture. Old verification results for that retired implementation are intentionally not treated as evidence for this version.

The local source gate passed on 2026-08-15:

- ESLint passed with no errors or warnings.
- TypeScript passed with `tsc --noEmit`.
- Eleven Vitest files passed, 54 tests total, using mocked browser/provider boundaries only.
- Next.js 16.3.1 completed an optimized production build with the static one-page UI and all five dynamic API routes.

Local mock-only browser verification passed at desktop, 390 px, and 430 px widths. It covered the complete one-page layout, Shared Library preview, Add & use, recipe test generation, batch generation, individual audio download, ZIP download, and ZIP contents without contacting ElevenLabs or spending credits.

## Required deliverables

| Area | Required behavior | Verification state |
| --- | --- | --- |
| Responsive one-page workflow | Browse, recipe/test, paste/import, generate, play, retry, download | Implemented; desktop/390/430 mock browser verification passes; physical iPhone check pending |
| Shared/account voice browser | Filters, pagination, preview, Copy ID, explicit Add & use | Implemented; preview and Add & use pass browser verification; stale-preview and returned-account-ID tests pass |
| Stateless ElevenLabs API | Server-only key, strict validation, no persistence, sanitized errors | Implemented; route and provider contract tests pass |
| Ephemeral batch scheduler | 100-row chunks, concurrency two, cancellation, no automatic retry | Implemented; concurrency, cancellation, and double-submit tests pass |
| Client export | Individual files, ZIP, CSV/JSON/recipe manifests, iPhone share fallback | Individual and ZIP downloads pass mock browser verification; manifest, recipe, naming, collision, and mixed-recipe tests pass |
| Security | Vercel Authentication, same-origin mutations, preview URL allowlist, no-store | Application controls pass; Vercel project and Authentication are configured; deployed-preview check pending |
| Mock provider | Automated tests and local checks make no paid requests | Implemented; all automated tests were non-paid |
| Protected Vercel preview | Git deployment disabled; CLI Preview/Development secret only; no production promotion | Project created and Authentication enabled; environment secret and preview deployment not yet created |

## Automated coverage

The passing suite covers:

- TXT, CSV, TSV, and JSON parsing, duplicate handling, empty rows, quoted fields, aliases, and file/row limits
- filename sanitization, collisions, client ZIP contents, exact recipe snapshots, and mixed-recipe rejection
- provider voice/filter normalization, explicit add, approved speech payloads, and server-only authentication headers
- preview URL/redirect rejection, valid and invalid Range handling, and audio-size limits
- exact same-origin paid mutations, strict route schemas, private/no-sniff audio, and sanitized provider failures
- concurrency two, stop-before-next behavior, deterministic recipe snapshots, and rapid-click paid-request guards
- stale preview-attempt isolation and use of the account voice ID returned by Add & use

## Remaining deployment checks

Before deployment, add the restricted `ELEVENLABS_API_KEY` to Preview and Development only, then rerun `pnpm check`. Confirm `vercel.json` still disables Git deployments, create the release only with `vercel deploy`, and verify the result is a Preview—not Production—deployment. Confirm Vercel Authentication blocks an unauthenticated page and API request, then sign in from the intended physical iPhone and verify the native share sheet and downloaded ZIP opening in Files.

Deployed previews never enable the local-only mock provider. Do not send a live TTS request without explicit authorization, and do not promote the deployment to production under the current Hobby protection model.

## Deliberately unrun

No real ElevenLabs account mutation or text-to-speech request is part of automated validation. Once the protected preview is verified, an explicitly approved smoke test may use one short phrase. Confirm the voice, complete recipe, character count, output format, downloaded audio, and sanitized logs before authorizing a larger paid chunk.
