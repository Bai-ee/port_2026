# Not The Rug HITLOOP Client Configuration

**Status:** active operational handoff. Last updated 2026-07-05.

Read this before touching the Not The Rug client in HITLOOP, the NTR daily email, or any NTR cutover work.

## Current Client

- HITLOOP client id: `nottherug-ten-QSMYxuuv`
- Website/audit target: `client_configs/nottherug-ten-QSMYxuuv.sourceInputs.websiteUrl`
- Market/email source of truth:
  - `client_configs/nottherug-ten-QSMYxuuv.marketingBriefConfig`
  - `client_configs/nottherug-ten-QSMYxuuv.scoutConfig`
  - `digest_config/nottherug-ten-QSMYxuuv`
  - `clients/nottherug-ten-QSMYxuuv/client_brain/current`

## Important Model

There are two separate "brains" for this client:

- **Scout configuration** decides what HITLOOP searches and fetches. It lives in `client_configs/{clientId}.marketingBriefConfig` and `client_configs/{clientId}.scoutConfig`.
- **Client Brain** decides how NTR sounds. It lives in `clients/{clientId}/client_brain/current` and must be `approved` before downstream copy uses it.

Do not assume uploading or editing `CLIENT_BRAIN.md` alone fixes Scout. It helps voice, summary, and copy context; it does not replace brand terms, competitors, Reddit queries, weather config, source platforms, or digest section toggles.

## Setup Script

The current setup was applied with:

```bash
node scripts/setup-nottherug-hitloop-config.cjs nottherug-ten-QSMYxuuv
```

The script:

- writes a Firestore backup under `config_backups/{clientId}-{timestamp}`;
- seeds NTR brand keywords, category terms, competitors, search rows, Reddit config, Instagram handle, weather, reviews, source focus, and Scribe/Guardian constraints;
- adjusts `digest_config` toward NTR founder-email content;
- keeps daily schedule disabled;
- turns off `autoPostX`;
- prints a normalized runtime summary from `buildRuntimeConfigFromFirestore()`.

If sandbox DNS blocks Firestore, rerun the script with network approval. The script must finish with a `Backup written:` line before any config patch should be considered applied.

## Current Email Posture

The NTR digest is configured for content parity testing, not live cutover:

- `schedule.enabled: false`
- `schedule.frequency: off`
- `schedule.timezone: America/New_York`
- enabled content sections: weather, executive summary, human brief, opportunities, suggested replies, signals, suggested posts, Reddit analysis, Instagram analysis, contact human
- disabled HITLOOP/platform sections: video rows, creative brief, agenda, follower posts, watchlist account rows, plan preview, web analytics, signups, dashboard/pipeline/deploy/runtime sections
- `autoPostX: false`

Do not enable the schedule until a manual preview has been compared against the existing NTR email.

## Verification Flow

1. Inspect current state:

```bash
node scripts/diag-client.mjs nottherug
```

2. Re-run the setup script only if config drift needs repair:

```bash
node scripts/setup-nottherug-hitloop-config.cjs nottherug-ten-QSMYxuuv
```

3. Run a manual per-client refresh/preview from the Email Digest card or the admin digest endpoints. Keep the request scoped to `clientId=nottherug-ten-QSMYxuuv`.

4. Confirm populated content before cutover:

- weather appears for Brooklyn / Williamsburg area;
- Scout output includes NTR brand/local search rows, competitors, local demand, Reddit signals, and content opportunities;
- Scribe/summary voice is warm, local, specific, and not HITLOOP-branded;
- digest preview does not include HITLOOP analytics/platform sections;
- schedule remains off unless intentionally enabling cutover.

## Leads Gap

Leads are not solved by this configuration. The planned approach is still:

- NTR app exposes an authenticated leads export;
- HITLOOP fetches/stages it during pre-digest refresh;
- Email Digest gets an availability-gated `leads` section;
- other clients stay unchanged when no leads source is configured.

Do not retire existing NTR generation/sending until the non-leads email is verified and the leads bridge is implemented or explicitly deferred.

## Files To Read Before Changes

- `scripts/setup-nottherug-hitloop-config.cjs`
- `features/not-the-rug-brief/config-loader.js`
- `features/not-the-rug-brief/runtime.js`
- `features/not-the-rug-brief/voice-resolver.js`
- `features/intelligence/_digest-config.js`
- `app/api/admin/daily-digest/route.js`
- `app/api/worker/pre-digest-refresh/route.js`
- `docs/source-of-truth/MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`
- `docs/source-of-truth/EMAIL-DIGEST-CARD.md`
- `docs/company-brain/DOWNSTREAM_CONTEXT_USAGE.md`
