import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  splitting: false,
  clean: true,
  noExternal: [
    "@voice-foundry/domain",
    "@voice-foundry/schemas",
    "@voice-foundry/export-format",
  ],
});
