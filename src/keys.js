// Key handling: the keydown entry point and the per-mode handlers.
import { VIM, state, rt, queue } from './state.js';
import { layout } from './env.js';
import { $, ti, focused, focus, dk, hasSel, curLineIdx, jumpToLine, contentLineToIdx, cursorAtEOL } from './dom.js';
import { setMode, setModeQuiet, resetBuf, setPending, updateVL } from './mode.js';
import { updateIndicator } from './ui.js';
import { run, snap, replayNative } from './queue.js';
import { mapKey } from './keymap.js';
import { recordChange, repeatLast, onInsertText, onInsertBackspace } from './repeat.js';
import {
  moveL, move0, move$, moveGG, moveGEnd, moveLineUp, moveLineDown, indentRight, indentLeft,
  doMotion, doSelMotion, findMotion, selectToEdge, halfScroll, lineScroll, scrollCursorTo, screenLine,
} from './motions.js';
import { findEmptyLine } from './dom.js';
import {
  undo, redo, deleteCharsFwd, substituteChars, replaceChars, toggleCaseN, deleteToEOL, changeToEOL,
  joinLines, openLine, paste, linewiseCount, execOp, vYank, vYankPlain, vDelete, vSubst, vPaste,
  vToggleCase, vlYank, vlYankPlain, vlDelete, vlPaste, vlChange, vlIndent,
} from './edit.js';
import { TEXTOBJ_CHARS, selectTextObject } from './textobj.js';
import { searchNext, searchWord } from './search.js';
import { setMark, jumpMark } from './marks.js';
import { navGo, followLink } from './nav.js';
import { openCmdLine } from './cmdline.js';
import { isOverlayOpen } from './overlay.js';

// ======================================================================
// Command buffer
// ======================================================================
const OPS = new Set(['d', 'y', 'c']);
export const MOT = new Set(['h', 'j', 'k', 'l', 'w', 'e', 'b', 'W', 'E', 'B', '0', '^', '$', 'G', '{', '}', ';', ',', 'H', 'M', 'L']);
const FIND = new Set(['f', 't', 'F', 'T']);
// Returns {st:'pending'} | {st:'invalid'} | {st:'done', kind:'line'|'op'|'cmd'|'mot', ...}
export function parseBuf(b) {
  const s = Array.from(b);
  let i = 0, c1 = '', c2 = '';
  if (/[1-9]/.test(s[i] || '')) while (/\d/.test(s[i] || '')) c1 += s[i++];
  const n1 = c1 ? +c1 : 1;
  if (i >= s.length) return { st: 'pending' };
  if (OPS.has(s[i])) {
    const op = s[i++];
    if (i >= s.length) return { st: 'pending' };
    if (s[i] === op) return i + 1 === s.length ? { st: 'done', kind: 'line', op, count: n1, explicit: !!c1 } : { st: 'invalid' };
    if (/[1-9]/.test(s[i])) while (/\d/.test(s[i] || '')) c2 += s[i++];
    if (i >= s.length) return { st: 'pending' };
    const rest = s.slice(i);
    const count = n1 * (c2 ? +c2 : 1), explicit = !!(c1 || c2);
    const done = (mot, extra) => ({ st: 'done', kind: 'op', op, mot, extra, count, explicit });
    if (rest[0] === 'g') return rest.length === 1 ? { st: 'pending' } : rest.length === 2 && rest[1] === 'g' ? done('gg') : { st: 'invalid' };
    if (FIND.has(rest[0])) return rest.length === 1 ? { st: 'pending' } : rest.length === 2 ? done(rest[0], rest[1]) : { st: 'invalid' };
    if (rest[0] === 'i' || rest[0] === 'a') {
      if (rest.length === 1) return { st: 'pending' };
      return rest.length === 2 && TEXTOBJ_CHARS.has(rest[1]) ? done('obj', rest.join('')) : { st: 'invalid' };
    }
    if (rest.length === 1 && MOT.has(rest[0])) return done(rest[0]);
    return { st: 'invalid' };
  }
  const rest = s.slice(i);
  const cmd = c => ({ st: 'done', kind: 'cmd', cmd: c, count: n1, explicit: !!c1 });
  if (rest[0] === 'g' || rest[0] === 'z') {
    if (rest.length === 1) return { st: 'pending' };
    const two = rest.join('');
    return ['gg', 'gd', 'zz', 'zt', 'zb'].includes(two) ? cmd(two) : { st: 'invalid' };
  }
  if (FIND.has(rest[0])) return rest.length === 1 ? { st: 'pending' } : rest.length === 2 ? { st: 'done', kind: 'mot', mot: rest[0], extra: rest[1], count: n1, explicit: !!c1 } : { st: 'invalid' };
  if (rest.length === 1 && MOT.has(rest[0])) return { st: 'done', kind: 'mot', mot: rest[0], count: n1, explicit: !!c1 };
  return { st: 'invalid' };
}

