import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(frontendRoot, "public/brand/syllogic-mark.png");
const destination = path.join(frontendRoot, "public/icons");

await mkdir(destination, { recursive: true });

await Promise.all([
  sharp(source).resize(192, 192).png().toFile(path.join(destination, "pwa-192x192.png")),
  sharp(source).resize(512, 512).png().toFile(path.join(destination, "pwa-512x512.png")),
  sharp(source)
    .resize(390, 390)
    .extend({ top: 61, bottom: 61, left: 61, right: 61, background: "#000000" })
    .png()
    .toFile(path.join(destination, "pwa-maskable-512x512.png")),
  sharp(source).resize(180, 180).png().toFile(path.join(destination, "apple-touch-icon.png")),
]);
