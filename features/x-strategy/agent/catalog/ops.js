// Brain / signals / digest / refresh / X Monitor / media / archive / web-stats / calendar / operating-cost groups.
// Auth per route key (full table = ROUTE_AUTH in ../action-registry.js):
//  client-brain*, marketing-brief-config, web-stats-config, opportunity-signals-refresh, watchlist-pull, recipe-run,
//  calendar-*, media, marketing-brief-run : Firebase bearer; client = getEffectiveClientContext(request) => admin `?as=` works.
//  x-monitor, archive-inbox               : bearer + isAdminEmail + getEffectiveClientContext (`?as=` works).
//  digest-config, email-digest, cost-report, pre-digest-refresh : verifyAdminRequest(bearer); the client is NOT impersonated,
//                                           it is the explicit clientId in body/query (the runtime always sends it).
//  GET entries pass `args` as query-string params.
import { str, num, int, bool, arr, obj, open } from './_schema.js';

const CFG_SNAP = [{ path: 'client_configs/{clientId}', field: 'marketingBriefConfig' }];
const BRAIN_SNAP = [{ path: 'clients/{clientId}/client_brain/current' }];
const R = (id, group, title, description, route, method, action, args, extra = {}) => ({
  id, group, title, description, route, method, action, args, tier: 0, ...extra,
});

export const BRAIN_ACTIONS = [
  R('brain.get', 'brain', 'Get the Client Brain', 'The stored Client Brain document (status, compiled fields, Markdown source).', 'client-brain', 'GET', null, obj({}, [])),
  R('brain.versions.list', 'brain', 'List Client Brain versions', 'The last 50 saved Brain Markdown versions (timestamps and reasons).', 'client-brain', 'GET', null, obj({}, []), { query: { action: 'versions' } }),
  R('brain.version.get', 'brain', 'Read one Client Brain version', 'One saved Brain version by timestamp.', 'client-brain', 'GET', null, obj({ ts: str('Version timestamp from the list.') }, ['ts']), { query: { action: 'version' } }),
  R('brain.form.get', 'brain', 'Get the Brain form', 'The guided Client Brain form: 7 sections, 81 fields with guidance and current values.', 'client-brain-form', 'GET', null, obj({}, [])),
  R('brain.form.save', 'brain', 'Save Brain form fields', 'Writes form fields into the Brain Markdown (lossless round trip) and saves a new Brain version. Never changes approval status.', 'client-brain-form', 'POST', null,
    obj({ fields: open('Object keyed by form field key -> value (see brain.form.get).') }, ['fields']), { tier: 1, snapshot: BRAIN_SNAP }),
  R('brain.markdown.save', 'brain', 'Replace the Brain Markdown', 'Compiles and saves full Brain Markdown (reason "inject"); an approved Brain then syncs into the cards. Versioned (last 50).', 'client-brain', 'POST', null,
    obj({ markdownSource: str('The complete CLIENT_BRAIN.md text.') }, ['markdownSource']), { tier: 1, snapshot: BRAIN_SNAP }),
  R('brain.sources.save', 'brain', 'Save Brain source references', 'Replaces the Brain\'s sourceRefs list.', 'client-brain-sources', 'POST', null,
    obj({ sourceRefs: arr(open('A source reference {type, label, url?...}.'), 'The full source list.') }, ['sourceRefs']), { tier: 1, snapshot: BRAIN_SNAP }),
  R('brain.generate', 'brain', 'Regenerate the Brain (no model)', 'Deterministic rebuild of the Brain from sources (recompiles stored Markdown when present). Free.', 'client-brain-generate', 'POST', null,
    obj({}, []), { tier: 1, fixed: { mode: 'deterministic' }, snapshot: BRAIN_SNAP }),
  R('brain.approve', 'brain', 'Approve the Client Brain', 'Sets status approved and pushes the Brain into every field it owns (first approve adopts settings into EMPTY sections; Brain wins after).', 'client-brain-approve', 'POST', null,
    obj({}, []), { tier: 2, fixed: { status: 'approved' }, snapshot: BRAIN_SNAP }),
  R('brain.resync', 'brain', 'Re-sync the approved Brain', 'Pushes the already-approved Brain into the cards again. No status change, no adoption. Overwrites card fields the Brain owns.', 'client-brain-approve', 'POST', null,
    obj({}, []), { tier: 2, fixed: { resync: true } }),
  R('brain.generate.llm', 'brain', 'Regenerate the Brain with the model', 'Model-based Brain rewrite from sources (mode llm).', 'client-brain-generate', 'POST', null,
    obj({}, []), { tier: 3, external: 'paid', fixed: { mode: 'llm' }, cost: 'One or more Claude calls to refine the Brain (route allows up to 120 s).', snapshot: BRAIN_SNAP }),
];

