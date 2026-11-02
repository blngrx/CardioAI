import json
import unittest

import numpy as np
from deepecg_prepare import LEADS, prepare
from ecg_qc import assess

FS = 250
PRECORDIAL = {'V1': (.2, -.9), 'V2': (.3, -1.1), 'V3': (.6, -.7), 'V4': (1., -.4), 'V5': (1.2, -.2), 'V6': (.9, -.1)}


def wave(t, centre, width, height):
    return height * np.exp(-((t - centre) / width) ** 2 / 2)


def beat(t, r, s=-.1, p=.12, t_wave=.25):
    return wave(t, -.16, .02, p) + wave(t, 0, .01, r) + wave(t, .025, .008, s) + wave(t, .26, .05, t_wave)


def synthetic(fs=FS, seconds=10, rate=75):
    """A clean, normal-looking 12-lead ECG. I and II are generated; the other limb leads are derived."""
    time = np.arange(round(fs * seconds)) / fs
    period = 60 / rate
    t = (time + period / 2) % period - period / 2
    i, ii = beat(t, .6), beat(t, 1.0, p=.18, t_wave=.35)
    limb = [i, ii, ii - i, -(i + ii) / 2, i - ii / 2, ii - i / 2]
    chest = [beat(t, r, s, .06, .2) for r, s in PRECORDIAL.values()]
    return np.stack(limb + chest, axis=1)


def lead(x, name):
    return x[:, LEADS.index(name)]


class QualityTest(unittest.TestCase):
    def issues(self, x, name):
        return assess(x, FS)['leads'][name]['issues']

    def test_clean_ecg_has_no_warnings(self):
        report = assess(synthetic(), FS)
        self.assertEqual(report['warnings'], [])
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(report['beats']['count'], 13)

    def test_clean_ecg_at_device_rate(self):
        self.assertEqual(assess(synthetic(fs=200), 200)['warnings'], [])

    def test_each_problem_is_named_on_its_lead(self):
        t = np.arange(2500) / FS
        rng = np.random.default_rng(0)
        cases = dict(
            mains=lambda y: y + .3 * np.sin(2 * np.pi * 50 * t),
            noise=lambda y: y + rng.normal(0, .3, len(y)),
            wander=lambda y: y + 1.5 * np.sin(2 * np.pi * .1 * t),
            offset=lambda y: y + 1.0,
            clipped=lambda y: np.minimum(y, .5),
            low_amplitude=lambda y: y * .05)
        for issue, change in cases.items():
            with self.subTest(issue=issue):
                x = synthetic()
                x[:, LEADS.index('V4')] = change(lead(x, 'V4'))
                self.assertIn(issue, self.issues(x, 'V4'))
                self.assertEqual(self.issues(x, 'V2'), [])

    def test_lead_off_for_part_of_the_record(self):
        x = synthetic()
        x[500:1500, LEADS.index('V3')] = 0
        self.assertIn('flat', self.issues(x, 'V3'))

    def test_baseline_at_the_minimum_is_not_clipping(self):
        x = synthetic()
        x[:, LEADS.index('V4')] = beat((np.arange(2500) / FS + .4) % .8 - .4, 1, 0, 0, 0)
        self.assertNotIn('clipped', self.issues(x, 'V4'))

    def test_one_flat_peak_is_not_clipping(self):
        x = synthetic()
        y = x[:, LEADS.index('V4')]
        y[:300] = np.minimum(y[:300], .5)
        self.assertNotIn('clipped', self.issues(x, 'V4'))

    def test_drift_is_not_reported_as_different_beats(self):
        x = synthetic()
        x += .8 * np.sin(2 * np.pi * .3 * np.arange(2500) / FS)[:, None]
        self.assertLess(assess(x, FS)['beats']['inconsistent_share'], .3)

    def test_tall_v1_above_an_ordinary_v5_is_not_called_lead_order(self):
        x = synthetic()
        x[:, LEADS.index('V1')] = x[:, LEADS.index('V5')] * 1.2
        self.assertFalse(any('грудных' in w for w in assess(x, FS)['warnings']))

    def test_ordinary_noise_in_a_small_lead_is_not_reported(self):
        rng = np.random.default_rng(1)
        for fs in (200, 250, 500):
            for rate in (45, 75, 120, 170):
                with self.subTest(fs=fs, rate=rate):
                    x = synthetic(fs=fs, rate=rate)
                    self.assertEqual(assess(x + rng.normal(0, .03, x.shape), fs)['warnings'], [])

    def test_limb_identity_catches_gain_and_swap(self):
        for name, change in (('gain', lambda x: x[:, 2].__imul__(2)), ('swap', lambda x: x.__setitem__((slice(None), [2, 5]), x[:, [5, 2]]))):
            with self.subTest(name):
                x = synthetic()
                change(x)
                report = assess(x, FS)
                self.assertIn('III', [k for k, v in report['limb_identity'].items() if not v['ok']])
                self.assertTrue(any('согласуются' in w for w in report['warnings']))

    def test_arm_electrode_reversal(self):
        x = synthetic()
        i, ii = lead(x, 'I').copy(), lead(x, 'II').copy()
        # RA<->LA: I inverts, II and III trade places, aVR and aVL trade places.
        x[:, :6] = np.stack([-i, ii - i, ii, i - ii / 2, -(i + ii) / 2, ii - i / 2], axis=1)
        report = assess(x, FS)
        self.assertTrue(any('электроды рук' in w for w in report['warnings']))
        self.assertTrue(all(v['ok'] for v in report['limb_identity'].values()))

    def test_chest_order(self):
        x = synthetic()
        x[:, [6, 10]] = x[:, [10, 6]]
        self.assertTrue(any('грудных' in w for w in assess(x, FS)['warnings']))

    def test_few_beats_and_mixed_beats(self):
        x = synthetic(rate=20)
        self.assertTrue(any('мало комплексов' in w for w in assess(x, FS)['warnings']))
        x = synthetic()
        for start in range(250, 2200, 500):
            x[start:start + 100] = -x[start:start + 100] * 1.5
        self.assertGreaterEqual(assess(x, FS)['beats']['inconsistent_share'], .3)

    def test_report_is_strict_json_for_odd_input(self):
        def reject(value):
            raise ValueError(value)
        for x in (np.zeros((2500, 12)), np.ones((2500, 12)), np.zeros((10, 12)), synthetic(seconds=1)):
            with self.subTest(shape=x.shape):
                text = json.dumps(assess(x, FS), ensure_ascii=False, allow_nan=False)
                json.loads(text, parse_constant=reject)

    def test_rejects_wrong_shape_and_nan(self):
        for x in (np.zeros((2500, 11)), np.zeros(2500), synthetic() * np.nan):
            with self.subTest(shape=x.shape), self.assertRaises(ValueError):
                assess(x, FS)

    def test_input_is_not_changed(self):
        x = synthetic()
        before = x.copy()
        assess(x, FS)
        np.testing.assert_array_equal(x, before)

    def test_prepare_reports_quality_at_the_native_rate(self):
        meta = dict(lead_order=LEADS, sampling_rate_hz=200, microvolts_per_count=1.16, zero_counts=2048,
                    timing_verified=True, calibration_verified=True, simultaneous_verified=True,
                    verification_evidence='Synthetic fixture; not a patient calibration')
        counts = 2048 + synthetic(fs=200) * 1000 / 1.16
        _, report = prepare(counts, meta)
        self.assertEqual(report['qc']['rate_hz'], 200)
        self.assertEqual(report['qc']['warnings'], [])


if __name__ == '__main__':
    unittest.main()
