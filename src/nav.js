// gd / CTRL-O / CTRL-I
import { rt } from './state.js';
import { layout, showPage } from './env.js';
import { $, edCurLine, focused, focus, curLineIdx, lineCount, jumpToLine, resetTextareaCache } from './dom.js';
import { setMode } from './mode.js';
import { flash, schedLN } from './ui.js';
import { bindTextarea } from './textarea.js';

const navCursor = new Map();   // pathname → line index

export function saveNavCursor() { if (focused()) navCursor.set(location.pathname, curLineIdx()); }

export function navGo(dir) {
  saveNavCursor();
  const token = { scheduled: false };
  rt.navPending = token;
  if (dir < 0) history.back(); else history.forward();
  flash(dir < 0 ? 'Back' : 'Forward');
  setTimeout(() => { if (rt.navPending === token && !token.scheduled) restoreNav(); }, 1200);
}
// page:changed calls this when a CTRL-O / CTRL-I is pending
export function onNavPageChanged() {
  if (rt.navPending && !rt.navPending.scheduled) { rt.navPending.scheduled = true; setTimeout(restoreNav, 200); }
}
function restoreNav() {
  rt.navPending = null; resetTextareaCache();
  if (!rt.active || layout() !== 'page') return;
  focus(); setMode('normal');
  const saved = navCursor.get(location.pathname);
  setTimeout(() => {
    const total = lineCount(); if (!total) return;
    jumpToLine(saved !== undefined ? Math.min(saved, total - 1) : 0);
    setTimeout(() => { focus(); bindTextarea(); schedLN(); }, 50);
  }, 300);
}

export function followLink() {
  const cl = edCurLine(); const cursor = $('.cursor');
  if (!cl || !cursor) { flash('No link'); return; }
  const cr = cursor.getBoundingClientRect();
  const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
  let target = null, bestD = Infinity;
  for (const sp of cl.querySelectorAll('.char-index')) {
    const r = sp.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) { target = sp; break; }
    if (cy >= r.top && cy <= r.bottom) { const d = Math.abs(cx - (r.left + r.width / 2)); if (d < bestD) { bestD = d; target = sp; } }
  }
  if (!target) { flash('No link'); return; }

  const imageSpan = target.closest('.image');
  if (imageSpan) {
    const prev = imageSpan.previousElementSibling;
    if (prev) { (prev.querySelector('img') || prev).click(); flash('Image preview'); return; }
  }
  const anchor = target.closest('a[href]');
  if (anchor) {
    saveNavCursor();
    // real mouse events so cosense routes internal / cross-project links itself
    const r = anchor.getBoundingClientRect();
    const o = { button: 0, clientX: r.left + 4, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, view: window };
    anchor.dispatchEvent(new MouseEvent('mousedown', o));
    anchor.dispatchEvent(new MouseEvent('mouseup', o));
    anchor.dispatchEvent(new MouseEvent('click', o));
    flash('Following link');
    return;
  }
  const linkSpan = target.closest('.link') || target.closest('[type="link"]');
  if (linkSpan) {
    const text = linkSpan.textContent.trim();
    const url = text.match(/(https?:\/\/[^\s\]]+)/);
    if (url) { window.open(url[1], '_blank'); flash('Opening URL'); return; }
    if (text) { saveNavCursor(); showPage(text.replace(/^\[|\]$/g, '')); flash('Following link'); return; }
  }
  flash('No link under cursor');
}
