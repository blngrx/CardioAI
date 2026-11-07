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

test('eight concise fields, adult resting rate, axis direction without angles', () => {
  const r = record();
  assert.equal(buildSummary(r).items.length, 8);
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
  assert.match(row(r, 'extrasystoles'), /требуют просмотра кривой/);
  assert.doesNotMatch(row(r, 'extrasystoles'), /частые|редкие|парами/);
  assert.match(row(r, 'atrial'), /фибрилляции/);
  assert.match(row(r, 'atrial'), /предсердий — не измерена/);
  assert.match(row(r, 'atrial'), /желудочков — 62 уд\/мин/);
  const negative = record({ ai: { wcr: model({ Afib: 0 }, { Afib: .5 }) } });
  assert.match(row(negative, 'waves'), /нужен просмотр кривой/);
  assert.match(row(negative, 'st'), /нужен просмотр кривой/);
  assert.doesNotMatch(row(negative, 'extrasystoles'), /не выявлены/);
});
test('synthetic, foreign ECG and thresholdless output cannot create findings', () => {
  for (const entry of [model({ Afib: .99 }, { Afib: .1 }, { synthetic: true }),
    model({ Afib: .99 }, { Afib: .1 }, { sourceSha256: 'b'.repeat(64) }), model({ Afib: .99 }, null)]) {
    assert.doesNotMatch(row(record({ ai: { x: entry } }), 'atrial'), /Возможны признаки фибрилляции/);
  }
});
test('unbound legacy reports remain archival and cannot create summary findings', () => {
  const r = record({ ai: { old: { scores: { Afib: .99 }, thresholds: { Afib: .1 } } } });
  assert.doesNotMatch(row(r, 'atrial'), /Возможны признаки фибрилляции/);
});
test('ECGFounder concept mapping still requires its own label-specific threshold', () => {
  const r = record({ ai: { founder: model({ 'ATRIAL FIBRILLATION': .9 }, { 'ATRIAL FIBRILLATION': .7 }) } });
  assert.match(row(r, 'atrial'), /Возможны признаки фибрилляции/);
  r.ai.founder.thresholds = { Afib: .1 };
  assert.doesNotMatch(row(r, 'atrial'), /Возможны признаки фибрилляции/);
});
test('review provenance is mandatory and tied to the exact recording', () => {
  const r = record({ interpretation: review({ pathologicalWaves: { status: 'absent' } }) });
  assert.ok(reviewedInterpretation(r));
  assert.match(row(r, 'waves'), /не выявлено/);
  for (const change of [{ sourceSha256: 'b'.repeat(64) }, { reviewedBy: '' }, { reviewedAt: '' }, { basis: 'model-score' }]) {
    const other = { ...r, interpretation: { ...r.interpretation, ...change } };
    assert.equal(reviewedInterpretation(other), null);
    assert.match(row(other, 'waves'), /нужен просмотр кривой/);
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
  const html = recordReport({ surname: '<script>BAD</script>' }, r, { compact: true });
  for (const entry of buildSummary(r).items) assert.ok(html.includes(entry.text));
  assert.doesNotMatch(html, /SECRET-LABEL|0[.,]9876|пересекла порог|<script>BAD/);
  const c = compareRecords({ ...r, id: 'old', recordedAt: '2026-11-02T15:38:16' }, r);
  assert.doesNotMatch(comparisonReport({}, c), /SECRET-LABEL|0[.,]9876|Изменения оценок нейросетей/);
});
test('archived free-text research cannot override the current calculation', () => {
  const r = record();
  const text = Object.fromEntries(buildSummary(r).items.map(x => [x.key, 'Измеренное наблюдение: '+x.key]));
  r.waveformResearch = { schemaVersion: 1, basis: 'waveform-research', clinicalValidation: false, sourceSha256: hash,
    method: 'synthetic test', assumptions: { fs_hz: 200, microvolts_per_count: 1 }, summary: text };
  assert.notEqual(row(r, 'st'), text.st);
  assert.match(buildSummary(r).note, /Исследовательский результат/);
  r.waveformResearch.sourceSha256 = 'b'.repeat(64);
  assert.match(row(r, 'st'), /нужен просмотр кривой/);
  r.waveformResearch.sourceSha256 = hash;
  r.interpretation = review({ stElevation: { status: 'absent' } });
  assert.match(row(r, 'st'), /не выявлен/);
});

test('P and T inversion are separate observations, not a blanket pathology diagnosis', () => {
  const r = record({ interpretation: review({ waveInversion: {
    P: { status: 'present', leads: ['II', 'III', 'aVF', 'II', '<script>'] },
    T: { status: 'present', leads: ['aVR'] }
  } }) });
  assert.match(row(r, 'waveInversion'), /P: перевёрнутая форма в II, III, aVF/);
  assert.match(row(r, 'waveInversion'), /T: отрицательный в aVR — обычное направление/);
  assert.doesNotMatch(row(r, 'waveInversion'), /<script>|патологическ/);
  r.interpretation.waveInversion.T = { status: 'absent' };
  assert.match(row(r, 'waveInversion'), /T: инверсия на этой записи не выявлена/);
});
test('legacy free text is retained in data without replacing current measurements', () => {
  const r = record();
  const summary = Object.fromEntries(buildSummary(r).items.filter(x => x.key !== 'waveInversion').map(x => [x.key, 'Наблюдение '+x.key]));
  r.waveformResearch = { schemaVersion: 1, basis: 'waveform-research', clinicalValidation: false, sourceSha256: hash,
    method: 'test', assumptions: { fs_hz: 200, microvolts_per_count: 1 }, summary };
  assert.match(row(r, 'axis'), /влево/);
  assert.match(row(r, 'waveInversion'), /нужен просмотр кривой/);
  assert.doesNotMatch(row(r, 'waveInversion'), /undefined/);
});

test('partial inversion review preserves the unassessed wave and normal aVR polarity', () => {
  for (const wave of ['P', 'T']) {
    const r = record({ interpretation: review({ waveInversion: {
      [wave]: { status: 'present', leads: ['aVR'] }
    } }) });
    assert.match(row(r, 'waveInversion'), new RegExp(wave + ': отрицательный в aVR — обычное направление'));
    const other = wave === 'P' ? 'T' : 'P';
    assert.match(row(r, 'waveInversion'), new RegExp(other + ': инверсия отдельно не определена'));
  }
});

test('T inversion hypothesis does not become a pathological Q wave finding', () => {
  const r = record({ ai: { x: model({ 'T wave inversion': .9 }, { 'T wave inversion': .5 }) } });
  assert.match(row(r, 'waves'), /нужен просмотр кривой/);
  assert.match(row(r, 'waveInversion'), /Возможна инверсия T/);
});

test('sinus origin does not certify normal frequency or conduction', () => {
  const r = record({ interpretation: review({ rhythm: { type: 'sinus', ventricularRatePerMinute: 120 } }) });
  assert.match(row(r, 'heartRate'), /повышенная/);
  assert.match(row(r, 'rhythm'), /Синусовый ритм/);
  assert.doesNotMatch(row(r, 'rhythm'), /Обычный ритм|нормальный/);
});

test('axis gives quadrant without severity and treats the two 180-degree forms equally', () => {
  assert.match(row(record({ measurements: { QRS_axis: -120 } }), 'axis'), /вверх и вправо/);
  assert.equal(row(record({ measurements: { QRS_axis: -180 } }), 'axis'),
    row(record({ measurements: { QRS_axis: 180 } }), 'axis'));
});
