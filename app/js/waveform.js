// Reproducible research measurements from samples, never from device fields or
// classifier scores. Detector agreement is an engineering gate, not validation.
import { detectBeats } from './signal.js';

export const WAVEFORM_METHOD = 'qrs-consensus-1';
const finite = Number.isFinite;
const median = a => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
function average(x, radius) {
  const prefix = [0];
  for (const v of x) prefix.push(prefix[prefix.length - 1] + v);
  return x.map((_, i) => {
    const a = Math.max(0, i - radius), b = Math.min(x.length, i + radius + 1);
    return (prefix[b] - prefix[a]) / (b - a);
  });
}
function candidate(raw, fs, index, minEvents) {
  if (!Array.isArray(raw) || raw.some(v => !finite(v))) return null;
  const baseline = average(raw, Math.round(.125 * fs));
  const high = raw.map((v, i) => v - baseline[i]);
  const differences = high.slice(1).map((v, i) => Math.abs(v - high[i]));
  const noise = median(differences) / .954;
  const reach = Math.max(1, Math.round(.065 * fs));
  const peaks = [];
  for (const p of detectBeats([high], fs)) {
    let best = p;
    for (let i = Math.max(0, p - reach); i <= Math.min(raw.length - 1, p + reach); i++)
      if (Math.abs(high[i]) > Math.abs(high[best])) best = i;
    if (best < .1 * fs || best > raw.length - .1 * fs) continue;
    if (peaks.length && best - peaks[peaks.length - 1] < .2 * fs) continue;
    peaks.push(best);
  }
  const amplitude = median(peaks.map(p => Math.abs(high[p])));
  if (peaks.length < minEvents || !(amplitude > 0) || amplitude < 5 * noise) return null;
  return { index, peaks, high, raw, snr: noise > 0 ? amplitude / noise : Infinity };
}
function agreement(a, b, tolerance) {
  // One-to-one matches: a duplicate cannot improve agreement.
  let i = 0, j = 0, matches = 0;
  while (i < a.length && j < b.length) {
    if (Math.abs(a[i] - b[j]) <= tolerance) { matches++; i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return 2 * matches / (a.length + b.length);
}

export function measureWaveform(signal, { minDurationSeconds = 4, minEvents = 4 } = {}) {
  const result = { method: WAVEFORM_METHOD, clinicalValidation: false, available: false };
  const fs = signal?.fs, leads = signal?.leads;
  if (!finite(fs) || fs < 100 || fs > 2000 || !Array.isArray(leads) || leads.length !== 12) return result;
  const n = leads[0]?.length;
  // Bound synchronous work in the renderer. Longer recordings need a worker.
  if (!finite(minDurationSeconds) || minDurationSeconds < 2 || !Number.isInteger(minEvents) || minEvents < 3
      || !Number.isInteger(n) || n < minDurationSeconds * fs || n > 30000 || leads.some(l => !Array.isArray(l) || l.length !== n)) return result;
  const candidates = [0, 1, 7, 9, 10].map(i => candidate(leads[i], fs, i, minEvents)).filter(Boolean);
  let selected = null, concordance = 0;
  for (const c of candidates) {
    const support = candidates.filter(other => other !== c && agreement(c.peaks, other.peaks, .08 * fs) >= .8).length;
    if (support > concordance) { selected = c; concordance = support; }
  }
  if (!selected) return result;
  const peaks = selected.peaks, rr = peaks.slice(1).map((p, i) => (p - peaks[i]) / fs);
  if (rr.some(t => t < .25 || t > 3)) return result;
  const meanRR = rr.reduce((s, v) => s + v, 0) / rr.length;
  const sdRR = Math.sqrt(rr.reduce((s, v) => s + (v - meanRR) ** 2, 0) / (rr.length - 1));
  Object.assign(result, { available: true, fs, timingVerified: signal.timingVerified === true,
    amplitudeVerified: signal.calibration?.verified === true, referenceLead: selected.index,
    qrsSamples: peaks, rrSeconds: rr, heartRate: 60 / meanRR, rrCV: sdRR / meanRR,
    agreeingLeads: concordance + 1, shortRecording: n < 4 * fs });
  return result;
}

// Signed QRS areas must use the same independently delineated window in I/II.
// Units/gain cancel only when channel scaling is equal. This function does not
// invent boundaries or certify electrode placement/synchrony.
export function axisFromAreas(areaI, areaII) {
  if (!finite(areaI) || !finite(areaII) || Math.hypot(areaI, areaII) === 0) return null;
  return Math.atan2((2 * areaII - areaI) / Math.sqrt(3), areaI) * 180 / Math.PI;
}

// Pure interval arithmetic for delineators/review tools. Missing boundaries
// remain null; atrial timing is independent of QRS timing.
export function intervalsFromFiducials({ fs, pOnset, qrsOnset, qrsOffset, tEnd, rrSeconds }) {
  const duration = (a, b) => Number.isInteger(a) && a >= 0 && Number.isInteger(b) && b > a
    && finite(fs) && fs > 0 ? 1000 * (b - a) / fs : null;
  const pr = duration(pOnset, qrsOnset), qrs = duration(qrsOnset, qrsOffset), qt = duration(qrsOnset, tEnd);
  const rr = finite(rrSeconds) && rrSeconds > 0 ? rrSeconds : null;
  return { PR_ms: pr, QRS_ms: qrs, QT_ms: qt,
    QTcB_ms: qt !== null && rr !== null ? qt / Math.sqrt(rr) : null,
    QTcF_ms: qt !== null && rr !== null ? qt / Math.cbrt(rr) : null };
}
