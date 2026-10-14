import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(directory, "out");
const publicDirectory = path.join(directory, "public");
await fs.mkdir(publicDirectory, { recursive: true });
const { clips } = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"));
for (const clip of clips) {
  await fs.copyFile(path.join(output, clip.file), path.join(publicDirectory, clip.file));
}
await fs.copyFile(path.join(output, "manifest.json"), path.join(publicDirectory, "manifest.json"));
