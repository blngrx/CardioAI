import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseECG301 } from '../../app/js/ecg301.js';
import { syntheticECG301 } from './fixtures.mjs';
import { deriveMeasurements } from '../../app/js/measure.js';

test('long recording preserves every sample and excludes empty RR slots', () => {
  const raw = syntheticECG301({ samples: 2000, rrCount: 9 });
  const p = parseECG301(raw);
  assert.equal(p.blocks.B.length, 12);
  assert.equal(p.blocks.B[0].length, 2000);
  assert.equal(p.device.RR_ms.length, 9);
  assert.equal(deriveMeasurements(p.device).RR_mean_ms, 800);
  const v = new DataView(raw);
  for (let lead = 0; lead < 12; lead++) for (let i = 0; i < 2000; i++)
    assert.equal(p.blocks.B[lead][i], v.getUint16(24981 + 2 * (lead * 2000 + i), true));
});
test('internal zero RR and unsupported lengths are rejected', () => {
  const raw = syntheticECG301({ samples: 2000, rrCount: 9 });
  new DataView(raw).setUint16(24089 + 6, 0, true);
  assert.throws(() => parseECG301(raw), /формата/);
  assert.throws(() => parseECG301(new ArrayBuffer(72980)), /вариант/);
});
