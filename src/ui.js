// Mode indicator, flash messages, line numbers.
import { state, rt } from './state.js';
import { cfg } from './settings.js';
import { $, edLines } from './dom.js';
import { ensureStyles } from './theme.js';

// ---- indicator ----
let _indEl = null, _colRO = null;
const MODE_LABEL = {
  normal: { t: '-- NORMAL --', c: 'vim-mn' }, insert: { t: '-- INSERT --', c: 'vim-mi' },
  visual: { t: '-- VISUAL --', c: 'vim-mv' }, 'visual-line': { t: '-- VISUAL LINE --', c: 'vim-ml-m' },
};
export function createIndicator() {
  _indEl?.remove();
  _indEl = document.createElement('div'); _indEl.id = 'vim-ind';
  _indEl.innerHTML = '<div class="vim-ml"></div><div class="vim-mp"></div>';
  document.body.appendChild(_indEl);
  syncBarPos(); updateIndicator();
}
export function removeIndicator() { _indEl?.remove(); _indEl = null; _colRO?.disconnect(); }
export function showIndicator(on) { if (_indEl) _indEl.style.display = on && !state.cmdLine ? 'flex' : 'none'; }
export function setBusyMark(on) { if (!_indEl) return; if (on) _indEl.dataset.busy = '1'; else delete _indEl.dataset.busy; }
export function updateIndicator() {
  if (!_indEl) return;
  const m = MODE_LABEL[state.mode];
  _indEl.className = m.c;
  _indEl.querySelector('.vim-ml').textContent = m.t;
  const p = state.pending;
  _indEl.querySelector('.vim-mp').textContent = state.cmdBuf + (p ? (p.type === 'obj' ? p.kind : p.type === 'find' ? p.kind : p.type) : '');
}
// The mode bar and the command line follow the page column
export function syncBarPos() {
  const col = $('.col-page'); if (!col) return;
  const r = col.getBoundingClientRect();
  for (const el of [_indEl, document.getElementById('vim-cmd')]) if (el) { el.style.left = r.left + 'px'; el.style.width = r.width + 'px'; }
}
export function observeColPage() {
  if (!('ResizeObserver' in window)) return;
  if (!_colRO) _colRO = new ResizeObserver(() => syncBarPos());
  _colRO.disconnect();
  const c = $('.col-page'); if (c) _colRO.observe(c);
}

// ---- flash ----
function flashEl() {
  let f = $('.vim-flash');
  if (!f) { f = document.createElement('div'); f.className = 'vim-flash'; document.body.appendChild(f); }
  return f;
}
export function flash(msg, ms) {
  ensureStyles();
  const f = flashEl();
  f.textContent = msg; f.classList.add('vim-fv');
  clearTimeout(f._t); f._t = setTimeout(() => f.classList.remove('vim-fv'), ms || 1500);
}
export function busy(msg) {
  const f = flashEl();
  clearTimeout(f._t); f.textContent = '⏳ ' + msg; f.classList.add('vim-fv');
}

// ---- line numbers ----
// Absolute numbers change only when lines are added / removed. Relative numbers change on
// every cursor move, so only the lines on screen (plus a margin) are rewritten — on a long
// page that is ~60 attribute writes per move instead of one per line. Lines scrolled into
// view are refreshed from the scroll listener before they are painted.
const LN_MARGIN = 40;
let _lnRaf = 0, _lnObs = null, _lastCI = -2, _lastLen = -1, _lnForce = true, _win = [0, -1];
export function schedLN() { if (!rt.active || _lnRaf) return; _lnRaf = requestAnimationFrame(doLN); }
export function forceLN() { _lnForce = true; _lastCI = -2; _lastLen = -1; schedLN(); }
// first line whose bottom is below y (lines are laid out top to bottom)
function firstBelow(lines, y) {
  let lo = 0, hi = lines.length - 1, ans = lines.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].getBoundingClientRect().bottom > y) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}
export function visibleWindow(lines, margin = 0) {
  const len = lines.length; if (!len) return [0, -1];
  const a = firstBelow(lines, 0), b = firstBelow(lines, window.innerHeight);
  return [Math.max(0, a - margin), Math.min(len - 1, b + margin)];
}
function doLN() {
  _lnRaf = 0;
  if (!rt.active || !cfg.lineNumbers) return;
  const lines = edLines(); const len = lines.length; if (!len) return;
  let ci = -1;
  const cur = document.querySelector('.editor .lines > .line.cursor-line');
  if (cur) ci = Array.prototype.indexOf.call(lines, cur);
  const rel = cfg.relativeNumber;
  const titleOff = lines[0].classList.contains('line-title') ? 1 : 0;
  const value = i => (i < titleOff ? '' : (rel && ci >= 0 && i !== ci) ? String(Math.abs(i - ci)) : String(i + 1 - titleOff));
  const set = i => { const v = value(i); if (lines[i].getAttribute('data-vim-ln') !== v) lines[i].setAttribute('data-vim-ln', v); };
  const changed = _lnForce || len !== _lastLen;
  if (!rel) {
    if (!changed) return;
    for (let i = 0; i < len; i++) set(i);
  } else {
    const vis = visibleWindow(lines, 0);
    const covered = vis[0] >= _win[0] && vis[1] <= _win[1];
    if (!changed && ci === _lastCI && covered) return;
    _win = visibleWindow(lines, LN_MARGIN);
    for (let i = _win[0]; i <= _win[1]; i++) set(i);
  }
  _lnForce = false; _lastCI = ci; _lastLen = len;
}
const onLNScroll = () => schedLN();
export function setupLNObs() {
  stopLNObs();
  const c = $('.editor .lines'); if (!c || !rt.active) return;
  _lnObs = new MutationObserver(muts => {
    // line added / removed / replaced → numbers must be rewritten even if the cursor index is unchanged
    for (const m of muts) if (m.type === 'childList' && m.target === c) { _lnForce = true; break; }
    schedLN();
  });
  _lnObs.observe(c, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  window.addEventListener('scroll', onLNScroll, { passive: true });
  forceLN();
}
export function stopLNObs() {
  if (_lnObs) { _lnObs.disconnect(); _lnObs = null; }
  window.removeEventListener('scroll', onLNScroll);
}
export function clearLineNumbers() { document.querySelectorAll('[data-vim-ln]').forEach(el => el.removeAttribute('data-vim-ln')); }
