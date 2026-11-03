import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, reviewedInterpretation } from '../../app/js/summary.js';
import { recordReport, comparisonReport } from '../../app/js/report.js';
import { compareRecords } from '../../app/js/compare.js';

const hash = 'a'.repeat(64);
const record = (extra = {}) => ({ id: 'r', sha256: hash, source: 'ecg301', recordedAt: '2026-11-03T15:38:16',
  measurements: { heart_rate_bpm: 62, QRS_axis: -47 }, ...extra });
const row = (r, key, patient) => buildSummary(r, patient).items.find(x => x.key === key).text;
const review = (extra = {}) => ({ schemaVersion: 1, basis: 'clinician-reviewed', sourceSha256: hash,
  reviewedBy: 'test reviewer', reviewedAt: '2026-11-03T16:00:00Z', ...extra });
const model = (scores, thresholds, extra = {}) => ({ scores, thresholds, sourceSha256: hash, ...extra });

test('seven concise fields, adult resting rate, axis direction without angles', () => {
  const r = record();
  assert.equal(buildSummary(r).items.length, 7);
  assert.match(row(r, 'heartRate'), /62 уд\/мин — нормальная для взрослого в покое/);
  assert.match(row(r, 'axis'), /влево/);
  assert.doesNotMatch(row(r, 'axis'), /47|°|умеренн|значительн/);
});
test('heart rate boundaries and child context are not confused', () => {
  for (const [hr, text] of [[59, 'пониженная'], [60, 'нормальная'], [100, 'нормальная'], [101, 'повышенная']])
    assert.match(row(record({ measurements: { heart_rate_bpm: hr } }), 'heartRate'), new RegExp(text));
  assert.match(row(record(), 'heartRate', { birthDate: '2020-01-01' }), /по возрасту не настроена/);
  assert.doesNotMatch(row(record({ measurements: { heart_rate_bpm: NaN } }), 'heartRate'), /NaN|нормальная/);
});
test('model scores cannot establish absence, severity, rate or ectopy frequency', () => {
  const r = record({ ai: { wcr: model({ 'ST elevation (anterior - V3-V4)': .999, 'Premature ventricular complex': .99, Afib: .99 },
    { 'ST elevation (anterior - V3-V4)': .1, 'Premature ventricular complex': .1, Afib: .1 }) } });
  assert.doesNotMatch(row(r, 'st'), /выраженный|умеренный|незначительный|ST выявлен/);
  assert.match(row(r, 'extrasystoles'), /не определены/);
  assert.doesNotMatch(row(r, 'extrasystoles'), /частые|редкие|парами/);
  assert.match(row(r, 'atrial'), /фибрилляцию/);
  assert.match(row(r, 'atrial'), /предсердий — не измерена/);
  assert.match(row(r, 'atrial'), /желудочков — 62 уд\/мин/);
  const negative = record({ ai: { wcr: model({ Afib: 0 }, { Afib: .5 }) } });
  assert.match(row(negative, 'waves'), /Не определено/);
  assert.match(row(negative, 'st'), /Не определено/);
  assert.doesNotMatch(row(negative, 'extrasystoles'), /не выявлены/);
});
test('synthetic, foreign ECG and thresholdless output cannot create findings', () => {
  for (const entry of [model({ Afib: .99 }, { Afib: .1 }, { synthetic: true }),
    model({ Afib: .99 }, { Afib: .1 }, { sourceSha256: 'b'.repeat(64) }), model({ Afib: .99 }, null)]) {
    assert.doesNotMatch(row(record({ ai: { x: entry } }), 'atrial'), /предполагает фибрилляцию/);
  }
});
test('review provenance is mandatory and tied to the exact recording', () => {
  const r = record({ interpretation: review({ pathologicalWaves: { status: 'absent' } }) });
  assert.ok(reviewedInterpretation(r));
  assert.match(row(r, 'waves'), /не выявлено/);
  for (const change of [{ sourceSha256: 'b'.repeat(64) }, { reviewedBy: '' }, { reviewedAt: '' }, { basis: 'model-score' }]) {
    const other = { ...r, interpretation: { ...r.interpretation, ...change } };
    assert.equal(reviewedInterpretation(other), null);
    assert.match(row(other, 'waves'), /Не определено/);
  }
});
test('reviewed AF/flutter keep atrial activity and ventricular contractions separate', () => {
  for (const [type, label] of [['afib', 'волн мерцания'], ['flutter', 'волн трепетания']]) {
    const r = record({ interpretation: review({ rhythm: { type, atrialActivityRatePerMinute: 320, ventricularRatePerMinute: 85 } }) });
    assert.match(row(r, 'atrial'), new RegExp(label + ' — 320 в минуту'));
    assert.match(row(r, 'atrial'), /желудочков — 85 уд\/мин/);
    assert.match(row(r, 'heartRate'), /85 уд\/мин/);
    delete r.interpretation.rhythm.atrialActivityRatePerMinute;
    assert.match(row(r, 'atrial'), /не измерена/);
  }
});
test('reviewed ectopy preserves origin, recording scope and periodicity', () => {
  const r = record({ interpretation: review({ extrasystoles: { status: 'present', type: 'junctional',
    frequency: 'frequent', frequencyScope: 'recording', pattern: 'trigeminy' } }) });
  assert.match(row(r, 'extrasystoles'), /Узловые; частые на этой записи; после каждых двух обычных сокращений/);
  r.interpretation.extrasystoles.frequencyScope = '24h';
  assert.match(row(r, 'extrasystoles'), /частота не определена/);
  assert.doesNotMatch(row(r, 'extrasystoles'), /частые/);
});
test('report uses the same concise content, escapes text, and has no score table', () => {
  const r = record({ ai: { wcr: model({ 'SECRET-LABEL': .9876 }, { 'SECRET-LABEL': .01 }) } });
  const html = recordReport({ surname: '<script>BAD</script>' }, r);
  for (const entry of buildSummary(r).items) assert.ok(html.includes(entry.text));
  assert.doesNotMatch(html, /SECRET-LABEL|0[.,]9876|пересекла порог|<script>BAD/);
  const c = compareRecords({ ...r, id: 'old', recordedAt: '2026-11-02T15:38:16' }, r);
  assert.doesNotMatch(comparisonReport({}, c), /SECRET-LABEL|0[.,]9876|Изменения оценок нейросетей/);
});
test('a waveform research result stays explicitly preliminary and bound to its source', () => {
  const r = record();
  const text = Object.fromEntries(buildSummary(r).items.map(x => [x.key, 'Измеренное наблюдение: '+x.key]));
  r.waveformResearch = { schemaVersion: 1, basis: 'waveform-research', clinicalValidation: false, sourceSha256: hash,
    method: 'synthetic test', assumptions: { fs_hz: 200, microvolts_per_count: 1 }, summary: text };
  assert.equal(row(r, 'st'), text.st);
  assert.match(buildSummary(r).note, /Предварительный расчёт/);
  r.waveformResearch.sourceSha256 = 'b'.repeat(64);
  assert.match(row(r, 'st'), /Не определено/);
  r.waveformResearch.sourceSha256 = hash;
  r.interpretation = review({ stElevation: { status: 'absent' } });
  assert.match(row(r, 'st'), /не выявлен/);
});
