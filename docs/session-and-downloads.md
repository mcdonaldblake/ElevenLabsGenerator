# Session Lifetime and Downloads

## There is nothing to back up in the application

ElevenLabs Generator intentionally has no database, object store, local server data directory, or recovery archive. The active recipe, import rows, statuses, and audio blobs exist only in the open browser tab.

This keeps the tool simple and prevents a long-lived server collection of phrases and generated speech. It also means there is no application restore command.

Provider-side actions are separate: a shared voice explicitly added to the ElevenLabs account remains there until it is removed through ElevenLabs. The application does not maintain or reverse that account history.

## Avoid losing paid results

- Keep the tab open until every wanted clip has been downloaded or shared.
- Do not refresh to fix a row-level error; retry only that row if another paid request is acceptable.
- Keep the phone awake while a chunk is generating. iOS can discard background tabs under memory pressure.
- Prefer smaller source files and download completed chunks when working on a phone.
- Confirm files appear in Files, Downloads, AirDrop, or the destination app before closing the tab.
- Retain the original TXT/CSV/TSV/JSON source outside the app so the queue can be reconstructed.

Downloaded audio and ZIPs are normal files controlled by the browser and operating system. They survive the page, can contain sensitive or licensed material, and must be deleted separately when no longer needed.

## What a ZIP preserves

Each ZIP contains successful audio from one generated chunk, `manifest.csv`, `manifest.json`, and the exact generation-time `recipe.json`. Keep these together when transferring assets to another codebase; the manifests connect sanitized filenames to source text and the recipe fingerprint. Clips made with different recipes are not presented as one recipe.

The app does not remember that a ZIP was created. Reopening the preview shows a blank session and cannot fetch a prior ZIP.

## iPhone behavior

When supported, the page uses the Web Share API so the generated file can be saved to Files, AirDropped, or handed to another compatible app. Otherwise Safari downloads the file normally. Large ZIPs can exceed practical phone memory even when individual speech requests are within limits; generate and download smaller chunks in that case.

Vercel Authentication may expire independently of the open page. If a later API call requires sign-in again, preserve any already downloaded files, authenticate in the same browser, and assume un-downloaded in-memory work could be lost if navigation is required.

## Recovery after tab loss

1. Open the latest protected preview URL.
2. Reauthenticate if prompted.
3. Select the voice and reconstruct the recipe, preferably from a previously downloaded `recipe.json`.
4. Reimport the original source file.
5. Remove rows whose audio was already downloaded.
6. Generate only the missing clips, understanding that the app cannot detect prior provider charges.

There is no exact-request billing ledger or idempotency database. A lost response may have consumed ElevenLabs credits even though no file survived.
