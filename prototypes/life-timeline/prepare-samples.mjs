import { writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

await mkdir(new URL('./public/photos/', import.meta.url), { recursive: true });
const ids = [10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46];
let next = 0;
const credits = [];
const tiles = [];
await Promise.all(Array.from({ length: 5 }, async () => {
  while (next < ids.length) {
    const slot = next++;
    const source = `https://picsum.photos/id/${ids[slot]}/600/450`;
    const response = await fetch(source, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`Sample ${ids[slot]}: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await sharp(buffer).jpeg({ quality: 82 }).toFile(fileURLToPath(new URL(`./public/photos/${slot}.jpg`, import.meta.url)));
    tiles.push({ input: await sharp(buffer).resize(128, 128, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer(), left: (slot % 6) * 128, top: Math.floor(slot / 6) * 128 });
    credits[slot] = { slot, source, provider: 'Lorem Picsum / Unsplash', metadata: 'All dates, titles, places, flags, and camera labels in the prototype are generated examples.' };
    console.log(`Prepared sample ${slot + 1}/${ids.length}`);
  }
}));
await sharp({ create: { width: 768, height: 768, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite(tiles).jpeg({ quality: 88 }).toFile(fileURLToPath(new URL('./public/overview.jpg', import.meta.url)));
await writeFile(new URL('./public/sample-credits.json', import.meta.url), JSON.stringify(credits, null, 2));
console.log('Created 36-photo demo atlas. Sample photos repeat across 20,000 generated records.');
