# X content bucket

Captured X (Twitter) posts + threads, saved as Markdown for review later.

## How to add a capture

```bash
# 1. Fetch the main post (+ quoted post) via ScrapeCreators — writes a stub .md here.
node scripts/x-content/fetch-x-thread.mjs "<tweet-url>"

# optional: name the file yourself, or just print JSON instead of writing
node scripts/x-content/fetch-x-thread.mjs "<tweet-url>" --slug my-topic-name
node scripts/x-content/fetch-x-thread.mjs "<tweet-url>" --json
```

Then fill in the `## Replies` section by reading the thread in a logged-in browser
and pasting each reply (see the reply format in the existing captures).

## Why this split (main = script, replies = browser)

- **Reads go through ScrapeCreators, not the X API** (repo rule). ScrapeCreators is
  prod-safe, ~1 credit per tweet, and its spend shows on the Operating Cost card. The
  X API burns invisible credits and is reserved for writes to `@bai_ee`.
- ScrapeCreators has **no replies/conversation endpoint** (only profile, user-tweets,
  tweet, transcript, community). So the script captures the main post + any quoted
  post automatically; replies are pasted in from a browser read (free) or, if you ever
  need them programmatically, an X API conversation search on the `conversation_id`
  (costs X credits — gate it per the X-API SSOT).

## Key / env

`SCRAPECREATORS_API_KEY` (env) or the last30days skill's `~/.config/last30days/.env`
fallback — same resolution as `features/scout-intake/external-scouts/scrapecreators-client.js`.

## File naming

`<handle>-<tweet-id>.md` by default, or `--slug <name>.md`. One thread per file.

## Captures

- [`adriankuleszo-2080561895983944031.md`](adriankuleszo-2080561895983944031.md) — Adrian (@adriankuleszo) on design-studio lead gen via X; quotes Leo (@liutauras_liu). 7 replies. Captured 2026-07-24.