// ======================================================================
// Entry point
// ======================================================================
const block = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
const isEsc = e => e.key === 'Escape' || (e.ctrlKey && (e.key === 'c' || e.key === '['));
const NATIVE_NAV = /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/;
const DECO = new Set(['[', '*', '-', '/', '_', '`']);
const countFromBuf = () => (/^[1-9]\d*$/.test(state.cmdBuf) ? Math.min(+state.cmdBuf, 9999) : 1);
export const dispatchMode = e => ({ insert: insH, normal: normH, visual: visH, 'visual-line': vlH })[state.mode]?.(e);

export function onKey(e) {
  if (rt.passthrough || e[VIM]) return;
  if (isOverlayOpen()) return;                   // overlay has its own handler
  if (layout() !== 'page') return;
  if (state.cmdLine) return;
  if (e.isComposing || e.keyCode === 229) return;
  if (handleImageModal(e)) return;
  const t = ti(); const ae = document.activeElement;
  const editorFocused = !!t && ae === t;
  const nothingFocused = !ae || ae === document.body || ae === document.documentElement;
  if (editorFocused) {
    if (rt.busy || queue.length) { block(e); if (queue.length < 64) queue.push(snap(e)); return; }
    if (mapKey(e)) return;
    dispatchMode(e);
  } else if (nothingFocused) {
    unfocusedH(e);
  }
  // any other focused input (search box etc.) is left alone
}
// Queued / mapped / replayed keys
export function processFake(ev) {
  if (mapKey(ev)) return;
  dispatchMode(ev);
  if (!ev._blocked) replayNative(ev);
}

function handleImageModal(e) {
  const modal = $('.full-content-modal.in');
  if (!modal) return false;
  if (e.key === 'q' || e.key === 'Escape') {
    block(e);
    ($('.modal-backdrop.in') || modal).click();
    setTimeout(() => { focus(); setMode('normal'); }, 100);
  }
  return true;   // all other keys are ignored while the preview is open
}
function unfocusedH(e) {
  if (e.ctrlKey) {
    if (e.key === 'o') { block(e); navGo(-1); return; }
    if (e.key === 'i') { block(e); navGo(1); return; }
    return;
  }
  if (e.key === ':') { block(e); openCmdLine(':'); return; }
  if (e.key === 'Escape') { block(e); return; }
  if (/^[a-zA-Z]$/.test(e.key) && !e.metaKey && !e.altKey) {
    const s = snap(e); block(e); focus();
    setTimeout(() => { if (focused()) processFake(s); }, 0);
  }
}

// ======================================================================
// Insert
// ======================================================================
function insH(e) {
  if (isEsc(e)) { block(e); setMode('normal'); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'Enter') onInsertText('\n');
    else if (e.key === 'Backspace') onInsertBackspace();
  }
}

// ======================================================================
// Normal
// ======================================================================
const enterVL = () => { state.vlStart = curLineIdx(); setMode('visual-line'); updateVL(); };
const IMMEDIATE = {
  ':': () => openCmdLine(':'),
  '/': () => openCmdLine('/'),
  '?': () => openCmdLine('?'),
  '>': n => { for (let i = 0; i < n; i++) indentRight(); },
  '<': n => { for (let i = 0; i < n; i++) indentLeft(); },
  'i': () => setMode('insert'),
  'a': () => { if (!cursorAtEOL()) moveL(); setMode('insert'); },
  'A': () => { move$(); setMode('insert'); },
  'I': () => { move0(); setMode('insert'); },
  'o': () => run(() => openLine(true)),
  'O': () => run(() => openLine(false)),
  'v': () => setMode('visual'),
  'V': enterVL,
  's': n => run(() => substituteChars(n)),
  'S': n => run(() => linewiseCount('c', n)),
  'D': () => run(deleteToEOL),
  'C': () => run(changeToEOL),
  'J': n => run(() => joinLines(n)),
  'x': n => run(() => deleteCharsFwd(n)),
  '~': n => run(() => toggleCaseN(n)),
  'r': n => setPending('r', n),
  'm': () => setPending('m'),
  "'": () => setPending("'"),
  '`': () => setPending('`'),
  'u': n => { for (let i = 0; i < n; i++) undo(); },
  'p': () => run(() => paste(true)),
  'P': () => run(() => paste(false)),
  '.': (n, explicit) => repeatLast(n, explicit),
  'n': n => searchNext(true, n),
  'N': n => searchNext(false, n),
  '*': () => searchWord(1),
  '#': () => searchWord(-1),
};
const REC_INSERT = new Set(['i', 'a', 'A', 'I', 'o', 'O', 's', 'S', 'C']);
const REC_CHANGE = new Set(['>', '<', 'D', 'J', 'x', '~', 'p', 'P']);

