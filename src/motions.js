// Cursor motions, word / char-find computation, scrolling.
import { lineChars, lastLine } from './env.js';
import {
  $, dk, dkRaw, edLines, edCurLine, lineCount, curLineIdx, cursorCol, jumpToLine, selectToLine,
  findEmptyLine, contentLineToIdx, hasSel,
} from './dom.js';
import { wait } from './util.js';

export const moveH = () => dk('ArrowLeft');
export const moveJ = () => dk('ArrowDown');
export const moveK = () => dk('ArrowUp');
export const moveL = () => dk('ArrowRight');
export const move0 = () => dk('a', { ctrlKey: true, code: 'KeyA', keyCode: 65 });
export const move$ = () => dk('e', { ctrlKey: true, code: 'KeyE', keyCode: 69 });
export const moveGG = () => dk('ArrowUp', { metaKey: true });
export const moveGEnd = () => dk('ArrowDown', { metaKey: true });
export const moveLineUp = () => dkRaw('ArrowUp', { altKey: true, code: 'ArrowUp', keyCode: 38 });
export const moveLineDown = () => dkRaw('ArrowDown', { altKey: true, code: 'ArrowDown', keyCode: 40 });
export const indentRight = () => dk('ArrowRight', { ctrlKey: true, code: 'ArrowRight', keyCode: 39 });
export const indentLeft = () => dk('ArrowLeft', { ctrlKey: true, code: 'ArrowLeft', keyCode: 37 });

export function pressArrows(delta, shift) {
  const key = delta > 0 ? 'ArrowRight' : 'ArrowLeft';
  const n = Math.min(Math.abs(delta), 5000);
  for (let i = 0; i < n; i++) dk(key, shift ? { shiftKey: true } : undefined);
}
// Move the cursor to (line, col). Collapses any selection first.
export async function gotoPos(L, c) {
  if (hasSel()) dk('ArrowLeft');
  if (curLineIdx() !== L) { jumpToLine(L); await wait(20); }
  move0();
  pressArrows(Math.min(c, lineChars(L).length), false);
}

// ---- word motions ----
// Cosense maps both Alt+Arrow and Ctrl+Arrow to indent, so words are computed
// from the line text and the cursor is moved with plain arrow keys.
export function charClass(ch, big) {
  if (ch === undefined) return -1;
  if (/\s/.test(ch) || ch === '　') return 0;
  if (big) return 1;
  const c = ch.codePointAt(0);
  if (/[A-Za-z0-9_]/.test(ch) || (c >= 0xC0 && c <= 0x24F) || (c >= 0xFF10 && c <= 0xFF19) || (c >= 0xFF21 && c <= 0xFF5A)) return 1;
  if (c >= 0x3040 && c <= 0x309F) return 3;                                   // hiragana
  if ((c >= 0x30A0 && c <= 0x30FF) || (c >= 0xFF66 && c <= 0xFF9F)) return 4; // katakana
  if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || ch === '々') return 5; // kanji
  if (c < 0x80 || (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF00 && c <= 0xFF65)) return 2;    // punctuation
  return 1;
}
// getChars(L) → Array of chars of line L; last = index of last line (pure, testable)
export function stepW(pos, big, getChars = lineChars, last = lastLine()) {
  let { L, c } = pos; let ch = getChars(L);
  if (c < ch.length) {
    const k = charClass(ch[c], big);
    if (k !== 0) while (c < ch.length && charClass(ch[c], big) === k) c++;
    while (c < ch.length && charClass(ch[c], big) === 0) c++;
    if (c < ch.length) return { L, c };
  }
  while (L < last) {
    L++; ch = getChars(L); c = 0;
    if (!ch.length) return { L, c };
    while (c < ch.length && charClass(ch[c], big) === 0) c++;
    if (c < ch.length) return { L, c };
  }
  return { L, c: ch.length };
}
export function stepE(pos, big, getChars = lineChars, last = lastLine()) {
  let { L, c } = pos; let ch = getChars(L);
  c++;
  for (;;) {
    while (c < ch.length && charClass(ch[c], big) === 0) c++;
    if (c < ch.length) break;
    if (L >= last) return { L, c: Math.max(0, ch.length - 1) };
    L++; ch = getChars(L); c = 0;
  }
  const k = charClass(ch[c], big);
  while (c + 1 < ch.length && charClass(ch[c + 1], big) === k) c++;
  return { L, c };
}
export function stepB(pos, big, getChars = lineChars) {
  let { L, c } = pos; let ch = getChars(L);
  c--;
  for (;;) {
    while (c >= 0 && charClass(ch[c], big) === 0) c--;
    if (c >= 0) break;
    if (L <= 0) return { L, c: 0 };
    L--; ch = getChars(L); c = ch.length - 1;
    if (!ch.length) return { L, c: 0 };
  }
  const k = charClass(ch[c], big);
  while (c > 0 && charClass(ch[c - 1], big) === k) c--;
  return { L, c };
}
// number of plain arrow presses from a to b (ArrowRight at EOL goes to the next line start)
export function arrowDelta(a, b, getChars = lineChars) {
  if (a.L === b.L) return b.c - a.c;
  const len = i => getChars(i).length;
  if (b.L > a.L) { let d = len(a.L) - a.c + 1; for (let i = a.L + 1; i < b.L; i++) d += len(i) + 1; return d + b.c; }
  let d = a.c + 1; for (let i = b.L + 1; i < a.L; i++) d += len(i) + 1; return -(d + len(b.L) - b.c);
}
function wordTarget(kind, count, forOp) {
  const big = kind === kind.toUpperCase();
  const k = kind.toLowerCase();
  const start = { L: curLineIdx(), c: cursorCol() };
  let pos = start;
  for (let i = 0; i < count; i++) pos = k === 'w' ? stepW(pos, big) : k === 'e' ? stepE(pos, big) : stepB(pos, big);
  if (forOp && k === 'w' && pos.L > start.L) pos = { L: start.L, c: lineChars(start.L).length }; // dw stops at EOL
  if (forOp && k === 'e') pos = { L: pos.L, c: Math.min(pos.c + 1, lineChars(pos.L).length) };   // e is inclusive
  return { start, pos };
}
export function wordMotion(kind, count, select, forOp) {
  const { start, pos } = wordTarget(kind, count, forOp || select);
  pressArrows(arrowDelta(start, pos), select);
}

