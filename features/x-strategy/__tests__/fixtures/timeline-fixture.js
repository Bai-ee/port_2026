// Deterministic fake X timeline shared by the ingest golden fixture + tests. No I/O.
// 36 posts for @fixture_handle, one every 6h counting back from 2026-10-10T12:00Z, split into pages of 12.
export const FIXTURE_HANDLE = 'fixture_handle';
const BASE = Date.parse('2026-10-10T12:00:00.000Z');

export function makeTweet(i, handle = FIXTURE_HANDLE) {
  const createdAt = new Date(BASE - i * 6 * 3_600_000).toUTCString();
  const t = {
    id: String(9000000000 + i),
    text: `post ${i} about web design and branding`,
    createdAt,
    likeCount: 10 + (i % 7),
    retweetCount: i % 3,
    replyCount: i % 2,
    conversationId: String(9000000000 + i),
  };
  if (i % 5 === 0) t.media = [{ type: 'photo' }];
  if (i % 6 === 1) { t.quotedTweet = { text: 'quoted words', author: { username: 'someoneelse' } }; t.text = 'wow'; }
  if (i % 9 === 4) t.inReplyToStatusId = '123';
  if (i % 11 === 10) t.text = `RT @other: ${t.text}`;
  return t;
}

export function makePages(handle = FIXTURE_HANDLE, total = 36, per = 12) {
  const pages = [];
  for (let p = 0; p * per < total; p += 1) {
    const tweets = [];
    for (let i = p * per; i < Math.min(total, (p + 1) * per); i += 1) tweets.push(makeTweet(i, handle));
    pages.push({ tweets, nextCursor: (p + 1) * per < total ? `c${p + 1}` : null });
  }
  return pages;
}
