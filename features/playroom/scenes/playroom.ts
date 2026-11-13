import type { SceneDefinition, SceneObjectDefinition } from '../types';

const kid = (id: string, a: string, x: number, y: number): SceneObjectDefinition => ({
  id,
  type: 'character',
  sprites: { standing: `${a}_stand`, sitting: `${a}_sit` },
  initialState: 'standing',
  x, y,
  draggable: true,
  tapAction: 'react',
  tags: ['character'],
  attachOffset: { x: 38, y: -70 },
  dropZone: { accepts: ['holdable'], action: 'attach', rect: { x: -55, y: -200, w: 110, h: 200 }, capacity: 1, priority: 2 },
});

const prop = (id: string, x: number, y: number): SceneObjectDefinition => ({
  id, type: 'prop', sprite: id, x, y,
  draggable: true, hitPad: 16, tags: ['prop', 'holdable', 'placeable'],
});

export const playroom: SceneDefinition = {
  id: 'playroom',
  version: 1,
  background: 'room_bg',
  objects: [
    {
      id: 'armchair', type: 'furniture', sprite: 'chair_back', frontSprite: 'chair_front',
      x: 780, y: 600,
      dropZone: { accepts: ['character'], action: 'sit', rect: { x: -80, y: -200, w: 160, h: 200 }, snap: { x: 0, y: -40 }, capacity: 1, priority: 1 },
    },
    {
      id: 'table', type: 'furniture', sprite: 'table', x: 330, y: 600,
      dropZone: { accepts: ['placeable'], action: 'place', rect: { x: -110, y: -175, w: 220, h: 90 }, priority: 0 },
    },
    {
      id: 'lamp', type: 'furniture', sprites: { off: 'lamp_off', on: 'lamp_on' }, initialState: 'off',
      x: 940, y: 520, tapAction: 'toggle',
    },
    kid('kid_a', 'kid_a', 150, 700),
    kid('kid_b', 'kid_b', 520, 720),
    prop('ball', 90, 600),
    prop('teddy', 640, 560),
    prop('book', 250, 712),
    prop('apple', 400, 705),
    prop('cup', 640, 720),
    prop('robot', 760, 705),
    prop('blocks', 880, 700),
    prop('duck', 55, 712),
  ],
};
