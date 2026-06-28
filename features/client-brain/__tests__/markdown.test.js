import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileClientBrainMarkdown,
  createClientBrainMarkdownTemplate,
  parseFrontmatter,
  parseSections,
} from '../markdown.cjs';

const SAMPLE = `---
schemaVersion: hitloop.client-brain.v1
clientId: bryan-balli
clientName: Bryan Balli
status: approved
updatedAt: 2026-06-26
---

# Client Brain

## Identity Intelligence

### Name
Bryan Balli

### Category To Own
- Creative Systems Architecture
- Design Engineering

### Category To Avoid
- Generic AI agency

### Positioning
Human-in-the-loop creative systems partner for founders.

### Primary Audience
- Startup founders
- Creative agencies

### Offers
- Creative systems architecture

## Market Intelligence

### Search Keywords
- creative systems
- design engineering

### Competitors
- Example Studio

### Thought Leaders
- @opsleader

### Publications
- Figma blog

### Communities
- Designer founders

### Topics To Monitor
- creative automation

## Discovery Intelligence

### Keywords
- creative systems architecture
- AI workflow design

### Primary Platforms
- web
- x
- linkedin

### Communities
- Creative technologists

### Publications
- Figma blog

### Podcasts
- Design Better

### Events
- Config

### Directories
- Clutch

### Awards
- Webby Awards

### Social Ecosystems
- Design Twitter

### Hashtags
- #designengineering

### Watch Lists
- @opsleader

## Authority Intelligence

### Proof Points
- 15+ years enterprise creative technology

### Work History
- Greystripe
- Conversant

### Allowed Claims
- Enterprise creative technology experience

### Prohibited Claims
- Guaranteed growth

## Content Intelligence

### Content Pillars
- AI Integration Notes
- Creative Systems

### Recurring Series
- Project Diaries

### Voice
Direct, precise, systems-minded, low-fluff.

### Do Not Say
- revolutionary

### Calls To Action
- Book a working session

## Opportunity Intelligence

### ICP Segments
- AI SaaS founders

### Verticals
- Developer tools

### Geographies
- Chicago

### Lead Gen Targets
- Series A AI SaaS companies
`;

test('parseFrontmatter reads CLIENT_BRAIN.md metadata', () => {
  const { frontmatter, body } = parseFrontmatter(SAMPLE);
  assert.equal(frontmatter.schemaVersion, 'hitloop.client-brain.v1');
  assert.equal(frontmatter.clientId, 'bryan-balli');
  assert.match(body, /Identity Intelligence/);
});

test('parseSections maps h2 domains and h3 fields', () => {
  const { body } = parseFrontmatter(SAMPLE);
  const sections = parseSections(body);
  assert.match(sections.identity_intelligence.name, /Bryan Balli/);
  assert.match(sections.market_intelligence.search_keywords, /creative systems/);
});

test('compileClientBrainMarkdown produces runtime Client Brain state', () => {
  const brain = compileClientBrainMarkdown(SAMPLE);
  assert.equal(brain.clientId, 'bryan-balli');
  assert.equal(brain.status, 'approved');
  assert.equal(brain.generatedBy, 'markdown');
  assert.equal(brain.identity.name, 'Bryan Balli');
  assert.equal(brain.positioning.oneLiner, 'Human-in-the-loop creative systems partner for founders.');
  assert.deepEqual(brain.audience.primary, ['Startup founders', 'Creative agencies']);
  assert.ok(brain.decisions.intelligence.identity.categoryToOwn.value.includes('Creative Systems Architecture'));
  assert.ok(brain.decisions.intelligence.market.thoughtLeaders.value.includes('@opsleader'));
  assert.ok(brain.decisions.intelligence.discovery.keywords.value.includes('creative systems architecture'));
  assert.ok(brain.decisions.intelligence.discovery.podcasts.value.includes('Design Better'));
  assert.ok(brain.decisions.intelligence.authority.trustReasons.value.includes('15+ years enterprise creative technology'));
  assert.ok(brain.decisions.decisionDrivers[0].search.includes('creative automation'));
  assert.ok(brain.decisions.decisionDrivers[0].leadGen.includes('Series A AI SaaS companies'));
  assert.equal(brain.decisions.identity.name.acquisition.method, 'manual');
  assert.equal(brain.decisions.identity.name.acquisition.validationStatus, 'approved');
  assert.ok(brain.discovery.watchLists.includes('@opsleader'));
  assert.match(brain.aiContextPack.shortContext, /Bryan Balli/);
  assert.equal(brain.sourceRefs[0].id, 'client-brain-md');
});

