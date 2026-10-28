// Command line (":", "/", "?") and ex commands.
import { state } from './state.js';
import { cfg, sessionOpts } from './settings.js';
import { layout, projectName, pageTitle, showPage, cosense } from './env.js';
import { safe } from './util.js';
import { $, ti, dk, toClip, edCurLine, focus, jumpToLine, contentLineToIdx } from './dom.js';
import { setModeQuiet } from './mode.js';
import { flash, showIndicator, syncBarPos } from './ui.js';
import { search } from './search.js';
import { saveNavCursor } from './nav.js';
import { listMarks } from './marks.js';
import { addSessionMapLine, isMapLine, listMaps } from './keymap.js';
import { openHelp, openSettings } from './overlay.js';
import { reloadConfig } from './main.js';

let _cmdEl = null, _cmdInputEl = null, _prompt = ':';
const hist = { ':': [], '/': [] }; let histIdx = -1;

function createCmdLine() {
  if (_cmdEl) return;
  _cmdEl = document.createElement('div'); _cmdEl.id = 'vim-cmd';
  _cmdEl.innerHTML = '<div class="vim-cmd-spacer"></div><div class="vim-cmd-body"><span class="vim-cmd-colon">:</span><input id="vim-cmd-input" type="text" autocomplete="off" spellcheck="false"></div>';
  document.body.appendChild(_cmdEl);
  _cmdInputEl = _cmdEl.querySelector('#vim-cmd-input');
  _cmdInputEl.addEventListener('keydown', onCmdKey);
  _cmdInputEl.addEventListener('blur', () => { setTimeout(() => { if (state.cmdLine) closeCmdLine(); }, 50); });
  syncBarPos();
}
export function removeCmdLine() { if (state.cmdLine) closeCmdLine(); _cmdEl?.remove(); _cmdEl = null; _cmdInputEl = null; }

export function openCmdLine(prompt = ':') {
  createCmdLine(); syncBarPos();
  _prompt = prompt; histIdx = -1;
  _cmdEl.querySelector('.vim-cmd-colon').textContent = prompt;
  state.cmdLine = true;
  _cmdEl.style.display = 'flex'; showIndicator(false);
  _cmdInputEl.value = '';
  setTimeout(() => _cmdInputEl.focus(), 0);
}
export function closeCmdLine() {
  state.cmdLine = false;
  if (_cmdEl) _cmdEl.style.display = 'none';
  showIndicator(layout() === 'page');
  setModeQuiet('normal'); focus();
}
function onCmdKey(e) {
  e.stopPropagation();
  if (e.isComposing || e.keyCode === 229) return;   // IME confirm Enter is not "run"
  const h = hist[_prompt === ':' ? ':' : '/'];
  if (e.key === 'Escape') { e.preventDefault(); closeCmdLine(); return; }
  if (e.key === 'Tab') { e.preventDefault(); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); if (!h.length) return;
    if (e.key === 'ArrowUp') histIdx = histIdx < 0 ? h.length - 1 : Math.max(0, histIdx - 1);
    else histIdx = histIdx < 0 ? -1 : histIdx + 1;
    if (histIdx >= h.length) histIdx = -1;
    _cmdInputEl.value = histIdx < 0 ? '' : h[histIdx];
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const value = _cmdInputEl.value; const prompt = _prompt;
    const v = prompt === ':' ? value.trim() : value;
    if (v && h[h.length - 1] !== v) { h.push(v); if (h.length > 50) h.shift(); }
    closeCmdLine();
    if (prompt === ':') { if (v) execCmd(v); }
    else search(v, prompt === '/' ? 1 : -1);
  }
}

