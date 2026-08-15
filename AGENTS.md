# Frase Uno Voice Foundry — Development Instructions

## Product boundary

This repository is a standalone, local-workstation production tool. It is not part of the Frase Uno learner application, admin UI, Supabase project, or deployment. Never add code that writes directly into the production Frase Uno repository.

## Human-authored content rule

- Phrase text is imported from files or edited by the operator.
- Do not add OpenAI, another LLM, embeddings, semantic scoring, automated phrase generation, rewriting, translation, categorization, or quality recommendations.
- ElevenLabs is permitted only behind the server-side `TtsProvider` boundary for plain text-to-speech, account voice listing, and explicit user-initiated browsing, previewing, filtering, and adding of public Shared Voice Library voices. Library results are provider metadata, not AI recommendations, and must not be persisted.
- Voice Design, Voice Remix, cloning, similar-voice search, and speech-to-speech are outside this build.
- Mock mode must remain usable without credentials or paid requests.

## Security and persistence

- Bind only to `127.0.0.1` by default.
- Network access is allowed only through the explicit paired-LAN mode: private local-network addresses, same-origin requests, short-lived server-side sessions, and rate-limited pairing are required. Never expose the app through a tunnel, public interface, or reverse proxy.
- Never expose, persist, return, or log provider credentials.
- Validate browser input and provider responses.
- Keep SQLite metadata and audio files in `data/`; do not store audio blobs in SQLite.
- Preserve successful original takes. Regeneration creates another take.
- Use stable IDs and application-controlled paths. Never trust an imported or provider filename.
- Do not silently overwrite an export.

## Workflow invariants

- Importing a file never queues paid work automatically.
- Each phrase is independently actionable.
- Every TTS recipe has a deterministic fingerprint; an ordinary retry must not rebill an already successful recipe.
- Keep/discard decisions persist immediately.
- A kept phrase must have exactly one selected primary take before export.
- Export only explicitly kept assets and include stable mappings, metadata, and checksums.

## Verification

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Use mock mode for normal automated and browser verification. Real-provider smoke tests require explicit authorization, a separate flag, and one short phrase only.
