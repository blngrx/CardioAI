"""Decoder coverage using generated signals, with no personal ECG fixture."""
import math
import struct
import unittest
from ecg_reader import read_record


def fixture(samples=600, rr_count=11):
    blob = bytearray(24981 + 24 * samples)
    blob[6:20] = b'20000101000000'
    for start, samples in [(79, 1000), (24981, samples)]:
        one = [round(60 * math.sin(i / 15)) for i in range(samples)]
        leads = [[2048 + v for v in one], [2048 + 2 * v for v in one], [2048 + v for v in one]]
        leads.extend([[2048 + v for v in one] for _ in range(9)])
        struct.pack_into('<' + str(samples * 12) + 'H', blob, start, *(v for lead in leads for v in lead))
    struct.pack_into('<5H', blob, 24079, 60, 160, 90, 400, 400)
    struct.pack_into('<11H', blob, 24089, *([1000] * rr_count + [0] * (11 - rr_count)))
    return bytes(blob)


class ReaderTest(unittest.TestCase):
    def test_shapes_and_exact_round_trip(self):
        raw = fixture()
        result = read_record(raw)
        self.assertEqual(len(result['block_A']), 12)
        self.assertEqual(len(result['block_A'][0]), 1000)
        self.assertEqual(len(result['block_B'][0]), 600)
        rebuilt = struct.pack('<7200H', *(v for lead in result['block_B'] for v in lead))
        self.assertEqual(rebuilt, raw[24981:])

    def test_long_record_and_unused_rr_slots(self):
        raw = fixture(samples=2000, rr_count=9)
        result = read_record(raw)
        self.assertEqual(len(result['block_B'][0]), 2000)
        self.assertEqual(result['inferred_metadata']['RR_ms'], [1000] * 9)
        self.assertEqual(struct.pack('<24000H', *(v for lead in result['block_B'] for v in lead)), raw[24981:])
        damaged = bytearray(raw)
        struct.pack_into('<H', damaged, 24089 + 2 * 3, 0)
        with self.assertRaises(ValueError):
            read_record(damaged)

    def test_bad_size_id_and_adc(self):
        raw = fixture()
        damaged = bytearray(raw)
        struct.pack_into('<H', damaged, 24981, 65535)
        for item in [raw[:-1], raw + b'0', raw[:6] + b'x' + raw[7:], bytes(damaged)]:
            with self.subTest(), self.assertRaises((ValueError, UnicodeError)):
                read_record(item)


if __name__ == '__main__':
    unittest.main()
