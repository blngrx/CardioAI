// Plain-language summary. Classifier scores are hypotheses, never measurements,
// severity grades, beat counts, or evidence that a finding is absent.
import { ageAt } from './measure.js';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const rate = v => finite(v) && v >= 10 && v <= 400;
const number = v => Math.round(v).toLocaleString('ru-RU');
const item = (key, label, text) => ({ key, label, text });
const UNKNOWN = 'Не определено по имеющимся данным.';

// A reviewed interpretation belongs to one exact ECG. Legacy model JSON cannot
// silently become a confirmed medical interpretation just by having a large score.
export function reviewedInterpretation(record) {
  const r = record.interpretation;
  return r?.schemaVersion === 1 && r.basis === 'clinician-reviewed'
    && typeof r.reviewedBy === 'string' && r.reviewedBy.trim()
    && typeof r.reviewedAt === 'string' && Number.isFinite(Date.parse(r.reviewedAt))
    && /^[a-f0-9]{64}$/.test(record.sha256 || '') && r.sourceSha256 === record.sha256 ? r : null;
}

function modelEntries(record) {
  return Object.values(record.ai || {}).filter(e => e && !e.synthetic && e.scores && typeof e.scores === 'object'
    && (!e.sourceSha256 || (record.sha256 && e.sourceSha256 === record.sha256)));
}
function suggests(entries, match) {
  // A score without the authors' operating threshold is not a binary finding.
  return entries.some(e => Object.entries(e.scores).some(([label, value]) =>
    match(label) && finite(value) && value >= 0 && value <= 1
    && finite(e.thresholds?.[label]) && e.thresholds[label] > 0 && e.thresholds[label] < 1
    && value >= e.thresholds[label]));
}

function heartRate(record, patient, review) {
  const v = review?.rhythm?.ventricularRatePerMinute;
  const hr = rate(v) ? v : record.measurements?.heart_rate_bpm;
  if (!rate(hr)) return { text: UNKNOWN, value: null, origin: null };
  const origin = rate(v) ? 'по проверенной записи' : record.source === 'ecg301' ? 'по данным прибора' : 'по сохранённым показателям';
  const age = ageAt(patient.birthDate, record.recordedAt);
  // 60–100 is the adult RESTING reference, not a child-specific or exercise range.
  const description = age !== null && age < 18 ? 'оценка нормы по возрасту не настроена'
    : `${hr < 60 ? 'пониженная' : hr > 100 ? 'повышенная' : 'нормальная'} для взрослого в покое`;
  return { text: `${number(hr)} уд/мин — ${description}, ${origin}.`, value: hr, origin };
}

function axis(record, review) {
  const names = { normal: 'Обычное направление.', left: 'Отклонена влево.', right: 'Отклонена вправо.',
    extreme: 'Направлена резко вверх.', anterior: 'Отклонена вперёд.', posterior: 'Отклонена назад.' };
  if (Object.hasOwn(names, review?.axis?.direction)) return names[review.axis.direction];
  const v = record.measurements?.QRS_axis;
  if (!finite(v) || v < -180 || v > 180) return UNKNOWN;
  const direction = v >= -30 && v <= 90 ? 'Обычное направление'
    : v < -30 && v >= -90 ? 'Отклонена влево' : v > 90 ? 'Отклонена вправо' : 'Направлена резко вверх';
  return `${direction}${record.source === 'ecg301' ? ', по данным прибора' : ', по сохранённому показателю'}.`;
}

function waves(review, entries) {
  if (review?.pathologicalWaves?.status === 'present') return 'Выявлены изменённые зубцы, требующие оценки врача.';
  if (review?.pathologicalWaves?.status === 'absent') return 'Патологических зубцов на этой записи не выявлено.';
  return suggests(entries, l => /^Q wave|^QS complex|^T wave inversion/.test(l))
    ? 'ИИ предполагает изменения зубцов. Наличие патологических зубцов не подтверждено.' : UNKNOWN;
}
function st(review, entries) {
  if (review?.stElevation?.status === 'present') return 'Подъём ST выявлен на этой записи.';
  if (review?.stElevation?.status === 'absent') return 'Подъём ST на этой записи не выявлен.';
  return suggests(entries, l => /^ST elevation/.test(l)) ? 'ИИ предполагает подъём ST. Требуется проверка записи.' : UNKNOWN;
}

const RHYTHMS = {
  sinus: 'Обычный ритм — импульсы идут из естественного водителя сердца.',
  atrial: 'Предсердный ритм — импульсы идут из другого участка предсердий.',
  junctional: 'Узловой ритм — импульсы идут из области соединения предсердий и желудочков.',
  ventricular: 'Желудочковый ритм — импульсы идут из желудочков.',
  afib: 'Фибрилляция предсердий — мерцательная аритмия.',
  flutter: 'Трепетание предсердий.',
};
function rhythm(review, entries) {
  const type = review?.rhythm?.type;
  if (Object.hasOwn(RHYTHMS, type)) return RHYTHMS[type];
  const suspicion = suggests(entries, l => /Afib|flutter|tachycardia|Junctional|Ectopic atrial|Ventricular Rhythm/.test(l));
  return suspicion ? 'ИИ предполагает нарушение ритма. Его вид по этим оценкам не подтверждён.' : 'Тип ритма не определён.';
}

