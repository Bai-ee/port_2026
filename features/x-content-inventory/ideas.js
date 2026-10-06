// Ideas bucket seeding (Content Engine v2 master plan §3 ②, bucket id 'client').
//
// Turns existing story rows (client stories, UE build stories) and owner-typed
// growth ideas into packages for the "Ideas" bucket. It never writes copy:
// `story` is the owner's own words when the source row has them, otherwise the
// placeholder the approve-draft gate refuses. Approval and rights are carried
// over from the source row untouched — this module never loosens a gate.
//
// Pure: no fs, no network, no clock.

import { STORY_PLACEHOLDER, slugify } from './client-capture.js';
import { normalizeFacets } from './facets.js';

export const IDEAS_BUCKET_ID = 'client';
export const IDEA_KINDS = ['client', 'build', 'growth'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const uniq = (a) => [...new Set(a)];

/** An owner-written story is anything that is not empty / a placeholder. */
export function hasOwnerStory(row) {
  const s = str(row?.story);
  return Boolean(s) && s !== STORY_PLACEHOLDER && !/^todo\b/i.test(s);
}

/**
 * @param {object} row  source row (client story, build story, or growth idea {title, angle, tags})
 * @param {{kind: 'client'|'build'|'growth'}} opts
 * @returns {object} ContentPackage (not validated; callers run validatePackage)
 */
export function toIdeaPackage(row = {}, { kind } = {}) {
  if (!IDEA_KINDS.includes(kind)) throw new Error(`kind must be one of ${IDEA_KINDS.join(', ')}`);
  const r = row && typeof row === 'object' ? row : {};
  const title = str(r.title);
  if (!title) throw new Error('title is required');

  const story = hasOwnerStory(r) ? str(r.story) : STORY_PLACEHOLDER;
  const entities = list(r.entities);
  const tags = uniq([kind, ...list(r.tags)]);

  if (kind === 'growth') {
    const angle = str(r.angle);
    return {
      id: str(r.id) || `idea-growth-${slugify(title)}`,
      series: 'C6',
      engine: 'client',
      bucketId: IDEAS_BUCKET_ID,
      pillar: 'building-now',
      title,
      story,
      assetRefs: [],
      mediaState: 'none',
      effort: '10-min',
      rights: 'owned',
      platforms: ['x'],
      entities,
      status: 'idea',
      lastPostedAt: null,
      postCount: 0,
      priority: 'evergreen',
      approval: { state: 'none' },
      source: { kind: 'manual' },
      tags,
      facets: normalizeFacets({}),
      ...(angle ? { variants: { x: { suggestedStory: angle } } } : {}),
    };
  }

  // client / build: keep the source row as-is, then re-home it. Approval and
  // rights stay exactly what the source said.
  const pkg = { ...r, bucketId: IDEAS_BUCKET_ID, story, tags };
  pkg.facets = normalizeFacets({ ...(r.facets || {}), people: uniq([...list(r.facets?.people), ...entities]) });
  return pkg;
}
