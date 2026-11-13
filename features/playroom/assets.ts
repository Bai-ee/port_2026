import { Assets, type Texture } from 'pixi.js';
import type { GetTexture } from './types';

const P = '/playroom/assets/placeholder/';

/** asset id -> URL. Swap art by editing only this table. */
const MANIFEST: Record<string, string> = {
  room_bg: P + 'room_bg.svg',
  kid_a_stand: P + 'kid_a_stand.svg',
  kid_a_sit: P + 'kid_a_sit.svg',
  kid_b_stand: P + 'kid_b_stand.svg',
  kid_b_sit: P + 'kid_b_sit.svg',
  chair_back: P + 'chair_back.svg',
  chair_front: P + 'chair_front.svg',
  table: P + 'table.svg',
  lamp_off: P + 'lamp_off.svg',
  lamp_on: P + 'lamp_on.svg',
  ball: P + 'ball.svg',
  teddy: P + 'teddy.svg',
  book: P + 'book.svg',
  apple: P + 'apple.svg',
  cup: P + 'cup.svg',
  robot: P + 'robot.svg',
  blocks: P + 'blocks.svg',
  duck: P + 'duck.svg',
};

export async function loadAssets(onProgress?: (p: number) => void): Promise<void> {
  const ids = Object.keys(MANIFEST);
  for (const id of ids) {
    Assets.add({ alias: id, src: MANIFEST[id], data: { resolution: 2 } });
  }
  await Assets.load(ids, onProgress);
}

export const getTexture: GetTexture = (assetId: string): Texture => {
  if (!(assetId in MANIFEST)) throw new Error(`Unknown asset id "${assetId}" (not in MANIFEST)`);
  const tex = Assets.get<Texture>(assetId);
  if (!tex) throw new Error(`Asset "${assetId}" is in the manifest but not loaded; call loadAssets() first`);
  return tex;
};
