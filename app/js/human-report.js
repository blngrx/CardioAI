// Experimental, additive presentation of the existing Orlov conclusion.
// No new diagnoses, measurements, probability thresholds or normality rules.
import { buildOrlovConclusion } from './orlov.js';
import { escapeReportText as esc, formatOrlovValue } from './orlov-report.js';

export const HUMAN_REPORT_VERSION = 'human-language-1';
const REVIEWED_RHYTHMS = {
  sinus: 'Синусовый ритм: импульсы исходят из естественного водителя ритма сердца.',
  atrial: 'Предсердный ритм: импульсы исходят из другого участка предсердий.',
  junctional: 'Ритм из АВ-соединения: импульсы исходят из области между предсердиями и желудочками.',
  ventricular: 'Желудочковый ритм: импульсы исходят из желудочков.',
  afib: 'Фибрилляция предсердий (мерцательная аритмия): предсердия возбуждаются несогласованно.',
  flutter: 'Трепетание предсердий: в предсердиях возникает частая повторяющаяся электрическая активность.',
};
const RHYTHM_GLOSS = {
  Sinusal: 'синусовый ритм — импульсы из естественного водителя ритма',
  'sinus-bradycardia': 'синусовая брадикардия — редкий ритм из естественного водителя',
  'sinus-tachycardia': 'синусовая тахикардия — частый ритм из естественного водителя',
  Afib: 'фибрилляция предсердий (мерцательная аритмия)', 'Atrial flutter': 'трепетание предсердий',
  'Ectopic atrial rhythm (< 100 BPM)': 'предсердный ритм — импульсы из другого участка предсердий',
  'Junctional rhythm': 'ритм из АВ-соединения — импульсы из области между предсердиями и желудочками',
  'Ventricular Rhythm': 'желудочковый ритм — импульсы из желудочков',
};
const CONDUCTION_GLOSS = {
  'Right bundle branch block': 'изменение проведения сигнала по правой ветви (блокада правой ножки пучка Гиса)',
  'Left bundle branch block': 'изменение проведения сигнала по левой ветви (блокада левой ножки пучка Гиса)',
  'Nonspecific intraventricular conduction delay': 'изменение проведения сигнала внутри желудочков',
  'Left anterior fascicular block': 'изменение проведения по передней ветви левой ножки пучка Гиса',
  'Left posterior fascicular block': 'изменение проведения по задней ветви левой ножки пучка Гиса',
  '1st degree AV block': 'замедление передачи импульса от предсердий к желудочкам (АВ-блокада I степени)',
  '2nd degree AV block - mobitz 1': 'нарушение передачи импульса от предсердий к желудочкам (АВ-блокада II степени, Мобитц I)',
  '2nd degree AV block - mobitz 2': 'нарушение передачи импульса от предсердий к желудочкам (АВ-блокада II степени, Мобитц II)',
  'Third Degree AV Block': 'АВ-блокада III степени — полное нарушение передачи импульсов от предсердий к желудочкам',
};
const CRITICAL_KEYS = new Set(['Acute MI', 'Ventricular tachycardia', 'Third Degree AV Block', '2nd degree AV block - mobitz 2']);
const metricLabels = {
  heart_rate_bpm: ['ЧСС', 'сокращений в минуту'], PR_ms: ['PQ / PR', 'передача импульса к желудочкам'],
  QRS_ms: ['QRS', 'возбуждение желудочков'], QT_ms: ['QT', 'возбуждение и восстановление'],
  QTcF_ms: ['QTcF', 'QT с поправкой на частоту'], QRS_axis: ['Электрическая ось', 'направление электрического сигнала'],
};
const unique = xs => [...new Set(xs.filter(Boolean))];
const words = fs => unique(fs.map(f => f.ru)).join('; ');
const short = fs => fs.slice(0, 2);
const list = xs => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' и ' + xs.at(-1) : xs[0] || '';

