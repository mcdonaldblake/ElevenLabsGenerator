# Operator Guide

## Purpose

Use Frase Uno Voice Foundry to convert a batch of phrases you wrote elsewhere into individually reviewable TTS clips, then download only the audio you want to hardcode into another program.

There is no built-in phrase AI. The application does not invent text or decide what is good. ElevenLabs is used for ordinary text-to-speech and explicit operator-directed Shared Voice Library browsing; the operator makes every voice and keep/discard selection.

The labels and workflow below match the implemented local application. Mock mode is the verified, credit-free acceptance path; run one explicitly authorized phrase before trusting a real ElevenLabs profile for a large batch.

## Application map

The intended navigation is organized around one production path:

| Page | Use it for |
| --- | --- |
| Overview | Project totals, recent imports, active production, and next actions |
| Import phrases | CSV, TSV, TXT, or JSON parsing preview and confirmation |
| Phrase library | Search, edit, filter, select, and bulk keep/discard/reset |
| Voice profile | Browse and preview Shared Voice Library options, choose an account voice or enter a voice ID, then save and lock a versioned recipe |
| Production | Preflight, calibration, first-pass generation, queue progress, cancel, and retry |
| Audio review | Sequential playback, keep/discard, targeted regeneration, and take selection |
| Exports | Dry-run validation, create a snapshot, and download its ZIP |
| Settings | Local health, provider connection, usage, safety limits, and concurrency |

The Voice profile page has two operator-controlled sources: **Browse library** searches ElevenLabs' public Shared Voice Library and plays its prerecorded samples, while **My voices** lists voices already available to the connected account. Browsing and previewing do not generate speech or spend TTS characters. ElevenLabs may require the server-side API key even for catalog browsing; the app will show connection guidance if anonymous access is rejected. Adding a selected shared voice always requires the key and an ElevenLabs plan that permits Library API use. Voice Design, Voice Remix, cloning, similar-voice search, and AI recommendations are not included.

## 1. Start safely in mock mode

From the repository root:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:5173` while the development processes are running. A built `pnpm start` run uses `http://127.0.0.1:4317`.

Confirm `.env` contains:

```dotenv
TTS_PROVIDER=mock
```

Use mock mode for your first import/review/export pass. It should not require an ElevenLabs key or consume credits. Mock audio is only a workflow aid.

Normal startup is intended for the same computer only. It must show `127.0.0.1` unless you deliberately started the paired iPhone mode described below.

### Optional: review from an iPhone

Keep both devices on the same trusted, non-isolated Wi-Fi network and run the built application with:

```bash
pnpm start:iphone
```

Open one of the private-network URLs printed in the terminal in iPhone Safari, then enter the pairing code shown only on the Mac. Pairing creates an HTTP-only browser session for up to 24 hours; disconnecting or restarting the server invalidates it sooner. The Mac can continue using its loopback URL without pairing.

Allow the macOS firewall prompt for Node if one appears. Do not use this mode on public or guest Wi-Fi, do not share the URL or pairing code, and do not add router port forwarding, a public tunnel, or a reverse proxy. Stop the process when phone work is finished; the ordinary `pnpm start` command remains Mac-only. **Disconnect this iPhone** removes its server session but cannot erase ZIPs already downloaded or content retained by Safari; remove sensitive downloads and website data on the phone separately.

## 2. Prepare a phrase batch

Choose one of the supported UTF-8 formats:

- CSV or TSV when you want stable IDs, separate synthesis text, groups, categories, or notes.
- JSON when the source is already an array of strings or structured records.
- TXT when each non-empty line is simply one phrase.

Save the file as UTF-8. Start from [the CSV sample](../samples/phrases.csv) or [the TXT sample](../samples/phrases.txt). The exact fields are documented in [import-format.md](import-format.md).

For production batches:

- Give each phrase a stable, human-readable ID when practical.
- Keep display text exactly as it should appear in your application.
- Use `synthesis_text` only when ElevenLabs needs a pronunciation-specific variant.
- Split unrelated phrase families into meaningful groups.
- Keep a copy of the original source file outside `data/`.

