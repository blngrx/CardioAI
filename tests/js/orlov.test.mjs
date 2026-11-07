import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrlovConclusion, collectModelFindings, ORLOV_SECTIONS } from '../../app/js/orlov.js';
import { extractOrlovWaveform } from '../../app/js/orlov-waveform.js';
import { analyzeECG } from '../../app/js/analysis2.js';
import { recordReport } from '../../app/js/report.js';
import { syntheticECG301 } from './fixtures.mjs';
import { parseECG301, ASSUMED } from '../../app/js/ecg301.js';
import { deriveMeasurements } from '../../app/js/measure.js';
import fs from 'node:fs';

const hash = 'a'.repeat(64);
const patient = { sex: 'M', birthDate: '1980-01-01' };
function record(overrides = {}) {
  return { id: 'r', patientId: 'p', sha256: hash, recordedAt: '2026-11-06T12:00:00',
    device: { heart_rate_bpm: 60, PR_ms: 180, QRS_ms: 100, QT_ms: 400, RR_ms: [1000, 1000, 1000], QRS_axis: -47, P_axis: 20, T_axis: 170, SV1_mV: -.7, RV5_mV: 1.2 },
    ai: {}, ...overrides };
}
const model = (scores, thresholds) => ({ model: 'test', sourceSha256: hash, scores, thresholds });
const section = (r, key) => buildOrlovConclusion(r, patient).sections.find(s => s.key === key).paragraphs.join(' ');

