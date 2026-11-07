// One evidence-backed interpretation for the main screen, print and export.
// Device measurements are usable inputs, independent of waveform-calibration
// flags. Missing inputs remain missing; model scores are never measurements.
import { analyzeECG } from './analysis2.js';
import { extractOrlovWaveform } from './orlov-waveform.js';
import { reviewedInterpretation } from './summary.js';
import { ageAt } from './measure.js';
import { DEEP_LABELS_RU } from './orlov-labels.js';

export const ORLOV_VERSION = 'orlov-synthesis-1';
export const ORLOV_SECTIONS = [
  ['rhythm', 'Ритм, частота и внеочередные сокращения'], ['axis', 'Электрическая ось сердца'],
  ['p', 'Зубец P и предсердия'], ['conduction', 'Атриовентрикулярная и внутрижелудочковая проводимость'],
  ['qrs', 'Комплекс QRS, зубцы Q и прогрессия R'], ['voltage', 'Вольтаж и признаки увеличения камер'],
  ['st', 'Сегмент ST и точка J'], ['t', 'Зубец T'], ['qt', 'Интервал QT и коррекция QTc'], ['u', 'Зубец U'],
  ['syndromes', 'Синдромная интерпретация'], ['dynamics', 'Сравнение с предыдущей ЭКГ'],
  ['classification', 'Суммарная оценка ЭКГ'], ['recommendations', 'Рекомендации по уточнению'],
];
const finite = Number.isFinite;
const fmt = (v, digits = 2) => finite(v) ? Number(v.toFixed(digits)).toLocaleString('ru-RU', { maximumFractionDigits: digits }) : 'не измерено';
const median = xs => { const a = xs.filter(finite).sort((a, b) => a - b), k = a.length >> 1;
  return a.length ? a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2 : null; };
