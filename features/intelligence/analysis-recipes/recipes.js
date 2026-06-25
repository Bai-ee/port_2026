'use strict';

// recipes.js — Analysis recipe registry.
//
// An "analysis recipe" is a swappable analyzer that reasons over content WE supply
// (e.g. the stored scoutBrief / Marketing Insights agentData) and returns a
// synthesis. Recipes are imported playbooks (e.g. from the marketing-skills
// library) adapted to run headlessly. They live at the Scribe/analyzer altitude —
// they do NOT fetch data and do NOT replace Scout. See SSOT §8.
//
// To add a recipe: drop a <id>.md asset in this folder (frontmatter + prompt body)
// and register it below. The same swap-slot is the A/B mechanism — point a card's
// Tier-1 analyzer at a different recipeId to compare results in production.

const fs = require('fs');
const path = require('path');

// Pinned to the same Sonnet the scout-test path uses, for consistency. Override
// per recipe when a cheaper/heavier model fits.
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 4000;

const RECIPES = {
  'customer-research': {
    id: 'customer-research',
    label: 'Customer Research Synthesis',
    description: 'Extract JTBD, pains, triggers, vocabulary, and money quotes from supplied content; confidence-scored synthesis report.',
    file: 'customer-research.md',
    source: 'coreyhaines31/marketingskills · skills/customer-research (MIT)',
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
  'watchlist-analysis': {
    id: 'watchlist-analysis',
    label: 'Watchlist Brief',
    description: 'Top-of-report scribe over the tracked X handles — what each posts, how each is talked about, the most-engaged spotlight, and a priority action.',
    file: 'watchlist-analysis.md',
    source: 'internal — handle-first X analysis',
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
};

function listRecipes() {
  return Object.values(RECIPES).map(({ id, label, description, source }) => ({ id, label, description, source }));
}

function getRecipe(id) {
  return RECIPES[id] || null;
}

// Load a recipe's prompt body (the markdown after the YAML frontmatter block).
function loadRecipePrompt(id) {
  const recipe = getRecipe(id);
  if (!recipe) throw new Error(`Unknown analysis recipe "${id}". Known: ${Object.keys(RECIPES).join(', ')}`);
  const abs = path.join(__dirname, recipe.file);
  const raw = fs.readFileSync(abs, 'utf8');
  // Strip a leading `---\n...\n---\n` frontmatter block if present.
  const stripped = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  return stripped.trim();
}

module.exports = { RECIPES, DEFAULT_MODEL, DEFAULT_MAX_TOKENS, listRecipes, getRecipe, loadRecipePrompt };
