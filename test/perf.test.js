// Long jumps must not cost one synthetic key per line / char.
// Cosense re-renders on every key (and the whole selection while one grows), so
// "636k" in visual mode used to take 30 s+. A fake layout + a tiny cursor model stand in
// for cosense here so the click-based fast path can run under jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, sleep } from './helpers.js';

const CW = 10, LH = 20, X0 = 100;

function fakeCosense(env, { hiddenUnlessCursor = () => false, viewport = 1e7 } = {}) {
  const w = env.window, d = env.document;
  const lines = () => [...d.querySelectorAll('.editor .lines > .line')];
  const len = L => lines()[L].querySelectorAll('.char-index').length;
  const m = { cur: { L: 2, c: 0 }, anchor: null, arrows: 0, clicks: 0, kills: 0 };
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  const lineOf = el => lines().indexOf(el.closest('.lines > .line'));
  const orig = w.Element.prototype.getBoundingClientRect;
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('char-index')) {
      const L = lineOf(this);
      if (L !== m.cur.L && hiddenUnlessCursor(L)) return rect(X0, L * LH, 0, 0);
      return rect(X0 + this.dataset.charIndex * CW, L * LH, CW, LH);
    }
    if (this.classList.contains('cursor')) return rect(X0 + m.cur.c * CW, m.cur.L * LH, 1, LH);
    if (this.closest && this.closest('.lines > .line')) { const L = lineOf(this); return rect(X0, L * LH, Math.max(1, len(L)) * CW, LH); }
    return orig.call(this);
  };
  Object.defineProperty(w, 'innerHeight', { value: viewport, configurable: true });
  const text = L => Array.from(env.window.cosense.Page.lines[L].text);
  const posOf = p => { let o = 0; for (let i = 0; i < p.L; i++) o += text(i).length + 1; return o + p.c; };
  const render = () => {
    lines().forEach((el, i) => { if (el.classList.contains('cursor-line') !== (i === m.cur.L)) el.classList.toggle('cursor-line', i === m.cur.L); });
    // like cosense: the textarea holds the selected text
    const ta = env.ta();
    if (m.anchor) {
      const all = env.window.cosense.Page.lines.map(l => l.text).join('\n');
      const [a, b] = [posOf(m.anchor), posOf(m.cur)].sort((x, y) => x - y);
      ta.value = Array.from(all).slice(a, b).join(''); ta.setSelectionRange(0, ta.value.length);
    } else { ta.value = ''; }
  };
  const moveTo = (L, c, shift) => {
    if (shift) m.anchor ??= { ...m.cur }; else m.anchor = null;
    m.cur = { L, c }; render();
  };
  env.ta().addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    const { L, c } = m.cur; const last = lines().length - 1;
    switch (e.key) {
      case 'ArrowRight': m.arrows++; if (c < len(L)) moveTo(L, c + 1, e.shiftKey); else if (L < last) moveTo(L + 1, 0, e.shiftKey); break;
      case 'ArrowLeft': m.arrows++; if (c > 0) moveTo(L, c - 1, e.shiftKey); else if (L > 0) moveTo(L - 1, len(L - 1), e.shiftKey); break;
      case 'ArrowDown': m.arrows++; if (L < last) moveTo(L + 1, Math.min(c, len(L + 1)), e.shiftKey); break;
      case 'ArrowUp': m.arrows++; if (L > 0) moveTo(L - 1, Math.min(c, len(L - 1)), e.shiftKey); break;
      case 'a': if (e.ctrlKey) moveTo(L, 0, false); break;
      case 'e': if (e.ctrlKey) moveTo(L, len(L), false); break;
      case 'k': if (e.ctrlKey) m.kills++; break;
    }
  });
  d.addEventListener('mousedown', e => {
    const L = lineOf(e.target); if (L < 0) return;
    m.clicks++;
    const c = Math.max(0, Math.min(len(L), Math.round((e.clientX - X0) / CW)));
    moveTo(L, c, e.shiftKey);
  });
  m.set = (L, c) => moveTo(L, c, false);
  return m;
}

const bigPage = n => ['タイトル', ...Array.from({ length: n }, (_, i) => `line ${i + 1} some text here`)];

test('visual 636k: one click instead of 636 Shift+ArrowUp', async () => {
  const env = makeEnv({ lines: bigPage(700), cursor: 690 });
  const m = fakeCosense(env);
  await env.boot();
  m.set(690, 5);
  env.press('v');
  m.arrows = 0; m.clicks = 0;
  const t0 = performance.now();
  await env.type(['6', '3', '6', 'k'], 0);
  await sleep(30);
  const ms = performance.now() - t0;
  assert.deepEqual(m.cur, { L: 54, c: 5 }, 'same column, 636 lines up');
  assert.ok(m.anchor && m.anchor.L === 690, 'selection extends from the visual start');
  assert.ok(m.arrows <= 6, `arrow presses: ${m.arrows}`);
  assert.equal(m.clicks, 1);
  assert.ok(ms < 1000, `${ms}ms`);
  assert.deepEqual(env.errors, []);
  env.close();
});

