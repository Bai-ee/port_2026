'use strict';

// Core of the Brain Builder form route (kept out of route.js so it can be
// tested without Next). Auth lives in route.js; these take a resolved clientId.

const {
  readClientBrainDoc,
  compileAndSaveClientBrainMarkdown,
  saveClientBrain,
} = require('../../../../../features/client-brain/store.cjs');
const { markdownToForm, formToMarkdown, FormValidationError } = require('../../../../../features/client-brain/form-markdown.cjs');
const { countFilled } = require('../../../../../features/client-brain/form-schema.js');

function shape(clientId, doc) {
  const markdownSource = typeof doc?.markdownSource === 'string' ? doc.markdownSource : '';
  const { fields } = markdownToForm(markdownSource);
  return {
    ok: true,
    clientId,
    status: doc?.status || null,
    updatedAt: doc?.updatedAtIso || null,
    version: doc?.version ?? null,
    fields,
    filled: countFilled(fields),
    markdownSource,
  };
}

async function getForm(clientId) {
  return shape(clientId, await readClientBrainDoc(clientId));
}

// Never approves. The existing status is written into the frontmatter before
// compiling (the compiler derives status from it) and re-checked afterwards.
async function saveForm(clientId, fields, { byUid = null, clientName = '' } = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new FormValidationError('"fields" must be an object keyed by field key.');
  }
  const prior = await readClientBrainDoc(clientId);
  const preserved = typeof prior?.markdownSource === 'string' ? prior.markdownSource : '';
  const frontmatter = preserved
    ? (prior?.status ? { status: prior.status } : null)
    : { clientId, ...(clientName ? { clientName } : {}), status: 'draft' };
  const markdown = formToMarkdown(fields, { frontmatter, preserved });
  const saved = await compileAndSaveClientBrainMarkdown(clientId, markdown, { reason: 'form', byUid });
  if (prior?.status && saved?.status !== prior.status) {
    await saveClientBrain(clientId, { status: prior.status });
  }
  return getForm(clientId);
}

module.exports = { getForm, saveForm, FormValidationError };