const normalize = label => label.toUpperCase().replace(/[^A-Z0-9]/g, '');
const ALIASES = {
  'SINUSRHYTHM': 'Sinusal', 'NORMALSINUSRHYTHM': 'Sinusal',
  'ATRIALFIBRILLATION': 'Afib', 'ATRIALFLUTTER': 'Atrial flutter',
  'SINUSBRADYCARDIA': 'sinus-bradycardia', 'MARKEDSINUSBRADYCARDIA': 'sinus-bradycardia',
  'SINUSTACHYCARDIA': 'sinus-tachycardia', 'ECTOPICATRIALRHYTHM': 'Ectopic atrial rhythm (< 100 BPM)',
  'PREMATUREVENTRICULARCOMPLEXES': 'Premature ventricular complex', 'PREMATUREATRIALCOMPLEXES': 'Premature atrial complex',
  'PREMATURESUPRAVENTRICULARCOMPLEXES': 'supraventricular-ectopy', 'PREMATUREECTOPICCOMPLEXES': 'ectopy-unspecified',
  'IDIOVENTRICULARRHYTHM': 'Ventricular Rhythm', 'WIDEQRSRHYTHM': 'Ventricular Rhythm',
  'LEFTWARDAXIS': 'Left axis deviation', 'ABNORMALLEFTAXISDEVIATION': 'Left axis deviation',
  'RIGHTWARDAXIS': 'Right axis deviation', 'ABNORMALRIGHTAXISDEVIATION': 'Right axis deviation',
  'RIGHTSUPERIORAXISDEVIATION': 'Right superior axis', 'LOWVOLTAGEQRS': 'Low voltage',
  'WITH1STDEGREEAVBLOCK': '1st degree AV block', 'WITHPROLONGEDAVCONDUCTION': 'long-pr',
  'WITH2NDDEGREEAVBLOCKMOBITZI': '2nd degree AV block - mobitz 1', 'WITHCOMPLETEHEARTBLOCK': 'Third Degree AV Block',
  'WOLFFPARKINSONWHITE': 'Wolff-Parkinson-White (Pre-excitation syndrome)',
  'WITHSHORTPR': 'short-pr', 'ACUTEMISTEMI': 'Acute MI', 'ACUTEMI': 'Acute MI',
  'BIATRIALENLARGEMENT': 'Bi-atrial enlargement', 'VOLTAGECRITERIAFORLEFTVENTRICULARHYPERTROPHY': 'SV1 + RV5 or RV6 > 35 mm',
  'ATRIALPACEDRHYTHM': 'Atrial paced', 'ELECTRONICATRIALPACEMAKER': 'Atrial paced',
  'VENTRICULARPACEDRHYTHM': 'Ventricular paced', 'ELECTRONICVENTRICULARPACEMAKER': 'Ventricular paced',
  'NONSPECIFICINTRAVENTRICULARBLOCK': 'Nonspecific intraventricular conduction delay',
  'WITHQRSWIDENING': 'wide-qrs', 'ORDIGITALISEFFECT': 'digitalis-effect',
};
const EXTRA_RU = {
  'sinus-bradycardia': 'Синусовая брадикардия', 'sinus-tachycardia': 'Синусовая тахикардия',
  'supraventricular-ectopy': 'Наджелудочковые внеочередные сокращения', 'ectopy-unspecified': 'Внеочередные сокращения неуточнённого происхождения',
  'short-pr': 'Короткий PR', 'long-pr': 'Удлинение PR', 'wide-qrs': 'Уширение QRS',
  'INCOMPLETE RIGHT BUNDLE BRANCH BLOCK': 'Неполная блокада правой ножки пучка Гиса',
  'INCOMPLETE LEFT BUNDLE BRANCH BLOCK': 'Неполная блокада левой ножки пучка Гиса',
  'ABNORMAL ECG': 'ЭКГ с отклонениями', 'NORMAL ECG': 'Нормальная ЭКГ', 'BORDERLINE ECG': 'Пограничная ЭКГ',
  'NONSPECIFIC T WAVE ABNORMALITY': 'Неспецифические изменения T', 'NONSPECIFIC ST ABNORMALITY': 'Неспецифические изменения ST',
  'NONSPECIFIC ST AND T WAVE ABNORMALITY': 'Неспецифические изменения ST–T',
  'SEPTAL INFARCT': 'Инфарктные изменения перегородочной области', 'ANTERIOR INFARCT': 'Инфарктные изменения передней области',
  'LATERAL INFARCT': 'Инфарктные изменения боковой области', 'INFERIOR INFARCT': 'Инфарктные изменения нижней области',
  'ANTEROSEPTAL INFARCT': 'Переднеперегородочные инфарктные изменения',
  'ANTEROLATERAL INFARCT': 'Переднебоковые инфарктные изменения', 'POSTERIOR INFARCT': 'Инфарктные изменения задней области',
  'INFERIOR-POSTERIOR INFARCT': 'Нижнезадние инфарктные изменения', 'BIFASCICULAR BLOCK': 'Двухпучковая блокада',
  'WITH SINUS ARRHYTHMIA': 'Синусовая аритмия', 'WITH MARKED SINUS ARRHYTHMIA': 'Выраженная синусовая аритмия',
  'NO P-WAVES FOUND': 'Модель не выделяет зубцы P', 'WITH AV DISSOCIATION': 'АВ-диссоциация',
  'WITH 2:1 AV CONDUCTION': 'Проведение 2:1', 'WITH VARIABLE AV BLOCK': 'Переменная АВ-блокада',
  'WITH SINUS PAUSE': 'Синусовая пауза', 'IN A PATTERN OF BIGEMINY': 'Паттерн бигеминии',
  'MULTIFOCAL ATRIAL TACHYCARDIA': 'Многофокусная предсердная тахикардия',
  'PULMONARY DISEASE PATTERN': 'Паттерн изменений при лёгочной патологии', 'digitalis-effect': 'Возможное влияние дигиталиса',
};
const CANONICAL = new Map(Object.keys(DEEP_LABELS_RU).map(label => [normalize(label), label]));
export function describeModelLabel(label) {
  const key = ALIASES[normalize(label)] || CANONICAL.get(normalize(label)) || label;
  const temporal = /NOW |NO LONGER|MORE |LESS |HAS |HAVE |REPLACED|INCREASED|DECREASED/.test(label.toUpperCase());
  const ru = DEEP_LABELS_RU[key] || EXTRA_RU[key] || label;
  const text = key.toUpperCase();
  let category = 'other';
  if (/AXIS/.test(text)) category = 'axis';
  else if (/PREMATURE|ECTOPY|BIGEMINY|FUSION/.test(text)) category = 'ectopy';
  else if (/SINUS|SINUSAL|RHYTHM|AFIB|FLUTTER|TACHYCARDIA|BRADYCARDIA|REGULAR|PAUSE/.test(text)) category = 'rhythm';
  else if (/ATRIAL ENLARGEMENT|BI-ATRIAL/.test(text)) category = 'p';
  else if (/BLOCK|CONDUCTION|RSR|WIDE-QRS|LONG-PR|SHORT-PR|WOLFF|DELTA|PACED|PACING|PACEMAKER/.test(text)) category = 'conduction';
  else if (/HYPERTROPHY|VOLTAGE|RV[0-9]|SV[0-9]|RAVL|R\/S/.test(text)) category = 'voltage';
  else if (/^Q WAVE|QS COMPLEX|QRS COMPLEX NEGATIVE|R COMPLEX|QRS IN/.test(text)) category = 'qrs';
  else if (/^ST |NONSPECIFIC ST/.test(text)) category = 'st';
  else if (/T WAVE/.test(text)) category = 't';
  else if (/QT/.test(text)) category = 'qt';
  else if (/U WAVE/.test(text)) category = 'u';
  else if (/INFARCT|ACUTE MI|PERICARDITIS|REPOLARIZATION|BRUGADA|PULMONARY|DIGITALIS/.test(text)) category = 'syndromes';
  return { key, label, ru, category, temporal };
}

export function collectModelFindings(record) {
  const models = [], groups = new Map();
  for (const [id, entry] of Object.entries(record.ai || {})) {
    const bound = /^[a-f0-9]{64}$/.test(record.sha256 || '') && entry?.sourceSha256 === record.sha256;
    const eligible = bound && !entry?.synthetic;
    const scores = Object.entries(entry?.scores || {}).filter(([label, v]) => typeof label === 'string' && finite(v) && v >= 0 && v <= 1)
      .sort((a, b) => b[1] - a[1]);
    const model = { id, name: entry?.model || id, eligible, reason: !bound ? 'Не подтверждена связь с исходной записью' : entry?.synthetic ? 'Синтетический вход' : null,
      outputs: scores.length, thresholdCount: Object.values(entry?.thresholds || {}).filter(t => finite(t) && t > 0 && t < 1).length,
      ranked: [], thresholded: [] };
    for (const [index, [label, score]] of scores.entries()) {
      const description = describeModelLabel(label), threshold = entry.thresholds?.[label];
      const hasThreshold = finite(threshold) && threshold > 0 && threshold < 1;
      if (eligible && !description.temporal && model.ranked.length < 5) model.ranked.push({ ...description, score, threshold: hasThreshold ? threshold : null });
      if (!eligible || description.temporal || !hasThreshold || score < threshold) continue;
      model.thresholded.push({ ...description, score, threshold, rank: index + 1 });
      const g = groups.get(description.key) || { ...description, models: [], evidence: [] };
      if (!g.models.includes(id)) g.models.push(id);
      g.evidence.push({ model: id, label, score, threshold, rank: index + 1 }); groups.set(description.key, g);
    }
    models.push(model);
  }
  return { models, findings: [...groups.values()].sort((a, b) => b.models.length - a.models.length
    || Math.min(...a.evidence.map(e => e.rank)) - Math.min(...b.evidence.map(e => e.rank)) || a.ru.localeCompare(b.ru)) };
}

