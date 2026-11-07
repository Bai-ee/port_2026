export const TOTAL_MONTHS = 216;
export const PHOTO_COUNT = 36;
export const SOURCES = ['Photos library', 'iPhoto library', 'Backup folders'];
export const PLACES = ['Chicago', 'California', 'New York', 'Colorado', 'Michigan', 'Not recorded'];
export const ALBUMS = ['Everyday', 'On the road', 'Outdoors', 'Gatherings', 'Weekends', 'City life'];
const COORDS = [[41.88,-87.63],[36.78,-119.42],[40.71,-74.01],[39.74,-104.99],[44.31,-85.60],null];
export const random = (n, salt = 0) => {
  let x = Math.imul(n + salt * 7919 + 17, 1597334677);
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};

export function makeRecords() {
  const items = [];
  const weights = Array.from({ length: TOTAL_MONTHS }, (_, m) => 0.3 + random(m, 1) * 0.9 + (m > 105 && m < 166 ? 0.7 : 0));
  const sum = weights.reduce((a,b) => a+b, 0);
  let cumulative = 0;
  for (let m = 0; m < TOTAL_MONTHS; m++) {
    cumulative += weights[m] / sum * 20000;
    const count = Math.round(cumulative) - items.length;
    for (let j = 0; j < count; j++) {
      const id = items.length;
      const fraction = random(id, 2);
      const day = Math.floor(fraction * 28) + 1;
      const year = 2005 + Math.floor(m / 12);
      const month = m % 12 + 1;
      const sourceIndex = m < 96 ? 1 : m < 166 ? 0 : 2;
      const placeIndex = Math.floor(random(id, 3) * PLACES.length);
      const album = ALBUMS[Math.floor(random(id, 4) * ALBUMS.length)];
      const isVideo = random(id, 5) > 0.88;
      const slot = Math.floor(random(id, 6) * PHOTO_COUNT);
      const local = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(Math.floor(random(id,7)*24)).padStart(2,'0')}:${String(Math.floor(random(id,8)*60)).padStart(2,'0')}:00`;
      items.push({
        id, key: `demo-${String(id).padStart(5,'0')}`, libraryId: 'my-library', slot,
        time: m + fraction, year, month, day, takenLocal: local, timezone: '-05:00',
        y: 0.5 + Math.sin(m * 0.075) * 0.06 + (random(id,9)-0.5) * (0.43 + weights[m] * 0.15),
        title: `${album} · sample ${String(id + 1).padStart(5,'0')}`,
        description: 'Illustrative memory. This photograph and its generated metadata are sample content, not a record from your library.',
        kind: isVideo ? 'video' : 'image', ext: isVideo ? 'mov' : slot % 4 === 0 ? 'heic' : 'jpg',
        durationSec: isVideo ? 4 + Math.floor(random(id,10)*170) : null,
        width: 4032, height: slot % 5 === 0 ? 4032 : 3024,
        favorite: random(id,11) > 0.91, hidden: random(id,12) > 0.98,
        motion: !isVideo && random(id,13) > 0.72, edited: random(id,14) > 0.87,
        gps: Boolean(COORDS[placeIndex]), lat: COORDS[placeIndex]?.[0] ?? null, lon: COORDS[placeIndex]?.[1] ?? null,
        place: PLACES[placeIndex], album, keywords: [album.toLowerCase(), ['travel','home','friends','nature'][slot%4]],
        cameraMake: slot % 5 === 0 ? 'Canon' : 'Apple', cameraModel: slot % 5 === 0 ? 'EOS 70D' : m < 108 ? 'iPhone 4S' : m < 156 ? 'iPhone 6' : 'iPhone 11',
        source: SOURCES[sourceIndex], sourceKind: sourceIndex === 1 ? 'iphoto' : sourceIndex === 2 ? 'folder' : 'photos',
        filename: `IMG_${String(id%10000).padStart(4,'0')}.${isVideo ? 'MOV' : 'JPG'}`,
        tsSource: sourceIndex === 2 ? 'exif' : 'library-db', tsKind: random(id,15) > 0.93 ? 'local-only' : 'exact',
        locationCount: random(id,16) > 0.8 ? 2 : 1, thumbs: true,
      });
    }
  }
  return items.sort((a,b)=>a.time-b.time).map((item,index)=>({...item,index}));
}

export const FIELDS = [
  ['title','Title','text'], ['description','Description','text'], ['keywords','Keywords','text'], ['album','Album','text'],
  ['kind','Media type','text'], ['favorite','Favorite','boolean'], ['hidden','Hidden','boolean'], ['motion','Live Photo','boolean'], ['edited','Edited version','boolean'],
  ['takenLocal','Capture date','text'], ['year','Year','number'], ['month','Month','number'], ['timezone','Recorded timezone','text'],
  ['tsSource','Date source','text'], ['tsKind','Date certainty','text'], ['cameraMake','Camera make','text'], ['cameraModel','Camera model','text'],
  ['ext','File extension','text'], ['width','Width','number'], ['height','Height','number'], ['durationSec','Duration (seconds)','number'],
  ['gps','Has GPS','boolean'], ['lat','Latitude','number'], ['lon','Longitude','number'], ['source','Source label','text'],
  ['sourceKind','Source kind','text'], ['filename','Original filename','text'], ['locationCount','Source locations','number'], ['thumbs','Has thumbnail','boolean'], ['key','Item ID','text'],
];

export function dateLabel(time, includeMonth = false) {
  const m = Math.max(0, Math.min(TOTAL_MONTHS-1, Math.floor(time)));
  const d = new Date(Date.UTC(2005+Math.floor(m/12),m%12,1));
  return new Intl.DateTimeFormat('en-US',{ year:'numeric', ...(includeMonth ? { month:'short' } : {}), timeZone:'UTC' }).format(d);
}

export function recordDate(item) {
  return new Intl.DateTimeFormat('en-US',{dateStyle:'long', timeZone:'UTC'}).format(new Date(item.takenLocal+'Z'));
}
