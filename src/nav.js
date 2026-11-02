// gd / CTRL-O / CTRL-I
import { rt } from './state.js';
import { layout, showPage } from './env.js';
import { $, edCurLine, edLines, focused, focus, curLineIdx, lineCount, jumpToLine, resetTextareaCache, cursorEl } from './dom.js';
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

// ---- line links: [page#lineId] → cursor on that line ----
// Another page: cosense renders it after page:changed and may scroll to the line ~1 s later
// (giving it a "permalink" highlight). Wait until the line exists and has stopped moving,
// then click it. Same page (gd from the line being edited): cosense only updates the URL,
// so jump straight away.
const LINE_HASH = /^#([0-9a-f]{24})$/i;
let _lineJump = 0;
export function hashLineId() { const m = location.hash.match(LINE_HASH); return m ? m[1] : null; }
function cursorToLine(el) {
  const idx = Array.prototype.indexOf.call(edLines(), el);
  if (idx < 0) return;
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: 'center' });
  focus(); setMode('normal'); jumpToLine(idx);
  setTimeout(() => { focus(); schedLN(); }, 50);
}
export function jumpToHashLine(id = hashLineId(), { immediate = false, maxMs = 3000 } = {}) {
  if (!id) return;
  const tok = ++_lineJump; const t0 = Date.now(); let lastTop = null, still = 0;
  const tick = () => {
    if (tok !== _lineJump || !rt.active || layout() !== 'page') return;
    const el = document.getElementById('L' + id);
    if (el) {
      if (immediate) { cursorToLine(el); return; }
      const top = Math.round(el.getBoundingClientRect().top);
      still = top === lastTop ? still + 1 : 0; lastTop = top;
      if (still >= 2 || Date.now() - t0 > maxMs) { cursorToLine(el); return; }
    } else if (Date.now() - t0 > maxMs) return;
    setTimeout(tick, 100);
  };
  setTimeout(tick, immediate ? 30 : 100);
}
export const cancelHashLineJump = () => { _lineJump++; };

// ---- image preview ----
// The preview <img> sits next to the line's chars: before them in older cosense, after them
// (span.modal-image) in newer versions. Look on both sides, then anywhere on the line.
function previewImageFor(el) {
  for (const s of [el.nextElementSibling, el.previousElementSibling]) {
    if (!s) continue;
    const img = s.matches('img') ? s : s.querySelector('img');
    if (img) return img;
  }
  return el.closest('.line')?.querySelector('.modal-image img, img.image') || null;
}

export function followLink() {
  const cl = edCurLine(); const cursor = cursorEl();
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
    const img = previewImageFor(imageSpan);
    if (img) { img.click(); flash('Image preview'); return; }
  }
  const anchor = target.closest('a[href]');
  if (anchor) {
    saveNavCursor();
    const href = anchor.getAttribute('href') || '';
    const samePage = href.startsWith('/') && decodeURIComponent(href.split('#')[0]) === decodeURIComponent(location.pathname);
    // real mouse events so cosense routes internal / cross-project links itself
    const r = anchor.getBoundingClientRect();
    const o = { button: 0, clientX: r.left + 4, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, view: window };
    anchor.dispatchEvent(new MouseEvent('mousedown', o));
    anchor.dispatchEvent(new MouseEvent('mouseup', o));
    anchor.dispatchEvent(new MouseEvent('click', o));
    // another page: page:changed picks the line up from the URL
    if (samePage && /#[0-9a-f]{24}$/i.test(href)) jumpToHashLine(href.slice(-24), { immediate: true });
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
