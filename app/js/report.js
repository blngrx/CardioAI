// Default: the same complete Orlov-structured conclusion as the patient screen.
// The earlier eight-field format is available only with explicit compact=true.
import { buildSummary } from './summary.js';
import { buildOrlovConclusion } from './orlov.js';
import { orlovReportBody, ORLOV_REPORT_CSS } from './orlov-report.js';
import { humanLanguageReport } from './human-report.js';
import { analyzeECG } from './analysis2.js';
import { detailedAnalysisReport } from './analysis2-report.js';

export const REPORT_VARIANTS = [
  { key: 'orlov', label: 'Полный по Орлову' },
  { key: 'human', label: 'Человеческий язык · эксперимент' },
  { key: 'compact', label: 'Краткая сводка · 8 пунктов' },
  { key: 'analysis2', label: 'Подробные расчёты по кривой' },
];

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
  if (ctx.format === 'human') return humanLanguageReport(patient, record, ctx);
  if (ctx.format === 'analysis2') return detailedAnalysisReport(patient, record, analyzeECG(record, patient, { previous: ctx.previous }));
  if (ctx.compact === true || ctx.format === 'compact') return document_(`Анализ ЭКГ ${fullName(patient)}`, [analysisPage(patient, record)]);
  return orlovDocument(`ИИ-заключение по ЭКГ ${fullName(patient)}`, [orlovPage(patient, record, ctx)]);
}
export function comparisonReport(patient, comparison, ctx = {}) {
  return orlovDocument(`Два ИИ-заключения по ЭКГ ${fullName(patient)}`, [
    orlovPage(patient, comparison.older, {}, 'Предыдущая ЭКГ — ИИ-заключение'),
    orlovPage(patient, comparison.newer, { previous: comparison.older }, 'Новая ЭКГ — ИИ-заключение'),
  ]);
}
function orlovPage(patient, record, options, heading = 'Заключение по ЭКГ') {
  const conclusion = buildOrlovConclusion(record, patient, options);
  return `<article class="page"><header><h1>${esc(heading)}</h1><p class="patient">${esc(fullName(patient))}</p>
    ${patient.birthDate ? `<p>Дата рождения: ${esc(date(patient.birthDate))}</p>` : ''}<p>ЭКГ от ${esc(date(record.recordedAt, true))}</p></header>${orlovReportBody(conclusion)}</article>`;
}
function orlovDocument(title, pages) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${ORLOV_REPORT_CSS}</style></head><body>${pages.join('')}</body></html>`;
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
