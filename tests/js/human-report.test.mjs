import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrlovConclusion } from '../../app/js/orlov.js';
import { buildHumanSummary, humanLanguageReport } from '../../app/js/human-report.js';
import { recordReport, REPORT_VARIANTS } from '../../app/js/report.js';

const hash='a'.repeat(64);
const patient={surname:'Синтетический тест',birthDate:'1980-01-01',sex:'M'};
const model=(scores,thresholds)=>({sourceSha256:hash,scores,thresholds});
const base=(overrides={})=>({id:'r',patientId:'p',sha256:hash,recordedAt:'2026-11-06T12:00:00',device:{heart_rate_bpm:62,PR_ms:174,QRS_ms:107,QT_ms:437,RR_ms:[964,964,964],QRS_axis:-47},ai:{},...overrides});

test('the experimental variant is additive: default, eight-field and detailed reports are still available',()=>{
 const r=base();assert.deepEqual(REPORT_VARIANTS.map(v=>v.key),['orlov','human','compact','analysis2']);
 assert.equal((recordReport(patient,r).match(/data-orlov=/g)||[]).length,14);
 assert.equal((recordReport(patient,r,{format:'compact'}).match(/class="finding"/g)||[]).length,8);
 assert.match(recordReport(patient,r,{format:'analysis2'}),/подробный анализ/);
 const html=recordReport(patient,r,{format:'human'});
 assert.match(html,/Человеческий язык/);assert.match(html,/экспериментальный/);
 assert.equal((html.match(/data-orlov=/g)||[]).length,0);
});
test('human text retains the same six measurements and source binding without recalculating or changing the full conclusion',()=>{
 const r=base(),source=buildOrlovConclusion(r,patient),before=JSON.stringify(source);
 const summary=buildHumanSummary(r,patient,{conclusion:source});
 assert.equal(JSON.stringify(source),before);
 assert.equal(summary.sourceSha256,hash);assert.equal(summary.metrics.length,6);
 assert.equal(summary.metrics.find(m=>m.key==='heart_rate_bpm').value,'62 уд/мин');
 assert.equal(summary.metrics.find(m=>m.key==='QRS_ms').value,'107 мс');
 assert.equal(summary.normalityEstablished,false);
});
test('conflicting model origins stay uncertain after simplification',()=>{
 const scores={Sinusal:.99,Afib:.9};const thresholds={Sinusal:.5,Afib:.5};
 const r=base({ai:{sl:model(scores,thresholds),ssl:model(scores,thresholds)}});
 const s=buildHumanSummary(r,patient);
 assert.match(s.observations.find(o=>o.key==='rhythm').text,/ответы нейросетей расходятся/);
 assert.doesNotMatch(s.observations.find(o=>o.key==='rhythm').text,/нормальный синусовый/);
});
test('PVC hypothesis is explained as an extra contraction without inventing count, frequency or confirmation',()=>{
 const r=base({ai:{sl:model({'Premature ventricular complex':.9},{'Premature ventricular complex':.1})}});
 const s=buildHumanSummary(r,patient),o=s.observations.find(o=>o.key==='ectopy');
 assert.equal(o.basis,'hypothesis');assert.match(o.text,/ИИ предполагает/);assert.match(o.text,/внеочередные сокращения/);
 assert.match(o.text,/не установлены/);assert.doesNotMatch(o.text,/частые|редкие|выявлены|\d+ экстрасистол/);
});
test('bundle-branch model and measured QRS disagreement is retained in everyday language',()=>{
 const r=base({ai:{sl:model({'Right bundle branch block':.9},{'Right bundle branch block':.1})}});
 const o=buildHumanSummary(r,patient).observations.find(o=>o.key==='conduction');
 assert.match(o.text,/по правой ветви/);assert.match(o.text,/полной блокаде не подтверждено/);
 assert.equal(o.basis,'hypothesis');
});
test('negative scores and missing data do not become a normal ECG or an absence statement',()=>{
 const r=base({device:{},ai:{sl:model({Afib:0,'Premature ventricular complex':0},{Afib:.5,'Premature ventricular complex':.5})}});
 const s=buildHumanSummary(r,patient);
 assert.ok(s.metrics.every(m=>m.value==='не измерено'));assert.equal(s.normalityEstablished,false);
 assert.doesNotMatch(s.observations.map(o=>o.text).join(' '),/нарушений нет|патологий нет|экстрасистолы не выявлены/);
});
test('a single-model AF hypothesis is named and qualified rather than silently disappearing',()=>{
 const r=base({ai:{sl:model({Afib:.9},{Afib:.5})}});
 const text=buildHumanSummary(r,patient).observations.find(o=>o.key==='rhythm').text;
 assert.match(text,/фибрилляция предсердий/);assert.match(text,/не подтверждён/);
});
test('reviewed findings retain their reviewed basis rather than becoming unsupported model diagnoses',()=>{
 const r=base({interpretation:{schemaVersion:1,basis:'clinician-reviewed',sourceSha256:hash,reviewedBy:'Synthetic reviewer',reviewedAt:'2026-11-06T12:00:00Z',rhythm:{type:'afib'},extrasystoles:{status:'absent'}}});
 const s=buildHumanSummary(r,patient);
 assert.match(s.observations.find(o=>o.key==='rhythm').text,/Фибрилляция предсердий/);
 assert.equal(s.observations.find(o=>o.key==='rhythm').basis,'review');
 assert.match(s.observations.find(o=>o.key==='ectopy').text,/По врачебной оценке/);
});
test('important infarct warning and complete AV block hypothesis cannot disappear while shortening',()=>{
 const r=base({ai:{sl:model({'Acute MI':.99,'Third Degree AV Block':.95},{'Acute MI':.5,'Third Degree AV Block':.5})}});
 const s=buildHumanSummary(r,patient);
 assert.match(s.alert,/экстренная помощь/);assert.ok(s.criticalFindings.some(t=>/III/.test(t)));
  assert.equal(s.density,'dense');
 assert.match(s.observations.find(o=>o.key==='conduction').text,/III степени/);
 assert.match(s.limits[0],/не является подтверждённым диагнозом/);
});
test('both sides of competing left/right bundle-branch model hypotheses are preserved',()=>{
 const scores={'Left bundle branch block':.9,'Right bundle branch block':.9};
 const r=base({ai:{sl:model(scores,{'Left bundle branch block':.5,'Right bundle branch block':.5})}});
 const text=buildHumanSummary(r,patient).observations.find(o=>o.key==='conduction').text;
 assert.match(text,/левой ветви/);assert.match(text,/правой ветви/);
});
test('HTML escapes identity text and keeps methodological detail and raw scores out of the short body',()=>{
 const r=base({ai:{sl:model({Afib:.987654},{Afib:.5})}});
 const html=humanLanguageReport({surname:'<img src=x onerror=bad>'},r);
 assert.doesNotMatch(html,/<img src=x|0[.,]987654|sqrt|cbrt|производител|калибровка|пороговые ответы/);
 assert.match(html,/&lt;img/);assert.match(html,/Что уточнить/);
});
test('unknown and child age remain unassessed rather than becoming an adult normality statement',()=>{
 for(const p of [{},{birthDate:'2020-01-01'}]){
  const s=buildHumanSummary(base(),p);
  assert.ok(s.limits.some(t=>/возраст|Детские/.test(t)));
  assert.doesNotMatch(s.lead,/всё нормально|нормальная ЭКГ подтверждена/);
 }
});
