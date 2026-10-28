// Access to the cosense global. Everything that reads cosense state lives here.
import { safe, wait } from './util.js';

export let cosense = null;

// @run-at document-idle can run before cosense finishes booting.
// Wait until the global exists AND its state is readable (Layout, plus Project on project pages).
export async function waitCosense() {
  let c = null;
  for (let i = 0; i < 300; i++) {               // up to 30s
    c = window.cosense || window.scrapbox;
    if (c && typeof c.on === 'function') {
      const lay = safe(() => c.Layout, null);
      const proj = safe(() => c.Project.name, null);
      if (lay && (proj || lay !== 'page')) break;
      if (i >= 150 && lay) break;                 // 15s: pages without a project
    }
    await wait(100);
  }
  cosense = c && typeof c.on === 'function' ? c : null;
  return cosense;
}

export const projectName = () => safe(() => cosense.Project.name, '') || decodeURIComponent(location.pathname.split('/')[1] || '');
export const layout = () => safe(() => cosense.Layout, '');
export const pageLines = () => safe(() => cosense.Page.lines, []);
export const pageTitle = () => safe(() => cosense.Page.title, '');
export const lineText = idx => { const l = pageLines()[idx]; return l ? l.text : ''; };
export const lineChars = idx => Array.from(lineText(idx));
export const lastLine = () => pageLines().length - 1;
export const showPage = title => safe(() => cosense.Page.show(title), null);

export function cosOn(ev, fn) { cosense.on(ev, fn); }
export function cosOff(ev, fn) {
  const f = cosense.off || cosense.removeListener;
  if (typeof f === 'function') f.call(cosense, ev, fn);
}
