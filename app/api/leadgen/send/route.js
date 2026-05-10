import { createRequire } from 'module';
import { getGmailClient, buildMimeMessage } from '../../../../features/leadgen/gmail-client.js';
import { renderOutreachEmail } from '../../../../features/leadgen/email-template.js';

export const maxDuration = 60;

const require = createRequire(import.meta.url);
const fb                      = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser }   = require('../../../../api/_lib/auth.cjs');

function makeReqShim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}

export async function POST(request) {
  try { await verifyRequestUser(makeReqShim(request)); }
  catch { return Response.json({ error: 'Unauthorized.' }, { status: 401 }); }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { placeId, recipientEmail, editedNote } = body || {};
  if (!placeId) return Response.json({ error: 'Provide placeId.' }, { status: 400 });

  const snap = await fb.adminDb.collection('leadgen_prospects').doc(placeId).get();
  if (!snap.exists) return Response.json({ error: `Prospect not found: ${placeId}` }, { status: 404 });

  const prospect = snap.data();
  const outreach = prospect.outreach || {};

  if (!outreach.emailHtml) return Response.json({ error: 'No email package found — run Package first.' }, { status: 409 });

  const to = recipientEmail || prospect.email;
  if (!to) return Response.json({ error: 'No recipient email. Provide recipientEmail in the request or add email to the prospect.' }, { status: 400 });

  // Re-render if note was edited
  let emailHtml = outreach.emailHtml;
  if (editedNote && editedNote !== outreach.note) {
    emailHtml = renderOutreachEmail({
      businessName:    prospect.name,
      note:            editedNote,
      thumbnailUrl:    outreach.thumbnailUrl,
      previewUrl:      prospect.generation?.previewUrl,
      originalSiteUrl: prospect.website || null,
      readinessBefore: prospect.generation?.readinessComparison?.before?.score ?? null,
      readinessAfter:  prospect.generation?.readinessComparison?.after?.score  ?? null,
      theme:           outreach.theme || {},
    });
    await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
      'outreach.note':      editedNote,
      'outreach.emailHtml': emailHtml,
    });
  }

  // Build + send
  try {
    const gmail = getGmailClient();
    const raw   = buildMimeMessage({
      to,
      subject:  outreach.emailSubject || `I built something for ${prospect.name}`,
      htmlBody: emailHtml,
    });

    const result = await gmail.users.messages.send({
      userId:      'me',
      requestBody: { raw },
    });

    const messageId = result.data?.id;

    await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
      stage:                      'contacted',
      'outreach.sentAt':          new Date().toISOString(),
      'outreach.sentTo':          to,
      'outreach.gmailMessageId':  messageId || null,
    });

    return Response.json({ success: true, messageId });

  } catch (err) {
    console.error('[send] Gmail error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
