# Operator Guide

## Before you start

ElevenLabs Generator is intentionally temporary. The current recipe, pasted or imported rows, progress, and generated audio are held in the open browser tab only. Refreshing, navigating away, closing Safari, or allowing iOS to discard the tab loses that work. Download valuable audio before leaving the page.

A live preview uses the server-side ElevenLabs key and can consume account credits. Importing text, changing settings, browsing metadata, and replaying an already generated clip do not generate speech. **Generate test**, **Generate next 100**, and an explicit failed-row retry can create paid provider requests.

## 1. Open the protected page

Open the latest preview URL printed by a deliberate CLI `vercel deploy` and complete Vercel Authentication. Git pushes do not deploy this application. A new CLI deployment has a new preview URL; if an older bookmark does not show the latest interface, use the URL printed by that deployment.

The page should not expose its API when signed out. Stop if the preview opens without the expected Vercel access screen or if the page reports that its server-side ElevenLabs configuration is missing.

Never use a production alias for this Hobby project. If a URL was created by a `main`-branch Git deployment, `vercel --prod`, or promotion, treat it as unsafe until the public production deployment is removed and the Preview/Development-only secret scope is rechecked.

## 2. Find and choose a voice

Use **Shared Library** to search the ElevenLabs library. Filters, sorting, and pagination come from ElevenLabs metadata; the application does not recommend or rank voices itself. Start only one preview at a time and stop it before testing generated speech so the sources are not confused.

Each result offers two different actions:

- **Copy voice ID** copies the displayed identifier for another program or manual use.
- **Add & use** explicitly adds that shared voice to the configured ElevenLabs account, then loads the account voice ID returned by ElevenLabs into the recipe.

Use **My voices** to choose a voice already available to the account. You can also paste a known voice ID directly into the recipe. Verify the name and ID before generating; a public-library ID and the account ID returned after adding it are not assumed to be interchangeable.

Adding a voice changes the ElevenLabs account and can outlive this browser tab even though the generator saves nothing. Remove an unwanted added voice through ElevenLabs account controls.

## 3. Configure and test the recipe

Choose the model and supported output format, then adjust language, seed, stability, similarity boost, style, speed, and speaker boost as needed. The complete visible recipe is sent with every speech request; no saved server profile is involved.

Enter one short calibration phrase and review the displayed character count. Select **Generate test** once, wait for the result, then play or download it. Adjust the recipe and test again only when a second paid generation is intentional.

An existing test clip represents the recipe used when it was created. If settings change, treat that audio as stale even if it remains playable.

## 4. Add batch text

There are two input paths:

- Paste text with one phrase on each nonempty line.
- Import a UTF-8 TXT, CSV, TSV, or JSON file described in [Import Format](import-format.md).

Parsing occurs in the browser. Imported source files are not uploaded for storage. Inspect the preview, invalid-row messages, and duplicate warnings before adding accepted rows to the current-tab queue. Import never starts generation automatically.

Optional IDs or filenames control downloaded audio names. If neither is supplied, the app assigns a zero-padded sequence filename. Never rely on punctuation or path-like text in an imported name; the exporter sanitizes it and suffixes collisions.

## 5. Generate a chunk

Select **Generate next 100** to process at most the next 100 pending rows. Before starting, review the displayed request count and total characters for that next paid chunk. The browser schedules no more than two requests at a time. Keep the tab visible and the device awake when practical, especially on iPhone.

Each row independently shows its state and, on success, playback and download controls. If one row fails, successful rows remain available. **Cancel remaining** stops rows that have not started; the current pair is allowed to finish because ElevenLabs may already have received and billed those requests.

The application deliberately does not retry ambiguous failures. Read the sanitized error and use the row's manual retry only if another paid request is acceptable. Do not repeatedly press generation controls while a request is active.

For more than 100 phrases, download or verify the completed chunk, then generate the next pending chunk. The entire active set still occupies browser memory, so smaller working sets are safer on a phone.

## 6. Download or share

Every successful row can be downloaded individually. The batch action creates a ZIP in the browser containing generated audio plus:

- `manifest.csv`
- `manifest.json`
- `recipe.json`

The batch action exports successful clips from the most recently started chunk. `recipe.json` records the generation-time recipe snapshot for those clips, even when the controls have since changed. The exporter refuses to label clips made with different recipes as one batch. The ZIP is not fetched from cloud storage and cannot be recreated after the tab is lost unless the speech is generated again.

On iPhone, choose **Share** when the Web Share API accepts the generated file, then save to Files, AirDrop it, or send it to an appropriate destination. If file sharing is unavailable, use **Download** and find the result in Safari's Downloads list or the Files app. Confirm the file exists outside the page before closing the tab.

## Common problems

### The page asks me to sign in

This is expected. Complete Vercel Authentication with an account allowed to access the project. If access was not granted, ask the Vercel project owner; the application has no separate user database.

### A voice preview will not play

Try another result to distinguish a missing provider preview from a general connection problem. The server rejects redirects, unapproved hosts, non-audio responses, and oversized preview files. Provider plan or catalog restrictions can also make a result unavailable.

### Add & use fails

Confirm that the restricted ElevenLabs key has the required Voices Read/Write permission and that the account plan permits adding that shared voice. The key must be configured on the Vercel Preview environment, not in browser storage.

### Generation fails

Check the visible voice ID, model, format, text length, and numeric settings. A 401/403 normally points to key permissions or plan access; 429 means the provider is throttling or the account limit was reached. Wait before a manual retry. Sanitized UI errors should never contain the API key.

### My work disappeared

The app does not recover sessions. Refreshing, navigating, closing the tab, an iOS memory eviction, or a browser crash erases un-downloaded audio. Reopen the latest preview and recreate the batch from the original text file.

### The iPhone share action is unavailable

Browser and file-size support varies. Use the normal download fallback and save the file from Safari to Files. If a very large ZIP strains mobile memory, download smaller chunks or use a desktop browser.