export const SIGNALS_ACTIONS = [
  R('signals.config.get', 'signals', 'Get the Market Signals config', 'marketingBriefConfig: sources, searches, kols, brand terms, analysis recipes, opportunity signals, xGrowth profile, Brain defaults.', 'marketing-brief-config', 'GET', null, obj({}, [])),
  R('signals.config.save', 'signals', 'Save the Market Signals config', 'Replaces the Market Signals config. The route resets any field you omit to its default, so send the FULL config from signals.config.get with your edits.', 'marketing-brief-config', 'POST', null,
    obj({ brandName: str('Brand name.'), brandXHandle: str('Brand X handle.'), brandKeywords: str('Comma/newline terms.'), categoryTerms: str('Comma/newline terms.'), sourceFocus: str('Source focus text.'), scoutInstructions: str('Scout instructions.'), agentDataTemplate: str('Agent data template.'),
      freshnessDays: int('1-30.'), sourcePlatforms: arr(str('web|x|reddit|instagram|youtube|tiktok|hackernews'), 'Enabled source platforms.'), searches: arr(open('{label, query, goal}'), 'Up to 8 searches.'), kolSearchMode: str('per-handle | combined.'),
      kols: str('Watchlist handles, comma/newline.'), instagramHandles: str('Instagram accounts.'), competitors: str('Competitors.'), scribeTone: str('Scribe tone.'), scribeHardConstraints: arr(str('Constraint'), 'Hard constraints.'),
      includeClientBrain: bool('Use the Brain.'), guardianReviewerContext: str('Guardian context.'), guardianRestrictedPatterns: arr(str('Pattern'), 'Restricted patterns.'), analysisRecipes: arr(str('Recipe id'), 'Enabled analysis skills.'),
      weather: open('{enabled, zip}'), events: arr(open('{event, date, location, url}'), 'Events.'), localSignals: arr(str('Signal'), 'Local signals.'), calendar: open('{enabled}'), watchlistDetail: open('{tweets, mentions, latestOnly}'),
      opportunitySignals: open('Opportunity Signals config {enabled, platforms, queries[{label,query,enabled}], maxQueriesPerRun, maxItemsPerPlatform, includeInEmail}.'), xGrowth: open('X growth profile {ownHandle, benchmarkHandles, ...}.'), gbpReputation: open('{enabled}'),
      kolsOff: arr(str('Handle'), 'Parked watchlist handles.'), brandKeywordsOff: arr(str('Term'), 'Parked brand terms.'), categoryTermsOff: arr(str('Term'), 'Parked category terms.'), expectedClientId: str('Refused (409) if the dashboard client differs.') }, []),
    { tier: 2, snapshot: CFG_SNAP }),
  R('signals.brief.run', 'signals', 'Run a scoped market brief', 'Runs the Scout pipeline for a scope: marketing-director = fresh market signals only; social-media-manager = 30-day campaign + today\'s post from the stored scout brief.', 'marketing-brief-run', 'POST', null,
    obj({ scope: str('marketing-director | social-media-manager.', { enum: ['marketing-director', 'social-media-manager'] }) }, ['scope']),
    { tier: 3, external: 'paid', viaRefreshPanel: true, refreshGroupsByArg: { arg: 'scope', map: { 'marketing-director': ['market-signals'] } }, cost: 'marketing-director: Scout about $0.10 plus ScrapeCreators credits; social-media-manager: model calls (a few cents).' }),
  R('signals.recipes.list', 'signals', 'List analysis skills', 'Registered analysis recipes (ids, labels, content kinds).', 'recipe-run', 'GET', null, obj({}, [])),
  R('signals.recipes.run', 'signals', 'Run analysis skills', 'Runs up to 4 analysis recipes over stored signals (writes nothing, returns the analysis). One model call per skill.', 'recipe-run', 'POST', null,
    obj({ recipeIds: arr(str('customer-research | watchlist-analysis | reply-targets | reddit-analysis | x-market-talk | instagram-analysis | opportunity-signals'), 'Up to 4 recipe ids.') }, ['recipeIds']),
    { tier: 3, external: 'paid', cost: 'One Claude call per skill (about $0.02 each, observed once).' }),
  R('signals.watchlist.pull', 'signals', 'Pull the X watchlist', 'Fetches the watchlist handles\' recent posts/mentions and runs the watchlist analysis; stores timelines in dashboard_state.', 'watchlist-pull', 'POST', null,
    obj({ detail: open('{tweets?: boolean, mentions?: boolean, latestOnly?: boolean}') }, []),
    { tier: 3, external: 'paid', cost: 'ScrapeCreators credits per handle + one analysis model call.' }),
  R('signals.opportunities.refresh', 'signals', 'Refresh Opportunity Signals (paid X)', 'Searches X/Reddit/Instagram for buying signals. The X part uses the PAID X API (about one call per enabled query row, up to maxQueriesPerRun).', 'opportunity-signals-refresh', 'POST', null,
    obj({}, []), { tier: 3, external: 'paid', cost: 'About 1 paid X API call per enabled Opportunity query row (cap maxQueriesPerRun, default 4) + ScrapeCreators for Reddit/IG.' }),
  R('web-stats.config.get', 'signals', 'Get the web stats config', 'GA4 property id, tracked events and homepage toggle.', 'web-stats-config', 'GET', null, obj({}, [])),
  R('web-stats.config.save', 'signals', 'Save the web stats config', 'Replaces the GA4 property id, tracked events and homepage toggle (omitted fields reset).', 'web-stats-config', 'POST', null,
    obj({ ga4PropertyId: str('Numeric GA4 property id.'), trackedEvents: arr(str('Event name'), 'Tracked event names (max 40).'), homepageEnabled: bool('Show homepage stats; default true.') }, []),
    { tier: 1, snapshot: [{ path: 'client_configs/{clientId}', field: 'webStatsConfig' }] }),
];

