import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import * as store from '../../../../features/telegram/store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { requirePilotOwner } = require('../../../../api/_lib/pilot-access.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

// Telegram connection settings for the owner pilot. Linking is two-step: this route mints a one-time deep link,
// the bot records which Telegram account opened it, and the link only becomes a binding when the signed-in owner
// confirms that account HERE (a leaked link alone can never bind a stranger's chat).

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function requireOwner(request) {
  const auth = request.headers.get('authorization');
  const decoded = await verifyRequestUser({ headers: { authorization: auth, Authorization: auth } })
    .catch((error) => { throw Object.assign(error, { status: 401 }); });
  if (!(await isAdminEmail(decoded?.email))) throw Object.assign(new Error('Admin access required.'), { status: 403 });
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.clientId) throw Object.assign(new Error('No client workspace was found.'), { status: 404 });
  const { uid, clientId } = requirePilotOwner(context, decoded);
  return { uid, clientId };
}

const botUsername = () => String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim();
const configured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && botUsername() && process.env.TELEGRAM_WEBHOOK_SECRET);

async function defaultTimezone(clientId) {
  try {
    const snap = await fb.adminDb.collection('digest_config').doc(clientId).get();
    return snap.exists ? snap.data()?.schedule?.timezone || null : null;
  } catch {
    return null;
  }
}

async function snapshot({ uid, clientId }) {
  const db = fb.adminDb;
  const [binding, pending, settings] = await Promise.all([
    store.getActiveBindingForClient(db, clientId),
    store.getPendingLink(db, { uid, clientId }),
    defaultTimezone(clientId).then((tz) => store.getSettings(db, clientId, { defaultTimezone: tz })),
  ]);
  return {
    configured: configured(),
    botUsername: botUsername() || null,
    binding: binding && binding.uid === uid
      ? { status: binding.status, telegramUsername: binding.telegramUsername || null, linkedAt: binding.linkedAt || null }
      : null,
    pending: pending?.telegramUserId ? { telegramUsername: pending.telegramUsername || null, firstName: pending.firstName || null } : null,
    settings,
  };
}

export async function GET(request) {
  try {
    const owner = await requireOwner(request);
    return json({ ok: true, ...(await snapshot(owner)) });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Telegram settings unavailable.' }, error.status || 500);
  }
}

export async function POST(request) {
  let owner;
  try {
    owner = await requireOwner(request);
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 401);
  }
  const body = await request.json().catch(() => ({}));
  const db = fb.adminDb;
  try {
    switch (body?.action) {
      case 'link-start': {
        if (!configured()) return json({ ok: false, error: 'The Telegram bot is not activated yet.' }, 409);
        const { code, expiresAt } = await store.createLinkChallenge(db, { uid: owner.uid, clientId: owner.clientId });
        return json({ ok: true, deepLink: `https://t.me/${botUsername()}?start=${code}`, expiresAt });
      }
      case 'link-confirm': {
        const pending = await store.getPendingLink(db, owner);
        if (!pending?.telegramUserId) return json({ ok: false, error: 'Open the bot link in Telegram first, then confirm here.' }, 409);
        const binding = await store.confirmLink(db, owner);
        return json({ ok: true, binding: { status: binding.status, telegramUsername: binding.telegramUsername || null, linkedAt: binding.linkedAt } });
      }
      case 'unlink': {
        await store.revokeBinding(db, owner);
        return json({ ok: true, ...(await snapshot(owner)) });
      }
      case 'save-settings': {
        const settings = await store.saveSettings(db, owner.clientId, body.settings || {});
        return json({ ok: true, settings });
      }
      default:
        return json({ ok: false, error: 'Unknown action.' }, 400);
    }
  } catch (error) {
    return json({ ok: false, error: error.message || 'Telegram action failed.' }, error.status || 400);
  }
}
