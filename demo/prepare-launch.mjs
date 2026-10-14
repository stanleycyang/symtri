import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(directory, "public");
await fs.mkdir(publicDirectory, { recursive: true });
for (const [input, output] of [
  ["../docs/demo.mp4", "launch-demo-wide.mp4"],
  ["../docs/demo-square.mp4", "launch-demo-square.mp4"],
  ["assets/launch-track.mp3", "launch-track.mp3"],
]) await fs.copyFile(path.join(directory, input), path.join(publicDirectory, output));
