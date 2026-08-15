# ADR 0002: Human-Authored Text Only

- Status: Accepted
- Date: 2026-08-14

## Context

The generator is for quickly producing audio from text the operator already controls. Adding an LLM, translation layer, automatic rewriting, categorization, scoring, or voice recommendation would change its purpose, add cost and data handling, and make source text less predictable.

ElevenLabs itself remains necessary for ordinary text-to-speech and provides metadata and prerecorded previews for explicit voice browsing.

## Decision

Accept text only through direct entry or TXT, CSV, TSV, and JSON import. Preserve that text except for deterministic parsing and validation.

Permit ElevenLabs only for:

- explicit Shared Voice Library search, filters, pagination, and preview
- account voice listing
- explicit add-to-account for one selected shared voice
- plain text-to-speech for one test phrase or one batch row

Do not add translation, rewriting, phrase generation, automated categorization, semantic search, similarity scoring, automatic ranking, Voice Design, Voice Remix, cloning, similar-voice search, speech-to-speech, or automatic keep/discard decisions.

## Consequences

- The operator remains responsible for wording, language, meaning, selection, and provider rights.
- Invalid text is reported rather than repaired.
- Voice-library ordering is presented as provider metadata, not an application recommendation.
- Mock output exists only for explicit local/test verification and is never silently substituted for live speech.
