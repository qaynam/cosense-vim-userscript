// Overlays: :help and the settings screen. They work even when vim is disabled.
import { VERSION, esc } from './util.js';
import { rt } from './state.js';
import { Settings, sanitize, clearSessionOpts } from './settings.js';
import { layout, projectName } from './env.js';
import { focus, syncRO } from './dom.js';
import { ensureStyles } from './theme.js';
import { flash } from './ui.js';
import { validateKeymap } from './keymap.js';
import { helpText } from './help.js';
import { reloadConfig } from './main.js';

let root = null, keyFn = null;
export const isOverlayOpen = () => !!root;
const stopAll = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

function show(html, onKeyFn) {
  close(true);
  ensureStyles();
  root = document.createElement('div');
  root.className = 'vim-ov';
  root.innerHTML = `<div class="vim-ov-panel" role="dialog" aria-modal="true">${html}</div>`;
  root.addEventListener('mousedown', e => { if (e.target === root) close(); });
  document.body.appendChild(root);
  keyFn = onKeyFn;
  document.addEventListener('keydown', keyFn, true);
  return root;
}
export function close(silent) {
  if (!root) return;
  document.removeEventListener('keydown', keyFn, true);
  root.remove(); root = null; keyFn = null;
  if (!silent && rt.active && layout() === 'page') setTimeout(() => { focus(); syncRO(); }, 0);
}

// ---- help ----
function renderHelp(text) {
  return esc(text).split('\n').map(line => {
    if (/^[=-]{20,}$/.test(line)) return `<span class="vh-rule">${line}</span>`;
    return line
      .replace(/\*([^\s*|]+)\*/g, (_, t) => `<span class="vh-tag" data-tag="${t}">*${t}*</span>`)
      .replace(/\|([^\s|]+)\|/g, (_, t) => `<a class="vh-link" data-tag="${t}">|${t}|</a>`);
  }).join('\n');
}
function jumpHelpTag(topic) {
  if (!root) return;
  const tags = [...root.querySelectorAll('.vh-tag')];
  const t = String(topic).trim();
  let el = null;
  for (const c of [t, 'cosense-vim-' + t, ':' + t, t.replace(/^:/, '')]) { el = tags.find(x => x.dataset.tag === c); if (el) break; }
  if (!el) el = tags.find(x => x.dataset.tag.includes(t));
  if (!el) { flash('E149: ヘルプがありません: ' + t); return; }
  const body = root.querySelector('.vim-ov-body');
  body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
  el.classList.add('vh-flash'); setTimeout(() => el.classList.remove('vh-flash'), 900);
}
export function openHelp(topic) {
  let gPending = false;
  const r = show(`
<div class="vim-ov-head"><span class="vim-ov-title">:help</span><span class="vim-ov-ver">${VERSION}</span><span class="vim-ov-hint">j / k でスクロール ・ q で閉じる</span><button class="vim-ov-x" data-act="close" title="閉じる">×</button></div>
<div class="vim-ov-body"><pre class="vim-help">${renderHelp(helpText())}</pre></div>`, e => {
    if (e.metaKey) return;
    stopAll(e);
    const body = r.querySelector('.vim-ov-body');
    const k = e.key;
    if (k === 'q' || k === 'Escape') { close(); return; }
    if (k === 'j' || k === 'ArrowDown') body.scrollTop += 40;
    else if (k === 'k' || k === 'ArrowUp') body.scrollTop -= 40;
    else if ((e.ctrlKey && k === 'd') || k === 'PageDown' || k === ' ') body.scrollTop += body.clientHeight / 2;
    else if ((e.ctrlKey && k === 'u') || k === 'PageUp') body.scrollTop -= body.clientHeight / 2;
    else if (k === 'G') body.scrollTop = body.scrollHeight;
    else if (k === 'g') { if (gPending) { body.scrollTop = 0; gPending = false; } else { gPending = true; setTimeout(() => { gPending = false; }, 600); } return; }
    gPending = false;
  });
  r.addEventListener('click', e => {
    const a = e.target.closest('.vh-link'); if (a) { jumpHelpTag(a.dataset.tag); return; }
    if (e.target.closest('[data-act="close"]')) close();
  });
  if (topic) setTimeout(() => jumpHelpTag(topic), 0);
}

