// /pattern ?pattern n N * #  — plain-text search over the page lines (smartcase, wraps around)
import { pageLines, lineChars } from './env.js';
import { curLineIdx, cursorCol } from './dom.js';
import { flash } from './ui.js';
import { run } from './queue.js';
import { gotoPos } from './motions.js';
import { textObjectIn } from './textobj.js';

const last = { pattern: '', dir: 1 };
const charLen = s => Array.from(s).length;
const unitOf = (s, charIdx) => Array.from(s).slice(0, Math.max(0, charIdx)).join('').length;

// Pure: next match of `pattern` from (L, c) in direction dir. texts: array of line strings.
// Returns { L, c, wrapped } (c = char index) or null.
export function findInLines(texts, L, c, pattern, dir) {
  if (!pattern || !texts.length) return null;
  const ci = !/[A-Z]/.test(pattern);
  const needle = ci ? pattern.toLowerCase() : pattern;
  const n = texts.length;
  for (let k = 0; k <= n; k++) {
    const li = (((L + dir * k) % n) + n) % n;
    const text = ci ? texts[li].toLowerCase() : texts[li];
    const wrapped = dir > 0 ? (li < L || (k === n)) : (li > L || (k === n));
    if (dir > 0) {
      const from = k === 0 ? unitOf(text, c + 1) : 0;
      const u = text.indexOf(needle, from);
      if (u >= 0 && (k < n || u <= unitOf(text, c))) return { L: li, c: charLen(text.slice(0, u)), wrapped };
    } else {
      const curU = unitOf(text, c);
      const u = k === 0 ? (curU > 0 ? text.lastIndexOf(needle, curU - 1) : -1) : text.lastIndexOf(needle);
      if (u >= 0 && (k < n || u >= curU)) return { L: li, c: charLen(text.slice(0, u)), wrapped };
    }
  }
  return null;
}

function jumpNext(dir, count) {
  const texts = pageLines().map(l => l.text);
  let L = curLineIdx(), c = cursorCol(), hit = null, wrapped = false;
  for (let i = 0; i < Math.max(1, count); i++) {
    const r = findInLines(texts, L, c, last.pattern, dir);
    if (!r) break;
    hit = r; wrapped = wrapped || r.wrapped; L = r.L; c = r.c;
  }
  if (!hit) { flash('E486: Pattern not found: ' + last.pattern); return; }
  run(() => gotoPos(hit.L, hit.c));
  const p = (last.dir > 0 ? '/' : '?') + last.pattern;
  flash(wrapped ? (dir > 0 ? 'search hit BOTTOM, continuing at TOP  ' : 'search hit TOP, continuing at BOTTOM  ') + p : p);
}

export function search(pattern, dir) {
  if (pattern) last.pattern = pattern;
  if (!last.pattern) { flash('E35: No previous regular expression'); return; }
  last.dir = dir;
  jumpNext(dir, 1);
}
export function searchNext(sameDir, count) {
  if (!last.pattern) { flash('E35: No previous regular expression'); return; }
  jumpNext(sameDir ? last.dir : -last.dir, count);
}
// * / # : the word under the cursor
export function searchWord(dir) {
  const chars = lineChars(curLineIdx());
  const r = textObjectIn(chars, cursorCol(), 'iw');
  const word = r ? chars.slice(r.start, r.end).join('') : '';
  if (!word.trim()) { flash('E348: No string under cursor'); return; }
  last.pattern = word; last.dir = dir;
  jumpNext(dir, 1);
}
