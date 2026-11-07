let records = [];
function check(value, operator, needle) {
  if (operator === 'missing') return value == null || value === '' || (Array.isArray(value) && !value.length);
  if (operator === 'present') return !check(value, 'missing');
  if (value == null) return false;
  if (operator === 'gte') return Number(value) >= Number(needle);
  if (operator === 'lte') return Number(value) <= Number(needle);
  const a = String(value).toLowerCase();
  const b = String(needle).trim().toLowerCase();
  if (operator === 'eq') return a === b;
  if (operator === 'neq') return a !== b;
  return a.includes(b);
}
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    records = data.records.map(r=>({...r, searchText:[r.title,r.description,r.keywords,r.album,r.cameraMake,r.cameraModel,r.source,r.filename].join(' ').toLowerCase()}));
    return;
  }
  const { filters, generation } = data;
  const words = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const result = [];
  const counts = new Uint32Array(216);
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (filters.favorite && !r.favorite) continue;
    if (filters.kind && r.kind !== filters.kind) continue;
    if (filters.source && r.source !== filters.source) continue;
    if (filters.gps && !r.gps) continue;
    if (filters.motion && !r.motion) continue;
    if (!filters.includeHidden && r.hidden) continue;
    if (filters.camera && r.cameraMake !== filters.camera) continue;
    if (filters.album && r.album !== filters.album) continue;
    if (filters.from && r.takenLocal.slice(0,10) < filters.from) continue;
    if (filters.to && r.takenLocal.slice(0,10) > filters.to) continue;
    if (words.some(w=>!r.searchText.includes(w))) continue;
    if (filters.conditions.some(c=>!check(r[c.field],c.operator,c.value))) continue;
    result.push(i);
    counts[Math.floor(r.time)]++;
  }
  const ids = Uint32Array.from(result);
  self.postMessage({type:'result',generation,ids,counts},[ids.buffer,counts.buffer]);
};
