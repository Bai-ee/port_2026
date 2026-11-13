import type { SceneDefinition, SceneObjectDefinition } from '../types';

const CHAR_SCALE = 0.8;

/** GameObject builds its hit area from UNSCALED sprite bounds, so scaled sprites get an oversized hit area.
 *  Compensate with a (negative) hitPad: want `want` px around the scaled sprite. */
const NATURAL_AVG: Record<string, number> = {
  teddy: 187, duck: 146, blocks: 125, toy_car: 171, storybook: 162, apple: 109, cookie: 98, mug: 103,
  beach_ball: 241, guitar: 296, cat: 181, dog: 205,
};
const padFor = (naturalAvg: number, scale: number, want: number) => Math.round(want - ((1 - scale) * naturalAvg) / 2);

const kid = (id: string, x: number, y: number): SceneObjectDefinition => ({
  id,
  type: 'character',
  sprites: { standing: `${id}_stand`, sitting: `${id}_seated` },
  initialState: 'standing',
  x, y,
  scale: CHAR_SCALE,
  hitPad: padFor(210, CHAR_SCALE, 0),
  draggable: true,
  tapAction: 'react',
  tags: ['character'],
  attachOffset: { x: 62, y: -58 },
  dropZone: { accepts: ['holdable'], action: 'attach', rect: { x: -70, y: -190, w: 140, h: 190 }, capacity: 1, priority: 2 },
});

const prop = (id: string, x: number, y: number, scale: number): SceneObjectDefinition => ({
  id, type: 'prop', sprite: id, x, y, scale,
  draggable: true, hitPad: padFor(NATURAL_AVG[id]!, scale, 12), tags: ['prop', 'holdable', 'placeable'],
});

/** Non-interactive wall/floor decoration: furniture with no zone, no tap, not draggable. */
const decor = (id: string, x: number, y: number, scale = 1, anchorY = 1): SceneObjectDefinition => ({
  id: `decor_${id}_${x}`, type: 'furniture', sprite: id, x, y, scale, anchor: { x: 0.5, y: anchorY },
});

export const playroom: SceneDefinition = {
  id: 'playroom',
  version: 2,
  background: 'room_bg',
  objects: [
    decor('bunting', 200, 95), decor('bunting', 512, 95), decor('bunting', 824, 95),
    decor('window', 150, 320),
    decor('frame_picture', 470, 290, 0.9),
    decor('frame_heart', 590, 270, 0.9),
    decor('rug', 440, 635, 1),
    {
      id: 'door', type: 'furniture', sprites: { closed: 'door_closed', open: 'door_open' }, initialState: 'closed',
      x: 835, y: 540, anchor: { x: 0, y: 1 }, tapAction: 'toggle',
    },
    {
      id: 'sofa', type: 'furniture', sprite: 'sofa', x: 440, y: 560, scale: 0.85,
      dropZone: { accepts: ['character'], action: 'sit', rect: { x: -90, y: -160, w: 180, h: 160 }, snap: { x: 6, y: -40 }, capacity: 1, priority: 1 },
    },
    decor('plant', 600, 560, 0.85),
    {
      id: 'armchair', type: 'furniture', sprite: 'armchair', x: 740, y: 565, scale: 0.8,
      dropZone: { accepts: ['character'], action: 'sit', rect: { x: -70, y: -160, w: 140, h: 160 }, snap: { x: 6, y: -40 }, capacity: 1, priority: 1 },
    },
    {
      id: 'table', type: 'furniture', sprite: 'table', x: 250, y: 575, scale: 0.85,
      dropZone: { accepts: ['placeable'], action: 'place', rect: { x: -60, y: -104, w: 120, h: 24 }, priority: 0 },
    },
    { id: 'nightstand', type: 'furniture', sprite: 'nightstand', x: 60, y: 580, scale: 0.7 },
    {
      id: 'lamp', type: 'furniture', sprites: { off: 'lamp_off', on: 'lamp_on' }, initialState: 'off',
      x: 60, y: 505, scale: 0.7, tapAction: 'toggle',
    },
    kid('ponytail', 250, 745),
    kid('cap', 420, 745),
    kid('crown', 590, 745),
    prop('teddy', 55, 650, 0.5), prop('duck', 55, 725, 0.4),
    prop('blocks', 130, 650, 0.45), prop('apple', 130, 725, 0.45),
    prop('cookie', 715, 655, 0.45), prop('mug', 790, 655, 0.5),
    prop('storybook', 880, 645, 0.4), prop('toy_car', 955, 620, 0.4),
    prop('cat', 725, 725, 0.4), prop('dog', 810, 728, 0.4),
    prop('beach_ball', 885, 722, 0.35), prop('guitar', 968, 700, 0.35),
  ],
};
