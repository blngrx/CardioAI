"""Warning rates against PTB-XL's human quality labels. Usage: summary.py results.json tune|held [q500|q250]"""
import json, sys
from collections import Counter
rows = [r for r in json.load(open(sys.argv[1], encoding='utf-8')) if r['split'] == sys.argv[2]]
q = sys.argv[3] if len(sys.argv) > 3 else 'q250'
FLAGS = ('baseline_drift', 'static_noise', 'burst_noise', 'electrodes_problems')
has = lambda r, k: bool((r[k] or '').strip())
clean = [r for r in rows if not any(has(r, k) for k in FLAGS)]
def kinds(r):
    out = set()
    for lead in r[q]['leads'].values():
        out |= set(lead['issues'])
    if any(not v['ok'] for v in r[q]['limb_identity'].values()):
        out.add('identity')
    for w in r[q]['warnings']:
        for key, name in (('электроды рук', 'arms'), ('грудных', 'chest'), ('мало комплексов', 'few_beats'), ('Форма комплексов', 'mixed_beats')):
            if key in w:
                out.add(name)
    return out
def rates(group):
    c = Counter(k for r in group for k in kinds(r))
    return {k: f'{v / max(len(group), 1):.1%}' for k, v in c.most_common()}
print(q, sys.argv[2], 'records', len(rows), 'no quality label', len(clean))
print('any warning, all    ', f"{sum(bool(r[q]['warnings']) for r in rows) / len(rows):.1%}")
print('any warning, clean  ', f"{sum(bool(r[q]['warnings']) for r in clean) / len(clean):.1%}")
print('clean rates', rates(clean))
for k in FLAGS + ('extra_beats', 'pacemaker'):
    g = [r for r in rows if has(r, k)]
    print(f'{k} n={len(g)}', rates(g))
