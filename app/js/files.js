// File input/output that works in a browser, the desktop window and the Android app.

export function readFile(file) {
  if (file.arrayBuffer) return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function saveFile(text, name, mime = 'application/octet-stream') {
  const plugins = window.Capacitor?.Plugins;
  if (window.Capacitor?.isNativePlatform?.() && plugins?.Filesystem) {
    // Android WebView cannot download blobs: write to the app cache, then offer the share sheet (save to Files, Drive, Telegram…).
    const { uri } = await plugins.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8', recursive: true });
    if (plugins.Share) await plugins.Share.share({ title: name, url: uri }).catch(() => {});
    return uri;
  }
  if (window.pywebview?.api?.save_file) return window.pywebview.api.save_file(name, text);
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

// The local desktop server provides a checked report opener. WKWebView can lack
// the pywebview bridge and a Safari UA token, so it must not fall into iframe.print().
async function printThroughDesktopServer(name, html) {
  const token = document.querySelector('meta[name="cardioai-token"]')?.content;
  if (!token || token === '__TOKEN__') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/status', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw Error('Не удалось проверить службу печати');
    const status = await response.json();
    if (!status.desktop_print) return null;
    const opened = await fetch('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ECG-Token': token },
      body: JSON.stringify({ name, html }), signal: controller.signal,
    });
    const result = await opened.json();
    if (!opened.ok) throw Error(result.error || 'Не удалось открыть печать');
    if (typeof result.path !== 'string' || !result.path) throw Error('Программа не подтвердила открытие отчёта');
    return result.path;
  } catch (err) {
    if (err.name === 'AbortError') throw Error('Служба печати не ответила. Повторите попытку.');
    throw err;
  } finally { clearTimeout(timeout); }
}

// Print the short text report. Desktop opens Safari (Mac) / the associated app (Windows);
// Android shares the file; ordinary browsers retain their own print path.
export async function printReport(html, title) {
  const name = `CardioAI ${title}`.replace(/[^\p{L}\p{N} .-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + '.html';
  const autoPrint = `<script>if (Date.now() - ${Date.now()} < 120000) addEventListener('load', () => setTimeout(print, 400))</script>`;
  const printable = html.replace('</body>', autoPrint + '</body>');
  const opened = await printThroughDesktopServer(name, printable);
  if (opened !== null) return opened;
  if (window.pywebview?.api?.open_report) return window.pywebview.api.open_report(name, printable);
  if (window.Capacitor?.isNativePlatform?.()) return saveFile(html, name, 'text/html');
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|Mobile/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua))) {
    const url = URL.createObjectURL(new Blob([printable], { type: 'text/html' }));
    const tab = window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    if (!tab) throw Error('браузер заблокировал новую вкладку — разрешите всплывающие окна для этого сайта');
    return name;
  }
  const frame = Object.assign(document.createElement('iframe'), { srcdoc: html, title });
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  await new Promise(resolve => { frame.onload = resolve; document.body.append(frame); });
  frame.contentWindow.addEventListener('afterprint', () => frame.remove());
  setTimeout(() => frame.remove(), 600000);
  frame.contentWindow.focus();
  frame.contentWindow.print();
  return name;
}
