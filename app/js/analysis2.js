// Research ECG pipeline. Measurements, rule applicability and model suggestions
// stay separate. Automatic delineation is provisional, never a clinical review.
import { LEADS } from './ecg301.js';
import { measureWaveform, axisFromAreas, intervalsFromFiducials } from './waveform.js';
import { ageAt } from './measure.js';

export const ANALYSIS2_VERSION = '2.0.0-research.1';
// Map only shared concepts; keep scores and thresholds model-specific.
const LABEL_MAP = {
  'ATRIAL FIBRILLATION': 'Afib', 'ATRIAL FLUTTER': 'Atrial flutter',
  'PREMATURE VENTRICULAR COMPLEXES': 'Premature ventricular complex',
  'PREMATURE ATRIAL COMPLEXES': 'Premature atrial complex',
  'SUPRAVENTRICULAR TACHYCARDIA': 'Supraventricular tachycardia',
  'VENTRICULAR TACHYCARDIA': 'Ventricular tachycardia',
  'RIGHT BUNDLE BRANCH BLOCK': 'Right bundle branch block', 'LEFT BUNDLE BRANCH BLOCK': 'Left bundle branch block',
};
export const canonicalModelLabel = label => LABEL_MAP[label] || label;
const finite = Number.isFinite;
const median = xs => {
  const a = xs.filter(finite).sort((a, b) => a - b), k = a.length >> 1;
  return a.length ? a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2 : null;
};
const quantile = (xs, p) => {
  const a = [...xs].sort((a, b) => a - b);
  return a.length ? a[Math.floor(p * (a.length - 1))] : 0;
};
const round = (v, p = 2) => finite(v) ? Math.round(v * 10 ** p) / 10 ** p : null;
const interval = (x, a, b) => x.slice(Math.max(0, a), Math.min(x.length, b));
const metric = (value, unit, source, verified, reason = null) => ({ value: round(value, 3), unit, source,
  verified: finite(value) && verified === true, reason: finite(value) ? reason : reason || 'Измерение недоступно' });

export function assessLead(raw, fs) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.some(v => !finite(v)))
    return { usable: false, reasons: ['Повреждённые отсчёты'], noiseCounts: null };
  const changes = raw.slice(1).map((v, i) => Math.abs(v - raw[i]));
  const range = Math.max(...raw) - Math.min(...raw);
  const noise = median(changes) / .954;
  const span = quantile(raw, .99) - quantile(raw, .01);
  const reasons = [];
  if (!(range > 0)) reasons.push('Плоский сигнал');
  if (range > 0 && noise > span / 6) reasons.push('Выраженная высокочастотная помеха');
  // Repeated extrema can be clipping, but are not proof without an ADC contract.
  const lo = Math.min(...raw), hi = Math.max(...raw);
  let plateau = 0, run = 1;
  for (let i = 1; i < raw.length; i++) {
    run = raw[i] === raw[i - 1] && (raw[i] === lo || raw[i] === hi) ? run + 1 : 1;
    plateau = Math.max(plateau, run);
  }
  return { usable: !reasons.length, reasons, noiseCounts: round(noise), rangeCounts: range,
    clippingSuspected: range > 0 && plateau >= Math.max(4, .04 * fs) };
}

