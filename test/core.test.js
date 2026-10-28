import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, sleep } from './helpers.js';

test('boots into normal mode with the IME guard on', async () => {
  const env = await makeEnv().boot();
  const { vim, document: d } = env;
  assert.ok(vim.active);
  assert.equal(d.body.dataset.vimMode, 'normal');
  assert.ok(d.getElementById('vim-ind'));
  assert.ok(d.getElementById('vim-vars') && d.getElementById('vim-style'));
  assert.equal(env.ta().readOnly, true);
  assert.deepEqual(env.errors, []);
  env.close();
});

test('line helpers ignore #compute-line and number from the first content line', async () => {
  const env = await makeEnv().boot();
  await sleep(50);
  const lines = env.document.querySelectorAll('.editor .lines > .line');
  assert.equal(lines.length, 7);
  assert.equal(lines[0].getAttribute('data-vim-ln'), '');   // title
  assert.equal(lines[2].getAttribute('data-vim-ln'), '2');  // cursor line shows its absolute number
  assert.equal(lines[1].getAttribute('data-vim-ln'), '1');  // relative distance
  env.close();
});

test('parseBuf', async () => {
  const env = await makeEnv().boot();
  const P = env.vim._t.parseBuf;
  const has = (b, exp) => { const r = P(b); for (const [k, v] of Object.entries(exp)) assert.equal(r[k], v, `${b}.${k} → ${JSON.stringify(r)}`); };
  has('0', { st: 'done', kind: 'mot', mot: '0' });
  has('10', { st: 'pending' });
  has('10j', { st: 'done', kind: 'mot', mot: 'j', count: 10, explicit: true });
  has('d0', { st: 'done', kind: 'op', mot: '0' });
  has('dd', { st: 'done', kind: 'line', op: 'd', count: 1 });
  has('3dd', { st: 'done', kind: 'line', count: 3 });
  has('2d3w', { st: 'done', kind: 'op', mot: 'w', count: 6 });
  has('dgg', { st: 'done', kind: 'op', mot: 'gg' });
  has('5G', { st: 'done', kind: 'mot', mot: 'G', count: 5, explicit: true });
  has('gd', { st: 'done', kind: 'cmd', cmd: 'gd' });
  has('zt', { st: 'done', kind: 'cmd', cmd: 'zt' });
  has('di', { st: 'pending' });
  has('di[', { st: 'done', kind: 'op', op: 'd', mot: 'obj', extra: 'i[' });
  has('ca"', { st: 'done', kind: 'op', op: 'c', mot: 'obj', extra: 'a"' });
  has('dix', { st: 'invalid' });
  has('f', { st: 'pending' });
  has('fx', { st: 'done', kind: 'mot', mot: 'f', extra: 'x' });
  has('dt]', { st: 'done', kind: 'op', mot: 't', extra: ']' });
  has('d;', { st: 'done', kind: 'op', mot: ';' });
  has('dH', { st: 'done', kind: 'op', mot: 'H' });
  has('dz', { st: 'invalid' });
  env.close();
});

test('e / w / b never send Alt/Ctrl+Arrow (cosense indents with those)', async () => {
  const env = await makeEnv().boot();
  for (const k of ['e', 'w', 'b', 'E', 'W', 'B']) {
    env.keylog.length = 0;
    env.press(k);
    assert.ok(!env.keylog.some(x => /A-Arrow|C-Arrow/.test(x)), `${k}: ${env.keylog}`);
  }
  env.close();
});

test('count buffer is consumed by immediate commands', async () => {
  const env = await makeEnv().boot();
  env.press('3'); assert.equal(env.vim.state.cmdBuf, '3');
  env.press('u'); assert.equal(env.vim.state.cmdBuf, '');
  env.press('d'); env.press('i'); assert.equal(env.vim.state.cmdBuf, 'di', 'i after an operator waits for a text object');
  env.press('Escape'); assert.equal(env.vim.state.cmdBuf, '');
  env.close();
});

test('IME guard: readOnly follows the mode and is re-asserted; other inputs untouched', async () => {
  const env = await makeEnv().boot();
  const ta = env.ta();
  env.press('i'); assert.equal(env.vim.state.mode, 'insert'); assert.equal(ta.readOnly, false);
  env.press('Escape'); assert.equal(env.vim.state.mode, 'normal'); assert.equal(ta.readOnly, true);
  ta.readOnly = false; await sleep(10);
  assert.equal(ta.readOnly, true, 'watchdog');
  const other = env.document.createElement('input'); env.document.body.appendChild(other);
  const bi = new env.window.InputEvent('beforeinput', { inputType: 'insertCompositionText', bubbles: true, cancelable: true });
  other.dispatchEvent(bi);
  assert.equal(bi.defaultPrevented, false);
  env.close();
});

