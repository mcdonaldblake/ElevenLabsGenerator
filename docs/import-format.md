# Batch Import Format

## Overview

Batch import accepts phrases authored outside Frase Uno Voice Foundry. The application parses and validates the file deterministically; it does not generate, rewrite, translate, or judge the text.

Supported filename extensions are `.csv`, `.tsv`, `.txt`, and `.json`. Use CSV or TSV for structured tabular metadata, JSON for an existing array, or plain text for one phrase per line. The checked-in fixtures are [phrases.csv](../samples/phrases.csv) and [phrases.txt](../samples/phrases.txt).

The deterministic importer is covered by parser and API workflow tests using the checked-in fixtures and multipart file-first ordering.

## CSV and TSV

CSV uses commas and TSV uses tabs. Quoted fields may contain delimiters, newlines, and escaped double quotes. A recognized header row is recommended:

Recommended header:

```csv
id,text,synthesis_text,group,category,notes
```

### Columns

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | No | Stable asset identifier. Use lowercase ASCII letters, numbers, hyphens, or underscores when possible. |
| `text` | Yes | Exact phrase shown to reviewers and retained as display text. |
| `synthesis_text` | No | Text sent to ElevenLabs. Blank means use `text`. |
| `group` | No | Operator-defined family such as `correct-continue`. |
| `category` | No | Operator-defined category for filtering. No AI assigns it. |
| `tone` | No | Operator-authored tone label used for filtering/export metadata. |
| `english_meaning` | No | Optional human-supplied meaning or translation. It is never generated automatically. |
| `notes` | No | Human notes; not sent to TTS unless the UI explicitly states otherwise. |
| `metadata` | No | Optional extra metadata. For a delimited file, encode structured metadata as valid JSON text. |

The server recognizes these header aliases:

| Canonical field | Accepted aliases |
| --- | --- |
| `id` | `id`, `phrase_id`, `phraseid`, `key` |
| `text` | `text`, `phrase`, `display_text`, `displayText`, `spanish`, `es` |
| `synthesis_text` | `synthesis_text`, `synthesisText`, `provider_text`, `tts_text` |
| `group` | `group`, `group_code`, `groupCode`, `transition`, `transition_code` |
| `category` | `category`, `type` |
| `tone` | `tone` |
| `english_meaning` | `english_meaning`, `englishMeaning`, `english`, `translation` |
| `notes` | `notes`, `note` |
| `metadata` | `metadata`, `metadata_json` |

Header matching is case-insensitive; spaces and hyphens are normalized to underscores. If the file is a headerless one-column CSV or TSV, each row's first field is treated as phrase text and structured metadata is unavailable. In a structured file, phrase text is required.

`text` and `synthesis_text` are limited to 5,000 characters. `group` is limited to 100 characters. For portable batches, also keep category-like labels at or below 100 characters and notes concise.

### Default file and row limits

The server defaults are:

- 25,000,000 bytes per uploaded file (`MAX_IMPORT_BYTES`)
- 100,000 parsed rows per upload (`MAX_IMPORT_ROWS`)
- 100 preview rows returned to the browser

The first two limits are locally configurable environment settings. Raising them increases memory, database, and review load; test with mock mode before changing either value.

### Stable IDs

An explicit `id` is strongly recommended for files that may be edited and re-imported. It becomes the durable reference used by review state and export filenames.

Unsafe supplied characters are normalized before the ID is used as a path segment. Do not rely on that normalization to distinguish two rows: `Correct Continue 1` and `correct-continue-1` can converge on the same ID and should be treated as a collision.

If `id` is blank, the importer can derive an ID from the source-file SHA-256 hash and one-based source row, in the form:

```text
phrase-<first-10-hash-characters>-<six-digit-row>
```

That fallback is stable for the exact same file bytes and row position. Editing earlier rows or re-exporting a spreadsheet differently can change the source hash, so use explicit IDs for long-lived production assets.

### Display text and synthesis text

`text` is the canonical phrase presented to the operator and exported for application display. `synthesis_text` is an optional provider-facing pronunciation variant.

Example:

```csv
id,text,synthesis_text,group,category,notes
lesson-001,"Practica la letra R.","Practica la letra erre.",pronunciation,instruction,"Say the letter name clearly"
```

The application must not silently rewrite either field. Editing text creates a material recipe change and should produce a distinct job fingerprint for later TTS.