// Local threshold crossing only proposes boundaries. It cannot certify the
// absence of low-amplitude QRS tails, merged waves or atrial activity.
function delineate(raw, peak, fs, nextPeak, previousPeak, noise) {
  const at = seconds => Math.round(seconds * fs);
  const baseline = median(interval(raw, peak - at(.28), peak - at(.22)));
  if (baseline === null) return null;
  const amplitude = Math.abs(raw[peak] - baseline);
  if (!(amplitude > 5 * noise)) return null;
  const threshold = Math.max(3 * noise, .06 * amplitude);
  const reach = at(.16), hold = Math.max(2, at(.015));
  const bound = direction => {
    let quiet = 0;
    for (let i = peak + direction; i > 0 && i < raw.length - 1 && Math.abs(i - peak) <= reach; i += direction) {
      quiet = Math.abs(raw[i] - baseline) <= threshold ? quiet + 1 : 0;
      if (quiet >= hold) return i - direction * (hold - 1);
    }
    return null;
  };
  const onset = bound(-1), offset = bound(1);
  if (onset === null || offset === null) return null;
  // If an adjacent event crowds the search window, do not propose a T end.
  const tFrom = offset + at(.04);
  const tTo = Math.min(raw.length - hold, peak + at(.55), nextPeak === null ? raw.length - hold : nextPeak - at(.22));
  let tPeak = null, tEnd = null;
  if (tTo > tFrom + at(.08)) {
    let best = tFrom;
    for (let i = tFrom; i < tTo; i++) if (Math.abs(raw[i] - baseline) > Math.abs(raw[best] - baseline)) best = i;
    const height = Math.abs(raw[best] - baseline);
    if (height > Math.max(5 * noise, amplitude * .05) && best > tFrom + at(.02) && best < tTo - hold) {
      tPeak = best;
      const limit = Math.max(3 * noise, height * .1);
      let quiet = 0;
      for (let i = best + 1; i < tTo; i++) {
        quiet = Math.abs(raw[i] - baseline) <= limit ? quiet + 1 : 0;
        if (quiet >= hold) { tEnd = i - hold + 1; break; }
      }
    }
  }
  return { qrsPeak: peak, qrsOnset: onset, qrsOffset: offset, tPeak, tEnd, baseline,
    previousPeak, nextPeak, source: 'automatic-proposal', reviewed: false };
}

// Scan the complete signal for isolated slow deflections outside estimated QRS
// and T regions. No mandatory "one P per R" maximum is constructed.
function atrialCandidates(raw, beats, fs, noise) {
  const excluded = new Uint8Array(raw.length), radius = Math.max(2, Math.round(.02 * fs));
  for (const b of beats) {
    const end = b.tEnd ?? b.qrsPeak + Math.round(.55 * fs);
    for (let i = Math.max(0, b.qrsOnset - Math.round(.03 * fs)); i < Math.min(raw.length, end + radius); i++) excluded[i] = 1;
  }
  const base = median(raw), qrsHeight = median(beats.map(b => Math.abs(raw[b.qrsPeak] - b.baseline)));
  if (base === null || !qrsHeight) return [];
  const candidates = [];
  for (let i = radius; i < raw.length - radius; i++) {
    if (excluded[i]) continue;
    const height = Math.abs(raw[i] - base);
    if (height <= Math.max(5 * noise, .025 * qrsHeight) || height >= .4 * qrsHeight) continue;
    const local = interval(raw, i - radius, i + radius + 1).map(v => Math.abs(v - base));
    if (height !== Math.max(...local)) continue;
    if (candidates.length && i - candidates.at(-1).peak < .12 * fs) continue;
    let start = i, end = i;
    const threshold = Math.max(3 * noise, .15 * height);
    while (start > 0 && !excluded[start - 1] && i - start < .08 * fs && Math.abs(raw[start - 1] - base) > threshold) start--;
    while (end < raw.length - 1 && !excluded[end + 1] && end - i < .08 * fs && Math.abs(raw[end + 1] - base) > threshold) end++;
    if ((end - start) / fs < .035 || start === 0 || end === raw.length - 1 || excluded[start - 1] || excluded[end + 1]) continue;
    candidates.push({ onset: start, peak: i, end, polarity: raw[i] >= base ? 'positive' : 'negative',
      source: 'independent-atrial-candidate-scan', confirmedP: false });
  }
  return candidates;
}

