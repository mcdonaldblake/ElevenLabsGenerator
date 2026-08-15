# ADR 0001: Standalone Protected Vercel Preview

- Status: Accepted
- Date: 2026-08-14
- Supersedes: the former local Fastify/SQLite workstation architecture

## Context

The operator wants a reusable ElevenLabs generator that can be opened from an iPhone anywhere, not a Frase Uno-specific production system. The useful workflow is short-lived: browse a voice, tune a recipe, submit human-authored phrases, and download the audio.

Durable projects, a database, local server files, a restartable job queue, review decisions, and LAN pairing add operational weight without serving that workflow.

## Decision

Build one responsive Next.js App Router application. Deploy it manually with the Vercel CLI as a Node.js preview protected by Vercel Authentication with Standard Protection. Disable automatic Git deployments in `vercel.json` and do not connect the repository as an automatic release path.

The browser tab owns all workflow and audio state. Route handlers proxy only the required ElevenLabs voice and single-phrase speech operations. No application database, object store, durable queue, or server filesystem is used.

On the selected Hobby protection model, do not create or promote a Production deployment. Each release uses its newly created protected preview URL from `vercel deploy` without `--prod`.

## Consequences

- The page is reachable from an authenticated iPhone without the Mac or a shared Wi-Fi network.
- Refreshing or closing the tab erases un-downloaded work.
- Batches require the browser to remain active and are limited to 100 rows per chunk with concurrency two.
- Completed audio must be downloaded or shared from the current tab.
- Deployment is simpler, but there is no background continuation or recovery after browser loss.
- Pushing or merging Git does not release the application; every preview is a deliberate CLI action.
- A future production-domain or multi-user requirement would require a new access-control decision, not silent removal of preview protection.
