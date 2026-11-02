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
