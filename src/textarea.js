// textarea#text-input bindings: blur, readOnly watchdog, IME guard, insert-text capture for "."
import { state, rt } from './state.js';
import { cfg } from './settings.js';
import { ti, focused, syncRO, wantRO } from './dom.js';
import { setModeQuiet, resetBuf } from './mode.js';
import { onInsertText } from './repeat.js';

let _bound = null, _roObs = null;

export function bindTextarea() {
  const t = ti(); if (!t) return;
  if (t === _bound) { syncRO(); return; }
  unbindTextarea();
  _bound = t;
  t.addEventListener('blur', onBlur);
  t.addEventListener('focus', onFocus);
  t.addEventListener('compositionend', onCompositionEnd);
  // cosense rewrites readOnly on focus changes; put it back while we want it
  _roObs = new MutationObserver(() => {
    if (!rt.roLift && cfg.imeGuard && wantRO() && !t.readOnly) t.readOnly = true;
  });
  _roObs.observe(t, { attributes: true, attributeFilter: ['readonly'] });
  syncRO();
}
export function unbindTextarea() {
  if (!_bound) return;
  _bound.removeEventListener('blur', onBlur);
  _bound.removeEventListener('focus', onFocus);
  _bound.removeEventListener('compositionend', onCompositionEnd);
  _roObs?.disconnect(); _roObs = null; _bound = null;
}
function onBlur() {
  setTimeout(() => {
    if (!rt.active || state.cmdLine) return;
    if (state.cmdBuf || state.pending) resetBuf();
    if (!focused() && state.mode !== 'normal') setModeQuiet('normal');
  }, 80);
}
function onFocus() { setTimeout(syncRO, 0); }
function onCompositionEnd(e) { if (state.mode === 'insert' && !rt.passthrough) onInsertText(e.data || ''); }

// Document-level beforeinput (capture)
export function onBeforeInput(e) {
  if (!rt.active || rt.passthrough) return;
  const t = ti(); if (!t || e.target !== t) return;
  if (state.mode === 'insert') {
    // remember typed text for "." (Enter / Backspace are recorded from keydown)
    if (e.inputType === 'insertText' && e.data) onInsertText(e.data);
    return;
  }
  // Only composition text is stopped here; readOnly does the real work
  if (!cfg.imeGuard || rt.roLift) return;
  if (e.inputType === 'insertCompositionText' || e.inputType === 'insertFromComposition') e.preventDefault();
}
export function onWinFocus() { setTimeout(() => { if (rt.active) { bindTextarea(); syncRO(); } }, 0); }