const FIELD_INFO = {
  heart_rate_bpm: ['ЧСС желудочков', 'уд/мин', 10, 400], atrial_rate_bpm: ['Частота предсердий', 'в мин', 10, 1000],
  P_ms: ['Длительность P', 'мс', 1, 400], PR_ms: ['Интервал PQ / PR', 'мс', 20, 1000], QRS_ms: ['Длительность QRS', 'мс', 20, 600],
  QT_ms: ['Интервал QT', 'мс', 100, 1000], QTcB_ms: ['QTc Базетта', 'мс', 100, 1200], QTcF_ms: ['QTc Фридеричиа', 'мс', 100, 1200],
  QRS_axis: ['ЭОС QRS', '°', -180, 180], P_axis: ['Ось P', '°', -180, 180], T_axis: ['Ось T', '°', -180, 180],
  RR_mean_ms: ['Средний RR', 'мс', 100, 6000], RR_cv_pct: ['Вариация RR', '%', 0, 200],
  RV5_mV: ['RV5', 'мВ', 0, 20], RV6_mV: ['RV6', 'мВ', 0, 20], SV1_mV: ['Глубина SV1', 'мВ', 0, 20],
  Sokolow_mV: ['SV1 + max(RV5, RV6)', 'мВ', 0, 40], SokolowV5_mV: ['Доступная сумма SV1 + RV5', 'мВ', 0, 40],
  Macruz_index: ['Индекс Макруза', '', 0, 100], QRS_T_angle_deg: ['Угол QRS–T', '°', 0, 180],
};

function resolveMeasurements(record, analysis, wave, review) {
  const measurements = {}, invalid = [];
  const add = (key, value, source, provisional = false, formula = null, inputs = []) => {
    const info = FIELD_INFO[key];
    if (!info || !finite(value) || value < info[2] || value > info[3]) return false;
    measurements[key] = { key, label: info[0], value, unit: info[1], source, provisional, formula, inputs }; return true;
  };
  const rawDevice = record.device || {}, stored = record.measurements || {};
  for (const key of Object.keys(FIELD_INFO)) {
    const manual = review?.measurements?.[key];
    if (finite(manual) && add(key, manual, 'review')) continue;
    let value = finite(stored[key]) ? stored[key] : rawDevice[key];
    if (key === 'SV1_mV' && finite(value)) value = Math.abs(value);
    if (value != null && !add(key, value, 'file')) invalid.push(key);
  }
  const reviewedHR = review?.rhythm?.ventricularRatePerMinute;
  if (finite(reviewedHR)) add('heart_rate_bpm', reviewedHR, 'review');
  if (finite(review?.rhythm?.atrialActivityRatePerMinute)) add('atrial_rate_bpm', review.rhythm.atrialActivityRatePerMinute, 'review');
  const rr = Array.isArray(rawDevice.RR_ms) && rawDevice.RR_ms.length >= 2 && rawDevice.RR_ms.every(v => finite(v) && v > 0 && v <= 6000)
    ? rawDevice.RR_ms : null;
  if (rr) {
    const avg = rr.reduce((s, v) => s + v, 0) / rr.length;
    const sd = Math.sqrt(rr.reduce((s, v) => s + (v - avg) ** 2, 0) / (rr.length - 1));
    add('RR_mean_ms', avg, 'file-rr', false, 'mean(RR)', ['device.RR_ms']);
    add('RR_cv_pct', 100 * sd / avg, 'file-rr', false, '100 × SD(RR) / mean(RR)', ['device.RR_ms']);
  }
  const fallback = { heart_rate_bpm: 'heartRate', atrial_rate_bpm: 'atrialRate', P_ms: 'P_ms', PR_ms: 'PR_ms',
    QRS_ms: 'QRS_ms', QT_ms: 'QT_ms', QRS_axis: 'axis' };
  for (const [key, field] of Object.entries(fallback)) if (!measurements[key]) {
    const v = analysis.measurements?.[field];
    if (v?.value != null) add(key, v.value, v.source, !v.verified);
    else if (finite(wave.measurements?.[key])) add(key, wave.measurements[key], 'waveform-estimate', true);
  }
  if (!measurements['Macruz_index'] && finite(wave.measurements['Macruz_index'])) add('Macruz_index', wave.measurements['Macruz_index'], 'waveform-estimate', true,
    'duration(P) / (PR − duration(P))', ['P_ms', 'PR_ms']);
  if (!measurements.RR_mean_ms && measurements.heart_rate_bpm) add('RR_mean_ms', 60000 / measurements.heart_rate_bpm.value,
    'derived-from-rate', measurements.heart_rate_bpm.provisional, '60000 / HR', ['heart_rate_bpm']);
  const qt = measurements.QT_ms, rrMean = measurements.RR_mean_ms;
  if (qt && rrMean) {
    const provisional = qt.provisional || rrMean.provisional;
    add('QTcB_ms', qt.value / Math.sqrt(rrMean.value / 1000), 'calculated', provisional, 'QT / sqrt(RR_seconds)', ['QT_ms', 'RR_mean_ms']);
    add('QTcF_ms', qt.value / Math.cbrt(rrMean.value / 1000), 'calculated', provisional, 'QT / cbrt(RR_seconds)', ['QT_ms', 'RR_mean_ms']);
  }
  const pDuration = measurements.P_ms, prDuration = measurements.PR_ms;
  if (pDuration && prDuration && prDuration.value > pDuration.value)
    add('Macruz_index', pDuration.value / (prDuration.value - pDuration.value), 'calculated', pDuration.provisional || prDuration.provisional,
      'duration(P) / (PR − duration(P))', ['P_ms', 'PR_ms']);
  const byLead = Object.fromEntries(wave.leads.map(l => [l.lead, l]));
  for (const [key, lead, field] of [['RV5_mV', 'V5', 'r_mV'], ['RV6_mV', 'V6', 'r_mV'], ['SV1_mV', 'V1', 's_mV']])
    if (!measurements[key] && finite(byLead[lead]?.[field])) add(key, Math.abs(byLead[lead][field]), 'waveform-estimate', true);
  const s = measurements.SV1_mV, r5 = measurements.RV5_mV, r6 = measurements.RV6_mV;
  if (s && r5) add('SokolowV5_mV', s.value + r5.value, 'calculated', s.provisional || r5.provisional, 'abs(SV1) + RV5', ['SV1_mV', 'RV5_mV']);
  if (s && r5 && r6) add('Sokolow_mV', s.value + Math.max(r5.value, r6.value), 'calculated', s.provisional || r5.provisional || r6.provisional,
    'abs(SV1) + max(RV5, RV6)', ['SV1_mV', 'RV5_mV', 'RV6_mV']);
  const a = measurements.QRS_axis, t = measurements.T_axis;
  if (a && t) { const d = Math.abs(a.value - t.value) % 360;
    add('QRS_T_angle_deg', Math.min(d, 360 - d), 'calculated', a.provisional || t.provisional, 'min(abs(QRS−T), 360−abs(QRS−T))', ['QRS_axis', 'T_axis']); }
  return { measurements, invalid, rr };
}

