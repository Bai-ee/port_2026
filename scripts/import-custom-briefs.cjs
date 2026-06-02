#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fb = require('../api/_lib/firebase-admin.cjs');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) {
      args._.push(part);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function slugify(value, fallback = 'brief') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function compactClientSlug(value, fallback = 'client') {
  const words = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 2 && ['shop', 'store', 'restaurant', 'llc', 'inc', 'co', 'company', 'ltd'].includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join('') || slugify(fallback, 'client').replace(/-/g, '');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractTitle(html, fallback) {
  const titleMatch = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const raw = (titleMatch && titleMatch[1]) || (h1Match && h1Match[1]) || fallback;
  return String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashHtml(html) {
  return crypto.createHash('sha256').update(html).digest('hex');
}

function findBriefFiles(folder) {
  return fs.readdirSync(folder)
    .filter((name) => /-brief\.html$/i.test(name))
    .map((name) => path.join(folder, name))
    .sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const folder = path.resolve(args._[0] || 'clients/fast-poker/its-raw-poke');

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(`Brief folder not found: ${folder}`);
  }

  const clientMeta = readJson(path.join(folder, 'client.json')) || {};
  const clientId = slugify(args.clientId || clientMeta.clientId || clientMeta.slug || path.basename(folder), path.basename(folder));
  const publicClientSlug = compactClientSlug(
    args.publicClientSlug || clientMeta.publicClientSlug || clientMeta.publicSlug || clientMeta.slug || clientMeta.name || clientId,
    clientId
  );
  const briefFiles = findBriefFiles(folder);

  if (!briefFiles.length) {
    throw new Error(`No *-brief.html files found in ${folder}`);
  }

  const batch = fb.adminDb.batch();
  const now = fb.FieldValue.serverTimestamp();
  const imported = [];

  for (const filePath of briefFiles) {
    const html = fs.readFileSync(filePath, 'utf8');
    const fileBase = path.basename(filePath, '.html');
    const briefSlug = slugify(args.briefSlug || fileBase.replace(/-brief$/i, ''), fileBase);
    const title = args.title || extractTitle(html, fileBase.replace(/-/g, ' '));
    const publicPath = `/briefs/${publicClientSlug}/${briefSlug}`;
    const ref = fb.adminDb
      .collection('clients')
      .doc(clientId)
      .collection('custom_briefs')
      .doc(briefSlug);

    batch.set(ref, {
      clientId,
      briefSlug,
      title,
      description: args.description || clientMeta.goal || '',
      html,
      public: args.public === 'false' ? false : true,
      publicClientSlug,
      publicPath,
      legacyPublicPath: `/briefs/${clientId}/${briefSlug}`,
      sourcePath: path.relative(process.cwd(), filePath),
      sourceHash: hashHtml(html),
      clientMeta: {
        name: clientMeta.name || '',
        website: clientMeta.website || '',
        websiteAlias: clientMeta.websiteAlias || '',
        location: clientMeta.location || '',
        vertical: clientMeta.vertical || '',
        subVertical: clientMeta.subVertical || '',
        goal: clientMeta.goal || '',
      },
      importedAt: now,
      updatedAt: now,
    }, { merge: true });

    imported.push({ briefSlug, title, publicPath, filePath });
  }

  batch.set(fb.adminDb.collection('brief_client_slugs').doc(publicClientSlug), {
    publicClientSlug,
    clientId,
    clientName: clientMeta.name || clientId,
    updatedAt: now,
  }, { merge: true });
  batch.set(fb.adminDb.collection('clients').doc(clientId), {
    publicClientSlug,
    updatedAt: now,
  }, { merge: true });

  await batch.commit();

  console.log(`Imported ${imported.length} custom brief(s) for client "${clientId}" (${publicClientSlug}).`);
  for (const item of imported) {
    console.log(`- ${item.title} -> ${item.publicPath} (${path.relative(process.cwd(), item.filePath)})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
