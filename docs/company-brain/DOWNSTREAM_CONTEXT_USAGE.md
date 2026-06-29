# Downstream Client Brain Usage

Downstream cards consume the compiled Client Brain runtime. They should not parse `CLIENT_BRAIN.md` directly.

## Prompt Context

Use `loadClientBrainContext` when a prompt needs approved voice, positioning, proof, or content guidance.

```js
const clientBrainContext = await loadClientBrainContext(clientId, {
  useFor: 'copy',
  maxChars: 1800,
});
```

Signature:

```js
loadClientBrainContext(clientId, {
  useFor = null,
  maxChars = 2500,
  requireApproved = true,
})
```

Behavior:

- returns `''` when no brain exists
- returns `''` when `requireApproved` is true and brain is not approved
- scopes sections by `useFor`
- applies source/use-for gating when `sourceRefs` exist
- never throws to downstream callers

## Structured Decisions

Use `loadClientBrainDecisions` when a card needs structured decision data.

```js
const { decisions } = await loadClientBrainDecisions(clientId, {
  cardId: 'marketing-brief',
});
```

## Card Defaults

Use `loadClientBrainCardDefaults` when a card wants default field values.

```js
const defaults = await loadClientBrainCardDefaults(clientId, {
  cardId: 'marketing-brief',
});
```

Cards must preserve manual settings:

`manual card setting > approved Client Brain decision > company/default template > hardcoded fallback`

## Voice Profile

The executive/market brief uses structured voice instead of the context string:

```js
const voice = await resolveVoiceProfile(clientId);
```

This reads the compiled brain via `readClientBrainDoc`, requires approval by default, and falls back to file voice when no approved voice exists. `resolveVoiceProfile` carries the full **`few_shot_examples`** (from `CLIENT_BRAIN.md > Example Posts`) — the strongest "sound like me" signal.

### Few-shot reaches the text-pack consumers too

`loadClientBrainContext` no longer emits only a tone summary. When the resolved `useFor`
includes the `voice` section (`tone`, `copy`, `socialPosts`, `emailDigest`), the
`CLIENT CONTEXT` string now also renders:

- `Voice pillar — <name>: do: … ; avoid: …` lines (from `voice.pillars`)
- an `Example posts (imitate this voice, do not copy verbatim):` block (top 4 from `content.postExamples`)
- keyed `Copy rules` (from `voice.formattingRules`)

So Strategy Builder, Post Me, and the reply-targets recipe imitate the operator's
example posts — not just a tone label. One source: `CLIENT_BRAIN.md` (see
`CLIENT_BRAIN_MARKDOWN_STANDARD.md > Voice Fidelity block`).

## Current Consumers

| Consumer | Mode | Status |
|----------|------|--------|
| Strategy Builder | `loadClientBrainContext(..., { useFor:'socialPosts' })` — incl. few-shot | wired |
| Post Me generate-copy | `loadClientBrainContext(..., { useFor:'socialPosts' })` — incl. few-shot | wired |
| Reply Targets (recipe-run) | `loadClientBrainContext(..., { useFor:'copy' })` appended to recipe context — incl. few-shot | wired |
| Email Digest | `loadClientBrainContext(..., { useFor:'emailDigest' })` | wired |
| Creative Brief / named covers | `loadClientBrainContext(..., { useFor:'copy' })` | wired |
| Executive / Market Brief | `resolveVoiceProfile(clientId)` | wired |
| Marketing Brief / Market Signals config | `loadClientBrainCardDefaults(..., { cardId:'marketing-brief' })` | wired |

## Feedback Loop

Cards can write settings back into the Brain snapshot with:

```js
await saveClientBrainCardSettingsSnapshot(clientId, {
  cardId: 'marketing-brief',
  config,
  source: 'card',
  promote: true,
});
```

This is a transitional bridge. Long term, dashboard edits should update `CLIENT_BRAIN.md`, recompile, and then update runtime state.

When `promote: true`, durable card settings are written back as approved `feedback` decisions and the runtime refreshes:

- `decisionAcquisition`
- `completion`
- `missingDecisionQueue`

This is how cards like Marketing Brief / Market Signals can improve Client Brain after onboarding without forcing the entire onboarding flow to rerun.
