// User key mappings in vimrc style:  nnoremap H 0 / inoremap jk <Esc> / vnoremap ...
// All mappings are non-recursive (map == noremap). Applied before the mode handlers.
import { state } from './state.js';
import { enqueue, snap, fakeKey } from './queue.js';

const TIMEOUT = 1000;  // ms to wait for the rest of a multi-key mapping (vim's timeoutlen)
const SEP = '\u0001';
const maps = { n: new Map(), i: new Map(), v: new Map() };
let configText = '';
const sessionLines = [];

const NAMES = {
  esc: '<Esc>', cr: '<CR>', enter: '<CR>', return: '<CR>', bs: '<BS>', backspace: '<BS>',
  tab: '<Tab>', space: '<Space>', lt: '<', bar: '|', bslash: '\\',
  up: '<Up>', down: '<Down>', left: '<Left>', right: '<Right>', del: '<Del>',
};
const TOKEN_TO_KEY = {
  '<Esc>': 'Escape', '<CR>': 'Enter', '<BS>': 'Backspace', '<Tab>': 'Tab', '<Space>': ' ',
  '<Up>': 'ArrowUp', '<Down>': 'ArrowDown', '<Left>': 'ArrowLeft', '<Right>': 'ArrowRight', '<Del>': 'Delete',
};
const KEY_TO_TOKEN = Object.fromEntries(Object.entries(TOKEN_TO_KEY).map(([t, k]) => [k, t]));

// "jk<Esc>" → ['j', 'k', '<Esc>']
export function parseKeys(str) {
  const out = []; const s = Array.from(String(str));
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<') {
      const close = s.indexOf('>', i + 1);
      if (close > i + 1) {
        const name = s.slice(i + 1, close).join('');
        const lower = name.toLowerCase();
        let tok = NAMES[lower];
        const m = /^c-(.)$/i.exec(name);
        if (!tok && m) tok = `<C-${m[1].toLowerCase()}>`;
        if (tok) { out.push(tok); i = close; continue; }
      }
    }
    out.push(s[i]);
  }
  return out;
}

export function tokenOfEvent(ev) {
  if (ev.metaKey || ev.altKey) return null;
  if (ev.ctrlKey) return ev.key.length === 1 ? `<C-${ev.key.toLowerCase()}>` : null;
  if (KEY_TO_TOKEN[ev.key]) return KEY_TO_TOKEN[ev.key];
  return ev.key.length === 1 || Array.from(ev.key).length === 1 ? ev.key : null;
}
function tokenToEvent(tok) {
  const m = /^<C-(.)>$/.exec(tok);
  if (m) return fakeKey(m[1], { noremap: true, ctrlKey: true });
  return fakeKey(TOKEN_TO_KEY[tok] || tok, { noremap: true });
}

// ---- definitions ----
const MAP_RE = /^(n|i|v|x)?(?:nore)?map\s+(\S+)\s+(.+)$/;
const UNMAP_RE = /^(n|i|v|x)?unmap\s+(\S+)$/;
const modesOf = m => (!m ? ['n', 'v'] : m === 'x' ? ['v'] : [m]);