function handlePending(k) {
  const p = state.pending; state.pending = null; updateIndicator();
  if (Array.from(k).length !== 1) return;          // Esc etc. cancels
  switch (p.type) {
    case 'r': recordChange((p.count > 1 ? String(p.count) : '') + 'r' + k, false); run(() => replaceChars(k, p.count)); return;
    case 'm': if (/^[a-zA-Z]$/.test(k)) setMark(k); return;
    case "'": case '`': if (/^[a-zA-Z]$/.test(k)) run(() => jumpMark(k, p.type === '`')); return;
  }
}

function normH(e) {
  if (e.metaKey) return;
  if (e.altKey) {
    if (e.code === 'KeyJ') { block(e); moveLineDown(); return; }
    if (e.code === 'KeyK') { block(e); moveLineUp(); return; }
    return;
  }
  if (e.ctrlKey) {
    switch (e.key) {
      case 'd': block(e); resetBuf(); halfScroll(1); return;
      case 'u': block(e); resetBuf(); halfScroll(-1); return;
      case 'e': block(e); lineScroll(1); return;
      case 'y': block(e); lineScroll(-1); return;
      case 'r': { block(e); const n = countFromBuf(); resetBuf(); for (let i = 0; i < n; i++) redo(); return; }
      case 'o': block(e); resetBuf(); navGo(-1); return;
      case 'i': block(e); resetBuf(); navGo(1); return;
    }
    return;   // other Ctrl keys (emacs bindings) go to cosense
  }
  if (NATIVE_NAV.test(e.key)) { if (state.cmdBuf || state.pending) resetBuf(); return; }   // arrows work natively
  block(e);
  const k = e.key;
  if (state.pending) { handlePending(k); return; }
  if (k === 'Escape') { resetBuf(); return; }

  const buf = state.cmdBuf;
  const idle = buf === '' || /^[1-9]\d*$/.test(buf);
  if (idle && IMMEDIATE[k]) {
    const explicit = buf !== '';
    const n = explicit ? Math.min(+buf, 9999) : 1;
    resetBuf();
    if (REC_INSERT.has(k)) recordChange(buf + k, true);
    else if (REC_CHANGE.has(k)) recordChange(buf + k, false);
    IMMEDIATE[k](n, explicit);
    return;
  }
  if (Array.from(k).length !== 1) { resetBuf(); return; }
  state.cmdBuf += k;
  const full = state.cmdBuf;
  const p = parseBuf(full);
  if (p.st === 'pending') { updateIndicator(); return; }
  resetBuf();
  if (p.st !== 'done') return;
  const cnt = Math.min(p.count, 9999);
  switch (p.kind) {
    case 'line':
      if (p.op !== 'y') recordChange(full, p.op === 'c');
      run(() => linewiseCount(p.op, cnt)); return;
    case 'op':
      if (p.op !== 'y') recordChange(full, p.op === 'c');
      run(() => execOp(p.op, p.mot, cnt, p.explicit, p.extra)); return;
    case 'cmd':
      if (p.cmd === 'gg') { if (p.explicit) jumpToLine(contentLineToIdx(cnt)); else moveGG(); }
      else if (p.cmd === 'gd') followLink();
      else scrollCursorTo(p.cmd[1] === 'z' ? 'z' : p.cmd[1]);
      return;
    case 'mot': doMotion(p.mot, cnt, p.explicit, p.extra); return;
  }
}