test('normal 300j keeps the column (clamped to the line length)', async () => {
  const env = makeEnv({ lines: [...bigPage(400), 'ab'], cursor: 2 });
  const m = fakeCosense(env);
  await env.boot();
  m.set(2, 9);
  m.arrows = 0;
  await env.type(['3', '0', '0', 'j'], 0);
  assert.deepEqual(m.cur, { L: 302, c: 9 });
  await env.type(['G'], 0);
  m.set(399, 20);
  await env.type(['2', 'j'], 0); await sleep(20);
  assert.deepEqual(m.cur, { L: 401, c: 2 }, 'clamped to "ab"');
  assert.ok(m.arrows <= 2, `arrow presses: ${m.arrows}`);
  env.close();
});

test('long word / find motions on one line use a click', async () => {
  const long = Array.from({ length: 80 }, (_, i) => 'w' + i).join(' ') + ' END';
  const env = makeEnv({ lines: ['t', long, 'x'], cursor: 1 });
  const m = fakeCosense(env);
  await env.boot();
  m.set(1, 0);
  m.arrows = 0; m.clicks = 0;
  await env.type(['f', 'E'], 0); await sleep(20);
  assert.equal(m.cur.c, Array.from(long).indexOf('E'));
  await env.type(['0'], 0);
  m.set(1, 0); m.arrows = 0;
  await env.type(['4', '0', 'w'], 0); await sleep(20);
  assert.equal(Array.from(long).slice(m.cur.c, m.cur.c + 3).join(''), 'w40');
  assert.ok(m.arrows <= 6, `arrow presses: ${m.arrows}`);
  env.close();
});

test('falls back to arrows when the click is ignored', async () => {
  const env = makeEnv({ lines: bigPage(30), cursor: 25 });
  const m = fakeCosense(env);
  env.document.addEventListener('mousedown', e => e.stopImmediatePropagation(), true);   // cosense ignores clicks
  await env.boot();
  m.set(25, 3);
  env.press('v');
  await env.type(['2', '0', 'k'], 0);
  await sleep(50);   // next frame: the click did nothing → arrow fallback
  assert.deepEqual(m.cur, { L: 5, c: 3 });
  assert.equal(m.anchor.L, 25);
  env.close();
});

test('image / embed lines (chars hidden until the cursor is there): two clicks, no arrows', async () => {
  const lines = bigPage(200); lines[10] = '[https://example.com/some/long/image/path.png]';
  const env = makeEnv({ lines, cursor: 150 });
  const m = fakeCosense(env, { hiddenUnlessCursor: L => L === 10 });
  await env.boot();
  m.set(150, 3);
  m.arrows = 0; m.clicks = 0;
  await env.type(['1', '4', '0', 'k'], 0); await sleep(20);
  assert.deepEqual(m.cur, { L: 10, c: 3 });
  assert.equal(m.clicks, 2);
  assert.ok(m.arrows <= 6, `arrow presses: ${m.arrows}`);
  env.close();
});

test('3J joins with one selection + one insert (indent kept, like Ctrl+K at EOL)', async () => {
  const env = makeEnv({ lines: ['t', 'first', '  second', '\tthird', 'fourth'], cursor: 1 });
  const m = fakeCosense(env);
  await env.boot();
  m.set(1, 2);
  m.kills = 0; env.inserted.length = 0;
  await env.type(['3', 'J'], 0); await sleep(80);
  assert.deepEqual(env.inserted, ['  second\tthird']);
  assert.equal(m.kills, 0, 'no per-line Ctrl+K');
  assert.deepEqual(env.errors, []);
  env.close();
});

test('visual line: only changed lines are touched on j/k', async () => {
  const env = makeEnv({ lines: bigPage(300), cursor: 5 });
  fakeCosense(env);
  await env.boot();
  env.press('V');
  await env.type(['2', '0', '0', 'j'], 0); await sleep(40);
  const sel = () => env.document.querySelectorAll('.vim-vl-sel').length;
  assert.equal(sel(), 201);
  let writes = 0;
  const obs = new env.window.MutationObserver(ms => { for (const x of ms) if (x.oldValue !== null && (x.oldValue.includes('vim-vl-sel') !== x.target.classList.contains('vim-vl-sel'))) writes++; });
  obs.observe(env.document.querySelector('.editor .lines'), { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
  env.press('j'); await sleep(40);
  await new Promise(r => setTimeout(r, 0));
  obs.disconnect();
  assert.equal(sel(), 202);
  assert.ok(writes <= 2, `class writes: ${writes}`);
  env.press('Escape');
  env.close();
});

test('relative numbers: only the lines on screen are rewritten per move', async () => {
  const env = makeEnv({ lines: bigPage(1000), cursor: 3 });
  const m = fakeCosense(env, { viewport: 400 });   // 20 lines on screen
  await env.boot(); m.set(3, 0); await sleep(200);
  let writes = 0;
  const obs = new env.window.MutationObserver(ms => { writes += ms.length; });
  obs.observe(env.document.querySelector('.editor .lines'), { attributes: true, attributeFilter: ['data-vim-ln'], subtree: true });
  env.press('j'); await sleep(200);
  obs.disconnect();
  assert.ok(writes > 0 && writes <= 20 + 2 * 40 + 2, `attribute writes: ${writes}`);
  const ln = i => env.document.querySelectorAll('.editor .lines > .line')[i].getAttribute('data-vim-ln');
  assert.equal(ln(4), '4', 'cursor line shows its absolute number');
  assert.equal(ln(6), '2');
  env.close();
});
