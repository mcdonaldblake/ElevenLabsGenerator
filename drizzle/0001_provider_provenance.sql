ALTER TABLE `tts_jobs` ADD `provider` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `audio_takes` ADD `provider` text DEFAULT 'legacy' NOT NULL;
