"""Print transport checks, with no native window or real printer."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request

from deepecg_local_server import LocalServer
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
import cardioai_desktop


class PrintingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = LocalServer(0, Path(self.temp.name))
        self.server.models = lambda: {}
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.server.server_address[1])

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, data, **headers):
        headers = {'Content-Type': 'application/json', 'Origin': self.base,
                   'X-ECG-Token': self.server.token, **headers}
        req = urllib.request.Request(self.base + '/api/report', json.dumps(data).encode(), headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.load(e)

    def test_status_and_authenticated_opener(self):
        with urllib.request.urlopen(self.base + '/api/status') as r:
            self.assertFalse(json.load(r)['desktop_print'])
        opener = self.server.report_opener = Mock(return_value='/local/report.html')
        with urllib.request.urlopen(self.base + '/api/status') as r:
            self.assertTrue(json.load(r)['desktop_print'])
        status, body = self.post({'name': 'analysis.html', 'html': '<body>analysis</body>'})
        self.assertEqual((status, body), (200, {'path': '/local/report.html'}))
        opener.assert_called_once_with('analysis.html', '<body>analysis</body>')
        self.assertEqual(self.post({'name': 'x', 'html': 'x'}, **{'X-ECG-Token': 'wrong'})[0], 403)
        self.assertEqual(self.post({'name': 'x', 'html': 'x'}, Origin='https://other.invalid')[0], 403)
        self.assertEqual(self.post({'name': 'x', 'html': 'x'}, Host='other.invalid')[0], 403)
        self.assertEqual(opener.call_count, 1)

    def test_errors_are_not_success(self):
        self.assertEqual(self.post({'name': 'x', 'html': 'x'})[0], 409)
        self.server.report_opener = Mock(side_effect=OSError('browser unavailable'))
        self.assertEqual(self.post({'name': 'x', 'html': 'x'})[0], 502)
        self.server.report_opener = Mock(return_value=None)
        self.assertEqual(self.post({'name': 'x', 'html': 'x'})[0], 502)
        self.assertEqual(self.post({'name': [], 'html': ''})[0], 400)

    def test_mac_report_is_saved_and_opened_in_a_real_browser(self):
        with patch.object(cardioai_desktop, 'data_dir', return_value=Path(self.temp.name)), \
             patch.object(sys, 'platform', 'darwin'), patch.object(cardioai_desktop.subprocess, 'run') as launch:
            target = cardioai_desktop.Api().open_report('../analysis.html', '<body>Анализ</body>')
        self.assertEqual(Path(target).read_text(encoding='utf-8'), '<body>Анализ</body>')
        self.assertEqual(Path(target).parent, Path(self.temp.name) / 'reports')
        launch.assert_called_once_with(['open', '-a', 'Safari', target], check=True, capture_output=True, timeout=10)


if __name__ == '__main__':
    unittest.main()