test('visual: decoration key without a selection is swallowed', async () => {
  const env = await makeEnv().boot();
  env.press('v'); assert.equal(env.vim.state.mode, 'visual');
  assert.equal(env.press('*').defaultPrevented, true);
  env.press('Escape');
  env.close();
});

test('command line: :set, IME Enter does not run', async () => {
  const env = await makeEnv().boot();
  env.press(':'); await sleep(10);
  const ci = env.document.getElementById('vim-cmd-input');
  ci.value = 'set nornu';
  ci.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(30);
  assert.equal(env.vim.config.relativeNumber, false);
  env.press(':'); await sleep(10);
  ci.value = 'e テスト';
  ci.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
  assert.equal(env.vim.state.cmdLine, true);
  ci.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  env.close();
});

test('help: tags, links resolve, keys are swallowed', async () => {
  const env = await makeEnv().boot();
  env.vim.openHelp('dd'); await sleep(20);
  const ov = env.document.querySelector('.vim-ov');
  const tags = [...ov.querySelectorAll('.vh-tag')].map(x => x.dataset.tag);
  for (const need of ['dd', 'gd', 'v_p', ':cpll', ':cpmdl', 'cosense-vim-ime', 'cosense-vim-css', 'cosense-vim-keymap', 'cosense-vim-textobj', 'i[', 'i"', '.', 'f', 'm', '/', 'H'])
    assert.ok(tags.includes(need), `*${need}*`);
  const dangling = [...ov.querySelectorAll('.vh-link')].map(x => x.dataset.tag).filter(l => !tags.includes(l));
  assert.deepEqual(dangling, []);
  env.keylog.length = 0;
  env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
  assert.equal(env.keylog.length, 0);
  env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }));
  assert.equal(env.document.querySelector('.vim-ov'), null);
  env.close();
});

test('settings: project override disables, #vim-settings still opens, reset re-enables, custom css', async () => {
  const env = await makeEnv().boot();
  const { document: d, window: w } = env;
  env.vim.openSettings(); await sleep(20);
  let st = d.querySelector('.vim-ov');
  st.querySelector('input[value="project"]').click();
  st.querySelector('[data-k="enabled"]').checked = false;
  st.querySelector('[data-act="save"]').click(); await sleep(30);
  assert.equal(env.vim.active, false);
  assert.ok(!d.body.dataset.vimMode && !d.getElementById('vim-ind'));
  assert.equal(JSON.parse(w.localStorage.getItem('cosense-vim:project:proj')).enabled, false);
  env.keylog.length = 0; env.press('j');
  assert.deepEqual(env.keylog, ['j'], 'disabled: keys go straight to cosense');

  w.location.hash = '#vim-settings'; await sleep(50);
  st = d.querySelector('.vim-ov');
  assert.ok(st && st.textContent.includes('専用設定'));
  st.querySelector('[data-act="reset"]').click(); await sleep(30);
  assert.equal(env.vim.active, true);

  env.vim.openSettings(); await sleep(20);
  st = d.querySelector('.vim-ov');
  st.querySelector('[data-k="customCSS"]').value = ':root{--vim-cursor:red}';
  st.querySelector('[data-k="theme"]').value = 'dark';
  st.querySelector('[data-act="save"]').click(); await sleep(30);
  const css = d.getElementById('vim-custom-css');
  assert.ok(css && css.textContent.includes('red'));
  assert.equal(d.head.lastElementChild, css);
  assert.ok(d.getElementById('vim-vars').textContent.includes('#1a1a2e'));

  env.vim.openSettings(); await sleep(20);
  st = d.querySelector('.vim-ov');
  st.querySelector('[data-k="keymap"]').value = 'nnoremap H 0\nthis is not a map';
  st.querySelector('[data-act="save"]').click(); await sleep(20);
  assert.ok(d.querySelector('.vim-ov'), 'invalid keymap keeps the dialog open');
  assert.match(st.querySelector('[data-role="keymap-err"]').textContent, /2/);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.deepEqual(env.errors, []);
  env.close();
});

test('project switch reloads that project\'s settings', async () => {
  const env = await makeEnv().boot();
  env.window.localStorage.setItem('cosense-vim:project:other', JSON.stringify({ enabled: false }));
  env.window.cosense.Project.name = 'other'; env.fire('page:changed'); await sleep(20);
  assert.equal(env.vim.active, false);
  env.window.cosense.Project.name = 'proj'; env.fire('page:changed'); await sleep(300);
  assert.equal(env.vim.active, true);
  env.close();
});
