"""How often each rule sees a fault put into real ECGs with no quality label. Usage: inject.py data results tune|held n"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'outputs', 'ecg-reader'))
import numpy as np
from scipy.signal import resample_poly
from ecg_qc import assess, LEADS
data, res, split, n = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
meta = {r['ecg_id']: r for r in json.load(open(os.path.join(data, 'sample.json'), encoding='utf-8'))}
has = lambda r, k: bool((r[k] or '').strip())
Q = ('baseline_drift', 'static_noise', 'burst_noise', 'electrodes_problems', 'extra_beats', 'pacemaker')
rows = [r for r in json.load(open(res, encoding='utf-8')) if r['split'] == split and not any(has(r, k) for k in Q)]
rng = np.random.default_rng(7)
rows = [rows[i] for i in rng.permutation(len(rows))[:n]]
fs, t = 250, np.arange(2500) / 250
def lead_issue(name): return lambda q, j: name in q['leads'][LEADS[j]]['issues']
def text(key): return lambda q, j: any(key in w for w in q['warnings'])
identity = lambda q, j: any(not v['ok'] for v in q['limb_identity'].values())
def swap(x, a, b): x[:, [a, b]] = x[:, [b, a]]
def arms(x):
    i, ii = x[:, 0].copy(), x[:, 1].copy()
    x[:, :6] = np.stack([-i, ii - i, ii, i - ii / 2, -(i + ii) / 2, ii - i / 2], 1)
def setl(x, j, y): x[:, j] = y
faults = dict(
    mains_100uV=(lambda x, j: setl(x, j, x[:, j] + .1 * np.sqrt(2) * np.sin(2 * np.pi * 50 * t)), lead_issue('mains')),
    mains_50uV=(lambda x, j: setl(x, j, x[:, j] + .05 * np.sqrt(2) * np.sin(2 * np.pi * 50 * t)), lead_issue('mains')),
    noise_100uV=(lambda x, j: setl(x, j, x[:, j] + rng.normal(0, .1, 2500)), lead_issue('noise')),
    noise_300uV=(lambda x, j: setl(x, j, x[:, j] + rng.normal(0, .3, 2500)), lead_issue('noise')),
    lead_off_3s=(lambda x, j: setl(x, j, np.where((t > 3) & (t < 6), 0, x[:, j])), lead_issue('flat')),
    clip_60pct=(lambda x, j: setl(x, j, np.clip(x[:, j], -.6 * np.abs(x[:, j]).max(), .6 * np.abs(x[:, j]).max())), lead_issue('clipped')),
    drift_3mV=(lambda x, j: setl(x, j, x[:, j] + 1.5 * np.sin(2 * np.pi * .2 * t)), lead_issue('wander')),
    III_gain_1_5=(lambda x, j: setl(x, 2, x[:, 2] * 1.5), identity),
    III_aVF_swap=(lambda x, j: swap(x, 2, 5), identity),
    arms_swap=(lambda x, j: arms(x), text('\u044d\u043b\u0435\u043a\u0442\u0440\u043e\u0434\u044b \u0440\u0443\u043a')),
    V1_V5_swap=(lambda x, j: swap(x, 6, 10), text('\u0433\u0440\u0443\u0434\u043d\u044b\u0445')),
    V1_V6_swap=(lambda x, j: swap(x, 6, 11), text('\u0433\u0440\u0443\u0434\u043d\u044b\u0445')))
hits = dict.fromkeys(faults, 0); before = dict.fromkeys(faults, 0)
for r in rows:
    x0 = resample_poly(np.fromfile(os.path.join(data, os.path.basename(meta[r['ecg_id']]['filename_hr']) + '.dat'), dtype='<i2').reshape(5000, 12) / 1000., 1, 2, axis=0)
    base = assess(x0, fs)
    for name, (change, seen) in faults.items():
        j = int(rng.integers(12)); x = x0.copy(); change(x, j)
        hits[name] += bool(seen(assess(x, fs), j)); before[name] += bool(seen(base, j))
print(split, 'records', len(rows))
for k in faults:
    print(f'{k:14s} caught {hits[k] / len(rows):6.1%}   before fault {before[k] / len(rows):5.1%}')
