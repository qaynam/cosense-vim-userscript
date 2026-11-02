// gd on images and the image preview
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