test('a ready set of device measurements produces all Orlov sections without requiring equipment confirmation', () => {
  const r = record({ signal: { timingVerified: false, calibration: { verified: false } } });
  const a = buildOrlovConclusion(r, patient);
  assert.deepEqual(a.sections.map(s => s.key), ORLOV_SECTIONS.map(s => s[0]));
  assert.equal(a.measurements.PR_ms.value, 180);
  assert.equal(a.measurements.QRS_ms.source, 'file');
  assert.equal(a.measurements.QRS_ms.provisional, false);
  assert.match(section(r, 'conduction'), /180 мс/);
  assert.match(a.classification, /зарегистрированными отклонениями/);
  assert.doesNotMatch(a.sections.map(s => s.paragraphs.join(' ')).join(' '), /производител|калибров|частота хранения/);
});
test('QTc, Macruz, full Sokolow and circular QRS-T angle use the supplied numbers and correct units', () => {
  const r = record();
  Object.assign(r.device, { P_ms: 80, PR_ms: 160, QT_ms: 400, RR_ms: [800,800,800], RV6_mV: 2, QRS_axis: -170, T_axis: 170 });
  const m = buildOrlovConclusion(r, patient).measurements;
  assert.ok(Math.abs(m.QTcB_ms.value - 400 / Math.sqrt(.8)) < 1e-8);
  assert.ok(Math.abs(m.QTcF_ms.value - 400 / Math.cbrt(.8)) < 1e-8);
  assert.equal(m['Macruz_index'].value, 1);
  assert.equal(m.Sokolow_mV.value, 2.7);
  assert.equal(m.QRS_T_angle_deg.value, 20);
  assert.ok(m.QTcF_ms.formula.includes('cbrt'));
});
test('P, PR or QT are not invented from a model score, R peaks, a zero or invalid intervals', () => {
  const r = record({ device: { heart_rate_bpm: 60, PR_ms: 0, QT_ms: NaN } });
  r.ai.x = model({ 'Prolonged QT': .99 }, { 'Prolonged QT': .5 });
  const a = buildOrlovConclusion(r, patient);
  assert.equal(a.measurements.PR_ms, undefined);
  assert.equal(a.measurements.QTcF_ms, undefined);
  assert.equal(a.measurements.atrial_rate_bpm, undefined);
  assert.match(section(r, 'p'), /не выделена/);
  assert.equal(a.sections.length, 14);
});
test('model score magnitude does not create severity, disease probability, ectopy count or confirmed infarction', () => {
  const r = record({ ai: { sl: model({ 'Acute MI': .999, 'Premature ventricular complex': .999 }, { 'Acute MI': .1, 'Premature ventricular complex': .1 }) } });
  const a = buildOrlovConclusion(r, patient);
  assert.match(a.sections.find(s => s.key === 'syndromes').paragraphs.join(' '), /гипотезы/);
  assert.doesNotMatch(a.impression.join(' '), /99[,.]9|процент|трансмуральный|некроз подтверждён|частые экстрасистолы/);
});
test('conflicting sinus and AF votes are reported as conflicting, without picking the larger score', () => {
  const scores = { Sinusal: .99, Afib: .8 };
  const r = record({ ai: { sl: model(scores, { Sinusal:.5,Afib:.5 }), ssl:model(scores,{Sinusal:.5,Afib:.5}) } });
  const a = buildOrlovConclusion(r, patient);
  assert.ok(a.conflicts.some(c => c.key === 'rhythm'));
  assert.match(a.impression.join(' '), /неоднозначен/);
  assert.doesNotMatch(a.impression[0], /^Предполагаемый синусовый/);
});
test('a bradycardia model label cannot override a nonbradycardic device rate', () => {
  const r = record({ ai: { founder:model({'SINUS BRADYCARDIA':.99},{'SINUS BRADYCARDIA':.8}) } });
  r.device.heart_rate_bpm=75;
  const a=buildOrlovConclusion(r,patient);
  assert.equal(a.measurements.heart_rate_bpm.value,75);
  assert.ok(a.conflicts.some(c=>c.key==='rate-model'));
  assert.doesNotMatch(a.impression[0],/Предполагаемый синусовая брадикардия/);
});
test('ECGFounder ranking without operating points is retained as ranking and cannot cast a diagnostic vote', () => {
  const r=record({ai:{founder:model({'SINUS RHYTHM':.99,'LATERAL INFARCT':.98},null)}});
  const a=buildOrlovConclusion(r,patient);
  assert.equal(a.models[0].ranked.length,2);
  assert.equal(a.modelFindings.length,0);
  assert.doesNotMatch(a.impression.join(' '),/боковой|инфаркт/);
  assert.ok(a.limitations.some(l=>l.id==='L12'));
});
test('alias matching preserves the original per-label threshold; historical change labels never describe the current tracing', () => {
  const r=record({ai:{founder:model({'ATRIAL FIBRILLATION':.9,'ST ELEVATION NOW PRESENT IN':.99},{Afib:.5,'ST ELEVATION NOW PRESENT IN':.5})}});
  assert.equal(collectModelFindings(r).findings.length,0);
  r.ai.founder.thresholds['ATRIAL FIBRILLATION']=.8;
  assert.equal(collectModelFindings(r).findings[0].key,'Afib');
});
test('foreign, unbound, synthetic and invalid model outputs are kept out of medical findings', () => {
  const r=record({ai:{x:{scores:{Afib:.9},thresholds:{Afib:.5}},y:{...model({Afib:.9},{Afib:.5}),sourceSha256:'b'.repeat(64)},z:{...model({Afib:.9},{Afib:.5}),synthetic:true},bad:model({Afib:Infinity,other:2},{Afib:.5,other:.5})}});
  const a=buildOrlovConclusion(r,patient);
  assert.equal(a.modelFindings.length,0);
  assert.ok(a.limitations.some(l=>l.id==='L13'));
});
test('all negative scores and ordinary device intervals do not certify a normal ECG or absence of ectopy', () => {
  const r=record({ai:{x:model({Afib:0,'Premature ventricular complex':0},{Afib:.5,'Premature ventricular complex':.5})}});
  r.device.QRS_axis=45;
  const a=buildOrlovConclusion(r,patient);
  assert.doesNotMatch(a.classification,/^Нормальная ЭКГ/);
  assert.doesNotMatch(section(r,'rhythm'),/экстрасистолы не выявлены/);
});
test('low-ranked threshold alerts remain in evidence and are not promoted to a leading infarct hypothesis', () => {
  const scores=Object.fromEntries(Array.from({length:12},(_,i)=>['other'+i,.9-i*.02]));
  scores['Acute MI']=.001;
  const r=record({ai:{x:model(scores,{'Acute MI':.0001})}});
  const a=buildOrlovConclusion(r,patient);
  assert.equal(a.models[0].thresholded.find(f=>f.key==='Acute MI').rank,13);
  assert.doesNotMatch(a.impression.join(' '),/инфаркт/i);
  assert.ok(a.limitations.some(l=>l.id==='L14'));
});
test('serial device numbers are compared despite waveform flags; a different patient is not compared', () => {
  const old=record();old.device={...old.device,PR_ms:160};old.recordedAt='2026-11-06T11:59:00';
  const now=record();
  let a=buildOrlovConclusion(now,patient,{previous:old});
  assert.equal(a.dynamics.deltas.find(d=>d.key==='PR_ms').delta,20);
  old.patientId='another';a=buildOrlovConclusion(now,patient,{previous:old});
  assert.equal(a.dynamics,null);
});
test('unknown age and children do not acquire an adult normal/abnormal classification from numeric rules', () => {
  for(const p of [{},{birthDate:'2020-01-01',sex:'F'}]){
    const a=buildOrlovConclusion(record(),p);
    assert.doesNotMatch(a.classification,/зарегистрированными отклонениями/);
    assert.ok(a.limitations.some(l=>l.id==='L11'));
  }
});
test('digital waveform supplies additional lead measurements and labelled P candidates without equating them to a confirmed atrial rate', () => {
  const p=parseECG301(syntheticECG301({samples:2000}));
  const r=record({device:p.device,measurements:deriveMeasurements(p.device),signal:{fs:ASSUMED.fsB,leads:p.blocks.B,calibration:{microvoltsPerCount:ASSUMED.microvoltsPerCount,verified:false}}});
  const a=analyzeECG(r,patient), w=extractOrlovWaveform(r,a), result=buildOrlovConclusion(r,patient);
  assert.equal(w.leads.length,12);
  assert.ok(w.leads.some(l=>Number.isFinite(l.stJ_mV)));
  assert.equal(w.leads.find(l=>l.lead==='V1').qDuration_ms,null); // QS is not isolated Q.
  assert.ok(w.pAssociations.length>=3);
  assert.ok(result.measurements.P_ms?.provisional);
  assert.equal(result.measurements.atrial_rate_bpm,undefined);
  assert.match(section(r,'st'),/J/);
});
test('HTML and the main conclusion use the same section text; equipment and limitations are placed after clinical results', () => {
  const r=record();const c=buildOrlovConclusion(r,patient),html=recordReport({...patient,surname:'<script>bad</script>'},r);
  assert.doesNotMatch(html,/<script>bad/);
  assert.match(html,/&lt;script&gt;/);
  for(const s of c.sections)for(const p of s.paragraphs)assert.ok(html.includes(p.replaceAll('&','&amp;').replaceAll('>','&gt;').replaceAll('<','&lt;')));
  assert.equal((html.match(/data-orlov=/g)||[]).length,14);
  assert.ok(html.indexOf('Ограничения заключения')>html.indexOf('14. Рекомендации'));
});
test('offline cache lists the full local import graph of the application and Orlov report', () => {
  const root=new URL('../../app/',import.meta.url),sw=fs.readFileSync(new URL('sw.js',root),'utf8'),seen=new Set();
  const visit=relative=>{
    if(seen.has(relative))return;seen.add(relative);
    assert.ok(sw.includes("'"+relative+"'"),'Offline dependency missing: '+relative);
    const source=fs.readFileSync(new URL(relative,root),'utf8');
    for(const match of source.matchAll(/from\s+['"]\.\/([^'"]+\.js)['"]/g))visit('js/'+match[1]);
  };
  visit('js/main.js');
});