export const REFRESH_DAILY_ACTIONS = [
  R('refresh.daily.get', 'refresh', 'Get the Daily (automatic) refresh profile', 'Refresh groups the daily crons run (Refresh "Daily" tab): enabled + groups. saved:false = no profile yet (shows what the crons ran before).', 'refresh-daily', 'GET', null, obj({}, [])),
  R('refresh.daily.save', 'refresh', 'Change what refreshes automatically every day', 'Saves the Daily refresh profile: enabled (false = nothing refreshes on its own) + groups. Ticked paid groups spend every day until unticked.', 'refresh-daily', 'POST', null,
    obj({ enabled: bool('Run automatically every day.'), groups: arr(str('market-signals | x-search | analysis | renders | today-queue'), 'Groups the crons run.') }, ['enabled', 'groups']),
    { tier: 3, external: 'paid', cost: 'Standing daily spend for every ticked paid group (Scout ~$0.10, model calls, render cost, paid X search) until unticked.', snapshot: [{ path: 'digest_config/{clientId}', field: 'refreshDaily' }] }),
];

export const DIGEST_ACTIONS = [
  R('digest.config.get', 'digest', 'Get the digest config', 'Email digest settings for a client: includes, schedule, tone, recipient, order, auto-publish.', 'email-digest', 'POST', 'config', obj({}, [])),
  R('digest.status', 'digest', 'Get digest delivery status', 'Durable delivery record + circuit-breaker state for a client/day.', 'email-digest', 'POST', 'status', obj({ dateKey: str('YYYY-MM-DD client-local day; default today.') }, [])),
  R('digest.preview', 'digest', 'Preview the digest (no model)', 'Renders the digest from saved data with noLlm; template mode uses placeholders. Sends nothing.', 'email-digest', 'POST', 'preview',
    obj({ mode: str('template | live.', { enum: ['template', 'live'] }), includeKeys: arr(str('Section key'), 'Sections to turn on for the preview.') }, []), { fixed: { noLlm: true } }),
  R('digest.config.save', 'digest', 'Save digest content settings', 'Saves what the digest contains (tone, include toggles, order, recipient, brief link, contact URL). Cannot change the schedule or publishing.', 'digest-config', 'POST', null,
    obj({ summaryEnabled: bool('AI summary on/off.'), tone: str('Tone, max 200 chars.'), extraInstructions: str('Max 2000 chars.'), include: open('Section include toggles {sectionKey: boolean}.'), order: arr(str('Section key'), 'Section order.'),
      recipientEmail: str('Send-to address; blank = admin address.'), briefLinkMode: str('fresh | latest | off.', { enum: ['fresh', 'latest', 'off'] }), contactUrl: str('Calendly/contact URL.'), recentDocsCount: int('1-20.'), maxDocChars: int('500-40000.'),
      homeClientId: str('Client whose KB feeds the digest.'), includeClientIds: arr(str('Client id'), 'Clients included.'), postPlatforms: open('Suggested-post platforms.'), demoMetrics: open('Demo metric toggles.'), clientId: str('Client to configure.') }, []),
    { tier: 1, snapshot: [{ path: 'digest_config/{clientId}' }] }),
  R('digest.reset-breaker', 'digest', 'Reset the digest circuit breaker', 'Re-opens the send gate for a client after an outage (refused when the email transport is unhealthy).', 'email-digest', 'POST', 'reset-breaker', obj({}, []), { tier: 2 }),
  R('digest.schedule.save', 'digest', 'Turn the daily email on/off or reschedule', 'Changes the daily-email schedule (enabled, hour, weekday, timezone), daily video and daily X search. Enabled = the cron emails the recipient every day and spends on refreshes.', 'digest-config', 'POST', null,
    obj({ schedule: open('{enabled, hour, weekday, timezone, ...}'), dailyVideo: open('Daily video settings.'), dailyXSearch: bool('Run the paid X market-talk search daily.'), clientId: str('Client to configure.') }, ['schedule']),
    { tier: 3, external: 'email', cost: 'When enabled: one email per scheduled run plus the pre-digest refresh model/ScrapeCreators spend (about $10/day was the pre-opt-in leak).', snapshot: [{ path: 'digest_config/{clientId}' }] }),
  R('digest.autopublish.save', 'digest', 'Change digest auto-publish to X', 'Changes whether the daily video / digest posts publish to X automatically (auto, approval or off).', 'digest-config', 'POST', null,
    obj({ autoPublish: open('Per-platform mode {x: off|auto|approval, ...}.'), autoPostX: bool('Legacy auto-post to X flag.'), clientId: str('Client to configure.') }, []),
    { tier: 3, external: 'x', cost: 'One X API write per auto-published post.', snapshot: [{ path: 'digest_config/{clientId}' }] }),
  R('digest.send-now', 'digest', 'Send the digest email now', 'Sends the saved-data digest to the configured recipient immediately (idempotent per client/day).', 'email-digest', 'POST', 'send-now', obj({ requestId: str('Idempotency request id.') }, []),
    { tier: 3, external: 'email', irreversible: true, cost: 'One email via Resend (and possible suggested-post side effects per digest settings).' }),
  R('digest.retry-delivery', 'digest', 'Retry a failed digest delivery', 'Replays the stored render of a failed delivery through Resend (same idempotency key). No model call.', 'email-digest', 'POST', 'retry',
    obj({ dateKey: str('YYYY-MM-DD client-local day.'), deliveryId: str('Delivery id from digest.status.') }, []), { tier: 3, external: 'email', irreversible: true, cost: 'One email via Resend.' }),
];

