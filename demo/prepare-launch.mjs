import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, "public");
await fs.mkdir(publicDirectory, { recursive: true });
for (const [input, output] of [
  ["assets/launch-track.mp3", "launch-track.mp3"],
]) await fs.copyFile(path.join(directory, input), path.join(publicDirectory, output));

await fs.cp(path.resolve(directory, "../docs/launch-assets"), path.join(publicDirectory, "launch-assets"), { recursive: true });
