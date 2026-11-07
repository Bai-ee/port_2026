import { createHash } from 'node:crypto';
export const sha = (n) => createHash('sha256').update(String(n)).digest('hex');
export function rawItem(n, over = {}) {
  const sha256 = sha(n);
  const id = sha256.slice(0, 16);
  return {
    id, sha256, kind: 'image', ext: 'jpg', width: 400, height: 300, durationSec: null,
    takenLocal: '2010-05-01T10:00:00', tz: '-05:00', tsUtc: '2010-05-01T15:00:00Z', tsSource: 'exif', tsKind: 'exact',
    gps: null, albums: ['A'], favorite: false, hidden: false, title: ' t ', description: '', keywords: [],
    camera: null, motion: null, edited: null,
    thumbs: { s: `life-thumbs/${id}_s.jpg`, m: `life-thumbs/${id}_m.jpg` },
    canonicalPath: `HITLOOP-ARCHIVE/timeline/2010/05/${id}.jpg`,
    locations: [{ sourceId: 'src', relativePath: 'a/b.jpg', originalFileName: 'b.jpg' }],
    ...over,
  };
}