export const REFRESH_ACTIONS = [
  R('refresh.signals', 'refresh', 'Refresh market signals (Refresh group 1)', 'pre-digest-refresh phase=signals: Scout + watchlist + Reddit/IG/web searches + opportunity search (no paid X search).', 'pre-digest-refresh', 'GET', null,
    obj({ force: str('1 to bypass the 6-hour Scout freshness skip.') }, []), { tier: 3, external: 'paid', viaRefreshPanel: true, refreshGroups: ['market-signals'], query: { phase: 'signals' }, cost: 'Scout about $0.10 + ScrapeCreators credits + model calls.' }),
  R('refresh.analysis', 'refresh', 'Refresh analysis (Refresh group 3)', 'pre-digest-refresh phase=analysis: Reddit/IG/opportunity analyzers, strategy and reply targets, brief summaries, hosted brief.', 'pre-digest-refresh', 'GET', null,
    obj({}, []), { tier: 3, external: 'paid', viaRefreshPanel: true, refreshGroups: ['analysis'], query: { phase: 'analysis' }, cost: 'Several Claude calls (analysis skills on).' }),
  R('refresh.x-search', 'refresh', 'Refresh X search (Refresh group 2)', 'pre-digest-refresh phase=signals with allowX=1: runs the PAID X searches (Opportunity Signals X part and Market Talk on X).', 'pre-digest-refresh', 'GET', null,
    obj({}, []), { tier: 3, external: 'paid', viaRefreshPanel: true, refreshGroups: ['x-search'], query: { phase: 'signals', allowX: '1' }, cost: 'About 1 paid X API call per enabled Opportunity query row, plus 1 for Market Talk if enabled; plus Scout/ScrapeCreators.' }),
  R('refresh.renders', 'refresh', 'Refresh renders (Refresh group 7)', 'pre-digest-refresh phase=modules: creative and video module renders.', 'pre-digest-refresh', 'GET', null,
    obj({}, []), { tier: 3, external: 'paid', viaRefreshPanel: true, refreshGroups: ['renders'], query: { phase: 'modules' }, cost: 'Studio/video render cost (Cloud Run GPU).' }),
];

