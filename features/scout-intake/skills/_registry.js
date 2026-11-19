'use strict';

// _registry.js — Enumerates available analyzer skills.
//
// Reads the skills/ directory at require time and builds a static map of
// skillId → absolute file path. Files prefixed with '_' are infrastructure
// (runner, registry, contract) and are excluded. Only .md files are skills.
//
// SKILL_REGISTRY is built once at module load. If a new .md file is added
// to the skills/ directory, the process must restart to pick it up.

const fs   = require('fs');
const path = require('path');

const SKILLS_DIR = __dirname;

function buildRegistry() {
  const entries = {};
  let files;
  try {
    files = fs.readdirSync(SKILLS_DIR);
  } catch (err) {
    console.error(`[skill-registry] cannot read ${SKILLS_DIR}: ${err?.message}. Every analyzer skill will fail with "not found in registry" (check next.config.mjs outputFileTracingIncludes).`);
    return entries;
  }
  for (const file of files) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const skillId = file.replace(/\.md$/, '');
    entries[skillId] = path.join(SKILLS_DIR, file);
  }
  if (Object.keys(entries).length === 0) {
    console.error(`[skill-registry] no skill .md files found in ${SKILLS_DIR}. Every analyzer skill will fail with "not found in registry" (check next.config.mjs outputFileTracingIncludes).`);
  }
  return entries;
}

// Static map: { skillId: absolutePath }
const SKILL_REGISTRY = buildRegistry();

/**
 * Return the absolute path for a skill, or null if not registered.
 * @param {string} skillId
 * @returns {string|null}
 */
function getSkillPath(skillId) {
  return SKILL_REGISTRY[skillId] || null;
}

/**
 * Return all registered skill ids.
 * @returns {string[]}
 */
function listSkillIds() {
  return Object.keys(SKILL_REGISTRY);
}

module.exports = { SKILL_REGISTRY, getSkillPath, listSkillIds };