// ---- settings ----
export function openSettings() {
  const p = projectName();
  const hasProj = Settings.hasProject(p);
  const eff = Settings.effective(p);
  let scope = hasProj ? 'project' : 'global';
  const list = Settings.overriddenProjects();
  const r = show(`
<div class="vim-ov-head"><span class="vim-ov-title">Cosense Vim 設定</span><span class="vim-ov-ver">${VERSION}</span><span class="vim-ov-hint">Esc で閉じる ・ ⌘Enter で保存</span><button class="vim-ov-x" data-act="close" title="閉じる">×</button></div>
<div class="vim-ov-body vim-st">
  <div class="vim-st-status">
    プロジェクト <b>${esc(p || '(なし)')}</b> は
    <span class="vim-badge ${hasProj ? 'proj' : 'glob'}">${hasProj ? '専用設定' : 'グローバル設定'}</span> を使用中 ・
    Vim は <span class="vim-badge ${eff.enabled ? 'glob' : 'off'}">${eff.enabled ? '有効' : '無効'}</span>
    ${hasProj ? '<button class="vim-btn sm" data-act="reset">専用設定を削除</button>' : ''}
  </div>
  <div class="vim-st-section">このプロジェクトに適用する設定</div>
  <label class="vim-st-row"><input type="radio" name="vim-scope" value="global"> グローバル設定に従う</label>
  <label class="vim-st-row"><input type="radio" name="vim-scope" value="project"> このプロジェクト専用の設定を使う</label>
  <div class="vim-st-note" data-role="scope-note"></div>
  <div class="vim-st-section" data-role="edit-title"></div>
  <label class="vim-st-row"><input type="checkbox" data-k="enabled"> <span data-role="enabled-label">有効にする</span></label>
  <label class="vim-st-row">テーマ <select data-k="theme"><option value="auto">auto (OS に追従)</option><option value="light">light</option><option value="dark">dark</option></select></label>
  <label class="vim-st-row"><input type="checkbox" data-k="lineNumbers"> 行番号を表示</label>
  <label class="vim-st-row"><input type="checkbox" data-k="relativeNumber"> 相対行番号</label>
  <label class="vim-st-row"><input type="checkbox" data-k="imeGuard"> IME ガード <small>ノーマルモードで日本語入力を止める</small></label>
  <label class="vim-st-row"><input type="checkbox" data-k="systemClipboard"> システムクリップボードを使う <small>オフで内部レジスタのみ</small></label>
  <div class="vim-st-section">キーマップ <small>(:help cosense-vim-keymap)</small></div>
  <textarea data-k="keymap" spellcheck="false" placeholder="inoremap jk <Esc>&#10;nnoremap H 0&#10;nnoremap L $&#10;nnoremap <Space>w :w<CR>"></textarea>
  <div class="vim-st-note" data-role="keymap-err"></div>
  <div class="vim-st-section">カスタム CSS <small>(:help cosense-vim-css)</small></div>
  <textarea data-k="customCSS" spellcheck="false" placeholder=":root { --vim-cursor: rgba(255, 80, 80, .5); }"></textarea>
  <div class="vim-st-note">専用設定のあるプロジェクト: ${list.length ? list.map(esc).join('、') : 'なし'}<br>保存先: このブラウザの localStorage（cosense-vim:*）</div>
</div>
<div class="vim-st-foot"><button class="vim-btn" data-act="help">ヘルプ</button><span class="sp"></span><button class="vim-btn" data-act="cancel">キャンセル</button><button class="vim-btn primary" data-act="save">保存</button></div>`, e => {
    if (e.key === 'Escape') { stopAll(e); close(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { stopAll(e); save(); return; }
    e.stopPropagation(); e.stopImmediatePropagation();   // keep cosense/vim out; typing still works
  });
  const q = s => r.querySelector(s);
  function load(sc) {
    const src = sc === 'project' ? (Settings.project(p) || Settings.global()) : Settings.global();
    for (const el of r.querySelectorAll('[data-k]')) {
      if (el.type === 'checkbox') el.checked = !!src[el.dataset.k]; else el.value = src[el.dataset.k];
    }
    q('[data-role="edit-title"]').textContent = sc === 'project' ? `「${p}」の専用設定` : 'グローバル設定';
    q('[data-role="enabled-label"]').textContent = sc === 'project' ? 'このプロジェクトで有効にする' : '既定で有効にする';
    q('[data-role="scope-note"]').textContent = sc === 'project'
      ? `「${p}」だけに適用されます。グローバル設定より優先されます。`
      : `専用設定のないすべてのプロジェクトに適用されます。${hasProj ? `保存すると「${p}」の専用設定は削除されます。` : ''}`;
    q('[data-role="keymap-err"]').textContent = '';
  }
  function read() {
    const o = {};
    for (const el of r.querySelectorAll('[data-k]')) o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
    return sanitize(o);
  }
  function save() {
    const s = read();
    const bad = validateKeymap(s.keymap);
    if (bad.length) { q('[data-role="keymap-err"]').textContent = `キーマップ ${bad.join(', ')} 行目を読めません（例: nnoremap H 0）`; return; }
    let ok;
    if (scope === 'project') ok = Settings.saveProject(p, s);
    else { ok = Settings.saveGlobal(s); if (ok) Settings.clearProject(p); }
    if (!ok) { flash('保存に失敗しました (localStorage)'); return; }
    clearSessionOpts();
    close();
    reloadConfig();
    flash(scope === 'project' ? `「${p}」の専用設定を保存しました` : 'グローバル設定を保存しました');
  }
  r.querySelectorAll('input[name="vim-scope"]').forEach(radio => {
    radio.checked = radio.value === scope;
    radio.addEventListener('change', () => { if (radio.checked) { scope = radio.value; load(scope); } });
  });
  load(scope);
  r.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'save') save();
    else if (act === 'close' || act === 'cancel') close();
    else if (act === 'help') { close(true); openHelp('cosense-vim-settings'); }
    else if (act === 'reset') {
      Settings.clearProject(p); clearSessionOpts();
      close(); reloadConfig();
      flash(`「${p}」の専用設定を削除しました（グローバル設定に戻りました）`);
    }
  });
  setTimeout(() => q('input[name="vim-scope"]:checked')?.focus(), 0);
}

// #vim-settings / #vim-help in the URL open the overlays (also when disabled)
export function checkHash() {
  const h = location.hash;
  if (h !== '#vim-settings' && h !== '#vim-help') return;
  history.replaceState(history.state, '', location.pathname + location.search);
  if (h === '#vim-settings') openSettings(); else openHelp();
}
