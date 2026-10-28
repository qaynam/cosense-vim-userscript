// Entry point: boot, setup / teardown, config, project switching.
import { VERSION, LOG } from './util.js';
import { state, rt } from './state.js';
import { Settings, Store, cfg, loadCfg, clearSessionOpts, sessionOpts } from './settings.js';
import { waitCosense, cosOn, cosOff, layout, projectName } from './env.js';
import { ti, focus, syncRO, resetTextareaCache } from './dom.js';
import { ensureStyles, writeVars, applyCustomCSS, removeCustomCSS, watchColorScheme, resolvedTheme } from './theme.js';
import {
  createIndicator, removeIndicator, showIndicator, observeColPage, syncBarPos, flash,
  setupLNObs, stopLNObs, forceLN, clearLineNumbers, schedLN,
} from './ui.js';
import { setMode, setModeQuiet, clearVL } from './mode.js';
import { onKey, parseBuf } from './keys.js';
import { abortQueue } from './queue.js';
import { bindTextarea, unbindTextarea, onBeforeInput, onWinFocus } from './textarea.js';
import { onNavPageChanged } from './nav.js';
import { consumePendingMark } from './marks.js';
import { cancelRecording } from './repeat.js';
import { setConfigKeymap, resetMapState, parseKeys } from './keymap.js';
import { removeCmdLine } from './cmdline.js';
import { openHelp, openSettings, checkHash } from './overlay.js';
import { charClass, findCharIn, stepW, stepE, stepB } from './motions.js';
import { textObjectIn } from './textobj.js';
import { findInLines } from './search.js';

// ---- cosense events (core) ----
function onLayoutChanged() {
  if (!rt.active) return;
  if (layout() === 'page') {
    setMode('normal'); showIndicator(true);
    setTimeout(() => { bindTextarea(); setupLNObs(); observeColPage(); syncBarPos(); }, 200);
  } else {
    setModeQuiet('insert'); showIndicator(false); stopLNObs();
  }
}
function onPageChanged() {
  if (!rt.active) return;
  resetTextareaCache(); abortQueue(); resetMapState(); cancelRecording();
  if (layout() !== 'page') return;
  setModeQuiet('normal');
  setTimeout(() => { bindTextarea(); setupLNObs(); syncRO(); }, 200);
  onNavPageChanged();
  consumePendingMark();
}
function onResize() { syncBarPos(); schedLN(); }

// ---- setup / teardown ----
function setup() {
  if (rt.active) return;
  rt.active = true;
  ensureStyles();
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('beforeinput', onBeforeInput, true);
  window.addEventListener('focus', onWinFocus);
  window.addEventListener('resize', onResize);
  cosOn('layout:changed', onLayoutChanged);
  cosOn('page:changed', onPageChanged);
  createIndicator();
  applyConfig(cfg.imeGuard);
  if (layout() === 'page') {
    setMode('normal'); showIndicator(true);
    setTimeout(() => { bindTextarea(); focus(); setupLNObs(); observeColPage(); syncBarPos(); }, 100);
  } else onLayoutChanged();
  if (Store.read('seen') == null) { Store.write('seen', 1); setTimeout(() => flash(':help で使い方 / :settings で設定', 4000), 800); }
}
function teardown() {
  if (!rt.active) return;
  rt.active = false;
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('beforeinput', onBeforeInput, true);
  window.removeEventListener('focus', onWinFocus);
  window.removeEventListener('resize', onResize);
  cosOff('layout:changed', onLayoutChanged);
  cosOff('page:changed', onPageChanged);
  stopLNObs(); unbindTextarea(); abortQueue(); resetMapState();
  clearVL(); state.cmdBuf = ''; state.pending = null;
  delete document.body.dataset.vimMode;
  document.body.removeAttribute('data-vim-numbers');
  clearLineNumbers();
  const t = ti(); if (t && cfg.imeGuard) t.readOnly = document.activeElement !== t;   // cosense's own convention
  removeIndicator(); removeCmdLine(); removeCustomCSS();
}
function applyConfig(prevIme) {
  writeVars();
  setConfigKeymap(cfg.keymap);
  if (!rt.active) return;
  applyCustomCSS();
  if (cfg.lineNumbers) document.body.setAttribute('data-vim-numbers', '');
  else document.body.removeAttribute('data-vim-numbers');
  forceLN();
  if (prevIme && !cfg.imeGuard) { const t = ti(); if (t) t.readOnly = false; }
  syncRO();
}
export function reloadConfig() {
  const prevIme = cfg.imeGuard;
  loadCfg(rt.project);
  if (cfg.enabled && !rt.active) setup();
  else if (!cfg.enabled && rt.active) teardown();
  else applyConfig(prevIme);
}
// Always-on: project switch → re-read that project's settings
function onAnyChange() {
  const p = projectName();
  if (p && p !== rt.project) { rt.project = p; clearSessionOpts(); reloadConfig(); }
}

// ---- boot ----
async function boot() {
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (window.innerWidth < 768 && 'ontouchstart' in window)) {
    console.log(LOG, 'Disabled on mobile'); return;
  }
  if (window.__cosenseVimLoaded) return;   // guard against double injection
  window.__cosenseVimLoaded = true;
  if (!(await waitCosense())) { console.warn(LOG, 'cosense global not found'); return; }

  rt.project = projectName();
  loadCfg(rt.project);
  watchColorScheme();
  cosOn('page:changed', onAnyChange);
  cosOn('layout:changed', onAnyChange);
  window.addEventListener('hashchange', checkHash);
  window.cosenseVim = {
    version: VERSION,
    get state() { return { ...state }; },
    get config() { return { ...cfg }; },
    get active() { return rt.active; },
    settings: Settings,
    openHelp, openSettings,
    enable() { sessionOpts.enabled = true; reloadConfig(); },
    disable() { sessionOpts.enabled = false; reloadConfig(); },
    // pure helpers, exposed for tests and debugging
    _t: { parseBuf, charClass, findCharIn, stepW, stepE, stepB, textObjectIn, findInLines, parseKeys },
  };
  if (cfg.enabled) setup();
  else console.log(LOG, `disabled for "${rt.project}" — open #vim-settings to change`);
  checkHash();
  console.log(LOG, VERSION, 'loaded', `(project: ${rt.project}, ${Settings.hasProject(rt.project) ? 'project settings' : 'global settings'}, theme: ${resolvedTheme()})`);
}
boot();