// ---- f / t / F / T and ; , ----
export const lastFind = { kind: '', ch: '' };
const INVERT = { f: 'F', F: 'f', t: 'T', T: 't' };
// Pure: returns the target column or -1. inclusive=true moves one past forward targets (operators / visual)
export function findCharIn(chars, col, kind, ch, count, inclusive, repeat) {
  let n = Math.max(1, count);
  if (kind === 'f' || kind === 't') {
    const start = col + 1 + (repeat && kind === 't' ? 1 : 0);
    for (let j = start; j < chars.length; j++) {
      if (chars[j] === ch && --n === 0) { const t = kind === 'f' ? j : j - 1; return inclusive ? t + 1 : t; }
    }
    return -1;
  }
  const start = col - 1 - (repeat && kind === 'T' ? 1 : 0);
  for (let j = start; j >= 0; j--) {
    if (chars[j] === ch && --n === 0) return kind === 'F' ? j : j + 1;
  }
  return -1;
}
// Resolve f/t/F/T/;/, to a column on the current line (-1 = not found)
export function findTarget(kind, ch, count, inclusive) {
  let repeat = false;
  if (kind === ';' || kind === ',') {
    if (!lastFind.kind) return -1;
    repeat = true; ch = lastFind.ch;
    kind = kind === ';' ? lastFind.kind : INVERT[lastFind.kind];
  } else { lastFind.kind = kind; lastFind.ch = ch; }
  const backward = kind === 'F' || kind === 'T';
  return findCharIn(lineChars(curLineIdx()), cursorCol(), kind, ch, count, inclusive && !backward, repeat);
}
export function findMotion(kind, ch, count, select) {
  const t = findTarget(kind, ch, count, select);
  if (t < 0) return false;
  pressArrows(t - cursorCol(), select);
  return true;
}

// ---- screen-relative lines (H M L) ----
function headerBottom() {
  const nav = document.querySelector('.navbar');
  return nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
}
export function visibleRange() {
  const els = edLines(); const top = headerBottom(); const bottom = window.innerHeight - 26;
  let first = -1, last = -1;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (r.bottom <= top) continue;
    if (r.top >= bottom) break;
    if (first < 0 && r.top >= top - 1) first = i;
    if (r.bottom <= bottom + 1) last = i;
  }
  const cur = curLineIdx();
  return [first < 0 ? cur : first, last < 0 ? cur : last];
}
export function screenLine(key, count) {
  const [first, last] = visibleRange();
  if (key === 'H') return Math.min(first + count - 1, last);
  if (key === 'L') return Math.max(last - count + 1, first);
  return Math.floor((first + last) / 2);
}

