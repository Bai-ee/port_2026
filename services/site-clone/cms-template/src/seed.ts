// seed.ts — load the tokenized pages + their original slot values into the
// CMS. Idempotent: wipes pages first, then re-creates from seed-data/. Re-run
// restores every slot to the original site's content (admin-uploaded media
// stays in the media collection but is detached from slots).
//
//   npm run seed
//
// tsx does NOT load .env (runbook gotcha) — parsed manually below. The libSQL
// `file:` URL is cwd-relative — always run from the project root.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');

// Manual .env load (before the config import reads process.env).
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const { getPayload } = await import('payload');
const { default: config } = await import('./payload.config');

const ADMIN_EMAIL = 'admin@{{PROJECT}}.local';
const ADMIN_PASSWORD = 'changeme123';

async function run() {
  const payload = await getPayload({ config });
  const pages = JSON.parse(fs.readFileSync(path.join(root, 'seed-data', 'pages.json'), 'utf8'));

  const users = await payload.find({ collection: 'users', limit: 1 });
  if (!users.docs.length) {
    await payload.create({ collection: 'users', data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    console.log(`created admin user ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }

  await payload.delete({ collection: 'pages', where: { slug: { exists: true } } });

  for (const pg of pages) {
    await payload.create({
      collection: 'pages',
      data: {
        title: pg.title,
        slug: pg.slug,
        sourceFile: pg.sourceFile,
        slots: pg.slots.map((s: any) => ({
          key: s.key,
          kind: s.kind,
          label: s.label || '',
          value: s.value || '',
          srcset: s.srcset || '',
        })),
      },
    });
    console.log(`page: /${pg.slug === 'home' ? '' : pg.slug} (${pg.slots.length} slots)`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
