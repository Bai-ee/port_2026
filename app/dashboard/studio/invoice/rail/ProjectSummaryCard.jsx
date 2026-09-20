'use client';

// Invoice Studio rail — Summary card. Prints as "Summary" (render.js's
// buildProjectSummary -> block('invoice-project-summary-section', 'Summary',
// ...)). ⚠️ That section only ever prints DERIVED counts (category/line-item
// tallies) and `meta.preparedBy` — none of which are addressable draft
// fields (no model path for a derived tally; meta.preparedBy isn't in
// invoice-fields.js's FIELD_PATHS either). `projectTitle`/`projectSubtitle`
// ARE read by the builder (`const { projectTitle, projectSubtitle, ... }`)
// but only ever reach `<head><title>` — see render.js's own comment on
// buildProjectSummary and the P0 handoff note. They're kept editable here
// (their only other honest home) with that fact stated plainly rather than
// silently dropped.

import React from 'react';
import { ClipboardList } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailFieldGrid, RailTextInput, RailEmptyHint } from './rail-field-controls';
import { parseValue } from '../invoice-fields';

export default function ProjectSummaryCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  return (
    <SectionCard
      sectionId="projectSummary" id="invoice-rail-project-summary-card" title="Summary"
      icon={<ClipboardList size={18} strokeWidth={2} />} color="#6366f1"
      open={open} onToggle={onToggle} draft={draft}
    >
      <RailEmptyHint>
        Prints category/line-item counts, plus "Prepared by" if set elsewhere. Computed, not editable here.
      </RailEmptyHint>
      <RailFieldGrid>
        <RailTextInput path="projectTitle" label="Project title" value={invoice.projectTitle} onChange={(v) => edit('projectTitle', 'text', v)} />
        <RailTextInput path="projectSubtitle" label="Project subtitle" value={invoice.projectSubtitle} onChange={(v) => edit('projectSubtitle', 'text', v)} />
      </RailFieldGrid>
      <RailEmptyHint>
        Sets the browser tab and downloaded file name only. Doesn&apos;t print on the sheet.
      </RailEmptyHint>
    </SectionCard>
  );
}
