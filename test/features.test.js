import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, sleep } from './helpers.js';

const C = s => Array.from(s);
// values come from the jsdom realm: compare as plain JSON
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
let T;
test('setup', async () => { const env = await makeEnv().boot(); T = env.vim._t; env.close(); });

test('word steps (incl. Japanese script boundaries)', () => {
  const lines = ['#タグ と #存在しないタグ_dom_check', 'next line'];
  const get = i => C(lines[i] || '');
  same(T.stepE({ L: 0, c: 0 }, false, get, 1), { L: 0, c: 2 });   // "#" → end of タグ
  same(T.stepW({ L: 0, c: 2 }, false, get, 1), { L: 0, c: 4 });   // → と
  same(T.stepW({ L: 0, c: 4 }, false, get, 1), { L: 0, c: 6 });   // → #
  same(T.stepB({ L: 0, c: 6 }, false, get), { L: 0, c: 4 });
  same(T.stepW({ L: 0, c: 13 }, false, get, 1), { L: 0, c: 14 }); // katakana → latin
  same(T.stepW({ L: 0, c: 14 }, false, get, 1), { L: 1, c: 0 });  // last word → next line
  same(T.stepW({ L: 0, c: 0 }, true, get, 1), { L: 0, c: 4 });    // WORD
  assert.equal(T.charClass('か'), 3); assert.equal(T.charClass('カ'), 4); assert.equal(T.charClass('漢'), 5);
});

test('f / t / F / T / ; targets', () => {
  const s = C('[foo] and [bar]');
  assert.equal(T.findCharIn(s, 0, 'f', ']', 1, false), 4);
  assert.equal(T.findCharIn(s, 0, 't', ']', 1, false), 3);
  assert.equal(T.findCharIn(s, 0, 'f', ']', 1, true), 5, 'inclusive for operators');
  assert.equal(T.findCharIn(s, 0, 'f', ']', 2, false), 14);
  assert.equal(T.findCharIn(s, 14, 'F', '[', 1, false), 10);
  assert.equal(T.findCharIn(s, 14, 'T', '[', 1, false), 11);
  assert.equal(T.findCharIn(s, 3, 't', ']', 1, false, true), 13, 't; skips the adjacent match');
  assert.equal(T.findCharIn(s, 0, 'f', 'z', 1, false), -1);
});

test('text objects', () => {
  const s = C('see [* bold] and "quoted text" end');
  const pick = r => r && s.slice(r.start, r.end).join('');
  assert.equal(pick(T.textObjectIn(s, 0, 'iw')), 'see');
  assert.equal(pick(T.textObjectIn(s, 0, 'aw')), 'see ');
  assert.equal(pick(T.textObjectIn(s, 8, 'i[')), '* bold');
  assert.equal(pick(T.textObjectIn(s, 8, 'a[')), '[* bold]');
  assert.equal(pick(T.textObjectIn(s, 4, 'i]')), '* bold', 'cursor on the bracket');
  assert.equal(pick(T.textObjectIn(s, 0, 'i[')), '* bold', 'next pair when not inside');
  assert.equal(pick(T.textObjectIn(s, 20, 'i"')), 'quoted text');
  assert.equal(pick(T.textObjectIn(s, 20, 'a"')), '"quoted text" ');
  const n = C('[a [b] c]');
  assert.equal(n.slice(...Object.values(T.textObjectIn(n, 4, 'i['))).join(''), 'b');
  assert.equal(n.slice(...Object.values(T.textObjectIn(n, 4, 'i[', 2))).join(''), 'a [b] c');
  const j = C('日本語の[リンク]です');
  assert.equal(j.slice(...Object.values(T.textObjectIn(j, 6, 'i['))).join(''), 'リンク');
  assert.equal(j.slice(...Object.values(T.textObjectIn(j, 0, 'iw'))).join(''), '日本語', 'kanji run');
  assert.equal(T.textObjectIn(C('no brackets'), 0, 'i['), null);
});

test('search over lines (smartcase, wrap)', () => {
  const lines = ['Title', 'foo bar', 'Baz foo', 'end'];
  same(T.findInLines(lines, 1, 0, 'foo', 1), { L: 2, c: 4, wrapped: false });
  same(T.findInLines(lines, 2, 4, 'foo', 1), { L: 1, c: 0, wrapped: true });
  same(T.findInLines(lines, 2, 4, 'foo', -1), { L: 1, c: 0, wrapped: false });
  assert.equal(T.findInLines(lines, 0, 0, 'baz', 1).L, 2, 'lowercase pattern ignores case');
  assert.equal(T.findInLines(lines, 0, 0, 'BAZ', 1), null, 'uppercase pattern is case-sensitive');
  same(T.findInLines(['日本語の検索テスト'], 0, 0, '検索', 1), { L: 0, c: 4, wrapped: false });
});

