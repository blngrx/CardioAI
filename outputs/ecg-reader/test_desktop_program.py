from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
import cardioai_desktop


class DesktopProgramTest(unittest.TestCase):
    def test_api_has_no_public_attributes(self):
        # pywebview walks public attributes of js_api; a stored window froze the program on Windows.
        public = [name for name in vars(cardioai_desktop.Api()) if not name.startswith('_')]
        self.assertEqual(public, [])

    def test_missing_streams_are_opened(self):
        with patch.object(sys, 'stdout', None), patch.object(sys, 'stderr', None):
            cardioai_desktop.open_missing_streams()
            try:
                self.assertIsNotNone(sys.stdout)
                sys.stderr.write('request log')
            finally:
                sys.stdout.close()
                sys.stderr.close()

    def test_existing_streams_are_kept(self):
        before = sys.stderr
        cardioai_desktop.open_missing_streams()
        self.assertIs(sys.stderr, before)


if __name__ == '__main__':
    unittest.main()
