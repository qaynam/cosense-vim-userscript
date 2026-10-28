// Editor DOM access, synthetic input, readOnly (IME guard), clipboard.
import { VIM, state, rt } from './state.js';
import { cfg } from './settings.js';
import { layout, pageLines, lineChars } from './env.js';
import { norm } from './util.js';

const $ = s => document.querySelector(s);
export { $ };

// NOTE: '.editor .line' also matches the hidden measuring line in #compute-line.
// Only direct children of .lines are real lines (index matches cosense.Page.lines).
export const edLines = () => document.querySelectorAll('.editor .lines > .line');
export const edCurLine = () => document.querySelector('.editor .lines > .line.cursor-line');
export const lineCount = () => edLines().length;

let _ti = null;
export function ti() { if (!_ti || !_ti.isConnected) _ti = document.getElementById('text-input'); return _ti; }
export function resetTextareaCache() { _ti = null; }
export function focused() { const t = ti(); return !!t && document.activeElement === t; }
export function focus() { const t = ti(); if (t) t.focus(); }

// ---- readOnly (IME guard) ----
export function wantRO() { return rt.active && cfg.imeGuard && state.mode !== 'insert' && layout() === 'page'; }
export function syncRO() {
  const t = ti(); if (!t || !cfg.imeGuard || rt.roLift) return;
  const w = wantRO(); if (t.readOnly !== w) t.readOnly = w;
}
export function withRW(fn) {
  const t = ti(); rt.roLift++;
  if (cfg.imeGuard && t && t.readOnly) t.readOnly = false;
  try { return fn(); } finally { rt.roLift--; if (!rt.roLift) syncRO(); }
}

// ---- synthetic key events ----
const KM = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Enter: 13, Escape: 27, Tab: 9, Home: 36, End: 35 };
function mkEv(key, o) {
  o = o || {};
  const letter = /^[a-z]$/i.test(key);
  return new KeyboardEvent('keydown', {
    key,
    code: o.code || (KM[key] ? key : letter ? 'Key' + key.toUpperCase() : /^\d$/.test(key) ? 'Digit' + key : ''),
    keyCode: o.keyCode || KM[key] || (letter ? key.toUpperCase().charCodeAt(0) : key.charCodeAt(0)),
    bubbles: true, cancelable: true,
    ctrlKey: !!o.ctrlKey, altKey: !!o.altKey, metaKey: !!o.metaKey, shiftKey: !!o.shiftKey,
  });
}
export function dk(key, o) {
  const el = ti(); if (!el) return;
  const ev = mkEv(key, o); ev[VIM] = true;
  withRW(() => { rt.passthrough = true; try { el.dispatchEvent(ev); } finally { rt.passthrough = false; } });
}
export function dkRaw(key, o) {
  const el = ti(); if (!el) return;
  withRW(() => { rt.passthrough = true; try { el.dispatchEvent(mkEv(key, o)); } finally { rt.passthrough = false; } });
}
export function vimInsert(text) {
  withRW(() => { rt.passthrough = true; try { document.execCommand('insertText', false, text); } finally { rt.passthrough = false; } });
}

// ---- mouse helpers ----
export function clickAt(target, x, y, shift) {
  const o = { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, shiftKey: !!shift };
  target.dispatchEvent(new MouseEvent('mousedown', o));
  target.dispatchEvent(new MouseEvent('mouseup', o));
}
// Click on the FIRST visual row so wrapped lines land on their real start
export function clickLine(el, shift) {
  if (!el) return;
  const t = el.querySelector('.text') || el;
  let r = t.getBoundingClientRect();
  if (r.height && (r.bottom < 0 || r.top > window.innerHeight)) { el.scrollIntoView({ block: 'nearest' }); r = t.getBoundingClientRect(); }
  clickAt(t, r.left + 4, r.top + Math.min(r.height / 2, 10), shift);
}
export function jumpToLine(idx) { const ls = edLines(); if (ls.length) clickLine(ls[Math.max(0, Math.min(idx, ls.length - 1))], false); }
export function selectToLine(idx) { const ls = edLines(); if (ls.length) clickLine(ls[Math.max(0, Math.min(idx, ls.length - 1))], true); }

// ---- line helpers ----
export function curLineIdx() { const cl = edCurLine(); if (!cl) return 0; const i = Array.prototype.indexOf.call(edLines(), cl); return i < 0 ? 0 : i; }
export const isEmptyLine = el => !!el?.querySelector('br.empty-char-index');
export const lineIdOf = el => (el?.id?.[0] === 'L' ? el.id.slice(1) : el?.id);
export function lineIdxById(id) {
  const el = document.getElementById('L' + id); if (!el) return -1;
  return Array.prototype.indexOf.call(edLines(), el);
}
export function readLineTexts(fr, to) {
  const lines = pageLines(); const els = edLines();
  const map = new Map(); for (const l of lines) map.set(l.id, l.text);
  const buf = [];
  for (let i = fr; i <= to; i++) buf.push(map.get(lineIdOf(els[i])) ?? lines[i]?.text ?? '');
  return buf;
}
export function findEmptyLine(from, dir) {
  const ls = pageLines(); if (!ls.length) return from;
  let i = from + dir;
  while (i >= 0 && i < ls.length && ls[i].text.trim() === '') i += dir;
  while (i >= 0 && i < ls.length && ls[i].text.trim() !== '') i += dir;
  return Math.max(0, Math.min(i, ls.length - 1));
}
// :N / {N}G — 1 is the first line after the title
export function contentLineToIdx(num) {
  const ls = edLines(); if (!ls.length) return 0;
  num = Math.max(1, num); let n = 0;
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].classList.contains('line-title')) n++;
    if (n === num) return i;
  }
  return ls.length - 1;
}

// Column of the cursor in the current line (index into Array.from(text))
export function cursorCol() {
  const cl = edCurLine(); const cur = document.querySelector('.cursor');
  if (!cl || !cur || isEmptyLine(cl)) return 0;
  const c = cur.getBoundingClientRect(); const cy = c.top + c.height / 2;
  let lastOnRow = -1;
  for (const s of cl.querySelectorAll('.char-index')) {
    const r = s.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (cy < r.top || cy > r.bottom) continue;
    const idx = +s.dataset.charIndex;
    if (Math.abs(r.left - c.left) < 1.5) return idx;
    if (r.left < c.left) lastOnRow = idx;
  }
  return lastOnRow + 1;
}
export function cursorAtEOL() {
  const cl = edCurLine(); if (!cl || isEmptyLine(cl)) return true;
  return cursorCol() >= lineChars(curLineIdx()).length;
}

// ---- selection / clipboard ----
export function selText() {
  const s = (window.getSelection && window.getSelection().toString()) || '';
  if (s) return s;
  const t = ti();
  if (t && t.selectionStart !== t.selectionEnd) return t.value.slice(t.selectionStart, t.selectionEnd);
  return '';
}
export const hasSel = () => selText().length > 0;
export async function toClip(t) { if (!cfg.systemClipboard) return; try { await navigator.clipboard.writeText(t); } catch (_) { /* denied */ } }
export async function fromClip() { if (!cfg.systemClipboard) return ''; try { return (await navigator.clipboard.readText()) || ''; } catch (_) { return ''; } }
export function setYank(text, type) { state.yankReg = norm(text); state.yankType = type; return toClip(state.yankReg); }
export async function readPasteSource() {
  const clip = norm(await fromClip());
  const text = clip || state.yankReg;
  const type = text === state.yankReg ? state.yankType : (text.includes('\n') ? 'line' : 'char');
  return { text, type };
}
