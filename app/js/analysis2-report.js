import { analyzeECG } from './analysis2.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const ANALYSIS2_LABELS = {
  heartRate: 'ЧСС желудочков', atrialRate: 'Частота размеченных P', P_ms: 'Длительность P', PR_ms: 'Интервал PR', QRS_ms: 'Длительность QRS',
  QT_ms: 'Интервал QT', QTcB_ms: 'QTc Базетта', QTcF_ms: 'QTc Фридеричиа', axis: 'Электрическая ось QRS', sokolow: 'Соколов–Лайон',
};
export const FINDING_STATUS = { present: 'Критерий выполнен', absent: 'Критерий не выполнен', unassessable: 'Оценить нельзя' };
export const STAGE_STATUS = { complete: 'Выполнено', limited: 'С ограничениями', blocked: 'Недоступно' };

export function detailedAnalysisReport(patient, record, analysis = analyzeECG(record, patient)) {
  const name = [patient.surname, patient.name, patient.middleName].filter(Boolean).join(' ') || 'Не указан';
  const measurements = Object.entries(analysis.measurements).map(([key, m]) => `<tr><td>${esc(ANALYSIS2_LABELS[key] || key)}</td><td>${m.value === null ? 'Не измерено' : esc(m.value)+' '+esc(m.unit)}</td><td>${m.value === null ? esc(m.reason) : m.verified ? 'По проверенным данным' : 'Предварительно: '+esc(m.reason || 'параметры сигнала не подтверждены')}</td></tr>`).join('');
  const findings = analysis.findings.map(f => `<li><strong>${esc(f.label)}: ${esc(FINDING_STATUS[f.status])}.</strong> ${esc(f.reason || '')}</li>`).join('');
  const leads = analysis.leads.map(l => `<tr><td>${esc(l.lead)}</td><td>${l.r_mV ?? '—'}</td><td>${l.minimumQRS_mV ?? '—'}</td><td>${l.stJ_mV ?? '—'}</td><td>${esc({ positive: 'положительный', negative: 'отрицательный', biphasic: 'двухфазный', variable: 'неустойчив / недостаточно данных' }[l.tPolarity] || 'не определён')}</td></tr>`).join('');
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>КардиоИИ — подробный анализ</title><style>
  @page{size:A4;margin:16mm}body{font:12pt/1.5 -apple-system,BlinkMacSystemFont,Arial,sans-serif;max-width:1000px;margin:32px auto;color:#172330}h1{font-size:24pt}h2{font-size:16pt;margin-top:24px}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{padding:7px;border-bottom:1px solid #ccd5df;text-align:left;vertical-align:top}tr{break-inside:avoid}.note{background:#f0f4f8;padding:16px;border-left:4px solid #477ca8}code{overflow-wrap:anywhere;font-size:9pt}</style><body>
  <h1>КардиоИИ · подробный анализ</h1><p>${esc(name)} · ${esc(record.recordedAt || 'Дата не указана')}</p>
  <p class="note">Исследовательский результат. Автоматические границы волн предварительные. Это не врачебное заключение.</p>
  <h2>Качество и ограничения</h2><ul>${analysis.limitations.map(t => '<li>'+esc(t)+'</li>').join('')}</ul>
  <h2>Измерения</h2><table><thead><tr><th>Показатель</th><th>Значение</th><th>Основание</th></tr></thead><tbody>${measurements}</tbody></table>
  <h2>Проверка критериев</h2><ul>${findings || '<li>Анализ недоступен</li>'}</ul>
  <h2>Морфология по отведениям</h2><p>Амплитуды в мВ; при неподтверждённом масштабе — предварительные. Пустое значение означает отсутствие измерения.</p>
  <table><thead><tr><th>Отведение</th><th>R</th><th>Минимум QRS</th><th>ST в предполагаемой J</th><th>T</th></tr></thead><tbody>${leads}</tbody></table>
  <h2>Модели</h2><ul>${analysis.models.map(m => `<li>${esc(m.key)}: ${m.labelCount} выходов; ${m.suggestions.length} пороговых гипотез. ${esc(m.reason || 'Привязка к исходнику проверена; гипотезы не подтверждают диагноз.')}</li>`).join('') || '<li>Результаты не прикреплены</li>'}</ul>
  ${(analysis.conflicts || []).length ? '<h2>Противоречия</h2><ul>'+analysis.conflicts.map(c => '<li>'+esc(c.text)+'</li>').join('')+'</ul>' : ''}
  <h2>Динамика</h2><p>${esc(analysis.dynamics?.reason || (analysis.dynamics?.comparable ? 'Сопоставлены пригодные проверенные показатели.' : 'Предыдущая запись не выбрана.'))}</p>
  ${analysis.dynamics?.differences?.length ? '<ul>'+analysis.dynamics.differences.map(d => `<li>${esc(ANALYSIS2_LABELS[d.key])}: ${esc(d.previous)} → ${esc(d.current)} ${esc(d.unit)}; Δ ${esc(d.delta)}</li>`).join('')+'</ul>' : ''}
  <h2>Ход анализа</h2><ol>${analysis.stages.map(s => `<li>${esc(s.label)} — ${esc(STAGE_STATUS[s.status])}. ${esc(s.reason || '')}</li>`).join('')}</ol>
  <p>Версия: ${esc(analysis.algorithmVersion)}. Исходник SHA-256: <code>${esc(analysis.sourceSha256 || 'нет')}</code>.</p></body></html>`;
}
