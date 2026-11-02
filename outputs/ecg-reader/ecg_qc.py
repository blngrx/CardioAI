#!/usr/bin/env python3
"""Signal-quality and lead-plausibility checks run before the models. NumPy only.

Findings are warnings shown next to the scores; nothing here blocks a run or changes the signal.
Limits are practical choices (docs/review/ai-analysis-critique.md, H2/H3), adjusted on a sample of
PTB-XL to keep false alarms low (docs/review/ecg-qc-calibration.md). They are not clinical cut-offs.
"""
import numpy as np
from ecg_reader import LEADS

LIMITS = dict(flat_window_s=2, flat_std_mV=0.01, low_ptp_mV=0.1,
              rail_tolerance=0.005, rail_run_s=0.02, rail_runs=2, mains_ratio=0.2, noise_ratio=0.5, interference_floor_mV=0.04,
              wander_range_mV=2.0, offset_mV=0.5, identity_relative=0.2, identity_floor_mV=0.06,
              identity_slope=0.1, min_beats_per_min=25, beat_r=0.85, inconsistent_share=0.3)
ISSUES = dict(flat='Отведение без сигнала дольше 2 с (электрод?)',
              low_amplitude='Очень низкая амплитуда',
              clipped='Срез вершин: сигнал упирается в предел записи',
              mains='Сетевая наводка 50/60 Гц',
              noise='Высокочастотный шум (мышечная дрожь, кардиостимулятор?)',
              wander='Сильный дрейф изолинии',
              offset='Смещение нуля')
MAINS = (50, 60)
IDENTITIES = dict(III=lambda i, ii: ii - i, aVR=lambda i, ii: -(i + ii) / 2,
                  aVL=lambda i, ii: i - ii / 2, aVF=lambda i, ii: ii - i / 2)


def run_lengths(mask):
    edges = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)


def clipped(y, fs):
    # A rail far from the baseline: a flat baseline at the minimum of a lead is normal.
    # The run is short because a clipped R wave is narrow; a T wave peak stays within tolerance for ~10 ms.
    # A rail is hit repeatedly. Two runs removed the 0.5-1.6% of warnings seen on PTB-XL; a lone clipped beat is missed.
    span = np.ptp(y)
    run = max(1, round(LIMITS['rail_run_s'] * fs))
    return bool(span > 0 and any(
        abs(rail) >= span / 2
        and (run_lengths(np.abs(y - rail) <= LIMITS['rail_tolerance'] * span) >= run).sum() >= LIMITS['rail_runs']
        for rail in (y.max(), y.min())))


def spectrum_ratios(y, fs):
    window = np.hanning(len(y))
    power = np.abs(np.fft.rfft((y - y.mean()) * window)) ** 2
    freq = np.fft.rfftfreq(len(y), 1 / fs)
    band = power[(freq >= 5) & (freq <= 40)].sum()
    if band <= 0:
        return 0.0, 0.0
    near_mains = np.any([np.abs(freq - f) <= 1 for f in MAINS], axis=0)
    def ratio(part):
        # Below the floor it is not reported: in a small lead such as aVL tiny noise gives a large ratio.
        rms = np.sqrt(2 * power[part].sum() / (len(y) * (window @ window)))
        return float(power[part].sum() / band) if rms >= LIMITS['interference_floor_mV'] else 0.0
    return ratio(near_mains), ratio((freq > 40) & ~near_mains)


def check_lead(y, fs):
    window = round(LIMITS['flat_window_s'] * fs)
    least_std = np.lib.stride_tricks.sliding_window_view(y, window).std(axis=1).min() if len(y) >= window else y.std()
    second = max(1, round(fs))
    slow = np.convolve(y, np.ones(second) / second, mode='valid') if len(y) >= second else y
    mains, noise = spectrum_ratios(y, fs)
    metrics = dict(ptp_mV=np.ptp(y), least_2s_std_mV=least_std, mains_ratio=mains, noise_ratio=noise,
                   wander_range_mV=np.ptp(slow), offset_mV=np.median(y))
    issues = [name for name, found in (
        ('flat', least_std < LIMITS['flat_std_mV']),
        ('low_amplitude', np.ptp(y) < LIMITS['low_ptp_mV']),
        ('clipped', clipped(y, fs)),
        ('mains', mains > LIMITS['mains_ratio']),
        ('noise', noise > LIMITS['noise_ratio']),
        ('wander', np.ptp(slow) > LIMITS['wander_range_mV']),
        ('offset', abs(np.median(y)) > LIMITS['offset_mV'])) if found]
    return dict(issues=issues, **{k: round(float(v), 4) for k, v in metrics.items()})


def check_identities(x):
    """Einthoven/Goldberger: the derived limb leads must follow from I and II, with slope near 1."""
    by_name = dict(zip(LEADS, x.T))
    out = {}
    for name, derive in IDENTITIES.items():
        lead, expected = by_name[name], derive(by_name['I'], by_name['II'])
        rms, residual = (float(np.sqrt(np.mean(v ** 2))) for v in (lead, lead - expected))
        denominator = float(expected @ expected)
        slope = float(lead @ expected) / denominator if denominator > 0 else 0.0
        # Under the floor the difference is noise, and noise also pulls the slope of a small lead down.
        ok = residual <= LIMITS['identity_floor_mV'] or (
            residual <= LIMITS['identity_relative'] * rms and abs(slope - 1) <= LIMITS['identity_slope'])
        out[name] = dict(residual_rms_mV=round(residual, 4), slope=round(slope, 3), ok=bool(ok))
    return out