## 3. Import and inspect

Open **Import phrases**, select the CSV, TSV, TXT, or JSON file, and review the summary and preview table before choosing **Import phrases**.

Check at least:

- recognized row count
- rejected rows and their line numbers
- duplicate IDs
- exact-text or comparison warnings
- display text versus synthesis text
- group and category values

The full accepted upload defaults to at most 25,000,000 bytes and 100,000 rows. The preview table returns at most the first 100 rows even though its summary counts cover the whole file. A second, explicit import action commits the valid rows; merely previewing a file does not persist it.

Import validation is deterministic. A warning is not an instruction to delete a phrase; it is a prompt for human review. The application should not rewrite the imported text.

For a very large source, import it once and use a calibration before the full TTS run. Imported phrases begin **Pending**, and both pending and kept phrases are eligible for calibration and first-pass generation. This lets you make one clip for every uploaded phrase and use audio review to decide what to keep or discard; you do not have to pre-approve text just to hear it.

Discarded phrases are excluded from later batch generation. If you discard one by mistake, reset it to **Pending** before requesting another take.

## 4. Configure the voice recipe

Open **Voice profile** and enter a versioned recipe with the exact values you want to preserve:

- label
- ElevenLabs voice ID
- model ID
- language code, normally `es` or the supported value you have selected
- output format
- stability
- similarity boost
- style
- speed
- speaker boost on or off

Use **Browse library** to search/filter public voices and play their official samples. When you find one, **Add & choose** copies it into the connected ElevenLabs account and fills the recipe's voice ID; this action needs the API key and a compatible account plan. You can instead use **My voices** or enter an exact voice ID manually. The application does not design, remix, clone, similarity-search, or recommend voices. Verify current model/setting and rate support in ElevenLabs before spending credits.

Choose **Save draft**, inspect the result, and then **Lock** the exact version intended for production. TTS batches require a locked profile. Changing a recipe should create or select a distinct profile version; existing audio remains tied to the recipe that produced it.

## 5. Calibrate before a large run

Select a small, representative set of phrases. Include short and long lines, punctuation, pronunciation-sensitive words, and the emotional range you actually need.

Before submitting, inspect:

- number of TTS requests
- total characters
- selected profile and output format
- whether the provider is `mock` or `elevenlabs`

Generate one take per calibration phrase. Listen on the same kind of device and at a realistic volume. If the voice or delivery settings are wrong, revise the profile before creating the large batch.

## 6. Generate the first pass

After calibration, create one first-pass take for every pending or kept phrase. Exact successful calibration takes are reused, so the same recipe should not be billed twice. Explicitly confirm the request.

While the queue runs:

- Leave the application data directory in place.
- Do not rename or edit generated files manually.
- Watch failed and retrying counts.
- Stop the batch if repeated failures suggest the voice ID, model, or account settings are wrong.
- Avoid opening a second server process against the same SQLite file.

A completed recipe fingerprint should be reusable. Repeating an identical request should not silently create a paid duplicate; verify this behavior before using a large real batch.

## 7. Review quickly

Use the audio review page as a sequential inbox. Each phrase should show its display text, available takes, decision, and progress.

The intended fast-review controls are:

| Key | Action |
| --- | --- |
| `Space` | Play or pause the current take |
| `K` | Keep the current phrase/take |
| `X` | Discard the current phrase |
| `R` | Request another take for this phrase |
| `J` or `Right Arrow` | Move to the next phrase |
| `Left Arrow` | Move to the previous phrase |
| `U` | Undo the most recent review decision when available |
| `L` | Loop the current take |

Keyboard decisions are saved immediately. Always confirm the visible decision and selected take before moving on.

Decision meanings:

- **Pending**: no final choice; do not export.
- **Kept**: include the selected take in a validated export.
- **Discarded**: omit the phrase and all its takes from export.

When a phrase is good but its delivery is weak, regenerate only that phrase. A new take should be additive; do not destroy the original. When the phrase text itself is wrong, edit it deliberately and expect a new fingerprint and new audio.