const RHYTHM_KEYS = new Set(['Sinusal', 'sinus-bradycardia', 'sinus-tachycardia', 'Afib', 'Atrial flutter',
  'Ectopic atrial rhythm (< 100 BPM)', 'Junctional rhythm', 'Ventricular Rhythm']);
const REVIEW_RHYTHMS = { sinus: 'Синусовый ритм', atrial: 'Эктопический предсердный ритм', junctional: 'Ритм из АВ-соединения',
  ventricular: 'Желудочковый ритм', afib: 'Фибрилляция предсердий', flutter: 'Трепетание предсердий' };
const regions = ['II', 'III', 'aVF', 'I', 'aVL', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const leadList = ls => regions.filter(l => ls.includes(l)).join(', ');

export function buildOrlovConclusion(record = {}, patient = {}, { previous = null, analysis: suppliedAnalysis = null } = {}) {
  const analysis = suppliedAnalysis || analyzeECG(record, patient);
  const wave = extractOrlovWaveform(record, analysis), review = reviewedInterpretation(record);
  const resolved = resolveMeasurements(record, analysis, wave, review), m = resolved.measurements;
  const models = collectModelFindings(record), findings = models.findings, conflicts = [], impression = [], sections = [];
  const age = ageAt(patient.birthDate, record.recordedAt), adult = age !== null && age >= 18;
  const limitations = [
    { id: 'L01', text: 'Модельные гипотезы не равны установленным диагнозам; баллы не являются индивидуальной вероятностью заболевания или степенью тяжести.' },
    { id: 'L02', text: 'Отсутствие пороговой гипотезы модели не доказывает отсутствие нарушения.' },
    { id: 'L03', text: 'Автоматические границы и морфология волн пока исследовательские; значения по ним обозначаются как предварительные.' },
    { id: 'L04', text: 'Средний PR и RR не устанавливают тип АВ- или СА-блокады; нужен анализ последовательности предсердных и желудочковых событий.' },
    { id: 'L05', text: 'Число кандидатов P и ранних событий не равно числу подтверждённых предсердных волн или экстрасистол; нагрузка за сутки из короткой записи не определяется.' },
    { id: 'L06', text: 'Q, ST и T сами по себе не устанавливают некроз, трансмуральность, стадию или давность инфаркта.' },
    { id: 'L07', text: 'Вольтажные индексы являются ЭКГ-признаками и не подтверждают анатомическую гипертрофию без сопоставления с другими данными.' },
    { id: 'L08', text: 'ТЭЛА, концентрации электролитов и действие конкретного препарата не устанавливаются по одной ЭКГ.' },
    { id: 'L09', text: 'Изменение показателя при сравнении записей не равнозначно доказанной клинической динамике.' },
    { id: 'L10', text: 'Неизмеренные показатели не заменяются нулями или отрицательными заключениями; общая норма без полного анализа не присваивается.' },
    { id: 'L14', text: 'Для читаемого итога выделяются пороговые ответы, вошедшие в первые 10 оценок хотя бы одной модели; это правило представления, не доказанный диагностический порог. Все остальные пороговые ответы сохранены в источниках и JSON.' },
  ];
  if (!adult) limitations.push({ id: 'L11', text: age === null ? 'Возраст не указан: взрослые нормативы для классификации не применены.' : 'Полный набор детских возрастных нормативов не реализован.' });
  if (models.models.some(m => m.eligible && !m.thresholdCount && m.ranked.length)) limitations.push({ id: 'L12', text: 'Для части моделей не заданы применимые пороги классов: ранжирование показано в источниках и не превращается в положительный диагноз.' });
  if (models.models.some(m => !m.eligible)) limitations.push({ id: 'L13', text: 'Архивные или синтетические вложения без подтверждённой связи с этой ЭКГ не включаются в положительные выводы.' });
  const value = key => m[key]?.value ?? null;
  const metricText = key => m[key] ? `${m[key].provisional ? 'около ' : ''}${fmt(m[key].value)}${m[key].unit ? ' ' + m[key].unit : ''}` : 'не измерено';
  const section = (key, paragraphs, evidence = [], status = 'partial') => sections.push({ key,
    title: ORLOV_SECTIONS.find(s => s[0] === key)[1], paragraphs: paragraphs.filter(Boolean), evidence, status });
  // A long list of single-model alerts is not a coherent final diagnosis. Put
  // cross-model agreement first; retain every raw result in expandable evidence.
  const selected = category => {
    const all = findings.filter(f => f.category === category && f.evidence.some(e => e.rank <= 10));
    const consensus = all.filter(f => f.models.length >= 2);
    return consensus.length ? consensus : all.slice(0, 2);
  };
  const modelSentence = fs => fs.length ? `Ведущие модельные гипотезы: ${fs.slice(0, 6).map(f => `${f.ru} (${f.models.length >= 2 ? 'согласие ' + f.models.length + ' моделей' : 'одна модель'})`).join('; ')}.` : '';
  const recordObservation = text => { if (text && !impression.includes(text)) impression.push(text); };
  const byLead = Object.fromEntries(wave.leads.map(l => [l.lead, l]));

  // Rhythm and rates: separate electrical atrial activity from ventricular HR.
  const hr = value('heart_rate_bpm'), regularity = value('RR_cv_pct');
  const rhythmCandidates = selected('rhythm').filter(f => RHYTHM_KEYS.has(f.key));
  const consistentRhythms = rhythmCandidates.filter(f => {
    const wrongRate = f.key === 'sinus-bradycardia' && hr !== null && hr >= 60 || f.key === 'sinus-tachycardia' && hr !== null && hr <= 100;
    if (wrongRate) conflicts.push({ key: 'rate-model', text: `${f.ru}: гипотеза модели расходится с ЧСС ${metricText('heart_rate_bpm')} в файле.` });
    return !wrongRate;
  });
  const reviewedRhythm = REVIEW_RHYTHMS[review?.rhythm?.type];
  const consensus = consistentRhythms.filter(f => f.models.length >= 2);
  const selectedRhythm = reviewedRhythm || (consensus.length === 1 ? 'Гипотеза ритма: ' + consensus[0].ru : null);
  if (consensus.length > 1 && !reviewedRhythm) conflicts.push({ key: 'rhythm', text: 'Модели одновременно поддерживают разные источники ритма; единственный источник автоматически не выбран.' });
  if (consensus.length === 1 && !reviewedRhythm) {
    const origin = key => ['sinus-bradycardia','sinus-tachycardia'].includes(key) ? 'Sinusal' : key;
    for (const model of models.models.filter(model => model.eligible && !model.thresholdCount)) {
      const ranked = model.ranked.find(f => RHYTHM_KEYS.has(f.key));
      if (ranked && origin(ranked.key) !== origin(consensus[0].key)) conflicts.push({ key: 'ranked-rhythm',
        text: `${model.name} выше ранжирует «${ranked.ru}», тогда как пороговые ответы других моделей поддерживают «${consensus[0].ru}». Источники расходятся; ранжирование без порога не является подтверждением.` });
    }
  }
  const rhythmParts = [selectedRhythm ? selectedRhythm + '.' : consistentRhythms.length ? modelSentence(consistentRhythms)
    : 'Источник ритма по доступным результатам не установлен.',
  hr !== null ? `ЧСС желудочков ${metricText('heart_rate_bpm')}${adult ? hr < 60 ? ' — снижена относительно взрослого ориентира 60–100 в покое.' : hr > 100 ? ' — повышена относительно взрослого ориентира 60–100 в покое.' : ' — в пределах взрослого ориентира 60–100 в покое.' : '; оценка по детскому возрастному нормативу не выполнена.'}` : 'ЧСС не рассчитана.',
  regularity !== null ? `Вариация RR ${metricText('RR_cv_pct')}.` : null,
  value('atrial_rate_bpm') !== null ? `Частота электрической активности предсердий ${metricText('atrial_rate_bpm')}.` : 'Частота предсердий отдельно не установлена.'];
  const ectopy = selected('ectopy');
  if (review?.extrasystoles?.status === 'absent') rhythmParts.push('По привязанной врачебной оценке на этой записи экстрасистолы не выявлены.');
  else if (review?.extrasystoles?.status === 'present') rhythmParts.push('В привязанной врачебной оценке указаны экстрасистолы.');
  else rhythmParts.push(ectopy.length ? modelSentence(ectopy) + ' Количество и периодичность событий не классифицированы.'
    : 'Внеочередные сокращения: итоговый класс не определён.');
  section('rhythm', rhythmParts, [...rhythmCandidates, ...ectopy]);
  recordObservation(selectedRhythm ? selectedRhythm + (hr !== null ? `, ЧСС ${metricText('heart_rate_bpm')}.` : '.')
    : hr !== null ? `ЧСС желудочков ${metricText('heart_rate_bpm')}; источник ритма ${consistentRhythms.length ? 'модельно неоднозначен' : 'не установлен'}.` : 'Ритм и ЧСС не установлены.');
  if (ectopy.length) recordObservation('Гипотезы внеочередных сокращений: ' + ectopy.slice(0, 2).map(f => f.ru).join('; ') + '; количественная оценка не установлена.');

  // Axis: the device angle is already a measurement, not a missing waveform flag.
  const axis = value('QRS_axis');
  const axisDirection = axis === null ? null : axis >= -30 && axis <= 90 ? 'в пределах взрослого референса −30…+90°'
    : axis < -30 && axis >= -90 ? 'отклонена влево' : axis > 90 ? 'отклонена вправо' : 'крайнее отклонение вправо-вверх';
  section('axis', [axis === null ? 'Числовой угол ЭОС отсутствует.' : `ЭОС ${metricText('QRS_axis')}${adult ? ': ' + axisDirection : '; детская возрастная категория не определена'}.`,
    value('P_axis') !== null ? `Ось P ${metricText('P_axis')}; ось T ${metricText('T_axis')}.` : null,
    modelSentence(selected('axis'))], selected('axis'), axis === null ? 'missing' : 'assessed');
  if (axis !== null) recordObservation(adult ? `ЭОС ${axisDirection} (${metricText('QRS_axis')}).` : `ЭОС ${metricText('QRS_axis')}; возрастной норматив не применён.`);

  const pLeads = wave.leads.filter(l => finite(l.p_mV));
  const pNegative = pLeads.filter(l => l.p_mV < -.02).map(l => l.lead).filter(l => l !== 'aVR');
  section('p', [value('P_ms') !== null ? `Длительность P ${metricText('P_ms')}${adult && value('P_ms') > 120 ? '; увеличение длительности требует оценки межпредсердного проведения' : ''}.` : 'Надёжная длительность P не выделена.',
    pLeads.length ? `Предварительные амплитуды P по кривой: ${pLeads.map(l => `${l.lead} ${fmt(l.p_mV, 3)} мВ`).join('; ')}.` : 'Амплитуда и форма P отдельно не измерены.',
    pNegative.length ? `Кандидаты отрицательного P в ${leadList(pNegative)}; происхождение ритма по одной полярности не определяется.` : null,
    value('Macruz_index') !== null ? `Индекс Макруза ${metricText('Macruz_index')} = длительность P / длительность сегмента PQ.` : 'Индекс Макруза не рассчитан: нужны длительность P и сегмент PQ.',
    modelSentence(selected('p'))], selected('p'));

  const pr = value('PR_ms'), qrs = value('QRS_ms');
  const conduction = selected('conduction');
  const prText = pr === null ? 'Интервал PQ / PR не измерен.' : `PQ / PR ${metricText('PR_ms')}${adult ? pr > 200 ? ' — удлинён; совместим с задержкой АВ-проведения, тип требует оценки связей P–QRS.'
    : pr < 120 ? ' — укорочен; без дельта-волны и морфологии QRS синдром предвозбуждения не устанавливается.' : ' — в пределах 120–200 мс.' : '; детский норматив не применён.'}`;
  const qrsText = qrs === null ? 'Длительность QRS не измерена.' : `QRS ${metricText('QRS_ms')}${adult ? qrs >= 120 ? ' — широкий; тип блокады, аберрации или желудочкового происхождения определяется по морфологии.'
    : qrs >= 110 ? ' — пограничное уширение; полная блокада по длительности не подтверждается.' : ' — менее 110 мс.' : '; детский норматив не применён.'}`;
  for (const f of conduction) if (qrs !== null && qrs < 120 && /^(Left|Right) bundle branch block$/.test(f.key))
    conflicts.push({ key: 'qrs-block', text: `${f.ru}: модельная гипотеза не подтверждается критерием полной блокады QRS ≥120 мс (в файле ${metricText('QRS_ms')}).` });
  section('conduction', [prText, qrsText, modelSentence(conduction)], conduction);
  if (adult && pr !== null && (pr < 120 || pr > 200)) recordObservation(`${pr < 120 ? 'Укорочение' : 'Удлинение'} PR (${metricText('PR_ms')}).`);
  if (adult && qrs !== null && qrs >= 110) recordObservation(`${qrs >= 120 ? 'Широкий' : 'Погранично уширенный'} QRS (${metricText('QRS_ms')}).`);
  if (conduction.length) recordObservation('Модельные признаки: ' + conduction.slice(0, 3).map(f => f.ru).join('; ') + '; тип требует сопоставления с морфологией.');

  const qLeads = wave.leads.filter(l => finite(l.qDuration_ms) && finite(l.qInitial_mV));
  const qCandidates = qLeads.filter(l => l.qDuration_ms >= 30 && Math.abs(l.qInitial_mV) >= .25 * (l.r_mV || Infinity));
  const rs = ['V1','V2','V3','V4','V5','V6'].map(l => byLead[l]).filter(l => finite(l?.r_mV));
  section('qrs', [qLeads.length ? `Предварительные начальные Q: ${qLeads.map(l => `${l.lead}: ${fmt(l.qDuration_ms)} мс, ${fmt(l.qInitial_mV, 3)} мВ`).join('; ')}.`
    : 'Начальные Q с измеренными границами не выделены.',
    qCandidates.length ? `В ${leadList(qCandidates.map(l => l.lead))} получено сочетание длительности Q ≥30 мс и отношения |Q|/R ≥0,25; требует оценки группы отведений, морфологии и исключений.` : null,
    rs.length ? `Прогрессия R: ${rs.map(l => `${l.lead} ${fmt(l.r_mV, 3)}`).join(' → ')} мВ (предварительно).` : 'Прогрессия R не измерена.',
    modelSentence(selected('qrs'))], selected('qrs'));

  const voltage = selected('voltage'), sokolow = value('Sokolow_mV'), partialSokolow = value('SokolowV5_mV');
  const limb = wave.leads.filter(l => ['I','II','III','aVR','aVL','aVF'].includes(l.lead));
  const chest = wave.leads.filter(l => /^V[1-6]$/.test(l.lead));
  const limbVoltage = limb.length === 6 && limb.every(l => finite(l.ptp_mV)) ? limb.every(l => l.ptp_mV < .5) : null;
  const chestVoltage = chest.length === 6 && chest.every(l => finite(l.ptp_mV)) ? chest.every(l => l.ptp_mV < 1) : null;
  const rv1 = byLead.V1?.r_mV, sv1 = byLead.V1?.s_mV, sv6 = byLead.V6?.s_mV;
  section('voltage', [sokolow !== null ? `SV1 + max(RV5, RV6) = ${metricText('Sokolow_mV')}${adult ? sokolow > 3.5 ? '; вольтажный порог 3,5 мВ превышен.' : '; порог 3,5 мВ не превышен.' : '.'}`
    : partialSokolow !== null ? `Доступная сумма SV1 + RV5 = ${metricText('SokolowV5_mV')}; полного индекса с max(RV5, RV6) нет.` : 'Индекс Соколова–Лайона не рассчитан.',
    finite(byLead.aVL?.r_mV) ? `R в aVL около ${fmt(byLead.aVL.r_mV, 3)} мВ${byLead.aVL.r_mV > 1.1 ? '; превышен вольтажный ориентир 1,1 мВ' : ''}.` : null,
    finite(rv1) && finite(sv1) && sv1 !== 0 ? `R/S в V1 около ${fmt(rv1 / Math.abs(sv1))}.` : null,
    finite(rv1) && finite(sv6) ? `RV1 + |SV6| около ${fmt(rv1 + Math.abs(sv6), 3)} мВ.` : null,
    limbVoltage !== null || chestVoltage !== null ? `По предварительным амплитудам размах QRS ниже 0,5 мВ во всех конечностных отведениях: ${limbVoltage === null ? 'не определено' : limbVoltage ? 'да' : 'нет'}; ниже 1 мВ во всех грудных: ${chestVoltage === null ? 'не определено' : chestVoltage ? 'да' : 'нет'}.` : null,
    modelSentence(voltage)], voltage);
  if (adult && sokolow !== null && sokolow > 3.5) recordObservation(`Вольтажный критерий Соколова–Лайона превышен (${metricText('Sokolow_mV')}); это ЭКГ-признак, а не подтверждение анатомической гипертрофии.`);

  const stLeads = wave.leads.filter(l => finite(l.stJ_mV));
  const tNegative = wave.leads.filter(l => l.lead !== 'aVR' && l.tPolarity === 'negative');
  const tBiphasic = wave.leads.filter(l => l.tPolarity === 'biphasic');
  const st = selected('st');
  section('st', [stLeads.length ? `ST в предполагаемой точке J, предварительно: ${stLeads.map(l => `${l.lead} ${l.stJ_mV > 0 ? '+' : ''}${fmt(l.stJ_mV, 3)}`).join('; ')} мВ.` : 'Амплитуда ST относительно точки J не измерена.',
    modelSentence(st),
    review?.stElevation?.status === 'present' ? 'Подъём ST указан в привязанной врачебной оценке.' : review?.stElevation?.status === 'absent' ? 'По привязанной врачебной оценке подъём ST на записи не выявлен.' : null], st);
  section('t', [tNegative.length ? `Предварительно отрицательный T в ${leadList(tNegative.map(l => l.lead))}.` : 'Устойчивая инверсия T автоматическим измерителем не установлена.',
    tBiphasic.length ? `Двухфазная форма T: ${leadList(tBiphasic.map(l => l.lead))}, предварительная оценка.` : null,
    wave.leads.some(l => finite(l.tPositive_mV)) ? 'Фазы T по кривой, предварительно (положительная / отрицательная): ' + wave.leads.filter(l => finite(l.tPositive_mV) && finite(l.tNegative_mV))
      .map(l => `${l.lead}: ${fmt(l.tPositive_mV, 3)} / ${fmt(l.tNegative_mV, 3)}`).join('; ') + ' мВ.' : null,
    modelSentence(selected('t'))], selected('t'));
  if (st.length) recordObservation('ИИ-признаки изменений ST: ' + st.slice(0, 3).map(f => f.ru).join('; ') + '.');
  if (selected('t').length) recordObservation('ИИ-признаки изменений T: ' + selected('t').slice(0, 3).map(f => f.ru).join('; ') + '.');

  const qtc = value('QTcF_ms'), sex = patient.sex, limit = sex === 'F' ? 460 : sex === 'M' ? 450 : null;
  section('qt', [value('QT_ms') !== null ? `QT ${metricText('QT_ms')}. QTc Базетта ${metricText('QTcB_ms')}; QTc Фридеричиа ${metricText('QTcF_ms')}.` : 'QT не измерен; коррекция QTc не рассчитана.',
    qtc !== null && adult && limit !== null ? `QTcF ${qtc > limit ? 'выше' : 'не выше'} взрослого ориентира ${limit} мс${qtc >= 500 ? '; значение требует приоритетной проверки' : ''}.`
      : qtc !== null ? 'Пол/возраст не позволяют применить выбранный взрослый норматив QTc.' : null,
    modelSentence(selected('qt'))], selected('qt'), qtc === null ? 'missing' : 'assessed');
  if (adult && limit !== null && qtc !== null && qtc > limit) recordObservation(`QTcF удлинён относительно выбранного взрослого ориентира: ${metricText('QTcF_ms')}.`);

  const uLeadNames = [...new Set(wave.uCandidates.map(u => u.lead))];
  section('u', [wave.uCandidates.length ? `После T выделены кандидаты U в ${leadList(uLeadNames)}; отделение U от хвоста T и следующего P не подтверждено.`
    : 'Отдельный зубец U достоверно не выделен.', modelSentence(selected('u'))], selected('u'));

  const syndromes = selected('syndromes');
  const acute = syndromes.some(f => f.key === 'Acute MI');
  const ischemic = syndromes.filter(f => /INFARCT|ACUTE MI|INJURY/.test(f.key.toUpperCase()));
  const pericardial = syndromes.filter(f => /PERICARD|REPOLARIZATION/.test(f.key.toUpperCase()));
  const otherSyndromes = syndromes.filter(f => !ischemic.includes(f) && !pericardial.includes(f));
  const s1q3t3 = finite(byLead.I?.s_mV) && byLead.I.s_mV < 0 && finite(byLead.III?.qInitial_mV) && byLead.III.qInitial_mV < 0 && byLead.III?.tPolarity === 'negative';
  section('syndromes', [ischemic.length ? 'Ишемические / инфарктные паттерны: ' + modelSentence(ischemic) : 'Ишемические / инфарктные паттерны: согласованное синдромное заключение не сформировано.',
    pericardial.length ? 'Перикард / ранняя реполяризация: ' + modelSentence(pericardial) : 'Перикард / ранняя реполяризация: итоговая гипотеза не сформирована.',
    s1q3t3 ? 'По предварительной морфологии найдено сочетание S в I, начального Q и отрицательного T в III (S_I–Q_III–T_III); это описание паттерна.'
      : 'Перегрузка правых отделов / ТЭЛА: самостоятельное синдромное заключение не сформировано.',
    otherSyndromes.length ? modelSentence(otherSyndromes) : null,
    'Электролитное или лекарственное объяснение: итоговая гипотеза по доступным данным не сформирована.'], syndromes);
  if (syndromes.length) recordObservation('Синдромные ИИ-гипотезы: ' + syndromes.slice(0, 3).map(f => f.ru).join('; ') + '.');

  let dynamics = null;
  if (previous && record.patientId && previous.patientId === record.patientId) {
    const prior = buildOrlovConclusion(previous, patient);
    const deltas = ['heart_rate_bpm','PR_ms','QRS_ms','QT_ms','QTcF_ms','QRS_axis'].flatMap(key => {
      const a = prior.measurements[key], b = m[key];
      if (!a || !b || a.source !== b.source || a.provisional !== b.provisional) return [];
      let delta = b.value - a.value;
      if (key === 'QRS_axis') { delta = ((delta + 180) % 360 + 360) % 360 - 180; }
      return [{ key, label: b.label, previous: a.value, current: b.value, delta, unit: b.unit, provisional: b.provisional }];
    });
    dynamics = { previousRecordedAt: previous.recordedAt || null, deltas };
    section('dynamics', [deltas.length ? deltas.map(d => `${d.label}: ${fmt(d.previous)} → ${fmt(d.current)} ${d.unit}, Δ ${fmt(d.delta)}${d.provisional ? ' (предварительно)' : ''}`).join('; ') + '.'
      : 'Для двух записей нет сопоставимых одноимённых измерений.'], []);
  } else section('dynamics', [previous ? 'Выбранная предыдущая запись не принадлежит подтверждённо тому же пациенту.' : 'Предыдущая ЭКГ для сравнения не выбрана.'], [], 'missing');

  const reliableAbnormal = adult && [axis !== null && (axis < -30 || axis > 90) && !m.QRS_axis?.provisional,
    pr !== null && (pr < 120 || pr > 200) && !m.PR_ms?.provisional, qrs !== null && qrs >= 110 && !m.QRS_ms?.provisional,
    hr !== null && (hr < 60 || hr > 100) && !m.heart_rate_bpm?.provisional,
    limit !== null && qtc !== null && qtc > limit && !m.QTcF_ms?.provisional].some(Boolean);
  const classification = reliableAbnormal ? 'ЭКГ с зарегистрированными отклонениями' : findings.some(f => f.evidence.some(e => e.rank <= 10) && !['Regular','Monomorph','Sinusal'].includes(f.key) && f.category !== 'other')
    ? 'ЭКГ с предполагаемыми изменениями по данным ИИ' : 'Итоговая категория не определена: полного исключения изменений нет';
  section('classification', [classification + '.'], [], 'assessed');
  const recommendations = [];
  if (acute) recommendations.push('Модель выделяет острый ишемический паттерн: требуется приоритетная врачебная оценка; при текущей боли в груди, одышке или обмороке — экстренная помощь.');
  if (conflicts.length) recommendations.push('Разрешить противоречия между измерениями и гипотезами моделей при просмотре соответствующих фрагментов кривой.');
  if (ectopy.length) recommendations.push('Для происхождения и количества внеочередных сокращений проверить отдельные события; при необходимости длительной оценки — мониторирование по решению врача.');
  if (qtc !== null && limit !== null && qtc > limit) recommendations.push('Проверить окончание T и QTc; учесть принимаемые препараты и электролиты по клиническим показаниям.');
  if (!previous) recommendations.push('Сопоставить с предыдущей ЭКГ, если она доступна.');
  if (!recommendations.length) recommendations.push('Проверить автоматическое заключение по кривой с учётом симптомов, анамнеза и лекарств.');
  section('recommendations', recommendations, [], 'assessed');
  return { schemaVersion: 1, version: ORLOV_VERSION, sourceSha256: record.sha256 || null,
    title: 'Итоговое ИИ-заключение по ЭКГ', patientContext: { age, sex: patient.sex || null },
    measurements: m, sections, impression, classification, conflicts, models: models.models, modelFindings: findings,
    summaryEvidence: { rhythm: { reviewedType: review?.rhythm?.type || null, selectedLabel: selectedRhythm,
      findings: consistentRhythms, conflicting: conflicts.some(c => c.key === 'rhythm' || c.key === 'ranked-rhythm') },
      ectopy: { review: review?.extrasystoles || null, findings: ectopy }, conduction,
      st, t: selected('t'), voltage, p: selected('p'), syndromes },
    waveform: wave, dynamics, limitations, technical: { analysis, invalidMeasurements: resolved.invalid },
    clinicalValidation: false, note: 'Автоматическое ЭКГ-заключение. Модельные гипотезы и предварительные измерения требуют врачебной проверки.' };
}
