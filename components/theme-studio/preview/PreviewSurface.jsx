'use client';

import React from 'react';
import Icon from '../Icon.jsx';

/**
 * Sample UI rendered on REAL tokens inside a pinned scope. The two panes in the
 * Compare section are two instances of this one component; there is no second
 * app and no second canvas. Status is always icon + text, never color alone.
 */
export default function PreviewSurface({ scope }) {
  const idBase = `theme-studio-preview-${scope}`;
  return (
    <div className="ts-pv" data-theme-scope={scope} id={`${idBase}-surface`}>
      <div>
        <p className="ts-pv-eyebrow">Eyebrow label</p>
        <h4 className="ts-pv-h">A headline in strong text</h4>
      </div>
      <p className="ts-pv-body">
        Body copy sits on the page background.
        {' '}
        <a href="#theme-studio-preview" onClick={(e) => e.preventDefault()}>A link in accent text</a>
        {' '}
        and <span className="ts-pv-selection">selected text</span>.
      </p>
      <div>
        <p className="ts-pv-sec">Secondary text for supporting detail.</p>
        <p className="ts-pv-muted">Muted text for hints and captions.</p>
        <p className="ts-pv-faint">Faint text, used for placeholders.</p>
      </div>

      <div className="ts-pv-row" role="group" aria-label={`${scope} buttons`}>
        <button type="button" className="ts-pv-btn ts-pv-btn--primary" tabIndex={-1}>Primary</button>
        <button type="button" className="ts-pv-btn ts-pv-btn--soft" tabIndex={-1}>Soft</button>
        <button type="button" className="ts-pv-btn ts-pv-btn--outline" tabIndex={-1}>Outline</button>
        <button type="button" className="ts-pv-btn ts-pv-btn--disabled" disabled tabIndex={-1}>Disabled</button>
        <button type="button" className="ts-pv-btn ts-pv-btn--focus" tabIndex={-1}>Focused</button>
      </div>

      <div className="ts-pv-field">
        <label className="ts-pv-label" htmlFor={`${idBase}-input`}>Email address</label>
        <input id={`${idBase}-input`} className="ts-pv-input" placeholder="name@example.com" tabIndex={-1} readOnly />
        <input className="ts-pv-input ts-pv-input--strong" defaultValue="With a stronger border" aria-label="Input with strong border" tabIndex={-1} readOnly />
      </div>

      <div className="ts-pv-layers">
        <div className="ts-pv-card ts-pv-card--surface"><b>Surface</b><span>Cards and inputs</span></div>
        <div className="ts-pv-card ts-pv-card--raised"><b>Raised</b><span>Popovers</span></div>
        <div className="ts-pv-card ts-pv-card--inset"><b>Inset</b><span>Wells and code</span></div>
        <div className="ts-pv-card ts-pv-card--glass"><b>Glass</b><span>Text-bearing panel</span></div>
      </div>

      <div className="ts-pv-row" role="group" aria-label={`${scope} status messages`}>
        <span className="ts-pv-status ts-pv-status--success"><Icon name="circleCheck" size={14} /> Saved</span>
        <span className="ts-pv-status ts-pv-status--warning"><Icon name="alert" size={14} /> Check this</span>
        <span className="ts-pv-status ts-pv-status--danger"><Icon name="circleX" size={14} /> Failed</span>
        <span className="ts-pv-status ts-pv-status--info"><Icon name="info" size={14} /> For your information</span>
      </div>
      <div className="ts-pv-solids" role="group" aria-label={`${scope} status fills`}>
        <span className="ts-pv-solid" style={{ background: 'var(--t-success-solid)' }}>Success</span>
        <span className="ts-pv-solid" style={{ background: 'var(--t-warning-solid)' }}>Warning</span>
        <span className="ts-pv-solid" style={{ background: 'var(--t-danger-solid)' }}>Danger</span>
        <span className="ts-pv-solid" style={{ background: 'var(--t-info-solid)' }}>Info</span>
      </div>

      <div className="ts-pv-dialog-stage">
        <p className="ts-pv-onoverlay">Text on a scrim</p>
        <div className="ts-pv-dialog" role="group" aria-label={`${scope} dialog sample`}>
          <h4>Dialog title</h4>
          <p>Dialogs sit on the raised surface above the scrim.</p>
          <div className="ts-pv-row">
            <button type="button" className="ts-pv-btn ts-pv-btn--primary" tabIndex={-1}>Confirm</button>
            <button type="button" className="ts-pv-btn ts-pv-btn--outline" tabIndex={-1}>Cancel</button>
          </div>
        </div>
      </div>

      <div className="ts-pv-gradient" aria-hidden="true" />
      <div className="ts-pv-scene">Static background fallback</div>
      <div className="ts-pv-term" role="group" aria-label={`${scope} terminal sample`}>
        <div className="dim">$ build theme</div>
        <div className="ok"><span className="p">ok </span><span className="m">tokens generated</span></div>
        <div className="err"><span className="p">err </span><span className="m">one check failed</span></div>
      </div>
    </div>
  );
}
