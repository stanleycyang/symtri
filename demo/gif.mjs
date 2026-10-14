import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const exec = promisify(execFile);
await fs.mkdir("docs", { recursive: true });

const input = "docs/demo.mp4";
const palette = "demo/out/palette.png";
try {
await exec("ffmpeg", ["-y", "-i", input, "-vf", "fps=8,scale=720:-1:flags=lanczos,palettegen", palette]);
await exec("ffmpeg", ["-y", "-i", input, "-i", palette, "-lavfi", "fps=8,scale=720:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=floyd_steinberg", "-r", "8", "docs/demo.gif"]);
  console.log("GIF saved to docs/demo.gif");
} catch (error) {
  console.error("Failed to render GIF:", error);
  process.exitCode = 1;
}

