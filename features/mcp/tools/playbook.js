// playbook.js - get_daily_brief (one-call day-to-day snapshot) and get_action_playbook (static catalogue of what the
// owner can do and exactly what to paste/click). Both read-only. The brief composes the SAME readers the strategy_*
// read tools use (runReadTool over toolDepsFor); it adds no Firestore queries of its own.

import { runReadTool } from '../../x-strategy/agent/tools.js';
import { defTool, resolveClientId, CLIENT_ID_PROP } from './common.js';
const MAX_RESULT_CHARS = 38000; // under the server-wide ~40k cap

const DAY_MS = 86_400_000;
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const authFor = (ctx) => ({ decoded: { email: ctx.email, uid: null } });

/** Run one section; a failing section reports its error instead of failing the whole brief. */
async function section(fn) {
  try { return await fn(); } catch (err) { return { error: clip(err?.message || err, 200) }; }
}

export async function buildDailyBrief({ ctx, clientId }) {
  const handlers = ctx.services.strategyHandlers();
  const deps = handlers.toolDepsFor(clientId, { clientId, uid: null, email: ctx.email });
  const nowMs = Number(ctx.now?.() ?? Date.now());

  const today = await section(async () => {
    const run = await runReadTool('get_today_run', {}, deps);
    const list = Array.isArray(run?.suggestions) ? run.suggestions : [];
    const byStatus = {};
    for (const s of list) byStatus[s.status || 'pending'] = (byStatus[s.status || 'pending'] || 0) + 1;
    return { suggestionCount: list.length, byStatus, suggestions: list.slice(0, 12).map((s) => ({ ...s, text: clip(s.text, 200) })) };
  });

  const queue = await section(async () => {
    if (typeof deps.readQueueSummary !== 'function') return { available: false };
    const q = await deps.readQueueSummary();
    const until = nowMs + 7 * DAY_MS;
    const upcoming = (Array.isArray(q?.posts) ? q.posts : [])
      .filter((p) => p.scheduledAt && Date.parse(p.scheduledAt) >= nowMs && Date.parse(p.scheduledAt) <= until)
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
    const countsNext7Days = {};
    for (const p of upcoming) countsNext7Days[p.status] = (countsNext7Days[p.status] || 0) + 1;
    return {
      countsAll: q?.counts || {}, countsNext7Days, scheduledNext7Days: upcoming.length,
      next10: upcoming.slice(0, 10).map((p) => ({ id: p.id, scheduledAt: p.scheduledAt, status: p.status, source: p.source || null, excerpt: clip(p.excerpt, 120) })),
    };
  });

  // InputStatusStrip reads the `content-context` action; get_context is the same summary.
  const inputs = await section(() => runReadTool('get_context', {}, deps));
  const results = await section(() => runReadTool('get_results', {}, deps));
  const opportunities = await section(async () => {
    const o = await runReadTool('get_opportunities', {}, deps);
    return { generatedAt: o?.generatedAt ?? null, stale: o?.stale ?? null, openWindowTargets: (o?.targets || []).filter((t) => t.windowOpen).length };
  });

  const pendingProposals = await section(async () => {
    const h = await handlers.handle('strategy-chat-history', { clientId }, { clientId }, authFor(ctx));
    if (!h || h.ok === false) return { error: clip(h?.error || 'chat unavailable', 120) };
    const threads = Array.isArray(h.threads) ? h.threads : [];
    return { count: threads.reduce((n, t) => n + (t.pendingProposals || 0), 0), threadsChecked: threads.length };
  });

  return {
    clientId, asOf: new Date(nowMs).toISOString(), today, queue, inputs, lastResults: results,
    // The UI keeps per-group "last refreshed" times in the owner's browser only; the server has no record, so they are omitted on purpose.
    refreshFreshness: { contextAsOf: inputs?.asOf ?? null, quoteScan: opportunities, note: 'Per-group Refresh times live only in the dashboard (browser); not available here.' },
    pendingProposalCards: pendingProposals,
    next: 'For performance questions call strategy_get_evaluation. To change something, see get_action_playbook.',
  };
}

