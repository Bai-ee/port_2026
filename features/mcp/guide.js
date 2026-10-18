// guide.js - get_hitloop_guide. Static on purpose: the repo's CLAUDE.md is local-only (not on GitHub), so the map
// a model needs to navigate HITLOOP ships inside the server. Keep it short and update it when the SSOT docs move.

import { defTool } from './tools/common.js';

export const GUIDE_TEXT = `HITLOOP map (Next.js 16 app router / React 19 / Firebase / Vercel Pro). Owner: bryanballi@gmail.com. Owner client id: bryan-balli-WUoltG84. Repo: github.com/Bai-ee/port_2026 (main).

WHERE THINGS LIVE
- app/api/**/route.js: HTTP routes (dashboard/*, admin/*, worker/* crons, social-posting, mcp, oauth). api/_lib/*.cjs: shared server runtime (auth, firebase-admin, run-lifecycle, usage-logger). features/*: domain logic (x-strategy, x-content-inventory, social-posting, social-archive, scout-intake, intelligence, client-brain, x-monitor, mcp). components/dashboard/*: dashboard cards. DashboardPage.jsx: card definitions.
- Docs: docs/source-of-truth/*.md are the as-built specs (read the matching one before touching a feature). docs/plans/*.md are plans and handoffs (historical unless linked). Use list_repo_path docs/source-of-truth and read_repo_file.

THE CONTENT SYSTEM (three layers)
1. Knowledge: Client Brain (voice, approved docs), Strategy document (x_strategy_docs: what/why), content library (archive, Timeline, NAS, buckets), Market Signals (material, not strategy).
2. Planning: daily mode (Content Engine loop, x_content_packages + daily runs) and campaign mode (Strategy Builder). Both read the Strategy document and the Brain.
3. Publishing: social_posts queue + calendar + the process-due cron poster. Everything passes the strategy guard (features/x-content-guard).
Flow: Strategy document -> daily suggestions / campaigns -> owner approves -> queue publishes -> results -> Review checks the strategy.

KEY FIRESTORE COLLECTIONS (use list_collections / query_collection / get_document)
clients, client_configs, dashboard_state (per-client card data: marketingBrief, strategyBuilder, ...), social_posts (queue: status draft/approved/scheduled/posted), x_strategy_docs, x_strategy_plans, x_strategy_chats/{client}/threads, x_corpora (post rows per handle), x_content_packages, brief_runs, usage_events (cost ledger), timeline_entries/timeline_days (social archive), x_monitor/{accountId}/(snapshots|posts|audience_events), archive_commands (NAS worker queue), digest_config, mcp_audit.
Credential collections (users, admins, system_flags, calendar_connections, ...) are hidden by design.

SPEND AND SAFETY RULES (hard)
- X API costs real money and its spend is invisible on the cost card. This server never writes to X, never posts, schedules, approves, deletes or emails. Reads of X data go through stored Firestore data; the only X-API action is x_monitor_sync (reads only), which runs solely when the owner presses Confirm on its card in HITLOOP.
- Anything that costs money is request_sync, which only creates a proposal card; the owner presses Confirm in HITLOOP Marketing Director > Strategy (chat) (there is no confirm tool). Market Signals refreshes run from the Refresh button in the Marketing Director header (group 1); there is no request_sync kind for them, so tell the owner to click Refresh. Free syncs: request_strategy_refresh, request_quote_scan (+ quote_scan_status), regenerate_today_suggestions (template drafting only), nas_status/nas_browse/nas_estimate. What the daily crons refresh on their own is the Daily refresh profile (find_actions 'refresh daily'; changing it is a confirm card because ticked paid groups spend every day).
- Proposals (strategy_propose_*) only create pending cards in Marketing Director > Strategy (chat); the owner confirms them there.

WHICH TOOL FOR WHAT
- "What's going on today / what can I do": get_daily_brief, then get_action_playbook for exact paste-ready messages and where to click.
- "What can I post / what is on the calendar": strategy_get_calendar (every possible post per day: saved posts, daily suggestions, requotes; placeholders never block approval, approving removes them).
- "How is the account doing / what should I post / why": strategy_* read tools (evaluation, algorithm, score_posts, rule check, audience, tracks, queue, results).
- "Continue / see the dashboard Strategy chat": chat_threads, chat_thread, chat_send (same threads, same agent, same daily cap; cards are confirmed in Marketing Director > Strategy (chat) in the dashboard). find_actions / get_action_log for the action registry and its log.
- "Show me the data": get_client_overview -> get_document / query_collection; search_timeline for the archive; get_operating_costs; get_x_monitor.
- "How does X work in the code": get_hitloop_guide -> list_repo_path / search_repo / read_repo_file / recent_commits.
`;

export const guideTool = defTool({
  name: 'get_hitloop_guide',
  title: 'HITLOOP system map',
  description: 'A short map of the HITLOOP system: where code and docs live, the three-layer content model, the key Firestore collections, the spend/safety rules, and which tool to use for what. Call this first in a new conversation, before searching the repo or the database. Read-only.',
  handler: () => ({ guide: GUIDE_TEXT }),
});
