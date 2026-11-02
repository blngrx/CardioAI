# Calibrating the signal-quality checks on PTB-XL

`outputs/ecg-reader/ecg_qc.py` was first written against synthetic signals only. This note records how its limits were then checked on real ECGs, and what the checks still cannot do. The checks only warn: they never block a run or change the signal.

## Data and method

- **Data:** [PTB-XL 1.0.3](https://physionet.org/content/ptb-xl/1.0.3/) (CC BY 4.0), 500 Hz records, also scored after resampling to 250 Hz. No record is stored in this repository.
- **Sample:** 1,328 records, seed 20261102. Tuning: 822 records from folds 1–8. Held out: 506 records from folds 9–10, used once, after the limits were frozen. Every record with an `electrodes_problems` label was added to the sample, so that label is over-represented compared with PTB-XL as a whole.
- **"No quality label":** none of `baseline_drift`, `static_noise`, `burst_noise`, `electrodes_problems`. These records can still hold real problems, because the labels are not exhaustive, so the rates below are upper bounds on false alarms rather than exact false-alarm rates.
- **Injected faults:** faults were added to real records with no quality, extra-beat or pacemaker label (100 held-out records, 250 Hz), because PTB-XL has no labels for clipping, mains or swapped leads.

Scripts are in `scripts/qc_calibration/`.

## Changes

| Rule | Before | After | Why |
|---|---|---|---|
| Beat shapes differ | r < 0.90, raw beats | r < 0.85, each beat loses its own baseline, alignment measured from the local baseline | Drift was reported as different beats |
| Baseline drift | 1 mV | 2 mV | Most of the false alarms at 1 mV. Costs sensitivity, see below |
| Clipping | one flat run | two flat runs at the same rail | One run fired on 0.5–1.6% of unlabelled tuning records, and two runs on none. Those records were not inspected and PTB-XL has no clipping label, so a lone clipped beat is now missed |
| Chest order | R/S in V1 ≥ V5 | also R/S in V5 < 1 | Hits were almost all real conduction patterns such as right bundle branch block |
| Noise text | muscle tremor? | muscle tremor, pacemaker? | Pacing spikes trigger it (6 of 7 paced tuning records at 500 Hz) |

## Results on the held-out records

Share of records with any warning:

| Group | Before, 250 Hz | After, 250 Hz | After, 500 Hz |
|---|---|---|---|
| All 506 | 37.0% | 11.9% | 13.2% |
| No quality label, 378 | 30.2% | 6.3% | 7.1% |

The tuning records gave 9.8% with no quality label after the changes, against about 28% before. Folds 9–10 are the PTB-XL folds whose labels were reviewed by a human, which may explain part of the lower held-out rate.

Rule against the matching human label, held out, 250 Hz, after the changes:

| Label | Records | Rule | Fires, label present | Fires, no quality label |
|---|---|---|---|---|
| `baseline_drift` | 59 | drift | 22.0% | 2.1% |
| `extra_beats` | 44 | beat shapes differ | 22.7% | 3.7% |
| `static_noise` | 69 | noise | 2.9% | 0% |

The "no quality label" group here still includes records with extra beats, so 3.7% partly reflects real ectopy.

Injected faults, held out, 100 records, 0% of which triggered the matching rule before the fault:

| Fault | Caught |
|---|---|
| Lead off for 3 s | 100% |
| Drift of 3 mV peak to peak in one lead | 100% |
| V1 and V5 swapped | 98% |
| Noise, 300 µV RMS in one lead | 98% |
| Mains 50 Hz, 100 µV RMS in one lead | 93% |
| Arm electrodes swapped | 70% |
| III and aVF swapped | 63% |
| Mains 50 Hz, 50 µV RMS in one lead | 61% |
| Clipping at 60% of the peak in one lead | 61% |
| Lead III gain × 1.5 | 48% |
| Noise, 100 µV RMS in one lead | 42% |
| V1 and V6 swapped | 5% |

## What this does not show

- **A clean result proves little.** Most labelled drift (78%) and extra-beat (77%) records get no matching warning, and the noise rule misses nearly all `static_noise` records. No limit tried for high-frequency noise separated those records from unlabelled ones, so that label is probably about milder noise than the rule can see.
- **Lead checks are partial.** About a third of arm swaps are missed, and swaps of other chest leads than V1 and V5 are mostly out of reach. A true dextrocardia or similar anatomy looks like a swap, so these warnings only ask for a recheck.
- **PTB-XL is not the ECG301.** Other devices and their filters may behave differently, and the 3-second ECG301 files have not been assessed.
- **Faster drift still counts as a shape change.** A strong drift at 0.5 Hz, close to the heartbeat cycle, can still trigger the beat-shape warning. That recording does have a quality problem, but the message names the wrong cause.
- **No effect on model scores was measured.** This work does not show that a warning predicts a wrong model score.
