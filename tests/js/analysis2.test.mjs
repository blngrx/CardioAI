import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeECG, assessLead, modelEvidence } from '../../app/js/analysis2.js';
import { detailedAnalysisReport } from '../../app/js/analysis2-report.js';

const hash = 'a'.repeat(64);
const patient = { birthDate: '1980-01-01', sex: 'M' };
// Analytic signal, independent of the decoder: one event per second, sampled
// triangles with exact boundaries and no mandatory P wave.
function fixture({ withP = true, withT = true, fs = 200 } = {}) {
  const scales = [.6, 1, .4, -.8, .1, .7, -.5, .2, .6, .9, 1, 1.4];
  const tri = (t, center, half, amp) => amp * Math.max(0, 1 - Math.abs(t - center) / half);
  const leads = scales.map(scale => Array.from({ length: 10 * fs }, (_, i) => {
    let v = 0;
    for (let r = 1; r <= 8; r++) {
      v += tri(i / fs, r, .03, 1);
      if (withP) v += tri(i / fs, r - .18, .03, .12);
      if (withT) v += tri(i / fs, r + .25, .1, .25);
    }
    return 2048 + v * scale * 1000;
  }));
  const beats = Array.from({ length: 8 }, (_, i) => {
    const peak = (i + 1) * fs;
    return { qrsPeak: peak, qrsOnset: peak - .03 * fs, qrsOffset: peak + .03 * fs,
      ...(withP ? { pOnset: peak - .21 * fs, pEnd: peak - .15 * fs } : {}), ...(withT ? { tEnd: peak + .35 * fs } : {}) };
  });
  return { id: 'r', patientId: 'p', sha256: hash, recordedAt: '2026-11-06T10:00:00',
    measurements: { heart_rate_bpm: 190 }, signal: { fs, leads, timingVerified: false, simultaneousVerified: false,
      calibration: { microvoltsPerCount: 1, zeroCounts: 2048, verified: false } },
    fiducialFixture: { schemaVersion: 1, sourceSha256: hash, fs, reviewedBy: 'Synthetic fixture author', reviewedAt: '2026-11-06T10:00:00Z', beats } };
}
function reviewed(r) {
  r.fiducials = r.fiducialFixture;
  Object.assign(r.signal, { timingVerified: true, simultaneousVerified: true, equalChannelGainVerified: true });
  r.signal.calibration.verified = true;
  return r;
}