### Quoting rules

- Quote a field if it contains a comma, double quote, carriage return, or newline.
- Escape a literal double quote by doubling it: `""`.
- Use `.csv` for comma-delimited content and `.tsv` for tab-delimited content. The server selects the delimiter from the extension.
- Preserve Spanish punctuation and accents; save as UTF-8.
- A UTF-8 byte-order mark may be tolerated, but UTF-8 without a BOM is the safest fixture format.

Example with punctuation and a comma:

```csv
correct-continue-004,"¡Muy bien, seguimos!",,correct-continue,encouragement,
```

### Blank rows and missing values

Blank `text` is invalid. Blank optional fields are stored as empty/default metadata, and blank `synthesis_text` falls back to `text` for TTS.

Completely empty trailing rows should be ignored. Do not use comments or extra preamble lines before the CSV header.

## JSON

JSON may be either an array or an object with a `phrases` array. Array values may be strings or objects.

String-array example:

```json
[
  "Eso es. Seguimos.",
  "Adelante."
]
```

Structured example:

```json
{
  "phrases": [
    {
      "id": "correct-continue-001",
      "text": "Eso es. Seguimos.",
      "group": "correct-continue",
      "category": "acknowledgement_continue",
      "notes": "Warm and brief"
    }
  ]
}
```

Object properties use the same aliases as CSV headers. Array elements must be strings or objects; another value is treated as an invalid empty phrase. The top level must not be a single phrase object.

## Plain text

A TXT import contains one phrase per physical line:

```text
Eso es. Seguimos.
Muy bien. Vamos con la siguiente.
Adelante.
```

Rules:

- Save as UTF-8.
- Each non-empty line is one independent phrase.
- Blank lines may be ignored.
- There is no header and no comment syntax.
- Whitespace surrounding a line may be trimmed; internal whitespace and punctuation are phrase content.
- Multiline phrases are not representable in TXT. Use quoted CSV for those.
- IDs are source-derived because TXT has no `id` column.
- Group, category, synthesis text, and notes are empty/default values and can be edited after import.

## Duplicate comparison

The deterministic comparison layer can normalize Unicode, lowercase with a Spanish locale, replace punctuation with spaces, collapse repeated whitespace, and create an accent-insensitive comparison form.

For example, these may share a comparison key:

```text
¿Cómo estás?
como estas
```

Comparison normalization is for warnings and exact/near lookup. It does not change the original display text, and it does not authorize automatic deletion. Duplicate text is flagged in preview but is not automatically discarded solely for being similar; the operator decides whether both phrases are useful.

Stable-ID collisions are handled separately from text similarity. On commit, a row whose stable ID already exists in the same project is skipped. Re-importing the same source is therefore intended to be idempotent rather than creating a second asset with the same ID. Review the commit summary because a skip can also indicate that two different supplied IDs normalized to the same safe value.

## File-level safety

Treat imports as untrusted data even when you created them:

- Preview the recognized row count before confirming.
- Remember that the on-screen preview contains at most the first 100 parsed rows; totals cover the full accepted upload.
- Review rejected-row diagnostics and source line numbers.
- Reject duplicate IDs and path collisions.
- Do not allow imported IDs to choose absolute paths or parent directories.
- Apply configured file-size, row-count, and total-character limits before writing to SQLite.
- Keep the original source file so a generated fallback ID can be reproduced.

Spreadsheet applications can alter accents, leading zeros, delimiters, line breaks, and quoting. Inspect the exported file as plain text before importing a large production batch.

## Suggested preflight checklist

1. Every desired row has non-empty `text`.
2. Every explicit ID is unique after lowercase/path-safe normalization.
3. CSV values containing commas are quoted.
4. Display text is the exact wording the downstream program should associate with the audio.
5. Synthesis text differs only where the provider needs a deliberate pronunciation variant.
6. The file is UTF-8 and uses the expected comma delimiter.
7. The filename uses one of the supported extensions: `.csv`, `.tsv`, `.txt`, or `.json`.
8. The original file is backed up outside the runtime `data/` directory.

## Local API contract

The browser uses multipart uploads with a `file` field and optional `projectId`:

```text
POST /api/imports/preview
POST /api/imports
GET  /api/imports/:id
```

Preview is read-only. Commit is a separate explicit request so a large source is not persisted merely because it was selected in the browser.
