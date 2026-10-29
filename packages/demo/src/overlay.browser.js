(() => {
  if (window.__fr) return;
  const css = `
  #__fr{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:"Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
  #__fr .cap{position:absolute;left:50%;bottom:6%;transform:translateX(-50%);max-width:82%;background:rgba(12,18,26,.88);color:#fff;padding:.7em 1.15em;border-radius:12px;font-size:var(--fs,22px);line-height:1.35;text-align:center;opacity:0;transition:opacity .25s;box-shadow:0 6px 24px rgba(0,0,0,.28)}
  #__fr .cap.on{opacity:1}
  #__fr .cur{position:absolute;left:0;top:0;width:30px;height:30px;transition:transform 650ms cubic-bezier(.45,.05,.25,1);will-change:transform;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
  #__fr .rip{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid var(--accent,#3B82F6);opacity:0}
  #__fr .rip.go{animation:rip .55s ease-out}@keyframes rip{from{opacity:.95;transform:scale(.4)}to{opacity:0;transform:scale(3.6)}}
  #__fr .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4em;background:var(--cardbg,#0E1620);color:#fff;text-align:center;padding:8%;opacity:0;transition:opacity .35s}
  #__fr .card.on{opacity:1}#__fr .card h1{margin:0;font-size:calc(var(--fs,22px)*1.9);font-weight:800;letter-spacing:-.01em;line-height:1.12}#__fr .card p{margin:0;font-size:var(--fs,22px);opacity:.75}
  html.__frphone body{padding-top:36px!important;box-sizing:border-box}
  #__fr .phone{position:absolute;inset:0;border-radius:42px;box-shadow:0 0 0 100vmax #0a0f15,inset 0 0 0 5px #0a0f15;display:none}
  #__fr .phone.on{display:block}#__fr .notch{position:absolute;top:9px;left:50%;width:34%;max-width:130px;height:26px;margin-left:calc(-17%);border-radius:16px;background:#0a0f15;display:none}#__fr .notch.on{display:block}
  `;
  const st = document.createElement('style'); st.textContent = css;
  const root = document.createElement('div'); root.id = '__fr';
  root.innerHTML = '<div class="cap"></div><div class="rip"></div><svg class="cur" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.8 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><div class="card"><h1></h1><p></p></div><div class="phone"></div><div class="notch"></div>';
  const $ = (s) => root.querySelector(s);
  let hold = null;
  const mount = () => { if (!document.documentElement) return false; if (!root.isConnected) { document.documentElement.appendChild(st); document.documentElement.appendChild(root); } return true; };
  if (!mount()) { const t = setInterval(() => { if (mount()) clearInterval(t); }, 5); }
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('__fr_cur') || 'null'); } catch { return null; } })();
  const put = (x, y, ms) => { const c = $('.cur'); c.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,.05,.25,1)` : 'none'; c.style.transform = `translate(${x - 4}px,${y - 2}px)`; try { sessionStorage.setItem('__fr_cur', JSON.stringify({ x, y })); } catch {} };
  put(saved ? saved.x : -60, saved ? saved.y : -60, 0);
  window.__fr = {
    config(o) { mount(); if (o.fs) root.style.setProperty('--fs', o.fs + 'px'); if (o.accent) root.style.setProperty('--accent', o.accent); if (o.cardbg) root.style.setProperty('--cardbg', o.cardbg); },
    caption(t) { mount(); const c = $('.cap'); if (!t) { c.classList.remove('on'); return; } c.textContent = t; c.classList.add('on'); },
    cursorTo(x, y, ms) { mount(); put(x, y, ms == null ? 650 : ms); },
    ripple(x, y) { const r = $('.rip'); r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); },
    card(title, sub) { mount(); $('.card h1').textContent = title || ''; $('.card p').textContent = sub || ''; $('.card').classList.add('on'); },
    cardOff() { $('.card').classList.remove('on'); },
    phone(on) { mount(); document.documentElement.classList.toggle('__frphone', !!on); $('.phone').classList.toggle('on', !!on); $('.notch').classList.toggle('on', !!on); },
    // Zoom toward (cx,cy) in VIEWPORT coordinates, but clamp the translation so the page always covers the viewport: zooming never crops the page's own edges.
    zoom(cx, cy, s, ms) { const b = document.body, vw = innerWidth, vh = innerHeight; const tx = Math.min(0, Math.max(vw - vw * s, vw / 2 - cx * s)), ty = Math.min(0, Math.max(vh - vh * s, vh / 2 - cy * s)); b.style.transition = `transform ${ms || 500}ms cubic-bezier(.4,0,.2,1)`; b.style.transformOrigin = '0 0'; b.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; },
    unzoom(ms) { const b = document.body; b.style.transition = `transform ${ms || 400}ms cubic-bezier(.4,0,.2,1)`; b.style.transform = 'none'; },
  };
})();