test('createClientBrainMarkdownTemplate returns a compilable draft', () => {
  const template = createClientBrainMarkdownTemplate({ clientId: 'acme', clientName: 'Acme' });
  const brain = compileClientBrainMarkdown(template);
  assert.equal(brain.clientId, 'acme');
  assert.equal(brain.status, 'draft');
  assert.equal(brain.identity.name, 'Acme');
});

const VOICE_SAMPLE = `---
clientId: bryan-balli
status: approved
---

# Client Brain

## Identity Intelligence

### Name
Bryan Balli

### Positioning
Human-in-the-loop creative systems partner.

## Content Intelligence

### Voice
Direct, dry-witty, builder-to-builder. One idea per post.

### Voice Pillars
- name: Plainspoken | description: trade jargon for plain words | do: "I shipped X" | dont: "We're excited to announce X"
- name: Specific | description: numbers over adjectives | do: "cut load to 1.2s" | dont: "blazing fast"

### Example Posts
- type: observation | label: hook style | post: most "AI strategy" decks are just a feature list with a robot on the cover.
- the bottleneck: nobody owns the prompt. assign one person.

### Creators I Emulate
- @swyx
- @levelsio

### Preferred Words
- shipped, built, cut, owns

### Formatting Rules
- short: 1-2 lines, no hashtags, lowercase ok
- caps: never for emphasis
- emojis: none

### Do Not Say
- revolutionary
- game-changing
`;

test('compileClientBrainMarkdown parses the voice fidelity block', () => {
  const brain = compileClientBrainMarkdown(VOICE_SAMPLE);

  // Voice pillars -> voice.pillars [{name,description,do,dont}]
  assert.equal(brain.voice.pillars.length, 2);
  assert.equal(brain.voice.pillars[0].name, 'Plainspoken');
  assert.equal(brain.voice.pillars[0].do, 'I shipped X');
  assert.equal(brain.voice.pillars[0].dont, "We're excited to announce X");

  // Example posts -> content.postExamples [{type,label,post}] (rich + bare bullet)
  assert.equal(brain.content.postExamples.length, 2);
  assert.equal(brain.content.postExamples[0].type, 'observation');
  assert.equal(brain.content.postExamples[0].label, 'hook style');
  assert.match(brain.content.postExamples[0].post, /robot on the cover/);
  // bare bullet keeps the whole line (colon and all) as the post
  assert.match(brain.content.postExamples[1].post, /the bottleneck: nobody owns the prompt/);

  // Preferred words, keyed formatting rules, creators -> scribeInstructions
  assert.ok(brain.voice.preferredWords.includes('shipped'));
  assert.equal(brain.voice.formattingRules.short, '1-2 lines, no hashtags, lowercase ok');
  assert.equal(brain.voice.formattingRules.emojis, 'none');
  assert.match(brain.voice.scribeInstructions, /Emulate the voice of: @swyx, @levelsio/);
});

test('compileClientBrainMarkdown leaves voice fields empty when block is absent', () => {
  const brain = compileClientBrainMarkdown(SAMPLE);
  assert.deepEqual(brain.voice.pillars, []);
  assert.deepEqual(brain.content.postExamples, []);
  // no Formatting Rules section -> legacy generic array default preserved
  assert.ok(Array.isArray(brain.voice.formattingRules));
});