// ---- generic motion dispatch (normal mode) ----
export function doMotion(key, count, explicit, ch) {
  switch (key) {
    case 'G': if (explicit) jumpToLine(contentLineToIdx(count)); else moveGEnd(); return;
    case '{': case '}': { let i = curLineIdx(); for (let c = 0; c < count; c++) i = findEmptyLine(i, key === '{' ? -1 : 1); jumpToLine(i); return; }
    case 'j': case 'k': if (count > 1) { jumpToLine(curLineIdx() + (key === 'j' ? count : -count)); return; } break;
    case '0': case '^': move0(); return;
    case '$': move$(); return;
    case 'H': case 'M': case 'L': jumpToLine(screenLine(key, count)); return;
    case 'w': case 'W': case 'e': case 'E': case 'b': case 'B': wordMotion(key, count, false, false); return;
    case 'f': case 't': case 'F': case 'T': case ';': case ',': findMotion(key, ch, count, false); return;
  }
  for (let i = 0; i < count; i++) {
    switch (key) { case 'h': moveH(); break; case 'j': moveJ(); break; case 'k': moveK(); break; case 'l': moveL(); break; }
  }
}
// Extend the selection (visual / operators). Shift+Arrow keeps the anchor fixed.
export function doSelMotion(key, count, ch) {
  switch (key) {
    case '0': case '^': dk('ArrowLeft', { metaKey: true, shiftKey: true }); return;
    case '$': dk('ArrowRight', { metaKey: true, shiftKey: true }); return;
    case 'w': case 'W': case 'e': case 'E': case 'b': case 'B': wordMotion(key, count, true, false); return;
    case 'f': case 't': case 'F': case 'T': case ';': case ',': findMotion(key, ch, count, true); return;
    case 'H': case 'M': case 'L': extendSelToLine(screenLine(key, count)); return;
    case '{': case '}': { let i = curLineIdx(); for (let c = 0; c < count; c++) i = findEmptyLine(i, key === '{' ? -1 : 1); extendSelToLine(i); return; }
  }
  const map = { h: 'ArrowLeft', j: 'ArrowDown', k: 'ArrowUp', l: 'ArrowRight' };
  if (map[key]) for (let i = 0; i < count; i++) dk(map[key], { shiftKey: true });
}
// Shift+Arrow until the cursor line reaches target (robust against wrapped lines)
export function extendSelToLine(target) {
  target = Math.max(0, Math.min(target, lineCount() - 1));
  for (let round = 0; round < 10; round++) {
    const cur = curLineIdx(); const d = target - cur;
    if (!d) return;
    const key = d > 0 ? 'ArrowDown' : 'ArrowUp';
    for (let i = 0, n = Math.min(Math.abs(d), 300); i < n; i++) dk(key, { shiftKey: true });
    if (curLineIdx() === cur) return;   // no progress (document edge)
  }
}
export function selectToEdge(dir) {
  const target = dir < 0 ? 0 : lineCount() - 1;
  dk(dir < 0 ? 'ArrowUp' : 'ArrowDown', { metaKey: true, shiftKey: true });
  if (curLineIdx() !== target) selectToLine(target);   // fallback: shift-click
}

// ---- scrolling ----
export function halfScroll(dir) {
  const se = document.scrollingElement || document.documentElement;
  const half = window.innerHeight >> 1;
  if (dir > 0 && se.scrollTop >= se.scrollHeight - se.clientHeight - 1) return;
  if (dir < 0 && se.scrollTop <= 0) return;
  const cel = $('.cursor');
  const screenY = cel ? cel.getBoundingClientRect().top + cel.getBoundingClientRect().height / 2 : window.innerHeight / 2;
  window.scrollBy({ top: dir * half, behavior: 'instant' });
  const wantScroll = se.scrollTop;
  const ls = edLines();
  let best = 0, bd = Infinity;
  for (let i = 0; i < ls.length; i++) {
    const mid = ls[i].getBoundingClientRect().top + ls[i].offsetHeight / 2;
    const d = Math.abs(mid - screenY);
    if (d < bd) { bd = d; best = i; } else if (d > bd + 100) break;
  }
  jumpToLine(best);
  se.scrollTop = wantScroll;
  let f = 0;
  const iv = setInterval(() => { se.scrollTop = wantScroll; if (++f >= 6) clearInterval(iv); }, 30);
}
// CTRL-E / CTRL-Y: one line, cursor stays ~3 lines from the edge
export function lineScroll(dir) {
  const cl = edCurLine(); if (!cl) return;
  const lh = cl.offsetHeight || 36;
  window.scrollBy({ top: dir * lh, behavior: 'instant' });
  requestAnimationFrame(() => {
    const cur = edCurLine(); if (!cur) return;
    const cr = cur.getBoundingClientRect(); const edge = lh * 3;
    if (dir > 0 && cr.top < edge) moveJ();
    else if (dir < 0 && cr.bottom > window.innerHeight - edge) moveK();
  });
}
// zz / zt / zb
export function scrollCursorTo(where) {
  const cl = edCurLine(); if (!cl) return;
  const r = cl.getBoundingClientRect();
  const top = headerBottom() + 8, bottom = window.innerHeight - 34;
  const delta = where === 't' ? r.top - top : where === 'b' ? r.bottom - bottom : r.top - window.innerHeight / 2 + r.height / 2;
  window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
}
