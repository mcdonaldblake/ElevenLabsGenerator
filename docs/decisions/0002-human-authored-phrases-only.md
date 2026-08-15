# ADR 0002: Human-Authored Phrases Only

- Status: Accepted
- Date: 2026-08-13

## Context

The source implementation plan included OpenAI-assisted phrase generation, structured model outputs, semantic review, and voice discovery/design/remix workflows. The adapted requirement is narrower: the operator will upload large batches of phrases already written elsewhere, listen to each rendered clip, keep or discard it quickly, and download stable audio for manual hardcoding.

Keeping language generation in the application would add provider credentials, prompts, model/version drift, non-deterministic output, review complexity, and cost without serving this workflow. Creative voice design, remixing, cloning, or similarity search would add a second generative subsystem. Deterministic browsing of ElevenLabs' public Shared Voice Library is different: it exposes provider-authored metadata and prerecorded samples so the operator can explicitly select a plain-TTS voice.

## Decision

All phrase content is human-authored and imported through a deterministic batch format.

Voice Foundry does not include:

- OpenAI or another LLM provider
- prompt storage or prompt execution
- phrase generation, paraphrasing, completion, translation, or categorization
- AI quality scoring, semantic similarity, or automated keep/discard decisions
- AI voice recommendation, similar-voice search, Voice Design, Voice Remix, cloning, or speech-to-speech

The application may perform deterministic operations such as schema validation, Unicode normalization, stable-ID generation, word/character counting, duplicate warnings, safe-path conversion, hashing, and collision detection. These operations do not replace or rewrite the operator's text. Duplicate warnings remain advisory; deletion and selection are human decisions.

ElevenLabs is the only production network provider and is limited to plain text-to-speech, account voice and usage metadata, and explicit Shared Voice Library browse/preview/add actions. Library results are not persisted or scored. Calls originate on the local server using an explicitly configured voice ID and versioned delivery recipe. The browser never receives the provider key. A mock provider supports offline workflow verification.

Display text and synthesis text are stored separately. A pronunciation-specific synthesis form is used only when explicitly supplied or edited by the operator; it is never created silently by a model.

## Consequences

### Benefits

- Every phrase has clear human provenance.
- Imports and validation are reproducible and inexpensive.
- Review cannot be biased by an opaque model score.
- The application needs only one optional production provider secret.
- Exported text can be traced back to the operator's source row and stable ID.
- The UI can prioritize fast playback, keep/discard, regeneration, and export.

### Costs and constraints

- The application will not help write or improve a phrase.
- The operator owns linguistic accuracy, appropriateness, translation, grouping, and duplicate judgment.
- Creative voice development happens outside Voice Foundry; public catalog browsing remains operator-directed.
- A valid ElevenLabs voice ID and supported model/setting combination must be selected explicitly, either from the account, from a shared-library result the operator adds, or by manual entry.
- Reintroducing any LLM or creative voice feature requires a new architecture decision, explicit user approval, updated privacy/cost controls, and separate testing.

## Rejected alternatives

### Keep OpenAI but disable it by default

Rejected because dormant prompts, credentials, code paths, and model-dependent schemas still enlarge maintenance and security scope and invite accidental activation.

### Automatically reject similar phrases

Rejected because short production phrases can be intentionally similar. Normalized matches are useful review signals, not sufficient evidence for deletion.

### Use ElevenLabs creative voice APIs in the same adapter

Rejected because Voice Design, Voice Remix, cloning, similar-voice search, and speech-to-speech have different inputs, consent implications, costs, and review needs. The provider adapter remains limited to plain TTS plus deterministic Shared Voice browse, preview, and add operations.

## Verification required

Before production use, search the dependency graph, environment schema, server routes, browser bundle, and network trace to confirm there is no OpenAI/LLM integration and no ElevenLabs creative-voice endpoint. Verify that mock generation makes no provider request, public library requests occur only after an explicit browse action, and keep/discard decisions can only be made through explicit operator actions.
