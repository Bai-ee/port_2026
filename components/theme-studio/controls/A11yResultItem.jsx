'use client';

import React from 'react';
import Icon from '../Icon.jsx';
import { badgeFor, suggestionView, applySuggestion } from '../../../lib/theme-studio/view-models.js';
import { useStudio } from '../StudioContext.jsx';

const BADGE_ICON = { pass: 'circleCheck', fail: 'circleX', advisory: 'alert' };

/**
 * One contrast result: a live sample, the ratio and the minimum as text, and a
 * suggestion that is only ever applied by an explicit click (never for locked roles).
 */
export default function A11yResultItem({
  result, def, mode, resolvedMode, compact = false,
}) {
  const { edit, announce } = useStudio();
  const badge = badgeFor(result);
  const view = suggestionView(result, def, mode);
  const cls = result.pass ? '' : result.required ? ' ts-result--fail' : ' ts-result--advisory';
  const apply = () => {
    edit((d) => applySuggestion(d, resolvedMode, mode, result.suggestion), {
      kind: 'set',
      label: `Apply contrast suggestion to ${view.role}`,
    });
    announce(`Applied suggestion: ${view.role} is now custom.`);
  };
  return (
    <li className={`ts-result${cls}`} data-result={result.id}>
      <div className="ts-result-sample" style={{ background: result.bgHex, color: result.fgHex }} aria-hidden="true">Aa</div>
      <div className="ts-result-body">
        <p className="ts-result-title">{result.label}</p>
        <div className="ts-result-line">
          <span className={`ts-badge ts-badge--${badge.status}`}>
            <Icon name={BADGE_ICON[badge.status]} size={12} />
            {badge.text}
          </span>
          <span className="ts-badge">{result.required ? 'Required' : 'Advisory'}</span>
          {(result.fgLocked || result.bgLocked) ? (
            <span className="ts-badge ts-badge--locked"><Icon name="lock" size={12} /> Locked</span>
          ) : null}
        </div>
        {!result.pass ? (
          <>
            <p className="ts-hint">{view.text}</p>
            {view.reason ? <p className="ts-hint">{view.reason}</p> : null}
            {!compact || view.has ? (
              <div className="ts-btn-row">
                <button type="button" className="ts-btn ts-btn--sm" disabled={!view.canApply} onClick={apply}>
                  Apply suggestion
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}
