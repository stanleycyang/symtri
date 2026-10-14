import fs from "node:fs/promises";
import path from "node:path";

await fs.mkdir("public", { recursive: true });
const copies = [
  ["demo/out/raw-1600x1000.mp4", "public/demo-raw-1600x1000.mp4"],
  ["demo/out/raw-1080x1080.mp4", "public/demo-raw-1080x1080.mp4"],
  ["demo/assets/launch-track.mp3", "public/launch-track.mp3"],
];
for (const [from, to] of copies) {
  try {
    await fs.copyFile(path.resolve(from), path.resolve(to));
  } catch (error) {
    console.error("Missing input for render:", from);
    process.exitCode = 1;
  }
}

