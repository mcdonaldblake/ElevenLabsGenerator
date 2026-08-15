import type {
  AccountVoice,
  AudioStatus,
  AudioTake,
  DashboardData,
  ExportPreview,
  ExportRecord,
  HealthStatus,
  ImportPreview,
  ImportResult,
  Phrase,
  PhraseDecision,
  PhrasePage,
  ProductionMode,
  ProductionPreflight,
  Project,
  ReviewItem,
  ReviewPage,
  SharedVoice,
  SharedVoicePage,
  TtsBatch,
  UsageSummary,
  VoiceProfile,
  VoiceSettings,
} from "../types";

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unwrap(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ("data" in value && value.data !== undefined) return value.data;
  return value;
}

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}

export function number(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function boolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function now(): string {
  return new Date().toISOString();
}

function decision(value: unknown): PhraseDecision {
  if (value === "kept" || value === "approved" || value === "primary") return "kept";
  if (value === "discarded" || value === "rejected") return "discarded";
  return "pending";
}

function audioStatus(value: unknown, takeCount: number): AudioStatus {
  if (value === "ready" || value === "succeeded" || value === "complete" || value === "primary_selected") return "ready";
  if (value === "queued" || value === "running" || value === "retry_wait" || value === "pending_review") return "queued";
  if (value === "failed" || value === "reviewed_no_primary") return "failed";
  if (value === "no_audio") return "none";
  return takeCount > 0 ? "ready" : "none";
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function normalizeProject(value: unknown, index = 0): Project {
  const item = record(value);
  const createdAt = text(item.createdAt ?? item.created_at, now());
  return {
    id: text(item.id, `project-${index + 1}`),
    name: text(item.name ?? item.label, "Untitled project"),
    code: text(item.code ?? item.slug, "voice-library"),
    createdAt,
    updatedAt: text(item.updatedAt ?? item.updated_at, createdAt),
  };
}

export function normalizeProjects(value: unknown): Project[] {
  const payload = unwrap(value);
  const source = isRecord(payload) ? payload.projects ?? payload.items : payload;
  return array(source).map(normalizeProject);
}

export function normalizePhrase(value: unknown, index = 0): Phrase {
  const item = record(value);
  const takes = number(item.takeCount ?? item.take_count ?? item.audioTakeCount);
  const displayText = text(item.displayText ?? item.display_text ?? item.text ?? item.phrase);
  const synthesisValue = item.synthesisText ?? item.synthesis_text;
  return {
    id: text(item.id, `phrase-${index + 1}`),
    projectId: text(item.projectId ?? item.project_id),
    externalId: text(item.externalId ?? item.external_id ?? item.stableId ?? item.stable_id),
    displayText,
    synthesisText: synthesisValue == null ? null : text(synthesisValue),
    groupCode: text(item.groupCode ?? item.group_code ?? item.transitionCode),
    category: text(item.category),
    tone: text(item.tone),
    englishMeaning: text(item.englishMeaning ?? item.english_meaning),
    notes: text(item.notes),
    decision: decision(item.decision ?? item.reviewDecision ?? item.review_decision),
    audioStatus: audioStatus(item.audioStatus ?? item.audio_status ?? item.ttsStatus, takes),
    sourceFile: text(item.sourceFile ?? item.source_file ?? item.importFile, "Manual entry"),
    sourceRow: number(item.sourceRow ?? item.source_row, index + 1),
    wordCount: number(item.wordCount ?? item.word_count, displayText.trim() ? displayText.trim().split(/\s+/).length : 0),
    characterCount: number(item.characterCount ?? item.character_count, displayText.length),
    takeCount: takes,
    primaryTakeId:
      item.primaryTakeId == null && item.primary_take_id == null && item.selectedTakeId == null
        ? null
        : text(item.primaryTakeId ?? item.primary_take_id ?? item.selectedTakeId),
    updatedAt: text(item.updatedAt ?? item.updated_at, now()),
  };
}

export function normalizePhrasePage(value: unknown, fallbackPage = 1, fallbackPageSize = 25): PhrasePage {
  const payload = unwrap(value);
  const root = record(payload);
  const pagination = record(root.pagination ?? root.meta);
  const source = root.items ?? root.phrases ?? (Array.isArray(payload) ? payload : []);
  const items = array(source).map(normalizePhrase);
  return {
    items,
    page: number(root.page ?? pagination.page, fallbackPage),
    pageSize: number(root.pageSize ?? root.page_size ?? pagination.pageSize ?? pagination.page_size, fallbackPageSize),
    total: number(root.total ?? root.totalCount ?? pagination.total, items.length),
  };
}

function normalizeVoiceSettings(value: unknown): VoiceSettings {
  const settings = record(value);
  return {
    stability: number(settings.stability, 0.5),
    similarityBoost: number(settings.similarityBoost ?? settings.similarity_boost, 0.75),
    style: number(settings.style, 0.1),
    speed: number(settings.speed, 1),
    useSpeakerBoost: boolean(settings.useSpeakerBoost ?? settings.use_speaker_boost, true),
  };
}

export function normalizeVoiceProfile(value: unknown, index = 0): VoiceProfile {
  const item = record(value);
  const lockedValue = item.lockedAt ?? item.locked_at;
  return {
    id: text(item.id, `profile-${index + 1}`),
    projectId: text(item.projectId ?? item.project_id),
    label: text(item.label ?? item.name, "Mara production voice"),
    version: number(item.version ?? item.versionNumber, index + 1),
    voiceId: text(item.voiceId ?? item.voice_id),
    voiceName: text(item.voiceName ?? item.voice_name),
    modelId: text(item.modelId ?? item.model_id, "eleven_multilingual_v2"),
    languageCode:
      item.languageCode == null && item.language_code == null
        ? null
        : text(item.languageCode ?? item.language_code),
    outputFormat: text(item.outputFormat ?? item.output_format, "mp3_44100_128"),
    settings: normalizeVoiceSettings(item.settings ?? item.voiceSettings),
    notes: text(item.notes),
    lockedAt: lockedValue == null ? null : text(lockedValue),
    isProduction: boolean(item.isProduction ?? item.is_production ?? item.currentProduction),
    createdAt: text(item.createdAt ?? item.created_at, now()),
  };
}

export function normalizeVoiceProfiles(value: unknown): VoiceProfile[] {
  const payload = unwrap(value);
  const source = isRecord(payload) ? payload.profiles ?? payload.items : payload;
  return array(source).map(normalizeVoiceProfile);
}

export function normalizeAccountVoice(value: unknown, index = 0): AccountVoice {
  const item = record(value);
  const labelsRecord = record(item.labels);
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(labelsRecord)) labels[key] = text(label);
  return {
    id: text(item.voiceId ?? item.voice_id ?? item.id, `voice-${index + 1}`),
    name: text(item.name, "Unnamed voice"),
    category: text(item.category ?? item.voiceType ?? item.voice_type, "Account voice"),
    description: text(item.description),
    labels,
    previewUrl:
      item.previewUrl == null && item.preview_url == null ? null : text(item.previewUrl ?? item.preview_url),
  };
}

export function normalizeAccountVoices(value: unknown): AccountVoice[] {
  const payload = unwrap(value);
  const source = isRecord(payload) ? payload.voices ?? payload.items : payload;
  return array(source).map(normalizeAccountVoice);
}

function stringList(value: unknown): string[] {
  return array(value).map((item) => {
    if (!isRecord(item)) return text(item);
    return [item.language, item.locale, item.accent]
      .map((part) => text(part))
      .filter(Boolean)
      .join(" · ");
  }).filter(Boolean);
}

export function normalizeSharedVoice(value: unknown, index = 0): SharedVoice {
  const item = record(value);
  const rateValue = item.rate ?? item.noticePeriod ?? item.notice_period;
  return {
    publicOwnerId: text(item.publicOwnerId ?? item.public_owner_id ?? item.ownerId ?? item.owner_id),
    voiceId: text(item.voiceId ?? item.voice_id ?? item.id, `shared-voice-${index + 1}`),
    name: text(item.name, "Unnamed voice"),
    accent: text(item.accent),
    gender: text(item.gender),
    age: text(item.age),
    descriptive: stringList(item.descriptive ?? item.descriptives),
    useCase: stringList(item.useCase ?? item.use_case ?? item.useCases ?? item.use_cases),
    category: text(item.category),
    language: text(item.language),
    locale: item.locale == null ? null : text(item.locale),
    description: text(item.description),
    previewUrl: item.previewUrl == null && item.preview_url == null ? null : text(item.previewUrl ?? item.preview_url),
    verifiedLanguages: stringList(item.verifiedLanguages ?? item.verified_languages),
    featured: boolean(item.featured),
    freeUsersAllowed: boolean(item.freeUsersAllowed ?? item.free_users_allowed),
    liveModerationEnabled: boolean(item.liveModerationEnabled ?? item.live_moderation_enabled),
    rate: rateValue == null ? null : number(rateValue),
  };
}

export function normalizeSharedVoicePage(value: unknown, fallbackPage = 0, fallbackPageSize = 24): SharedVoicePage {
  const payload = record(unwrap(value));
  const voices = array(payload.voices ?? payload.items).map(normalizeSharedVoice);
  const totalValue = payload.totalCount ?? payload.total_count ?? payload.total;
  return {
    voices,
    page: number(payload.page, fallbackPage),
    pageSize: number(payload.pageSize ?? payload.page_size, fallbackPageSize),
    hasMore: boolean(payload.hasMore ?? payload.has_more),
    totalCount: totalValue == null ? null : number(totalValue),
  };
}

export function normalizeHealth(value: unknown): HealthStatus {
  const payload = record(unwrap(value));
  const database = record(payload.database);
  const provider = record(payload.provider);
  const providerMode = payload.providerMode ?? payload.mode ?? provider.mode;
  return {
    ok: boolean(payload.ok, true),
    server: "online",
    database:
      payload.database === "ready" || payload.database === "connected" || boolean(database.ok)
        ? "ready"
        : "unavailable",
    providerMode:
      (providerMode === "live" || providerMode === "elevenlabs") && provider.configured !== false
        ? "live"
        : providerMode === "mock"
          ? "mock"
          : "unconfigured",
    version: text(payload.version, "local"),
  };
}

export function normalizeDashboard(value: unknown): DashboardData {
  const payload = record(unwrap(value));
  const counts = record(payload.counts ?? payload.summary ?? payload.stats);
  const activeBatch = payload.activeBatch ?? payload.active_batch;
  return {
    imported: number(counts.imported ?? counts.totalPhrases ?? payload.imported),
    kept: number(counts.kept ?? counts.approved ?? payload.kept),
    discarded: number(counts.discarded ?? counts.rejected ?? payload.discarded),
    pending: number(counts.pending ?? payload.pending),
    audioReady: number(counts.audioReady ?? counts.audio_ready ?? counts.audioTakes ?? payload.audioReady),
    exportReady: number(counts.exportReady ?? counts.export_ready ?? payload.exportReady),
    activeBatch: activeBatch == null ? null : normalizeTtsBatch(activeBatch),
    recentImports: array(payload.recentImports ?? payload.recent_imports).map((item, index) => {
      const source = record(item);
      return {
        id: text(source.id, `import-${index + 1}`),
        fileName: text(source.fileName ?? source.file_name, "phrase-batch.csv"),
        importedCount: number(source.importedCount ?? source.imported_count ?? source.insertedRows ?? source.rows),
        createdAt: text(source.createdAt ?? source.created_at, now()),
      };
    }),
  };
}

function productionMode(value: unknown): ProductionMode {
  return value === "calibration" || value === "regeneration" ? value : "first_pass";
}

export function normalizePreflight(value: unknown, mode: ProductionMode): ProductionPreflight {
  const payload = record(unwrap(value));
  return {
    mode: productionMode(payload.mode ?? mode),
    eligiblePhrases: number(payload.eligiblePhrases ?? payload.eligible_phrases ?? payload.eligible ?? payload.phraseCount),
    skippedPhrases: number(payload.skippedPhrases ?? payload.skipped_phrases ?? payload.skipped),
    totalRequests: number(payload.totalRequests ?? payload.total_requests ?? payload.jobs ?? payload.newJobs),
    totalCharacters: number(payload.totalCharacters ?? payload.total_characters ?? payload.characters),
    cachedRequests: number(payload.cachedRequests ?? payload.cached_requests ?? payload.cached ?? payload.reusedJobs),
    estimatedCredits:
      payload.estimatedCredits == null && payload.estimated_credits == null && payload.estimatedUnits == null
        ? null
        : number(payload.estimatedCredits ?? payload.estimated_credits ?? payload.estimatedUnits),
    warnings: array(payload.warnings ?? payload.blockingReasons).map((warning) => text(warning)).filter(Boolean),
    canStart: boolean(payload.canStart ?? payload.can_start ?? payload.allowed, true),
  };
}

export function normalizeTtsBatch(value: unknown): TtsBatch {
  const payload = record(unwrap(value));
  const counts = record(payload.counts ?? payload.progress);
  const statusValue = text(payload.status, "queued");
  const allowedStatuses = new Set([
    "draft",
    "queued",
    "running",
    "retry_wait",
    "succeeded",
    "failed",
    "partial",
    "canceled",
  ]);
  const status = allowedStatuses.has(statusValue) ? (statusValue as TtsBatch["status"]) : "queued";
  return {
    id: text(payload.id),
    projectId: text(payload.projectId ?? payload.project_id),
    mode: productionMode(payload.mode),
    status,
    totalJobs: number(payload.totalJobs ?? payload.total_jobs ?? counts.total),
    completedJobs: number(payload.completedJobs ?? payload.completed_jobs ?? counts.completed ?? counts.succeeded),
    failedJobs: number(payload.failedJobs ?? payload.failed_jobs ?? counts.failed),
    queuedJobs: number(payload.queuedJobs ?? payload.queued_jobs ?? counts.queued),
    runningJobs: number(payload.runningJobs ?? payload.running_jobs ?? counts.running),
    activeRequests: number(payload.activeRequests ?? payload.active_requests ?? counts.active),
    characters: number(payload.characters ?? payload.totalCharacters),
    createdAt: text(payload.createdAt ?? payload.created_at, now()),
    updatedAt: text(payload.updatedAt ?? payload.updated_at, now()),
    lastError:
      payload.lastError == null && payload.last_error == null ? null : text(payload.lastError ?? payload.last_error),
  };
}

export function normalizeAudioTake(value: unknown, index = 0): AudioTake {
  const item = record(value);
  return {
    id: text(item.id ?? item.takeId ?? item.take_id, `take-${index + 1}`),
    phraseId: text(item.phraseId ?? item.phrase_id),
    takeNumber: number(item.takeNumber ?? item.take_number, index + 1),
    durationMs:
      item.durationMs == null && item.duration_ms == null ? null : number(item.durationMs ?? item.duration_ms),
    seed: item.seed == null ? null : number(item.seed),
    decision: decision(item.decision ?? item.reviewDecision ?? item.review_decision ?? item.reviewStatus),
    isPrimary: boolean(item.isPrimary ?? item.is_primary ?? item.primary, item.reviewStatus === "primary"),
    voiceProfileVersion: number(item.voiceProfileVersion ?? item.voice_profile_version ?? item.profileVersion, 1),
    settingsLabel: text(item.settingsLabel ?? item.settings_label, "Production recipe"),
    createdAt: text(item.createdAt ?? item.created_at, now()),
  };
}

function normalizeReviewItem(value: unknown, index = 0): ReviewItem {
  const item = record(value);
  const phraseValue = item.phrase ?? item;
  const phrase = normalizePhrase(phraseValue, index);
  const takes = array(item.takes ?? item.audioTakes ?? item.audio_takes).map(normalizeAudioTake);
  return { phrase, takes };
}

export function normalizeReviewPage(value: unknown): ReviewPage {
  const payload = unwrap(value);
  const root = record(payload);
  const pagination = record(root.pagination ?? root.meta);
  const source = root.items ?? root.phrases ?? (Array.isArray(payload) ? payload : []);
  const items = array(source).map(normalizeReviewItem);
  const counts = record(root.counts);
  return {
    items,
    page: number(root.page ?? pagination.page, 1),
    pageSize: number(root.pageSize ?? root.page_size ?? pagination.pageSize, Math.max(items.length, 1)),
    total: number(root.total ?? pagination.total, items.length),
    counts: {
      pending: number(counts.pending, items.filter((item) => item.phrase.decision === "pending").length),
      kept: number(counts.kept ?? counts.approved, items.filter((item) => item.phrase.decision === "kept").length),
      discarded: number(
        counts.discarded ?? counts.rejected,
        items.filter((item) => item.phrase.decision === "discarded").length,
      ),
    },
  };
}

export function normalizeImportPreview(value: unknown, fileName: string): ImportPreview {
  const payload = record(unwrap(value));
  const summary = record(payload.summary);
  const sourceRows = array(payload.rows ?? payload.items ?? payload.preview ?? payload.sample);
  const issues = array(payload.issues);
  const issuesByRow = new Map<number, string[]>();
  for (const issueValue of issues) {
    const issue = record(issueValue);
    const rowNumber = number(issue.sourceRow ?? issue.source_row ?? issue.row, -1);
    if (rowNumber < 0) continue;
    const message = text(issue.message ?? issue.code, "Import issue");
    issuesByRow.set(rowNumber, [...(issuesByRow.get(rowNumber) ?? []), message]);
  }
  const rows = sourceRows.map((rowValue, index) => {
    const item = record(rowValue);
    const phrase = normalizePhrase(item.phrase ?? item, index);
    const sourceRow = number(item.sourceRow ?? item.source_row, phrase.sourceRow);
    const rowWarnings = array(item.warnings).map((warning) => isRecord(warning) ? text(warning.message ?? warning.code) : text(warning)).filter(Boolean);
    const rowIssues = [...(issuesByRow.get(sourceRow) ?? []), ...rowWarnings];
    const statusValue = text(item.status, "valid");
    const status =
      statusValue === "invalid" || statusValue === "error" || issuesByRow.has(sourceRow)
        ? "invalid"
        : statusValue === "duplicate" || rowWarnings.some((warning) => /duplicate|collision/i.test(warning))
          ? "duplicate"
          : "valid";
    return {
      sourceRow,
      externalId: text(item.externalId ?? item.external_id, phrase.externalId),
      displayText: text(item.displayText ?? item.display_text ?? item.text, phrase.displayText),
      synthesisText:
        item.synthesisText == null && item.synthesis_text == null
          ? phrase.synthesisText
          : text(item.synthesisText ?? item.synthesis_text),
      groupCode: text(item.groupCode ?? item.group_code, phrase.groupCode),
      category: text(item.category, phrase.category),
      tone: text(item.tone),
      englishMeaning: text(item.englishMeaning ?? item.english_meaning),
      notes: text(item.notes, phrase.notes),
      status,
      issue: rowIssues[0] ?? (item.issue == null && item.error == null ? null : text(item.issue ?? item.error)),
    } as const;
  });
  return {
    fileName: text(payload.fileName ?? payload.file_name, fileName),
    fileType: text(payload.fileType ?? payload.file_type, fileName.split(".").pop()?.toUpperCase() ?? "FILE"),
    totalRows: number(payload.totalRows ?? payload.total_rows ?? summary.total, rows.length),
    validRows: number(
      payload.validRows ?? payload.valid_rows ?? summary.valid,
      rows.filter((row) => row.status === "valid").length,
    ),
    duplicateRows: number(
      payload.duplicateRows ?? payload.duplicate_rows ?? payload.duplicateTextRows ?? summary.duplicates,
      rows.filter((row) => row.status === "duplicate").length,
    ),
    invalidRows: number(
      payload.invalidRows ?? payload.invalid_rows ?? summary.invalid,
      rows.filter((row) => row.status === "invalid").length,
    ),
    detectedFields: array(payload.detectedFields ?? payload.detected_fields ?? payload.headers).map((field) => text(field)),
    warnings: [
      ...array(payload.warnings).map((warning) => isRecord(warning) ? text(warning.message ?? warning.code) : text(warning)),
      ...issues.map((warning) => isRecord(warning) ? text(warning.message ?? warning.code) : text(warning)),
    ].filter(Boolean),
    rows,
  };
}

export function normalizeImportResult(value: unknown): ImportResult {
  const payload = record(unwrap(value));
  const summary = record(payload.summary);
  return {
    id: text(payload.id ?? payload.importId ?? payload.import_id),
    importedCount: number(payload.importedCount ?? payload.imported_count ?? payload.insertedRows ?? summary.imported),
    duplicateCount: number(
      payload.duplicateCount
        ?? payload.duplicate_count
        ?? summary.duplicates
        ?? Math.max(0, number(payload.skippedRows) - number(payload.errorRows)),
    ),
    invalidCount: number(payload.invalidCount ?? payload.invalid_count ?? payload.errorRows ?? summary.invalid),
    status: text(payload.status, "complete"),
  };
}

export function normalizeExportPreview(value: unknown): ExportPreview {
  const payload = record(unwrap(value));
  const messageText = (item: unknown): string => isRecord(item) ? text(item.message) : text(item);
  return {
    eligibleAssets: number(payload.eligibleAssets ?? payload.eligible_assets ?? payload.assetCount),
    excludedPhrases: number(payload.excludedPhrases ?? payload.excluded_phrases ?? payload.excluded),
    totalDurationMs: number(payload.totalDurationMs ?? payload.total_duration_ms),
    totalBytes: number(payload.totalBytes ?? payload.total_bytes),
    errors: array(payload.errors).map(messageText).filter(Boolean),
    warnings: array(payload.warnings).map(messageText).filter(Boolean),
    canExport: boolean(payload.canExport ?? payload.can_export ?? payload.valid, true),
    sampleFiles: array(payload.sampleFiles ?? payload.sample_files ?? payload.files ?? payload.assets)
      .map((item) => (isRecord(item) ? text(item.src ?? item.path ?? item.fileName) : text(item)))
      .filter(Boolean)
      .slice(0, 8),
  };
}

export function normalizeExportRecord(value: unknown, index = 0): ExportRecord {
  const item = record(value);
  const rawStatus = text(item.status, "ready");
  const status = rawStatus === "failed" ? "failed" : rawStatus === "creating" || rawStatus === "queued" ? "creating" : "ready";
  return {
    id: text(item.id, `export-${index + 1}`),
    label: text(item.label ?? item.name, "Frase Uno audio export"),
    status,
    itemCount: number(item.itemCount ?? item.item_count ?? item.assetCount),
    totalBytes: number(item.totalBytes ?? item.total_bytes),
    path: text(item.path ?? item.folderPath ?? item.folder_path),
    createdAt: text(item.createdAt ?? item.created_at, now()),
  };
}

export function normalizeExports(value: unknown): ExportRecord[] {
  const payload = unwrap(value);
  const source = isRecord(payload) ? payload.exports ?? payload.items : payload;
  return array(source).map(normalizeExportRecord);
}

export function normalizeUsage(value: unknown): UsageSummary {
  const payload = record(unwrap(value));
  const local = record(payload.local);
  const remote = record(payload.remote);
  const included = payload.includedCharacters ?? payload.included_characters ?? payload.limit ?? remote.limit;
  const remaining = payload.remainingCharacters ?? payload.remaining_characters ?? payload.remaining ?? remote.remaining;
  const periodEnd = payload.periodEndsAt ?? payload.period_ends_at ?? remote.resetsAt;
  return {
    provider: text(payload.provider, "ElevenLabs"),
    usedCharacters: number(payload.usedCharacters ?? payload.used_characters ?? payload.used ?? remote.used ?? local.actual ?? local.estimated),
    includedCharacters: included == null ? null : number(included),
    remainingCharacters: remaining == null ? null : number(remaining),
    periodEndsAt: periodEnd == null ? null : text(periodEnd),
    totalRequests: number(payload.totalRequests ?? payload.total_requests ?? payload.requests ?? local.requests),
  };
}
