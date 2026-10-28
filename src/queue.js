// Async command lock + key queue.
// Keys typed while a multi-step command runs are queued and replayed in order,
// so e.g. "dd" followed quickly by "j" never interleaves.
import { rt, queue, state } from './state.js';
import { LOG } from './util.js';
import { layout } from './env.js';
import { focused, vimInsert, dkRaw } from './dom.js';
import { flash, setBusyMark } from './ui.js';
import { processFake } from './keys.js';
import { execCmd } from './cmdline.js';
import { onInsertText } from './repeat.js';

export function run(fn) {
  rt.busy++;
  if (rt.busy === 1) { clearTimeout(rt.busyTimer); rt.busyTimer = setTimeout(() => setBusyMark(true), 250); }
  let p;
  try { p = Promise.resolve(fn()); } catch (err) { p = Promise.reject(err); }
  p.catch(err => { console.error(LOG, err); flash('Error: ' + ((err && err.message) || err)); })
    .finally(() => {
      if (--rt.busy === 0) { clearTimeout(rt.busyTimer); setBusyMark(false); drain(); }
    });
}

// A replayable copy of a keyboard event
export function snap(e, extra) {
  return {
    key: e.key, code: e.code, keyCode: e.keyCode,
    ctrlKey: !!e.ctrlKey, altKey: !!e.altKey, shiftKey: !!e.shiftKey, metaKey: !!e.metaKey,
    isComposing: false, _fake: true, _blocked: false, _noremap: !!(extra && extra.noremap),
    preventDefault() { this._blocked = true; }, stopPropagation() {}, stopImmediatePropagation() {},
  };
}
export function fakeKey(key, opts) {
  opts = opts || {};
  return snap({ key, code: '', keyCode: 0, ctrlKey: !!opts.ctrlKey, shiftKey: key.length === 1 && key !== key.toLowerCase() }, opts);
}

// A queued key that no handler consumed: give it to cosense
export function replayNative(ev) {
  if (state.mode === 'insert' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && Array.from(ev.key).length === 1) {
    vimInsert(ev.key); onInsertText(ev.key); return;
  }
  dkRaw(ev.key, { code: ev.code, keyCode: ev.keyCode, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey });
}

export function enqueue(evs) { queue.push(...evs); if (!rt.busy) drain(); }

export function drain() {
  while (rt.busy === 0 && queue.length) {
    const ev = queue.shift();
    if (ev._end) { ev._end(); continue; }
    if (!rt.active || !focused() || layout() !== 'page') { abortQueue(); return; }
    if (ev._insert != null) { vimInsert(ev._insert); continue; }
    if (ev._ex != null) { execCmd(ev._ex); continue; }
    processFake(ev);
  }
}
export function abortQueue() {
  for (const ev of queue) if (ev._end) ev._end();
  queue.length = 0;
  rt.replaying = false;
}
