import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type DatabaseContext } from "../db/client.js";
import { testConfig } from "../test-helpers.js";
import { ImportService, parseImportFile } from "./imports.js";

describe("phrase imports", () => {
  const cleanups: Array<() => void> = [];
  let database: DatabaseContext | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
    while (cleanups.length) cleanups.pop()?.();
  });

  it("parses every supported human-authored file shape", () => {
    const csv = parseImportFile(Buffer.from("id,phrase,group,notes\na,Hola,opening,warm\n"), "phrases.csv", 10);
    const tsv = parseImportFile(Buffer.from("text\ttone\nSeguimos\tcalm\n"), "phrases.tsv", 10);
    const text = parseImportFile(Buffer.from("Uno\n\nDos\n"), "phrases.txt", 10);
    const json = parseImportFile(Buffer.from(JSON.stringify({ phrases: ["Tres", { displayText: "Cuatro", synthesisText: "Cua-tro" }] })), "phrases.json", 10);
    expect(csv.rows[0]).toMatchObject({ suppliedId: "a", displayText: "Hola", groupCode: "opening", notes: "warm" });
    expect(tsv.rows[0]).toMatchObject({ displayText: "Seguimos", tone: "calm" });
    expect(text.rows.map((row) => [row.sourceRow, row.displayText])).toEqual([[1, "Uno"], [3, "Dos"]]);
    expect(json.rows[1]).toMatchObject({ displayText: "Cuatro", synthesisText: "Cua-tro" });
  });

  it("keeps duplicate wording advisory but makes re-import idempotent by stable ID", () => {
    const setup = testConfig();
    cleanups.push(setup.cleanup);
    database = openDatabase(setup.config);
    const now = new Date().toISOString();
    database.sqlite.prepare("INSERT INTO projects (id, name, description, created_at, updated_at) VALUES ('project_1', 'Test', '', ?, ?)").run(now, now);
    const service = new ImportService(database, 100);
    const file = Buffer.from("id,text\na,Igual\nb,¡Igual!\n");
    const preview = service.preview(file, "phrases.csv", "project_1");
    expect(preview.duplicateTextRows).toBe(1);
    const first = service.commit(file, "phrases.csv", "project_1");
    expect(first).toMatchObject({ insertedRows: 2, skippedRows: 0 });
    const reimportPreview = service.preview(file, "phrases.csv", "project_1");
    expect(reimportPreview).toMatchObject({ validRows: 0, importableRows: 0, stableIdCollisions: 2 });
    const second = service.commit(file, "phrases.csv", "project_1");
    expect(second).toMatchObject({ insertedRows: 0, skippedRows: 2 });
    expect((database.sqlite.prepare("SELECT COUNT(*) AS value FROM phrases").get() as { value: number }).value).toBe(2);
  });
});
