// Marks: m{a-z} per page, m{A-Z} across pages. Stored by line id, so they survive edits.
import { rt } from './state.js';
import { pageTitle, showPage } from './env.js';
import { edCurLine, lineIdOf, lineIdxById, cursorCol } from './dom.js';
import { flash } from './ui.js';
import { run } from './queue.js';
import { gotoPos } from './motions.js';
import { saveNavCursor } from './nav.js';

const marks = new Map();
const keyOf = name => (name === name.toLowerCase() ? location.pathname + '\u0001' + name : name);

export function setMark(name) {
  const cl = edCurLine(); if (!cl) return;
  marks.set(keyOf(name), { name, path: location.pathname, lineId: lineIdOf(cl), col: cursorCol(), title: pageTitle() });
  flash('mark ' + name);
}
export async function jumpMark(name, exact) {
  const m = marks.get(keyOf(name));
  if (!m) { flash('E20: Mark not set'); return; }
  if (m.path !== location.pathname) {
    rt.pendingMark = { lineId: m.lineId, col: exact ? m.col : 0 };
    saveNavCursor();
    showPage(m.title);
    return;
  }
  await gotoLineId(m.lineId, exact ? m.col : 0);
}
async function gotoLineId(id, col) {
  const idx = lineIdxById(id);
  if (idx < 0) { flash('E19: Mark has invalid line (行が削除されています)'); return; }
  await gotoPos(idx, col);
}
// Called after page:changed for uppercase marks on another page
export function consumePendingMark() {
  if (!rt.pendingMark) return;
  const p = rt.pendingMark; rt.pendingMark = null;
  setTimeout(() => run(() => gotoLineId(p.lineId, p.col)), 400);
}
export function listMarks() {
  const out = [];
  for (const m of marks.values()) {
    if (m.name === m.name.toLowerCase() && m.path !== location.pathname) continue;
    out.push(`${m.name}  ${m.title}${m.path === location.pathname ? '' : ' (別ページ)'}`);
  }
  return out.sort();
}
