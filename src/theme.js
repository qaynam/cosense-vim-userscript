// Theme palettes (as CSS variables) and the static stylesheet.
import { kebab } from './util.js';
import { cfg } from './settings.js';
import { rt } from './state.js';

export const PALETTES = {
  dark: {
    cursor: 'rgba(255,255,255,0.4)', cursorVisual: 'rgba(187,154,247,0.5)', cursorInsert: 'rgba(158,206,106,0.9)',
    lineBorder: 'dotted 1px rgba(255,255,255,0.5)', lineBorderInsert: 'dotted 1px rgba(255,255,255,0.2)',
    barNormalBg: '#1a1a2e', barNormalFg: '#7aa2f7',
    barInsertBg: '#1a2e1a', barInsertFg: '#9ece6a',
    barVisualBg: '#2e1a2e', barVisualFg: '#bb9af7',
    barVlineBg: '#2e1a2e', barVlineFg: '#ff9e64',
    vlSel: 'rgba(187,154,247,0.15)', vlBorder: 'rgba(187,154,247,0.6)',
    yank: 'rgba(224,175,104,0.25)',
    flashBg: 'rgba(30,30,46,0.95)', flashFg: '#cdd6f4', pending: '#e0af68',
    ln: 'rgba(255,255,255,0.3)', lnCur: 'rgba(255,255,255,0.8)',
    cmdBg: '#1a1a2e', cmdFg: '#cdd6f4', cmdBorder: '#7aa2f7',
    ovBackdrop: 'rgba(0,0,0,0.55)', ovBg: '#1e1e2e', ovFg: '#cdd6f4', ovMuted: '#7f849c',
    ovAccent: '#7aa2f7', ovBorder: 'rgba(255,255,255,0.12)', ovTag: '#e0af68',
  },
  light: {
    cursor: 'rgba(0,0,0,0.35)', cursorVisual: 'rgba(120,80,200,0.4)', cursorInsert: 'rgba(40,120,40,0.8)',
    lineBorder: 'dotted 1px rgba(0,0,0,0.3)', lineBorderInsert: 'dotted 1px rgba(0,0,0,0.15)',
    barNormalBg: '#e8eaf0', barNormalFg: '#4060c0',
    barInsertBg: '#e8f0e8', barInsertFg: '#2d8040',
    barVisualBg: '#f0e8f0', barVisualFg: '#8050b0',
    barVlineBg: '#f0ece4', barVlineFg: '#c07030',
    vlSel: 'rgba(120,80,200,0.1)', vlBorder: 'rgba(120,80,200,0.5)',
    yank: 'rgba(200,160,60,0.2)',
    flashBg: 'rgba(250,250,255,0.95)', flashFg: '#333', pending: '#b08030',
    ln: 'rgba(0,0,0,0.3)', lnCur: 'rgba(0,0,0,0.7)',
    cmdBg: '#e8eaf0', cmdFg: '#333', cmdBorder: '#4060c0',
    ovBackdrop: 'rgba(20,20,30,0.35)', ovBg: '#fbfbfd', ovFg: '#2b2b33', ovMuted: '#6b6b78',
    ovAccent: '#4060c0', ovBorder: 'rgba(0,0,0,0.12)', ovTag: '#a06a10',
  },
};

