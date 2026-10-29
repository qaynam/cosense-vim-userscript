// Editing commands: operators, linewise ops, paste, visual / visual-line actions.
import { lineChars } from './env.js';
import {
  $, dk, vimInsert, clickAt, edLines, edCurLine, lineCount, curLineIdx, cursorCol, cursorAtEOL,
  isEmptyLine, jumpToLine, readLineTexts, findEmptyLine, contentLineToIdx, selText, hasSel,
  setYank, readPasteSource, focused, focus,
} from './dom.js';
import { setMode, vlRange, clearVL, updateVL } from './mode.js';
import { flash, busy } from './ui.js';
import { wait, swapCase, norm } from './util.js';
import {
  move0, move$, moveJ, moveK, moveL, indentRight, indentLeft, extendSelToLine, doSelMotion,
  wordMotion, findMotion, screenLine, moveToPos, motionSettled,
} from './motions.js';
import { selectTextObject } from './textobj.js';

export const killEOL = () => dk('k', { ctrlKey: true, code: 'KeyK', keyCode: 75 });
export const undo = () => dk('z', { metaKey: true, code: 'KeyZ', keyCode: 90 });
export const redo = () => dk('z', { metaKey: true, shiftKey: true, code: 'KeyZ', keyCode: 90 });

function flashLines(fr, to) {
  const els = edLines(); const hit = [];
  for (let i = fr; i <= to; i++) if (els[i]) { els[i].classList.add('vim-yf'); hit.push(els[i]); }
  setTimeout(() => hit.forEach(el => el.classList.remove('vim-yf')), 300);
}

// ---- character edits ----
// Select `count` chars forward without crossing the line end
async function selectCharsFwd(count) {
  if (isEmptyLine(edCurLine())) return '';
  const room = Math.max(0, lineChars(curLineIdx()).length - cursorCol());
  const n = Math.min(count, room);
  moveToPos({ L: curLineIdx(), c: cursorCol() + n }, true);
  await motionSettled(); await wait(10);
  const sel = selText();
  if (sel.includes('\n')) { dk('ArrowLeft'); return ''; }   // safety net
  return sel;
}
export async function deleteCharsFwd(count) {
  let sel = await selectCharsFwd(count);
  if (!sel) {
    // at EOL vim's cursor sits on the last char → delete the char before ours
    if (isEmptyLine(edCurLine()) || cursorCol() === 0) return;
    dk('ArrowLeft', { shiftKey: true }); await wait(10);
    sel = selText();
    if (!sel || sel.includes('\n')) { if (sel) dk('ArrowRight'); return; }
  }
  await setYank(sel, 'char');
  dk('Backspace');
}
export async function substituteChars(count) {
  const sel = await selectCharsFwd(count);
  if (sel) { await setYank(sel, 'char'); dk('Backspace'); }
  setMode('insert');
}
export async function replaceChars(ch, count) {
  const sel = await selectCharsFwd(count);
  if (!sel) return;
  vimInsert(ch.repeat(Array.from(sel).length));
  dk('ArrowLeft');
}
export async function toggleCaseN(count) {
  const sel = await selectCharsFwd(count);
  if (sel) vimInsert(swapCase(sel));
}
async function selectToEOL() {
  dk('ArrowRight', { shiftKey: true, metaKey: true });
  await wait(10);
  const s = selText();
  if (s.includes('\n')) { dk('ArrowLeft'); return ''; }
  return s;
}
export async function deleteToEOL() {
  const sel = await selectToEOL();
  if (!sel) return;                 // nothing after the cursor: don't Backspace the previous char
  await setYank(sel, 'char'); dk('Backspace');
}
export async function changeToEOL() {
  const sel = await selectToEOL();
  if (sel) { await setYank(sel, 'char'); dk('Backspace'); }
  setMode('insert');
}
export async function joinLines(count) {
  const times = Math.max(1, count - 1);
  const cursor = $('.cursor');
  const savedX = cursor ? cursor.getBoundingClientRect().left : null;
  const L = curLineIdx(); const to = Math.min(L + times, lineCount() - 1);
  if (to <= L) return;
  // Ctrl+K at EOL joins raw (indent kept), so N joins == replacing "\n…\n…" with the
  // concatenated lines: one selection + one insert instead of 2 renders per line
  if (to - L >= 2 && !(await joinBySelection(L, to))) return;
  if (to - L < 2) {
    for (let i = L; i < to; i++) { move$(); killEOL(); }
  }
  await wait(20);
  if (savedX !== null) {
    const cl = edCurLine();
    if (cl) { const t = cl.querySelector('.text') || cl; const r = t.getBoundingClientRect(); clickAt(t, savedX, r.top + Math.min(r.height / 2, 10)); }
  }
}
async function joinBySelection(L, to) {
  const rest = readLineTexts(L + 1, to);
  move$();
  moveToPos({ L: to, c: lineChars(to).length }, true);
  await motionSettled(); await wait(10);
  if (norm(selText()) !== '\n' + rest.join('\n')) {          // unexpected selection: don't touch the text
    if (hasSel()) dk('ArrowLeft');
    flash('Join failed'); return false;
  }
  vimInsert(rest.join(''));
  return true;
}
export async function openLine(below) {
  if (below) { move$(); await wait(15); dk('Enter'); }
  else { move0(); await wait(15); dk('Enter'); await wait(15); moveK(); }
  await wait(15);
  setMode('insert');
}

