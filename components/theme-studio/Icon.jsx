'use client';

import React from 'react';

// Small stroke icon set (16px). Decorative by default (aria-hidden); the visible
// text next to an icon always carries the meaning.
const PATHS = {
  chevron: 'M6 3.5 10.5 8 6 12.5',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  undo: 'M6 4 2.5 7.5 6 11M2.8 7.5H10a3.5 3.5 0 0 1 0 7H8',
  redo: 'M10 4l3.5 3.5L10 11M13.2 7.5H6a3.5 3.5 0 0 0 0 7h2',
  lock: 'M4.5 7.5V5.5a3.5 3.5 0 0 1 7 0v2M3.5 7.5h9v6h-9z',
  unlock: 'M4.5 7.5V5.5a3.5 3.5 0 0 1 6.6-1.6M3.5 7.5h9v6h-9z',
  link: 'M6.5 9.5l3-3M7 4.5l.8-.8a2.5 2.5 0 0 1 3.5 3.5l-.8.8M9 11.5l-.8.8a2.5 2.5 0 0 1-3.5-3.5l.8-.8',
  check: 'M3 8.5l3.2 3.2L13 4.8',
  alert: 'M8 2.5l6 10.5H2zM8 7v2.8M8 11.6v.1',
  info: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7.2v3.6M8 5.2v.1',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
  download: 'M8 2.5v7.5M4.8 7.2 8 10.4l3.2-3.2M3 13h10',
  upload: 'M8 10.5V3M4.8 5.8 8 2.6l3.2 3.2M3 13h10',
  reset: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.8v2.7h2.7',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  pencil: 'M10.5 3l2.5 2.5L5.5 13H3v-2.5zM9 4.5l2.5 2.5',
  save: 'M3 3h8l2 2v8H3zM5.5 3v3.5h4V3M5.5 13V9.5h5V13',
  x: 'M4 4l8 8M12 4l-8 8',
  plus: 'M8 3.5v9M3.5 8h9',
  sun: 'M8 10.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z',
  circleCheck: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM5.2 8.2l2 2 3.6-4',
  circleX: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6 6l4 4M10 6l-4 4',
};

export default function Icon({ name, size = 16, ...rest }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
