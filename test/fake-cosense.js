// A fake layout + a tiny cursor model standing in for cosense (clicks and arrow keys move
// the cursor, the textarea holds the selected text) so geometry-based code runs under jsdom.
const CW = 10, LH = 20, X0 = 100;

export function fakeCosense(env, { hiddenUnlessCursor = () => false, viewport = 1e7 } = {}) {
  const w = env.window, d = env.document;
  const lines = () => [...d.querySelectorAll('.editor .lines > .line')];
  const len = L => lines()[L].querySelectorAll('.char-index').length;
  const m = { cur: { L: 2, c: 0 }, anchor: null, arrows: 0, clicks: 0, kills: 0 };
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  // line index cache (rect lookups happen a lot; rebuilding per call made each key cost ~60 ms)
  let _idx = new WeakMap(), _n = -1;
  const lineOf = el => {
    const ln = el.closest('.lines > .line'); if (!ln) return -1;
    const all = d.querySelectorAll('.editor .lines > .line');
    if (all.length !== _n || !_idx.has(ln)) { _idx = new WeakMap(); all.forEach((l, i) => _idx.set(l, i)); _n = all.length; }
    return _idx.has(ln) ? _idx.get(ln) : -1;
  };
  const orig = w.Element.prototype.getBoundingClientRect;
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('char-index')) {
      const L = lineOf(this);
      if (L !== m.cur.L && hiddenUnlessCursor(L)) return rect(X0, L * LH, 0, 0);
      return rect(X0 + this.dataset.charIndex * CW, L * LH, CW, LH);
    }
    if (this.classList.contains('cursor')) return rect(X0 + m.cur.c * CW, m.cur.L * LH, 1, LH);
    if (this.closest && this.closest('.lines > .line')) { const L = lineOf(this); return rect(X0, L * LH, Math.max(1, len(L)) * CW, LH); }
    return orig.call(this);
  };
  Object.defineProperty(w, 'innerHeight', { value: viewport, configurable: true });
  const text = L => Array.from(env.window.cosense.Page.lines[L].text);
  const posOf = p => { let o = 0; for (let i = 0; i < p.L; i++) o += text(i).length + 1; return o + p.c; };
  const render = () => {
    const prev = d.querySelector('.editor .lines > .line.cursor-line'); const next = lines()[m.cur.L];
    if (prev !== next) { prev?.classList.remove('cursor-line'); next?.classList.add('cursor-line'); }
    // like cosense: the textarea holds the selected text
    const ta = env.ta();
    if (m.anchor) {
      const all = env.window.cosense.Page.lines.map(l => l.text).join('\n');
      const [a, b] = [posOf(m.anchor), posOf(m.cur)].sort((x, y) => x - y);
      ta.value = Array.from(all).slice(a, b).join(''); ta.setSelectionRange(0, ta.value.length);
    } else { ta.value = ''; }
  };
  const moveTo = (L, c, shift) => {
    if (shift) m.anchor ??= { ...m.cur }; else m.anchor = null;
    m.cur = { L, c }; render();
  };
  env.ta().addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    const { L, c } = m.cur; const last = lines().length - 1;
    switch (e.key) {
      case 'ArrowRight': m.arrows++; if (c < len(L)) moveTo(L, c + 1, e.shiftKey); else if (L < last) moveTo(L + 1, 0, e.shiftKey); break;
      case 'ArrowLeft': m.arrows++; if (c > 0) moveTo(L, c - 1, e.shiftKey); else if (L > 0) moveTo(L - 1, len(L - 1), e.shiftKey); break;
      case 'ArrowDown': m.arrows++; if (L < last) moveTo(L + 1, Math.min(c, len(L + 1)), e.shiftKey); break;
      case 'ArrowUp': m.arrows++; if (L > 0) moveTo(L - 1, Math.min(c, len(L - 1)), e.shiftKey); break;
      case 'a': if (e.ctrlKey) moveTo(L, 0, false); break;
      case 'e': if (e.ctrlKey) moveTo(L, len(L), false); break;
      case 'k': if (e.ctrlKey) m.kills++; break;
    }
  });
  d.addEventListener('mousedown', e => {
    const L = lineOf(e.target); if (L < 0) return;
    m.clicks++;
    const c = Math.max(0, Math.min(len(L), Math.round((e.clientX - X0) / CW)));
    moveTo(L, c, e.shiftKey);
  });
  m.set = (L, c) => moveTo(L, c, false);
  return m;
}

export const bigPage = n => ['タイトル', ...Array.from({ length: n }, (_, i) => `line ${i + 1} some text here`)];