// ======================================================================
// Visual
// ======================================================================
function visH(e) {
  if (isEsc(e)) { block(e); setMode('normal'); return; }
  if (e.metaKey) return;
  if (e.altKey) {
    if (e.code === 'KeyJ') { block(e); moveLineDown(); return; }
    if (e.code === 'KeyK') { block(e); moveLineUp(); return; }
    return;
  }
  if (e.ctrlKey) { block(e); return; }
  if (NATIVE_NAV.test(e.key)) {
    if (e.shiftKey) return;                 // Shift+Arrow extends natively
    block(e); dk(e.key, { shiftKey: true }); return;
  }
  if (state.pending) {                      // i{obj} / a{obj} / f{char} ...
    block(e);
    const p = state.pending; state.pending = null; updateIndicator();
    const k = e.key; if (Array.from(k).length !== 1) return;
    if (p.type === 'obj') { if (TEXTOBJ_CHARS.has(k)) selectTextObject(p.kind + k, p.count); }
    else if (p.type === 'find') findMotion(p.kind, k, p.count, true);
    return;
  }
  // Cosense decoration keys ([ * - / _ `) need a trusted event: let it through untouched
  if (DECO.has(e.key)) {
    if (state.cmdBuf) resetBuf();
    if (!hasSel()) { block(e); return; }    // no selection: do nothing (never insert the char)
    const t = ti(); rt.roLift++; if (t) t.readOnly = false;
    setTimeout(() => {
      rt.roLift--;
      if (!rt.active) return;
      if (state.mode === 'visual') setModeQuiet('normal');   // keep cursor after "]" (no removeAllRanges)
    }, 50);
    return;
  }
  block(e); const k = e.key;
  if (k === 'g') {
    if (state.cmdBuf === 'g') { resetBuf(); selectToEdge(-1); }
    else { state.cmdBuf = 'g'; updateIndicator(); }
    return;
  }
  if (k === 'G') { resetBuf(); selectToEdge(1); dk('ArrowRight', { metaKey: true, shiftKey: true }); return; }
  if (/[1-9]/.test(k) || (k === '0' && /^\d+$/.test(state.cmdBuf))) { state.cmdBuf += k; updateIndicator(); return; }
  const cnt = countFromBuf(); resetBuf();
  switch (k) {
    case '>': for (let i = 0; i < cnt; i++) indentRight(); return;
    case '<': for (let i = 0; i < cnt; i++) indentLeft(); return;
    case 'y': run(vYank); return;
    case 'Y': run(vYankPlain); return;
    case 'd': case 'x': run(vDelete); return;
    case 'c': case 's': run(vSubst); return;
    case 'p': run(vPaste); return;
    case '~': run(vToggleCase); return;
    case 'i': case 'a': setPending('obj', cnt, k); return;
    case 'f': case 't': case 'F': case 'T': setPending('find', cnt, k); return;
    case 'v': setMode('normal'); return;
    case 'V': {
      try { window.getSelection()?.removeAllRanges(); } catch (_) { /* ignore */ }
      enterVL(); return;
    }
  }
  if (MOT.has(k)) doSelMotion(k, cnt);
}

// ======================================================================
// Visual line
// ======================================================================
function vlH(e) {
  if (isEsc(e)) { block(e); setMode('normal'); return; }
  if (e.metaKey) return;
  if (e.altKey) {
    if (e.code === 'KeyJ') { block(e); moveLineDown(); requestAnimationFrame(updateVL); return; }
    if (e.code === 'KeyK') { block(e); moveLineUp(); requestAnimationFrame(updateVL); return; }
    return;
  }
  if (e.ctrlKey) { block(e); return; }
  block(e);
  let k = e.key;
  if (k === 'ArrowDown') k = 'j'; else if (k === 'ArrowUp') k = 'k';
  if (k === 'g') {
    if (state.cmdBuf === 'g') { resetBuf(); jumpToLine(0); requestAnimationFrame(updateVL); }
    else { state.cmdBuf = 'g'; updateIndicator(); }
    return;
  }
  if (k === 'G') { resetBuf(); moveGEnd(); requestAnimationFrame(updateVL); return; }
  if (/[1-9]/.test(k) || (k === '0' && /^\d+$/.test(state.cmdBuf))) { state.cmdBuf += k; updateIndicator(); return; }
  const cnt = countFromBuf(); resetBuf();
  const moveTo = i => { jumpToLine(i); requestAnimationFrame(updateVL); };
  switch (k) {
    case '>': run(() => vlIndent(true, cnt)); return;
    case '<': run(() => vlIndent(false, cnt)); return;
    case 'y': run(vlYank); return;
    case 'Y': run(vlYankPlain); return;
    case 'd': case 'x': run(vlDelete); return;
    case 'p': run(vlPaste); return;
    case 'c': case 's': run(vlChange); return;
    case '{': case '}': { let i = curLineIdx(); for (let c = 0; c < cnt; c++) i = findEmptyLine(i, k === '{' ? -1 : 1); moveTo(i); return; }
    case 'H': case 'M': case 'L': moveTo(screenLine(k, cnt)); return;
    case 'j': case 'k': moveTo(curLineIdx() + (k === 'j' ? cnt : -cnt)); return;
    case 'v': case 'V': setMode('normal'); return;
  }
}
