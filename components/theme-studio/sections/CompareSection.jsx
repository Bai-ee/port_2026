'use client';

import React, { useMemo } from 'react';
import Section from '../controls/Section.jsx';
import PreviewSurface from '../preview/PreviewSurface.jsx';
import Icon from '../Icon.jsx';
import { useStudio, useDraft, useResolvedPair } from '../StudioContext.jsx';
import { buildPreviewScopeCss, PREVIEW_STYLE_ID } from '../../../lib/theme-studio/preview-css.js';
import { PREVIEW_CSS } from '../studio-chrome-css.js';

export default function CompareSection() {
  useStudio();
  const draft = useDraft();
  const pair = useResolvedPair();
  const css = useMemo(() => buildPreviewScopeCss(draft, pair), [draft, pair]);
  if (!draft) return null;
  return (
    <Section id="compare" num="09" title="Compare Light and Dark" summary="Side by side">
      <p className="ts-p">
        Both panes use the same sample interface on the real tokens of your draft. The page itself is not duplicated.
      </p>
      <style id={PREVIEW_STYLE_ID} dangerouslySetInnerHTML={{ __html: css }} />
      <style id="theme-studio-preview-sample-css" dangerouslySetInnerHTML={{ __html: PREVIEW_CSS }} />
      <div className="ts-panes" id="theme-studio-compare-panes">
        {['light', 'dark'].map((scope) => (
          <div key={scope}>
            <div className="ts-pane-label">
              <Icon name={scope === 'light' ? 'sun' : 'moon'} size={14} />
              <span className="ts-label">{scope === 'light' ? 'Light' : 'Dark'}</span>
            </div>
            <PreviewSurface scope={scope} />
          </div>
        ))}
      </div>
    </Section>
  );
}