Useful review filters include pending, kept, discarded, failed, and needs another take. Finish all pending decisions before treating an export as final.

## 8. Create an export

Open Exports and preview validation before creating files. Resolve any error involving:

- a kept phrase with no selected take
- a missing or unreadable audio file
- duplicate asset IDs or output paths
- an unsafe filename
- a checksum mismatch
- a take that belongs to a different voice-profile version than intended

Create a new export rather than overwriting an earlier one. Download the resulting ZIP and keep it as an immutable handoff artifact.

A hardcode-ready export is expected to include audio plus machine-readable metadata such as:

```text
audio/
manifest.json
audio-map.ts
phrases.csv
voice-profile.json
export-report.json
checksums.sha256
README.md
```

The export validator checks these contents, their safe paths, their source audio hashes, and the selected production profile before creating the ZIP.

## 9. Integrate manually

Unzip into a temporary staging folder. Do not extract directly over your destination application.

1. Read the export report and confirm the phrase count and voice profile.
2. Verify a few checksums or run the provided verification instructions if present.
3. Listen to the staged files again.
4. Copy the `audio/` tree into your program's static assets.
5. Copy or adapt `audio-map.ts` into your source tree.
6. Update the leading public path if your framework serves assets from a different location.
7. Build and test the destination program.
8. Commit the audio and mapping together so code never points at missing files.

Stable IDs, not phrase text, are the integration contract. Changing wording should create a deliberate new asset or recipe rather than silently replacing an unrelated ID.

## 10. Switch to ElevenLabs mode

Only after the mock acceptance pass works, place the key in `.env` and set:

```dotenv
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_local_key
```

Restart the server. Before a large job, run one short phrase and check:

- the expected voice plays
- the output format is usable
- the character estimate is reasonable
- logs and browser network responses do not contain the API key
- a retry or page refresh does not double-submit the successful recipe

Voice profiles are bound to the provider active when they are created. After changing from `mock` to `elevenlabs`, duplicate the prior recipe (or create it again) and lock the resulting ElevenLabs profile. The queue will reject a mock profile in ElevenLabs mode, and it will never reuse or relabel a mock take as production audio. Mock exports remain available for testing but contain an explicit mock-provider warning.

Real-provider smoke tests should never run automatically in normal CI.

## Shutdown and recovery

Let active file writes finish when possible, then stop the local server normally. If it crashes, restart against the same `data/` directory and inspect persisted state before retrying.

Do not delete the SQLite `-wal` or `-shm` sidecar files while the server is running. Follow [backup-and-restore.md](backup-and-restore.md) before moving or replacing runtime state.

## Troubleshooting

### The browser cannot reach the server

On the Mac, confirm the local process is running, the configured port matches the browser URL, and another process is not already using the port.

For an iPhone, use only a URL printed by `pnpm start:iphone`; `127.0.0.1` on the phone means the phone itself. Use a normal Safari tab. If Private Browsing asks permission to reveal the phone's address to the local server, approve it. Confirm the Mac and phone are on the same trusted Wi-Fi, the Mac is awake, the macOS firewall allowed Node, any VPN is paused, and the network does not use client isolation. Do not work around connectivity with router port forwarding or a public tunnel.

If pairing fails repeatedly, wait for the displayed cooldown before trying the current code again. Restarting the server intentionally creates a new code and invalidates phone sessions.

### Import rows are rejected

Save as UTF-8, verify recognized field names, quote delimited fields containing their delimiter or newlines, and inspect the reported source line. A spreadsheet may have silently renamed a header or exported a locale-specific delimiter.

### ElevenLabs rejects every job

Stop the batch. Recheck the voice ID, model ID, language/format combination, account access, and current provider documentation. Permanent validation failures should not be repeatedly retried.

### Audio plays but export validation fails

Do not move files under `data/generated-audio` by hand. Restore the matching database and audio tree from the same backup, or regenerate the affected take with a new explicit request.

### Review progress disappeared

Stop and back up the entire `data/` directory before experimenting. Confirm the server is reading the expected `DATABASE_PATH`, not a new empty database created from another working directory.
