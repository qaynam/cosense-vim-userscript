// Long jumps must not cost one synthetic key per line / char.
// Cosense re-renders on every key (and the whole selection while one grows), so
// "636k" in visual mode used to take 30 s+.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, sleep } from './helpers.js';
import { fakeCosense, bigPage } from './fake-cosense.js';


test('visual 636k: one click instead of 636 Shift+ArrowUp', async () => {
  const env = makeEnv({ lines: bigPage(700), cursor: 690 });
  const m = fakeCosense(env);
  await env.boot();
  m.set(690, 5);
  env.press('v');
  m.arrows = 0; m.clicks = 0;
  await env.type(['6', '3', '6', 'k'], 0);
  await sleep(100);
  assert.deepEqual(m.cur, { L: 54, c: 5 }, 'same column, 636 lines up');
  assert.ok(m.anchor && m.anchor.L === 690, 'selection extends from the visual start');
  assert.ok(m.arrows <= 6, `arrow presses: ${m.arrows}`);
  assert.equal(m.clicks, 1);
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

test('relative numbers: only lines on screen are rewritten, and not while j/k repeats', async () => {
  const env = makeEnv({ lines: bigPage(200), cursor: 3 });
  const m = fakeCosense(env, { viewport: 400 });   // 20 lines on screen
  await env.boot(); m.set(3, 0); await sleep(250);
  let writes = 0;
  const obs = new env.window.MutationObserver(ms => { writes += ms.length; });
  obs.observe(env.document.querySelector('.editor .lines'), { attributes: true, attributeFilter: ['data-vim-ln'], subtree: true });
  env.press('j'); await sleep(200);
  const single = writes;
  assert.ok(single > 0 && single <= 20 + 2 * 15 + 2, `attribute writes for one j: ${single}`);
  const ln = i => env.document.querySelectorAll('.editor .lines > .line')[i].getAttribute('data-vim-ln');
  assert.equal(ln(4), '4', 'cursor line shows its absolute number');
  assert.equal(ln(6), '2');
  // a burst of j (key repeat, ~30 ms apart): numbers are not rewritten on every key
  let batches = 0;
  const obs2 = new env.window.MutationObserver(() => { batches++; });
  obs2.observe(env.document.querySelector('.editor .lines'), { attributes: true, attributeFilter: ['data-vim-ln'], subtree: true });
  // drive the clock by hand so a slow / busy test machine can't stretch the gaps between keys
  let clock = 1e6; const realNow = env.window.performance.now.bind(env.window.performance);
  env.window.performance.now = () => clock;
  for (let i = 0; i < 12; i++) { clock += 30; env.press('j'); await sleep(5); }
  const during = batches;
  clock += 1000;
  await sleep(250);
  env.window.performance.now = realNow;
  obs.disconnect(); obs2.disconnect();
  assert.ok(during <= 1, `refreshes during a 12-key burst: ${during}`);
  assert.equal(ln(16), '16');
  assert.equal(ln(18), '2', 'refreshed after the burst');
  env.close();
});

test('absolute numbers: only lines around the screen carry one, and they follow scrolling', async () => {
  const env = makeEnv({ lines: bigPage(300), cursor: 3 });
  fakeCosense(env, { viewport: 400 });
  env.window.localStorage.setItem('cosense-vim:global', JSON.stringify({ relativeNumber: false }));
  await env.boot(); await sleep(150);
  const ls = () => env.document.querySelectorAll('.editor .lines > .line');
  const numbered = () => env.document.querySelectorAll('[data-vim-ln]').length;
  assert.ok(numbered() > 0 && numbered() <= 20 + 15 + 2, `numbered lines: ${numbered()}`);
  assert.equal(ls()[5].getAttribute('data-vim-ln'), '5');
  assert.equal(ls()[200].getAttribute('data-vim-ln'), null);
  // scroll: the fake layout puts line L at y = L*20 - scrollY
  const proto = env.window.Element.prototype; const orig = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () { const r = orig.call(this); return r.top === undefined ? r : { ...r, top: r.top - 3800, bottom: r.bottom - 3800, y: r.top - 3800 }; };
  env.window.dispatchEvent(new env.window.Event('scroll')); await sleep(100);
  proto.getBoundingClientRect = orig;
  assert.equal(ls()[200].getAttribute('data-vim-ln'), '200');
  assert.equal(ls()[5].getAttribute('data-vim-ln'), null);
  env.close();
});
