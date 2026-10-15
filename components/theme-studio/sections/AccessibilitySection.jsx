'use client';

import React, { useMemo } from 'react';
import Section from '../controls/Section.jsx';
import ModeSwitch from '../controls/ModeSwitch.jsx';
import A11yResultItem from '../controls/A11yResultItem.jsx';
import Icon from '../Icon.jsx';
import {
  useStudio, useDraft, useEditingMode, useResolvedPair, useReport, useStoreSelector,
} from '../StudioContext.jsx';
import { filterResults, summarizeModeReport, MODE_LABEL } from '../../../lib/theme-studio/view-models.js';
import { CONTRAST_STATEMENT } from '../../../lib/theme/index.js';

const selPending = (s) => s.reportPending;

export default function AccessibilitySection() {
  const { store, ui, dispatch } = useStudio();
  const pending = useStoreSelector(store, selPending);
  const draft = useDraft();
  const editing = useEditingMode();
  const pair = useResolvedPair();
  const report = useReport();
  const mode = ui.a11yMode || editing;
  const modeReport = report ? report.modes[mode] : null;
  const results = useMemo(() => filterResults(modeReport, ui.a11yFilter), [modeReport, ui.a11yFilter]);
  const sum = useMemo(() => summarizeModeReport(modeReport), [modeReport]);
  if (!draft || !pair) return null;

  const total = report ? report.summary : null;
  const summaryText = total ? `${total.failRequired} required to fix` : 'Checking';

  return (
    <Section id="accessibility" num="06" title="Accessibility" summary={summaryText}>
      <p className="ts-p">{CONTRAST_STATEMENT}</p>
      <div className="ts-field">
        <span className="ts-label">Palette</span>
        <ModeSwitch
          id="theme-studio-a11y-mode"
          label="Palette to check"
          value={mode}
          block
          onChange={(v) => dispatch({ type: 'a11y/mode', value: v })}
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />
      </div>
      {!report ? (
        <p className="ts-p" role="status">Checking contrast…</p>
      ) : (
        <>
          {pending ? <p className="ts-hint" role="status">Updating results after your last change…</p> : null}
          <div className="ts-sumchips" id="theme-studio-a11y-summary" aria-label={`${MODE_LABEL[mode]} palette summary`}>
            <span className="ts-badge ts-badge--fail"><Icon name="circleX" size={12} /> {sum.fail} required failing</span>
            <span className="ts-badge ts-badge--advisory"><Icon name="alert" size={12} /> {sum.advisory} advisory</span>
            <span className="ts-badge ts-badge--pass"><Icon name="circleCheck" size={12} /> {sum.pass} passing</span>
            <span className="ts-badge ts-badge--none">{sum.excluded} excluded</span>
          </div>
          <div className="ts-field">
            <ModeSwitch
              id="theme-studio-a11y-filter"
              label="Which results to list"
              value={ui.a11yFilter}
              block
              onChange={(v) => dispatch({ type: 'a11y/filter', value: v })}
              options={[{ value: 'failing', label: 'Findings only' }, { value: 'all', label: 'All checks' }]}
            />
            <p className="ts-hint">
              Required checks must pass for the export to be marked validated. Advisory checks are reported but do not block it.
              Suggestions are never applied automatically, and locked roles are never changed.
            </p>
          </div>
          {results.length === 0 ? (
            <p className="ts-p" role="status">
              {ui.a11yFilter === 'failing' ? `No findings in the ${mode} palette.` : 'No checks to show.'}
            </p>
          ) : (
            <ul className="ts-results" id="theme-studio-a11y-results">
              {results.map((r) => (
                <A11yResultItem key={r.id} result={r} def={draft} mode={mode} resolvedMode={pair[mode]} />
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