// ---- paste ----
export async function paste(after) {
  let { text, type } = await readPasteSource();
  if (!text) { flash('Nothing to paste'); return; }
  if (type === 'line') {
    text = text.replace(/\n$/, '');
    const n = text.split('\n').length;
    if (after) { move$(); await wait(20); vimInsert('\n' + text); }
    else { move0(); await wait(20); vimInsert(text + '\n'); await wait(30); moveK(); }
    flash('Pasted ' + n + 'L');
  } else {
    if (after && !cursorAtEOL()) { moveL(); await wait(10); }
    vimInsert(text);
    flash('Pasted');
  }
}

// ---- line selection ----
// From the start of `fr` to the start of `to+1` (or the end of the page)
async function selectLinesThrough(fr, to) {
  const ls = edLines(); const last = ls.length - 1;
  jumpToLine(fr); await wait(30);
  move0(); await wait(15);
  if (to < last) {
    const el = ls[to + 1].querySelector('.text') || ls[to + 1];
    const r = el.getBoundingClientRect();
    clickAt(el, r.left, r.top + 2, true);
  } else {
    dk('ArrowDown', { metaKey: true, shiftKey: true });
    if (curLineIdx() !== last) { extendSelToLine(last); await motionSettled(); }
    dk('ArrowRight', { metaKey: true, shiftKey: true });
  }
  await wait(30);
  return hasSel();
}
// From the start of `fr` to the end of `to` (no trailing newline)
async function selectLinesInner(fr, to) {
  const ls = edLines();
  jumpToLine(fr); await wait(30);
  move0(); await wait(15);
  if (to - fr > 30) {
    const el = ls[to].querySelector('.text') || ls[to];
    const r = el.getBoundingClientRect();
    clickAt(el, r.right - 2, r.bottom - 4, true);
  } else if (to > fr) { extendSelToLine(to); await motionSettled(); }
  dk('ArrowRight', { metaKey: true, shiftKey: true });
  await wait(30);
  return hasSel();
}
// dd on one line: Ctrl+A, Ctrl+K, Backspace (empty lines: Backspace only)
async function killLineAt(idx) {
  if (curLineIdx() !== idx) { jumpToLine(idx); await wait(20); }
  const cl = edCurLine(); if (!cl) return;
  const total = lineCount();
  if (!isEmptyLine(cl)) { move0(); await wait(10); killEOL(); await wait(10); }
  if (idx === 0) { if (total > 1) { killEOL(); await wait(10); } return; }   // title: pull the next line up
  dk('Backspace'); await wait(20);
  // vim: the cursor lands on the line that took the deleted line's place
  if (idx < total - 1) { moveJ(); move0(); }
  if (!focused()) focus();
}
// Remove lines fr..to. keepEmpty leaves one empty line (for c / S / cc)
async function removeLines(fr, to, keepEmpty) {
  const last = lineCount() - 1;
  if (fr === to && keepEmpty) {
    if (curLineIdx() !== fr) { jumpToLine(fr); await wait(20); }
    move0(); await wait(10);
    if (!isEmptyLine(edCurLine())) killEOL();   // killEOL on an empty line would join the next line
    return true;
  }
  if (!(await selectLinesThrough(fr, to))) { flash('Selection failed'); return false; }
  dk('Backspace'); await wait(30);
  if (to >= last) {
    if (!keepEmpty && fr > 0) { dk('Backspace'); await wait(20); }   // drop the leftover empty line
  } else if (keepEmpty) {
    vimInsert('\n'); await wait(20); moveK();
  }
  return true;
}
export async function linewise(op, fr, to) {
  const last = lineCount() - 1; if (last < 0) return;
  fr = Math.max(0, Math.min(fr, last)); to = Math.max(fr, Math.min(to, last));
  const n = to - fr + 1;
  await setYank(readLineTexts(fr, to).join('\n'), 'line');
  if (op === 'y') { flashLines(fr, to); flash('Yanked ' + n + 'L'); return; }
  if (n > 3) busy((op === 'd' ? 'Deleting ' : 'Changing ') + n + 'L...');
  if (op === 'd') {
    if (n === 1) await killLineAt(fr); else await removeLines(fr, to, false);
    flash('Deleted ' + n + 'L');
  } else {
    await removeLines(fr, to, true);
    if (n > 3) flash('Changed ' + n + 'L');
    setMode('insert');
  }
}
export function linewiseCount(op, n) { const cur = curLineIdx(); return linewise(op, cur, cur + n - 1); }

