/**
 * Generates PWA app icons (PNG) from client/public/app-icon.svg using sharp.
 * Run: node scripts/gen-icons.mjs
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "client/public/app-icon.svg");
const outDir = path.join(root, "client/public/icons");
fs.mkdirSync(outDir, { recursive: true });

const svg = fs.readFileSync(src);
const targets = [
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 32, name: "favicon-32.png" },
];

for (const { size, name } of targets) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "cover" })
    .png()
    .toFile(path.join(outDir, name));
  console.log("  ✓", name, `(${size}px)`);
}
console.log("Icons written to client/public/icons/");
