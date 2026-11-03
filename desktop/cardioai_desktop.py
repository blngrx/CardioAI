#!/usr/bin/env python3
"""CardioAI desktop program: the local server inside its own window (Windows, macOS).

Patients, history and comparison work everywhere. The neural networks are installed by the
program itself ("Анализ ИИ" → "Установить нейросети", model_setup.py).
Flags: --headless (server only, no window), --exchange (process the exchange folder this run).
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import webbrowser

HERE = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(HERE / 'outputs/ecg-reader'))


def data_dir():
    if os.environ.get('CARDIOAI_DATA'):
        return Path(os.environ['CARDIOAI_DATA'])
    if sys.platform == 'darwin':
        base = Path.home() / 'Library/Application Support'
    elif sys.platform == 'win32':
        base = Path(os.environ.get('APPDATA', Path.home() / 'AppData/Roaming'))
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    return base / 'CardioAI'


def choose_work_dir(data):
    """Folder for the neural networks (runtime, sources, weights).

    Order: CARDIOAI_WORK; "work_dir" in settings.json of the data folder; an existing
    install in ~/CardioAI/work (plus the source checkout when not packaged); otherwise %LOCALAPPDATA%\\CardioAI\\work on Windows or
    <data folder>/work elsewhere, where the "Install neural networks" button puts everything.
    """
    if os.environ.get('CARDIOAI_WORK'):
        return Path(os.environ['CARDIOAI_WORK'])
    try:
        configured = json.loads((data / 'settings.json').read_text(encoding='utf-8')).get('work_dir')
        if configured:
            return Path(configured)
    except (OSError, ValueError, AttributeError):
        pass
    # An install made before the program existed (manual setup) is reused instead of downloading again.
    candidates = [Path.home() / 'CardioAI/work']
    if not getattr(sys, 'frozen', False):  # source checkout only
        candidates += [Path(__file__).resolve().parents[1] / 'work', Path.home() / 'Projects/CardioAI/work']
    for work in candidates:
        if (work / 'deepecg-weights').is_dir() or (work / 'ecgfounder-weights').is_dir():
            return work
    if sys.platform == 'win32':
        # 4 GB of models must not go to the roaming profile (synced at every log-on in office networks).
        return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local')) / 'CardioAI/work'
    return data / 'work'


def open_missing_streams():
    """A windowed build (console=False) starts without stdout/stderr; http.server logs every request to stderr."""
    for name in ('stdout', 'stderr'):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, 'w', encoding='utf-8'))


class Api:
    """Functions the page can call through window.pywebview.api.

    Attributes must stay private: pywebview walks public ones when it exposes this object, and
    on Windows a window stored here leads it into WinForms objects, which freezes the program.
    """

    def __init__(self):
        self._window = None

    def save_file(self, name, text):
        import webview
        result = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename=Path(name).name)
        if not result:
            return None
        target = Path(result if isinstance(result, str) else result[0])
        target.write_text(text, encoding='utf-8')
        return str(target)

    def open_report(self, name, html):
        """The window has no print dialog: open the report in the system browser, which prints it."""
        folder = data_dir() / 'reports'
        folder.mkdir(parents=True, exist_ok=True)
        for old in sorted(folder.glob('*.html'), key=lambda f: f.stat().st_mtime)[:-20]:
            old.unlink(missing_ok=True)  # keep the last 20 reports
        target = folder / (''.join(c for c in Path(name).name if c.isalnum() or c in ' .-_') or 'CardioAI.html')
        target.write_text(html, encoding='utf-8')
        # The system's default program for .html (a browser); avoids file:// URIs with Cyrillic names.
        if sys.platform == 'win32':
            os.startfile(str(target))
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', str(target)])
        else:
            webbrowser.open(target.as_uri())
        return str(target)


class BackgroundServer:
    """Initialize disk/cloud resources outside the native window's event loop."""

    def __init__(self):
        self.server = None
        self.lock = threading.Lock()
        self.closed = False

    def start(self):
        with self.lock:
            if self.closed:
                return None
            if self.server:
                return f'http://127.0.0.1:{self.server.server_address[1]}/app/'
        data = data_dir()
        data.mkdir(parents=True, exist_ok=True)
        os.environ['CARDIOAI_DATA'] = str(data)
        os.environ['CARDIOAI_WORK'] = str(choose_work_dir(data))
        if '--exchange' in sys.argv:
            os.environ['CARDIOAI_EXCHANGE'] = '1'
        from deepecg_local_server import LocalServer
        server = LocalServer(int(os.environ.get('CARDIOAI_PORT', '0')))
        with self.lock:
            if self.closed:
                server.server_close()
                return None
            self.server = server
            threading.Thread(target=server.serve_forever, daemon=True).start()
        return f'http://127.0.0.1:{server.server_address[1]}/app/'

    def stop(self):
        with self.lock:
            self.closed = True
            server = self.server
        if server:
            server.shutdown()
            server.server_close()


LOADING_HTML = """<!doctype html><html lang="ru"><meta charset="utf-8">
<title>CardioAI</title><style>body{font:17px -apple-system,BlinkMacSystemFont,sans-serif;
background:#f6f8fa;color:#182330;padding:50px}p{color:#576575}</style>
<h1>CardioAI</h1><p>Открытие данных…</p></html>"""


def main():
    open_missing_streams()
    backend = BackgroundServer()
    if '--headless' in sys.argv:
        try:
            print('CardioAI: ' + backend.start(), flush=True)
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
        finally:
            backend.stop()
        return
    try:
        import webview
    except ImportError:
        try:
            url = backend.start()
            print('CardioAI: ' + url, flush=True)
            webbrowser.open(url)
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
        finally:
            backend.stop()
        return
    api = Api()
    webview.settings['ALLOW_DOWNLOADS'] = True
    # First let Cocoa/WinForms run and paint a window. Startup may touch cloud or network disks.
    api._window = webview.create_window('CardioAI', html=LOADING_HTML, js_api=api,
                                        width=1240, height=880, min_size=(380, 600))

    def load():
        try:
            url = backend.start()
            if url:
                api._window.load_url(url)
        except Exception:
            import traceback
            traceback.print_exc()
            api._window.load_html(LOADING_HTML.replace('Открытие данных…',
                'Не удалось открыть данные. Закройте программу и повторите запуск.'))

    try:
        # pywebview runs this callback in a worker; native events stay on the main thread.
        webview.start(load, private_mode=False)
    except Exception:  # e.g. WebView2 is missing on Windows
        url = backend.start()
        if url:
            webbrowser.open(url)
            try:
                threading.Event().wait()
            except KeyboardInterrupt:
                pass
    finally:
        backend.stop()


if __name__ == '__main__':
    main()
