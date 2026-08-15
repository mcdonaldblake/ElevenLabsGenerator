# ElevenLabs Generator — Development Instructions

## Product boundary

This repository is a standalone, single-operator ElevenLabs utility. It is not part of Frase Uno, its lesson builder, its admin UI, or any downstream application. Never add code that writes to another repository or assumes Frase Uno-specific fields, exports, or deployment.

## Human-authored content rule

- Text is typed or imported by the operator. Do not add an LLM, translation, rewriting, categorization, scoring, phrase generation, or automated recommendations.
- ElevenLabs is permitted only for plain text-to-speech, account voice listing, and explicit operator-directed Shared Voice Library browsing, previewing, filtering, and adding.
- Voice Design, Voice Remix, cloning, similar-voice search, speech-to-speech, and automatic voice selection are outside this product.
- Automated tests and local browser workflow checks must use the mock provider. A protected-preview check may verify access and non-paid navigation with the real adapter, but a real-provider generation requires explicit authorization and must be limited to one short phrase.

## Runtime and security

- The production shape is one Next.js App Router application deployed as a Node.js Vercel **preview**, protected by Vercel Authentication with Standard Protection.
- Do not promote or deploy this Hobby project to production: the stable production domain is not covered by the chosen protection. Every release has a new protected preview URL.
- Do not connect this repository for automatic Git deployments. Keep `git.deploymentEnabled` set to `false` in `vercel.json` and release only with the CLI command `vercel deploy` without `--prod`. A `main`-branch Git deployment would be Production and its Hobby production domain would be public.
- Keep `ELEVENLABS_API_KEY` server-only and scoped to Vercel Preview and Development. Never prefix it with `NEXT_PUBLIC_`, return it, persist it, or log it.
- All mutation routes require exact same-origin checks. Validate every browser input and provider response, sanitize provider errors, disable response caching, and narrowly allowlist preview-media URLs. Preserve the 32 KiB JSON-body, 5,000-character phrase, 3,000-character preview-URL, and 12 MiB audio ceilings unless a deliberate security review changes them.
- Do not reintroduce LAN pairing, public tunnels, Fastify, SQLite, a cloud database, durable queues, server filesystem storage, user accounts, or project history.

## Ephemeral workflow invariants

- The browser tab owns the recipe, imported rows, progress, and generated audio blobs. Refreshing or closing it intentionally erases the session.
- Importing or pasting text never starts paid generation automatically. Display a character count and paid-generation warning before test or batch generation.
- One API request generates one phrase. Process at most 100 pending phrases per chunk with at most two requests in flight.
- Do not automatically retry an ambiguous network failure because it may duplicate a paid request. Preserve successful in-tab clips and offer explicit manual retry for failures.
- “Add & use” must be an explicit account mutation and must use the account voice ID returned by ElevenLabs.
- Build ZIP exports in the browser. Sanitize filenames, suffix collisions deterministically, and include `manifest.csv`, `manifest.json`, and `recipe.json`.

## Verification

Run the repository scripts for linting, typechecking, tests, and a production build. Use mock mode for unit, integration, and browser verification. Verify the complete responsive flow at desktop, 390 px, and 430 px widths, including individual download, ZIP download, and the iPhone share fallback.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
