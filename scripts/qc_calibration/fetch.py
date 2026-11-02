"""Fetch PTB-XL metadata and a fixed sample of 500 Hz records. Resumes; data files stay out of the repo."""
import ast, csv, json, os, random, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
BASE = 'https://physionet-open.s3.amazonaws.com/ptb-xl/1.0.3/'
out = sys.argv[1]
def get(rel, name, size=None):
    path = os.path.join(out, name)
    if os.path.exists(path) and (size is None or os.path.getsize(path) == size):
        return True
    for attempt in range(4):
        try:
            with urllib.request.urlopen(BASE + rel, timeout=120) as r:
                data = r.read()
            if size is not None and len(data) != size:
                raise ValueError(f'{rel}: {len(data)} bytes')
            with open(path + '.part', 'wb') as f:
                f.write(data)
            os.replace(path + '.part', path)
            return True
        except Exception as e:
            print('retry', rel, e, flush=True)
    return False
for name in ('ptbxl_database.csv', 'scp_statements.csv'):
    assert get(name, name), name
get('records500/00000/00001_hr.hea', '00001_hr.hea')
rows = list(csv.DictReader(open(os.path.join(out, 'ptbxl_database.csv'), encoding='utf-8')))
rng = random.Random(20261102)
tune = [r for r in rows if int(float(r['strat_fold'])) <= 8]
held = [r for r in rows if int(float(r['strat_fold'])) >= 9]
pick = {r['ecg_id']: 'tune' for r in rng.sample(tune, 800)}
pick.update({r['ecg_id']: 'tune' for r in tune if r['electrodes_problems'].strip()})
pick.update({r['ecg_id']: 'held' for r in rng.sample(held, 500)})
pick.update({r['ecg_id']: 'held' for r in held if r['electrodes_problems'].strip()})
sample = [dict(r, split=pick[r['ecg_id']]) for r in rows if r['ecg_id'] in pick]
json.dump(sample, open(os.path.join(out, 'sample.json'), 'w', encoding='utf-8'))
print('records', len(sample), 'MB', len(sample) * .12, flush=True)
rng.shuffle(sample)  # any partial download stays a random sample
def one(r):
    rel = r['filename_hr'] + '.dat'
    return get(rel, os.path.basename(rel), 120000)
with ThreadPoolExecutor(16) as pool:
    done = 0
    for ok in pool.map(one, sample):
        done += bool(ok)
        if done % 100 == 0:
            print('done', done, flush=True)
print('finished', done, 'of', len(sample), flush=True)
