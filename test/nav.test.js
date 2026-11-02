// gd on images, the image preview, and line links ([page#lineId] → cursor on that line)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, sleep, charSpans } from './helpers.js';
import { fakeCosense } from './fake-cosense.js';

const IMG = 'https://example.com/a.png';
const chars = Array.from('[' + IMG + ']');
const imageChars = `<span class="image">${charSpans(chars.join(''))}</span>`;
const preview = '<span class="modal-image"><a href="' + IMG + '"><img class="image" src="data:,"></a></span>';

for (const [name, html] of [['newer cosense: preview after the chars', imageChars + preview], ['older cosense: preview before the chars', preview + imageChars]]) {
  test(`gd on an image opens the preview (${name})`, async () => {
    const env = makeEnv({ lines: ['t', chars.join(''), 'x'], cursor: 1, lineHtml: { 1: html } });
    const m = fakeCosense(env);
    await env.boot();
    m.set(1, 5);
    let clicked = 0;
    env.document.querySelector('.modal-image img').addEventListener('click', () => clicked++);
    await env.type(['g', 'd'], 5);
    assert.equal(clicked, 1);
    assert.deepEqual(env.errors, []);
    env.close();
  });
}

test('q closes the preview when cosense renders it as a native <dialog>', async () => {
  const env = await makeEnv().boot();
  const d = env.document.createElement('dialog');
  d.className = 'modal fade in full-content-modal';
  let cancelled = 0;
  d.addEventListener('cancel', () => { cancelled++; d.remove(); });
  env.document.body.appendChild(d);
  env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }));
  await sleep(150);
  assert.equal(cancelled, 1);
  assert.equal(env.document.querySelector('.full-content-modal'), null);
  assert.equal(env.vim.state.mode, 'normal');
  env.close();
});

const hex = i => (i.toString(16).padStart(2, '0')).repeat(12);
const ids = Array.from({ length: 12 }, (_, i) => hex(i + 1));
const page = ['title', ...Array.from({ length: 11 }, (_, i) => 'line ' + (i + 1))];

test('opening a page whose URL ends with #lineId puts the cursor on that line', async () => {
  const env = makeEnv({ lines: page, cursor: 2, ids, hash: '#' + ids[8] });
  const m = fakeCosense(env);
  await env.boot();
  await sleep(500);
  assert.equal(m.cur.L, 8);
  env.close();
});

test('page:changed to a line link (another page) moves the cursor there', async () => {
  const env = makeEnv({ lines: page, cursor: 2, ids });
  const m = fakeCosense(env);
  await env.boot(); await sleep(400);
  m.set(2, 0);
  env.window.history.pushState(null, '', '/proj/other#' + ids[6]);
  env.fire('page:changed');
  await sleep(500);
  assert.equal(m.cur.L, 6);
  env.close();
});

test('gd on a link to a line of the same page puts the cursor there right away', async () => {
  const linkText = '[x#' + ids[9] + ']';
  const html = `<a class="page-link" href="/proj/page#${ids[9]}">${charSpans(linkText)}</a>`;
  const lines = [...page.slice(0, 11), linkText];
  const env = makeEnv({ lines, cursor: 11, ids, lineHtml: { 11: html } });
  const m = fakeCosense(env);
  await env.boot(); await sleep(300);
  m.set(11, 3);
  await env.type(['g', 'd'], 5);
  await sleep(200);
  assert.equal(m.cur.L, 9);
  assert.deepEqual(env.errors, []);
  env.close();
});
