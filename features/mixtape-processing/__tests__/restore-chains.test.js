import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HP_FILTER, humNotch, balanceGains, balanceIsConsistent, azimuthFilter, buildCleanup, afftdn, finalMasterGainDb,
  matchGains, residualGain, excerptChain, volumeFilter,
} from '../restore-chains.js';

const diag = {
  input: { sampleRate: 44100 },
  channels: { whole: { balanceDb: -2.49 }, excerptMedianBalanceDb: -2.236 },
  azimuth: { lagSamples: -0.396, consistent: true },
  hum: { lines: [{ freq: 59.89, medianPromDb: 8.7 }] },
};

test('humNotch formats and caps depth at 20 dB', () => {
  assert.equal(humNotch(59.89, 8.7), 'equalizer=f=59.89:t=q:w=30:g=-8.7');
  assert.equal(humNotch(120, 35), 'equalizer=f=120:t=q:w=30:g=-20');
});

test('balanceGains attenuates the louder channel by the full difference', () => {
  const a = balanceGains(-2.49); // L quieter -> R down
  assert.equal(a.gL, 1);
  assert.ok(Math.abs(20 * Math.log10(a.gR) + 2.49) < 1e-9);
  const b = balanceGains(1.5);
  assert.equal(b.gR, 1);
  assert.ok(Math.abs(20 * Math.log10(b.gL) + 1.5) < 1e-9);
});

test('balanceIsConsistent needs agreement and >0.5 dB', () => {
  assert.equal(balanceIsConsistent(diag), true);
  assert.equal(balanceIsConsistent({ channels: { whole: { balanceDb: 0.3 }, excerptMedianBalanceDb: 0.3 } }), false);
  assert.equal(balanceIsConsistent({ channels: { whole: { balanceDb: -2 }, excerptMedianBalanceDb: 1 } }), false);
});

test('azimuthFilter skips below 0.5 sample or inconsistent, delays the leading channel otherwise', () => {
  assert.equal(azimuthFilter(diag.azimuth), null);
  assert.equal(azimuthFilter({ lagSamples: 1, consistent: false }), null);
  assert.match(azimuthFilter({ lagSamples: 0.75, consistent: true }), /adelay=delays=6S\|0S/);
  assert.match(azimuthFilter({ lagSamples: -0.75, consistent: true }), /adelay=delays=0S\|6S/);
});

test('buildCleanup for REC020 diag: HP, notch, balance, no azimuth', () => {
  const { chain } = buildCleanup(diag);
  assert.ok(chain.startsWith(HP_FILTER));
  assert.ok(chain.includes('equalizer=f=59.89:t=q:w=30:g=-8.7'));
  assert.match(chain, /pan=stereo\|c0=1\*c0\|c1=0\.7508\*c1/);
  assert.ok(!chain.includes('adelay'));
});

test('afftdn string', () => {
  assert.equal(afftdn(6, -50, 8), 'afftdn=nr=6:nf=-50:tn=1:gs=8:nl=min');
  assert.equal(afftdn(6, -50, 8, ':om=n'), 'afftdn=nr=6:nf=-50:tn=1:gs=8:nl=min:om=n');
});

test('finalMasterGainDb takes the smaller of loudness and TP headroom', () => {
  assert.ok(Math.abs(finalMasterGainDb(-15.9, -1.7) - 0.7) < 1e-9);
  assert.ok(Math.abs(finalMasterGainDb(-20, -10) - 6) < 1e-9);
});

test('matchGains matches to V0 without clamp', () => {
  const m = { V0: { lufs: -16, tp: -4 }, V1: { lufs: -17, tp: -5 }, V2: { lufs: -15, tp: -3 } };
  const { gains, clampDb } = matchGains(m, ['V1', 'V2']);
  assert.equal(clampDb, 0);
  assert.deepEqual(gains, { V0: 0, V1: 1, V2: -1 });
});

test('matchGains TP clamp lowers every variant (incl V0) by the same excess', () => {
  const m = { V0: { lufs: -16, tp: -2 }, V1: { lufs: -19, tp: -3.5 } }; // V1 +3 -> -0.5 dBTP, excess 0.5
  const { gains, clampDb } = matchGains(m, ['V1']);
  assert.ok(Math.abs(clampDb - 0.5) < 1e-9);
  assert.ok(Math.abs(gains.V0 + 0.5) < 1e-9);
  assert.ok(Math.abs(gains.V1 - 2.5) < 1e-9);
  assert.ok(Math.abs(gains.V1 - gains.V0 - 3) < 1e-9); // relative level preserved
  assert.equal(residualGain(gains, 'V1'), gains.V1);
});

test('excerptChain and volumeFilter', () => {
  assert.equal(excerptChain('a', 5), 'a,atrim=start=5,asetpts=PTS-STARTPTS');
  assert.equal(excerptChain('', 0), 'atrim=start=0,asetpts=PTS-STARTPTS');
  assert.equal(volumeFilter(0.7), 'volume=0.7dB');
});