export function execCmd(cmd) {
  let m;
  if (/^\d+$/.test(cmd)) { const n = +cmd; jumpToLine(contentLineToIdx(n)); flash('Line ' + n); return; }
  if ((m = cmd.match(/^e(?:dit)?\s+(.+)$/))) { const t = m[1].trim(); saveNavCursor(); showPage(t); flash('Opening: ' + t); return; }
  if (cmd === 'new') { const b = $('.new-button'); if (b) b.click(); else { const p = projectName(); if (p) window.open('/' + p + '/new', '_self'); } flash('New page'); return; }
  if (cmd === 'w') {
    if (typeof safe(() => cosense.Page.waitForSave, null) === 'function') { flash('Saving...'); cosense.Page.waitForSave().then(() => flash('Saved')); }
    else flash('Saved (auto)');
    return;
  }
  if (cmd === 'q') { const t = ti(); if (t) t.blur(); flash(':q'); return; }
  // :cpll — copy current line's permalink (user's version: Cmd+E to refocus)
  if (cmd === 'cpll') {
    dk('e', { ctrlKey: false, code: 'KeyE', keyCode: 69, metaKey: true });
    setTimeout(() => {
      const cl = edCurLine();
      if (!cl || !cl.id) { flash('No line'); return; }
      const url = location.origin + location.pathname + '#' + cl.id.substring(1);
      toClip(url);
      flash('Copied: #' + cl.id);
    }, 100);
    return;
  }
  // :cpmdl — copy markdown link [title](url)
  if (cmd === 'cpmdl') {
    dk('e', { ctrlKey: false, code: 'KeyE', keyCode: 69, metaKey: true });
    setTimeout(() => {
      const title = pageTitle() || document.title || '';
      const url = location.origin + location.pathname;
      const md = '[' + title + '](' + url + ')';
      toClip(md);
      flash('Copied MD link');
    }, 100);
    return;
  }
  if ((m = cmd.match(/^h(?:elp)?(?:\s+(.+))?$/))) { openHelp(m[1]); return; }
  if (/^(settings|VimSettings|vimrc)$/.test(cmd)) { openSettings(); return; }
  if (cmd === 'marks') { const l = listMarks(); flash(l.length ? 'mark  page\n' + l.join('\n') : 'マークはありません', 5000); return; }
  if (cmd === 'noh' || cmd === 'nohlsearch') return;
  if ((m = cmd.match(/^(n|i|v|x)?(?:nore)?map$/))) {
    const l = listMaps(m[1]);
    flash(l.length ? l.join('\n') : 'マッピングはありません', 5000); return;
  }
  if (isMapLine(cmd)) { addSessionMapLine(cmd); flash(cmd); return; }
  if ((m = cmd.match(/^se(?:t)?(?:\s+(.*))?$/))) { cmdSet((m[1] || '').trim()); return; }
  flash('E492: Not an editor command: ' + cmd);
}

function cmdSet(arg) {
  const show = () => flash(`number=${cfg.lineNumbers ? 'on' : 'off'}  relativenumber=${cfg.relativeNumber ? 'on' : 'off'}  background=${cfg.theme}  imeguard=${cfg.imeGuard ? 'on' : 'off'}`, 3000);
  if (!arg) { show(); return; }
  const MAP = { nu: 'lineNumbers', number: 'lineNumbers', rnu: 'relativeNumber', relativenumber: 'relativeNumber', imeguard: 'imeGuard' };
  for (const tok of arg.split(/\s+/)) {
    let mm;
    if ((mm = tok.match(/^(?:bg|background)=(dark|light|auto)$/))) sessionOpts.theme = mm[1];
    else if (MAP[tok]) sessionOpts[MAP[tok]] = true;
    else if (tok.startsWith('no') && MAP[tok.slice(2)]) sessionOpts[MAP[tok.slice(2)]] = false;
    else if (tok.endsWith('!') && MAP[tok.slice(0, -1)]) { const k = MAP[tok.slice(0, -1)]; sessionOpts[k] = !cfg[k]; }
    else { flash('E518: Unknown option: ' + tok); return; }
  }
  reloadConfig(); show();
}
