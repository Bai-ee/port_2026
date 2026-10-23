#!/usr/bin/env node
// instagram-test-post.mjs — supervised one-off Instagram image post through the
// real adapter, before instagram.live is flipped on.
// Usage: node --env-file=.env.local scripts/social/instagram-test-post.mjs --image=<https url> --caption="..." [--confirm]
// Without --confirm it is a free dry run: checks the token (/me), that the image
// URL is publicly fetchable as an image, and the caption length. Nothing is posted.
// With --confirm it publishes ONE post to the connected account (irreversible
// until deleted by hand in the Instagram app).
import { publish, __graphUrl, CAPTION_MAX } from '../../features/social-posting/adapters/instagram.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));

const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const igUserId = process.env.INSTAGRAM_USER_ID;
const image = args.image;
const caption = typeof args.caption === 'string' ? args.caption : '';

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

if (!accessToken || !igUserId) die('INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID missing (run with --env-file=.env.local).');
if (!image || !/^https:\/\//i.test(image)) die('--image must be a public https URL.');
if (caption.length > CAPTION_MAX) die(`caption is ${caption.length} chars (max ${CAPTION_MAX}).`);

const meRes = await fetch(`${__graphUrl('me')}?fields=user_id,username,account_type`, { headers: { Authorization: `Bearer ${accessToken}` } });
const me = await meRes.json().catch(() => ({}));
if (!meRes.ok || me.error) die(`token check failed: ${me.error?.message || meRes.status}`);
if (String(me.user_id) !== String(igUserId)) die(`token belongs to ${me.user_id}, env INSTAGRAM_USER_ID is ${igUserId}.`);
console.log(`✓ token ok — @${me.username} (${me.account_type})`);

const imgRes = await fetch(image, { method: 'GET' });
const type = imgRes.headers.get('content-type') || '';
if (!imgRes.ok) die(`image URL returned HTTP ${imgRes.status}.`);
if (!/^image\/jpe?g/i.test(type)) die(`image content-type is "${type}" — Instagram image posts need JPEG.`);
console.log(`✓ image fetchable — ${type}, ${imgRes.headers.get('content-length') || '?'} bytes`);
console.log(`✓ caption ${caption.length}/${CAPTION_MAX} chars`);

if (!args.confirm) {
  console.log('\nDry run only — nothing posted. Re-run with --confirm to publish this one post.');
  process.exit(0);
}

console.log('\nPublishing one image post…');
try {
  const out = await publish({ mediaType: 'image', mediaUrl: image, caption }, { accessToken, igUserId, allowNotLive: true });
  console.log(`✓ published — media id ${out.instagramMediaId} (container ${out.containerId})`);
} catch (err) {
  die(`${err.code || 'error'}: ${err.message}${err.ambiguous ? ' — CHECK THE ACCOUNT before retrying.' : ''}`);
}
