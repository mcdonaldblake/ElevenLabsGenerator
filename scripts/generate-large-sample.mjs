import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const requestedCount = Number.parseInt(process.argv[2] ?? "10000", 10);
const count = Number.isSafeInteger(requestedCount) && requestedCount > 0
  ? Math.min(requestedCount, 100_000)
  : 10_000;
const outputPath = resolve(process.argv[3] ?? `samples/phrases-${count}.csv`);

await mkdir(dirname(outputPath), { recursive: true });
const stream = createWriteStream(outputPath, { encoding: "utf8", flags: "wx" });

stream.write("id,text,group,category,notes\n");
for (let index = 1; index <= count; index += 1) {
  const padded = String(index).padStart(6, "0");
  stream.write(`sample-${padded},\"Frase de prueba número ${index}.\",large-sample,test,\"Fila ${index}\"\n`);
}

await new Promise((resolvePromise, reject) => {
  stream.once("error", reject);
  stream.end(resolvePromise);
});

process.stdout.write(`Created ${outputPath} with ${count} phrases.\n`);