function annotationBeats(record, signal) {
  const a = record.fiducials, n = signal.leads[0].length;
  if (!a) return { beats: null, reason: null };
  if (a.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(record.sha256 || '') || a.sourceSha256 !== record.sha256
      || a.fs !== signal.fs || typeof a.reviewedBy !== 'string' || !a.reviewedBy.trim()
      || typeof a.reviewedAt !== 'string' || !finite(Date.parse(a.reviewedAt)) || !Array.isArray(a.beats) || !a.beats.length)
    return { beats: null, reason: 'Разметка не привязана к этой записи или не имеет автора, даты и частоты' };
  const beats = [];
  for (const b of a.beats) {
    if (!b || ![b.qrsOnset, b.qrsPeak, b.qrsOffset].every(v => Number.isInteger(v) && v >= 0 && v < n)
        || !(b.qrsOnset < b.qrsPeak && b.qrsPeak < b.qrsOffset)
        || (beats.length && (b.qrsOnset <= beats.at(-1).qrsOffset || (beats.at(-1).tEnd != null && b.qrsOnset <= beats.at(-1).tEnd)))
        || (b.tEnd != null && (!Number.isInteger(b.tEnd) || b.tEnd <= b.qrsOffset || b.tEnd >= n))
        || (b.pOnset != null && (!Number.isInteger(b.pOnset) || b.pOnset < 0 || b.pOnset >= b.qrsOnset))
        || (b.pEnd != null && (!Number.isInteger(b.pEnd) || b.pOnset == null || b.pEnd <= b.pOnset || b.pEnd >= b.qrsOnset)))
      return { beats: null, reason: 'Неверные или пересекающиеся границы разметки' };
    beats.push({ ...b, source: 'reviewed-fiducials', reviewed: true });
  }
  return { beats, reason: null };
}

export function modelEvidence(record) {
  return Object.entries(record.ai || {}).map(([key, entry]) => {
    const bound = /^[a-f0-9]{64}$/.test(record.sha256 || '') && entry?.sourceSha256 === record.sha256;
    const eligible = bound && !entry?.synthetic;
    const suggestions = [];
    if (eligible) for (const [label, value] of Object.entries(entry.scores || {})) {
      const threshold = entry.thresholds?.[label];
      if (finite(value) && value >= 0 && value <= 1 && finite(threshold) && threshold > 0 && threshold < 1 && value >= threshold)
        suggestions.push({ label, canonicalLabel: canonicalModelLabel(label), score: value, threshold, hypothesis: true });
    }
    return { key, eligible, bound, synthetic: entry?.synthetic === true, labelCount: Object.keys(entry?.scores || {}).length,
      reason: !bound ? 'Нет совпадающей SHA-256 исходника' : entry?.synthetic ? 'Синтетический вход' : null,
      thresholdCount: Object.keys(entry?.thresholds || {}).length, suggestions };
  });
}

