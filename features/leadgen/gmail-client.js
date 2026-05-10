import { google } from 'googleapis';

export function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export function buildMimeMessage({ to, subject, htmlBody, fromName = 'Bryan Balli', fromEmail = 'bryanballi@gmail.com' }) {
  const mime = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    htmlBody,
  ].join('\r\n');

  return Buffer.from(mime).toString('base64url');
}