// ---- operator + motion / text object ----
export async function execOp(op, mot, count, explicit, extra) {
  const cur = curLineIdx();
  if (mot === 'j' || mot === 'k') return linewise(op, mot === 'j' ? cur : cur - count, mot === 'j' ? cur + count : cur);
  if (mot === 'G' || mot === 'gg') {
    const target = explicit ? contentLineToIdx(count) : (mot === 'G' ? lineCount() - 1 : contentLineToIdx(1));
    return linewise(op, Math.min(cur, target), Math.max(cur, target));
  }
  if (mot === 'H' || mot === 'M' || mot === 'L') { const t = screenLine(mot, count); return linewise(op, Math.min(cur, t), Math.max(cur, t)); }
  if (mot === 'obj') {
    if (!selectTextObject(extra, count)) { if (op === 'c') setMode('insert'); return; }
  } else {
    if (op === 'c' && (mot === 'w' || mot === 'W')) mot = mot === 'w' ? 'e' : 'E';   // cw == ce
    if (mot === '{' || mot === '}') {
      let i = cur; for (let c = 0; c < count; c++) i = findEmptyLine(i, mot === '{' ? -1 : 1);
      extendSelToLine(i);
    } else if ('wWeEbB'.includes(mot)) wordMotion(mot, count, true, true);
    else if ('fFtT;,'.includes(mot)) { if (!findMotion(mot, extra, count, true)) return; }
    else doSelMotion(mot, count);
  }
  await motionSettled();
  await wait(20);
  const sel = selText();
  if (!sel) { if (op === 'c') setMode('insert'); return; }   // empty motion: never Backspace blindly
  await setYank(sel, 'char');
  if (op === 'y') { dk('ArrowLeft'); flash('Yanked'); return; }
  dk('Backspace');
  if (op === 'c') setMode('insert'); else flash('Deleted');
}

// ---- visual mode ----
export async function vYank() {
  const t = selText();
  if (t) { await setYank(t, 'char'); dk('ArrowLeft'); flash('Yanked'); }
  setMode('normal');
}
export async function vYankPlain() {
  await wait(50);
  const btn = $('.popup-menu .copy-plain-button');
  if (btn) { btn.click(); flash('Copied plain text'); }
  else { const t = selText(); if (t) await setYank(t, 'char'); flash('Yanked (plain fallback)'); }
  setMode('normal');
}
export async function vDelete() {
  const t = selText();
  if (t) { await setYank(t, 'char'); dk('Backspace'); flash('Deleted'); }
  setMode('normal');
}
export async function vSubst() {
  const t = selText();
  if (t) { await setYank(t, 'char'); dk('Backspace'); }
  setMode('insert');
}
export async function vPaste() {
  const sel = selText();
  const { text } = await readPasteSource();
  if (!text) { flash('Nothing to paste'); setMode('normal'); return; }
  if (sel) { dk('Backspace'); await wait(15); }
  vimInsert(text);
  if (sel) await setYank(sel, 'char');   // neovim: the replaced text goes to the register
  flash('Pasted over'); setMode('normal');
}
export async function vToggleCase() {
  const sel = selText();
  if (sel) { dk('Backspace'); await wait(10); vimInsert(swapCase(sel)); }
  setMode('normal');
}

// ---- visual-line mode ----
export async function vlYank() { const [fr, to] = vlRange(); await linewise('y', fr, to); setMode('normal'); }
export async function vlDelete() { const [fr, to] = vlRange(); clearVL(); await linewise('d', fr, to); setMode('normal'); }
export async function vlChange() { const [fr, to] = vlRange(); clearVL(); await linewise('c', fr, to); }
export async function vlPaste() {
  const [fr, to] = vlRange(); const n = to - fr + 1;
  const old = readLineTexts(fr, to).join('\n');
  let { text } = await readPasteSource();
  text = text.replace(/\n$/, '');
  if (!text) { flash('Nothing to paste'); setMode('normal'); return; }
  clearVL();
  if (n > 3) busy('Pasting over ' + n + 'L...');
  if (await removeLines(fr, to, true)) {   // leaves one empty line at fr with the cursor on it
    vimInsert(text);
    await setYank(old, 'line');
    flash('Pasted over ' + n + 'L');
  }
  setMode('normal');
}
export async function vlYankPlain() {
  const [fr, to] = vlRange();
  clearVL();
  await selectLinesInner(fr, to);
  await wait(60);
  const btn = $('.popup-menu .copy-plain-button');
  if (btn) { btn.click(); flash('Copied plain text'); }
  else { await setYank(readLineTexts(fr, to).join('\n'), 'line'); flash('Yanked (plain fallback)'); }
  setMode('normal');
}
// Indent every selected line; stays in visual-line so > can be repeated
export async function vlIndent(right, count) {
  const [fr, to] = vlRange(); const back = curLineIdx();
  if (fr !== to) { if (!(await selectLinesInner(fr, to))) return; }
  for (let i = 0; i < count; i++) (right ? indentRight : indentLeft)();
  await wait(20);
  if (fr !== to) { jumpToLine(back); await wait(20); }
  updateVL();
}