test('no signal, nonfinite fs and unequal arrays produce a blocked result without a normal classification', () => {
  for (const r of [{}, { signal: { fs: NaN, leads: [] } }, { signal: { fs: 200, leads: Array(12).fill([1]) } }]) {
    const a = analyzeECG(r, patient);
    assert.equal(a.available, false);
    assert.ok(a.stages.some(s => s.status === 'blocked'));
    assert.notEqual(a.classification, 'normal');
    assert.doesNotMatch(JSON.stringify(a), /NaN|Infinity/);
  }
});
test('automatic signal calculation ignores header HR and does not claim reviewed P, rhythm or absence', () => {
  const a = analyzeECG(fixture(), patient);
  assert.equal(a.available, true);
  assert.ok(Math.abs(a.measurements.heartRate.value - 60) < .5);
  assert.equal(a.measurements.heartRate.verified, false);
  assert.equal(a.measurements.PR_ms.value, null);
  assert.ok(a.beats.length >= 6);
  assert.ok(a.measurements.QRS_ms.value > 30 && a.measurements.QRS_ms.value < 100);
  assert.ok(a.findings.every(f => f.status === 'unassessable'));
  assert.equal(a.classification, 'incomplete');
});
test('changing time scale changes intervals and HR, without fitting to device metadata', () => {
  const r = fixture();
  const a = analyzeECG(r, patient);
  r.signal.fs = 250;
  const b = analyzeECG(r, patient);
  assert.ok(Math.abs(b.measurements.heartRate.value / a.measurements.heartRate.value - 1.25) < .02);
  assert.equal(b.measurements.heartRate.verified, false);
});
test('manual boundaries yield independent PR/QRS/QT and formulas, with no P forced when absent', () => {
  const r = reviewed(fixture());
  const a = analyzeECG(r, patient);
  assert.equal(a.boundarySource, 'reviewed-fiducials');
  assert.equal(a.measurements.PR_ms.value, 180);
  assert.equal(a.measurements.QRS_ms.value, 60);
  assert.equal(a.measurements.QT_ms.value, 380);
  assert.equal(a.measurements.P_ms.value, 60);
  assert.equal(a.measurements.QTcF_ms.value, 380);
  const noP = analyzeECG(reviewed(fixture({ withP: false })), patient);
  assert.equal(noP.measurements.PR_ms.value, null);
  assert.equal(noP.measurements.P_ms.value, null);
  assert.equal(noP.findings.find(f => f.key === 'longPR').status, 'unassessable');
});
test('missing T remains null in intervals and amplitudes rather than becoming zero', () => {
  const a = analyzeECG(reviewed(fixture({ withT: false })), patient);
  assert.equal(a.measurements.QT_ms.value, null);
  assert.equal(a.measurements.QTcF_ms.value, null);
  assert.ok(a.leads.every(l => l.tPositive_mV === null && l.tNegative_mV === null));
});
test('annotation provenance, malformed bounds and overlapping events are rejected', () => {
  for (const change of [a => a.sourceSha256 = 'b'.repeat(64), a => a.fs = 250, a => a.reviewedBy = {},
    a => a.beats[0].qrsOnset = -1, a => a.beats[0].pEnd = a.beats[0].qrsOffset,
    a => a.beats[0].tEnd = a.beats[1].qrsOnset + 1, a => a.beats[0] = null]) {
    const r = reviewed(fixture()); change(r.fiducials);
    const a = analyzeECG(r, patient);
    assert.notEqual(a.boundarySource, 'reviewed-fiducials');
    assert.ok(a.limitations.some(s => /Разметка|разметки/.test(s)));
    assert.equal(a.measurements.QRS_ms.verified, false);
  }
});
test('reviewing waves does not confirm storage time, voltage, synchrony or equal lead gain', () => {
  const r = fixture(); r.fiducials = r.fiducialFixture;
  const a = analyzeECG(r, patient);
  assert.equal(a.measurements.QRS_ms.verified, false);
  assert.equal(a.measurements.sokolow.verified, false);
  assert.equal(a.measurements.axis.value, null);
  assert.ok(a.findings.every(f => f.status === 'unassessable'));
});
test('axis uses signed same-window areas; Sokolow uses the larger of V5 and V6', () => {
  const r = reviewed(fixture());
  // V1 has a true initial r followed by S. A wholly negative QS has no S label.
  for (const b of r.fiducials.beats) r.signal.leads[6][b.qrsPeak - 4] = 2148;
  const a = analyzeECG(r, patient);
  assert.ok(Math.abs(a.measurements.axis.value - 53.41) < 1);
  assert.ok(Math.abs(a.measurements.sokolow.value - 1.9) < .02);
  assert.equal(a.measurements.sokolow.verified, true);
});
test('QS is not renamed S and a short signal needs three independently supported events', () => {
  const r = reviewed(fixture());
  assert.equal(analyzeECG(r, patient).measurements.sokolow.value, null);
  delete r.fiducials;
  r.signal.leads = r.signal.leads.map(l => l.slice(140, 740));
  const a = analyzeECG(r, patient);
  assert.equal(a.available, true);
  assert.equal(a.waveform.shortRecording, true);
  assert.ok(a.beats.length >= 3);
  assert.ok(a.limitations.some(s => /Короткая запись/.test(s)));
});
test('atrial rate is measured from marked P only and never copied from ventricular rate', () => {
  const r = reviewed(fixture());
  for (let i = 0; i < r.fiducials.beats.length; i++) {
    r.fiducials.beats[i].pOnset -= i;
    r.fiducials.beats[i].pEnd -= i;
  }
  const a = analyzeECG(r, patient);
  assert.notEqual(a.measurements.atrialRate.value, a.measurements.heartRate.value);
  delete r.fiducials;
  assert.equal(analyzeECG(r, patient).measurements.atrialRate.value, null);
});
test('adult duration criteria require age; width never becomes a named bundle branch block', () => {
  const r = reviewed(fixture());
  for (const b of r.fiducials.beats) { b.qrsOnset = b.qrsPeak - 14; b.qrsOffset = b.qrsPeak + 14; }
  const a = analyzeECG(r, patient);
  assert.equal(a.findings.find(f => f.key === 'wideQRS').status, 'present');
  assert.equal(a.findings.find(f => f.key === 'blocks').status, 'unassessable');
  for (const p of [{}, { birthDate: '2020-01-01' }])
    assert.equal(analyzeECG(r, p).findings.find(f => f.key === 'wideQRS').status, 'unassessable');
});
test('quality rejects flat/nonfinite channels; a corrupt channel never participates in lead measurements', () => {
  assert.equal(assessLead(Array(200).fill(2048), 200).usable, false);
  assert.equal(assessLead([1, NaN, 2], 200).usable, false);
  const r = fixture(); r.signal.leads[0][200] = NaN;
  const a = analyzeECG(r, patient);
  assert.equal(a.quality[0].usable, false);
  assert.equal(a.leads[0].r_mV, undefined);
  assert.notEqual(a.referenceLead, 'I');
  assert.doesNotMatch(JSON.stringify(a), /NaN|Infinity/);
});
test('models require exact source binding and per-label thresholds; zero does not assert absence', () => {
  const r = fixture();
  r.ai = {
    valid: { sourceSha256: hash, scores: { Afib: .8, other: .9, absent: 0 }, thresholds: { Afib: .7, absent: .5 } },
    old: { scores: { Afib: .99 }, thresholds: { Afib: .5 } },
    synthetic: { sourceSha256: hash, synthetic: true, scores: { Afib: .9 }, thresholds: { Afib: .5 } },
  };
  const models = modelEvidence(r);
  assert.deepEqual(models[0].suggestions.map(s => s.label), ['Afib']);
  assert.equal(models[1].eligible, false);
  assert.equal(models[2].eligible, false);
  assert.equal(analyzeECG(r, patient).findings.find(f => f.key === 'rhythm').status, 'unassessable');
});
test('ST threshold candidates never establish infarction or a negative ST finding', () => {
  const a = analyzeECG(reviewed(fixture()), patient);
  assert.equal(a.findings.find(f => f.key === 'stElevation').status, 'unassessable');
  assert.equal(a.findings.find(f => f.key === 'ischemia').status, 'unassessable');
});
test('serial comparison requires the same patient and verified measurements, without a 30-minute exclusion', () => {
  const old = reviewed(fixture()), next = reviewed(fixture());
  old.recordedAt = '2026-11-06T09:59:00';
  const a = analyzeECG(next, patient, { previous: old });
  assert.equal(a.dynamics.comparable, true);
  assert.ok(a.dynamics.differences.length >= 4);
  old.patientId = 'someone-else';
  assert.equal(analyzeECG(next, patient, { previous: old }).dynamics.comparable, false);
});
test('detailed report preserves missing values, limitations and escaped patient/metadata text', () => {
  const r = fixture(); r.sha256 = '<img src=x>';
  const html = detailedAnalysisReport({ surname: '<script>bad</script>' }, r);
  assert.doesNotMatch(html, /<script>|<img src=x>|NaN|Infinity/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Не измерено/);
  assert.match(html, /Границы QRS\/T/);
  assert.match(html, /Оценить нельзя/);
});
