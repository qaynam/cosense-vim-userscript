// Settings: localStorage, global defaults + per-project override, plus :set (session only).
const LS = 'cosense-vim:';

export const DEFAULTS = Object.freeze({
  enabled: true,
  theme: 'auto',            // auto | light | dark
  lineNumbers: true,
  relativeNumber: true,
  imeGuard: true,           // readOnly textarea in non-insert modes
  systemClipboard: true,
  keymap: '',               // vimrc-style map lines (nnoremap H 0 ...)
  customCSS: '',
});

export const Store = {
  read(key) { try { const v = localStorage.getItem(LS + key); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
  write(key, val) { try { localStorage.setItem(LS + key, JSON.stringify(val)); return true; } catch (_) { return false; } },
  remove(key) { try { localStorage.removeItem(LS + key); } catch (_) { /* ignore */ } },
  keys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS)) out.push(k.slice(LS.length));
      }
    } catch (_) { /* ignore */ }
    return out;
  },
};

export function sanitize(s) {
  const o = {};
  for (const k of Object.keys(DEFAULTS)) {
    const d = DEFAULTS[k]; const v = s ? s[k] : undefined;
    o[k] = (v === undefined || typeof v !== typeof d) ? d : v;
  }
  if (!['auto', 'light', 'dark'].includes(o.theme)) o.theme = 'auto';
  return o;
}

export const Settings = {
  global() { return sanitize(Store.read('global')); },
  project(p) { const v = Store.read('project:' + p); return v ? sanitize(v) : null; },
  hasProject(p) { return Store.read('project:' + p) != null; },
  effective(p) { return this.project(p) || this.global(); },
  saveGlobal(s) { return Store.write('global', sanitize(s)); },
  saveProject(p, s) { return Store.write('project:' + p, sanitize(s)); },
  clearProject(p) { Store.remove('project:' + p); },
  overriddenProjects() { return Store.keys().filter(k => k.startsWith('project:')).map(k => k.slice(8)).sort(); },
};

export const cfg = { ...DEFAULTS };   // effective config, mutated in place
export const sessionOpts = {};        // :set values for this tab

export function clearSessionOpts() { for (const k of Object.keys(sessionOpts)) delete sessionOpts[k]; }
export function computeCfg(project) { return sanitize({ ...Settings.effective(project), ...sessionOpts }); }
export function loadCfg(project) { Object.assign(cfg, computeCfg(project)); return cfg; }
