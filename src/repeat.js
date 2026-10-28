// "." — repeat the last change.
// Normal-mode changes are stored as the keys that produced them. Changes that
// enter insert mode also remember the text typed until Esc (best effort).
import { rt } from './state.js';
import { flash } from './ui.js';
import { enqueue, fakeKey } from './queue.js';

let lastChange = null;   // { keys: string, text: string|null }
let rec = null;          // change that entered insert mode, collecting typed text

export function recordChange(keys, entersInsert) {
  if (rt.replaying) return;
  if (entersInsert) rec = { keys, text: '' };
  else { lastChange = { keys, text: null }; rec = null; }
}
export function onInsertText(text) { if (rec && text) rec.text += text; }
export function onInsertBackspace() { if (rec) rec.text = Array.from(rec.text).slice(0, -1).join(''); }
export function onLeaveInsert() { if (rec) { lastChange = { keys: rec.keys, text: rec.text }; rec = null; } }
export function cancelRecording() { rec = null; }
export function getLastChange() { return lastChange; }

export function repeatLast(count, explicit) {
  if (!lastChange) { flash('E35: 繰り返す変更がありません'); return; }
  let keys = lastChange.keys;
  if (explicit) keys = String(count) + keys.replace(/^\d+/, '');   // vim: a count replaces the original one
  const evs = Array.from(keys).map(k => fakeKey(k, { noremap: true }));
  if (lastChange.text != null) evs.push({ _insert: lastChange.text }, fakeKey('Escape', { noremap: true }));
  rt.replaying = true;
  evs.push({ _end: () => { rt.replaying = false; } });
  enqueue(evs);
}
