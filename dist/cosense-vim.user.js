// ==UserScript==
// @name         Cosense Vim Binding
// @namespace    https://github.com/qaynam/cosense-vim-userscript
// @version      0.31.0
// @description  Vim keybindings for Cosense (Scrapbox).  :help で使い方 / :settings で設定
// @author       qaynam
// @license      MIT
// @homepageURL  https://github.com/qaynam/cosense-vim-userscript
// @supportURL   https://github.com/qaynam/cosense-vim-userscript/issues
// @match        https://scrapbox.io/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=scrapbox.io
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/qaynam/cosense-vim-userscript/main/dist/cosense-vim.user.js
// @downloadURL  https://raw.githubusercontent.com/qaynam/cosense-vim-userscript/main/dist/cosense-vim.user.js
// ==/UserScript==

// Generated from src/ by build.mjs — edit the sources, not this file.

(() => {
  // src/util.js
  var VERSION = "v" + (true ? "0.31.0" : "dev");
  var LOG = "[cosense-vim]";
  var wait = (ms) => new Promise((r) => setTimeout(r, ms));
  var kebab = (k) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var norm = (s) => String(s || "").replace(/\r\n?/g, "\n");
  var swapCase = (s) => Array.from(s).map((c) => {
    const u = c.toUpperCase();
    return c === u ? c.toLowerCase() : u;
  }).join("");
  function safe(fn, fallback) {
    try {
      const v = fn();
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  // src/state.js
  var VIM = "__cosense_vim__";
  var state = {
    mode: "normal",
    // normal | insert | visual | visual-line
    yankReg: "",
    yankType: "line",
    // line | char
    vlStart: -1,
    // anchor line of visual-line mode
    cmdBuf: "",
    // pending count / operator / motion keys
    cmdLine: false,
    // command line is open
    pending: null
    // { type: 'r'|'m'|"'"|'`'|'obj'|'find', count, kind } waiting for one more key
  };
  var rt = {
    active: false,
    // vim core is set up
    passthrough: false,
    // our own synthetic events are in flight
    roLift: 0,
    // >0 while readOnly is temporarily lifted
    busy: 0,
    // async commands in flight
    busyTimer: 0,
    navPending: null,
    // CTRL-O / CTRL-I waiting for page:changed
    pendingMark: null,
    // uppercase mark jump waiting for page:changed
    replaying: false,
    // "." replay in progress (don't record)
    project: ""
  };
  var queue = [];

  // src/settings.js
  var LS = "cosense-vim:";
  var DEFAULTS = Object.freeze({
    enabled: true,
    theme: "auto",
    // auto | light | dark
    lineNumbers: true,
    relativeNumber: true,
    imeGuard: true,
    // readOnly textarea in non-insert modes
    systemClipboard: true,
    keymap: "",
    // vimrc-style map lines (nnoremap H 0 ...)
    customCSS: ""
  });
  var Store = {
    read(key) {
      try {
        const v = localStorage.getItem(LS + key);
        return v == null ? null : JSON.parse(v);
      } catch (_) {
        return null;
      }
    },
    write(key, val) {
      try {
        localStorage.setItem(LS + key, JSON.stringify(val));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(LS + key);
      } catch (_) {
      }
    },
    keys() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS)) out.push(k.slice(LS.length));
        }
      } catch (_) {
      }
      return out;
    }
  };
  function sanitize(s) {
    const o = {};
    for (const k of Object.keys(DEFAULTS)) {
      const d = DEFAULTS[k];
      const v = s ? s[k] : void 0;
      o[k] = v === void 0 || typeof v !== typeof d ? d : v;
    }
    if (!["auto", "light", "dark"].includes(o.theme)) o.theme = "auto";
    return o;
  }
  var Settings = {
    global() {
      return sanitize(Store.read("global"));
    },
    project(p) {
      const v = Store.read("project:" + p);
      return v ? sanitize(v) : null;
    },
    hasProject(p) {
      return Store.read("project:" + p) != null;
    },
    effective(p) {
      return this.project(p) || this.global();
    },
    saveGlobal(s) {
      return Store.write("global", sanitize(s));
    },
    saveProject(p, s) {
      return Store.write("project:" + p, sanitize(s));
    },
    clearProject(p) {
      Store.remove("project:" + p);
    },
    overriddenProjects() {
      return Store.keys().filter((k) => k.startsWith("project:")).map((k) => k.slice(8)).sort();
    }
  };
  var cfg = { ...DEFAULTS };
  var sessionOpts = {};
  function clearSessionOpts() {
    for (const k of Object.keys(sessionOpts)) delete sessionOpts[k];
  }
  function computeCfg(project) {
    return sanitize({ ...Settings.effective(project), ...sessionOpts });
  }
  function loadCfg(project) {
    Object.assign(cfg, computeCfg(project));
    return cfg;
  }

  // src/env.js
  var cosense = null;
  async function waitCosense() {
    let c = null;
    for (let i = 0; i < 300; i++) {
      c = window.cosense || window.scrapbox;
      if (c && typeof c.on === "function") {
        const lay = safe(() => c.Layout, null);
        const proj = safe(() => c.Project.name, null);
        if (lay && (proj || lay !== "page")) break;
        if (i >= 150 && lay) break;
      }
      await wait(100);
    }
    cosense = c && typeof c.on === "function" ? c : null;
    return cosense;
  }
  var projectName = () => safe(() => cosense.Project.name, "") || decodeURIComponent(location.pathname.split("/")[1] || "");
  var layout = () => safe(() => cosense.Layout, "");
  var pageLines = () => safe(() => cosense.Page.lines, []);
  var pageTitle = () => safe(() => cosense.Page.title, "");
  var lineText = (idx) => {
    const l = pageLines()[idx];
    return l ? l.text : "";
  };
  var lineChars = (idx) => Array.from(lineText(idx));
  var lastLine = () => pageLines().length - 1;
  var showPage = (title) => safe(() => cosense.Page.show(title), null);
  function cosOn(ev, fn) {
    cosense.on(ev, fn);
  }
  function cosOff(ev, fn) {
    const f = cosense.off || cosense.removeListener;
    if (typeof f === "function") f.call(cosense, ev, fn);
  }

  // src/dom.js
  var $ = (s) => document.querySelector(s);
  var edLines = () => document.querySelectorAll(".editor .lines > .line");
  var edCurLine = () => document.querySelector(".editor .lines > .line.cursor-line");
  var lineCount = () => edLines().length;
  var _ti = null;
  function ti() {
    if (!_ti || !_ti.isConnected) _ti = document.getElementById("text-input");
    return _ti;
  }
  function resetTextareaCache() {
    _ti = null;
  }
  function focused() {
    const t = ti();
    return !!t && document.activeElement === t;
  }
  function focus() {
    const t = ti();
    if (t) t.focus();
  }
  function wantRO() {
    return rt.active && cfg.imeGuard && state.mode !== "insert" && layout() === "page";
  }
  function syncRO() {
    const t = ti();
    if (!t || !cfg.imeGuard || rt.roLift) return;
    const w = wantRO();
    if (t.readOnly !== w) t.readOnly = w;
  }
  function withRW(fn) {
    const t = ti();
    rt.roLift++;
    if (cfg.imeGuard && t && t.readOnly) t.readOnly = false;
    try {
      return fn();
    } finally {
      rt.roLift--;
      if (!rt.roLift) syncRO();
    }
  }
  var KM = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Enter: 13, Escape: 27, Tab: 9, Home: 36, End: 35 };
  function mkEv(key, o) {
    o = o || {};
    const letter = /^[a-z]$/i.test(key);
    return new KeyboardEvent("keydown", {
      key,
      code: o.code || (KM[key] ? key : letter ? "Key" + key.toUpperCase() : /^\d$/.test(key) ? "Digit" + key : ""),
      keyCode: o.keyCode || KM[key] || (letter ? key.toUpperCase().charCodeAt(0) : key.charCodeAt(0)),
      bubbles: true,
      cancelable: true,
      ctrlKey: !!o.ctrlKey,
      altKey: !!o.altKey,
      metaKey: !!o.metaKey,
      shiftKey: !!o.shiftKey
    });
  }
  function dk(key, o) {
    const el = ti();
    if (!el) return;
    const ev = mkEv(key, o);
    ev[VIM] = true;
    withRW(() => {
      rt.passthrough = true;
      try {
        el.dispatchEvent(ev);
      } finally {
        rt.passthrough = false;
      }
    });
  }
  function dkRaw(key, o) {
    const el = ti();
    if (!el) return;
    withRW(() => {
      rt.passthrough = true;
      try {
        el.dispatchEvent(mkEv(key, o));
      } finally {
        rt.passthrough = false;
      }
    });
  }
  function vimInsert(text) {
    withRW(() => {
      rt.passthrough = true;
      try {
        document.execCommand("insertText", false, text);
      } finally {
        rt.passthrough = false;
      }
    });
  }
  function clickAt(target, x, y, shift) {
    const o = { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, shiftKey: !!shift };
    target.dispatchEvent(new MouseEvent("mousedown", o));
    target.dispatchEvent(new MouseEvent("mouseup", o));
  }
  function clickLine(el, shift) {
    if (!el) return;
    const t = el.querySelector(".text") || el;
    let r = t.getBoundingClientRect();
    if (r.height && (r.bottom < 0 || r.top > window.innerHeight)) {
      el.scrollIntoView({ block: "nearest" });
      r = t.getBoundingClientRect();
    }
    clickAt(t, r.left + 4, r.top + Math.min(r.height / 2, 10), shift);
  }
  function visibleSpan(el, L, c) {
    const n = lineChars(L).length;
    const pick = (i) => el.querySelector(`.char-index[data-char-index="${i}"]`);
    const visible = (s) => {
      if (!s) return false;
      const r = s.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const want = c >= n ? n - 1 : c;
    for (let d = 0; d < n; d++) {
      for (const i of d ? [want - d, want + d] : [want]) {
        if (i >= 0 && i < n && visible(pick(i))) return { span: pick(i), after: i < c };
      }
    }
    return null;
  }
  function clickSpan(el, hit, shift) {
    const t = el.querySelector(".text") || el;
    let r = hit.span.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      hit.span.scrollIntoView?.({ block: "nearest" });
      r = hit.span.getBoundingClientRect();
    }
    const x = hit.after ? r.right - Math.min(1, r.width / 4) : r.left + Math.min(1, r.width / 4);
    clickAt(t, x, r.top + r.height / 2, shift);
  }
  function placeCursor(L, c, shift) {
    const el = edLines()[L];
    if (!el) return false;
    const lr = (el.querySelector(".text") || el).getBoundingClientRect();
    if (!lr.width && !lr.height) return false;
    const n = lineChars(L).length;
    c = Math.max(0, Math.min(c, n));
    if (!n || isEmptyLine(el)) {
      clickLine(el, shift);
      return true;
    }
    let hit = visibleSpan(el, L, c);
    if (!hit) {
      clickLine(el, shift);
      if (curLineIdx() !== L || !(hit = visibleSpan(el, L, c))) return true;
    }
    clickSpan(el, hit, shift);
    return true;
  }
  function jumpToLine(idx) {
    const ls = edLines();
    if (ls.length) clickLine(ls[Math.max(0, Math.min(idx, ls.length - 1))], false);
  }
  function selectToLine(idx) {
    const ls = edLines();
    if (ls.length) clickLine(ls[Math.max(0, Math.min(idx, ls.length - 1))], true);
  }
  function curLineIdx() {
    const cl = edCurLine();
    if (!cl) return 0;
    const i = Array.prototype.indexOf.call(edLines(), cl);
    return i < 0 ? 0 : i;
  }
  var isEmptyLine = (el) => !!el?.querySelector("br.empty-char-index");
  var lineIdOf = (el) => el?.id?.[0] === "L" ? el.id.slice(1) : el?.id;
  function lineIdxById(id) {
    const el = document.getElementById("L" + id);
    if (!el) return -1;
    return Array.prototype.indexOf.call(edLines(), el);
  }
  function readLineTexts(fr, to) {
    const lines = pageLines();
    const els = edLines();
    const map = /* @__PURE__ */ new Map();
    for (const l of lines) map.set(l.id, l.text);
    const buf = [];
    for (let i = fr; i <= to; i++) buf.push(map.get(lineIdOf(els[i])) ?? lines[i]?.text ?? "");
    return buf;
  }
  function findEmptyLine(from, dir) {
    const ls = pageLines();
    if (!ls.length) return from;
    let i = from + dir;
    while (i >= 0 && i < ls.length && ls[i].text.trim() === "") i += dir;
    while (i >= 0 && i < ls.length && ls[i].text.trim() !== "") i += dir;
    return Math.max(0, Math.min(i, ls.length - 1));
  }
  function contentLineToIdx(num) {
    const ls = edLines();
    if (!ls.length) return 0;
    num = Math.max(1, num);
    let n = 0;
    for (let i = 0; i < ls.length; i++) {
      if (!ls[i].classList.contains("line-title")) n++;
      if (n === num) return i;
    }
    return ls.length - 1;
  }
  function cursorCol() {
    const cl = edCurLine();
    const cur = document.querySelector(".cursor");
    if (!cl || !cur || isEmptyLine(cl)) return 0;
    const c = cur.getBoundingClientRect();
    const cy = c.top + c.height / 2;
    let lastOnRow = -1;
    for (const s of cl.querySelectorAll(".char-index")) {
      const r = s.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (cy < r.top || cy > r.bottom) continue;
      const idx = +s.dataset.charIndex;
      if (Math.abs(r.left - c.left) < 1.5) return idx;
      if (r.left < c.left) lastOnRow = idx;
    }
    return lastOnRow + 1;
  }
  function cursorAtEOL() {
    const cl = edCurLine();
    if (!cl || isEmptyLine(cl)) return true;
    return cursorCol() >= lineChars(curLineIdx()).length;
  }
  function selText() {
    const s = window.getSelection && window.getSelection().toString() || "";
    if (s) return s;
    const t = ti();
    if (t && t.selectionStart !== t.selectionEnd) return t.value.slice(t.selectionStart, t.selectionEnd);
    return "";
  }
  var hasSel = () => selText().length > 0;
  async function toClip(t) {
    if (!cfg.systemClipboard) return;
    try {
      await navigator.clipboard.writeText(t);
    } catch (_) {
    }
  }
  async function fromClip() {
    if (!cfg.systemClipboard) return "";
    try {
      return await navigator.clipboard.readText() || "";
    } catch (_) {
      return "";
    }
  }
  function setYank(text, type) {
    state.yankReg = norm(text);
    state.yankType = type;
    return toClip(state.yankReg);
  }
  async function readPasteSource() {
    const clip = norm(await fromClip());
    const text = clip || state.yankReg;
    const type = text === state.yankReg ? state.yankType : text.includes("\n") ? "line" : "char";
    return { text, type };
  }

  // src/theme.js
  var PALETTES = {
    dark: {
      cursor: "rgba(255,255,255,0.4)",
      cursorVisual: "rgba(187,154,247,0.5)",
      cursorInsert: "rgba(158,206,106,0.9)",
      lineBorder: "dotted 1px rgba(255,255,255,0.5)",
      lineBorderInsert: "dotted 1px rgba(255,255,255,0.2)",
      barNormalBg: "#1a1a2e",
      barNormalFg: "#7aa2f7",
      barInsertBg: "#1a2e1a",
      barInsertFg: "#9ece6a",
      barVisualBg: "#2e1a2e",
      barVisualFg: "#bb9af7",
      barVlineBg: "#2e1a2e",
      barVlineFg: "#ff9e64",
      vlSel: "rgba(187,154,247,0.15)",
      vlBorder: "rgba(187,154,247,0.6)",
      yank: "rgba(224,175,104,0.25)",
      flashBg: "rgba(30,30,46,0.95)",
      flashFg: "#cdd6f4",
      pending: "#e0af68",
      ln: "rgba(255,255,255,0.3)",
      lnCur: "rgba(255,255,255,0.8)",
      cmdBg: "#1a1a2e",
      cmdFg: "#cdd6f4",
      cmdBorder: "#7aa2f7",
      ovBackdrop: "rgba(0,0,0,0.55)",
      ovBg: "#1e1e2e",
      ovFg: "#cdd6f4",
      ovMuted: "#7f849c",
      ovAccent: "#7aa2f7",
      ovBorder: "rgba(255,255,255,0.12)",
      ovTag: "#e0af68"
    },
    light: {
      cursor: "rgba(0,0,0,0.35)",
      cursorVisual: "rgba(120,80,200,0.4)",
      cursorInsert: "rgba(40,120,40,0.8)",
      lineBorder: "dotted 1px rgba(0,0,0,0.3)",
      lineBorderInsert: "dotted 1px rgba(0,0,0,0.15)",
      barNormalBg: "#e8eaf0",
      barNormalFg: "#4060c0",
      barInsertBg: "#e8f0e8",
      barInsertFg: "#2d8040",
      barVisualBg: "#f0e8f0",
      barVisualFg: "#8050b0",
      barVlineBg: "#f0ece4",
      barVlineFg: "#c07030",
      vlSel: "rgba(120,80,200,0.1)",
      vlBorder: "rgba(120,80,200,0.5)",
      yank: "rgba(200,160,60,0.2)",
      flashBg: "rgba(250,250,255,0.95)",
      flashFg: "#333",
      pending: "#b08030",
      ln: "rgba(0,0,0,0.3)",
      lnCur: "rgba(0,0,0,0.7)",
      cmdBg: "#e8eaf0",
      cmdFg: "#333",
      cmdBorder: "#4060c0",
      ovBackdrop: "rgba(20,20,30,0.35)",
      ovBg: "#fbfbfd",
      ovFg: "#2b2b33",
      ovMuted: "#6b6b78",
      ovAccent: "#4060c0",
      ovBorder: "rgba(0,0,0,0.12)",
      ovTag: "#a06a10"
    }
  };
  var STATIC_CSS = `
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
  var mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var resolvedTheme = () => cfg.theme === "auto" ? mq && mq.matches ? "dark" : "light" : cfg.theme;
  var watching = false;
  function watchColorScheme() {
    if (!mq || watching) return;
    watching = true;
    const onChange = () => {
      if (cfg.theme === "auto") writeVars();
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  function styleEl(id) {
    let s = document.getElementById(id);
    if (!s) {
      s = document.createElement("style");
      s.id = id;
      document.head.appendChild(s);
    }
    return s;
  }
  function writeVars() {
    const pal = PALETTES[resolvedTheme()];
    styleEl("vim-vars").textContent = ":root{" + Object.entries(pal).map(([k, v]) => `--vim-${kebab(k)}:${v};`).join("") + "}";
  }
  function ensureStyles() {
    writeVars();
    const s = styleEl("vim-style");
    if (s.textContent !== STATIC_CSS) s.textContent = STATIC_CSS;
    const c = document.getElementById("vim-custom-css");
    if (c) document.head.appendChild(c);
  }
  function applyCustomCSS() {
    if (!rt.active || !cfg.customCSS.trim()) {
      document.getElementById("vim-custom-css")?.remove();
      return;
    }
    const c = styleEl("vim-custom-css");
    if (c.textContent !== cfg.customCSS) c.textContent = cfg.customCSS;
    document.head.appendChild(c);
  }
  function removeCustomCSS() {
    document.getElementById("vim-custom-css")?.remove();
  }

  // src/ui.js
  var _indEl = null;
  var _colRO = null;
  var MODE_LABEL = {
    normal: { t: "-- NORMAL --", c: "vim-mn" },
    insert: { t: "-- INSERT --", c: "vim-mi" },
    visual: { t: "-- VISUAL --", c: "vim-mv" },
    "visual-line": { t: "-- VISUAL LINE --", c: "vim-ml-m" }
  };
  function createIndicator() {
    _indEl?.remove();
    _indEl = document.createElement("div");
    _indEl.id = "vim-ind";
    _indEl.innerHTML = '<div class="vim-ml"></div><div class="vim-mp"></div>';
    document.body.appendChild(_indEl);
    syncBarPos();
    updateIndicator();
  }
  function removeIndicator() {
    _indEl?.remove();
    _indEl = null;
    _colRO?.disconnect();
  }
  function showIndicator(on) {
    if (_indEl) _indEl.style.display = on && !state.cmdLine ? "flex" : "none";
  }
  function setBusyMark(on) {
    if (!_indEl) return;
    if (on) _indEl.dataset.busy = "1";
    else delete _indEl.dataset.busy;
  }
  function updateIndicator() {
    if (!_indEl) return;
    const m = MODE_LABEL[state.mode];
    _indEl.className = m.c;
    _indEl.querySelector(".vim-ml").textContent = m.t;
    const p = state.pending;
    _indEl.querySelector(".vim-mp").textContent = state.cmdBuf + (p ? p.type === "obj" ? p.kind : p.type === "find" ? p.kind : p.type : "");
  }
  function syncBarPos() {
    const col = $(".col-page");
    if (!col) return;
    const r = col.getBoundingClientRect();
    for (const el of [_indEl, document.getElementById("vim-cmd")]) if (el) {
      el.style.left = r.left + "px";
      el.style.width = r.width + "px";
    }
  }
  function observeColPage() {
    if (!("ResizeObserver" in window)) return;
    if (!_colRO) _colRO = new ResizeObserver(() => syncBarPos());
    _colRO.disconnect();
    const c = $(".col-page");
    if (c) _colRO.observe(c);
  }
  function flashEl() {
    let f = $(".vim-flash");
    if (!f) {
      f = document.createElement("div");
      f.className = "vim-flash";
      document.body.appendChild(f);
    }
    return f;
  }
  function flash(msg, ms) {
    ensureStyles();
    const f = flashEl();
    f.textContent = msg;
    f.classList.add("vim-fv");
    clearTimeout(f._t);
    f._t = setTimeout(() => f.classList.remove("vim-fv"), ms || 1500);
  }
  function busy(msg) {
    const f = flashEl();
    clearTimeout(f._t);
    f.textContent = "⏳ " + msg;
    f.classList.add("vim-fv");
  }
  var LN_MARGIN = 40;
  var _lnRaf = 0;
  var _lnObs = null;
  var _lastCI = -2;
  var _lastLen = -1;
  var _lnForce = true;
  var _win = [0, -1];
  function schedLN() {
    if (!rt.active || _lnRaf) return;
    _lnRaf = requestAnimationFrame(doLN);
  }
  function forceLN() {
    _lnForce = true;
    _lastCI = -2;
    _lastLen = -1;
    schedLN();
  }
  function firstBelow(lines, y) {
    let lo = 0, hi = lines.length - 1, ans = lines.length;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (lines[mid].getBoundingClientRect().bottom > y) {
        ans = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    return ans;
  }
  function visibleWindow(lines, margin = 0) {
    const len = lines.length;
    if (!len) return [0, -1];
    const a = firstBelow(lines, 0), b = firstBelow(lines, window.innerHeight);
    return [Math.max(0, a - margin), Math.min(len - 1, b + margin)];
  }
  function doLN() {
    _lnRaf = 0;
    if (!rt.active || !cfg.lineNumbers) return;
    const lines = edLines();
    const len = lines.length;
    if (!len) return;
    let ci = -1;
    const cur = document.querySelector(".editor .lines > .line.cursor-line");
    if (cur) ci = Array.prototype.indexOf.call(lines, cur);
    const rel = cfg.relativeNumber;
    const titleOff = lines[0].classList.contains("line-title") ? 1 : 0;
    const value = (i) => i < titleOff ? "" : rel && ci >= 0 && i !== ci ? String(Math.abs(i - ci)) : String(i + 1 - titleOff);
    const set = (i) => {
      const v = value(i);
      if (lines[i].getAttribute("data-vim-ln") !== v) lines[i].setAttribute("data-vim-ln", v);
    };
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
    _lnForce = false;
    _lastCI = ci;
    _lastLen = len;
  }
  var onLNScroll = () => schedLN();
  function setupLNObs() {
    stopLNObs();
    const c = $(".editor .lines");
    if (!c || !rt.active) return;
    _lnObs = new MutationObserver((muts) => {
      for (const m of muts) if (m.type === "childList" && m.target === c) {
        _lnForce = true;
        break;
      }
      schedLN();
    });
    _lnObs.observe(c, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
    window.addEventListener("scroll", onLNScroll, { passive: true });
    forceLN();
  }
  function stopLNObs() {
    if (_lnObs) {
      _lnObs.disconnect();
      _lnObs = null;
    }
    window.removeEventListener("scroll", onLNScroll);
  }
  function clearLineNumbers() {
    document.querySelectorAll("[data-vim-ln]").forEach((el) => el.removeAttribute("data-vim-ln"));
  }

  // src/keymap.js
  var TIMEOUT = 1e3;
  var SEP = "";
  var maps = { n: /* @__PURE__ */ new Map(), i: /* @__PURE__ */ new Map(), v: /* @__PURE__ */ new Map() };
  var configText = "";
  var sessionLines = [];
  var NAMES = {
    esc: "<Esc>",
    cr: "<CR>",
    enter: "<CR>",
    return: "<CR>",
    bs: "<BS>",
    backspace: "<BS>",
    tab: "<Tab>",
    space: "<Space>",
    lt: "<",
    bar: "|",
    bslash: "\\",
    up: "<Up>",
    down: "<Down>",
    left: "<Left>",
    right: "<Right>",
    del: "<Del>"
  };
  var TOKEN_TO_KEY = {
    "<Esc>": "Escape",
    "<CR>": "Enter",
    "<BS>": "Backspace",
    "<Tab>": "Tab",
    "<Space>": " ",
    "<Up>": "ArrowUp",
    "<Down>": "ArrowDown",
    "<Left>": "ArrowLeft",
    "<Right>": "ArrowRight",
    "<Del>": "Delete"
  };
  var KEY_TO_TOKEN = Object.fromEntries(Object.entries(TOKEN_TO_KEY).map(([t, k]) => [k, t]));
  function parseKeys(str) {
    const out = [];
    const s = Array.from(String(str));
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "<") {
        const close2 = s.indexOf(">", i + 1);
        if (close2 > i + 1) {
          const name = s.slice(i + 1, close2).join("");
          const lower = name.toLowerCase();
          let tok = NAMES[lower];
          const m = /^c-(.)$/i.exec(name);
          if (!tok && m) tok = `<C-${m[1].toLowerCase()}>`;
          if (tok) {
            out.push(tok);
            i = close2;
            continue;
          }
        }
      }
      out.push(s[i]);
    }
    return out;
  }
  function tokenOfEvent(ev) {
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
  var MAP_RE = /^(n|i|v|x)?(?:nore)?map\s+(\S+)\s+(.+)$/;
  var UNMAP_RE = /^(n|i|v|x)?unmap\s+(\S+)$/;
  var modesOf = (m) => !m ? ["n", "v"] : m === "x" ? ["v"] : [m];
  function applyLine(raw) {
    const line = raw.trim();
    if (!line || line.startsWith('"')) return true;
    let m = MAP_RE.exec(line);
    if (m) {
      const lhs = parseKeys(m[2]).join(SEP);
      const rhs = parseKeys(m[3].trim());
      for (const md of modesOf(m[1])) maps[md].set(lhs, rhs);
      return true;
    }
    m = UNMAP_RE.exec(line);
    if (m) {
      const lhs = parseKeys(m[2]).join(SEP);
      for (const md of modesOf(m[1])) maps[md].delete(lhs);
      return true;
    }
    return false;
  }
  function rebuild() {
    for (const k of Object.keys(maps)) maps[k].clear();
    const bad = [];
    configText.split("\n").forEach((l, i) => {
      if (!applyLine(l)) bad.push(i + 1);
    });
    for (const l of sessionLines) applyLine(l);
    return bad;
  }
  function setConfigKeymap(text) {
    configText = text || "";
    return rebuild();
  }
  function addSessionMapLine(line) {
    if (!MAP_RE.test(line.trim()) && !UNMAP_RE.test(line.trim())) return false;
    sessionLines.push(line.trim());
    rebuild();
    return true;
  }
  function validateKeymap(text) {
    const bad = [];
    String(text || "").split("\n").forEach((l, i) => {
      const t = l.trim();
      if (t && !t.startsWith('"') && !MAP_RE.test(t) && !UNMAP_RE.test(t)) bad.push(i + 1);
    });
    return bad;
  }
  function isMapLine(line) {
    return MAP_RE.test(line.trim()) || UNMAP_RE.test(line.trim());
  }
  function listMaps(filter) {
    const label = { n: "n", i: "i", v: "v" };
    const out = [];
    for (const md of filter ? modesOf(filter) : ["n", "i", "v"]) {
      for (const [lhs, rhs] of maps[md]) out.push(`${label[md]}  ${lhs.split(SEP).join("")}  ${rhs.join("")}`);
    }
    return out;
  }
  var pend = { toks: [], evs: [], timer: 0, mode: "n" };
  var modeKey = () => state.mode === "insert" ? "i" : state.mode.startsWith("visual") ? "v" : "n";
  function clearPend() {
    clearTimeout(pend.timer);
    pend.toks = [];
    pend.evs = [];
  }
  var block = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  };
  function emit(rhs) {
    const evs = [];
    for (let i = 0; i < rhs.length; i++) {
      if (rhs[i] === ":" && modeKey() !== "i") {
        const end = rhs.indexOf("<CR>", i + 1);
        if (end > i) {
          evs.push({ _ex: rhs.slice(i + 1, end).join("") });
          i = end;
          continue;
        }
      }
      evs.push(tokenToEvent(rhs[i]));
    }
    enqueue(evs);
  }
  function onTimeout() {
    const toks = pend.toks, evs = pend.evs, md = pend.mode;
    clearPend();
    const exact = maps[md].get(toks.join(SEP));
    if (exact) emit(exact);
    else enqueue(evs.map((e) => ({ ...e, _noremap: true })));
  }
  function hasLonger(map, key) {
    const pre = key + SEP;
    for (const k of map.keys()) if (k.startsWith(pre)) return true;
    return false;
  }
  function mapKey(ev) {
    if (ev._noremap) return false;
    const md = modeKey();
    const map = maps[md];
    if (!map.size && !pend.toks.length) return false;
    if (state.pending || md !== "i" && state.cmdBuf && !/^\d+$/.test(state.cmdBuf)) return false;
    const tok = tokenOfEvent(ev);
    if (!tok) {
      if (pend.toks.length) {
        const evs = pend.evs;
        clearPend();
        enqueue(evs.map((e) => ({ ...e, _noremap: true })));
      }
      return false;
    }
    const toks = [...pend.toks, tok];
    const key = toks.join(SEP);
    if (hasLonger(map, key)) {
      pend.toks = toks;
      pend.evs.push(snap(ev));
      pend.mode = md;
      block(ev);
      clearTimeout(pend.timer);
      pend.timer = setTimeout(onTimeout, TIMEOUT);
      return true;
    }
    const exact = map.get(key);
    if (exact) {
      clearPend();
      block(ev);
      emit(exact);
      return true;
    }
    if (pend.toks.length) {
      const evs = pend.evs;
      clearPend();
      block(ev);
      enqueue([...evs.map((e) => ({ ...e, _noremap: true })), snap(ev)]);
      return true;
    }
    return false;
  }
  function resetMapState() {
    clearPend();
  }

  // src/motions.js
  var moveH = () => dk("ArrowLeft");
  var moveJ = () => dk("ArrowDown");
  var moveK = () => dk("ArrowUp");
  var moveL = () => dk("ArrowRight");
  var move0 = () => dk("a", { ctrlKey: true, code: "KeyA", keyCode: 65 });
  var move$ = () => dk("e", { ctrlKey: true, code: "KeyE", keyCode: 69 });
  var moveGG = () => dk("ArrowUp", { metaKey: true });
  var moveGEnd = () => dk("ArrowDown", { metaKey: true });
  var moveLineUp = () => dkRaw("ArrowUp", { altKey: true, code: "ArrowUp", keyCode: 38 });
  var moveLineDown = () => dkRaw("ArrowDown", { altKey: true, code: "ArrowDown", keyCode: 40 });
  var indentRight = () => dk("ArrowRight", { ctrlKey: true, code: "ArrowRight", keyCode: 39 });
  var indentLeft = () => dk("ArrowLeft", { ctrlKey: true, code: "ArrowLeft", keyCode: 37 });
  var FAST = 6;
  function pressArrows(delta, shift) {
    if (!delta) return;
    const key = delta > 0 ? "ArrowRight" : "ArrowLeft";
    const n = Math.min(Math.abs(delta), 5e3);
    const o = shift ? { shiftKey: true } : void 0;
    withRW(() => {
      for (let i = 0; i < n; i++) dk(key, o);
    });
  }
  var _settle = Promise.resolve();
  var _deferred = 0;
  var motionSettled = () => _settle;
  var here = () => ({ L: curLineIdx(), c: cursorCol() });
  var same = (a, b) => a.L === b.L && a.c === b.c;
  function arrowTo(L, c, select) {
    let d = arrowDelta(here(), { L, c });
    if (Math.abs(d) > FAST && curLineIdx() === L) {
      const n = lineChars(L).length;
      if (c < Math.abs(d) && c <= n - c) dk("ArrowLeft", { metaKey: true, shiftKey: !!select });
      else if (n - c < Math.abs(d)) dk("ArrowRight", { metaKey: true, shiftKey: !!select });
      d = arrowDelta(here(), { L, c });
    }
    pressArrows(d, select);
  }
  function moveToPos(pos, select) {
    if (!_deferred) {
      const p = moveNow(pos, select);
      if (p) track(p);
      return;
    }
    track(_settle.then(() => moveNow(pos, select)));
  }
  function track(p) {
    _deferred++;
    _settle = p.finally(() => {
      _deferred--;
    });
  }
  function moveNow(pos, select) {
    const L = Math.max(0, Math.min(pos.L, lineCount() - 1));
    const c = Math.max(0, Math.min(pos.c, lineChars(L).length));
    const from = here();
    if (same(from, { L, c })) return null;
    if (Math.abs(arrowDelta(from, { L, c })) <= FAST || !placeCursor(L, c, select)) {
      arrowTo(L, c, select);
      return null;
    }
    if (!same(here(), from)) {
      arrowTo(L, c, select);
      return null;
    }
    return new Promise((res) => requestAnimationFrame(() => {
      try {
        arrowTo(L, c, select);
      } finally {
        res();
      }
    }));
  }
  async function gotoPos(L, c) {
    if (hasSel()) dk("ArrowLeft");
    moveToPos({ L, c }, false);
    await _settle;
  }
  function lineJump(target, select) {
    const col = cursorCol();
    target = Math.max(0, Math.min(target, lineCount() - 1));
    moveToPos({ L: target, c: Math.min(col, lineChars(target).length) }, select);
  }
  function charClass(ch, big) {
    if (ch === void 0) return -1;
    if (/\s/.test(ch) || ch === "　") return 0;
    if (big) return 1;
    const c = ch.codePointAt(0);
    if (/[A-Za-z0-9_]/.test(ch) || c >= 192 && c <= 591 || c >= 65296 && c <= 65305 || c >= 65313 && c <= 65370) return 1;
    if (c >= 12352 && c <= 12447) return 3;
    if (c >= 12448 && c <= 12543 || c >= 65382 && c <= 65439) return 4;
    if (c >= 19968 && c <= 40959 || c >= 13312 && c <= 19903 || ch === "々") return 5;
    if (c < 128 || c >= 12288 && c <= 12351 || c >= 65280 && c <= 65381) return 2;
    return 1;
  }
  function stepW(pos, big, getChars = lineChars, last2 = lastLine()) {
    let { L, c } = pos;
    let ch = getChars(L);
    if (c < ch.length) {
      const k = charClass(ch[c], big);
      if (k !== 0) while (c < ch.length && charClass(ch[c], big) === k) c++;
      while (c < ch.length && charClass(ch[c], big) === 0) c++;
      if (c < ch.length) return { L, c };
    }
    while (L < last2) {
      L++;
      ch = getChars(L);
      c = 0;
      if (!ch.length) return { L, c };
      while (c < ch.length && charClass(ch[c], big) === 0) c++;
      if (c < ch.length) return { L, c };
    }
    return { L, c: ch.length };
  }
  function stepE(pos, big, getChars = lineChars, last2 = lastLine()) {
    let { L, c } = pos;
    let ch = getChars(L);
    c++;
    for (; ; ) {
      while (c < ch.length && charClass(ch[c], big) === 0) c++;
      if (c < ch.length) break;
      if (L >= last2) return { L, c: Math.max(0, ch.length - 1) };
      L++;
      ch = getChars(L);
      c = 0;
    }
    const k = charClass(ch[c], big);
    while (c + 1 < ch.length && charClass(ch[c + 1], big) === k) c++;
    return { L, c };
  }
  function stepB(pos, big, getChars = lineChars) {
    let { L, c } = pos;
    let ch = getChars(L);
    c--;
    for (; ; ) {
      while (c >= 0 && charClass(ch[c], big) === 0) c--;
      if (c >= 0) break;
      if (L <= 0) return { L, c: 0 };
      L--;
      ch = getChars(L);
      c = ch.length - 1;
      if (!ch.length) return { L, c: 0 };
    }
    const k = charClass(ch[c], big);
    while (c > 0 && charClass(ch[c - 1], big) === k) c--;
    return { L, c };
  }
  function arrowDelta(a, b, getChars = lineChars) {
    if (a.L === b.L) return b.c - a.c;
    const len = (i) => getChars(i).length;
    if (b.L > a.L) {
      let d2 = len(a.L) - a.c + 1;
      for (let i = a.L + 1; i < b.L; i++) d2 += len(i) + 1;
      return d2 + b.c;
    }
    let d = a.c + 1;
    for (let i = b.L + 1; i < a.L; i++) d += len(i) + 1;
    return -(d + len(b.L) - b.c);
  }
  function wordTarget(kind, count, forOp) {
    const big = kind === kind.toUpperCase();
    const k = kind.toLowerCase();
    const start = { L: curLineIdx(), c: cursorCol() };
    let pos = start;
    for (let i = 0; i < count; i++) pos = k === "w" ? stepW(pos, big) : k === "e" ? stepE(pos, big) : stepB(pos, big);
    if (forOp && k === "w" && pos.L > start.L) pos = { L: start.L, c: lineChars(start.L).length };
    if (forOp && k === "e") pos = { L: pos.L, c: Math.min(pos.c + 1, lineChars(pos.L).length) };
    return { start, pos };
  }
  function wordMotion(kind, count, select, forOp) {
    const { start, pos } = wordTarget(kind, count, forOp || select);
    if (pos.L === start.L && pos.c === start.c) return;
    moveToPos(pos, select);
  }
  var lastFind = { kind: "", ch: "" };
  var INVERT = { f: "F", F: "f", t: "T", T: "t" };
  function findCharIn(chars, col, kind, ch, count, inclusive, repeat) {
    let n = Math.max(1, count);
    if (kind === "f" || kind === "t") {
      const start2 = col + 1 + (repeat && kind === "t" ? 1 : 0);
      for (let j = start2; j < chars.length; j++) {
        if (chars[j] === ch && --n === 0) {
          const t = kind === "f" ? j : j - 1;
          return inclusive ? t + 1 : t;
        }
      }
      return -1;
    }
    const start = col - 1 - (repeat && kind === "T" ? 1 : 0);
    for (let j = start; j >= 0; j--) {
      if (chars[j] === ch && --n === 0) return kind === "F" ? j : j + 1;
    }
    return -1;
  }
  function findTarget(kind, ch, count, inclusive) {
    let repeat = false;
    if (kind === ";" || kind === ",") {
      if (!lastFind.kind) return -1;
      repeat = true;
      ch = lastFind.ch;
      kind = kind === ";" ? lastFind.kind : INVERT[lastFind.kind];
    } else {
      lastFind.kind = kind;
      lastFind.ch = ch;
    }
    const backward = kind === "F" || kind === "T";
    return findCharIn(lineChars(curLineIdx()), cursorCol(), kind, ch, count, inclusive && !backward, repeat);
  }
  function findMotion(kind, ch, count, select) {
    const t = findTarget(kind, ch, count, select);
    if (t < 0) return false;
    moveToPos({ L: curLineIdx(), c: t }, select);
    return true;
  }
  function headerBottom() {
    const nav = document.querySelector(".navbar");
    return nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
  }
  function visibleRange() {
    const els = edLines();
    const top = headerBottom();
    const bottom = window.innerHeight - 26;
    let first = -1, last2 = -1;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.bottom <= top) continue;
      if (r.top >= bottom) break;
      if (first < 0 && r.top >= top - 1) first = i;
      if (r.bottom <= bottom + 1) last2 = i;
    }
    const cur = curLineIdx();
    return [first < 0 ? cur : first, last2 < 0 ? cur : last2];
  }
  function screenLine(key, count) {
    const [first, last2] = visibleRange();
    if (key === "H") return Math.min(first + count - 1, last2);
    if (key === "L") return Math.max(last2 - count + 1, first);
    return Math.floor((first + last2) / 2);
  }
  function doMotion(key, count, explicit, ch) {
    switch (key) {
      case "G":
        if (explicit) jumpToLine(contentLineToIdx(count));
        else moveGEnd();
        return;
      case "{":
      case "}": {
        let i = curLineIdx();
        for (let c = 0; c < count; c++) i = findEmptyLine(i, key === "{" ? -1 : 1);
        jumpToLine(i);
        return;
      }
      case "j":
      case "k":
        if (count > 1) {
          lineJump(curLineIdx() + (key === "j" ? count : -count), false);
          return;
        }
        break;
      case "0":
      case "^":
        move0();
        return;
      case "$":
        move$();
        return;
      case "H":
      case "M":
      case "L":
        jumpToLine(screenLine(key, count));
        return;
      case "w":
      case "W":
      case "e":
      case "E":
      case "b":
      case "B":
        wordMotion(key, count, false, false);
        return;
      case "f":
      case "t":
      case "F":
      case "T":
      case ";":
      case ",":
        findMotion(key, ch, count, false);
        return;
    }
    for (let i = 0; i < count; i++) {
      switch (key) {
        case "h":
          moveH();
          break;
        case "j":
          moveJ();
          break;
        case "k":
          moveK();
          break;
        case "l":
          moveL();
          break;
      }
    }
  }
  function doSelMotion(key, count, ch) {
    switch (key) {
      case "0":
      case "^":
        dk("ArrowLeft", { metaKey: true, shiftKey: true });
        return;
      case "$":
        dk("ArrowRight", { metaKey: true, shiftKey: true });
        return;
      case "w":
      case "W":
      case "e":
      case "E":
      case "b":
      case "B":
        wordMotion(key, count, true, false);
        return;
      case "f":
      case "t":
      case "F":
      case "T":
      case ";":
      case ",":
        findMotion(key, ch, count, true);
        return;
      case "H":
      case "M":
      case "L":
        extendSelToLine(screenLine(key, count));
        return;
      case "{":
      case "}": {
        let i = curLineIdx();
        for (let c = 0; c < count; c++) i = findEmptyLine(i, key === "{" ? -1 : 1);
        extendSelToLine(i);
        return;
      }
    }
    if ((key === "j" || key === "k") && count > 1) {
      lineJump(curLineIdx() + (key === "j" ? count : -count), true);
      return;
    }
    const map = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" };
    if (map[key]) withRW(() => {
      for (let i = 0; i < count; i++) dk(map[key], { shiftKey: true });
    });
  }
  function extendSelToLine(target) {
    target = Math.max(0, Math.min(target, lineCount() - 1));
    if (Math.abs(target - curLineIdx()) > 1) {
      lineJump(target, true);
      if (_deferred || curLineIdx() === target) return;
    }
    for (let round = 0; round < 10; round++) {
      const cur = curLineIdx();
      const d = target - cur;
      if (!d) return;
      const key = d > 0 ? "ArrowDown" : "ArrowUp";
      withRW(() => {
        for (let i = 0, n = Math.min(Math.abs(d), 300); i < n; i++) dk(key, { shiftKey: true });
      });
      if (curLineIdx() === cur) return;
    }
  }
  function selectToEdge(dir) {
    const target = dir < 0 ? 0 : lineCount() - 1;
    dk(dir < 0 ? "ArrowUp" : "ArrowDown", { metaKey: true, shiftKey: true });
    if (curLineIdx() !== target) selectToLine(target);
  }
  function halfScroll(dir) {
    const se = document.scrollingElement || document.documentElement;
    const half = window.innerHeight >> 1;
    if (dir > 0 && se.scrollTop >= se.scrollHeight - se.clientHeight - 1) return;
    if (dir < 0 && se.scrollTop <= 0) return;
    const cel = $(".cursor");
    const screenY = cel ? cel.getBoundingClientRect().top + cel.getBoundingClientRect().height / 2 : window.innerHeight / 2;
    window.scrollBy({ top: dir * half, behavior: "instant" });
    const wantScroll = se.scrollTop;
    const ls = edLines();
    let best = 0, bd = Infinity;
    for (let i = 0; i < ls.length; i++) {
      const mid = ls[i].getBoundingClientRect().top + ls[i].offsetHeight / 2;
      const d = Math.abs(mid - screenY);
      if (d < bd) {
        bd = d;
        best = i;
      } else if (d > bd + 100) break;
    }
    jumpToLine(best);
    se.scrollTop = wantScroll;
    let f = 0;
    const iv = setInterval(() => {
      se.scrollTop = wantScroll;
      if (++f >= 6) clearInterval(iv);
    }, 30);
  }
  function lineScroll(dir) {
    const cl = edCurLine();
    if (!cl) return;
    const lh = cl.offsetHeight || 36;
    window.scrollBy({ top: dir * lh, behavior: "instant" });
    requestAnimationFrame(() => {
      const cur = edCurLine();
      if (!cur) return;
      const cr = cur.getBoundingClientRect();
      const edge = lh * 3;
      if (dir > 0 && cr.top < edge) moveJ();
      else if (dir < 0 && cr.bottom > window.innerHeight - edge) moveK();
    });
  }
  function scrollCursorTo(where) {
    const cl = edCurLine();
    if (!cl) return;
    const r = cl.getBoundingClientRect();
    const top = headerBottom() + 8, bottom = window.innerHeight - 34;
    const delta = where === "t" ? r.top - top : where === "b" ? r.bottom - bottom : r.top - window.innerHeight / 2 + r.height / 2;
    window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
  }

  // src/textobj.js
  var PAIRS = {
    "(": ["(", ")"],
    ")": ["(", ")"],
    b: ["(", ")"],
    "[": ["[", "]"],
    "]": ["[", "]"],
    "{": ["{", "}"],
    "}": ["{", "}"],
    B: ["{", "}"],
    "<": ["<", ">"],
    ">": ["<", ">"]
  };
  var QUOTES = /* @__PURE__ */ new Set(['"', "'", "`"]);
  var TEXTOBJ_CHARS = /* @__PURE__ */ new Set(["w", "W", ...Object.keys(PAIRS), ...QUOTES]);
  function wordObj(chars, col, around, big, count) {
    const cls = (i) => charClass(chars[i], big);
    const k = cls(col);
    let s = col, e = col;
    while (s > 0 && cls(s - 1) === k) s--;
    while (e < chars.length && cls(e) === k) e++;
    for (let n = 1; n < count; n++) {
      const k2 = cls(e);
      while (e < chars.length && cls(e) === k2) e++;
    }
    if (around) {
      if (k !== 0) {
        let e2 = e;
        while (e2 < chars.length && cls(e2) === 0) e2++;
        if (e2 > e) e = e2;
        else while (s > 0 && cls(s - 1) === 0) s--;
      } else {
        const k2 = cls(e);
        while (e < chars.length && cls(e) === k2) e++;
      }
    }
    return { start: s, end: e };
  }
  function enclosing(chars, col, open, close2) {
    let depth = 0, s = -1;
    for (let i = col; i >= 0; i--) {
      if (chars[i] === close2 && i !== col) depth++;
      else if (chars[i] === open) {
        if (depth === 0) {
          s = i;
          break;
        }
        depth--;
      }
    }
    if (s < 0) return null;
    depth = 0;
    for (let j = s + 1; j < chars.length; j++) {
      if (chars[j] === open) depth++;
      else if (chars[j] === close2) {
        if (depth === 0) return [s, j];
        depth--;
      }
    }
    return null;
  }
  function pairObj(chars, col, [open, close2], around, count) {
    let r = enclosing(chars, col, open, close2);
    if (!r) {
      const nx = chars.indexOf(open, col);
      if (nx < 0) return null;
      r = enclosing(chars, nx, open, close2);
      if (!r) return null;
    }
    for (let n = 1; n < count && r[0] > 0; n++) {
      const o = enclosing(chars, r[0] - 1, open, close2);
      if (!o) break;
      r = o;
    }
    return around ? { start: r[0], end: r[1] + 1 } : { start: r[0] + 1, end: r[1] };
  }
  function quoteObj(chars, col, q, around) {
    const idx = [];
    chars.forEach((c, i) => {
      if (c === q) idx.push(i);
    });
    const pick = (a, b) => {
      if (!around) return { start: a + 1, end: b };
      let e = b + 1;
      while (e < chars.length && /\s/.test(chars[e])) e++;
      return { start: a, end: e };
    };
    for (let p = 0; p + 1 < idx.length; p += 2) if (col >= idx[p] && col <= idx[p + 1]) return pick(idx[p], idx[p + 1]);
    for (let p = 0; p + 1 < idx.length; p += 2) if (idx[p] > col) return pick(idx[p], idx[p + 1]);
    return null;
  }
  function textObjectIn(chars, col, obj, count = 1) {
    if (!chars.length) return null;
    const around = obj[0] === "a";
    const ch = obj[1];
    col = Math.max(0, Math.min(col, chars.length - 1));
    if (ch === "w" || ch === "W") return wordObj(chars, col, around, ch === "W", count);
    if (PAIRS[ch]) return pairObj(chars, col, PAIRS[ch], around, count);
    if (QUOTES.has(ch)) return quoteObj(chars, col, ch, around);
    return null;
  }
  function selectTextObject(obj, count) {
    if (hasSel()) dk("ArrowLeft");
    const chars = lineChars(curLineIdx());
    const r = textObjectIn(chars, cursorCol(), obj, count);
    if (!r) return false;
    const L = curLineIdx();
    moveToPos({ L, c: r.start }, false);
    moveToPos({ L, c: r.end }, true);
    return true;
  }

  // src/edit.js
  var killEOL = () => dk("k", { ctrlKey: true, code: "KeyK", keyCode: 75 });
  var undo = () => dk("z", { metaKey: true, code: "KeyZ", keyCode: 90 });
  var redo = () => dk("z", { metaKey: true, shiftKey: true, code: "KeyZ", keyCode: 90 });
  function flashLines(fr, to) {
    const els = edLines();
    const hit = [];
    for (let i = fr; i <= to; i++) if (els[i]) {
      els[i].classList.add("vim-yf");
      hit.push(els[i]);
    }
    setTimeout(() => hit.forEach((el) => el.classList.remove("vim-yf")), 300);
  }
  async function selectCharsFwd(count) {
    if (isEmptyLine(edCurLine())) return "";
    const room = Math.max(0, lineChars(curLineIdx()).length - cursorCol());
    const n = Math.min(count, room);
    moveToPos({ L: curLineIdx(), c: cursorCol() + n }, true);
    await motionSettled();
    await wait(10);
    const sel = selText();
    if (sel.includes("\n")) {
      dk("ArrowLeft");
      return "";
    }
    return sel;
  }
  async function deleteCharsFwd(count) {
    let sel = await selectCharsFwd(count);
    if (!sel) {
      if (isEmptyLine(edCurLine()) || cursorCol() === 0) return;
      dk("ArrowLeft", { shiftKey: true });
      await wait(10);
      sel = selText();
      if (!sel || sel.includes("\n")) {
        if (sel) dk("ArrowRight");
        return;
      }
    }
    await setYank(sel, "char");
    dk("Backspace");
  }
  async function substituteChars(count) {
    const sel = await selectCharsFwd(count);
    if (sel) {
      await setYank(sel, "char");
      dk("Backspace");
    }
    setMode("insert");
  }
  async function replaceChars(ch, count) {
    const sel = await selectCharsFwd(count);
    if (!sel) return;
    vimInsert(ch.repeat(Array.from(sel).length));
    dk("ArrowLeft");
  }
  async function toggleCaseN(count) {
    const sel = await selectCharsFwd(count);
    if (sel) vimInsert(swapCase(sel));
  }
  async function selectToEOL() {
    dk("ArrowRight", { shiftKey: true, metaKey: true });
    await wait(10);
    const s = selText();
    if (s.includes("\n")) {
      dk("ArrowLeft");
      return "";
    }
    return s;
  }
  async function deleteToEOL() {
    const sel = await selectToEOL();
    if (!sel) return;
    await setYank(sel, "char");
    dk("Backspace");
  }
  async function changeToEOL() {
    const sel = await selectToEOL();
    if (sel) {
      await setYank(sel, "char");
      dk("Backspace");
    }
    setMode("insert");
  }
  async function joinLines(count) {
    const times = Math.max(1, count - 1);
    const cursor = $(".cursor");
    const savedX = cursor ? cursor.getBoundingClientRect().left : null;
    const L = curLineIdx();
    const to = Math.min(L + times, lineCount() - 1);
    if (to <= L) return;
    if (to - L >= 2 && !await joinBySelection(L, to)) return;
    if (to - L < 2) {
      for (let i = L; i < to; i++) {
        move$();
        killEOL();
      }
    }
    await wait(20);
    if (savedX !== null) {
      const cl = edCurLine();
      if (cl) {
        const t = cl.querySelector(".text") || cl;
        const r = t.getBoundingClientRect();
        clickAt(t, savedX, r.top + Math.min(r.height / 2, 10));
      }
    }
  }
  async function joinBySelection(L, to) {
    const rest = readLineTexts(L + 1, to);
    move$();
    moveToPos({ L: to, c: lineChars(to).length }, true);
    await motionSettled();
    await wait(10);
    if (norm(selText()) !== "\n" + rest.join("\n")) {
      if (hasSel()) dk("ArrowLeft");
      flash("Join failed");
      return false;
    }
    vimInsert(rest.join(""));
    return true;
  }
  async function openLine(below) {
    if (below) {
      move$();
      await wait(15);
      dk("Enter");
    } else {
      move0();
      await wait(15);
      dk("Enter");
      await wait(15);
      moveK();
    }
    await wait(15);
    setMode("insert");
  }
  async function paste(after) {
    let { text, type } = await readPasteSource();
    if (!text) {
      flash("Nothing to paste");
      return;
    }
    if (type === "line") {
      text = text.replace(/\n$/, "");
      const n = text.split("\n").length;
      if (after) {
        move$();
        await wait(20);
        vimInsert("\n" + text);
      } else {
        move0();
        await wait(20);
        vimInsert(text + "\n");
        await wait(30);
        moveK();
      }
      flash("Pasted " + n + "L");
    } else {
      if (after && !cursorAtEOL()) {
        moveL();
        await wait(10);
      }
      vimInsert(text);
      flash("Pasted");
    }
  }
  async function selectLinesThrough(fr, to) {
    const ls = edLines();
    const last2 = ls.length - 1;
    jumpToLine(fr);
    await wait(30);
    move0();
    await wait(15);
    if (to < last2) {
      const el = ls[to + 1].querySelector(".text") || ls[to + 1];
      const r = el.getBoundingClientRect();
      clickAt(el, r.left, r.top + 2, true);
    } else {
      dk("ArrowDown", { metaKey: true, shiftKey: true });
      if (curLineIdx() !== last2) {
        extendSelToLine(last2);
        await motionSettled();
      }
      dk("ArrowRight", { metaKey: true, shiftKey: true });
    }
    await wait(30);
    return hasSel();
  }
  async function selectLinesInner(fr, to) {
    const ls = edLines();
    jumpToLine(fr);
    await wait(30);
    move0();
    await wait(15);
    if (to - fr > 30) {
      const el = ls[to].querySelector(".text") || ls[to];
      const r = el.getBoundingClientRect();
      clickAt(el, r.right - 2, r.bottom - 4, true);
    } else if (to > fr) {
      extendSelToLine(to);
      await motionSettled();
    }
    dk("ArrowRight", { metaKey: true, shiftKey: true });
    await wait(30);
    return hasSel();
  }
  async function killLineAt(idx) {
    if (curLineIdx() !== idx) {
      jumpToLine(idx);
      await wait(20);
    }
    const cl = edCurLine();
    if (!cl) return;
    const total = lineCount();
    if (!isEmptyLine(cl)) {
      move0();
      await wait(10);
      killEOL();
      await wait(10);
    }
    if (idx === 0) {
      if (total > 1) {
        killEOL();
        await wait(10);
      }
      return;
    }
    dk("Backspace");
    await wait(20);
    if (idx < total - 1) {
      moveJ();
      move0();
    }
    if (!focused()) focus();
  }
  async function removeLines(fr, to, keepEmpty) {
    const last2 = lineCount() - 1;
    if (fr === to && keepEmpty) {
      if (curLineIdx() !== fr) {
        jumpToLine(fr);
        await wait(20);
      }
      move0();
      await wait(10);
      if (!isEmptyLine(edCurLine())) killEOL();
      return true;
    }
    if (!await selectLinesThrough(fr, to)) {
      flash("Selection failed");
      return false;
    }
    dk("Backspace");
    await wait(30);
    if (to >= last2) {
      if (!keepEmpty && fr > 0) {
        dk("Backspace");
        await wait(20);
      }
    } else if (keepEmpty) {
      vimInsert("\n");
      await wait(20);
      moveK();
    }
    return true;
  }
  async function linewise(op, fr, to) {
    const last2 = lineCount() - 1;
    if (last2 < 0) return;
    fr = Math.max(0, Math.min(fr, last2));
    to = Math.max(fr, Math.min(to, last2));
    const n = to - fr + 1;
    await setYank(readLineTexts(fr, to).join("\n"), "line");
    if (op === "y") {
      flashLines(fr, to);
      flash("Yanked " + n + "L");
      return;
    }
    if (n > 3) busy((op === "d" ? "Deleting " : "Changing ") + n + "L...");
    if (op === "d") {
      if (n === 1) await killLineAt(fr);
      else await removeLines(fr, to, false);
      flash("Deleted " + n + "L");
    } else {
      await removeLines(fr, to, true);
      if (n > 3) flash("Changed " + n + "L");
      setMode("insert");
    }
  }
  function linewiseCount(op, n) {
    const cur = curLineIdx();
    return linewise(op, cur, cur + n - 1);
  }
  async function execOp(op, mot, count, explicit, extra) {
    const cur = curLineIdx();
    if (mot === "j" || mot === "k") return linewise(op, mot === "j" ? cur : cur - count, mot === "j" ? cur + count : cur);
    if (mot === "G" || mot === "gg") {
      const target = explicit ? contentLineToIdx(count) : mot === "G" ? lineCount() - 1 : contentLineToIdx(1);
      return linewise(op, Math.min(cur, target), Math.max(cur, target));
    }
    if (mot === "H" || mot === "M" || mot === "L") {
      const t = screenLine(mot, count);
      return linewise(op, Math.min(cur, t), Math.max(cur, t));
    }
    if (mot === "obj") {
      if (!selectTextObject(extra, count)) {
        if (op === "c") setMode("insert");
        return;
      }
    } else {
      if (op === "c" && (mot === "w" || mot === "W")) mot = mot === "w" ? "e" : "E";
      if (mot === "{" || mot === "}") {
        let i = cur;
        for (let c = 0; c < count; c++) i = findEmptyLine(i, mot === "{" ? -1 : 1);
        extendSelToLine(i);
      } else if ("wWeEbB".includes(mot)) wordMotion(mot, count, true, true);
      else if ("fFtT;,".includes(mot)) {
        if (!findMotion(mot, extra, count, true)) return;
      } else doSelMotion(mot, count);
    }
    await motionSettled();
    await wait(20);
    const sel = selText();
    if (!sel) {
      if (op === "c") setMode("insert");
      return;
    }
    await setYank(sel, "char");
    if (op === "y") {
      dk("ArrowLeft");
      flash("Yanked");
      return;
    }
    dk("Backspace");
    if (op === "c") setMode("insert");
    else flash("Deleted");
  }
  async function vYank() {
    const t = selText();
    if (t) {
      await setYank(t, "char");
      dk("ArrowLeft");
      flash("Yanked");
    }
    setMode("normal");
  }
  async function vYankPlain() {
    await wait(50);
    const btn = $(".popup-menu .copy-plain-button");
    if (btn) {
      btn.click();
      flash("Copied plain text");
    } else {
      const t = selText();
      if (t) await setYank(t, "char");
      flash("Yanked (plain fallback)");
    }
    setMode("normal");
  }
  async function vDelete() {
    const t = selText();
    if (t) {
      await setYank(t, "char");
      dk("Backspace");
      flash("Deleted");
    }
    setMode("normal");
  }
  async function vSubst() {
    const t = selText();
    if (t) {
      await setYank(t, "char");
      dk("Backspace");
    }
    setMode("insert");
  }
  async function vPaste() {
    const sel = selText();
    const { text } = await readPasteSource();
    if (!text) {
      flash("Nothing to paste");
      setMode("normal");
      return;
    }
    if (sel) {
      dk("Backspace");
      await wait(15);
    }
    vimInsert(text);
    if (sel) await setYank(sel, "char");
    flash("Pasted over");
    setMode("normal");
  }
  async function vToggleCase() {
    const sel = selText();
    if (sel) {
      dk("Backspace");
      await wait(10);
      vimInsert(swapCase(sel));
    }
    setMode("normal");
  }
  async function vlYank() {
    const [fr, to] = vlRange();
    await linewise("y", fr, to);
    setMode("normal");
  }
  async function vlDelete() {
    const [fr, to] = vlRange();
    clearVL();
    await linewise("d", fr, to);
    setMode("normal");
  }
  async function vlChange() {
    const [fr, to] = vlRange();
    clearVL();
    await linewise("c", fr, to);
  }
  async function vlPaste() {
    const [fr, to] = vlRange();
    const n = to - fr + 1;
    const old = readLineTexts(fr, to).join("\n");
    let { text } = await readPasteSource();
    text = text.replace(/\n$/, "");
    if (!text) {
      flash("Nothing to paste");
      setMode("normal");
      return;
    }
    clearVL();
    if (n > 3) busy("Pasting over " + n + "L...");
    if (await removeLines(fr, to, true)) {
      vimInsert(text);
      await setYank(old, "line");
      flash("Pasted over " + n + "L");
    }
    setMode("normal");
  }
  async function vlYankPlain() {
    const [fr, to] = vlRange();
    clearVL();
    await selectLinesInner(fr, to);
    await wait(60);
    const btn = $(".popup-menu .copy-plain-button");
    if (btn) {
      btn.click();
      flash("Copied plain text");
    } else {
      await setYank(readLineTexts(fr, to).join("\n"), "line");
      flash("Yanked (plain fallback)");
    }
    setMode("normal");
  }
  async function vlIndent(right, count) {
    const [fr, to] = vlRange();
    const back = curLineIdx();
    if (fr !== to) {
      if (!await selectLinesInner(fr, to)) return;
    }
    for (let i = 0; i < count; i++) (right ? indentRight : indentLeft)();
    await wait(20);
    if (fr !== to) {
      jumpToLine(back);
      await wait(20);
    }
    updateVL();
  }

  // src/search.js
  var last = { pattern: "", dir: 1 };
  var charLen = (s) => Array.from(s).length;
  var unitOf = (s, charIdx) => Array.from(s).slice(0, Math.max(0, charIdx)).join("").length;
  function findInLines(texts, L, c, pattern, dir) {
    if (!pattern || !texts.length) return null;
    const ci = !/[A-Z]/.test(pattern);
    const needle = ci ? pattern.toLowerCase() : pattern;
    const n = texts.length;
    for (let k = 0; k <= n; k++) {
      const li = ((L + dir * k) % n + n) % n;
      const text = ci ? texts[li].toLowerCase() : texts[li];
      const wrapped = dir > 0 ? li < L || k === n : li > L || k === n;
      if (dir > 0) {
        const from = k === 0 ? unitOf(text, c + 1) : 0;
        const u = text.indexOf(needle, from);
        if (u >= 0 && (k < n || u <= unitOf(text, c))) return { L: li, c: charLen(text.slice(0, u)), wrapped };
      } else {
        const curU = unitOf(text, c);
        const u = k === 0 ? curU > 0 ? text.lastIndexOf(needle, curU - 1) : -1 : text.lastIndexOf(needle);
        if (u >= 0 && (k < n || u >= curU)) return { L: li, c: charLen(text.slice(0, u)), wrapped };
      }
    }
    return null;
  }
  function jumpNext(dir, count) {
    const texts = pageLines().map((l) => l.text);
    let L = curLineIdx(), c = cursorCol(), hit = null, wrapped = false;
    for (let i = 0; i < Math.max(1, count); i++) {
      const r = findInLines(texts, L, c, last.pattern, dir);
      if (!r) break;
      hit = r;
      wrapped = wrapped || r.wrapped;
      L = r.L;
      c = r.c;
    }
    if (!hit) {
      flash("E486: Pattern not found: " + last.pattern);
      return;
    }
    run(() => gotoPos(hit.L, hit.c));
    const p = (last.dir > 0 ? "/" : "?") + last.pattern;
    flash(wrapped ? (dir > 0 ? "search hit BOTTOM, continuing at TOP  " : "search hit TOP, continuing at BOTTOM  ") + p : p);
  }
  function search(pattern, dir) {
    if (pattern) last.pattern = pattern;
    if (!last.pattern) {
      flash("E35: No previous regular expression");
      return;
    }
    last.dir = dir;
    jumpNext(dir, 1);
  }
  function searchNext(sameDir, count) {
    if (!last.pattern) {
      flash("E35: No previous regular expression");
      return;
    }
    jumpNext(sameDir ? last.dir : -last.dir, count);
  }
  function searchWord(dir) {
    const chars = lineChars(curLineIdx());
    const r = textObjectIn(chars, cursorCol(), "iw");
    const word = r ? chars.slice(r.start, r.end).join("") : "";
    if (!word.trim()) {
      flash("E348: No string under cursor");
      return;
    }
    last.pattern = word;
    last.dir = dir;
    jumpNext(dir, 1);
  }

  // src/textarea.js
  var _bound = null;
  var _roObs = null;
  function bindTextarea() {
    const t = ti();
    if (!t) return;
    if (t === _bound) {
      syncRO();
      return;
    }
    unbindTextarea();
    _bound = t;
    t.addEventListener("blur", onBlur);
    t.addEventListener("focus", onFocus);
    t.addEventListener("compositionend", onCompositionEnd);
    _roObs = new MutationObserver(() => {
      if (!rt.roLift && cfg.imeGuard && wantRO() && !t.readOnly) t.readOnly = true;
    });
    _roObs.observe(t, { attributes: true, attributeFilter: ["readonly"] });
    syncRO();
  }
  function unbindTextarea() {
    if (!_bound) return;
    _bound.removeEventListener("blur", onBlur);
    _bound.removeEventListener("focus", onFocus);
    _bound.removeEventListener("compositionend", onCompositionEnd);
    _roObs?.disconnect();
    _roObs = null;
    _bound = null;
  }
  function onBlur() {
    setTimeout(() => {
      if (!rt.active || state.cmdLine) return;
      if (state.cmdBuf || state.pending) resetBuf();
      if (!focused() && state.mode !== "normal") setModeQuiet("normal");
    }, 80);
  }
  function onFocus() {
    setTimeout(syncRO, 0);
  }
  function onCompositionEnd(e) {
    if (state.mode === "insert" && !rt.passthrough) onInsertText(e.data || "");
  }
  function onBeforeInput(e) {
    if (!rt.active || rt.passthrough) return;
    const t = ti();
    if (!t || e.target !== t) return;
    if (state.mode === "insert") {
      if (e.inputType === "insertText" && e.data) onInsertText(e.data);
      return;
    }
    if (!cfg.imeGuard || rt.roLift) return;
    if (e.inputType === "insertCompositionText" || e.inputType === "insertFromComposition") e.preventDefault();
  }
  function onWinFocus() {
    setTimeout(() => {
      if (rt.active) {
        bindTextarea();
        syncRO();
      }
    }, 0);
  }

  // src/nav.js
  var navCursor = /* @__PURE__ */ new Map();
  function saveNavCursor() {
    if (focused()) navCursor.set(location.pathname, curLineIdx());
  }
  function navGo(dir) {
    saveNavCursor();
    const token = { scheduled: false };
    rt.navPending = token;
    if (dir < 0) history.back();
    else history.forward();
    flash(dir < 0 ? "Back" : "Forward");
    setTimeout(() => {
      if (rt.navPending === token && !token.scheduled) restoreNav();
    }, 1200);
  }
  function onNavPageChanged() {
    if (rt.navPending && !rt.navPending.scheduled) {
      rt.navPending.scheduled = true;
      setTimeout(restoreNav, 200);
    }
  }
  function restoreNav() {
    rt.navPending = null;
    resetTextareaCache();
    if (!rt.active || layout() !== "page") return;
    focus();
    setMode("normal");
    const saved = navCursor.get(location.pathname);
    setTimeout(() => {
      const total = lineCount();
      if (!total) return;
      jumpToLine(saved !== void 0 ? Math.min(saved, total - 1) : 0);
      setTimeout(() => {
        focus();
        bindTextarea();
        schedLN();
      }, 50);
    }, 300);
  }
  function followLink() {
    const cl = edCurLine();
    const cursor = $(".cursor");
    if (!cl || !cursor) {
      flash("No link");
      return;
    }
    const cr = cursor.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let target = null, bestD = Infinity;
    for (const sp of cl.querySelectorAll(".char-index")) {
      const r = sp.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        target = sp;
        break;
      }
      if (cy >= r.top && cy <= r.bottom) {
        const d = Math.abs(cx - (r.left + r.width / 2));
        if (d < bestD) {
          bestD = d;
          target = sp;
        }
      }
    }
    if (!target) {
      flash("No link");
      return;
    }
    const imageSpan = target.closest(".image");
    if (imageSpan) {
      const prev = imageSpan.previousElementSibling;
      if (prev) {
        (prev.querySelector("img") || prev).click();
        flash("Image preview");
        return;
      }
    }
    const anchor = target.closest("a[href]");
    if (anchor) {
      saveNavCursor();
      const r = anchor.getBoundingClientRect();
      const o = { button: 0, clientX: r.left + 4, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, view: window };
      anchor.dispatchEvent(new MouseEvent("mousedown", o));
      anchor.dispatchEvent(new MouseEvent("mouseup", o));
      anchor.dispatchEvent(new MouseEvent("click", o));
      flash("Following link");
      return;
    }
    const linkSpan = target.closest(".link") || target.closest('[type="link"]');
    if (linkSpan) {
      const text = linkSpan.textContent.trim();
      const url = text.match(/(https?:\/\/[^\s\]]+)/);
      if (url) {
        window.open(url[1], "_blank");
        flash("Opening URL");
        return;
      }
      if (text) {
        saveNavCursor();
        showPage(text.replace(/^\[|\]$/g, ""));
        flash("Following link");
        return;
      }
    }
    flash("No link under cursor");
  }

  // src/marks.js
  var marks = /* @__PURE__ */ new Map();
  var keyOf = (name) => name === name.toLowerCase() ? location.pathname + "" + name : name;
  function setMark(name) {
    const cl = edCurLine();
    if (!cl) return;
    marks.set(keyOf(name), { name, path: location.pathname, lineId: lineIdOf(cl), col: cursorCol(), title: pageTitle() });
    flash("mark " + name);
  }
  async function jumpMark(name, exact) {
    const m = marks.get(keyOf(name));
    if (!m) {
      flash("E20: Mark not set");
      return;
    }
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
    if (idx < 0) {
      flash("E19: Mark has invalid line (行が削除されています)");
      return;
    }
    await gotoPos(idx, col);
  }
  function consumePendingMark() {
    if (!rt.pendingMark) return;
    const p = rt.pendingMark;
    rt.pendingMark = null;
    setTimeout(() => run(() => gotoLineId(p.lineId, p.col)), 400);
  }
  function listMarks() {
    const out = [];
    for (const m of marks.values()) {
      if (m.name === m.name.toLowerCase() && m.path !== location.pathname) continue;
      out.push(`${m.name}  ${m.title}${m.path === location.pathname ? "" : " (別ページ)"}`);
    }
    return out.sort();
  }

  // src/help.js
  function helpText() {
    const vars = Object.keys(PALETTES.light).map((k) => "      --vim-" + kebab(k)).join("\n");
    return `*cosense-vim.txt*      Cosense Vim Binding  ${VERSION}

                 Cosense (旧 Scrapbox) のための Vim キーバインド

==============================================================================
目次                                                    *cosense-vim-contents*

  1. はじめに                     |cosense-vim-intro|
  2. 設定                         |cosense-vim-settings|
  3. モード                       |cosense-vim-modes|
  4. ノーマルモード               |cosense-vim-normal|
  5. テキストオブジェクト         |cosense-vim-textobj|
  6. 繰り返し・マーク・検索       |cosense-vim-repeat|
  7. ビジュアルモード             |cosense-vim-visual|
  8. ビジュアル行モード           |cosense-vim-vline|
  9. コマンドライン               |cosense-vim-cmdline|
 10. オプション                   |cosense-vim-options|
 11. キーマップ                   |cosense-vim-keymap|
 12. 日本語入力 (IME)             |cosense-vim-ime|
 13. カスタム CSS                 |cosense-vim-css|
 14. 制限事項                     |cosense-vim-limits|

==============================================================================
1. はじめに                                                *cosense-vim-intro*

Cosense のエディターに Vim 風のモーダル編集を追加します。
カーソルや選択範囲は Cosense 自身のものをそのまま使い、Vim のキー操作を
Cosense のキー操作 (Emacs 風キーバインド、Shift+矢印など) に翻訳して
送っています。

Vim が動くのは、エディター (textarea#text-input) にフォーカスがある
ときだけです。検索ボックスなど他の入力欄では普段どおり入力できます。
どこにもフォーカスがないときは : と CTRL-O / CTRL-I だけが使えます。

このヘルプの操作
    j  k            スクロール
    CTRL-D  CTRL-U  半画面スクロール
    gg  G           先頭 / 末尾
    q  Esc          閉じる
    縦棒で囲まれた語 (例: |cosense-vim-normal|) はクリックで移動します。

==============================================================================
2. 設定                                                 *cosense-vim-settings*

開き方                                                           *:settings*
    :settings               (:VimSettings でも可)
    URL の末尾に #vim-settings を付けて開く
        例: https://scrapbox.io/プロジェクト名/#vim-settings
    Vim を無効にしたプロジェクトでも、URL からなら開けます。
    このヘルプは #vim-help で開けます。

設定は 2 段階です。
    グローバル設定          専用設定のないすべてのプロジェクトに適用
    プロジェクト専用設定    そのプロジェクトだけに適用 (グローバルより優先)

設定画面の上部に、今のプロジェクトがどちらを使っているかと、Vim が
有効かどうかが表示されます。専用設定を持つプロジェクトの一覧も
確認できます。保存先はこのブラウザの localStorage です。

項目
    有効                    Vim を使うかどうか
    テーマ                  auto (OS に追従) / light / dark
    行番号                  行番号を表示する
    相対行番号              カーソル行からの距離で表示する
    IME ガード              ノーマルモードで日本語入力を止める
                            |cosense-vim-ime|
    システムクリップボード  ヤンク / ペーストで OS のクリップボードを使う
                            オフにすると内部レジスタだけを使います
    キーマップ              |cosense-vim-keymap|
    カスタム CSS            |cosense-vim-css|

==============================================================================
3. モード                                                  *cosense-vim-modes*

    NORMAL        移動とコマンド。ページを開いたときはこのモード
    INSERT        普通の入力。Cosense の機能はすべてそのまま使えます
    VISUAL        文字単位の選択 (v)
    VISUAL LINE   行単位の選択 (V)

    Esc  CTRL-C  CTRL-[     ノーマルモードに戻る
    画面下のバーに現在のモードと入力途中のキーが表示されます。

==============================================================================
4. ノーマルモード                                         *cosense-vim-normal*

{N} は回数です。多くのコマンドの前に数字を付けられます (例: 3j 5x)。

移動                                                       *cosense-vim-motion*
    h  j  k  l          左 下 上 右   (矢印キーもそのまま使えます)
    w                   次の単語の先頭へ                               *w*
    e                   単語の末尾へ                                   *e*
    b                   前の単語の先頭へ                               *b*
    W  E  B             空白区切りの単語 (WORD) 単位で同じ動き
                        ひらがな・カタカナ・漢字・英数字・記号の
                        切れ目を単語の境目として扱います
    0  ^                行頭
    $                   行末
    f{char}             行内で右にある {char} へ                       *f*
    t{char}             行内で右にある {char} の手前へ                 *t*
    F{char}  T{char}    左向きに同じ動き                           *F* *T*
    ;  ,                直前の f t F T を同じ向き / 逆向きに繰り返す
                        ノーマルモードでは日本語を打てないので、{char} は
                        英数字と記号だけです (f[  t]  f( など)
    gg                  ページの先頭        {N}gg  {N} 行目へ
    G                   ページの末尾        {N}G   {N} 行目へ
    {  }                前 / 次の空行へ (段落単位)
    H  M  L             画面の一番上 / 真ん中 / 一番下の行へ       *H* *M* *L*

スクロール
    CTRL-D  CTRL-U      半画面スクロール (カーソルも一緒に動く)
    CTRL-E  CTRL-Y      1 行スクロール。カーソルは画面端から 3 行目で
                        止まって画面内に残ります
    zz  zt  zb          カーソル行を画面の中央 / 上端 / 下端へ    *zz* *zt* *zb*

挿入
    i                   カーソルの位置で挿入
    a                   カーソルの次で挿入 (行末では i と同じ)
    I  A                行頭 / 行末で挿入
    o  O                下 / 上に新しい行を作って挿入

編集                                                         *cosense-vim-edit*
    x                   カーソルの文字を削除。行末では直前の 1 文字。  *x*
                        改行は消しません。{N}x で {N} 文字
    s                   文字を消して挿入                               *s*
    S                   行の中身を消して挿入 (cc と同じ)               *S*
    D                   行末まで削除 (消した部分だけをヤンク)          *D*
    C                   行末まで消して挿入                             *C*
    r{char}             カーソルの文字を {char} に置き換え             *r*
    ~                   大文字 / 小文字を反転                          *~*
    J                   下の行をつなげる。カーソル位置は保つ           *J*
    >  <                インデント / アウトデント
    ALT-J  ALT-K        行を下 / 上へ移動
    u                   アンドゥ                                       *u*
    CTRL-R              リドゥ
    p                   下 (行) / 後ろ (文字) にペースト               *p*
    P                   上 (行) / 前 (文字) にペースト                 *P*
                        ペーストはシステムクリップボードを優先し、
                        読めないときは内部レジスタを使います。

オペレータ                                             *cosense-vim-operator*
    dd  yy  cc          行の削除 / ヤンク / 変更             *dd* *yy* *cc*
                        {N}dd で {N} 行。dd を続けると下へ順に消えます
    d{motion}           {motion} の範囲を削除
    y{motion}           {motion} の範囲をヤンク
    c{motion}           {motion} の範囲を消して挿入 (cw は ce と同じ)
    行単位になる motion:    j  k  G  gg  H  M  L   (例: 3dj  dG  ygg)
    文字単位になる motion:  w e b W E B 0 ^ $ h l { } f t F T ; ,
                            (例: dw  c$  dt]  cf)  y;)
    テキストオブジェクトも使えます (例: ciw  di[  ya")
                            |cosense-vim-textobj|
    数字は前にも後ろにも付けられます (2dw  d2w)。
    dgg はタイトル行を消さず、1 行目までを対象にします。

ナビゲーション                                       *cosense-vim-navigation*
    gd                  カーソル下のリンクを開く                       *gd*
                          内部リンク・他プロジェクトのリンク
                              Cosense にクリックを渡して遷移
                          外部 URL ([タイトル URL] 形式も可)
                              新しいタブで開く
                          画像
                              プレビューを開く (q / Esc で閉じる)
    CTRL-O              戻る。戻った先でカーソル行を復元              *CTRL-O*
    CTRL-I              進む                                          *CTRL-I*

==============================================================================
5. テキストオブジェクト                                  *cosense-vim-textobj*

オペレータ (d c y) の後ろ、またはビジュアルモードで使います。
i は中身だけ、a は囲みや前後の空白を含みます。

    iw  aw              単語                                   *iw* *aw*
    iW  aW              空白区切りの単語 (WORD)
    i[  a[              [ ] の中      i]  a]  も同じ           *i[* *a[*
    i(  a(              ( ) の中      i)  ib  a)  ab  も同じ
    i{  a{              { } の中      i}  iB  a}  aB  も同じ
    i<  a<              < > の中
    i"  a"              " " の中                               *i"* *a"*
    i'  a'              ' ' の中
    i\`  a\`              \` \` の中 (Cosense のコード記法)

カーソルが括弧の中にないときは、その行で右にある最初の括弧が対象です。
{N} を付けると外側の括弧まで広がります (2i[)。

Cosense での使い方の例
    ci[                 リンク [ページ名] の中身だけを書き換える
    da[                 リンクを括弧ごと削除する
    vi[*                リンクの中身を選んで太字にする (Cosense の装飾)
    ci\`                 インラインコードの中身を書き換える

==============================================================================
6. 繰り返し・マーク・検索                                 *cosense-vim-repeat*

繰り返し                                                               *.*
    .                   直前の変更を繰り返す。{N}. で回数を置き換えます
                        dd x >  J p ~ r{char} や d{motion} c{motion} など
                        挿入を伴う変更 (cw o A など) は、入力した文字も
                        含めて繰り返します (日本語の確定文字も含む)

マーク                                                     *cosense-vim-marks*
    m{a-z}              このページの中でカーソル位置を記録              *m*
    m{A-Z}              ページをまたいで使えるマーク
    '{mark}             マークした行の先頭へ                            *'*
    \`{mark}             マークした位置 (列まで) へ
    :marks              マークの一覧
    マークは行の ID で覚えるので、上に行を足したり消したりしても
    ずれません。マークした行を消すとジャンプできなくなります。
    マークはタブを閉じると消えます。

検索                                                      *cosense-vim-search*
    /{pattern}          下向きに検索 (Enter で実行)                    */*
    ?{pattern}          上向きに検索                                   *?*
    n  N                同じ向き / 逆向きに次を探す                *n* *N*
    *  #                カーソル下の単語を下向き / 上向きに検索
    検索は普通の文字列一致です (正規表現ではありません)。
    パターンに大文字が入っていなければ大文字小文字を区別しません。
    検索欄は普通の入力欄なので日本語で検索できます。
    末尾まで行くと先頭に戻って続けます。

==============================================================================
7. ビジュアルモード                                       *cosense-vim-visual*

v で始めます。選択範囲は Cosense のものをそのまま使います。

    h j k l w e b W E B 0 ^ $   選択範囲を広げる ({N} 可)
    f t F T ; ,                 文字まで広げる
    矢印キー                    同上
    {  }  H  M  L               空行 / 画面の上・中・下まで広げる
    gg  G                       ページの先頭 / 末尾まで広げる
    iw  i[  a"  など            テキストオブジェクトを選ぶ
    y                           ヤンク                               *v_y*
    Y                           プレーンテキストでコピー             *v_Y*
                                (Cosense の「プレーンテキストをコピー」)
    d  x                        削除                                 *v_d*
    c  s                        消して挿入                           *v_c*
    p                           選択範囲をペーストで置き換える。     *v_p*
                                消えたテキストはクリップボードへ
                                (Neovim と同じ動き)
    ~                           大文字 / 小文字を反転
    >  <                        インデント / アウトデント
    ALT-J  ALT-K                行の移動
    V                           ビジュアル行モードへ
    v                           ノーマルモードへ

Cosense の装飾キー                                         *cosense-vim-deco*
選択中に次のキーを押すと Cosense 自身の装飾機能が働きます。
    [                           [選択]       リンク
    *                           [* 選択]     太字
    -                           [- 選択]     打ち消し
    /                           [/ 選択]     斜体
    _                           [_ 選択]     下線
    \`                           \`選択\`       コード
選択がないときは何もしません (文字も入りません)。

==============================================================================
8. ビジュアル行モード                                      *cosense-vim-vline*

V で始めます。行単位で選択し、選択行は帯で表示されます。

    j  k  {N}j              範囲を広げる (矢印の上下も可)
    {  }  gg  G  H  M  L    空行 / 先頭 / 末尾 / 画面位置まで広げる
    y                       行をヤンク
    Y                       プレーンテキストでコピー
    d  x                    行を削除
    c  s                    行を消して、空行 1 行で挿入
    p                       行をペーストで置き換える (消えた行はクリップボードへ)
    >  <                    選択行をまとめてインデント。モードは続きます
    v  V                    ノーマルモードへ

==============================================================================
9. コマンドライン                                        *cosense-vim-cmdline*

: で開きます。上下キーで履歴をたどれます。日本語入力の変換確定の
Enter では実行されません。

    :{N}                {N} 行目へ (タイトルの次が 1 行目)            *:N*
    :e {タイトル}       ページを開く (ない場合は新規作成)             *:e*
    :new                新しいページ                                  *:new*
    :w                  保存が終わるのを待つ                          *:w*
    :q                  エディターからフォーカスを外す                *:q*
    :cpll               カーソル行のリンク (行パーマリンク) をコピー  *:cpll*
    :cpmdl              ページの Markdown リンクをコピー             *:cpmdl*
                        [タイトル](URL)
    :marks              マークの一覧                                 *:marks*
    :map  :nmap  :imap  :vmap   キーマップの一覧                     *:map*
    :nnoremap {lhs} {rhs}       キーマップを追加 (このタブだけ)
                        |cosense-vim-keymap|
    :set {option}       オプションを変更 |cosense-vim-options|         *:set*
    :settings           設定画面 |cosense-vim-settings|
    :help [{topic}]     このヘルプ。:h でも可                         *:help*
                        例:  :help dd   :help ci[   :help ime

==============================================================================
10. オプション                                           *cosense-vim-options*

:set で変えた値はこのタブを開いている間だけ有効です。
ずっと使うときは :settings で保存してください。

    :set                                今の値を表示
    :set number / nonumber              行番号 (nu / nonu)
    :set relativenumber / norelativenumber
                                        相対行番号 (rnu / nornu)
    :set background=dark                テーマ (light / dark / auto)
    :set imeguard / noimeguard          IME ガード
    :set {option}!                      切り替え (例 :set rnu!)

==============================================================================
11. キーマップ                                            *cosense-vim-keymap*

設定画面の「キーマップ」に vimrc と同じ形で書きます。1 行に 1 つです。

    nnoremap {lhs} {rhs}    ノーマルモード
    inoremap {lhs} {rhs}    インサートモード
    vnoremap {lhs} {rhs}    ビジュアル / ビジュアル行モード (xnoremap も可)
    noremap  {lhs} {rhs}    ノーマルとビジュアルの両方
    nunmap {lhs}  など      割り当てを消す
    "                       で始まる行はコメント

例
    inoremap jk <Esc>       インサートモードで jk を押すとノーマルへ
    nnoremap H 0
    nnoremap L $
    nnoremap <Space>w :w<CR>
    nnoremap <C-n> }

使えるキーの書き方
    <Esc>  <CR>  <BS>  <Tab>  <Space>  <lt>  <Up> <Down> <Left> <Right>
    <C-x>  (Ctrl+x)

  - 割り当てはすべて再帰しません (map も noremap と同じ扱い)。
  - 右辺が :{コマンド}<CR> のときは、そのコマンドを直接実行します。
  - 複数キーの割り当ては、続きのキーを 1 秒待ちます。待っている間、
    インサートモードでは 1 文字目の表示が少し遅れます。
  - オペレータの後 (d の次など) には適用されません。
  - :nnoremap などをコマンドラインで打つと、このタブだけ有効です。

==============================================================================
12. 日本語入力 (IME)                                         *cosense-vim-ime*

ノーマル / ビジュアルモードの間は textarea#text-input を readOnly にして、
IME が起動しないようにしています。日本語入力のままでも j k などの
コマンドがそのまま使えます。インサートモードに入ると元に戻ります。

Cosense がウィンドウのフォーカスの変化などで readOnly を書き換えても、
すぐに付け直します。

うまく動かないときは設定の「IME ガード」をオフにしてください。

==============================================================================
13. カスタム CSS                                             *cosense-vim-css*

設定画面の「カスタム CSS」は Vim が有効なときだけ読み込まれ、組み込みの
スタイルより後に適用されます。

色は CSS 変数で上書きできます。
    :root {
      --vim-cursor: rgba(255, 80, 80, .5);
    }

変数の一覧
${vars}

状態は body の属性で分かります。
    body[data-vim-mode="normal"]        モードごと (insert / visual /
                                        visual-line も同様)
    body[data-vim-numbers]              行番号を表示中

主な要素
    #vim-ind            モードバー
                        .vim-mn .vim-mi .vim-mv .vim-ml-m (モード別)
    #vim-cmd            コマンドライン
    .vim-flash          通知
    .vim-vl-sel         ビジュアル行モードで選択中の行
    .vim-yf             ヤンクしたときの一瞬のハイライト
    .line::before       行番号 (data-vim-ln 属性の値を表示)
    .vim-ov             ヘルプ / 設定画面

例: モードバーを隠す
    #vim-ind { display: none; }

==============================================================================
14. 制限事項                                              *cosense-vim-limits*

  - Cosense の操作を組み合わせて実現しているため、まれに 1 回の u で
    完全に戻らないことがあります。そのときはもう一度 u を押してください。
  - 正規表現での検索、:s 置換、レジスタ指定 ("a)、マクロ (q)、
    矩形ビジュアル (CTRL-V) は未対応です。
  - . で繰り返すのはノーマルモードからの変更だけです。ビジュアルモードで
    した変更は繰り返しません。
  - j k は折り返された行の中では表示上の行単位で動きます。
  - 時間のかかる操作の途中で打ったキーは、順番を保って操作の後に
    実行されます。
  - スマートフォンでは無効です。

 vim:tw=78:ft=help`;
  }

  // src/overlay.js
  var root = null;
  var keyFn = null;
  var isOverlayOpen = () => !!root;
  var stopAll = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  function show(html, onKeyFn) {
    close(true);
    ensureStyles();
    root = document.createElement("div");
    root.className = "vim-ov";
    root.innerHTML = `<div class="vim-ov-panel" role="dialog" aria-modal="true">${html}</div>`;
    root.addEventListener("mousedown", (e) => {
      if (e.target === root) close();
    });
    document.body.appendChild(root);
    keyFn = onKeyFn;
    document.addEventListener("keydown", keyFn, true);
    return root;
  }
  function close(silent) {
    if (!root) return;
    document.removeEventListener("keydown", keyFn, true);
    root.remove();
    root = null;
    keyFn = null;
    if (!silent && rt.active && layout() === "page") setTimeout(() => {
      focus();
      syncRO();
    }, 0);
  }
  function renderHelp(text) {
    return esc(text).split("\n").map((line) => {
      if (/^[=-]{20,}$/.test(line)) return `<span class="vh-rule">${line}</span>`;
      return line.replace(/\*([^\s*|]+)\*/g, (_, t) => `<span class="vh-tag" data-tag="${t}">*${t}*</span>`).replace(/\|([^\s|]+)\|/g, (_, t) => `<a class="vh-link" data-tag="${t}">|${t}|</a>`);
    }).join("\n");
  }
  function jumpHelpTag(topic) {
    if (!root) return;
    const tags = [...root.querySelectorAll(".vh-tag")];
    const t = String(topic).trim();
    let el = null;
    for (const c of [t, "cosense-vim-" + t, ":" + t, t.replace(/^:/, "")]) {
      el = tags.find((x) => x.dataset.tag === c);
      if (el) break;
    }
    if (!el) el = tags.find((x) => x.dataset.tag.includes(t));
    if (!el) {
      flash("E149: ヘルプがありません: " + t);
      return;
    }
    const body = root.querySelector(".vim-ov-body");
    body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    el.classList.add("vh-flash");
    setTimeout(() => el.classList.remove("vh-flash"), 900);
  }
  function openHelp(topic) {
    let gPending = false;
    const r = show(`
<div class="vim-ov-head"><span class="vim-ov-title">:help</span><span class="vim-ov-ver">${VERSION}</span><span class="vim-ov-hint">j / k でスクロール ・ q で閉じる</span><button class="vim-ov-x" data-act="close" title="閉じる">×</button></div>
<div class="vim-ov-body"><pre class="vim-help">${renderHelp(helpText())}</pre></div>`, (e) => {
      if (e.metaKey) return;
      stopAll(e);
      const body = r.querySelector(".vim-ov-body");
      const k = e.key;
      if (k === "q" || k === "Escape") {
        close();
        return;
      }
      if (k === "j" || k === "ArrowDown") body.scrollTop += 40;
      else if (k === "k" || k === "ArrowUp") body.scrollTop -= 40;
      else if (e.ctrlKey && k === "d" || k === "PageDown" || k === " ") body.scrollTop += body.clientHeight / 2;
      else if (e.ctrlKey && k === "u" || k === "PageUp") body.scrollTop -= body.clientHeight / 2;
      else if (k === "G") body.scrollTop = body.scrollHeight;
      else if (k === "g") {
        if (gPending) {
          body.scrollTop = 0;
          gPending = false;
        } else {
          gPending = true;
          setTimeout(() => {
            gPending = false;
          }, 600);
        }
        return;
      }
      gPending = false;
    });
    r.addEventListener("click", (e) => {
      const a = e.target.closest(".vh-link");
      if (a) {
        jumpHelpTag(a.dataset.tag);
        return;
      }
      if (e.target.closest('[data-act="close"]')) close();
    });
    if (topic) setTimeout(() => jumpHelpTag(topic), 0);
  }
  function openSettings() {
    const p = projectName();
    const hasProj = Settings.hasProject(p);
    const eff = Settings.effective(p);
    let scope = hasProj ? "project" : "global";
    const list = Settings.overriddenProjects();
    const r = show(`
<div class="vim-ov-head"><span class="vim-ov-title">Cosense Vim 設定</span><span class="vim-ov-ver">${VERSION}</span><span class="vim-ov-hint">Esc で閉じる ・ ⌘Enter で保存</span><button class="vim-ov-x" data-act="close" title="閉じる">×</button></div>
<div class="vim-ov-body vim-st">
  <div class="vim-st-status">
    プロジェクト <b>${esc(p || "(なし)")}</b> は
    <span class="vim-badge ${hasProj ? "proj" : "glob"}">${hasProj ? "専用設定" : "グローバル設定"}</span> を使用中 ・
    Vim は <span class="vim-badge ${eff.enabled ? "glob" : "off"}">${eff.enabled ? "有効" : "無効"}</span>
    ${hasProj ? '<button class="vim-btn sm" data-act="reset">専用設定を削除</button>' : ""}
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
  <div class="vim-st-note">専用設定のあるプロジェクト: ${list.length ? list.map(esc).join("、") : "なし"}<br>保存先: このブラウザの localStorage（cosense-vim:*）</div>
</div>
<div class="vim-st-foot"><button class="vim-btn" data-act="help">ヘルプ</button><span class="sp"></span><button class="vim-btn" data-act="cancel">キャンセル</button><button class="vim-btn primary" data-act="save">保存</button></div>`, (e) => {
      if (e.key === "Escape") {
        stopAll(e);
        close();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        stopAll(e);
        save();
        return;
      }
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
    const q = (s) => r.querySelector(s);
    function load(sc) {
      const src = sc === "project" ? Settings.project(p) || Settings.global() : Settings.global();
      for (const el of r.querySelectorAll("[data-k]")) {
        if (el.type === "checkbox") el.checked = !!src[el.dataset.k];
        else el.value = src[el.dataset.k];
      }
      q('[data-role="edit-title"]').textContent = sc === "project" ? `「${p}」の専用設定` : "グローバル設定";
      q('[data-role="enabled-label"]').textContent = sc === "project" ? "このプロジェクトで有効にする" : "既定で有効にする";
      q('[data-role="scope-note"]').textContent = sc === "project" ? `「${p}」だけに適用されます。グローバル設定より優先されます。` : `専用設定のないすべてのプロジェクトに適用されます。${hasProj ? `保存すると「${p}」の専用設定は削除されます。` : ""}`;
      q('[data-role="keymap-err"]').textContent = "";
    }
    function read() {
      const o = {};
      for (const el of r.querySelectorAll("[data-k]")) o[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
      return sanitize(o);
    }
    function save() {
      const s = read();
      const bad = validateKeymap(s.keymap);
      if (bad.length) {
        q('[data-role="keymap-err"]').textContent = `キーマップ ${bad.join(", ")} 行目を読めません（例: nnoremap H 0）`;
        return;
      }
      let ok;
      if (scope === "project") ok = Settings.saveProject(p, s);
      else {
        ok = Settings.saveGlobal(s);
        if (ok) Settings.clearProject(p);
      }
      if (!ok) {
        flash("保存に失敗しました (localStorage)");
        return;
      }
      clearSessionOpts();
      close();
      reloadConfig();
      flash(scope === "project" ? `「${p}」の専用設定を保存しました` : "グローバル設定を保存しました");
    }
    r.querySelectorAll('input[name="vim-scope"]').forEach((radio) => {
      radio.checked = radio.value === scope;
      radio.addEventListener("change", () => {
        if (radio.checked) {
          scope = radio.value;
          load(scope);
        }
      });
    });
    load(scope);
    r.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]");
      if (!a) return;
      const act = a.dataset.act;
      if (act === "save") save();
      else if (act === "close" || act === "cancel") close();
      else if (act === "help") {
        close(true);
        openHelp("cosense-vim-settings");
      } else if (act === "reset") {
        Settings.clearProject(p);
        clearSessionOpts();
        close();
        reloadConfig();
        flash(`「${p}」の専用設定を削除しました（グローバル設定に戻りました）`);
      }
    });
    setTimeout(() => q('input[name="vim-scope"]:checked')?.focus(), 0);
  }
  function checkHash() {
    const h = location.hash;
    if (h !== "#vim-settings" && h !== "#vim-help") return;
    history.replaceState(history.state, "", location.pathname + location.search);
    if (h === "#vim-settings") openSettings();
    else openHelp();
  }

  // src/cmdline.js
  var _cmdEl = null;
  var _cmdInputEl = null;
  var _prompt = ":";
  var hist = { ":": [], "/": [] };
  var histIdx = -1;
  function createCmdLine() {
    if (_cmdEl) return;
    _cmdEl = document.createElement("div");
    _cmdEl.id = "vim-cmd";
    _cmdEl.innerHTML = '<div class="vim-cmd-spacer"></div><div class="vim-cmd-body"><span class="vim-cmd-colon">:</span><input id="vim-cmd-input" type="text" autocomplete="off" spellcheck="false"></div>';
    document.body.appendChild(_cmdEl);
    _cmdInputEl = _cmdEl.querySelector("#vim-cmd-input");
    _cmdInputEl.addEventListener("keydown", onCmdKey);
    _cmdInputEl.addEventListener("blur", () => {
      setTimeout(() => {
        if (state.cmdLine) closeCmdLine();
      }, 50);
    });
    syncBarPos();
  }
  function removeCmdLine() {
    if (state.cmdLine) closeCmdLine();
    _cmdEl?.remove();
    _cmdEl = null;
    _cmdInputEl = null;
  }
  function openCmdLine(prompt = ":") {
    createCmdLine();
    syncBarPos();
    _prompt = prompt;
    histIdx = -1;
    _cmdEl.querySelector(".vim-cmd-colon").textContent = prompt;
    state.cmdLine = true;
    _cmdEl.style.display = "flex";
    showIndicator(false);
    _cmdInputEl.value = "";
    setTimeout(() => _cmdInputEl.focus(), 0);
  }
  function closeCmdLine() {
    state.cmdLine = false;
    if (_cmdEl) _cmdEl.style.display = "none";
    showIndicator(layout() === "page");
    setModeQuiet("normal");
    focus();
  }
  function onCmdKey(e) {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    const h = hist[_prompt === ":" ? ":" : "/"];
    if (e.key === "Escape") {
      e.preventDefault();
      closeCmdLine();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!h.length) return;
      if (e.key === "ArrowUp") histIdx = histIdx < 0 ? h.length - 1 : Math.max(0, histIdx - 1);
      else histIdx = histIdx < 0 ? -1 : histIdx + 1;
      if (histIdx >= h.length) histIdx = -1;
      _cmdInputEl.value = histIdx < 0 ? "" : h[histIdx];
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const value = _cmdInputEl.value;
      const prompt = _prompt;
      const v = prompt === ":" ? value.trim() : value;
      if (v && h[h.length - 1] !== v) {
        h.push(v);
        if (h.length > 50) h.shift();
      }
      closeCmdLine();
      if (prompt === ":") {
        if (v) execCmd(v);
      } else search(v, prompt === "/" ? 1 : -1);
    }
  }
  function execCmd(cmd) {
    let m;
    if (/^\d+$/.test(cmd)) {
      const n = +cmd;
      jumpToLine(contentLineToIdx(n));
      flash("Line " + n);
      return;
    }
    if (m = cmd.match(/^e(?:dit)?\s+(.+)$/)) {
      const t = m[1].trim();
      saveNavCursor();
      showPage(t);
      flash("Opening: " + t);
      return;
    }
    if (cmd === "new") {
      const b = $(".new-button");
      if (b) b.click();
      else {
        const p = projectName();
        if (p) window.open("/" + p + "/new", "_self");
      }
      flash("New page");
      return;
    }
    if (cmd === "w") {
      if (typeof safe(() => cosense.Page.waitForSave, null) === "function") {
        flash("Saving...");
        cosense.Page.waitForSave().then(() => flash("Saved"));
      } else flash("Saved (auto)");
      return;
    }
    if (cmd === "q") {
      const t = ti();
      if (t) t.blur();
      flash(":q");
      return;
    }
    if (cmd === "cpll") {
      dk("e", { ctrlKey: false, code: "KeyE", keyCode: 69, metaKey: true });
      setTimeout(() => {
        const cl = edCurLine();
        if (!cl || !cl.id) {
          flash("No line");
          return;
        }
        const url = location.origin + location.pathname + "#" + cl.id.substring(1);
        toClip(url);
        flash("Copied: #" + cl.id);
      }, 100);
      return;
    }
    if (cmd === "cpmdl") {
      dk("e", { ctrlKey: false, code: "KeyE", keyCode: 69, metaKey: true });
      setTimeout(() => {
        const title = pageTitle() || document.title || "";
        const url = location.origin + location.pathname;
        const md = "[" + title + "](" + url + ")";
        toClip(md);
        flash("Copied MD link");
      }, 100);
      return;
    }
    if (m = cmd.match(/^h(?:elp)?(?:\s+(.+))?$/)) {
      openHelp(m[1]);
      return;
    }
    if (/^(settings|VimSettings|vimrc)$/.test(cmd)) {
      openSettings();
      return;
    }
    if (cmd === "marks") {
      const l = listMarks();
      flash(l.length ? "mark  page\n" + l.join("\n") : "マークはありません", 5e3);
      return;
    }
    if (cmd === "noh" || cmd === "nohlsearch") return;
    if (m = cmd.match(/^(n|i|v|x)?(?:nore)?map$/)) {
      const l = listMaps(m[1]);
      flash(l.length ? l.join("\n") : "マッピングはありません", 5e3);
      return;
    }
    if (isMapLine(cmd)) {
      addSessionMapLine(cmd);
      flash(cmd);
      return;
    }
    if (m = cmd.match(/^se(?:t)?(?:\s+(.*))?$/)) {
      cmdSet((m[1] || "").trim());
      return;
    }
    flash("E492: Not an editor command: " + cmd);
  }
  function cmdSet(arg) {
    const show2 = () => flash(`number=${cfg.lineNumbers ? "on" : "off"}  relativenumber=${cfg.relativeNumber ? "on" : "off"}  background=${cfg.theme}  imeguard=${cfg.imeGuard ? "on" : "off"}`, 3e3);
    if (!arg) {
      show2();
      return;
    }
    const MAP = { nu: "lineNumbers", number: "lineNumbers", rnu: "relativeNumber", relativenumber: "relativeNumber", imeguard: "imeGuard" };
    for (const tok of arg.split(/\s+/)) {
      let mm;
      if (mm = tok.match(/^(?:bg|background)=(dark|light|auto)$/)) sessionOpts.theme = mm[1];
      else if (MAP[tok]) sessionOpts[MAP[tok]] = true;
      else if (tok.startsWith("no") && MAP[tok.slice(2)]) sessionOpts[MAP[tok.slice(2)]] = false;
      else if (tok.endsWith("!") && MAP[tok.slice(0, -1)]) {
        const k = MAP[tok.slice(0, -1)];
        sessionOpts[k] = !cfg[k];
      } else {
        flash("E518: Unknown option: " + tok);
        return;
      }
    }
    reloadConfig();
    show2();
  }

  // src/keys.js
  var OPS = /* @__PURE__ */ new Set(["d", "y", "c"]);
  var MOT = /* @__PURE__ */ new Set(["h", "j", "k", "l", "w", "e", "b", "W", "E", "B", "0", "^", "$", "G", "{", "}", ";", ",", "H", "M", "L"]);
  var FIND = /* @__PURE__ */ new Set(["f", "t", "F", "T"]);
  function parseBuf(b) {
    const s = Array.from(b);
    let i = 0, c1 = "", c2 = "";
    if (/[1-9]/.test(s[i] || "")) while (/\d/.test(s[i] || "")) c1 += s[i++];
    const n1 = c1 ? +c1 : 1;
    if (i >= s.length) return { st: "pending" };
    if (OPS.has(s[i])) {
      const op = s[i++];
      if (i >= s.length) return { st: "pending" };
      if (s[i] === op) return i + 1 === s.length ? { st: "done", kind: "line", op, count: n1, explicit: !!c1 } : { st: "invalid" };
      if (/[1-9]/.test(s[i])) while (/\d/.test(s[i] || "")) c2 += s[i++];
      if (i >= s.length) return { st: "pending" };
      const rest2 = s.slice(i);
      const count = n1 * (c2 ? +c2 : 1), explicit = !!(c1 || c2);
      const done = (mot, extra) => ({ st: "done", kind: "op", op, mot, extra, count, explicit });
      if (rest2[0] === "g") return rest2.length === 1 ? { st: "pending" } : rest2.length === 2 && rest2[1] === "g" ? done("gg") : { st: "invalid" };
      if (FIND.has(rest2[0])) return rest2.length === 1 ? { st: "pending" } : rest2.length === 2 ? done(rest2[0], rest2[1]) : { st: "invalid" };
      if (rest2[0] === "i" || rest2[0] === "a") {
        if (rest2.length === 1) return { st: "pending" };
        return rest2.length === 2 && TEXTOBJ_CHARS.has(rest2[1]) ? done("obj", rest2.join("")) : { st: "invalid" };
      }
      if (rest2.length === 1 && MOT.has(rest2[0])) return done(rest2[0]);
      return { st: "invalid" };
    }
    const rest = s.slice(i);
    const cmd = (c) => ({ st: "done", kind: "cmd", cmd: c, count: n1, explicit: !!c1 });
    if (rest[0] === "g" || rest[0] === "z") {
      if (rest.length === 1) return { st: "pending" };
      const two = rest.join("");
      return ["gg", "gd", "zz", "zt", "zb"].includes(two) ? cmd(two) : { st: "invalid" };
    }
    if (FIND.has(rest[0])) return rest.length === 1 ? { st: "pending" } : rest.length === 2 ? { st: "done", kind: "mot", mot: rest[0], extra: rest[1], count: n1, explicit: !!c1 } : { st: "invalid" };
    if (rest.length === 1 && MOT.has(rest[0])) return { st: "done", kind: "mot", mot: rest[0], count: n1, explicit: !!c1 };
    return { st: "invalid" };
  }
  var block2 = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  var isEsc = (e) => e.key === "Escape" || e.ctrlKey && (e.key === "c" || e.key === "[");
  var NATIVE_NAV = /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/;
  var DECO = /* @__PURE__ */ new Set(["[", "*", "-", "/", "_", "`"]);
  var countFromBuf = () => /^[1-9]\d*$/.test(state.cmdBuf) ? Math.min(+state.cmdBuf, 9999) : 1;
  var dispatchMode = (e) => ({ insert: insH, normal: normH, visual: visH, "visual-line": vlH })[state.mode]?.(e);
  function onKey(e) {
    if (rt.passthrough || e[VIM]) return;
    if (isOverlayOpen()) return;
    if (layout() !== "page") return;
    if (state.cmdLine) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (handleImageModal(e)) return;
    const t = ti();
    const ae = document.activeElement;
    const editorFocused = !!t && ae === t;
    const nothingFocused = !ae || ae === document.body || ae === document.documentElement;
    if (editorFocused) {
      if (rt.busy || queue.length) {
        block2(e);
        if (queue.length < 64) queue.push(snap(e));
        return;
      }
      if (mapKey(e)) return;
      dispatchMode(e);
    } else if (nothingFocused) {
      unfocusedH(e);
    }
  }
  function processFake(ev) {
    if (mapKey(ev)) return;
    dispatchMode(ev);
    if (!ev._blocked) replayNative(ev);
  }
  function handleImageModal(e) {
    const modal = $(".full-content-modal.in");
    if (!modal) return false;
    if (e.key === "q" || e.key === "Escape") {
      block2(e);
      ($(".modal-backdrop.in") || modal).click();
      setTimeout(() => {
        focus();
        setMode("normal");
      }, 100);
    }
    return true;
  }
  function unfocusedH(e) {
    if (e.ctrlKey) {
      if (e.key === "o") {
        block2(e);
        navGo(-1);
        return;
      }
      if (e.key === "i") {
        block2(e);
        navGo(1);
        return;
      }
      return;
    }
    if (e.key === ":") {
      block2(e);
      openCmdLine(":");
      return;
    }
    if (e.key === "Escape") {
      block2(e);
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key) && !e.metaKey && !e.altKey) {
      const s = snap(e);
      block2(e);
      focus();
      setTimeout(() => {
        if (focused()) processFake(s);
      }, 0);
    }
  }
  function insH(e) {
    if (isEsc(e)) {
      block2(e);
      setMode("normal");
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === "Enter") onInsertText("\n");
      else if (e.key === "Backspace") onInsertBackspace();
    }
  }
  var enterVL = () => {
    state.vlStart = curLineIdx();
    setMode("visual-line");
    updateVL();
  };
  var IMMEDIATE = {
    ":": () => openCmdLine(":"),
    "/": () => openCmdLine("/"),
    "?": () => openCmdLine("?"),
    ">": (n) => {
      for (let i = 0; i < n; i++) indentRight();
    },
    "<": (n) => {
      for (let i = 0; i < n; i++) indentLeft();
    },
    "i": () => setMode("insert"),
    "a": () => {
      if (!cursorAtEOL()) moveL();
      setMode("insert");
    },
    "A": () => {
      move$();
      setMode("insert");
    },
    "I": () => {
      move0();
      setMode("insert");
    },
    "o": () => run(() => openLine(true)),
    "O": () => run(() => openLine(false)),
    "v": () => setMode("visual"),
    "V": enterVL,
    "s": (n) => run(() => substituteChars(n)),
    "S": (n) => run(() => linewiseCount("c", n)),
    "D": () => run(deleteToEOL),
    "C": () => run(changeToEOL),
    "J": (n) => run(() => joinLines(n)),
    "x": (n) => run(() => deleteCharsFwd(n)),
    "~": (n) => run(() => toggleCaseN(n)),
    "r": (n) => setPending("r", n),
    "m": () => setPending("m"),
    "'": () => setPending("'"),
    "`": () => setPending("`"),
    "u": (n) => {
      for (let i = 0; i < n; i++) undo();
    },
    "p": () => run(() => paste(true)),
    "P": () => run(() => paste(false)),
    ".": (n, explicit) => repeatLast(n, explicit),
    "n": (n) => searchNext(true, n),
    "N": (n) => searchNext(false, n),
    "*": () => searchWord(1),
    "#": () => searchWord(-1)
  };
  var REC_INSERT = /* @__PURE__ */ new Set(["i", "a", "A", "I", "o", "O", "s", "S", "C"]);
  var REC_CHANGE = /* @__PURE__ */ new Set([">", "<", "D", "J", "x", "~", "p", "P"]);
  function handlePending(k) {
    const p = state.pending;
    state.pending = null;
    updateIndicator();
    if (Array.from(k).length !== 1) return;
    switch (p.type) {
      case "r":
        recordChange((p.count > 1 ? String(p.count) : "") + "r" + k, false);
        run(() => replaceChars(k, p.count));
        return;
      case "m":
        if (/^[a-zA-Z]$/.test(k)) setMark(k);
        return;
      case "'":
      case "`":
        if (/^[a-zA-Z]$/.test(k)) run(() => jumpMark(k, p.type === "`"));
        return;
    }
  }
  function normH(e) {
    if (e.metaKey) return;
    if (e.altKey) {
      if (e.code === "KeyJ") {
        block2(e);
        moveLineDown();
        return;
      }
      if (e.code === "KeyK") {
        block2(e);
        moveLineUp();
        return;
      }
      return;
    }
    if (e.ctrlKey) {
      switch (e.key) {
        case "d":
          block2(e);
          resetBuf();
          halfScroll(1);
          return;
        case "u":
          block2(e);
          resetBuf();
          halfScroll(-1);
          return;
        case "e":
          block2(e);
          lineScroll(1);
          return;
        case "y":
          block2(e);
          lineScroll(-1);
          return;
        case "r": {
          block2(e);
          const n = countFromBuf();
          resetBuf();
          for (let i = 0; i < n; i++) redo();
          return;
        }
        case "o":
          block2(e);
          resetBuf();
          navGo(-1);
          return;
        case "i":
          block2(e);
          resetBuf();
          navGo(1);
          return;
      }
      return;
    }
    if (NATIVE_NAV.test(e.key)) {
      if (state.cmdBuf || state.pending) resetBuf();
      return;
    }
    block2(e);
    const k = e.key;
    if (state.pending) {
      handlePending(k);
      return;
    }
    if (k === "Escape") {
      resetBuf();
      return;
    }
    const buf = state.cmdBuf;
    const idle = buf === "" || /^[1-9]\d*$/.test(buf);
    if (idle && IMMEDIATE[k]) {
      const explicit = buf !== "";
      const n = explicit ? Math.min(+buf, 9999) : 1;
      resetBuf();
      if (REC_INSERT.has(k)) recordChange(buf + k, true);
      else if (REC_CHANGE.has(k)) recordChange(buf + k, false);
      IMMEDIATE[k](n, explicit);
      return;
    }
    if (Array.from(k).length !== 1) {
      resetBuf();
      return;
    }
    state.cmdBuf += k;
    const full = state.cmdBuf;
    const p = parseBuf(full);
    if (p.st === "pending") {
      updateIndicator();
      return;
    }
    resetBuf();
    if (p.st !== "done") return;
    const cnt = Math.min(p.count, 9999);
    switch (p.kind) {
      case "line":
        if (p.op !== "y") recordChange(full, p.op === "c");
        run(() => linewiseCount(p.op, cnt));
        return;
      case "op":
        if (p.op !== "y") recordChange(full, p.op === "c");
        run(() => execOp(p.op, p.mot, cnt, p.explicit, p.extra));
        return;
      case "cmd":
        if (p.cmd === "gg") {
          if (p.explicit) jumpToLine(contentLineToIdx(cnt));
          else moveGG();
        } else if (p.cmd === "gd") followLink();
        else scrollCursorTo(p.cmd[1] === "z" ? "z" : p.cmd[1]);
        return;
      case "mot":
        doMotion(p.mot, cnt, p.explicit, p.extra);
        return;
    }
  }
  function visH(e) {
    if (isEsc(e)) {
      block2(e);
      setMode("normal");
      return;
    }
    if (e.metaKey) return;
    if (e.altKey) {
      if (e.code === "KeyJ") {
        block2(e);
        moveLineDown();
        return;
      }
      if (e.code === "KeyK") {
        block2(e);
        moveLineUp();
        return;
      }
      return;
    }
    if (e.ctrlKey) {
      block2(e);
      return;
    }
    if (NATIVE_NAV.test(e.key)) {
      if (e.shiftKey) return;
      block2(e);
      dk(e.key, { shiftKey: true });
      return;
    }
    if (state.pending) {
      block2(e);
      const p = state.pending;
      state.pending = null;
      updateIndicator();
      const k2 = e.key;
      if (Array.from(k2).length !== 1) return;
      if (p.type === "obj") {
        if (TEXTOBJ_CHARS.has(k2)) selectTextObject(p.kind + k2, p.count);
      } else if (p.type === "find") findMotion(p.kind, k2, p.count, true);
      return;
    }
    if (DECO.has(e.key)) {
      if (state.cmdBuf) resetBuf();
      if (!hasSel()) {
        block2(e);
        return;
      }
      const t = ti();
      rt.roLift++;
      if (t) t.readOnly = false;
      setTimeout(() => {
        rt.roLift--;
        if (!rt.active) return;
        if (state.mode === "visual") setModeQuiet("normal");
      }, 50);
      return;
    }
    block2(e);
    const k = e.key;
    if (k === "g") {
      if (state.cmdBuf === "g") {
        resetBuf();
        selectToEdge(-1);
      } else {
        state.cmdBuf = "g";
        updateIndicator();
      }
      return;
    }
    if (k === "G") {
      resetBuf();
      selectToEdge(1);
      dk("ArrowRight", { metaKey: true, shiftKey: true });
      return;
    }
    if (/[1-9]/.test(k) || k === "0" && /^\d+$/.test(state.cmdBuf)) {
      state.cmdBuf += k;
      updateIndicator();
      return;
    }
    const cnt = countFromBuf();
    resetBuf();
    switch (k) {
      case ">":
        for (let i = 0; i < cnt; i++) indentRight();
        return;
      case "<":
        for (let i = 0; i < cnt; i++) indentLeft();
        return;
      case "y":
        run(vYank);
        return;
      case "Y":
        run(vYankPlain);
        return;
      case "d":
      case "x":
        run(vDelete);
        return;
      case "c":
      case "s":
        run(vSubst);
        return;
      case "p":
        run(vPaste);
        return;
      case "~":
        run(vToggleCase);
        return;
      case "i":
      case "a":
        setPending("obj", cnt, k);
        return;
      case "f":
      case "t":
      case "F":
      case "T":
        setPending("find", cnt, k);
        return;
      case "v":
        setMode("normal");
        return;
      case "V": {
        try {
          window.getSelection()?.removeAllRanges();
        } catch (_) {
        }
        enterVL();
        return;
      }
    }
    if (MOT.has(k)) doSelMotion(k, cnt);
  }
  function vlH(e) {
    if (isEsc(e)) {
      block2(e);
      setMode("normal");
      return;
    }
    if (e.metaKey) return;
    if (e.altKey) {
      if (e.code === "KeyJ") {
        block2(e);
        moveLineDown();
        requestAnimationFrame(updateVL);
        return;
      }
      if (e.code === "KeyK") {
        block2(e);
        moveLineUp();
        requestAnimationFrame(updateVL);
        return;
      }
      return;
    }
    if (e.ctrlKey) {
      block2(e);
      return;
    }
    block2(e);
    let k = e.key;
    if (k === "ArrowDown") k = "j";
    else if (k === "ArrowUp") k = "k";
    if (k === "g") {
      if (state.cmdBuf === "g") {
        resetBuf();
        jumpToLine(0);
        requestAnimationFrame(updateVL);
      } else {
        state.cmdBuf = "g";
        updateIndicator();
      }
      return;
    }
    if (k === "G") {
      resetBuf();
      moveGEnd();
      requestAnimationFrame(updateVL);
      return;
    }
    if (/[1-9]/.test(k) || k === "0" && /^\d+$/.test(state.cmdBuf)) {
      state.cmdBuf += k;
      updateIndicator();
      return;
    }
    const cnt = countFromBuf();
    resetBuf();
    const moveTo = (i) => {
      jumpToLine(i);
      requestAnimationFrame(updateVL);
    };
    switch (k) {
      case ">":
        run(() => vlIndent(true, cnt));
        return;
      case "<":
        run(() => vlIndent(false, cnt));
        return;
      case "y":
        run(vlYank);
        return;
      case "Y":
        run(vlYankPlain);
        return;
      case "d":
      case "x":
        run(vlDelete);
        return;
      case "p":
        run(vlPaste);
        return;
      case "c":
      case "s":
        run(vlChange);
        return;
      case "{":
      case "}": {
        let i = curLineIdx();
        for (let c = 0; c < cnt; c++) i = findEmptyLine(i, k === "{" ? -1 : 1);
        moveTo(i);
        return;
      }
      case "H":
      case "M":
      case "L":
        moveTo(screenLine(k, cnt));
        return;
      case "j":
      case "k":
        moveTo(curLineIdx() + (k === "j" ? cnt : -cnt));
        return;
      case "v":
      case "V":
        setMode("normal");
        return;
    }
  }

  // src/queue.js
  function run(fn) {
    rt.busy++;
    if (rt.busy === 1) {
      clearTimeout(rt.busyTimer);
      rt.busyTimer = setTimeout(() => setBusyMark(true), 250);
    }
    let p;
    try {
      p = Promise.resolve(fn());
    } catch (err) {
      p = Promise.reject(err);
    }
    p.catch((err) => {
      console.error(LOG, err);
      flash("Error: " + (err && err.message || err));
    }).finally(() => {
      if (--rt.busy === 0) {
        clearTimeout(rt.busyTimer);
        setBusyMark(false);
        drain();
      }
    });
  }
  function snap(e, extra) {
    return {
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: !!e.ctrlKey,
      altKey: !!e.altKey,
      shiftKey: !!e.shiftKey,
      metaKey: !!e.metaKey,
      isComposing: false,
      _fake: true,
      _blocked: false,
      _noremap: !!(extra && extra.noremap),
      preventDefault() {
        this._blocked = true;
      },
      stopPropagation() {
      },
      stopImmediatePropagation() {
      }
    };
  }
  function fakeKey(key, opts) {
    opts = opts || {};
    return snap({ key, code: "", keyCode: 0, ctrlKey: !!opts.ctrlKey, shiftKey: key.length === 1 && key !== key.toLowerCase() }, opts);
  }
  function replayNative(ev) {
    if (state.mode === "insert" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && Array.from(ev.key).length === 1) {
      vimInsert(ev.key);
      onInsertText(ev.key);
      return;
    }
    dkRaw(ev.key, { code: ev.code, keyCode: ev.keyCode, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey });
  }
  function enqueue(evs) {
    queue.push(...evs);
    if (!rt.busy) drain();
  }
  function drain() {
    while (rt.busy === 0 && queue.length) {
      const ev = queue.shift();
      if (ev._end) {
        ev._end();
        continue;
      }
      if (!rt.active || !focused() || layout() !== "page") {
        abortQueue();
        return;
      }
      if (ev._insert != null) {
        vimInsert(ev._insert);
        continue;
      }
      if (ev._ex != null) {
        execCmd(ev._ex);
        continue;
      }
      processFake(ev);
    }
  }
  function abortQueue() {
    for (const ev of queue) if (ev._end) ev._end();
    queue.length = 0;
    rt.replaying = false;
  }

  // src/repeat.js
  var lastChange = null;
  var rec = null;
  function recordChange(keys, entersInsert) {
    if (rt.replaying) return;
    if (entersInsert) rec = { keys, text: "" };
    else {
      lastChange = { keys, text: null };
      rec = null;
    }
  }
  function onInsertText(text) {
    if (rec && text) rec.text += text;
  }
  function onInsertBackspace() {
    if (rec) rec.text = Array.from(rec.text).slice(0, -1).join("");
  }
  function onLeaveInsert() {
    if (rec) {
      lastChange = { keys: rec.keys, text: rec.text };
      rec = null;
    }
  }
  function cancelRecording() {
    rec = null;
  }
  function repeatLast(count, explicit) {
    if (!lastChange) {
      flash("E35: 繰り返す変更がありません");
      return;
    }
    let keys = lastChange.keys;
    if (explicit) keys = String(count) + keys.replace(/^\d+/, "");
    const evs = Array.from(keys).map((k) => fakeKey(k, { noremap: true }));
    if (lastChange.text != null) evs.push({ _insert: lastChange.text }, fakeKey("Escape", { noremap: true }));
    rt.replaying = true;
    evs.push({ _end: () => {
      rt.replaying = false;
    } });
    enqueue(evs);
  }

  // src/mode.js
  function setModeQuiet(m) {
    const prev = state.mode;
    state.mode = m;
    state.cmdBuf = "";
    state.pending = null;
    if (prev === "visual-line" && m !== "visual-line") {
      clearVL();
      state.vlStart = -1;
    }
    if (prev === "insert" && m !== "insert") onLeaveInsert();
    if (rt.active && layout() === "page") document.body.dataset.vimMode = m;
    else delete document.body.dataset.vimMode;
    syncRO();
    updateIndicator();
    schedLN();
  }
  function setMode(m) {
    const prev = state.mode;
    if ((prev === "visual" || prev === "visual-line") && m !== "visual" && m !== "visual-line") {
      try {
        window.getSelection()?.removeAllRanges();
      } catch (_) {
      }
    }
    setModeQuiet(m);
    if (m !== "insert") focus();
  }
  function resetBuf() {
    state.cmdBuf = "";
    state.pending = null;
    updateIndicator();
  }
  function setPending(type, count, kind) {
    state.pending = { type, count: count || 1, kind };
    updateIndicator();
  }
  function vlRange() {
    const cur = curLineIdx();
    return [Math.min(state.vlStart, cur), Math.max(state.vlStart, cur)];
  }
  function updateVL() {
    if (state.mode !== "visual-line") {
      clearVL();
      return;
    }
    const [fr, to] = vlRange();
    const all = edLines();
    for (let i = 0; i < all.length; i++) {
      const on = i >= fr && i <= to;
      const cl = all[i].classList;
      if (cl.contains("vim-vl-sel") !== on) cl.toggle("vim-vl-sel", on);
    }
  }
  function clearVL() {
    document.querySelectorAll(".vim-vl-sel").forEach((e) => e.classList.remove("vim-vl-sel"));
  }

  // src/main.js
  function onLayoutChanged() {
    if (!rt.active) return;
    if (layout() === "page") {
      setMode("normal");
      showIndicator(true);
      setTimeout(() => {
        bindTextarea();
        setupLNObs();
        observeColPage();
        syncBarPos();
      }, 200);
    } else {
      setModeQuiet("insert");
      showIndicator(false);
      stopLNObs();
    }
  }
  function onPageChanged() {
    if (!rt.active) return;
    resetTextareaCache();
    abortQueue();
    resetMapState();
    cancelRecording();
    if (layout() !== "page") return;
    setModeQuiet("normal");
    setTimeout(() => {
      bindTextarea();
      setupLNObs();
      syncRO();
    }, 200);
    onNavPageChanged();
    consumePendingMark();
  }
  function onResize() {
    syncBarPos();
    schedLN();
  }
  function setup() {
    if (rt.active) return;
    rt.active = true;
    ensureStyles();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    window.addEventListener("focus", onWinFocus);
    window.addEventListener("resize", onResize);
    cosOn("layout:changed", onLayoutChanged);
    cosOn("page:changed", onPageChanged);
    createIndicator();
    applyConfig(cfg.imeGuard);
    if (layout() === "page") {
      setMode("normal");
      showIndicator(true);
      setTimeout(() => {
        bindTextarea();
        focus();
        setupLNObs();
        observeColPage();
        syncBarPos();
      }, 100);
    } else onLayoutChanged();
    if (Store.read("seen") == null) {
      Store.write("seen", 1);
      setTimeout(() => flash(":help で使い方 / :settings で設定", 4e3), 800);
    }
  }
  function teardown() {
    if (!rt.active) return;
    rt.active = false;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("beforeinput", onBeforeInput, true);
    window.removeEventListener("focus", onWinFocus);
    window.removeEventListener("resize", onResize);
    cosOff("layout:changed", onLayoutChanged);
    cosOff("page:changed", onPageChanged);
    stopLNObs();
    unbindTextarea();
    abortQueue();
    resetMapState();
    clearVL();
    state.cmdBuf = "";
    state.pending = null;
    delete document.body.dataset.vimMode;
    document.body.removeAttribute("data-vim-numbers");
    clearLineNumbers();
    const t = ti();
    if (t && cfg.imeGuard) t.readOnly = document.activeElement !== t;
    removeIndicator();
    removeCmdLine();
    removeCustomCSS();
  }
  function applyConfig(prevIme) {
    writeVars();
    setConfigKeymap(cfg.keymap);
    if (!rt.active) return;
    applyCustomCSS();
    if (cfg.lineNumbers) document.body.setAttribute("data-vim-numbers", "");
    else document.body.removeAttribute("data-vim-numbers");
    forceLN();
    if (prevIme && !cfg.imeGuard) {
      const t = ti();
      if (t) t.readOnly = false;
    }
    syncRO();
  }
  function reloadConfig() {
    const prevIme = cfg.imeGuard;
    loadCfg(rt.project);
    if (cfg.enabled && !rt.active) setup();
    else if (!cfg.enabled && rt.active) teardown();
    else applyConfig(prevIme);
  }
  function onAnyChange() {
    const p = projectName();
    if (p && p !== rt.project) {
      rt.project = p;
      clearSessionOpts();
      reloadConfig();
    }
  }
  async function boot() {
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768 && "ontouchstart" in window) {
      console.log(LOG, "Disabled on mobile");
      return;
    }
    if (window.__cosenseVimLoaded) return;
    window.__cosenseVimLoaded = true;
    if (!await waitCosense()) {
      console.warn(LOG, "cosense global not found");
      return;
    }
    rt.project = projectName();
    loadCfg(rt.project);
    watchColorScheme();
    cosOn("page:changed", onAnyChange);
    cosOn("layout:changed", onAnyChange);
    window.addEventListener("hashchange", checkHash);
    window.cosenseVim = {
      version: VERSION,
      get state() {
        return { ...state };
      },
      get config() {
        return { ...cfg };
      },
      get active() {
        return rt.active;
      },
      settings: Settings,
      openHelp,
      openSettings,
      enable() {
        sessionOpts.enabled = true;
        reloadConfig();
      },
      disable() {
        sessionOpts.enabled = false;
        reloadConfig();
      },
      // pure helpers, exposed for tests and debugging
      _t: { parseBuf, charClass, findCharIn, stepW, stepE, stepB, textObjectIn, findInLines, parseKeys }
    };
    if (cfg.enabled) setup();
    else console.log(LOG, `disabled for "${rt.project}" — open #vim-settings to change`);
    checkHash();
    console.log(LOG, VERSION, "loaded", `(project: ${rt.project}, ${Settings.hasProject(rt.project) ? "project settings" : "global settings"}, theme: ${resolvedTheme()})`);
  }
  boot();
})();
