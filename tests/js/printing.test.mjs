import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printReport } from '../../app/js/files.js';

async function desktopEnvironment(run) {
  const saved = new Map(['window', 'document', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const calls = [];
  globalThis.window = {}; // Actual failing case: no pywebview API and no Safari UA token.
  globalThis.document = { querySelector: () => ({ content: 'test-token' }), createElement: () => { throw Error('desktop must not use an iframe'); } };
  globalThis.fetch = async (path, init) => {
    calls.push([path, init]);
    return path === '/api/status'
      ? { ok: true, json: async () => ({ desktop_print: true }) }
      : { ok: true, json: async () => ({ path: '/local/report.html' }) };
  };
  try { await run(calls); }
  finally { for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; }
}

test('native desktop prints through the authenticated server without bridge or iframe', async () => {
  await desktopEnvironment(async calls => {
    assert.equal(await printReport('<html><body>Краткий анализ</body></html>', 'ЭКГ'), '/local/report.html');
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0], '/api/report');
    assert.equal(calls[1][1].headers['X-ECG-Token'], 'test-token');
    const report = JSON.parse(calls[1][1].body);
    assert.match(report.name, /CardioAI ЭКГ\.html/);
    assert.match(report.html, /setTimeout\(print, 400\)/);
  });
});
test('a failed desktop opener reports an error instead of falling into iframe success', async () => {
  await desktopEnvironment(async () => {
    globalThis.fetch = async path => path === '/api/status'
      ? { ok: true, json: async () => ({ desktop_print: true }) }
      : { ok: false, json: async () => ({ error: 'Не удалось открыть Safari' }) };
    await assert.rejects(printReport('<body>text</body>', 'ЭКГ'), /Не удалось открыть Safari/);
  });
});
test('desktop rejects a success response without a confirmed report path', async () => {
  await desktopEnvironment(async () => {
    globalThis.fetch = async path => ({ ok: true, json: async () => path === '/api/status' ? { desktop_print: true } : {} });
    await assert.rejects(printReport('<body>text</body>', 'ЭКГ'), /не подтвердила/);
  });
});
