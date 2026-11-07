// Additional measurements from the existing digital waveform. The points are
// research estimates unless the record carries reviewed fiducials. Finding a
// candidate is distinct from proving that it is an atrial or U wave.
import { LEADS } from './ecg301.js';
import { axisFromAreas } from './waveform.js';

const finite = Number.isFinite;
const median = a => { const s = a.filter(finite).sort((x, y) => x - y), k = s.length >> 1;
  return s.length ? s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2 : null; };
const rounded = n => finite(n) ? Math.round(n * 1000) / 1000 : null;

export function extractOrlovWaveform(record, analysis) {
  const fs = record.signal?.fs, leads = record.signal?.leads, beats = analysis.beats || [];
  const result = { source: 'waveform-estimate', measurements: {}, leads: [], pAssociations: [], uCandidates: [],
    morphologyReviewed: analysis.boundarySource === 'reviewed-fiducials', automatic: true };
  if (!finite(fs) || !Array.isArray(leads) || !beats.length) return result;
  const gain = analysis.profile?.gainMvPerCount ?? null;
  const at = s => Math.round(fs * s);
  const reference = LEADS.indexOf(analysis.referenceLead);
  // Match already independently discovered atrial candidates, allowing none or
  // several. Ambiguous candidates are never reduced to one forced maximum.
  for (const b of beats) {
    if (Number.isInteger(b.pOnset) && Number.isInteger(b.pEnd)) {
      result.pAssociations.push({ qrsPeak: b.qrsPeak, pOnset: b.pOnset, pEnd: b.pEnd, reviewed: true });
      continue;
    }
    const candidates = (analysis.atrialCandidates || []).filter(p => p.onset < b.qrsOnset && p.end < b.qrsOnset - at(.02)
      && b.qrsOnset - p.onset >= at(.08) && b.qrsOnset - p.onset <= at(.32));
    if (candidates.length === 1) result.pAssociations.push({ qrsPeak: b.qrsPeak, pOnset: candidates[0].onset,
      pEnd: candidates[0].end, reviewed: false });
  }
  const pWidths = result.pAssociations.map(p => 1000 * (p.pEnd - p.pOnset) / fs);
  const pr = result.pAssociations.map(p => 1000 * (beats.find(b => b.qrsPeak === p.qrsPeak).qrsOnset - p.pOnset) / fs);
  // Require repeated, consistent associations for automatic P-derived values.
  const enoughP = result.pAssociations.length >= 3 && result.pAssociations.length / beats.length >= .6
    && Math.max(...pr) - Math.min(...pr) <= 60;
  if (enoughP || result.pAssociations.every(p => p.reviewed) && result.pAssociations.length) {
    result.measurements.P_ms = median(pWidths);
    result.measurements.PR_ms = median(pr);
    result.measurements.PR_range_ms = Math.max(...pr) - Math.min(...pr);
    // Automatic candidates may omit intervening P/F waves: do not turn their
    // recurrence into a claimed atrial rate. Reviewed independent P is separate.
    const segments = pr.map((v, i) => v - pWidths[i]);
    const ratios = pWidths.map((width, i) => segments[i] > 0 ? width / segments[i] : null);
    result.measurements['Macruz_index'] = median(ratios);
  }
  for (let j = 0; j < 12; j++) {
    const raw = leads[j];
    if (!analysis.quality?.[j]?.usable || !Array.isArray(raw)) { result.leads.push({ lead: LEADS[j] }); continue; }
    const rows = [];
    for (const b of beats) {
      if (b.qrsOnset < at(.08)) continue;
      const base = median(raw.slice(b.qrsOnset - at(.07), b.qrsOnset - at(.04)));
      if (base === null) continue;
      const segment = raw.slice(b.qrsOnset, b.qrsOffset + 1).map(v => v - base);
      const peak = Math.max(...segment.map(Math.abs)), limit = Math.max(.03 * peak, 3 * (analysis.quality[j].noiseCounts || 0));
      const first = segment.findIndex(v => Math.abs(v) > limit);
      let q = null, qWidth = null, rPeak = null;
      if (first >= 0 && segment[first] < 0) {
        let end = first;
        while (end < segment.length && segment[end] < -limit) end++;
        q = Math.min(...segment.slice(first, end)); qWidth = 1000 * (end - first) / fs;
      }
      const maxR = Math.max(0, ...segment);
      if (maxR > limit) rPeak = segment.indexOf(maxR);
      else { q = null; qWidth = null; } // A wholly negative QS is not an isolated Q wave.
      const association = result.pAssociations.find(p => p.qrsPeak === b.qrsPeak);
      let p = null, pTerminalNegative = null;
      if (association && gain !== null) {
        const pBase = median(raw.slice(Math.max(0, association.pOnset - at(.035)), association.pOnset));
        if (pBase !== null) {
          const wave = raw.slice(association.pOnset, association.pEnd + 1).map(v => v - pBase);
          if (wave.length) {
            const extreme = wave.reduce((a, v) => Math.abs(v) > Math.abs(a) ? v : a, 0);
            p = extreme * gain;
            pTerminalNegative = Math.min(0, ...wave.slice(wave.length >> 1)) * gain;
          }
        }
      }
      const stFrom = b.qrsOffset + at(.04), stTo = b.qrsOffset + at(.08);
      const stA = raw[stFrom], stB = raw[stTo];
      rows.push({ qWidth, q: gain === null || q === null ? null : q * gain,
        rPeakTime: rPeak === null ? null : rPeak / fs * 1000, p, pTerminalNegative,
        stSlope: finite(stA) && finite(stB) && gain !== null ? (stB - stA) * gain : null });
      // A U candidate requires an isolated deflection after a measured T end,
      // before the next atrial/QRS region, and repeated support from leads.
      if (b.tEnd != null && gain !== null) {
        const next = beats.find(next => next.qrsOnset > b.qrsOffset);
        const start = b.tEnd + at(.04), end = Math.min(raw.length, next ? next.qrsOnset - at(.2) : b.tEnd + at(.2));
        if (end - start >= at(.05)) {
          const window = raw.slice(start, end).map(v => v - base);
          const value = window.reduce((a, v) => Math.abs(v) > Math.abs(a) ? v : a, 0);
          if (Math.abs(value) > Math.max(5 * (analysis.quality[j].noiseCounts || 0), .015 / gain))
            result.uCandidates.push({ lead: LEADS[j], qrsPeak: b.qrsPeak, sample: start + window.indexOf(value), amplitude_mV: rounded(value * gain) });
        }
      }
    }
    const existing = analysis.leads.find(l => l.lead === LEADS[j]) || {};
    result.leads.push({ ...existing, lead: LEADS[j], qDuration_ms: rounded(median(rows.map(r => r.qWidth))),
      qInitial_mV: rounded(median(rows.map(r => r.q))), rPeakTime_ms: rounded(median(rows.map(r => r.rPeakTime))),
      p_mV: rounded(median(rows.map(r => r.p))), pTerminalNegative_mV: rounded(median(rows.map(r => r.pTerminalNegative))),
      stSlope_mV: rounded(median(rows.map(r => r.stSlope))) });
  }
  const byLead = Object.fromEntries(result.leads.map(l => [l.lead, l]));
  if (finite(byLead.I?.areaCounts) && finite(byLead.II?.areaCounts))
    result.measurements.QRS_axis = axisFromAreas(byLead.I.areaCounts, byLead.II.areaCounts);
  result.referenceLead = reference >= 0 ? LEADS[reference] : null;
  return result;
}
