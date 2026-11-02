"""Run ecg_qc.assess over the PTB-XL sample at 500 and 250 Hz and store every report's numbers."""
import json, os, sys, time
data, result = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'outputs', 'ecg-reader'))
import numpy as np
from scipy.signal import resample_poly
from ecg_qc import assess
KEEP = ('ecg_id', 'split', 'strat_fold', 'baseline_drift', 'static_noise', 'burst_noise', 'electrodes_problems',
        'extra_beats', 'pacemaker', 'heart_axis', 'scp_codes', 'validated_by_human')
rows = []
started = time.time()
for r in json.load(open(os.path.join(data, 'sample.json'), encoding='utf-8')):
    path = os.path.join(data, os.path.basename(r['filename_hr']) + '.dat')
    if not os.path.exists(path):
        continue
    x = np.fromfile(path, dtype='<i2').reshape(5000, 12) / 1000.0
    row = {k: r[k] for k in KEEP}
    row['q500'] = assess(x, 500)
    row['q250'] = assess(resample_poly(x, 1, 2, axis=0), 250)
    rows.append(row)
json.dump(rows, open(result, 'w', encoding='utf-8'), ensure_ascii=False)
print('records', len(rows), 'seconds', round(time.time() - started), flush=True)
