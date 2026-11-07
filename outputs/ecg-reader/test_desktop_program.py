from pathlib import Path
import sys
import unittest
import os
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'desktop'))
import cardioai_desktop


class DesktopProgramTest(unittest.TestCase):
    def test_api_has_no_public_attributes(self):
        # pywebview walks public attributes of js_api; a stored window froze the program on Windows.
        public = [name for name in vars(cardioai_desktop.Api()) if not name.startswith('_')]
        self.assertEqual(public, [])

    def test_native_window_exists_before_disk_initialization(self):
        calls = []
        window = SimpleNamespace(load_url=lambda url: calls.append(('navigate', url)))
        def create(*args, **kwargs):
            calls.append(('window', kwargs['html']))
            return window
        def run(callback, **kwargs):
            calls.append(('event-loop', None))
            callback()
        fake = SimpleNamespace(settings={}, create_window=create, start=run)
        with patch.dict(sys.modules, {'webview': fake}), patch.object(sys, 'argv', ['CardioAI']), \
             patch.object(cardioai_desktop.BackgroundServer, 'start', side_effect=lambda: calls.append(('disk', None)) or 'http://127.0.0.1:1234/app/'), \
             patch.object(cardioai_desktop.BackgroundServer, 'stop') as stop:
            cardioai_desktop.main()
        self.assertEqual([c[0] for c in calls], ['window', 'event-loop', 'disk', 'navigate'])
        stop.assert_called_once()

    def test_close_during_initialization_does_not_leave_server_running(self):
        backend = cardioai_desktop.BackgroundServer()
        server = unittest.mock.Mock()
        def close_during_start(port):
            backend.stop()
            return server
        fake = SimpleNamespace(LocalServer=close_during_start)
        with patch.dict(os.environ), patch.dict(sys.modules, {'deepecg_local_server': fake}), \
             patch.object(cardioai_desktop, 'data_dir') as data, \
             patch.object(cardioai_desktop, 'choose_work_dir', return_value='models'):
            self.assertIsNone(backend.start())
        server.server_close.assert_called_once()
        server.serve_forever.assert_not_called()

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
