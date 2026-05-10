// scripts/test-lazyweb-verticals.js
// Run: node scripts/test-lazyweb-verticals.js
//
// Tests Lazyweb search coverage across all 12 leadgen verticals.
// Reports result counts so we know which verticals have strong references
// and which might need fallback strategies.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load .env.local manually since dotenv looks for .env
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const LAZYWEB_MCP_URL = 'https://www.lazyweb.com/mcp';
const TOKEN = process.env.LAZYWEB_TOKEN;
if (!TOKEN) { console.error('Set LAZYWEB_TOKEN in .env.local'); process.exit(1); }

// ── Vertical query map ──────────────────────────────────────────────────────
const VERTICAL_QUERIES = {
  lawyer:        ['law firm website homepage', 'attorney services section', 'legal practice hero section'],
  dental:        ['dental clinic website homepage', 'dentist services section', 'dental practice hero'],
  home_services: ['plumber contractor website', 'home services homepage', 'HVAC company website hero'],
  restaurant:    ['restaurant website homepage', 'dining menu section', 'restaurant hero section'],
  med_spa:       ['med spa website homepage', 'aesthetics clinic services', 'beauty wellness hero'],
  auto_repair:   ['auto repair shop website', 'mechanic services section', 'automotive homepage'],
  chiropractor:  ['chiropractor website homepage', 'wellness clinic services', 'chiropractic hero section'],
  gym_fitness:   ['gym fitness website homepage', 'fitness studio classes section', 'gym hero section'],
  real_estate:   ['real estate agency website', 'property listings section', 'realtor homepage hero'],
  wedding_event: ['wedding planner website', 'event planning services section', 'wedding photographer hero'],
  pet_services:  ['veterinary clinic website', 'pet grooming services', 'animal hospital homepage'],
  custom:        ['small business website homepage', 'local business services section', 'professional services hero'],
};

// ── MCP tool call via HTTP ──────────────────────────────────────────────────
async function callLazyweb(toolName, args) {
  const res = await fetch(LAZYWEB_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Lazyweb ${res.status}: ${txt.slice(0, 200)}`);
  }

  // Handle SSE / streaming responses
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    // Parse last data: line
    const lines = text.split('\n').filter(l => l.startsWith('data:'));
    const last = lines[lines.length - 1]?.replace(/^data:\s*/, '');
    if (!last) throw new Error('Empty SSE response');
    const parsed = JSON.parse(last);
    return parsed.result;
  }

  const data = await res.json();
  return data.result;
}

// ── Run tests ───────────────────────────────────────────────────────────────
async function main() {
  console.log('Testing Lazyweb coverage across verticals...\n');
  console.log('Vertical          | Query                                   | Images | Text');
  console.log('------------------|-----------------------------------------|--------|-----');

  for (const [vertical, queries] of Object.entries(VERTICAL_QUERIES)) {
    for (const query of queries) {
      try {
        const result = await callLazyweb('lazyweb_search', { query, platform: 'desktop' });

        const content = result?.content || [];
        let urlCount = 0;
        let rawTextCount = 0;
        for (const item of content) {
          if (item.type === 'image') { urlCount++; }
          else if (item.type === 'text') {
            try {
              const parsed = JSON.parse(item.text);
              urlCount += (parsed?.results?.length || 0);
            } catch { rawTextCount++; }
          }
        }

        console.log(
          `${vertical.padEnd(18)}| ${query.padEnd(41)}| ${String(urlCount).padEnd(7)}| ${rawTextCount}`
        );
      } catch (err) {
        console.log(
          `${vertical.padEnd(18)}| ${query.padEnd(41)}| ERROR: ${err.message.slice(0, 40)}`
        );
      }

      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log('\nDone. If hero queries return <2 images for a vertical, update queries in design-references.js.');
}

main().catch(console.error);
