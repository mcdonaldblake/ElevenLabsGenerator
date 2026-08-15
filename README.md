# ElevenLabs Generator

A small, standalone ElevenLabs workbench for finding a voice, tuning its settings, testing a phrase, generating a batch, and downloading the audio for any app or project.

The interface is a single responsive page and works from an iPhone through a protected Vercel preview. It has no database, project history, server-side file storage, translation, or Frase Uno integration. Everything you type, import, or generate lives only in the current browser tab; closing or refreshing the tab clears it.

## What it does

- Browse and filter the ElevenLabs Shared Voice Library or select one of your account voices.
- Preview voices, copy a voice ID, or explicitly add a shared voice to your account and use the returned account voice ID.
- Adjust the model, output format, language, seed, stability, similarity, style, speed, and speaker-boost settings.
- Generate and listen to one test phrase before spending credits on a batch.
- Paste one phrase per line or import UTF-8 TXT, CSV, TSV, or JSON.
- Generate up to 100 pending clips at a time with two requests in flight.
- Play and download clips individually, share supported files from an iPhone, or download a client-built ZIP containing audio and manifests.

The application never writes, rewrites, translates, categorizes, or scores text. Voice browsing is operator-directed provider metadata, not an AI recommendation feature.

## Deliberate limits

- No database, Blob store, filesystem archive, background worker, persistent queue, projects, in-app user accounts, or export history.
- No refresh recovery: the recipe, imported rows, progress, and audio blobs exist only in the open tab.
- No automatic retry after an ambiguous provider or network failure, because retrying may spend credits twice.
- No Voice Design, Voice Remix, cloning, similar-voice search, speech-to-speech, or automatic voice selection.
- No production deployment on the current Hobby protection model. Use protected preview deployments only.

## Local development

Requirements:

- Node.js 22 or newer
- pnpm 11
- A modern browser
- An ElevenLabs API key for live account voices, adding a shared voice, and real generation

Install and start the development server:

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open the URL printed by Next.js. Keep the live key only in `.env.local`:

```dotenv
ELEVENLABS_API_KEY=your_restricted_key
ELEVENLABS_PROVIDER=mock
```

Never use a `NEXT_PUBLIC_` prefix for the key. Restrict the ElevenLabs key to the minimum required Voices Read/Write and Text-to-Speech permissions.

The mock adapter is for automated tests and explicitly selected local development. Set `ELEVENLABS_PROVIDER=elevenlabs` (or remove the variable, which defaults to ElevenLabs) only when a live request is intended. Mock mode must never be silently used in a deployed preview or presented as production speech.

## Use the page

1. Browse or select a voice. Use **Copy voice ID** when you only need the identifier, or **Add & use** when you want a shared voice added to your ElevenLabs account and loaded into the recipe.
2. Adjust the recipe and generate one short test phrase. Generation can consume ElevenLabs credits; replaying the resulting in-tab audio does not.
3. Paste one phrase per line or import a supported file. Inspect invalid and duplicate rows before proceeding.
4. Generate the next chunk. The tab must remain open while it runs. Successful clips remain available if another row fails; retry a failed row only after deciding that a second charge is acceptable.
5. Download individual clips or the ZIP. On iPhone, use the share action when Safari supports sharing the generated file; otherwise download it to Files.

See the [operator guide](docs/operator-guide.md) for the detailed flow and [import format](docs/import-format.md) for accepted columns and JSON shapes.

## ZIP contents

The browser builds the ZIP without uploading imported files or completed batches to Vercel:

```text
audio/0001.mp3
audio/0002.mp3
manifest.csv
manifest.json
recipe.json
```

An imported `id` or `filename` is used for the audio filename when present. Otherwise the row receives a zero-padded sequence name. Unsafe characters are removed and collisions receive deterministic numeric suffixes.

## Protected Vercel preview

Create or link a Vercel project for this repository, then enable **Vercel Authentication** with **Standard Protection** in the project settings. On a Hobby project, keep this application as a preview deployment; do not promote it to production because the chosen protection does not cover the stable production domain.

Git-triggered deployments are disabled in `vercel.json`. This prevents a push to `main` from creating an unprotected production deployment; releases are deliberate CLI preview deployments only.

Add `ELEVENLABS_API_KEY` as a sensitive Vercel environment variable scoped only to **Preview** and **Development**. Do not configure it for Production:

```bash
pnpm dlx vercel link
pnpm dlx vercel env add ELEVENLABS_API_KEY preview --sensitive
pnpm dlx vercel env add ELEVENLABS_API_KEY development --sensitive
pnpm dlx vercel deploy
```

Do not set `ELEVENLABS_PROVIDER=mock` on Preview; production builds reject that unsafe configuration. An omitted provider variable defaults to real ElevenLabs. Environment-variable changes affect new deployments, so create another preview after changing the key or provider mode.

`vercel deploy` returns a new protected preview URL. Open it, complete Vercel authentication, verify the workflow, and bookmark that preview URL on the iPhone. A later deployment creates another URL; it does not update an old bookmarked preview.

Safe inspection commands:

```bash
pnpm dlx vercel ls
pnpm dlx vercel inspect <preview-url>
pnpm dlx vercel logs <preview-url>
```

Do not run `vercel --prod`, `vercel deploy --prod`, or `vercel promote` under this protection model. Never paste API keys into a shell command, commit them to Git, or print them in logs.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All routine tests use the mock provider. A live ElevenLabs smoke test requires explicit approval and is limited to one short phrase.

Architecture and trust boundaries are documented in [ARCHITECTURE.md](ARCHITECTURE.md). The current implementation checkpoint is in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
