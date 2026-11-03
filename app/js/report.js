// Text-only printout of the same short analysis shown in the patient card.
// Device measurements, ECG curves and raw classifier outputs stay in the data.
import { buildSummary } from './summary.js';

const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const DISCLAIMER = 'CardioAI — исследовательская программа. Сводка не является врачебным заключением.';
const fullName = p => [p.surname, p.name, p.middleName].filter(Boolean).join(' ') || 'Без имени';
function date(value, withTime = false) {
  const d = new Date(value);
  if (!value || !Number.isFinite(d.getTime())) return 'не указана';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + (withTime ? ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
}
function analysisPage(patient, record, heading = 'Краткий анализ ЭКГ') {
  const summary = buildSummary(record, patient);
  return `<article class="page"><header><h1>${esc(heading)}</h1><p class="patient">${esc(fullName(patient))}</p>
${patient.birthDate ? `<p>Дата рождения: ${esc(date(patient.birthDate))}</p>` : ''}
<p>ЭКГ от ${esc(date(record.recordedAt, true))}</p></header>
<dl>${summary.items.map(row => `<div class="finding"><dt>${esc(row.label)}</dt><dd>${esc(row.text)}</dd></div>`).join('')}</dl>
<footer>${esc(summary.note)}</footer></article>`;
}
function document_(title, pages) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${pages.join('')}</body></html>`;
}
export function recordReport(patient, record, ctx = {}) {
  return document_(`Анализ ЭКГ ${fullName(patient)}`, [analysisPage(patient, record)]);
}
export function comparisonReport(patient, comparison, ctx = {}) {
  // Both records retain their own analysis and identity, without numeric comparison tables.
  return document_(`Два анализа ЭКГ ${fullName(patient)}`, [
    analysisPage(patient, comparison.older, 'Предыдущая ЭКГ — краткий анализ'),
    analysisPage(patient, comparison.newer, 'Новая ЭКГ — краткий анализ'),
  ]);
}
const CSS = `
@page{size:A4;margin:15mm 17mm}
*{box-sizing:border-box}
body{margin:0;color:#111;background:#fff;font:11.5pt/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.page{max-width:180mm;margin:10mm auto;padding:0 2mm}
header{border-bottom:1px solid #777;padding-bottom:4mm;margin-bottom:4mm}
h1{font-size:18pt;line-height:1.2;margin:0 0 4mm;font-weight:700}
header p{margin:1mm 0;font-size:10pt}
header .patient{font-size:13pt;font-weight:600}
dl{margin:0}
.finding{margin:0 0 3mm;break-inside:avoid;page-break-inside:avoid}
dt{font-weight:700;margin:0 0 .5mm}
dd{margin:0}
footer{margin-top:5mm;border-top:1px solid #bbb;padding-top:3mm;font-size:9pt;line-height:1.35;color:#444}
@media print{.page{max-width:none;margin:0;padding:0}.page+.page{break-before:page;page-break-before:always}}
`;
