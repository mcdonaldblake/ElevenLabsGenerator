import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseMultiline, parsePhraseContent, parsePhraseFile } from "./import";

describe("browser-only phrase imports", () => {
  it("turns each nonempty pasted or TXT line into one phrase", () => {
    const pasted = parseMultiline(" First line \n\n  \nSecond line\n");
    const txt = parsePhraseContent("Uno\n\nDos\n", "phrases.txt");

    expect(pasted.rows.map((row) => row.text)).toEqual(["First line", "Second line"]);
    expect(pasted.invalidRows).toBe(0);
    expect(txt.rows.map((row) => row.text)).toEqual(["Uno", "Dos"]);
  });

  it("reads quoted CSV fields and generic id/filename aliases", () => {
    const preview = parsePhraseContent(
      'id,filename,phrase\nwelcome,welcome-home,"Hello, there"\nbye,,Goodbye',
      "phrases.csv",
    );

    expect(preview.validRows).toBe(2);
    expect(preview.rows[0]).toMatchObject({ id: "welcome", filename: "welcome-home", text: "Hello, there", sourceRow: 2 });
    expect(preview.rows[1]).toMatchObject({ id: "bye", filename: "", text: "Goodbye", sourceRow: 3 });
  });

  it("reads TSV and JSON phrase arrays", () => {
    const tsv = parsePhraseContent("filename\ttext\nstart\tStart now", "phrases.tsv");
    const json = parsePhraseContent(JSON.stringify({ phrases: [{ id: "one", text: "One" }, "Two"] }), "phrases.json");

    expect(tsv.rows[0]).toMatchObject({ filename: "start", text: "Start now" });
    expect(json.rows.map((row) => [row.id, row.text])).toEqual([["one", "One"], ["", "Two"]]);
  });

  it("marks normalized repeats from the file and current tab as duplicates", () => {
    const preview = parsePhraseContent("text\nHello!\n hello \nAlready here", "phrases.csv", ["Already here."]);

    expect(preview.rows.map((row) => row.status)).toEqual(["valid", "duplicate", "duplicate"]);
    expect(preview.duplicateRows).toBe(2);
  });

  it("keeps an empty structured text field visible as invalid", () => {
    const preview = parsePhraseContent("id,text\nempty,\nready,Ready", "phrases.csv");

    expect(preview.rows[0]).toMatchObject({ id: "empty", status: "invalid", issue: "Text is empty" });
    expect(preview.invalidRows).toBe(1);
  });

  it("rejects a phrase longer than the speech endpoint limit", () => {
    const preview = parsePhraseContent(JSON.stringify([{ id: "too-long", text: "x".repeat(5_001) }]), "phrases.json");
    expect(preview.rows[0]).toMatchObject({ status: "invalid", issue: "Text exceeds 5,000 characters" });
    expect(preview.validRows).toBe(0);
  });

  it("enforces file type, row, and byte limits", async () => {
    expect(() => parsePhraseContent("hello", "phrases.xml")).toThrow(/TXT, CSV, TSV, or JSON/);
    expect(() => parsePhraseContent("x\n".repeat(MAX_IMPORT_ROWS + 1), "phrases.txt")).toThrow(/100,000 rows/);

    const oversized = new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "phrases.txt", { type: "text/plain" });
    await expect(parsePhraseFile(oversized)).rejects.toThrow(/25 MB/);
  });
});