export function buildHumanSummary(record, patient = {}, options = {}) {
  const source = options.conclusion || buildOrlovConclusion(record, patient, options);
  const e = source.summaryEvidence || {};
  const observations = [];
  const add = (key, label, text, basis = 'unknown') => observations.push({ key, label, text, basis });
  const rhythm = e.rhythm || {}, ectopy = e.ectopy || {}, conduction = e.conduction || [];
  if (REVIEWED_RHYTHMS[rhythm.reviewedType]) add('rhythm', 'Ритм сердца', REVIEWED_RHYTHMS[rhythm.reviewedType], 'review');
  else if (rhythm.conflicting) add('rhythm', 'Ритм сердца', 'Тип ритма пока не установлен: ответы нейросетей расходятся.'
    + (rhythm.findings?.length ? ' Среди гипотез: ' + short(rhythm.findings).map(f => RHYTHM_GLOSS[f.key] || f.ru).join('; ') + '.' : '')
    + ' Нужна проверка по кривой ЭКГ.');
  else if (rhythm.selectedLabel && rhythm.findings?.length) {
    const f = rhythm.findings.find(f => rhythm.selectedLabel.includes(f.ru)) || rhythm.findings[0];
    add('rhythm', 'Ритм сердца', 'ИИ предполагает: ' + (RHYTHM_GLOSS[f.key] || f.ru) + '. Это предварительная гипотеза.', 'hypothesis');
  } else if (rhythm.findings?.length) add('rhythm', 'Ритм сердца', 'ИИ предлагает гипотезы: '
    + short(rhythm.findings).map(f => RHYTHM_GLOSS[f.key] || f.ru).join('; ') + '. Источник ритма пока не подтверждён.', 'hypothesis');
  else add('rhythm', 'Ритм сердца', 'Автоматически определить источник сердечного ритма не удалось.');

  if (ectopy.review?.status === 'absent') add('ectopy', 'Внеочередные сокращения', 'По врачебной оценке на этой записи экстрасистолы не выявлены.', 'review');
  else if (ectopy.review?.status === 'present') {
    const names = { ventricular: 'Желудочковые', atrial: 'Предсердные', junctional: 'Узловые', mixed: 'Разного происхождения' };
    add('ectopy', 'Внеочередные сокращения', `${names[ectopy.review.type] || 'Указаны'} экстрасистолы — внеочередные сокращения сердца, согласно врачебной оценке.`, 'review');
  } else if (ectopy.findings?.length) {
    const types = unique(ectopy.findings.map(f => /ventricular/i.test(f.key) ? 'желудочковые' : /atrial|supraventricular/i.test(f.key) ? 'наджелудочковые' : 'неуточнённого происхождения'));
    add('ectopy', 'Внеочередные сокращения', `ИИ предполагает ${types.join(' и ')} экстрасистолы — внеочередные сокращения сердца. Их количество и повторяемость пока не установлены.`, 'hypothesis');
  }
  if (conduction.length) {
    const significant = conduction.filter(f => CRITICAL_KEYS.has(f.key));
    const specific = conduction.filter(f => f.key !== 'Nonspecific intraventricular conduction delay' && f.key !== 'wide-qrs');
    const chosen = significant.length ? significant : short(specific.length ? specific : conduction);
    let text = 'ИИ предполагает ' + chosen.map(f => CONDUCTION_GLOSS[f.key] || f.ru).join('; ') + '.';
    if (source.conflicts.some(c => c.key === 'qrs-block')) text += ' Предположение о полной блокаде не подтверждено измеренной длительностью QRS.';
    add('conduction', 'Проведение импульса', text, 'hypothesis');
  } else {
    const explicit = source.impression.filter(t => /^(Укорочение|Удлинение) PR|^Широкий QRS|^Погранично уширенный QRS/.test(t));
    if (explicit.length) add('conduction', 'Проведение импульса', explicit.join(' ') + ' Эти интервалы описывают прохождение электрического сигнала.', 'measurement');
  }
  const repolarization = [...(e.st || []), ...(e.t || [])];
  const longQt = source.impression.find(t => t.startsWith('QTcF удлинён'));
  if (repolarization.length || longQt) add('repolarization', 'Восстановление после сокращения',
    [repolarization.length ? 'ИИ отмечает возможные изменения ST/T: ' + words(short(repolarization)) + '.' : null,
      longQt ? longQt + ' Это время электрического восстановления желудочков с поправкой на частоту.' : null].filter(Boolean).join(' '),
    repolarization.length ? 'hypothesis' : 'measurement');
  const structure = [...(e.syndromes || []), ...(e.voltage || []), ...(e.p || [])];
  if (structure.length) add('other', 'Другие предположения ИИ', words(short(structure)) + '. Это требует сопоставления с полным отчётом и данными пациента.', 'hypothesis');
  const critical = unique([...(e.rhythm?.findings || []), ...conduction, ...structure].filter(f => CRITICAL_KEYS.has(f.key)).map(f => f.ru));
  // Never hide an important source warning merely to shorten the page.
  const originalRecommendations = source.sections.find(s => s.key === 'recommendations')?.paragraphs || [];
  const originalUrgent = originalRecommendations.filter(t => /приоритетн|экстренн/i.test(t));
  const alert = originalUrgent.length ? originalUrgent.join(' ')
    : critical.length ? 'Важно проверить модельные гипотезы: ' + critical.join('; ') + '. Это не подтверждённые диагнозы.' : null;

  if (source.dynamics?.deltas?.length) {
    const priority = ['QTcF_ms', 'QRS_ms', 'heart_rate_bpm', 'PR_ms', 'QT_ms', 'QRS_axis'];
    const changes = source.dynamics.deltas.filter(d => d.delta !== 0).sort((a, b) => priority.indexOf(a.key) - priority.indexOf(b.key));
    if (changes.length) add('dynamics', 'Сравнение с прошлой записью', short(changes).map(d => `${d.label}: ${formatOrlovValue(d.previous, d.unit)} → ${formatOrlovValue(d.current, d.unit)} ${d.unit}`).join('; ') + '. Значение изменений оценивает врач.', 'comparison');
  }
  const metrics = Object.entries(metricLabels).map(([key, [label, explanation]]) => {
    const m = source.measurements[key];
    return { key, label, explanation, value: m ? `${m.provisional ? '≈ ' : ''}${formatOrlovValue(m.value, m.unit)}${m.unit ? ' ' + m.unit : ''}` : 'не измерено', provisional: m?.provisional === true };
  });
  const topics = [];
  const ectopySuspected = ectopy.review?.status === 'present' || (ectopy.review?.status !== 'absent' && !!ectopy.findings?.length);
  if (ectopySuspected) topics.push('внеочередные сокращения');
  if (conduction.length) topics.push('изменения проведения импульса');
  if (repolarization.length || longQt) topics.push('изменения электрического восстановления желудочков');
  if (structure.length) topics.push('другие изменения');
  let lead = rhythm.reviewedType ? 'Ритм указан по врачебной оценке. Остальные предположения ИИ обозначены ниже.'
    : topics.length ? 'Предварительный итог: возможны ' + list(topics) + '. Их нужно подтвердить при просмотре ЭКГ врачом.'
      : 'Частота и основные интервалы приведены ниже. Данных этой автоматической сводки недостаточно для заключения «нормальная ЭКГ».';
  const nextSteps = ['Показать ЭКГ и полный отчёт врачу, чтобы уточнить отмеченные изменения.'];
  if (ectopySuspected) nextSteps.push('Уточнить тип и количество экстрасистол; необходимость длительного мониторирования определяет врач.');
  else if (longQt) nextSteps.push('Перепроверить интервал QTc и обсудить с врачом принимаемые препараты.');
  if (!source.dynamics) nextSteps.push('При наличии предыдущей ЭКГ сравнить записи.');
  const limits = ['Экспериментальная автоматическая сводка. Предположение ИИ не является подтверждённым диагнозом.'];
  if (source.patientContext?.age == null) limits.push('Возраст не указан; возрастная оценка показателей не выполнена.');
  if (source.patientContext?.age != null && source.patientContext.age < 18) limits.push('Детские возрастные нормативы в этой сводке не применены.');
  if (source.conflicts.length) limits.push('Есть расхождения между источниками; они сохранены в полном отчёте.');
  limits.push('Подробные измерения и ограничения доступны в варианте «Полный по Орлову».');
  const narrativeLength = observations.reduce((sum, o) => sum + o.text.length, 0) + (alert?.length || 0)
    + lead.length + nextSteps.join(' ').length + limits.join(' ').length;
  const density = alert || observations.length >= 5 || narrativeLength > 1600 ? 'dense' : 'comfortable';
  if (density === 'dense' && !rhythm.reviewedType) lead = 'Краткий итог ИИ: перечисленные ниже предположения требуют проверки врачом по самой ЭКГ.';
  return { version: HUMAN_REPORT_VERSION, variant: 'human', label: 'Человеческий язык', experimental: true, density,
    sourceConclusionVersion: source.version, sourceSha256: source.sourceSha256, lead, alert, metrics, observations,
    nextSteps, limits, normalityEstablished: false, criticalFindings: critical,
    edits: { retained: ['ключевые показатели', 'существенные находки', 'неопределённость и расхождения', 'действия для уточнения'],
      omitted: ['формулы', 'сырые баллы моделей', 'повторы по 14 разделам', 'таблицы каждого отведения', 'полный реестр технических ограничений'] } };
}

