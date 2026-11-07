import { buildOrlovConclusion } from './orlov.js';

export const escapeReportText = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const esc = escapeReportText;
export const ORLOV_SOURCE_LABELS = { file: 'Файл ЭКГ', 'file-rr': 'RR из файла', review: 'Врачебная оценка', calculated: 'Расчёт',
  'derived-from-rate': 'Расчёт из ЧСС', 'waveform-estimate': 'Кривая, предварительно', 'automatic-proposal': 'Кривая, предварительно',
  'reviewed-fiducials': 'Разметка кривой', 'reviewed-atrial-onsets': 'Разметка P', 'qrs-consensus-1': 'События на кривой' };
export const formatOrlovValue = (value, unit) => {
  const digits = unit === 'мс' ? 0 : unit === 'мВ' ? 3 : unit === '°' || unit === 'уд/мин' || unit === 'в мин' ? 1 : 2;
  return Number(value.toFixed(digits)).toLocaleString('ru-RU', { maximumFractionDigits: digits });
};

export function orlovReportBody(conclusion) {
  const metrics = Object.values(conclusion.measurements).map(m => `<tr><td>${esc(m.label)}</td><td>${m.provisional ? '≈ ' : ''}${esc(formatOrlovValue(m.value, m.unit))} ${esc(m.unit)}</td><td>${esc(ORLOV_SOURCE_LABELS[m.source] || (m.provisional ? 'Кривая, предварительно' : 'Расчёт'))}</td></tr>`).join('');
  const sections = conclusion.sections.map((s, i) => `<section class="orlov-section" data-orlov="${esc(s.key)}"><h2>${i + 1}. ${esc(s.title)}</h2>${s.paragraphs.map(p => '<p>'+esc(p)+'</p>').join('')}</section>`).join('');
  const conflicts = conclusion.conflicts.length ? `<section class="conflicts"><h2>Противоречия результатов</h2><ul>${conclusion.conflicts.map(c => '<li>'+esc(c.text)+'</li>').join('')}</ul></section>` : '';
  const evidence = conclusion.models.map(m => `<h3>${esc(m.name)}</h3><p>${esc(m.reason || `${m.outputs} выходов; пороговые признаки: ${m.thresholded.length}.`)}</p>
    ${m.eligible && m.ranked.some(r => r.ru !== r.label) ? `<p>Выше ранжированы: ${m.ranked.filter(r => r.ru !== r.label).map(r => esc(r.ru)).join('; ')}. Ранжирование не равно установленному диагнозу.</p>` : ''}
    ${m.thresholded.length ? '<details><summary>Все пороговые ответы</summary><ul>'+m.thresholded.filter(f => f.ru !== f.label).map(f => '<li>'+esc(f.ru)+'; ранг '+f.rank+'</li>').join('')+'</ul></details>' : ''}`).join('');
  return `<section class="impression"><h2>Итоговое ИИ-заключение</h2><ol>${conclusion.impression.map(p => '<li>'+esc(p)+'</li>').join('')}</ol><p><strong>${esc(conclusion.classification)}.</strong></p></section>
    ${conflicts}<h2>Измеренные и рассчитанные показатели</h2><table><thead><tr><th>Показатель</th><th>Значение</th><th>Источник</th></tr></thead><tbody>${metrics || '<tr><td colspan="3">Числовые показатели не получены</td></tr>'}</tbody></table>
    ${sections}<details class="technical no-print"><summary>Источники и технические сведения</summary>${evidence}<p>Версия ${esc(conclusion.version)}; исходник ${esc(conclusion.sourceSha256 || 'не привязан')}.</p>
    </details><section class="report-limitations"><h2>Ограничения заключения</h2><ul>${[...conclusion.limitations.map(l => l.text), ...(conclusion.technical.analysis.limitations || [])].map(l => '<li>'+esc(l)+'</li>').join('')}</ul></section><footer>${esc(conclusion.note)}</footer>`;
}

export function standaloneOrlovReport(patient, record, options = {}) {
  const conclusion = options.conclusion || buildOrlovConclusion(record, patient, options);
  const name = [patient.surname, patient.name, patient.middleName].filter(Boolean).join(' ') || 'Пациент не указан';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ЭКГ · ${esc(name)}</title><style>${ORLOV_REPORT_CSS}</style></head><body><article class="page">
    <header><h1>Заключение по ЭКГ</h1><p class="patient">${esc(name)}</p><p>Дата записи: ${esc(record.recordedAt || 'не указана')}${patient.birthDate ? '; дата рождения: '+esc(patient.birthDate) : ''}</p></header>${orlovReportBody(conclusion)}</article></body></html>`;
}

export const ORLOV_REPORT_CSS = `
@page{size:A4;margin:16mm 17mm}*{box-sizing:border-box}body{margin:0;color:#142332;background:#fff;font:10.5pt/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.page{max-width:190mm;margin:12mm auto;padding:0 3mm}header{border-bottom:1px solid #9aa9b8;margin-bottom:5mm;padding-bottom:3mm}h1{font-size:22pt;margin:0 0 3mm}header p{margin:1mm 0}.patient{font-size:13pt;font-weight:600}
h2{font-size:12.5pt;margin:5mm 0 2mm;break-after:avoid}h3{font-size:11pt}p{margin:1.5mm 0}li{margin-bottom:1.5mm}ol,ul{padding-left:6mm}.impression{border-left:3px solid #376a94;padding:1mm 4mm;background:#f4f7fa}.impression h2{margin-top:2mm}.conflicts{padding:1mm 4mm;background:#fff7e9;border-left:3px solid #a27a2a}
table{width:100%;border-collapse:collapse;font-size:9.5pt}td,th{padding:1.7mm;border-bottom:1px solid #d5dde4;text-align:left;vertical-align:top}tr{break-inside:avoid}.orlov-section p{orphans:2;widows:2}footer{font-size:9pt;border-top:1px solid #bbc4ce;margin-top:6mm;padding-top:3mm;color:#526273}.technical{margin-top:5mm;overflow-wrap:anywhere}
@media print{.page{max-width:none;margin:0;padding:0}.page+.page{break-before:page}.no-print{display:none}a{color:inherit;text-decoration:none}}
`;