def detect_beats(x, fs):
    """Same slope-energy detector as detectBeats in app/js/signal.js."""
    energy = np.zeros(len(x))
    energy[1:-1] = np.abs(x[2:] - x[:-2]).sum(axis=1)
    width = max(1, round(0.08 * fs)) | 1
    smooth = np.convolve(energy, np.ones(width) / width, mode='same')
    limit = 0.45 * np.quantile(smooth, 0.98)
    refractory = round(0.3 * fs)
    peaks = []
    for i in range(1, len(x) - 1):
        if smooth[i] <= 0 or smooth[i] < limit or smooth[i] < smooth[i - 1] or smooth[i] < smooth[i + 1]:
            continue
        if peaks and i - peaks[-1] < refractory:
            if smooth[i] > smooth[peaks[-1]]:
                peaks[-1] = i
        else:
            peaks.append(i)
    # Move each energy peak to the dominant deflection, as medianBeats does.
    # Measured from the local baseline: under drift the raw largest value can be the S wave on some beats.
    reach = round(0.06 * fs)
    def dominant(part):
        return int(np.abs(part - np.median(part, axis=0)).sum(axis=1).argmax())
    return [max(p - reach, 0) + dominant(x[max(p - reach, 0):p + reach + 1]) for p in peaks]


def beat_template(x, beats, fs):
    pre, post = round(0.25 * fs), round(0.45 * fs)
    whole = [x[b - pre:b + post] for b in beats if b >= pre and b + post <= len(x)]
    if len(whole) < 2:
        return None, None, pre
    # Each beat loses its own baseline first, otherwise drift alone makes normal beats look different.
    stack = np.stack(whole)
    edge = round(0.05 * fs)
    start, stop = np.median(stack[:, :edge], axis=1), np.median(stack[:, -edge:], axis=1)
    stack = stack - (start[:, None] + (stop - start)[:, None] * np.linspace(0, 1, stack.shape[1])[None, :, None])
    template = np.median(stack, axis=0)
    def r(beat):
        a, b = beat.ravel() - beat.mean(), template.ravel() - template.mean()
        scale = np.sqrt((a @ a) * (b @ b))
        return float(a @ b / scale) if scale > 0 else 0.0
    return template, sum(r(beat) < LIMITS['beat_r'] for beat in stack) / len(stack), pre


def placement_warnings(template, pre, fs):
    """Rules from the critique (H2). A true dextrocardia or RVH looks the same, so they only ask to recheck."""
    leads = {name: template[:, j] - np.median(template[:round(0.05 * fs), j]) for j, name in enumerate(LEADS)}
    def dominant(y, start, stop):
        part = y[pre + round(start * fs):pre + round(stop * fs)]
        return float(part[np.abs(part).argmax()])
    found = []
    i_p = dominant(leads['I'], -0.2, -0.08)
    if dominant(leads['I'], -0.06, 0.06) < 0 and dominant(leads['aVR'], -0.06, 0.06) > 0 and i_p < -0.03:
        found.append('P и QRS отрицательные в I, QRS положительный в aVR: проверьте, не перепутаны ли электроды рук')
    def r_to_s(y):
        part = y[pre - round(0.06 * fs):pre + round(0.06 * fs)]
        return max(float(part.max()), 0.0) / (max(float(-part.min()), 0.0) + 0.01)
    # V5 must also look like a V1: right bundle branch block has a tall V1 above an ordinary V5.
    if r_to_s(leads['V1']) >= r_to_s(leads['V5']) and r_to_s(leads['V5']) < 1:
        found.append('Зубец R не нарастает от V1 к V5: проверьте порядок грудных электродов')
    return found


def assess(signal, fs):
    """Report for a (samples, 12) array in mV. Always JSON-safe: the server rejects NaN and Infinity."""
    x = np.asarray(signal, dtype=np.float64)
    if x.ndim != 2 or x.shape[1] != len(LEADS) or len(x) < 2 or not np.isfinite(x).all() or not fs > 0:
        raise ValueError('Expected finite (samples, 12) array in mV')
    leads = {name: check_lead(x[:, j], fs) for j, name in enumerate(LEADS)}
    warnings = []
    for issue, text in ISSUES.items():
        names = [name for name, lead in leads.items() if issue in lead['issues']]
        if names:
            warnings.append(f'{text}: {", ".join(names)}')
    identity = check_identities(x - np.median(x, axis=0))
    broken = [name for name, item in identity.items() if not item['ok']]
    if broken:
        warnings.append(f'Отведения не согласуются с I и II ({", ".join(broken)}): ошибка масштаба или порядка отведений')
    centred = x - np.median(x, axis=0)
    beats = detect_beats(centred, fs)
    template, inconsistent, pre = beat_template(centred, beats, fs)
    duration = len(x) / fs
    if len(beats) / duration * 60 < LIMITS['min_beats_per_min']:
        warnings.append(f'Найдено мало комплексов QRS: {len(beats)} за {duration:.0f} с')
    if template is not None:
        if inconsistent >= LIMITS['inconsistent_share']:
            warnings.append(f'Форма комплексов различается ({inconsistent:.0%} не похожи на средний): экстрасистолы или помехи')
        warnings += placement_warnings(template, pre, fs)
    return dict(status='warnings' if warnings else 'ok', warnings=warnings, leads=leads,
                limb_identity=identity, duration_seconds=round(duration, 3), rate_hz=float(fs),
                beats=dict(count=len(beats), inconsistent_share=None if inconsistent is None else round(float(inconsistent), 3)),
                pacing_checked=False,
                note='Практические пороги, не клинически проверенные. Кардиостимуляция не определяется.')
