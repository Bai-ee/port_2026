# Not The Rug Brief Bundle

Portable Not The Rug daily brief generator for embedding inside another repo.

## Included runtime

- `index.js` — exported app-facing wrapper
- `run.js` — CLI full pipeline runner
- `xscout.js`, `scribe.js`, `guardian.js`, `reporter.js`
- `clients.js`, `intelligence.js`, `content-schema.js`, `knowledge.js`, `optimizer.js`, `store.js`
- `services/` — weather, reviews, instagram, reddit
- `knowledge/not-the-rug/` — runtime knowledge files

## Install

```bash
npm install
cp .env.example .env
```

## Run manually

```bash
npm run ntr
```

## Use from another app

```js
const { runNotTheRugBrief, getLatestNotTheRugArtifacts } = require('./src/features/not-the-rug-brief');
```

### Server-side entrypoints

- `runNotTheRugBrief({ fresh?: boolean })`
- `getLatestNotTheRugArtifacts()`

`runNotTheRugBrief()` returns:

- latest brief JSON
- latest content JSON
- latest markdown/html artifact paths
- guardian flags
- scout priority action

## Suggested embedding pattern

1. Mount this folder inside the other repo at `src/features/not-the-rug-brief/`
2. Call `runNotTheRugBrief()` from an internal admin route
3. Call the same function from your daily cron job
4. Read `artifacts.latestHtmlPath` to render or iframe the founder-facing brief
5. Use `latestBrief` + `latestContent` for dashboard summary cards

## Artifact paths

All generated files stay local to this package under:

- `data/briefs/not-the-rug/latest.json`
- `data/content/not-the-rug/latest-content.json`
- `data/briefs/not-the-rug/latest-brief.md`
- `data/briefs/not-the-rug/latest-brief.html`

## Notes

- This bundle is intentionally scoped to Not The Rug.
- The HTML renderer is the current founder-facing design source of truth.
- `server.js`, `scheduler.js`, `discordbot.js`, and legacy `orig/` files are intentionally omitted.
