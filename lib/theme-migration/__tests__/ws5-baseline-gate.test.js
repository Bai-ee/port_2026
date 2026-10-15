import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { read } from './ws5-helpers.js';

// The decomposition byte-compare gate (docs/plans/decomposition-baselines/BASELINE-COMMANDS.md, section 2)
// was never a script: it was a baseline file plus a hash. Theme-studio changes the dashboard CSS on purpose,
// so the baseline is regenerated from the ordered @imports of styles/dashboard/index.css and this test makes
// the comparison mechanical again: edit a dashboard stylesheet without regenerating the baseline and it fails.
//
// Regenerate (from the repo root):
//   cd styles/dashboard && cat 01-base.css 02-style-guide-survey.css 03-strategy-builder.css 04-data-quality.css \
//     05-seo-performance.css 06-intake-onboarding.css 07-modals-misc.css 08-ui-kit-interactions.css \
//     09-market-signals.css 10-video-remix.css 11-creative-brief.css > ../../docs/plans/decomposition-baselines/dashboardCss.baseline.css
//   then write "<sha256>  docs/plans/decomposition-baselines/dashboardCss.baseline.css" to dashboardCss.baseline.sha256

const BASELINE = 'docs/plans/decomposition-baselines/dashboardCss.baseline.css';
const BASELINE_HASH = 'docs/plans/decomposition-baselines/dashboardCss.baseline.sha256';

const importedFiles = () => [...read('styles/dashboard/index.css').matchAll(/@import\s+'\.\/([^']+)'/g)].map((m) => `styles/dashboard/${m[1]}`);

test('concatenating styles/dashboard/* in @import order byte-matches dashboardCss.baseline.css', () => {
  const concat = importedFiles().map(read).join('');
  const baseline = read(BASELINE);
  assert.equal(concat.length, baseline.length, 'length differs: regenerate the baseline (see the header of this test)');
  assert.ok(concat === baseline, 'content differs: regenerate the baseline (see the header of this test)');
});

test('dashboardCss.baseline.sha256 records the hash of the baseline file', () => {
  const sha = crypto.createHash('sha256').update(read(BASELINE), 'utf8').digest('hex');
  assert.equal(read(BASELINE_HASH).trim(), `${sha}  ${BASELINE}`);
});

test('the baseline still contains no template-literal interpolation (it was a verbatim JS string once)', () => {
  assert.ok(!read(BASELINE).includes('${'));
});
