'use client';

import React, { useMemo, useState } from 'react';
import Swatch from './controls/Swatch.jsx';
import { toColorGuide } from '../../lib/theme/index.js';
import { filterGuideRows } from '../../lib/theme-studio/io.js';
import { useDraft } from './StudioContext.jsx';

/** Token, value (light and dark) and usage, for every role. Rendered only when opened. */
export default function ColorGuide() {
  const draft = useDraft();
  const [query, setQuery] = useState('');
  const guide = useMemo(() => (draft ? toColorGuide(draft) : null), [draft]);
  const rows = useMemo(() => (guide ? filterGuideRows(guide.rows, query) : []), [guide, query]);
  if (!guide) return null;
  return (
    <div className="ts-stack" id="theme-studio-color-guide">
      <label className="ts-label" htmlFor="theme-studio-guide-search">Filter the color guide</label>
      <input
        id="theme-studio-guide-search"
        type="search"
        className="ts-input"
        placeholder="Token, usage or hex"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="ts-hint" aria-live="polite">{rows.length} of {guide.rows.length} tokens.</p>
      <div className="ts-table-wrap" tabIndex={0} role="region" aria-label="Color guide table">
        <table className="ts-table">
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Light</th>
              <th scope="col">Dark</th>
              <th scope="col">Usage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.token}>
                <td className="ts-cell-token">{r.token}</td>
                <td><span className="ts-cell-val"><Swatch color={r.light.value} size="sm" />{r.light.value}</span></td>
                <td><span className="ts-cell-val"><Swatch color={r.dark.value} size="sm" />{r.dark.value}</span></td>
                <td className="ts-cell-use">{r.usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