const STATIC_CSS = `
body[data-vim-mode] .editor .lines>.line{border:solid 1px transparent}
body[data-vim-mode] .editor .lines>.line.cursor-line{border:var(--vim-line-border)!important}
body[data-vim-mode="insert"] .editor .lines>.line.cursor-line{border:var(--vim-line-border-insert)!important}
body[data-vim-mode]:not([data-vim-mode="insert"]) .cursor{width:10px!important;background-color:var(--vim-cursor)!important;border-radius:2px}
body[data-vim-mode="visual"] .cursor,body[data-vim-mode="visual-line"] .cursor{background-color:var(--vim-cursor-visual)!important}
body[data-vim-mode]:not([data-vim-mode="insert"]) .cursor svg{display:none!important}
body[data-vim-mode]:not([data-vim-mode="insert"]) .editor .line.cursor-line .text.code-block,
body[data-vim-mode]:not([data-vim-mode="insert"]) .editor .line.cursor-line .code-body{background-color:transparent!important}
body[data-vim-mode="insert"] .cursor{width:auto!important;background-color:transparent!important}
body[data-vim-mode="insert"] .cursor svg{display:block!important}
body[data-vim-mode="insert"] .cursor svg rect{width:2px!important;fill:var(--vim-cursor-insert)!important}
body[data-vim-mode] .editor .line.vim-vl-sel{background:var(--vim-vl-sel)!important;box-shadow:inset 3px 0 0 var(--vim-vl-border)}
body[data-vim-mode] .editor .line.vim-vl-sel .text.code-block,body[data-vim-mode] .editor .line.vim-vl-sel .code-body{background-color:transparent!important}
body[data-vim-mode] .editor .line.vim-yf{background:var(--vim-yank)!important;transition:background .15s}
#vim-ind{position:fixed;bottom:0;z-index:250;padding:4px 16px;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;font-size:12px;font-weight:700;letter-spacing:.05em;display:flex;align-items:center;justify-content:center;gap:12px;pointer-events:none;transition:background .15s,color .15s;box-sizing:border-box}
#vim-ind.vim-mn{background:var(--vim-bar-normal-bg);color:var(--vim-bar-normal-fg);border-top:2px solid var(--vim-bar-normal-fg)}
#vim-ind.vim-mi{background:var(--vim-bar-insert-bg);color:var(--vim-bar-insert-fg);border-top:2px solid var(--vim-bar-insert-fg)}
#vim-ind.vim-mv{background:var(--vim-bar-visual-bg);color:var(--vim-bar-visual-fg);border-top:2px solid var(--vim-bar-visual-fg)}
#vim-ind.vim-ml-m{background:var(--vim-bar-vline-bg);color:var(--vim-bar-vline-fg);border-top:2px solid var(--vim-bar-vline-fg)}
#vim-ind[data-busy] .vim-ml::after{content:' …'}
.vim-mp{color:var(--vim-pending);font-size:14px;position:absolute;right:16px}
.vim-flash{position:fixed;bottom:32px;left:50%;transform:translateX(-50%) translateY(10px);background:var(--vim-flash-bg);color:var(--vim-flash-fg);padding:6px 16px;border-radius:6px;font-family:'SF Mono',monospace;font-size:12px;z-index:100002;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;border:1px solid rgba(128,128,128,.2);max-width:80vw;white-space:pre-wrap}
.vim-flash.vim-fv{opacity:1;transform:translateX(-50%) translateY(0)}
#vim-cmd{position:fixed;bottom:0;z-index:260;padding:4px 0;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;font-size:14px;display:none;align-items:center;box-sizing:border-box;background:var(--vim-cmd-bg);border-top:2px solid var(--vim-cmd-border)}
.vim-cmd-spacer{flex:0 0 calc(50% - 20px)}
.vim-cmd-body{display:flex;align-items:center;gap:2px;flex:1;min-width:0}
.vim-cmd-colon{color:var(--vim-cmd-fg);font-weight:700;flex-shrink:0}
#vim-cmd-input{background:transparent;border:none;outline:none;color:var(--vim-cmd-fg);font-family:inherit;font-size:inherit;flex:1;min-width:0;caret-color:var(--vim-cmd-fg)}
@media screen and (min-width:768px){
body[data-vim-numbers] .app:not(.presentation) .editor .lines>.line:not(.line-title)::before{content:attr(data-vim-ln);position:absolute;display:inline-block;left:-60px;z-index:10;min-width:46px;text-align:right;font-family:'SF Mono','Fira Code',monospace;font-size:16px;line-height:inherit;color:var(--vim-ln);pointer-events:none;user-select:none;transition:color .1s}
body[data-vim-numbers] .app:not(.presentation) .editor .lines>.line.cursor-line:not(.line-title)::before{color:var(--vim-ln-cur);font-weight:700}
}
.vim-ov{position:fixed;inset:0;z-index:100001;background:var(--vim-ov-backdrop);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;box-sizing:border-box}
.vim-ov-panel{background:var(--vim-ov-bg);color:var(--vim-ov-fg);border:1px solid var(--vim-ov-border);border-radius:10px;width:min(860px,100%);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;font-size:14px}
.vim-ov-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--vim-ov-border)}
.vim-ov-title{font-weight:700}
.vim-ov-ver{color:var(--vim-ov-muted);font-size:12px;font-family:'SF Mono',monospace}
.vim-ov-hint{color:var(--vim-ov-muted);font-size:12px;margin-left:auto}
.vim-ov-x{border:none;background:transparent;color:var(--vim-ov-muted);font-size:20px;cursor:pointer;line-height:1;padding:0 4px}
.vim-ov-body{overflow:auto;padding:16px 20px}
.vim-help{margin:0;font-family:'SF Mono','Fira Code',Menlo,Consolas,monospace;font-size:13px;line-height:1.65;white-space:pre;tab-size:8}
.vim-help .vh-tag{color:var(--vim-ov-tag);font-weight:700}
.vim-help .vh-link{color:var(--vim-ov-accent);cursor:pointer}
.vim-help .vh-link:hover{text-decoration:underline}
.vim-help .vh-rule{color:var(--vim-ov-muted)}
.vim-help .vh-flash{background:var(--vim-yank);border-radius:3px}
.vim-st-status{border:1px solid var(--vim-ov-border);border-radius:8px;padding:10px 12px;line-height:1.8}
.vim-badge{display:inline-block;padding:0 8px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid currentColor;line-height:1.6}
.vim-badge.proj{color:var(--vim-bar-visual-fg)}
.vim-badge.glob{color:var(--vim-ov-accent)}
.vim-badge.off{color:var(--vim-ov-muted)}
.vim-st-section{margin:18px 0 6px;font-size:12px;color:var(--vim-ov-muted);font-weight:700;letter-spacing:.04em}
.vim-st-row{display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer}
.vim-st-row small{color:var(--vim-ov-muted)}
.vim-st select{background:var(--vim-ov-bg);color:inherit;border:1px solid var(--vim-ov-border);border-radius:6px;padding:3px 8px;margin-left:8px;font:inherit}
.vim-st textarea{width:100%;min-height:120px;box-sizing:border-box;font-family:'SF Mono',Menlo,monospace;font-size:12px;background:transparent;color:inherit;border:1px solid var(--vim-ov-border);border-radius:6px;padding:8px;resize:vertical}
.vim-st-note{color:var(--vim-ov-muted);font-size:12px;margin-top:6px;line-height:1.7}
.vim-st-foot{display:flex;gap:8px;align-items:center;padding:12px 16px;border-top:1px solid var(--vim-ov-border)}
.vim-st-foot .sp{flex:1}
.vim-btn{border:1px solid var(--vim-ov-border);background:transparent;color:inherit;border-radius:6px;padding:6px 14px;cursor:pointer;font:inherit}
.vim-btn.sm{padding:1px 10px;font-size:12px;margin-left:6px}
.vim-btn.primary{background:var(--vim-ov-accent);border-color:var(--vim-ov-accent);color:#fff}
`;

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export const resolvedTheme = () => cfg.theme === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : cfg.theme;

let watching = false;
export function watchColorScheme() {
  if (!mq || watching) return;
  watching = true;
  const onChange = () => { if (cfg.theme === 'auto') writeVars(); };
  if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
}

function styleEl(id) {
  let s = document.getElementById(id);
  if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
  return s;
}
export function writeVars() {
  const pal = PALETTES[resolvedTheme()];
  styleEl('vim-vars').textContent = ':root{' + Object.entries(pal).map(([k, v]) => `--vim-${kebab(k)}:${v};`).join('') + '}';
}
export function ensureStyles() {
  writeVars();
  const s = styleEl('vim-style');
  if (s.textContent !== STATIC_CSS) s.textContent = STATIC_CSS;
  const c = document.getElementById('vim-custom-css');
  if (c) document.head.appendChild(c);   // custom CSS always last so it wins
}
export function applyCustomCSS() {
  if (!rt.active || !cfg.customCSS.trim()) { document.getElementById('vim-custom-css')?.remove(); return; }
  const c = styleEl('vim-custom-css');
  if (c.textContent !== cfg.customCSS) c.textContent = cfg.customCSS;
  document.head.appendChild(c);
}
export function removeCustomCSS() { document.getElementById('vim-custom-css')?.remove(); }
