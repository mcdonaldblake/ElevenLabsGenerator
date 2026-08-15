# ADR 0003: Vercel Authentication Boundary

- Status: Accepted
- Date: 2026-08-14
- Supersedes: opt-in paired LAN access

## Context

The deployed tool holds a server-side ElevenLabs key capable of account mutations and paid generation. A publicly reachable page without authentication would allow unknown users to consume credits. The application does not need its own user database or team workspace.

Vercel Authentication with Standard Protection can protect preview deployments. Under the selected Hobby plan behavior, the same protection does not cover the stable production domain.

## Decision

Enable Vercel Authentication and Standard Protection for the project's preview deployments. Scope `ELEVENLABS_API_KEY` only to Preview and Development. Disable Git-triggered deployments, release only through CLI `vercel deploy`, and do not configure a Production key, deploy with `--prod`, or promote a preview while this access model remains in force.

Treat authentication as an outer boundary, not a replacement for application controls. Mutation handlers still require exact same-origin requests, all inputs and provider responses are validated, preview URLs are allowlisted, responses are non-cacheable, and provider errors are sanitized.

## Consequences

- The intended operator can use the tool remotely after Vercel sign-in.
- Every deployment has a distinct protected preview URL that may need a new bookmark.
- Access is governed by Vercel project permissions; there is no separate app account or saved profile.
- Anyone granted project access may be able to spend ElevenLabs credits, so membership and API-key permissions must remain narrow.
- Moving to a stable production domain requires revisiting the Vercel plan and protection settings before any Production secret or promotion is allowed.
