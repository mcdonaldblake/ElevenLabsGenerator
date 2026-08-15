import { describe, expect, it } from "vitest";
import { parseDelimited, parsePhraseContent } from "./import-parser";

describe("phrase import parser", () => {
  it("parses quoted CSV cells and identifies duplicates", () => {
    const preview = parsePhraseContent(
      'id,phrase,group,notes\nwelcome-1,"Muy bien, seguimos.",correct_continue,"Short, warm"\nwelcome-2,Muy bien seguimos,correct_continue,Duplicate wording',
      "phrases.csv",
    );

    expect(preview.totalRows).toBe(2);
    expect(preview.validRows).toBe(1);
    expect(preview.duplicateRows).toBe(1);
    expect(preview.rows[0]?.notes).toBe("Short, warm");
  });

  it("supports JSON string arrays and object arrays", () => {
    const strings = parsePhraseContent('["Eso es.", "Seguimos."]', "short.json");
    const objects = parsePhraseContent(
      JSON.stringify({ phrases: [{ id: "a-1", text: "Vamos con la siguiente.", category: "continue" }] }),
      "rich.json",
    );

    expect(strings.validRows).toBe(2);
    expect(objects.rows[0]).toMatchObject({
      externalId: "a-1",
      displayText: "Vamos con la siguiente.",
      category: "continue",
    });
  });

  it("preserves newlines and escaped quotes in quoted values", () => {
    expect(parseDelimited('phrase,notes\n"Muy\nbien","She said ""yes"""', ",")).toEqual([
      ["phrase", "notes"],
      ["Muy\nbien", 'She said "yes"'],
    ]);
  });

  it("treats plain text as one phrase per non-empty line", () => {
    const preview = parsePhraseContent("Eso es.\n\nAdelante.\n", "phrases.txt");
    expect(preview.rows.map((row) => row.displayText)).toEqual(["Eso es.", "Adelante."]);
  });
});
