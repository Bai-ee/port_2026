import { Assets, type Texture } from 'pixi.js';
import type { GetTexture } from './types';

const P = '/playroom/assets/sprites/';

/** PNG sprites keyed by asset id (id == filename without extension). */
const PNG_IDS = [
  'ponytail_stand', 'ponytail_seated', 'cap_stand', 'cap_seated', 'crown_stand', 'crown_seated',
  'armchair', 'sofa', 'table', 'nightstand', 'lamp_off', 'lamp_on', 'door_closed', 'door_open',
  'window', 'rug', 'plant', 'frame_heart', 'frame_picture', 'bunting',
  'teddy', 'duck', 'blocks', 'toy_car', 'storybook', 'apple', 'cookie', 'mug', 'beach_ball', 'guitar', 'cat', 'dog',
];

/** asset id -> URL. Swap art by editing only this table. */
const MANIFEST: Record<string, string> = { room_bg: P + 'room_bg.svg' };
for (const id of PNG_IDS) MANIFEST[id] = P + id + '.png';

export async function loadAssets(onProgress?: (p: number) => void): Promise<void> {
  const ids = Object.keys(MANIFEST);
  for (const id of ids) {
    // SVG background is authored at stage size; give it 2x raster resolution. PNGs load at 1x.
    Assets.add({ alias: id, src: MANIFEST[id], data: id === 'room_bg' ? { resolution: 2 } : {} });
  }
  await Assets.load(ids, onProgress);
}

export const getTexture: GetTexture = (assetId: string): Texture => {
  if (!(assetId in MANIFEST)) throw new Error(`Unknown asset id "${assetId}" (not in MANIFEST)`);
  const tex = Assets.get<Texture>(assetId);
  if (!tex) throw new Error(`Asset "${assetId}" is in the manifest but not loaded; call loadAssets() first`);
  return tex;
};
