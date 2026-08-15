PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `projects` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imports` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `file_name` text NOT NULL,
  `format` text NOT NULL,
  `source_hash` text NOT NULL,
  `status` text NOT NULL,
  `total_rows` integer NOT NULL,
  `inserted_rows` integer NOT NULL,
  `skipped_rows` integer NOT NULL,
  `error_rows` integer NOT NULL,
  `summary_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `imports_project_created_idx` ON `imports` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `phrases` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `import_id` text REFERENCES `imports`(`id`) ON DELETE set null,
  `stable_id` text NOT NULL,
  `supplied_id` text,
  `source_hash` text NOT NULL,
  `source_row` integer NOT NULL,
  `display_text` text NOT NULL,
  `original_text` text NOT NULL,
  `synthesis_text` text,
  `normalized_text` text NOT NULL,
  `comparison_text` text NOT NULL,
  `group_code` text DEFAULT 'ungrouped' NOT NULL,
  `category` text DEFAULT '' NOT NULL,
  `tone` text DEFAULT '' NOT NULL,
  `english_meaning` text DEFAULT '' NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `decision` text DEFAULT 'pending' NOT NULL,
  `selected_take_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phrases_project_stable_uidx` ON `phrases` (`project_id`,`stable_id`);
--> statement-breakpoint
CREATE INDEX `phrases_project_normalized_idx` ON `phrases` (`project_id`,`normalized_text`);
--> statement-breakpoint
CREATE INDEX `phrases_project_decision_idx` ON `phrases` (`project_id`,`decision`);
--> statement-breakpoint
CREATE INDEX `phrases_search_idx` ON `phrases` (`project_id`,`display_text`);
--> statement-breakpoint
CREATE TABLE `phrase_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `phrase_id` text NOT NULL REFERENCES `phrases`(`id`) ON DELETE cascade,
  `display_text` text NOT NULL,
  `synthesis_text` text,
  `group_code` text NOT NULL,
  `category` text NOT NULL,
  `notes` text NOT NULL,
  `reason` text DEFAULT 'edit' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `phrase_revisions_phrase_created_idx` ON `phrase_revisions` (`phrase_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `voice_profile_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `label` text NOT NULL,
  `provider` text DEFAULT 'elevenlabs' NOT NULL,
  `version` integer NOT NULL,
  `voice_id` text NOT NULL,
  `voice_name` text DEFAULT '' NOT NULL,
  `model_id` text NOT NULL,
  `language_code` text,
  `output_format` text NOT NULL,
  `stability` real NOT NULL,
  `similarity_boost` real NOT NULL,
  `style` real NOT NULL,
  `speed` real NOT NULL,
  `use_speaker_boost` integer NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `locked_at` text,
  `is_production` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_profiles_project_version_uidx` ON `voice_profile_versions` (`project_id`,`version`);
--> statement-breakpoint
CREATE INDEX `voice_profiles_project_idx` ON `voice_profile_versions` (`project_id`);
--> statement-breakpoint
CREATE TABLE `tts_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `voice_profile_version_id` text NOT NULL REFERENCES `voice_profile_versions`(`id`),
  `mode` text NOT NULL,
  `status` text NOT NULL,
  `total_jobs` integer NOT NULL,
  `completed_jobs` integer DEFAULT 0 NOT NULL,
  `failed_jobs` integer DEFAULT 0 NOT NULL,
  `canceled_jobs` integer DEFAULT 0 NOT NULL,
  `total_characters` integer NOT NULL,
  `consecutive_failures` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `completed_at` text
);
--> statement-breakpoint
CREATE INDEX `tts_batches_project_created_idx` ON `tts_batches` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `tts_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL REFERENCES `tts_batches`(`id`) ON DELETE cascade,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `phrase_id` text NOT NULL REFERENCES `phrases`(`id`) ON DELETE cascade,
  `voice_profile_version_id` text NOT NULL REFERENCES `voice_profile_versions`(`id`),
  `fingerprint` text NOT NULL,
  `status` text NOT NULL,
  `synthesis_text` text NOT NULL,
  `voice_id` text NOT NULL,
  `model_id` text NOT NULL,
  `output_format` text NOT NULL,
  `language_code` text,
  `settings_json` text NOT NULL,
  `seed` integer NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 4 NOT NULL,
  `available_at` text NOT NULL,
  `started_at` text,
  `completed_at` text,
  `provider_request_id` text,
  `error_json` text,
  `reused_take_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tts_jobs_status_available_idx` ON `tts_jobs` (`status`,`available_at`);
--> statement-breakpoint
CREATE INDEX `tts_jobs_fingerprint_idx` ON `tts_jobs` (`fingerprint`,`status`);
--> statement-breakpoint
CREATE INDEX `tts_jobs_batch_idx` ON `tts_jobs` (`batch_id`);
--> statement-breakpoint
CREATE TABLE `audio_takes` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `phrase_id` text NOT NULL REFERENCES `phrases`(`id`) ON DELETE cascade,
  `job_id` text NOT NULL REFERENCES `tts_jobs`(`id`) ON DELETE restrict,
  `voice_profile_version_id` text NOT NULL REFERENCES `voice_profile_versions`(`id`),
  `take_number` integer NOT NULL,
  `file_path` text NOT NULL,
  `mime_type` text NOT NULL,
  `extension` text NOT NULL,
  `byte_size` integer NOT NULL,
  `duration_ms` integer,
  `sha256` text NOT NULL,
  `source` text DEFAULT 'tts' NOT NULL,
  `review_status` text DEFAULT 'pending' NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_takes_job_uidx` ON `audio_takes` (`job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_takes_file_uidx` ON `audio_takes` (`file_path`);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_takes_phrase_number_uidx` ON `audio_takes` (`phrase_id`,`take_number`);
--> statement-breakpoint
CREATE INDEX `audio_takes_phrase_review_idx` ON `audio_takes` (`phrase_id`,`review_status`);
--> statement-breakpoint
CREATE TABLE `usage_events` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `operation` text NOT NULL,
  `request_id` text,
  `estimated_units` integer,
  `actual_units` integer,
  `model_id` text,
  `job_id` text REFERENCES `tts_jobs`(`id`) ON DELETE set null,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_events_provider_created_idx` ON `usage_events` (`provider`,`created_at`);
--> statement-breakpoint
CREATE TABLE `exports` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `voice_profile_version_id` text NOT NULL REFERENCES `voice_profile_versions`(`id`),
  `label` text NOT NULL,
  `fingerprint` text NOT NULL,
  `status` text NOT NULL,
  `folder_path` text NOT NULL,
  `zip_path` text NOT NULL,
  `asset_count` integer NOT NULL,
  `total_bytes` integer NOT NULL,
  `report_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exports_project_fingerprint_uidx` ON `exports` (`project_id`,`fingerprint`);
--> statement-breakpoint
CREATE INDEX `exports_project_created_idx` ON `exports` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `app_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value_json` text NOT NULL,
  `updated_at` text NOT NULL
);