function leadMetrics(raw, beats, fs, gain, usable) {
  if (!usable) return null;
  const rows = [];
  for (const b of beats) {
    const baseline = median(interval(raw, b.qrsOnset - Math.round(.06 * fs), b.qrsOnset - Math.round(.02 * fs)));
    if (baseline === null || b.qrsOnset < .06 * fs) continue;
    const segment = raw.slice(b.qrsOnset, b.qrsOffset + 1).map(v => v - baseline);
    const r = Math.max(0, ...segment), minimum = Math.min(0, ...segment);
    const firstPositive = segment.findIndex(v => v > .02 * Math.max(r, -minimum));
    const s = firstPositive >= 0 ? Math.min(0, ...segment.slice(firstPositive + 1)) : null;
    const area = segment.reduce((a, v) => a + v, 0);
    // Q is only the initial negative deflection, never an S between r and R'.
    const initial = [];
    for (const v of segment) { if (v > .02 * Math.max(r, -minimum)) break; initial.push(v); }
    const q = Math.min(0, ...initial);
    const stWindow = interval(raw, b.qrsOffset, b.qrsOffset + Math.max(1, Math.round(.012 * fs)));
    const t = b.tEnd != null ? interval(raw, b.qrsOffset + Math.round(.04 * fs), b.tEnd).map(v => v - baseline) : [];
    const tPos = t.length ? Math.max(0, ...t) : null, tNeg = t.length ? Math.min(0, ...t) : null;
    rows.push({ area, r, s, q, minimum, ptp: r - minimum, st: median(stWindow) - baseline, tPos, tNeg,
      tPolarity: t.length ? tPos > .2 * Math.max(tPos, -tNeg) && -tNeg > .2 * Math.max(tPos, -tNeg) ? 'biphasic'
        : tPos >= -tNeg ? 'positive' : 'negative' : null });
  }
  if (!rows.length) return null;
  const scaled = field => {
    const value = median(rows.map(r => r[field]));
    return gain === null || value === null ? null : round(value * gain, 4);
  };
  return { beats: rows.length, areaCounts: median(rows.map(r => r.area)), r_mV: scaled('r'), s_mV: scaled('s'),
    q_mV: scaled('q'), minimumQRS_mV: scaled('minimum'), ptp_mV: scaled('ptp'), stJ_mV: scaled('st'), tPositive_mV: scaled('tPos'), tNegative_mV: scaled('tNeg'),
    tPolarity: rows.every(r => r.tPolarity === rows[0].tPolarity) ? rows[0].tPolarity : 'variable',
    source: beats.every(b => b.reviewed) ? 'reviewed-fiducials' : 'automatic-proposal' };
}

function finding(key, label, ready, condition, value, reason, evidence = {}) {
  return { key, label, status: ready ? condition ? 'present' : 'absent' : 'unassessable', value,
    reason: ready ? null : reason, ...evidence };
}

