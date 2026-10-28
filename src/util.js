/* global __VERSION__ */
export const VERSION = 'v' + (typeof __VERSION__ === 'string' ? __VERSION__ : 'dev');
export const LOG = '[cosense-vim]';

export const wait = ms => new Promise(r => setTimeout(r, ms));
export const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
export const kebab = k => k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s || '').replace(/\r\n?/g, '\n');
export const swapCase = s => Array.from(s).map(c => { const u = c.toUpperCase(); return c === u ? c.toLowerCase() : u; }).join('');

// cosense's getters (Project.name, Page.lines, ...) THROW while its internal
// state is still null, so every read of cosense state goes through safe().
export function safe(fn, fallback) {
  try { const v = fn(); return v == null ? fallback : v; } catch (_) { return fallback; }
}
