'use client';

import { useCallback, useState } from 'react';

// List-thumbnail <video> that defers its metadata fetch until the element nears
// the viewport. Mounting dozens of preload="metadata" videos at once (folder
// previews, saved remixes) fires a metadata/range request + demuxer per file up
// front — the main cause of the heavy modal open + scroll stutter. Until
// visible, renders a src-less preload="none" video (thumb containers paint
// their own dark background); on first intersection the real src loads and the
// per-thumb observer disconnects.
export default function LazyVideoThumb({ src, ...videoProps }) {
  const [visible, setVisible] = useState(false);
  const ref = useCallback((el) => {
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return <video ref={ref} src={visible ? src : undefined} preload={visible ? 'metadata' : 'none'} {...videoProps} />;
}