export function analyzeECG(record, patient = {}, { previous = null } = {}) {
  const signal = record?.signal, fs = signal?.fs, leads = signal?.leads;
  const result = { schemaVersion: 2, algorithmVersion: ANALYSIS2_VERSION, clinicalValidation: false,
    sourceSha256: record?.sha256 || null, available: false, limitations: [], stages: [], measurements: {},
    leads: [], beats: [], atrialCandidates: [], findings: [], models: modelEvidence(record || {}), dynamics: null };
  const stage = (key, label, status, reason = null) => result.stages.push({ key, label, status, reason });
  stage('source', 'Исходная запись', record?.sha256 ? 'complete' : 'limited', record?.sha256 ? null : 'Нет контрольной суммы исходника');
  if (!finite(fs) || fs < 100 || fs > 2000 || !Array.isArray(leads) || leads.length !== 12
      || !Number.isInteger(leads[0]?.length) || leads[0].length < fs || leads[0].length > 30000
      || leads.some(l => !Array.isArray(l) || l.length !== leads[0].length)) {
    stage('input', 'Проверка сигнала', 'blocked', 'Нужны 12 равных массивов, fs 100–2000 Гц, 1 с и не более 30 000 отсчётов');
    result.limitations.push('Цифровой сигнал недоступен или не соответствует контракту');
    return result;
  }
  const n = leads[0].length;
  const timing = signal.timingVerified === true, synchronous = signal.simultaneousVerified === true;
  const gain = finite(signal.calibration?.microvoltsPerCount) && signal.calibration.microvoltsPerCount > 0
    ? signal.calibration.microvoltsPerCount / 1000 : null;
  const amplitude = signal.calibration?.verified === true && gain !== null;
  result.profile = { fs, samples: n, durationSeconds: n / fs, timingVerified: timing, amplitudeVerified: amplitude,
    simultaneousVerified: synchronous, gainMvPerCount: gain };
  stage('input', 'Время, масштаб и синхронность', timing && amplitude && synchronous ? 'complete' : 'limited');
  if (!timing) result.limitations.push('Частота хранения не подтверждена: длительности и частоты предварительные');
  if (!amplitude) result.limitations.push('Масштаб не подтверждён: амплитудные критерии отключены');
  if (!synchronous) result.limitations.push('Синхронность не подтверждена: независимая оценка ЭОС отключена');
  const quality = leads.map(l => assessLead(l, fs));
  result.quality = quality.map((q, i) => ({ lead: LEADS[i], ...q }));
  stage('quality', 'Качество отведений', quality.every(q => q.usable) ? 'complete' : 'limited');
  const waveform = measureWaveform({ ...signal, leads: leads.map((lead, i) => quality[i].usable ? lead : Array(n).fill(0)) },
    { minDurationSeconds: 2, minEvents: 3 });
  if (waveform.shortRecording) result.limitations.push('Короткая запись: предварительная частота по трём или более событиям; нагрузка аритмией за сутки не определяется');
  result.waveform = waveform;
  const annotation = annotationBeats(record, signal);
  if (annotation.reason) result.limitations.push(annotation.reason);
  let reference = waveform.referenceLead;
  if (annotation.beats && (!Number.isInteger(reference) || !quality[reference]?.usable)) reference = quality.findIndex(q => q.usable);
  const peaks = annotation.beats?.map(b => b.qrsPeak) || (waveform.available ? waveform.qrsSamples : []);
  const raw = leads[reference];
  const auto = raw && peaks.length ? peaks.map((p, i) => delineate(raw, p, fs, peaks[i + 1] ?? null, peaks[i - 1] ?? null,
    quality[reference].noiseCounts)).filter(Boolean) : [];
  const beats = annotation.beats || auto;
  result.beats = beats;
  const reviewed = !!annotation.beats;
  result.referenceLead = Number.isInteger(reference) && reference >= 0 ? LEADS[reference] : null;
  result.boundarySource = reviewed ? 'reviewed-fiducials' : 'automatic-proposal';
  stage('events', 'Желудочковые события', peaks.length ? 'complete' : 'blocked', peaks.length ? null : 'Нет согласованного ряда QRS');
  stage('boundaries', 'Границы волн', reviewed ? 'complete' : beats.length ? 'limited' : 'blocked', reviewed ? null : 'Автоматические границы — предварительные кандидаты');
  if (!reviewed) result.limitations.push('Границы QRS/T и морфология рассчитаны исследовательским детектором; подтверждение отсутствует');
  if (raw && beats.length) result.atrialCandidates = atrialCandidates(raw, beats, fs, quality[reference].noiseCounts);
  stage('atrial', 'Независимая предсердная активность', 'limited', 'Кандидаты не подтверждают P/F; источник и частота предсердий автоматически не устанавливаются');
  const rr = peaks.slice(1).map((p, i) => (p - peaks[i]) / fs);
  const meanRR = rr.length ? rr.reduce((s, v) => s + v, 0) / rr.length : null;
  result.measurements.heartRate = metric(meanRR > 0 ? 60 / meanRR : null, 'уд/мин', reviewed ? 'reviewed-fiducials' : 'qrs-consensus-1', timing);
  const values = beats.map((b, i) => intervalsFromFiducials({ fs, pOnset: b.pOnset, qrsOnset: b.qrsOnset,
    qrsOffset: b.qrsOffset, tEnd: b.tEnd, rrSeconds: rr[i - 1] ?? rr[i] }));
  for (const field of ['PR_ms', 'QRS_ms', 'QT_ms', 'QTcB_ms', 'QTcF_ms'])
    result.measurements[field] = metric(median(values.map(v => v[field])), 'мс', result.boundarySource, timing && reviewed,
      reviewed ? null : 'Границы волн требуют проверки');
  result.measurements.P_ms = metric(median(beats.map(b => Number.isInteger(b.pOnset) && Number.isInteger(b.pEnd)
    ? (b.pEnd - b.pOnset) / fs * 1000 : null)), 'мс', result.boundarySource, timing && reviewed);
  const pOnsets = beats.filter(b => Number.isInteger(b.pOnset)).map(b => b.pOnset);
  const pp = pOnsets.slice(1).map((p, i) => (p - pOnsets[i]) / fs);
  result.measurements.atrialRate = metric(pOnsets.length >= 3 && median(pp) > 0 ? 60 / median(pp) : null,
    'в мин', 'reviewed-atrial-onsets', timing && reviewed,
    'Только по независимо размеченным P; не копируется из частоты желудочков');
  result.events = beats.map((b, i) => ({ sample: b.qrsPeak, seconds: round(b.qrsPeak / fs, 4),
    precedingRR_ms: i > 0 ? round((b.qrsPeak - beats[i - 1].qrsPeak) / fs * 1000) : null,
    QRS_ms: round((b.qrsOffset - b.qrsOnset) / fs * 1000),
    prematureCandidate: i > 0 && median(rr) > 0 ? (b.qrsPeak - beats[i - 1].qrsPeak) / fs < .8 * median(rr) : null,
    class: 'unclassified', reason: 'Раннее событие и ширина не устанавливают происхождение экстрасистолы' }));
  result.leads = LEADS.map((name, i) => ({ lead: name, ...leadMetrics(leads[i], beats, fs, gain, quality[i].usable) }));
  const byLead = Object.fromEntries(result.leads.map(l => [l.lead, l]));
  const axisReady = reviewed && synchronous && quality[0].usable && quality[1].usable && signal.equalChannelGainVerified === true;
  result.measurements.axis = metric(axisReady ? axisFromAreas(byLead.I.areaCounts, byLead.II.areaCounts) : null, '°', result.boundarySource, axisReady,
    'Для ЭОС нужны проверенные границы, синхронность и равный масштаб I/II');
  const sokolow = byLead.V1.s_mV != null && (byLead.V5.r_mV != null || byLead.V6.r_mV != null)
    ? Math.abs(byLead.V1.s_mV) + Math.max(byLead.V5.r_mV ?? 0, byLead.V6.r_mV ?? 0) : null;
  result.measurements.sokolow = metric(sokolow, 'мВ', result.boundarySource, amplitude && reviewed);
  const age = ageAt(patient.birthDate, record.recordedAt);
  const adult = age !== null && age >= 18;
  const m = result.measurements, durationReady = reviewed && timing && adult;
  result.findings.push(finding('wideQRS', 'Широкий QRS ≥120 мс', durationReady && m.QRS_ms.value !== null,
    m.QRS_ms.value >= 120, m.QRS_ms.value, 'Нужны подтверждённые границы, время и взрослый возраст; блокада по одной ширине не определяется'));
  result.findings.push(finding('longPR', 'PR >200 мс', durationReady && m.PR_ms.value !== null,
    m.PR_ms.value > 200, m.PR_ms.value, 'Нужны независимо размеченные P и QRS, время и взрослый возраст'));
  result.findings.push(finding('voltageLV', 'Вольтажный критерий Соколова–Лайона >3,5 мВ', adult && reviewed && amplitude && sokolow !== null,
    sokolow > 3.5, round(sokolow), 'Нужны подтверждённые амплитуда, границы и взрослый возраст; критерий не равен диагнозу гипертрофии'));
  // ECG pattern only. Never an infarct diagnosis; wide/paced QRS needs separate rules.
  const stReady = durationReady && amplitude && synchronous && m.QRS_ms.value !== null && m.QRS_ms.value < 120
    && ['M', 'F'].includes(patient.sex) && !record.pacedRhythm;
  const stHits = result.leads.filter(l => {
    const threshold = ['V2', 'V3'].includes(l.lead) ? patient.sex === 'F' ? .15 : age < 40 ? .25 : .2 : .1;
    return l.stJ_mV != null && l.stJ_mV >= threshold;
  }).map(l => l.lead);
  // Anatomical adjacency is explicit; aVR is not pooled with arbitrary limb leads.
  const groups = [['II', 'III', 'aVF'], ['I', 'aVL'], ['V1', 'V2'], ['V2', 'V3'], ['V3', 'V4'], ['V4', 'V5'], ['V5', 'V6'], ['I', 'V5', 'V6']];
  const stPattern = groups.some(g => g.filter(l => stHits.includes(l)).length >= 2);
  result.findings.push(finding('stElevation', 'Пороговый паттерн подъёма ST в соседних отведениях', false, stPattern, null,
    stReady ? 'Полный набор исключений и клиническая применимость ещё не проверены; доступен только список пороговых превышений'
      : 'Нужны подтверждённые J, масштаб, время, синхронность, возраст и пол; ограничения широкого/стимулированного QRS',
    { candidateLeads: stReady ? stHits : [], hypothesis: stReady && stPattern, criterion: 'ESC-2023-3.2.1', clinicalDiagnosis: false }));
  for (const [key, label, reason] of [
    ['rhythm', 'Источник ритма', 'Нужны проверенные предсердные события и связи P–QRS'],
    ['ectopy', 'Экстрасистолы', 'Полная классификация отдельных событий ещё не валидирована'],
    ['blocks', 'Тип нарушения проводимости', 'Одних PR/QRS недостаточно; морфологические правила не валидированы'],
    ['ischemia', 'Ишемия / инфаркт', 'ЭКГ-наблюдения и баллы моделей не устанавливают клинический диагноз'],
    ['electrolytes', 'Электролитные изменения', 'Нужны клинические и лабораторные данные']])
    result.findings.push(finding(key, label, false, false, null, reason));
  stage('measurements', 'Интервалы и морфология', beats.length ? 'limited' : 'blocked', 'Каждый показатель имеет собственное основание и ограничения');
  stage('rules', 'Применимые правила', result.findings.some(f => f.status !== 'unassessable') ? 'limited' : 'blocked',
    'Неприменимые и неразработанные проверки не дают отрицательных выводов');
  stage('models', 'Гипотезы моделей', result.models.some(m => m.eligible) ? 'limited' : 'blocked', 'Баллы не являются вероятностью заболевания');
  result.conflicts = [];
  const wide = result.findings.find(f => f.key === 'wideQRS');
  if (wide.status === 'absent' && result.models.some(m => m.suggestions.some(s => /^(Right|Left) bundle branch block$/.test(s.canonicalLabel))))
    result.conflicts.push({ key: 'qrs-model', text: 'Модель предполагает блокаду ножки, но измеренная ширина QRS не достигает 120 мс. Требуется проверка морфологии и применимости модели.' });
  if (previous) {
    const old = analyzeECG(previous, patient);
    const samePatient = !!record.patientId && record.patientId === previous.patientId;
    const comparable = samePatient && old.profile?.timingVerified && timing && reviewed && old.boundarySource === 'reviewed-fiducials';
    result.dynamics = { previousSourceSha256: previous.sha256 || null, comparable: !!comparable, differences: [],
      reason: comparable ? null : 'Нужны один пациент, подтверждённое время и сопоставимые проверенные измерения' };
    if (comparable) for (const key of ['heartRate', 'PR_ms', 'QRS_ms', 'QT_ms', 'QTcF_ms']) {
      const a = old.measurements[key], b = m[key];
      if (a?.verified && b?.verified && a.value !== null && b.value !== null)
        result.dynamics.differences.push({ key, previous: a.value, current: b.value, delta: round(b.value - a.value), unit: b.unit });
    }
  }
  stage('dynamics', 'Динамика', result.dynamics?.comparable ? 'complete' : 'blocked', result.dynamics?.reason || 'Предыдущая запись не выбрана');
  stage('report', 'Структурированный результат', 'complete');
  result.available = beats.length > 0;
  result.classification = 'incomplete';
  result.limitations.push('Автоматическая оценка не устанавливает нормальную ЭКГ и не исключает заболевание');
  return result;
}
