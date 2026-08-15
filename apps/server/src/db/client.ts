import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ServerConfig } from "../config.js";
import * as schema from "./schema.js";

export type DatabaseContext = {
  sqlite: BetterSqlite3.Database;
  orm: BetterSQLite3Database<typeof schema>;
  close: () => void;
};

function migrate(sqlite: BetterSqlite3.Database, migrationsRoot: string): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = sqlite.prepare("SELECT 1 FROM app_migrations WHERE name = ?");
  const record = sqlite.prepare("INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)");
  const migrationFiles = readdirSync(migrationsRoot)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of migrationFiles) {
    if (applied.get(name)) continue;
    const contents = readFileSync(join(migrationsRoot, name), "utf8");
    const statements = contents
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    sqlite.transaction(() => {
      for (const statement of statements) sqlite.exec(statement);
      record.run(name, new Date().toISOString());
    })();
  }
}

export function openDatabase(config: ServerConfig): DatabaseContext {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const sqlite = new BetterSqlite3(config.databasePath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  migrate(sqlite, config.migrationsRoot);
  const orm = drizzle(sqlite, { schema });
  return { sqlite, orm, close: () => sqlite.close() };
}
