import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureWaveform, intervalsFromFiducials, axisFromAreas } from '../../app/js/waveform.js';
import { buildSummary } from '../../app/js/summary.js';

// Independent analytic fixture: QRS peaks every known second, in ADC counts.
function signal(fs = 200) {
  return { fs, leads: Array.from({ length: 12 }, (_, lead) =>
    Array.from({ length: 10 * fs }, (_, i) => {
      const seconds = i / fs;
      let value = 2048;
      for (let beat = 1; beat <= 9; beat++)
        value += (lead % 3 === 0 ? -1 : 1) * (100 + lead * 10) * Math.exp(-.5 * ((seconds - beat) / .015) ** 2);
      return value;
    })) };
}
test('sample timing rather than device metadata determines ventricular rate', () => {
  for (const fs of [200, 250, 500]) {
    const m = measureWaveform(signal(fs));
    assert.equal(m.available, true);
    assert.ok(Math.abs(m.heartRate - 60) < .1);
    assert.equal(m.qrsSamples.length, 9);
    assert.ok(m.agreeingLeads >= 2);
    const r = { signal: signal(fs), measurements: { heart_rate_bpm: 190 } };
    const summary = buildSummary(r);
    assert.match(summary.items.find(x => x.key === 'heartRate').text, /60 уд\/мин/);
    assert.equal(summary.evidence.heartRateSource, 'waveform');
    assert.doesNotMatch(JSON.stringify(summary.items), /190|по данным прибора|не подтвержден|не исключен/);
  }
});
test('flat, corrupt, noisy, unsupported and single-lead inputs produce no invented rate', () => {
  let seed = 42;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const flat = { fs: 200, leads: Array.from({ length: 12 }, () => Array(2000).fill(2048)) };
  const noisy = { fs: 200, leads: Array.from({ length: 12 }, () => Array.from({ length: 2000 }, () => random())) };
  const one = signal();
  one.leads = one.leads.map((l, i) => i === 0 ? l : Array(2000).fill(0));
  for (const s of [undefined, flat, noisy, one, { ...signal(), fs: undefined },
    { ...signal(), leads: [signal().leads[0]] }, { ...signal(), fs: 0 }])
    assert.equal(measureWaveform(s).available, false);
  const corrupt = signal(); corrupt.leads[0][3] = NaN;
  const m = measureWaveform(corrupt);
  assert.notEqual(m.referenceLead, 0);
});
test('rate changes with the supplied time scale; it is never fitted to header HR', () => {
  const s = signal(); s.fs = 250;
  assert.ok(Math.abs(measureWaveform(s).heartRate - 75) < .1);
  assert.equal(measureWaveform(s).timingVerified, false);
});
test('boundary arithmetic uses onsets/offsets and cannot invent absent P or T', () => {
  const m = intervalsFromFiducials({ fs: 200, pOnset: 20, qrsOnset: 50, qrsOffset: 70, tEnd: 130, rrSeconds: 1 });
  assert.deepEqual(m, { PR_ms: 150, QRS_ms: 100, QT_ms: 400, QTcB_ms: 400, QTcF_ms: 400 });
  const missing = intervalsFromFiducials({ fs: 200, qrsOnset: 50, qrsOffset: 70 });
  assert.equal(missing.PR_ms, null); assert.equal(missing.QT_ms, null); assert.equal(missing.QTcB_ms, null);
  assert.equal(intervalsFromFiducials({ fs: 200, pOnset: 70, qrsOnset: 50 }).PR_ms, null);
});
test('axis arithmetic preserves quadrants and rejects zero/no-data vectors', () => {
  assert.ok(Math.abs(axisFromAreas(1, .5)) < 1e-8);
  assert.ok(axisFromAreas(1, -.5) < -30);
  assert.ok(axisFromAreas(-1, .5) > 90);
  assert.equal(axisFromAreas(0, 0), null);
  assert.equal(axisFromAreas(null, 1), null);
});
