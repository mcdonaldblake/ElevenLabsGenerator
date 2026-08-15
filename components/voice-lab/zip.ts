import type { PhraseJob, VoiceRecipe } from "./types";

type ZipEntry = { name: string; data: Uint8Array<ArrayBuffer> };

const encoder = new TextEncoder();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function concat(chunks: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

export function createStoredZip(entries: ZipEntry[], modifiedAt = new Date()): Blob {
  const localChunks: Uint8Array<ArrayBuffer>[] = [];
  const centralChunks: Uint8Array<ArrayBuffer>[] = [];
  const { date, time } = dosDateTime(modifiedAt);
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, time);
    write16(localView, 12, date);
    write32(localView, 14, checksum);
    write32(localView, 18, entry.data.length);
    write32(localView, 22, entry.data.length);
    write16(localView, 26, name.length);
    local.set(name, 30);
    localChunks.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, time);
    write16(centralView, 14, date);
    write32(centralView, 16, checksum);
    write32(centralView, 20, entry.data.length);
    write32(centralView, 24, entry.data.length);
    write16(centralView, 28, name.length);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralChunks.push(central);
    localOffset += local.length + entry.data.length;
  }

  const centralDirectory = concat(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 8, entries.length);
  write16(endView, 10, entries.length);
  write32(endView, 12, centralDirectory.length);
  write32(endView, 16, localOffset);
  const archive = concat([...localChunks, centralDirectory, end]);
  return new Blob([archive.buffer], { type: "application/zip" });
}

export function sanitizeFilename(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function audioFilename(job: Pick<PhraseJob, "filename" | "id" | "sequence">): string {
  const fallback = String(job.sequence).padStart(4, "0");
  return `${sanitizeFilename(job.filename || job.id, fallback).replace(/\.mp3$/i, "")}.mp3`;
}

function csvCell(value: string | number): string {
  const serialized = String(value);
  return /[",\r\n]/.test(serialized) ? `"${serialized.replaceAll('"', '""')}"` : serialized;
}

export async function buildAudioExport(jobs: PhraseJob[]): Promise<Blob> {
  const ready = jobs.filter((job): job is PhraseJob & { audio: Blob } => job.status === "ready" && job.audio !== null);
  if (ready.length === 0) throw new Error("There are no completed clips to export.");
  const recipes = new Set(ready.map((job) => job.recipeSnapshot == null ? "" : JSON.stringify(job.recipeSnapshot)));
  if (recipes.size !== 1 || ready[0]?.recipeSnapshot == null) {
    throw new Error("This selection contains clips made with different recipes. Export one generated chunk at a time.");
  }
  const recipe: VoiceRecipe = ready[0].recipeSnapshot;
  const usedNames = new Set<string>();
  const manifest = [];
  const entries: ZipEntry[] = [];

  for (let index = 0; index < ready.length; index += 1) {
    const job = ready[index] as PhraseJob & { audio: Blob };
    const baseFilename = audioFilename(job);
    const base = baseFilename.replace(/\.mp3$/i, "");
    let filename = baseFilename;
    let suffix = 2;
    while (usedNames.has(filename.toLocaleLowerCase())) {
      filename = `${base}-${suffix}.mp3`;
      suffix += 1;
    }
    usedNames.add(filename.toLocaleLowerCase());
    entries.push({ name: `audio/${filename}`, data: new Uint8Array(await job.audio.arrayBuffer()) });
    manifest.push({ index: job.sequence, id: job.id, filename, text: job.text, recipeFingerprint: job.recipeFingerprint });
  }

  const csv = [
    ["index", "id", "filename", "text", "recipe_fingerprint"],
    ...manifest.map((row) => [row.index, row.id, row.filename, row.text, row.recipeFingerprint ?? ""]),
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
  entries.push(
    { name: "manifest.csv", data: encoder.encode(`${csv}\r\n`) },
    { name: "manifest.json", data: encoder.encode(JSON.stringify({ generatedAt: new Date().toISOString(), phrases: manifest }, null, 2)) },
    { name: "recipe.json", data: encoder.encode(JSON.stringify(recipe, null, 2)) },
  );
  return createStoredZip(entries);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded" | "canceled"> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "canceled";
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
