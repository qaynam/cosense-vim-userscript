// Text objects: iw aw iW aW  i[ a[  i( a(  i{ a{  i" a"  i' a'  i` a`
// Cosense lines are single lines, so objects never span lines.
import { lineChars } from './env.js';
import { curLineIdx, cursorCol, hasSel, dk } from './dom.js';
import { charClass, pressArrows } from './motions.js';

const PAIRS = {
  '(': ['(', ')'], ')': ['(', ')'], b: ['(', ')'],
  '[': ['[', ']'], ']': ['[', ']'],
  '{': ['{', '}'], '}': ['{', '}'], B: ['{', '}'],
  '<': ['<', '>'], '>': ['<', '>'],
};
const QUOTES = new Set(['"', "'", '`']);
export const TEXTOBJ_CHARS = new Set(['w', 'W', ...Object.keys(PAIRS), ...QUOTES]);

function wordObj(chars, col, around, big, count) {
  const cls = i => charClass(chars[i], big);
  const k = cls(col);
  let s = col, e = col;
  while (s > 0 && cls(s - 1) === k) s--;
  while (e < chars.length && cls(e) === k) e++;
  for (let n = 1; n < count; n++) { const k2 = cls(e); while (e < chars.length && cls(e) === k2) e++; }
  if (around) {
    if (k !== 0) {
      let e2 = e; while (e2 < chars.length && cls(e2) === 0) e2++;
      if (e2 > e) e = e2; else while (s > 0 && cls(s - 1) === 0) s--;   // no trailing space: take leading
    } else {
      const k2 = cls(e); while (e < chars.length && cls(e) === k2) e++;  // aw on blanks: blanks + next word
    }
  }
  return { start: s, end: e };
}
function enclosing(chars, col, open, close) {
  let depth = 0, s = -1;
  for (let i = col; i >= 0; i--) {
    if (chars[i] === close && i !== col) depth++;
    else if (chars[i] === open) { if (depth === 0) { s = i; break; } depth--; }
  }
  if (s < 0) return null;
  depth = 0;
  for (let j = s + 1; j < chars.length; j++) {
    if (chars[j] === open) depth++;
    else if (chars[j] === close) { if (depth === 0) return [s, j]; depth--; }
  }
  return null;
}
function pairObj(chars, col, [open, close], around, count) {
  let r = enclosing(chars, col, open, close);
  if (!r) {   // not inside: use the next pair on the line (like targets.vim)
    const nx = chars.indexOf(open, col);
    if (nx < 0) return null;
    r = enclosing(chars, nx, open, close);
    if (!r) return null;
  }
  for (let n = 1; n < count && r[0] > 0; n++) { const o = enclosing(chars, r[0] - 1, open, close); if (!o) break; r = o; }
  return around ? { start: r[0], end: r[1] + 1 } : { start: r[0] + 1, end: r[1] };
}
function quoteObj(chars, col, q, around) {
  const idx = []; chars.forEach((c, i) => { if (c === q) idx.push(i); });
  const pick = (a, b) => {
    if (!around) return { start: a + 1, end: b };
    let e = b + 1; while (e < chars.length && /\s/.test(chars[e])) e++;
    return { start: a, end: e };
  };
  for (let p = 0; p + 1 < idx.length; p += 2) if (col >= idx[p] && col <= idx[p + 1]) return pick(idx[p], idx[p + 1]);
  for (let p = 0; p + 1 < idx.length; p += 2) if (idx[p] > col) return pick(idx[p], idx[p + 1]);
  return null;
}

// Pure: range [start, end) of text object `obj` ("iw", "a[", ...) in chars around col, or null
export function textObjectIn(chars, col, obj, count = 1) {
  if (!chars.length) return null;
  const around = obj[0] === 'a'; const ch = obj[1];
  col = Math.max(0, Math.min(col, chars.length - 1));
  if (ch === 'w' || ch === 'W') return wordObj(chars, col, around, ch === 'W', count);
  if (PAIRS[ch]) return pairObj(chars, col, PAIRS[ch], around, count);
  if (QUOTES.has(ch)) return quoteObj(chars, col, ch, around);
  return null;
}

// Select the object on the current line. Returns false when there is none.
export function selectTextObject(obj, count) {
  if (hasSel()) dk('ArrowLeft');                       // collapse an existing (visual) selection
  const chars = lineChars(curLineIdx());
  const r = textObjectIn(chars, cursorCol(), obj, count);
  if (!r) return false;
  pressArrows(r.start - cursorCol(), false);
  pressArrows(r.end - r.start, true);
  return true;
}
