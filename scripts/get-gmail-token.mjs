import { createServer } from 'http';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => l.split('=').map((v, i) => i === 0 ? v.trim() : v.trim()))
);

const REDIRECT = 'http://localhost:4242/callback';

const oauth2 = new google.auth.OAuth2(
  env.GMAIL_CLIENT_ID,
  env.GMAIL_CLIENT_SECRET,
  REDIRECT,
);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:4242/callback ...\n');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4242');
  if (url.pathname !== '/callback') return;

  const code = url.searchParams.get('code');
  if (!code) { res.end('No code'); return; }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('<h2>Success! Check your terminal for the refresh token.</h2>');
    console.log('\n✅ GMAIL_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\nPaste that into .env.local and restart the server.\n');
  } catch (e) {
    res.end('Error: ' + e.message);
    console.error(e);
  } finally {
    server.close();
  }
});

server.listen(4242);
