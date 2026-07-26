# Vercel Hobby deployment strategy

**Status:** as-built and production-verified  
**Last verified:** 2026-07-26  
**Fix commit:** `a4f5b12e`  
**Production project:** `port-2026` / `hitloop.agency`

This document is the source of truth for keeping the full Next.js application deployable on Vercel Hobby. Read it before adding a route-level Vercel configuration, changing `maxDuration`, changing `.vercelignore`, or diagnosing a Hobby deployment failure.

## The failure this prevents

The application has more than 120 App Router API routes. That is allowed: source route count is not the same thing as deployed function count. Vercel bundles compatible Next.js routes into shared functions.

The failed deployment reported:

```text
Error: No more than 12 Serverless Functions can be added to a Deployment
on the Hobby plan.
```

The application had generated **15 functions**. Eleven were API bundles split across these configurations:

```text
maxDuration: default, 10, 20, 30, 60, 90, 120, 180, 300
```

Different function configurations are bundled separately. The old timeout tiers—not the number of product features—were forcing unnecessary function groups.

## As-built fix

[`vercel.json`](../../vercel.json) explicitly:

- enables Fluid Compute;
- gives the standard API surface one `120`-second default;
- retains only the genuinely long `180`- and `300`-second route overrides;
- schedules every Hobby cron no more than once per day.

```json
{
  "fluid": true,
  "functions": {
    "app/api/**/*": {
      "maxDuration": 120
    }
  }
}
```

All formerly short route exports (`10`, `20`, `30`, `60`, and `90`) were normalized to `120`. After the change, the Vercel production builder generated:

```text
10 total functions
5 API bundles
3 API duration classes: 120, 180, 300
```

This is below Hobby's 12-function deployment cap without deleting, hiding, or combining unrelated product endpoints.

## Rules for future API work

1. **Use the shared 120-second tier by default.** Omit `maxDuration` or use `export const maxDuration = 120`.
2. **Use 180 or 300 only when the operation demonstrably needs it.** Prefer an existing tier.
3. **Do not introduce arbitrary timeout values** such as 15, 30, 45, 60, 90, 150, or 240. A unique configuration can create another deployable function.
4. **Do not merge unrelated endpoints merely to reduce source route count.** First inspect generated function groups; compatible routes are already bundled automatically.
5. **Keep long work off Vercel when appropriate.** GPU rendering and clone processing belong in their existing Cloud Run workers. Vercel routes should enqueue, poll, reconcile, or perform bounded orchestration.
6. **Keep Hobby crons daily.** Hobby rejects schedules that execute more than once per day and may invoke a daily cron at any point within its scheduled hour.
7. **Do not weaken auth while consolidating routes.** Cron, worker-secret, admin, public-token, and user-session boundaries must remain explicit.

## Required pre-deploy procedure

Run from the repository root:

```bash
npm test
vercel build --prod
find .vercel/output/functions -name '*.func' -type d | wc -l
find .vercel/output/functions -name '*.func' -type d | sort
```

The function count must be **12 or fewer** before attempting a Hobby deployment.

Inspect the effective API configuration groups:

```bash
find .vercel/output/functions/api -name '.vc-config.json' -print0 |
  xargs -0 node -e '
    const fs = require("fs");
    const groups = new Map();
    for (const file of process.argv.slice(1)) {
      const config = JSON.parse(fs.readFileSync(file));
      const key = JSON.stringify({
        runtime: config.runtime,
        maxDuration: config.maxDuration,
        architecture: config.architecture
      });
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    for (const [key, count] of groups) console.log(count, key);
  '
```

Expected duration classes are `120`, `180`, and `300`. Investigate any new class before deploying.

## Deployment and verification

Deploy the filtered source tree:

```bash
vercel --prod --yes
```

Wait for both:

```text
Build Completed
Deployment completed
```

Then verify the deployment and production alias:

```bash
vercel inspect <deployment-url>
curl -s -o /dev/null -w '%{http_code}\n' https://hitloop.agency/
curl -s -o /dev/null -w '%{http_code}\n' https://hitloop.agency/api/health
```

Both production requests should return `200`. A generated deployment URL may return `302` because access/domain routing differs; the custom production alias is the authoritative public check.

## Bundle-size strategy

`.vercelignore` is load-bearing. It excludes local render outputs and development artifacts from the source upload, especially:

```text
public/ui-teasers/
public/output/
print-screenshots/
scripts/
docs/storyboards/
output/
```

Without that exclusion, local UI-teaser videos can make a traced function hundreds of megabytes larger than Vercel's function-size limit.

Important distinction:

- `vercel build --prod` builds directly from the local working directory and may still report large local ignored artifacts in tracing diagnostics.
- `vercel --prod` uploads the `.vercelignore`-filtered source tree and performs the authoritative remote build.

Do not respond to a local-only size warning by deleting production features. Confirm whether the named files are excluded from the remote upload, then inspect the real deployment.

## Troubleshooting order

When Hobby rejects a deployment:

1. Record the exact error. Do not assume every failure is the 12-function limit.
2. Run the full tests and local Vercel production build.
3. Count generated `.func` directories.
4. Group `.vc-config.json` files by runtime, duration, architecture, memory, and region.
5. Normalize accidental configuration variants to an existing tier.
6. Inspect oversized function dependency lists separately from function-count errors.
7. Confirm `.vercelignore` still excludes generated media and diagnostics.
8. Confirm every cron runs at most once daily.
9. Deploy and inspect the terminal Vercel status.
10. Only consider moving a bounded workload to a worker after proving packaging configuration cannot solve the limit cleanly.

## Known follow-up: Node.js 24

The project currently targets Node.js 20 in Vercel project settings. Vercel warns that deployments created on or after **2026-10-01** will fail until the project uses Node.js 24.

Upgrade and regression-test Node.js separately before that date. Do not mix the runtime migration into an unrelated emergency deployment unless Node 20 has become the active blocker.

## Production verification record

The 2026-07-26 deployment:

- passed `1235/1235` tests;
- built all 131 application pages;
- retained all 128 API routes;
- generated 10 functions locally after normalization;
- completed on Vercel Hobby;
- reached Vercel status `Ready`;
- aliased successfully to `https://hitloop.agency`;
- returned `200` for `/` and `/api/health`.