function extrasystoles(review, entries) {
  const e = review?.extrasystoles;
  if (e?.status === 'absent') return 'На этой записи не выявлены.';
  if (e?.status !== 'present') return suggests(entries, l => /Premature (atrial|ventricular) complex/.test(l))
    ? 'ИИ предполагает внеочередные сокращения. Тип, частота и повторяемость не определены.' : UNKNOWN;
  const types = { atrial: 'Предсердные', junctional: 'Узловые', ventricular: 'Желудочковые', mixed: 'Разного происхождения' };
  const frequency = { rare: 'редкие на этой записи', moderate: 'умеренное количество на этой записи', frequent: 'частые на этой записи' };
  const patterns = { bigeminy: 'после каждого обычного сокращения', trigeminy: 'после каждых двух обычных сокращений',
    quadrigeminy: 'после каждых трёх обычных сокращений', pairs: 'идут парами', runs: 'идут группами',
    irregular: 'без постоянного порядка' };
  // A brief recording cannot establish a daily burden. Frequency must have an explicit recording scope.
  const f = e.frequencyScope === 'recording' ? frequency[e.frequency] : null;
  return `${types[e.type] || 'Тип не определён'}; ${f || 'частота не определена'}; ${patterns[e.pattern] || 'повторяемость не определена'}.`;
}

function atrialRhythm(review, entries, hr) {
  const type = review?.rhythm?.type;
  const names = { sinus: 'Обычный предсердный ритм.', atrial: 'Предсердный ритм из другого участка предсердий.',
    afib: 'Фибрилляция предсердий (мерцательная аритмия).', flutter: 'Трепетание предсердий.' };
  let text = Object.hasOwn(names, type) ? names[type] : 'Предсердный ритм не определён.';
  if (!Object.hasOwn(names, type)) {
    const af = suggests(entries, l => l === 'Afib'), flutter = suggests(entries, l => l === 'Atrial flutter');
    if (af || flutter) text = `ИИ предполагает ${af && flutter ? 'фибрилляцию или трепетание предсердий' : af ? 'фибрилляцию предсердий (мерцательную аритмию)' : 'трепетание предсердий'}. Не подтверждено.`;
    else if (suggests(entries, l => l === 'Ectopic atrial rhythm (< 100 BPM)')) text = 'ИИ предполагает предсердный ритм из другого участка предсердий. Не подтверждено.';
  }
  const atrialRate = review?.rhythm?.atrialActivityRatePerMinute;
  const measured = finite(atrialRate) && atrialRate >= 10 && atrialRate <= 1000;
  // Electrical atrial activity and ventricular contractions are different quantities.
  // Never copy ventricular HR to atrial frequency or infer atrial rate from model scores.
  text += ` Частота ${type === 'afib' ? 'волн мерцания' : type === 'flutter' ? 'волн трепетания' : 'электрической активности предсердий'} — ${measured ? number(atrialRate) + ' в минуту' : 'не измерена'}.`;
  text += ` Сокращения желудочков — ${hr.value !== null ? number(hr.value) + ' уд/мин, ' + hr.origin : 'частота не определена'}.`;
  return text;
}

// A separate, explicitly non-diagnostic waveform calculation may supply observations.
// It never masquerades as a clinician-reviewed interpretation or a verified calibration.
function waveformObservations(record) {
  const r = record.waveformResearch;
  const keys = ['heartRate', 'axis', 'waves', 'st', 'rhythm', 'extrasystoles', 'atrial'];
  return r?.schemaVersion === 1 && r.basis === 'waveform-research' && r.clinicalValidation === false
    && /^[a-f0-9]{64}$/.test(record.sha256 || '') && r.sourceSha256 === record.sha256
    && typeof r.method === 'string' && r.method.trim()
    && finite(r.assumptions?.fs_hz) && r.assumptions.fs_hz > 0
    && finite(r.assumptions?.microvolts_per_count) && r.assumptions.microvolts_per_count > 0
    && keys.every(k => typeof r.summary?.[k] === 'string' && r.summary[k].trim() && r.summary[k].length <= 500) ? r : null;
}

export function buildSummary(record, patient = {}) {
  const review = reviewedInterpretation(record), entries = modelEntries(record);
  const hr = heartRate(record, patient, review);
  const calculation = review ? null : waveformObservations(record);
  const result = {
    items: [item('heartRate', 'Частота сердца', hr.text), item('axis', 'Электрическая ось сердца', axis(record, review)),
      item('waves', 'Патологические зубцы', waves(review, entries)), item('st', 'Подъём ST', st(review, entries)),
      item('rhythm', 'Ритм сердца', rhythm(review, entries)), item('extrasystoles', 'Экстрасистолы — внеочередные сокращения', extrasystoles(review, entries)),
      item('atrial', 'Предсердный ритм', atrialRhythm(review, entries, hr))],
    note: review ? 'Сводка включает проверенное заключение по этой записи.'
      : entries.length ? 'Предположения ИИ не являются диагнозом. «Не определено» не означает «отклонений нет».'
        : 'ИИ этой записи не оценивал. «Не определено» не означает «отклонений нет».',
  };
  if (calculation) {
    result.items = result.items.map(row => ({ ...row, text: calculation.summary[row.key] }));
    result.note = 'Предварительный расчёт по кривой: время и масштаб записи не подтверждены. Это не врачебное заключение; выводы относятся только к этому фрагменту.';
  }
  return result;
}
