import { createContext } from 'react';

// NasContext — shared NAS reachability for tiles + drawer.
// { online: boolean, base: string } where base = localThumbBase from `nas-status`.
export const NasContext = createContext({ online: false, base: '' });

export function isNasItem(item) {
  return item?._bucketId === 'nas' || item?.bucketId === 'nas';
}
