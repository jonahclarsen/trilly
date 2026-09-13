import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const favicon = new URL('../public/favicon.svg', import.meta.url);
const directory = new URL('../chromium-extension/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(fileURLToPath(favicon), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`icon-${size}.png`, directory)));
}