export const XMONITOR_ACTIONS = [
  R('xmonitor.get', 'xmonitor', 'Get the X Monitor overview', 'Connection state, account, follower snapshots, audience events, per-post metrics and the call estimate. Free (stored data).', 'x-monitor', 'GET', null, obj({}, [])),
  R('xmonitor.sync-profile', 'xmonitor', 'Sync X profile counters', 'Refreshes follower/following/post counts from the X API.', 'x-monitor', 'POST', 'sync-profile', obj({}, []), { tier: 3, external: 'paid', cost: '1 metered X API call.' }),
  R('xmonitor.sync-posts', 'xmonitor', 'Sync X post metrics', 'Pulls recent posts with impressions/engagement from the X API (deep = more pages).', 'x-monitor', 'POST', 'sync-posts', obj({ deep: bool('Fetch more history.') }, []), { tier: 3, external: 'paid', cost: '1 metered X API call (100 posts); deep adds pages.' }),
  R('xmonitor.sync-audience', 'xmonitor', 'Sync the follower roster', 'Pulls the follower roster to diff gained/lost followers.', 'x-monitor', 'POST', 'sync-audience', obj({}, []), { tier: 3, external: 'paid', cost: 'About 1 metered X API call per 1,000 followers.' }),
  R('xmonitor.sync-all', 'xmonitor', 'Sync everything in X Monitor', 'Profile + posts + audience in one go (Refresh group 6).', 'x-monitor', 'POST', 'sync-all', obj({}, []), { tier: 3, external: 'paid', viaRefreshPanel: true, refreshGroups: ['x-monitor'], cost: 'About 2 metered X API calls plus 1 per 1,000 followers.' }),
];

