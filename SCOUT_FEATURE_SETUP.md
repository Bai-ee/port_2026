# Scout Feature Port

The portable Scout/Scribe/Guardian/Reporter bundle has been copied into:

- `features/not-the-rug-brief`

This repo does not have a server framework yet, so the bundle is currently mounted as a runnable Node feature package rather than a live API route.

## Installed commands

Run from the repo root:

```bash
npm run scout:brief
npm run scout:brief:fresh
npm run scout:weather
npm run scout:reviews
npm run scout:instagram
npm run scout:reddit
```

## Environment

Add the Scout variables from `.env.example` into your local `.env.local` before running the feature.

Required runtime keys:

- `ANTHROPIC_API_KEY`
- `NWS_USER_AGENT`
- `INSTAGRAM_ACCESS_TOKEN`
- `NOT_THE_RUG_INSTAGRAM_USER_ID`
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT`

## Output

Generated artifacts are written under:

- `features/not-the-rug-brief/data/`

That directory is gitignored in the root repo.

## Next integration step

To surface this inside the portfolio dashboard, the next clean step is to add a server-side bridge:

1. A small Node/Express or Vercel Function wrapper that calls `runNotTheRugBrief()`
2. A dashboard panel that fetches the latest artifacts and renders summary cards
3. An internal "Run Scout" action for authenticated users
