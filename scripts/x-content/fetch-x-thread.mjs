#!/usr/bin/env node
// fetch-x-thread.mjs — pull an X (Twitter) post via ScrapeCreators and emit a
// markdown capture for the docs/x-content/ bucket.
//
// WHY ScrapeCreators (not the X API): repo rule — reads go through ScrapeCreators,
// which is prod-safe and cheap (1 credit / tweet), and its spend is visible on the
// Operating Cost card. The X API burns invisible credits and is reserved for writes.
//
// WHAT IT CAN / CANNOT DO:
//   ✅ main tweet + author + engagement (1 credit)
//   ✅ the quoted tweet, if the post quotes another (free — embedded in the payload)
//   ⚠️  REPLIES: ScrapeCreators has NO replies/conversation endpoint (only profile,
//       user-tweets, tweet, transcript, community). Replies must be captured from a
//       logged-in browser (free) or the X API conversation search (costs X credits).
//       This script leaves a "## Replies" section stub for you to paste them into.
//
// USAGE:
//   node scripts/x-content/fetch-x-thread.mjs <tweet-url> [--slug my-name] [--json]
//
// KEY: SCRAPECREATORS_API_KEY (env) or the last30days skill's
//      ~/.config/last30days/.env fallback (matches scrapecreators-client.js).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SC_BASE = 'https://api.scrapecreators.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET_DIR = path.resolve(__dirname, '..', '..', 'docs', 'x-content');

function getApiKey() {
  let key = process.env.SCRAPECREATORS_API_KEY || '';
  if (!key) {
    try {
      const envPath = path.join(process.env.LAST30DAYS_HOME || os.homedir(), '.config', 'last30days', '.env');
      const raw = fs.readFileSync(envPath, 'utf8');
      const m = raw.match(/^\s*SCRAPECREATORS_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) key = m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* no fallback */ }
  }
  return key;
}

function parseArgs(argv) {
  const out = { url: '', slug: '', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--slug') out.slug = argv[++i] || '';
    else if (!out.url) out.url = a;
  }
  return out;
}

async function fetchTweet(url, key) {
  const res = await fetch(`${SC_BASE}/v1/twitter/tweet?url=${encodeURIComponent(url)}`, {
    headers: { 'x-api-key': key, 'User-Agent': 'HitloopXContent/1.0' },
  });
  if (!res.ok) throw new Error(`ScrapeCreators ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Pull the fields we care about out of the ScrapeCreators Tweet payload.
function normalize(t) {
  if (!t) return null;
  const lg = t.legacy || {};
  const u = t.core?.user_results?.result || {};
  const uc = u.core || {};
  return {
    id: t.rest_id || lg.id_str || null,
    url: uc.screen_name && t.rest_id ? `https://x.com/${uc.screen_name}/status/${t.rest_id}` : null,
    author: { name: uc.name || '', handle: uc.screen_name ? `@${uc.screen_name}` : '', verified: !!u.is_blue_verified },
    createdAt: lg.created_at || null,
    text: lg.full_text || '',
    engagement: {
      replies: lg.reply_count ?? null,
      reposts: lg.retweet_count ?? null,
      likes: lg.favorite_count ?? null,
      quotes: lg.quote_count ?? null,
      bookmarks: lg.bookmark_count ?? null,
      views: t.views?.count ?? null,
    },
    conversationId: lg.conversation_id_str || null,
  };
}

function fmtEng(e) {
  return [
    e.replies != null ? `${e.replies} replies` : null,
    e.reposts != null ? `${e.reposts} reposts` : null,
    e.likes != null ? `${e.likes} likes` : null,
    e.quotes != null ? `${e.quotes} quotes` : null,
    e.bookmarks != null ? `${e.bookmarks} bookmarks` : null,
    e.views != null ? `${e.views} views` : null,
  ].filter(Boolean).join(' · ');
}

function quoteText(text) {
  return String(text || '').split('\n').map((l) => `> ${l}`).join('\n');
}

function toMarkdown(main, quoted, sourceUrl) {
  const lines = [];
  lines.push(`# X capture — ${main.author.name} (${main.author.handle})`);
  lines.push('');
  lines.push(`- **Source:** ${sourceUrl}`);
  lines.push(`- **Tweet ID:** ${main.id}`);
  lines.push(`- **Posted:** ${main.createdAt || 'unknown'}`);
  lines.push(`- **Engagement:** ${fmtEng(main.engagement)}`);
  lines.push(`- **Captured via:** ScrapeCreators \`/v1/twitter/tweet\` (1 credit)`);
  lines.push('');
  lines.push('## Main post');
  lines.push('');
  lines.push(quoteText(main.text));
  lines.push('');
  if (quoted) {
    lines.push(`## Quoted post — ${quoted.author.name} (${quoted.author.handle})`);
    lines.push('');
    lines.push(`- ${quoted.url || ''}  ·  ${fmtEng(quoted.engagement)}`);
    lines.push('');
    lines.push(quoteText(quoted.text));
    lines.push('');
  }
  lines.push('## Replies');
  lines.push('');
  lines.push('> ⚠️ ScrapeCreators has no replies endpoint. Paste replies here from a');
  lines.push('> logged-in browser read, or an X API conversation search on');
  lines.push(`> \`conversation_id:${main.conversationId || main.id}\`.`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const { url, slug, json } = parseArgs(process.argv.slice(2));
  if (!url) {
    console.error('Usage: node scripts/x-content/fetch-x-thread.mjs <tweet-url> [--slug name] [--json]');
    process.exit(1);
  }
  const key = getApiKey();
  if (!key) {
    console.error('SCRAPECREATORS_API_KEY not set (env or ~/.config/last30days/.env).');
    process.exit(1);
  }

  const raw = await fetchTweet(url, key);
  const main = normalize(raw);
  const quoted = normalize(raw.quoted_status_result?.result);
  if (raw.credits_remaining != null) console.error(`ScrapeCreators credits remaining: ${raw.credits_remaining}`);

  if (json) {
    console.log(JSON.stringify({ main, quoted }, null, 2));
    return;
  }

  fs.mkdirSync(BUCKET_DIR, { recursive: true });
  const handle = (main.author.handle || 'unknown').replace(/^@/, '');
  const name = slug || `${handle}-${main.id}`;
  const file = path.join(BUCKET_DIR, `${name}.md`);
  fs.writeFileSync(file, toMarkdown(main, quoted, url));
  console.error(`Wrote ${file}`);
  console.error('Next: paste replies into the "## Replies" section (browser read).');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
