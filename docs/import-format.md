# Import Format

The application accepts UTF-8 TXT, CSV, TSV, and JSON files. Parsing and validation happen in the browser; the source file is not stored by the server.

The supported generic record is:

```text
id? | filename? | text
```

`text` is required. `phrase` and `line` are accepted as aliases for `text`. `id` and `filename` are optional naming hints only; they do not create persistent records.

Common header variants are normalized: `phrase_id`, `phraseid`, `external_id`, and `externalid` map to `id`; `file_name`, `file`, and `name` map to `filename`. Capitalization, spaces, and hyphens in headers are ignored during matching.

## Limits

- Maximum source size: 25 MB
- Maximum parsed rows: 100,000
- Maximum phrase accepted by the speech route: 5,000 characters
- Blank text rows: ignored or reported, never generated
- Generation chunk: at most 100 pending rows
- Generation concurrency: two requests

The import limit is deliberately much larger than the safe generation chunk. A very large parsed set and its generated audio still consume browser memory, so divide large jobs into smaller files when working on an iPhone.

## TXT

Each nonempty line becomes one phrase. Leading and trailing whitespace is removed; the application does not translate, rewrite, or otherwise alter the text.

```text
Welcome to the application.
Your download is ready.
Please try again.
```

TXT rows have no supplied ID or filename and receive sequence-based output names.

## CSV

CSV may contain a header row with `text`, `phrase`, or `line`:

```csv
id,filename,text
welcome,welcome-short,Welcome to the application.
ready,download-ready,Your download is ready.
```

Quote values according to normal CSV rules when they contain commas, quotes, or line breaks:

```csv
id,text
greeting,"Hello, and welcome."
quoted,"She said ""hello""."
```

Column names are matched without regard to capitalization or surrounding whitespace. Unrecognized columns are ignored rather than exported as application-specific metadata.

A headerless CSV is also accepted; its first column is treated as text and the other columns are ignored.

## TSV

TSV uses the same columns as CSV, separated by tabs:

```text
id	filename	text
welcome	welcome-short	Welcome to the application.
ready	download-ready	Your download is ready.
```

A literal tab or newline inside a value must be quoted if the parser supports quoted TSV. Prefer JSON for complex multiline text.

## JSON

JSON can be an array of strings:

```json
[
  "Welcome to the application.",
  "Your download is ready."
]
```

Or an array of objects using `text` or `phrase`:

```json
[
  {
    "id": "welcome",
    "filename": "welcome-short",
    "text": "Welcome to the application."
  },
  {
    "id": "ready",
    "phrase": "Your download is ready."
  }
]
```

The root can also be an object with a `phrases` array containing the same string or object records. Other nested project, lesson, translation, settings, or category objects are not imported.

## Validation and duplicates

The preview separates accepted rows from invalid or duplicate rows before anything is added to the queue. Missing, empty, and over-5,000-character text values are invalid. Scalar text values are converted to text; the importer does not translate or rewrite them. The speech route independently enforces the same length ceiling.

Duplicate detection is based on normalized phrase text, including text already in the current tab. Case, Unicode compatibility variants, punctuation, symbols, and repeated whitespace do not make otherwise identical text unique. A duplicate row is surfaced and not added silently. If identical speech is intentionally needed twice, download one generated clip and copy it under the second destination filename outside this application.

## Output filenames

The exporter chooses the first available naming hint in this order:

1. `filename`
2. `id`
3. zero-padded row sequence such as `0001`

It removes path separators, traversal segments, control characters, and unsafe punctuation, then adds the chosen audio extension. If two rows resolve to the same safe name, later names receive deterministic numeric suffixes. Imported values never become directories or absolute paths.

## Character and credit review

The page shows phrase and character counts before generation. These counts are planning aids; ElevenLabs determines final billing and model limits. Importing is free, but every test, batch row, or explicit retry sent to ElevenLabs can consume credits.
