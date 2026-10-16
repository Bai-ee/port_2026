'use client';

import React, { useMemo, useState } from 'react';
import Section from '../controls/Section.jsx';
import Banner from '../controls/Banner.jsx';
import ConfirmButton from '../controls/ConfirmButton.jsx';
import { Toggle } from '../controls/Toggle.jsx';
import ColorGuide from '../ColorGuide.jsx';
import Icon from '../Icon.jsx';
import {
  useStudio, useDraft, useReport, useStoreSelector,
} from '../StudioContext.jsx';
import { buildExportBundle, importThemeJson } from '../../../lib/theme/index.js';
import { exportBanner, bundleFiles, describeImport } from '../../../lib/theme-studio/io.js';

const selApplied = (s) => s.applied;
const selStorage = (s) => s.storageAvailable;

export default function ExportSection() {
  const {
    store, ui, dispatch, edit, announce, copyText, downloadFile, saveDraft, saveNote,
  } = useStudio();
  const draft = useDraft();
  const report = useReport();
  const applied = useStoreSelector(store, selApplied);
  const storageOk = useStoreSelector(store, selStorage);
  const [guideOpen, setGuideOpen] = useState(false);

  const banner = useMemo(() => exportBanner(report), [report]);
  const imp = ui.importResult;

  if (!draft) return null;

  const getBundle = () => {
    const b = store.has('exportBundle') ? store.exportBundle() : null;
    return b && typeof b.json === 'string' ? b : buildExportBundle(draft);
  };
  const files = () => bundleFiles(getBundle(), draft.meta);

  const validate = (text) => {
    const result = importThemeJson(text);
    dispatch({ type: 'import/result', result: { view: describeImport(result), definition: result.ok ? result.definition : null } });
    announce(describeImport(result).headline);
  };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      dispatch({ type: 'import/text', text });
      validate(text);
    } catch (err) {
      announce('Could not read that file.');
    }
  };

  const loadImported = () => {
    if (!imp || !imp.definition) return;
    edit(() => imp.definition, { kind: 'set', label: 'Import theme file' });
    dispatch({ type: 'origin/set', value: 'imported' });
    dispatch({ type: 'import/text', text: '' });
    announce('Theme file loaded into your draft. Undo restores the previous draft.');
  };

  return (
    <Section id="export" num="10" title="Save, export and import" summary={banner.status === 'validated' ? 'Validated' : 'Draft'}>
      <Banner tone={banner.tone} id="theme-studio-export-status">
        <p><strong>{banner.title}</strong></p>
        <p>{banner.detail}</p>
      </Banner>

      <div className="ts-card" id="theme-studio-save-card">
        <h4 className="ts-card-title">Save in this browser</h4>
        <p className="ts-hint">
          Saving keeps your draft in this browser only. Visitors and teammates do not see it until a developer publishes the exported file.
        </p>
        <div className="ts-btn-row">
          <button type="button" className="ts-btn ts-btn--primary" id="theme-studio-save-draft" onClick={saveDraft}>
            <Icon name="save" size={14} /> Save draft (local)
          </button>
        </div>
        {saveNote ? <p className="ts-hint" id="theme-studio-save-note">{saveNote}</p> : null}
        {!storageOk ? <p className="ts-hint">Storage is unavailable here, so the draft lives only until you close this tab.</p> : null}
        <Toggle
          id="theme-studio-apply-site-wide"
          label="Keep this draft on every page"
          description="Applies the draft site-wide in this browser, including after a reload. Turn off to return to the published theme."
          checked={applied}
          onChange={(v) => { store.setApplied(v); announce(v ? 'Draft applied on every page in this browser.' : 'Back to the published theme after reload.'); }}
        />
      </div>

      <div className="ts-card" id="theme-studio-export-card">
        <h4 className="ts-card-title">Export {banner.status === 'validated' ? '(validated)' : '(draft)'}</h4>
        <div className="ts-btn-row">
          <button type="button" className="ts-btn" onClick={() => copyText(getBundle().json, 'Theme JSON')}>
            <Icon name="copy" size={14} /> Copy JSON
          </button>
          {['json', 'css', 'guide', 'report'].map((key) => (
            <button
              key={key}
              type="button"
              className="ts-btn"
              onClick={() => {
                const f = files().find((x) => x.key === key);
                downloadFile(f.filename, f.mime, f.content);
              }}
            >
              <Icon name="download" size={14} />
              {{ json: 'JSON', css: 'CSS', guide: 'Color guide', report: 'Validation report' }[key]}
            </button>
          ))}
        </div>
        <p className="ts-hint">
          File names carry
          {' '}
          <code className="ts-code">{banner.status}</code>
          {' '}
          so a draft is never mistaken for a validated preset. The report lists every automated check and what failed.
        </p>
      </div>

      <div className="ts-card" id="theme-studio-import-card">
        <h4 className="ts-card-title">Import a theme file</h4>
        <label className="ts-label" htmlFor="theme-studio-import-text">Paste theme JSON</label>
        <textarea
          id="theme-studio-import-text"
          className="ts-textarea"
          spellCheck={false}
          placeholder='{ "schema": "hitloop.theme", "version": 1, … }'
          value={ui.importText}
          onChange={(e) => dispatch({ type: 'import/text', text: e.target.value })}
        />
        <div className="ts-btn-row">
          <button type="button" className="ts-btn" disabled={!ui.importText.trim()} onClick={() => validate(ui.importText)}>
            Validate
          </button>
          <label className="ts-file ts-btn" id="theme-studio-import-file">
            <Icon name="upload" size={14} /> Choose file
            <input type="file" accept=".json,application/json" aria-label="Choose a theme JSON file" onChange={onFile} />
          </label>
        </div>
        {imp ? (
          <div className="ts-stack" id="theme-studio-import-result" role="status">
            <Banner tone={imp.view.ok ? (imp.view.warnings.length ? 'warn' : 'ok') : 'danger'}>
              <p><strong>{imp.view.headline}</strong></p>
              {imp.view.name ? <p>Theme name: {imp.view.name}</p> : null}
            </Banner>
            {imp.view.errors.length ? (
              <ul className="ts-importmsg" aria-label="Errors">
                {imp.view.errors.map((e, i) => <li key={`e${i}`}><code>{e.code}</code><span>{e.path ? `${e.path}: ` : ''}{e.message}</span></li>)}
                {imp.view.hiddenErrors ? <li>{imp.view.hiddenErrors} more errors not shown.</li> : null}
              </ul>
            ) : null}
            {imp.view.warnings.length ? (
              <ul className="ts-importmsg" aria-label="Warnings">
                {imp.view.warnings.map((e, i) => <li key={`w${i}`}><code>{e.code}</code><span>{e.path ? `${e.path}: ` : ''}{e.message}</span></li>)}
                {imp.view.hiddenWarnings ? <li>{imp.view.hiddenWarnings} more warnings not shown.</li> : null}
              </ul>
            ) : null}
            {imp.view.canLoad ? (
              <ConfirmButton
                id="theme-studio-import-load"
                label="Load into draft"
                prompt="Replace your draft with this file? Undo brings your draft back."
                confirmLabel="Load"
                danger={false}
                small={false}
                icon="upload"
                onConfirm={loadImported}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ts-stack" id="theme-studio-guide-block">
        <button
          type="button"
          className="ts-btn"
          aria-expanded={guideOpen ? 'true' : 'false'}
          aria-controls="theme-studio-color-guide"
          onClick={() => setGuideOpen((v) => !v)}
        >
          {guideOpen ? 'Hide color guide' : 'Show color guide'}
        </button>
        {guideOpen ? <ColorGuide /> : null}
      </div>

      <div className="ts-card" id="theme-studio-handoff-card">
        <h4 className="ts-card-title">Hand off to a developer</h4>
        <ol className="ts-list">
          <li>Download the JSON (and the report) and send both.</li>
          <li>
            The developer replaces
            {' '}
            <code className="ts-code">lib/theme/production/production-theme.json</code>
            , then runs
            {' '}
            <code className="ts-code">npm run theme:build</code>
            {' '}
            and
            {' '}
            <code className="ts-code">npm run theme:check</code>
            .
          </li>
          <li>They commit and deploy as usual. To roll back, revert that commit.</li>
        </ol>
      </div>
    </Section>
  );
}
