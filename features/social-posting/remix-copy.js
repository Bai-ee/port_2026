function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function canonicalRemixCopy(metadata = {}) {
  const artist = firstString(metadata.artist, metadata.dj, metadata.name);
  const mix = firstString(metadata.mix, metadata.mixTitle, metadata.title);
  return [artist, mix].filter(Boolean).join('\n') || 'Video Remix';
}
