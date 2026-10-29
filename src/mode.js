// Mode switching and the visual-line highlight.
import { state, rt } from './state.js';
import { layout } from './env.js';
import { syncRO, focus, curLineIdx, edLines } from './dom.js';
import { updateIndicator, schedLN } from './ui.js';
import { onLeaveInsert } from './repeat.js';

// Change mode without touching the selection or focus
export function setModeQuiet(m) {
  const prev = state.mode;
  state.mode = m; state.cmdBuf = ''; state.pending = null;
  if (prev === 'visual-line' && m !== 'visual-line') { clearVL(); state.vlStart = -1; }
  if (prev === 'insert' && m !== 'insert') onLeaveInsert();
  if (rt.active && layout() === 'page') document.body.dataset.vimMode = m;
  else delete document.body.dataset.vimMode;
  syncRO(); updateIndicator(); schedLN();
}
export function setMode(m) {
  const prev = state.mode;
  if ((prev === 'visual' || prev === 'visual-line') && m !== 'visual' && m !== 'visual-line') {
    try { window.getSelection()?.removeAllRanges(); } catch (_) { /* ignore */ }
  }
  setModeQuiet(m);
  if (m !== 'insert') focus();
}
export function resetBuf() { state.cmdBuf = ''; state.pending = null; updateIndicator(); }
export function setPending(type, count, kind) { state.pending = { type, count: count || 1, kind }; updateIndicator(); }

export function vlRange() { const cur = curLineIdx(); return [Math.min(state.vlStart, cur), Math.max(state.vlStart, cur)]; }
// Only touch lines whose state changes: re-adding the class to the whole range on every
// j/k was O(range) DOM writes (and style recalcs) per key. Reads are cheap; cosense may
// re-render a line and drop our class, so every line is checked, but only diffs are written.
export function updateVL() {
  if (state.mode !== 'visual-line') { clearVL(); return; }
  const [fr, to] = vlRange(); const all = edLines();
  for (let i = 0; i < all.length; i++) {
    const on = i >= fr && i <= to; const cl = all[i].classList;
    if (cl.contains('vim-vl-sel') !== on) cl.toggle('vim-vl-sel', on);
  }
}
export function clearVL() { document.querySelectorAll('.vim-vl-sel').forEach(e => e.classList.remove('vim-vl-sel')); }