export const MEDIA_ACTIONS = [
  R('media.index', 'media', 'List the media library', 'Media Library folders (and a folder\'s files with signed URLs); sync=1 re-sweeps the bucket into the index.', 'media', 'GET', null,
    obj({ folder: str('Folder to list files for.'), sync: str('"1" to force an index sweep.') }, []), { query: { action: 'media-index' } }),
  R('media.folders', 'media', 'List source folders', 'EditVideos source folders, optionally with file counts.', 'media', 'GET', null, obj({ withCounts: str('"1" for counts.') }, []), { query: { action: 'folders' } }),
  R('media.folder-files', 'media', 'List a folder\'s media', 'Files in one source folder (limit default 60).', 'media', 'GET', null, obj({ folder: str('Folder name.'), limit: int('Max files.') }, ['folder']), { query: { action: 'folder-files' } }),
  R('media.jobs', 'media', 'List media jobs', 'Recent video-remix / archive media jobs for the client (reconciles active ones).', 'media', 'GET', null, obj({ type: str('Job type filter, e.g. video-remix.') }, []), { query: { action: 'jobs' } }),
  R('media.job', 'media', 'Get one media job', 'One media job (reconciled against EditVideos).', 'media', 'GET', null, obj({ jobId: str('Media job id.') }, ['jobId']), { query: { action: 'job' } }),
  R('media.usage', 'media', 'Get media usage', 'EditVideos storage/usage summary.', 'media', 'GET', null, obj({}, []), { query: { action: 'usage' } }),
  R('media.create-folder', 'media', 'Create a media folder', 'Adds an empty folder to the Media Library index.', 'media', 'POST', null, obj({ name: str('Folder name.') }, ['name']), { tier: 1, query: { action: 'create-folder' } }),
  R('media.move', 'media', 'Move media files to a folder', 'Moves up to 25 source files to another folder (bucket + index). Reversible by moving them back; not auto-undoable.', 'media', 'POST', null,
    obj({ files: arr(open('{fullPath, name} of each file.'), 'Up to 25 files.'), targetFolder: str('Destination folder.') }, ['files', 'targetFolder']), { tier: 1, query: { action: 'move-media' } }),
  R('media.rename-folder', 'media', 'Rename a media folder', 'Renames a folder, moving every file in it. Reversible by renaming back; not auto-undoable.', 'media', 'POST', null,
    obj({ folder: str('Current folder name.'), newName: str('New name.') }, ['folder', 'newName']), { tier: 1, query: { action: 'rename-folder' } }),
  R('media.delete-folder', 'media', 'Delete a media folder', 'Deletes a folder AND every file in it from the source bucket.', 'media', 'POST', null,
    obj({ folder: str('Folder name.') }, ['folder']), { tier: 2, irreversible: true, query: { action: 'delete-folder' } }),
  R('media.delete-files', 'media', 'Delete media files', 'Deletes up to 25 source files from the bucket and the index.', 'media', 'POST', null,
    obj({ files: arr(open('{fullPath, name} of each file.'), 'Up to 25 files.') }, ['files']), { tier: 2, irreversible: true, query: { action: 'delete-source-media' } }),
  R('media.delete-remix', 'media', 'Delete a rendered remix', 'Hard-deletes a rendered video-remix from hosting and the card; the job is marked so it cannot return.', 'media', 'POST', null,
    obj({ jobId: str('Media job id.') }, ['jobId']), { tier: 2, irreversible: true, query: { action: 'delete-remix' } }),
  R('media.remix.create', 'media', 'Render a video remix', 'Queues a video remix through the EditVideos pipeline (GitHub Actions worker). Recipe fields are validated server-side (sourceFolders, filter look, logos, audio, layout).', 'media', 'POST', null,
    obj({ sourceFolders: arr(str('Folder'), 'Source folders (one folder = auto clip order).'), videoOrder: arr(str('Clip path'), 'Explicit clip order (single folder only).') }, ['sourceFolders'], { additionalProperties: true }),
    { tier: 3, external: 'paid', query: { action: 'create-video-remix' }, cost: 'One EditVideos render (GitHub Actions minutes + storage); no per-render dollar figure is documented.' }),
  R('archive.estimate', 'media', 'Estimate an Arweave archive', 'Cost estimate for archiving files to Arweave. Admin; no upload.', 'media', 'POST', null, obj({ files: arr(open('{fullPath, name, source}'), 'Files to estimate.') }, ['files']), { query: { action: 'archive-estimate' } }),
  R('archive.sources', 'media', 'List archive sources', 'Folders/files available to archive.', 'media', 'GET', null, obj({ folder: str('Folder.'), limit: int('Max files.') }, []), { query: { action: 'archive-sources' } }),
  R('archive.manifest', 'media', 'Get the archive manifest', 'The Arweave archive manifest.', 'media', 'GET', null, obj({}, []), { query: { action: 'archive-manifest' } }),
  R('archive.job', 'media', 'Get an archive job', 'Status of an archive job.', 'media', 'GET', null, obj({ jobId: str('Archive job id.') }, ['jobId']), { query: { action: 'archive-job' } }),
  R('archive.upload', 'media', 'Archive files to Arweave', 'Uploads up to 25 files permanently to Arweave from the wallet-funded EditVideos wallet. Permanent and cannot be deleted.', 'media', 'POST', null,
    obj({ files: arr(open('{fullPath, name, source}'), 'Up to 25 files.') }, ['files']),
    { tier: 3, external: 'arweave', irreversible: true, query: { action: 'archive-to-arweave' }, cost: 'Arweave storage from the funded wallet; run archive.estimate first.' }),
  R('archive.deploy-website', 'media', 'Deploy the Arweave website', 'Deploys the microsite to Arweave (permanent upload from the wallet).', 'media', 'POST', null, obj({ websiteDir: str('Website directory.') }, []),
    { tier: 3, external: 'arweave', irreversible: true, query: { action: 'deploy-website' }, cost: 'Arweave storage from the funded wallet.' }),
  R('archive.update-arns', 'media', 'Point the ArNS name at a manifest', 'Updates the ArNS record to a manifest id (on-chain, paid).', 'media', 'POST', null, obj({ manifestId: str('Arweave manifest id.') }, ['manifestId']),
    { tier: 3, external: 'arweave', irreversible: true, query: { action: 'update-arns' }, cost: 'One on-chain ArNS update transaction.' }),
  R('archive.inbox.get', 'media', 'Get the archive inbox', 'Archive items awaiting a story/title with permanence status.', 'archive-inbox', 'GET', null, obj({}, []), { query: { action: 'inbox' } }),
  R('archive.inbox.save-story', 'media', 'Save an archive item\'s story', 'Saves story/title/series/pillar for an archive inbox item (creates or updates its library package).', 'archive-inbox', 'POST', null,
    obj({ id: str('Item id.'), story: str('Story text.'), title: str('Title.'), sha256: str('File SHA-256.'), series: str('Series.'), pillar: str('Pillar.') }, ['id']), { tier: 1, query: { action: 'save-story' } }),
];

export const OTHER_ACTIONS = [
  R('calendar.google.status', 'calendar', 'Google Calendar connection status', 'Whether the client\'s Google Calendar is connected and which calendar feeds the digest agenda.', 'calendar-status', 'GET', null, obj({}, [])),
  R('calendar.google.disconnect', 'calendar', 'Disconnect Google Calendar', 'Removes the stored Google Calendar tokens; the digest agenda stops. Reconnecting needs the owner to sign in with Google again.', 'calendar-disconnect', 'POST', null, obj({}, []), { tier: 2, irreversible: true }),
  R('ops.cost-report', 'other', 'Get the operating cost report', 'Live per-run / per-client / per-provider spend (Anthropic, ScrapeCreators, Browserless). Read-only.', 'cost-report', 'GET', null, obj({ days: int('Window in days; default 30.') }, [])),
];