export function humanReportBody(summary) {
  return `<div class="human-lead">${esc(summary.lead)}</div>${summary.alert ? '<div class="human-alert">'+esc(summary.alert)+'</div>' : ''}
  <div class="human-metrics">${summary.metrics.map(m => `<div><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong><small>${esc(m.explanation)}</small></div>`).join('')}</div>
  <section><h2>Что важно в этой записи</h2><dl>${summary.observations.map(o => `<div data-human="${esc(o.key)}"><dt>${esc(o.label)}</dt><dd>${esc(o.text)}</dd></div>`).join('')}</dl></section>
  <section><h2>Что уточнить</h2><ul>${summary.nextSteps.map(t => '<li>'+esc(t)+'</li>').join('')}</ul></section>
  <footer>${summary.limits.map(t => '<p>'+esc(t)+'</p>').join('')}</footer>`;
}

export function humanLanguageReport(patient, record, options = {}) {
  const summary = options.summary || buildHumanSummary(record, patient, options);
  const name = [patient.surname, patient.name, patient.middleName].filter(Boolean).join(' ') || 'Пациент не указан';
  const rawDate = record.recordedAt, date = rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toLocaleString('ru-RU', { day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit' }) : 'не указана';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Человеческий язык — ЭКГ</title><style>${HUMAN_REPORT_CSS}</style></head>
  <body><article class="human-page ${summary.density === 'dense' ? 'dense' : ''}"><header><div class="human-badge">Человеческий язык · экспериментальный вариант</div><h1>Заключение по ЭКГ</h1><p class="human-patient">${esc(name)}</p><p>Запись от ${esc(date)}</p></header>${humanReportBody(summary)}</article></body></html>`;
}

export const HUMAN_REPORT_CSS = `
@page{size:A4;margin:13mm 15mm}*{box-sizing:border-box}body{margin:0;color:#152330;background:#fff;font:11pt/1.42 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.human-page{max-width:180mm;margin:8mm auto}header{border-bottom:1px solid #aab7c2;padding-bottom:3mm;margin-bottom:3mm}h1{font-size:21pt;line-height:1.15;margin:2mm 0}header p{margin:.7mm 0}.human-badge{font-size:8.5pt;color:#526477}.human-patient{font-size:12pt;font-weight:600;overflow-wrap:anywhere}
.human-lead{border-left:3px solid #3d6a89;background:#f3f6f8;padding:2.5mm 3mm;font-size:11.2pt}.human-alert{border:1px solid #9c603b;padding:2mm 3mm;margin-top:2mm;font-weight:600;font-size:10pt}
.human-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;margin:3mm 0}.human-metrics>div{padding:2mm 2.5mm;border:1px solid #d8e0e6;border-radius:2mm;break-inside:avoid}.human-metrics span,.human-metrics strong,.human-metrics small{display:block}.human-metrics span{font-size:9pt;font-weight:600}.human-metrics strong{font-size:13pt;margin:.7mm 0}.human-metrics small{font-size:8pt;color:#526171}
h2{font-size:12pt;margin:3mm 0 1mm;break-after:avoid}dl{margin:0}dl>div{display:grid;grid-template-columns:40mm 1fr;gap:3mm;border-bottom:1px solid #e0e5e9;padding:2mm 0;break-inside:avoid}dt{font-weight:600;font-size:10pt}dd{margin:0;font-size:10.3pt}ul{margin:1mm 0;padding-left:5mm;font-size:10.3pt}li{margin:.7mm 0;break-inside:avoid}
footer{border-top:1px solid #aab7c2;padding-top:2mm;margin-top:3mm;font-size:8.3pt;line-height:1.35;color:#526171}footer p{margin:.6mm 0}
.dense header{padding-bottom:2mm;margin-bottom:2mm}.dense h1{font-size:19pt}.dense .human-lead{padding:2mm 3mm}.dense .human-metrics{gap:1.5mm;margin:2mm 0}.dense .human-metrics>div{padding:1.5mm 2.5mm}.dense h2{margin-top:2mm}.dense dl>div{padding:1.2mm 0}.dense dd{line-height:1.35}.dense footer{margin-top:2mm;padding-top:1.5mm}
@media print{.human-page{margin:0;max-width:none}}
`;
