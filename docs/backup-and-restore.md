# Backup and Restore

## Scope

Frase Uno Voice Foundry stores operational state locally. A usable backup must keep the SQLite database and generated audio together; copying only one can leave records pointing to missing files.

No automatic backup capability is assumed. The procedure below is conservative and has not yet been verified end to end in this checkout.

## What to back up

By default, back up the entire `data/` directory:

```text
data/
  voice-foundry.sqlite
  voice-foundry.sqlite-wal     may exist while running
  voice-foundry.sqlite-shm     may exist while running
  generated-audio/
  exports/
  other application-created runtime folders
```

Also retain separately:

- the original imported CSV, TSV, TXT, or JSON files
- the repository revision or a copy of `package.json` and the pnpm lockfile
- a written note of the application version and backup date
- `.env`, only if your secure backup system is appropriate for API secrets

Exports are useful handoff artifacts but are not a complete replacement for the database and original generated takes.

## Before backing up

1. Let active TTS and export jobs finish or cancel queued work.
2. Stop the local server normally.
3. Confirm no Voice Foundry server process is still using the database.
4. Confirm the backup destination has enough free space for the entire audio tree.

Stopping first lets SQLite reconcile its write-ahead log and prevents the database from being captured at a different moment than the audio files.

## Create a dated backup

From the repository root, choose a destination outside the repository and copy the directory as one unit. For example:

```bash
backup_root="/path/to/secure-backups"
backup_name="frase-uno-voice-foundry-2026-08-13"
mkdir -p "$backup_root/$backup_name"
cp -a data "$backup_root/$backup_name/data"
cp package.json pnpm-lock.yaml "$backup_root/$backup_name/"
```

If `pnpm-lock.yaml` is not present, omit it rather than treating that as an application-data failure.

Record a quick inventory without exposing file contents:

```bash
du -sh "$backup_root/$backup_name/data"
find "$backup_root/$backup_name/data" -type f | wc -l
```

Protect the destination. Audio, phrase text, notes, and provider metadata may be sensitive even though the tool is local-only.

## Optional integrity inventory

For a backup medium where corruption is a concern, create a checksum list from inside the backup directory:

```bash
cd "/path/to/secure-backups/frase-uno-voice-foundry-2026-08-13"
find data -type f -print0 | sort -z | xargs -0 shasum -a 256 > backup-sha256.txt
```

Keep the checksum file beside the backup. This list contains paths, so treat it with the same confidentiality as the backup.

## Restore into the same checkout

Do not merge two live databases or copy only selected SQLite files.

1. Stop the Voice Foundry server.
2. Move the current `data/` directory to a clearly named quarantine location on the same disk. Do not delete it until the restore is verified.
3. Copy the backed-up `data/` directory into the repository root.
4. Restore the compatible application revision and dependencies if necessary.
5. Check that `.env` points to the restored database, audio, and export roots.
6. Start in mock mode first and inspect projects, phrase counts, queue state, review decisions, and audio playback.
7. Create a new test export and inspect it before resuming real TTS work.

Example copy commands, after manually confirming every absolute path:

```bash
mv data data.before-restore-2026-08-13
cp -a "/path/to/secure-backups/frase-uno-voice-foundry-2026-08-13/data" ./data
```

The first command is recoverable while the quarantine directory remains. Never run a broad recursive delete to make room for a restore.

## Restore into a new checkout

1. Check out the same application revision used for the backup.
2. Install dependencies without changing the lockfile.
3. Copy the backup's `data/` directory into the new repository root.
4. Create a fresh `.env`; copy the API key only through your secret-management process.
5. Ensure `DATABASE_PATH`, `AUDIO_ROOT`, and `EXPORT_ROOT` match the restored layout.
6. Start in mock mode and perform the verification checks below.

Do not run two checkouts simultaneously against the same database or audio directory.

## Verification after restore

Check all of the following before deleting the pre-restore quarantine copy:

- the application starts without creating a second empty database
- imported batch and phrase counts match the backup notes
- kept/discarded/pending decisions appear correctly
- several audio takes play, including one from each large batch
- voice-profile versions and take recipes are present
- no queue item is incorrectly left in a running state
- a dry-run export detects no missing file or path collision
- a new export ZIP can be opened and its listed files exist

If a backup checksum inventory exists, verify it before starting the application:

```bash
cd "/path/to/restored-backup-copy"
shasum -a 256 -c backup-sha256.txt
```

## SQLite cautions

- Never edit the database with a text editor.
- Never copy a live `.sqlite` file while omitting its current `-wal` file.
- Never mix a database from one backup with generated audio from another.
- Do not delete `-wal` or `-shm` files to fix a startup problem.
- Do not open the same database from multiple server processes.

If the application later gains an online SQLite backup command, prefer that documented command. Until then, a stopped-process full-directory copy is the safest supported procedure.

## API-key recovery

The ElevenLabs key should not be stored in SQLite or an export. Restoring `data/` therefore does not restore credentials. Re-enter the key in the local `.env` file and rotate it if a backup was exposed. Restored runs start on loopback by default; phone pairing codes and sessions are deliberately in memory and are never restored.