test('keymap notation', () => {
  same(T.parseKeys('jk<Esc>'), ['j', 'k', '<Esc>']);
  same(T.parseKeys('<space>w'), ['<Space>', 'w']);
  same(T.parseKeys('<C-N>x'), ['<C-n>', 'x']);
  same(T.parseKeys('<lt>a<'), ['<', 'a', '<']);
});

test('inoremap jk <Esc>: jk leaves insert, j + other key types both', async () => {
  const env = await makeEnv().boot();
  env.window.localStorage.setItem('cosense-vim:global', JSON.stringify({ keymap: 'inoremap jk <Esc>\nnnoremap H 0' }));
  env.window.cosense.Project.name = 'p2'; env.fire('page:changed'); await sleep(50);   // reload config
  env.ta().focus();
  env.press('i'); assert.equal(env.vim.state.mode, 'insert');
  const j = env.press('j');
  assert.equal(j.defaultPrevented, true, 'prefix is held');
  env.press('k'); await sleep(10);
  assert.equal(env.vim.state.mode, 'normal', 'jk → Esc');
  env.press('i'); env.inserted.length = 0;
  env.press('j'); env.press('a'); await sleep(10);
  assert.deepEqual(env.inserted, ['j', 'a'], 'held j is typed when the mapping does not complete');
  env.inserted.length = 0;
  env.press('j'); await sleep(1100);
  assert.deepEqual(env.inserted, ['j'], 'timeout types the held key');
  env.press('Escape');
  env.keylog.length = 0;
  env.press('H'); await sleep(10);
  assert.ok(env.keylog.includes('C-a'), 'nnoremap H 0 → Ctrl+A (line start): ' + env.keylog);
  assert.deepEqual(env.errors, []);
  env.close();
});

test(':nnoremap at runtime and :map listing', async () => {
  const env = await makeEnv().boot();
  env.press(':'); await sleep(10);
  const ci = env.document.getElementById('vim-cmd-input');
  ci.value = 'nnoremap L $';
  ci.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(10);
  env.keylog.length = 0;
  env.press('L'); await sleep(10);
  assert.ok(env.keylog.includes('C-e'), 'L → $ (Ctrl+E): ' + env.keylog);
  env.close();
});

test('"." repeats the last change', async () => {
  const env = await makeEnv().boot();
  env.keylog.length = 0;
  env.press('>'); await sleep(10);
  const first = env.keylog.filter(k => k === 'C-ArrowRight').length;
  env.press('.'); await sleep(30);
  assert.equal(env.keylog.filter(k => k === 'C-ArrowRight').length, first * 2, '> repeated');
  env.keylog.length = 0;
  env.press('3'); env.press('.'); await sleep(30);
  assert.equal(env.keylog.filter(k => k === 'C-ArrowRight').length, 3, '3. replaces the count');
  // a change that enters insert mode repeats with its text
  env.press('A'); env.inserted.length = 0;
  env.ta().dispatchEvent(new env.window.InputEvent('beforeinput', { inputType: 'insertText', data: 'xyz', bubbles: true, cancelable: true }));
  env.press('Escape'); await sleep(10);
  env.press('.'); await sleep(50);
  assert.ok(env.inserted.includes('xyz'), 'inserted text replayed: ' + JSON.stringify(env.inserted));
  assert.equal(env.vim.state.mode, 'normal');
  assert.deepEqual(env.errors, []);
  env.close();
});

test('marks: m / \' / :marks', async () => {
  const env = await makeEnv().boot();
  env.press('m'); env.press('a');
  env.press(':'); await sleep(10);
  const ci = env.document.getElementById('vim-cmd-input');
  ci.value = 'marks';
  ci.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(10);
  assert.match(env.document.querySelector('.vim-flash').textContent, /a\s+テスト/);
  env.press("'"); env.press('z'); await sleep(20);
  assert.match(env.document.querySelector('.vim-flash').textContent, /E20/);
  assert.deepEqual(env.errors, []);
  env.close();
});

test('pending states show in the mode bar and Esc cancels them', async () => {
  const env = await makeEnv().boot();
  const mp = () => env.document.querySelector('.vim-mp').textContent;
  env.press('d'); env.press('t'); assert.equal(mp(), 'dt');
  env.press('Escape'); assert.equal(mp(), '');
  env.press('r'); assert.equal(mp(), 'r');
  env.press('Escape'); assert.equal(mp(), '');
  env.press('v'); env.press('i'); assert.equal(mp(), 'i');
  env.press('Escape'); assert.equal(env.vim.state.mode, 'normal');
  env.close();
});
