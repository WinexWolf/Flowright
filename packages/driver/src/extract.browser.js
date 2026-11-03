(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE']);
  const LEAF = new Set(['link', 'button', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'tab', 'menuitem', 'img', 'clickable']);
  const ACT = new Set(['link', 'button', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'tab', 'menuitem']);
  const FIELD = new Set(['textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'spinbutton', 'slider']);
  const TOGGLE = new Set(['checkbox', 'radio', 'switch']);
  const INTERACTIVE_SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio]';

  const vis = (el) => {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Containers can legitimately have a zero-size box while their children are visible (e.g. a wrapper around a
  // position:fixed modal), so only truly hidden containers are pruned; a real box is required only for leaves.
  const shown = (el) => {
    if (!el.isConnected) return false;
    if (el.checkVisibility) return el.checkVisibility({ checkVisibilityCSS: true });
    const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const roleOf = (el) => {
    const ar = el.getAttribute('role');
    if (ar) return ar.split(/\s+/)[0];
    const t = el.tagName.toLowerCase();
    if (t === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'image'].includes(ty)) return 'button';
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'hidden') return null;
      if (ty === 'search') return 'searchbox';
      if (ty === 'range') return 'slider';
      if (ty === 'number') return 'spinbutton';
      return 'textbox';
    }
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading' + t[1];
    const m = { nav: 'navigation', main: 'main', footer: 'contentinfo', header: 'banner', ul: 'list', ol: 'list', li: 'listitem', table: 'table', form: 'form', dialog: 'dialog', img: 'img', details: 'group' };
    return m[t] || null;
  };
  const nameOf = (el) => {
    const al = el.getAttribute('aria-label'); if (al) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').replace(/\s+/g, ' ').trim(); if (t) return t; }
    const tag = el.tagName.toLowerCase();
    if (el.labels && el.labels.length) return Array.from(el.labels).map(l => l.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (tag === 'input') { const ty = el.type; if (['submit', 'button', 'reset'].includes(ty)) return el.value || ty; return el.getAttribute('placeholder') || el.name || ''; }
    if (tag === 'img') return el.alt || '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  };
  const cssPath = (el) => {
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      let sel = n.tagName.toLowerCase();
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift('#' + n.id); break; }
      const parent = n.parentElement;
      if (parent) { const sibs = Array.from(parent.children).filter(c => c.tagName === n.tagName); if (sibs.length > 1) sel += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')'; }
      parts.unshift(sel); n = n.parentElement;
    }
    return parts.join(' > ');
  };

  // ---- role-less clickable elements (div/span with onclick or cursor:pointer and nothing interactive inside/around them)
  const clickables = [];
  {
    const cands = new Set();
    let seen = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n && seen < 4000; n = walker.nextNode(), seen++) {
      if (SKIP.has(n.tagName) || roleOf(n) || n.closest(INTERACTIVE_SEL)) continue;
      if (n.querySelector(INTERACTIVE_SEL)) continue;
      const hasHandler = n.hasAttribute('onclick');
      if (!hasHandler && getComputedStyle(n).cursor !== 'pointer') continue;
      if (!vis(n)) continue;
      const r = n.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
      if (!(n.innerText || '').trim() && !n.getAttribute('aria-label')) continue;
      cands.add(n);
    }
    // cursor:pointer is inherited: keep only the outermost candidate of each cluster
    for (const n of cands) { let p = n.parentElement, nested = false; while (p) { if (cands.has(p)) { nested = true; break; } p = p.parentElement; } if (!nested) clickables.push(n); }
  }

  // ---- structural tree (generic wrappers flattened; leaves for interactive roles)
  const walk = (el) => {
    if (SKIP.has(el.tagName) || el.getAttribute('aria-hidden') === 'true' || !shown(el)) return [];
    let role = roleOf(el);
    if (!role && clickables.includes(el)) role = 'clickable';
    if (role && (LEAF.has(role) || /^heading/.test(role))) return vis(el) ? [{ r: role }] : [];
    const kids = [];
    for (const c of el.children) kids.push(...walk(c));
    if (!role) return kids;
    return [kids.length ? { r: role, k: kids } : { r: role }];
  };
  const tree = [];
  for (const c of document.body.children) tree.push(...walk(c));

  // ---- interactive elements
  const counts = {};
  const groupOf = (el) => (FIELD.has(roleOf(el)) || roleOf(el) === 'button') ? (el.closest('form, [role=dialog], dialog, fieldset, section') || null) : null;
  const items = [];
  const register = (el, role) => {
    const name = nameOf(el);
    const key = role + '|' + name;
    const nth = counts[key] = (counts[key] === undefined ? 0 : counts[key] + 1);
    items.push({ el, role, name, nth, ge: groupOf(el) });
  };
  for (const el of document.body.querySelectorAll('*')) {
    if (SKIP.has(el.tagName) || el.closest('[aria-hidden=true]')) continue;
    const role = roleOf(el);
    if (!role || !ACT.has(role) || !vis(el)) continue;
    register(el, role);
  }
  for (const el of clickables) register(el, 'clickable');

  // A group is a unit of fields + (optionally) a submit button. Groups made only of toggles with no submit dissolve:
  // their checkboxes become ordinary clickable controls.
  const groups = new Map();
  for (const it of items) if (it.ge && FIELD.has(it.role)) { if (!groups.has(it.ge)) groups.set(it.ge, { id: -1, fields: [], el: it.ge }); }
  const submitName = /^(save|create|submit|add|send|sign in|log in|login|search|apply|confirm|update|post|place|continue|next|done|join|register)/i;
  const forms = [];
  for (const [ge, g] of groups) {
    const fields = []; let submit = null;
    for (const it of items) {
      if (it.ge !== ge) continue;
      const el = it.el;
      if (FIELD.has(it.role) && !el.disabled) {
        const opts = el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.value || o.text).slice(0, 8) : undefined;
        fields.push({ name: el.name || el.id || it.name, type: (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase(), label: it.name, required: !!el.required, css: cssPath(el), options: opts, role: it.role });
      } else if (it.role === 'button' && !submit) {
        const isSubmit = ge.tagName === 'FORM' ? (el.type === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type'))) : submitName.test(it.name);
        if (isSubmit) submit = { css: cssPath(el), name: it.name, role: it.role, nth: it.nth };
      }
    }
    const onlyToggles = fields.length > 0 && fields.every(f => TOGGLE.has(f.role));
    if (!fields.length || (onlyToggles && !submit)) { g.dissolved = true; continue; }
    g.id = forms.length;
    g.fields = fields; g.submit = submit;
    const isForm = ge.tagName === 'FORM';
    const action = isForm ? (ge.getAttribute('action') || location.pathname) : 'inline';
    const method = isForm ? ((ge.getAttribute('method') || 'get').toUpperCase()) : 'INLINE';
    forms.push({ id: g.id, fields: fields.map(f => ({ name: f.name, type: f.type, label: f.label, required: f.required, css: f.css, options: f.options })), submit, action, method, inModal: !!ge.closest('[role=dialog], dialog[open]'), key: action + '|' + fields.map(f => f.name).join(',') });
  }
  const interactive = [];
  const submitCss = new Set(forms.filter(f => f.submit).map(f => f.submit.css));
  for (const it of items) {
    const el = it.el; const g = it.ge ? groups.get(it.ge) : null;
    const css = cssPath(el);
    const grouped = g && !g.dissolved;
    if (grouped && (FIELD.has(it.role) || submitCss.has(css))) continue;       // driven as part of its form
    if (FIELD.has(it.role) && !TOGGLE.has(it.role)) continue;                   // loose text input: not a standalone action
    interactive.push({
      role: it.role, name: it.name, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || undefined,
      href: el.tagName === 'A' ? el.href : undefined, css, nth: it.nth,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', groupId: grouped ? g.id : -1, target: el.getAttribute('target') || undefined,
      inModal: !!el.closest('[role=dialog], dialog[open]'),
    });
  }

  // ---- evidence (independent of fingerprinting)
  const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
  const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(vis).map(txt).filter(Boolean).slice(0, 12);
  const mainEl = document.querySelector('main') || document.body;
  const textSample = txt(mainEl).slice(0, 1500);
  const alerts = Array.from(document.querySelectorAll('[role=alert]')).filter(vis).map(txt).filter(Boolean);
  const dialogs = Array.from(document.querySelectorAll('[role=dialog], dialog[open]')).filter(vis).map(e => txt(e).slice(0, 300));
  const tabEls = Array.from(document.querySelectorAll('[role=tab]')).filter(vis);
  const tabs = tabEls.map(t => ({ name: nameOf(t), selected: t.getAttribute('aria-selected') === 'true' }));
  const brokenImages = Array.from(document.images).filter(i => vis(i) && i.complete && i.naturalWidth === 0).length;
  const evidence = {
    route: location.pathname + location.search + location.hash,
    title: document.title,
    headings, textSample, alerts, dialogs,
    selectedTabs: tabs.filter(t => t.selected).map(t => t.name),
    // sideways scrolling, OR a phone laying the page out wider than its own screen (the classic missing <meta name=viewport>)
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1 || (matchMedia('(pointer: coarse)').matches && window.innerWidth > screen.width + 1),
    brokenImages,
    emptyMain: txt(mainEl).length < 3,
  };
  return { evidence, tree, tabs, interactive, forms };
})()