function applyLine(raw) {
  const line = raw.trim();
  if (!line || line.startsWith('"')) return true;
  let m = MAP_RE.exec(line);
  if (m) {
    const lhs = parseKeys(m[2]).join(SEP); const rhs = parseKeys(m[3].trim());
    for (const md of modesOf(m[1])) maps[md].set(lhs, rhs);
    return true;
  }
  m = UNMAP_RE.exec(line);
  if (m) { const lhs = parseKeys(m[2]).join(SEP); for (const md of modesOf(m[1])) maps[md].delete(lhs); return true; }
  return false;
}
function rebuild() {
  for (const k of Object.keys(maps)) maps[k].clear();
  const bad = [];
  configText.split('\n').forEach((l, i) => { if (!applyLine(l)) bad.push(i + 1); });
  for (const l of sessionLines) applyLine(l);
  return bad;
}
// Returns the line numbers that could not be parsed
export function setConfigKeymap(text) { configText = text || ''; return rebuild(); }
export function addSessionMapLine(line) { if (!MAP_RE.test(line.trim()) && !UNMAP_RE.test(line.trim())) return false; sessionLines.push(line.trim()); rebuild(); return true; }
// Line numbers that are neither blank, a "comment, nor a valid map / unmap line
export function validateKeymap(text) {
  const bad = [];
  String(text || '').split('\n').forEach((l, i) => {
    const t = l.trim();
    if (t && !t.startsWith('"') && !MAP_RE.test(t) && !UNMAP_RE.test(t)) bad.push(i + 1);
  });
  return bad;
}
export function isMapLine(line) { return MAP_RE.test(line.trim()) || UNMAP_RE.test(line.trim()); }
export function listMaps(filter) {
  const label = { n: 'n', i: 'i', v: 'v' }; const out = [];
  for (const md of filter ? modesOf(filter) : ['n', 'i', 'v']) {
    for (const [lhs, rhs] of maps[md]) out.push(`${label[md]}  ${lhs.split(SEP).join('')}  ${rhs.join('')}`);
  }
  return out;
}
export function hasAnyMap() { return maps.n.size + maps.i.size + maps.v.size > 0; }

// ---- runtime ----
const pend = { toks: [], evs: [], timer: 0, mode: 'n' };
const modeKey = () => (state.mode === 'insert' ? 'i' : state.mode.startsWith('visual') ? 'v' : 'n');
function clearPend() { clearTimeout(pend.timer); pend.toks = []; pend.evs = []; }
const block = ev => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };

function emit(rhs) {
  const evs = [];
  for (let i = 0; i < rhs.length; i++) {
    // ":cmd<CR>" runs the ex command directly
    if (rhs[i] === ':' && modeKey() !== 'i') {
      const end = rhs.indexOf('<CR>', i + 1);
      if (end > i) { evs.push({ _ex: rhs.slice(i + 1, end).join('') }); i = end; continue; }
    }
    evs.push(tokenToEvent(rhs[i]));
  }
  enqueue(evs);
}
function onTimeout() {
  const toks = pend.toks, evs = pend.evs, md = pend.mode; clearPend();
  const exact = maps[md].get(toks.join(SEP));
  if (exact) emit(exact); else enqueue(evs.map(e => ({ ...e, _noremap: true })));
}
function hasLonger(map, key) { const pre = key + SEP; for (const k of map.keys()) if (k.startsWith(pre)) return true; return false; }

// Returns true when the key was consumed by a mapping (or held as a prefix)
export function mapKey(ev) {
  if (ev._noremap) return false;
  const md = modeKey(); const map = maps[md];
  if (!map.size && !pend.toks.length) return false;
  // nnoremap does not apply in operator-pending / count-after-operator / r{char} etc.
  if (state.pending || (md !== 'i' && state.cmdBuf && !/^\d+$/.test(state.cmdBuf))) return false;
  const tok = tokenOfEvent(ev);
  if (!tok) { if (pend.toks.length) { const evs = pend.evs; clearPend(); enqueue(evs.map(e => ({ ...e, _noremap: true }))); } return false; }
  const toks = [...pend.toks, tok]; const key = toks.join(SEP);
  if (hasLonger(map, key)) {
    pend.toks = toks; pend.evs.push(snap(ev)); pend.mode = md;
    block(ev);
    clearTimeout(pend.timer); pend.timer = setTimeout(onTimeout, TIMEOUT);
    return true;
  }
  const exact = map.get(key);
  if (exact) { clearPend(); block(ev); emit(exact); return true; }
  if (pend.toks.length) {
    // the held prefix did not become a mapping: replay it unmapped, then this key normally
    const evs = pend.evs; clearPend(); block(ev);
    enqueue([...evs.map(e => ({ ...e, _noremap: true })), snap(ev)]);
    return true;
  }
  return false;
}
export function resetMapState() { clearPend(); }