const dailyBrief = defTool({
  name: 'get_daily_brief',
  title: 'Daily brief',
  description: 'One-call day-to-day snapshot for the owner: today\'s suggestions, the post queue for the next 7 days (counts + next 10 scheduled items), input status (Brain, plan, corpora, scan, queue freshness), last results summary, what freshness is known, and how many pending proposal cards wait in Marketing Director > Strategy (chat). Free, read-only. Start a day-to-day strategy conversation with this.',
  inputSchema: { type: 'object', properties: { clientId: CLIENT_ID_PROP } },
  kind: 'read',
  redactKeys: false,
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args || {});
    const brief = await buildDailyBrief({ ctx, clientId });
    const s = JSON.stringify(brief);
    return s.length > MAX_RESULT_CHARS ? { truncated: true, note: 'Brief too large; use the individual strategy_* tools.', preview: s.slice(0, MAX_RESULT_CHARS - 200) } : brief;
  },
});

// ---- action playbook ------------------------------------------------------------------------------------------

const MD = 'Marketing Director > WHAT\'S OUR STRATEGY';
const e = (id, label, surface, how, costClass, template, mcpTool = null) => ({ id, label, surface, how, costClass, template, mcpTool });
const chat = (id, label, costClass, template, mcpTool) => e(id, label, `${MD} > Strategy (chat)`, 'chat-message', costClass, template, mcpTool);

