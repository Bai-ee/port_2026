// Client / HITLOOP capture template -> ContentPackage (Active Content System §3e).
//
// A capture is the raw material of a client-work post: the problem, the
// decision, the idea that was rejected, the result. This module turns that
// template into a `C6` / engine 'client' package that is approval-gated by
// default. It never writes copy: `story` is Bryan's own words or the
// placeholder `[add your memory]`, which the matcher and the approve-draft
// story gate both refuse. The angle assembled from the template travels as
// `variants.x.suggestedStory` — a prompt for him, not the post.
//
// Pure: no fs, no network, no clock (callers pass `now` if they want a stamp).

import { validatePackage } from './schema.js';

export const STORY_PLACEHOLDER = '[add your memory]';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** The angle: template fields joined into one suggestion. Only fields the
 * caller supplied appear, so nothing is invented. */
export function buildAngle(input = {}) {
  const parts = [
    ['Problem', input.problem],
    ['Decision', input.decision],
    ['Rejected', input.rejectedIdea],
    ['Result', input.result],
  ]
    .map(([label, v]) => [label, str(v)])
    .filter(([, v]) => v)
    .map(([label, v]) => `${label}: ${v}`);
  return parts.join(' | ');
}

/**
 * @param {object} input {client, project, problem, decision, rejectedIdea, result,
 *   assetRefs, rights, story?, id?, title?, angle?, campaign?, priority?}
 * @returns {{ok:boolean, pkg:object|null, errors:string[], warnings:string[]}}
 */
export function buildClientPackage(input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const client = str(i.client);
  const project = str(i.project);
  const errors = [];
  if (!client) errors.push('client is required');
  if (!project && !str(i.title)) errors.push('project (or title) is required');
  if (errors.length) return { ok: false, pkg: null, errors, warnings: [] };

  const owned = i.rights === 'owned';
  const assetRefs = Array.isArray(i.assetRefs) ? i.assetRefs.map(str).filter(Boolean) : [];
  const angle = str(i.angle) || buildAngle(i);
  const story = str(i.story) || STORY_PLACEHOLDER;
  const id = str(i.id) || `client-${slugify(`${client}-${project || i.title}`)}`;

  const pkg = {
    id,
    series: 'C6',
    engine: 'client',
    pillar: 'building-now',
    title: str(i.title) || `${client} — ${project}`,
    story,
    assetRefs,
    mediaState: assetRefs.length ? 'still' : 'none',
    effort: '10-min',
    rights: owned ? 'owned' : 'client-approval-needed',
    platforms: ['x'],
    cta: 'HITLOOP',
    entities: [client, ...(project ? [project] : [])],
    status: 'idea',
    lastPostedAt: null,
    postCount: 0,
    priority: ['pinned', 'timely', 'evergreen'].includes(i.priority) ? i.priority : 'evergreen',
    approval: owned ? { state: 'none' } : { state: 'needed' },
    source: { kind: 'manual' },
    variants: { x: { suggestedStory: angle } },
  };
  if (str(i.campaign)) pkg.campaign = str(i.campaign);

  const verdict = validatePackage(pkg);
  return { ok: verdict.ok, pkg: verdict.ok ? pkg : null, errors: verdict.errors, warnings: verdict.warnings };
}

/** Return `pkg` with its approval decided. `state` is 'approved' | 'rejected'. */
export function applyApproval(pkg, state, by, at) {
  if (!['approved', 'rejected'].includes(state)) {
    throw Object.assign(new Error(`bad approval state: ${state}`), { status: 400 });
  }
  return { ...pkg, approval: { state, ...(by ? { by } : {}), at: at || new Date().toISOString() } };
}
