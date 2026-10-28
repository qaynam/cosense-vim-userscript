// jsdom test harness: a fake cosense editor + the built userscript.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export const SRC = readFileSync(new URL('../dist/cosense-vim.user.js', import.meta.url), 'utf8');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const charSpans = t => Array.from(t).map((c, j) => `<span class="char-index c-${j}" data-char-index="${j}">${c}</span>`).join('');

export function makeEnv({ lines = ['テスト', '', 'hello world foo', 'second line', '', 'para two', 'last'], cursor = 2, project = 'proj', cosenseOverride } = {}) {
  const html = `<!doctype html><html><head></head><body>
<div class="app"><div class="col-page"><div class="editor" id="editor">
<div class="compute-line" id="compute-line"><div class="line"></div></div>
<div class="lines">${lines.map((t, i) => `<div class="line${i === 0 ? ' line-title' : ''}${i === cursor ? ' cursor-line' : ''}" id="Lid${i}"><span class="text">${t ? charSpans(t) : '<br class="empty-char-index">'}</span></div>`).join('')}</div>
</div></div></div>
<textarea id="text-input"></textarea><div class="cursor"></div>
</body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: `https://scrapbox.io/${project}/page` });
  const w = dom.window;
  const listeners = {};
  const keylog = [];
  const inserted = [];
  const errors = [];
  w.cosense = cosenseOverride ? cosenseOverride(w) : {
    Layout: 'page',
    Project: { name: project },
    Page: { title: lines[0], lines: lines.map((t, i) => ({ id: 'id' + i, text: t })), show() {} },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); },
  };
  w.document.execCommand = (cmd, _ui, text) => { if (cmd === 'insertText') inserted.push(text); return true; };
  w.addEventListener('error', e => errors.push(e.message));
  w.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason && e.reason.message)));
  w.console.log = () => {}; w.console.warn = () => {};
  w.console.error = (...a) => errors.push(a.join(' '));
  const ta = () => w.document.getElementById('text-input');
  ta().addEventListener('keydown', e => keylog.push((e.shiftKey && e.key.length > 1 ? 'S-' : '') + (e.ctrlKey ? 'C-' : '') + (e.metaKey ? 'M-' : '') + (e.altKey ? 'A-' : '') + e.key));

  const env = {
    window: w, document: w.document, listeners, keylog, inserted, errors,
    get vim() { return w.cosenseVim; },
    ta,
    eval() { w.eval(SRC); },
    async boot() { w.eval(SRC); await sleep(250); ta().focus(); return env; },
    press(key, opts = {}) {
      const ev = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
      ta().dispatchEvent(ev);
      return ev;
    },
    async type(keys, gap = 5) { for (const k of keys) { env.press(k); await sleep(gap); } },
    fire(name) { (listeners[name] || []).forEach(f => f()); },
    close() { w.close(); },
  };
  return env;
}