export const PLAYBOOK = Object.freeze([
  // Refresh (one button in the Marketing Director header, 7 groups; paid groups need the in-app confirm row)
  e('refresh-market-signals', 'Refresh group 1: Market signals (updates the Market Signals report + watchlist + analysis skills)', 'Marketing Director header > Refresh > Market signals', 'click', 'paid-x-api', null),
  e('refresh-x-search', 'Refresh group 2: X search (opportunity signals; updates quote/reply search results)', 'Marketing Director header > Refresh > X search', 'click', 'paid-x-api', null),
  e('refresh-analysis', 'Refresh group 3: Analysis (analyzers, strategy, reply targets, brief summaries)', 'Marketing Director header > Refresh > Analysis', 'click', 'model', null),
  e('refresh-strategy-accounts', 'Refresh group 4: Strategy accounts (re-pull own + benchmark timelines via the Mac worker)', 'Marketing Director header > Refresh > Strategy accounts', 'click', 'free', null, 'request_strategy_refresh'),
  e('refresh-today-queue', 'Refresh group 5: Today & queue (regenerate today\'s suggestions, month calendar, post results)', 'Marketing Director header > Refresh > Today & queue', 'click', 'free', null, 'regenerate_today_suggestions'),
  e('refresh-x-monitor', 'Refresh group 6: X Monitor (follower/audience/post-metric sync)', 'Marketing Director header > Refresh > X Monitor', 'click', 'paid-x-api', null, 'request_sync'),
  e('refresh-renders', 'Refresh group 7: Renders (video/creative renders)', 'Marketing Director header > Refresh > Renders', 'click', 'render', null),

  // Strategy chat: one entry per in-app propose_* capability. The in-app agent turns the message into a pending card.
  chat('chat-edit-strategy-doc', 'Edit one section of the Strategy document', 'model', 'Edit the strategy doc: in section <section name> change <A> to <B>. Keep the rest of the section as it is.', 'strategy_propose_strategy_doc_edit'),
  chat('chat-change-plan', 'Change the strategy plan (cadence, floors/caps, content tracks)', 'model', 'Change the plan: set <field, e.g. authored posts per day / type floor for video / content track share> to <value>. Show me the proposal card.', 'strategy_propose_plan_change'),
  chat('chat-change-benchmarks', 'Change own handle / benchmark handles', 'model', 'Change benchmarks: own handle <handle>, benchmark handles <handle1>, <handle2> (no @, max as the plan allows).', 'strategy_propose_benchmarks_change'),
  chat('chat-edit-suggestion', 'Rewrite one of today\'s suggestions', 'model', 'Edit today\'s suggestion <slot or id>: replace the text with "<new text>".', 'strategy_propose_suggestion_edit'),
  chat('chat-dismiss-suggestion', 'Dismiss one of today\'s suggestions', 'model', 'Dismiss today\'s suggestion <slot or id>.', 'strategy_propose_suggestion_dismiss'),
  chat('chat-save-suggestion-draft', 'Save one of today\'s suggestions as an unscheduled draft', 'model', 'Save today\'s suggestion <slot or id> as a draft.', 'strategy_propose_suggestion_save_draft'),
  chat('chat-item-story', 'Write the story for a content library item (owner-stated facts only)', 'model', 'Set the story for item <item id or name>. In my own words: "<at least 20 characters of what actually happened>". Write the story using only that.', 'strategy_propose_item_story'),
  chat('chat-regenerate-today', 'Regenerate today\'s suggestions', 'model', 'Regenerate today\'s suggestions.', 'strategy_propose_regenerate_today'),
  chat('chat-refresh-handles', 'Refresh data for specific handles (free local read)', 'free', 'Refresh the data for <handle1>, <handle2>.', 'strategy_propose_refresh_handles'),
  chat('chat-edit-queued-post', 'Edit one queued post (text and/or time of a scheduled one)', 'model', 'Edit queued post <post id>: change the text to "<new text>"<, and move it to <date and time> if it is scheduled>.', 'strategy_propose_post_edit'),
  chat('chat-approve-queued-post', 'Approve one queued post (owner confirms in HITLOOP)', 'free', 'Approve queued post <post id>. Show me the proposal card.', 'strategy_propose_post_approve'),
  chat('chat-schedule-queued-post', 'Schedule one queued post for a future time (owner confirms in HITLOOP)', 'free', 'Schedule queued post <post id> for <date and time, with timezone>. Show me the proposal card.', 'strategy_propose_post_schedule'),
  chat('chat-unschedule-queued-post', 'Unschedule one scheduled post (owner confirms in HITLOOP)', 'free', 'Unschedule post <post id>. Show me the proposal card.', 'strategy_propose_post_unschedule'),

  // Queue & Calendar (buttons, or a proposal card the owner confirms in HITLOOP; MCP can PROPOSE approve/schedule/unschedule but never post, delete, or confirm)
  e('queue-compose', 'Compose a post', `${MD} > Queue & Calendar > Compose`, 'click', 'free', null),
  e('queue-schedule', 'Schedule or approve a post', `${MD} > Queue & Calendar > Calendar (open the post sheet)`, 'click', 'free', null),
  e('queue-post-sheet-edit', 'Edit, reschedule or release a post in the post sheet', `${MD} > Queue & Calendar > Calendar > post sheet`, 'click', 'free', null),
  e('queue-quote-targets', 'Review quote/reply targets', `${MD} > Queue & Calendar > Quote targets`, 'click', 'free', null),

  // Results / X Monitor
  e('results-view', 'Read results and the X Monitor dashboard', `${MD} > Results`, 'click', 'free', null),
  e('results-x-monitor-sync', 'Sync X Monitor (follower/audience/post metrics)', 'Marketing Director header > Refresh > X Monitor (confirm row names the call count)', 'mcp-proposal', 'paid-x-api', null, 'request_sync'),
  e('results-strategy-review', 'Run the paid strategy review', `${MD} > Strategy (confirm the "Run a paid sync" card)`, 'mcp-proposal', 'model', null, 'request_sync'),

  // Telegram (inactive until the owner activates the bot)
  e('telegram-activate', 'Telegram: activate the bot (inactive until then)', 'docs/source-of-truth/TELEGRAM-COMMAND-CENTER.md > Activation; link in Publishing settings > Telegram', 'click', 'free', null),
  e('telegram-menu-help', 'Telegram commands: /menu, /help', 'Telegram bot (once activated)', 'click', 'free', null),
  e('telegram-whats-happening', 'Telegram: What\'s happening? (market insights, conversations to join, needs review)', 'Telegram bot menu (once activated)', 'click', 'free', null),
  e('telegram-todays-posts-calendar', 'Telegram: Today\'s posts / Calendar', 'Telegram bot menu (once activated)', 'click', 'free', null),
]);

const playbook = defTool({
  name: 'get_action_playbook',
  title: 'Action playbook',
  description: 'Static catalogue of every action the owner can take in HITLOOP, grouped by surface: Marketing Director Refresh groups, Strategy chat actions (each with an exact paste-ready message), Queue & Calendar buttons, Results/X Monitor, Telegram. Each entry: id, label, surface, how (click | chat-message | mcp-proposal), costClass (free | model | paid-x-api | render), template, mcpTool. Use it to answer "how do I do X" and to build the HITLOOP COMMAND block. No I/O.',
  inputSchema: { type: 'object', properties: {} },
  kind: 'read',
  redactKeys: false,
  handler: () => ({
    actions: PLAYBOOK,
    note: 'Nothing here has run. Entries with how="chat-message": paste the template into Marketing Director > Strategy (chat); the in-app agent creates a pending card the owner confirms. how="click": the owner presses the button. how="mcp-proposal": request_sync creates a card the owner confirms.',
  }),
});

export const playbookTools = Object.freeze([dailyBrief, playbook]);
