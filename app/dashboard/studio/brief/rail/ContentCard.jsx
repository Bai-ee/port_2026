'use client';

// Brief Studio rail - Content card: title + the Markdown textarea (paste the
// breakdown) + a character count. The document is rendered exactly as pasted:
// each `##` heading becomes a section.

import React from 'react';
import { FileText } from 'lucide-react';
import { RailCard, GLASS, ui } from '../../components/rail-ui';
import { RailTextInput, RailField, RailEmptyHint, railFieldStyle } from '../../invoice/rail/rail-field-controls';
import { BRIEF_MAX_CHARS } from '../brief-draft-storage';

export default function ContentCard({ draft, open, onToggle }) {
  const over = draft.text.length > BRIEF_MAX_CHARS;
  return (
    <RailCard
      id="brief-rail-content-card" icon={<FileText size={18} strokeWidth={2} />} title="Content"
      subtitle={`${draft.text.length.toLocaleString()} characters`} color="#f59e0b" open={open} onToggle={onToggle}
    >
      <RailTextInput
        label="Title (blank = first heading)" value={draft.title} placeholder="Client Brief"
        onChange={draft.setTitle} maxLength={140}
      />
      <RailField label="Markdown">
        <textarea
          id="brief-rail-markdown-input"
          value={draft.text}
          rows={16}
          spellCheck={false}
          placeholder="Paste the client breakdown (Markdown). Each ## heading starts a section."
          onChange={(e) => draft.setText(e.target.value)}
          style={{ ...railFieldStyle.textarea, minHeight: 220, fontFamily: GLASS.mono, fontSize: 11.5 }}
        />
      </RailField>
      <span id="brief-rail-char-count" style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: over ? '#dc2626' : GLASS.inkMute }}>
        {draft.text.length.toLocaleString()} / {BRIEF_MAX_CHARS.toLocaleString()} characters{over ? ' (too long to publish)' : ''}
      </span>
      <RailEmptyHint>
        Published exactly as pasted, in the same order. Content before the first ## goes under the cover.
      </RailEmptyHint>
    </RailCard>
  );
}
