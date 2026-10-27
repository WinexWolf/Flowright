// "Riverside Library" (HELD-OUT target): MPA + JS dropdown, pagination, search, accordion.
import { createApp, esc } from '../_lib.mjs';

const GENRES = ['fiction', 'science', 'history'];
const TITLES = ['Dune', 'Emma', 'Cosmos', 'Sapiens', 'Ulysses', 'Gaia', 'Rubicon', 'Persuasion', 'Silent Spring', 'Middlemarch', 'The Selfish Gene', 'SPQR',
  'Neuromancer', 'Hyperion', 'Guns Germs and Steel', 'Brief History of Time', 'Beloved', 'Dracula', 'The Double Helix', 'Dominion', 'Kindred', 'Contact', 'Pale Fire', 'Origins'];
const BOOKS = TITLES.map((t, i) => ({ slug: t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), title: t, genre: GENRES[i % 3], year: 1900 + (i * 7) % 120 }));
const PAGE = 8;

createApp({
  name: 'library',
  seed: () => ({ reservations: [], member: null }),
  handler: async ({ url, state, form, send, redirect, sendJson, bug, req }) => {
    const p = url.pathname;
    const layout = (title, main, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} | Riverside Library</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:0}header,footer{background:#ecfdf5;padding:12px 24px}
nav a,nav button{margin-right:14px}.menu{display:none;position:absolute;background:#fff;border:1px solid #ccc;padding:8px}.menu.open{display:block}main{padding:24px;max-width:960px}.err{color:#b00020}label{display:block;margin:8px 0}</style></head><body>
<header><nav aria-label="Site"><a href="/">Home</a>
<span style="position:relative"><button id="browse" aria-expanded="false" aria-haspopup="true">Browse</button>
<div class="menu" id="menu" role="menu">${GENRES.map(g => `<a role="menuitem" href="/books?genre=${g}">${g[0].toUpperCase() + g.slice(1)}</a><br>`).join('')}</div></span>
<a href="/books">All books</a><a href="${bug('lib-broken-link') ? '/event' : '/events'}">Events</a><a href="/reservations">My reservations (${state.reservations.length})</a><a href="/join">Join</a>
<form action="/search" method="get" role="search" style="display:inline"><input name="q" type="search" aria-label="Search books" placeholder="Search"><button type="submit">Search</button></form></nav></header>
<main>${main}</main><footer>Riverside Library · Open daily 9-5</footer>
<script>const b=document.getElementById('browse'),m=document.getElementById('menu');
b.addEventListener('click',()=>{const o=m.classList.toggle('open');b.setAttribute('aria-expanded',String(o));});${extra}</script></body></html>`;
    const notFound = () => send(404, layout('Not found', '<h1>Page not found</h1><a href="/">Return home</a>'));
    const bookCard = (b) => `<li><a href="/books/${b.slug}">${esc(b.title)}</a> <small>(${b.genre}, ${b.year})</small></li>`;

    if (p === '/api/availability') {
      if (bug('lib-failing-api')) return sendJson(503, { error: 'availability down' });
      return sendJson(200, { available: true });
    }
    if (p === '/') return send(200, layout('Home', `<h1>Welcome to Riverside Library</h1><p>Borrow, reserve and discover.</p><h2>New arrivals</h2><ul>${BOOKS.slice(0, 4).map(bookCard).join('')}</ul>`));
    if (p === '/books') {
      const genre = url.searchParams.get('genre'); const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const list = genre ? BOOKS.filter(b => b.genre === genre) : BOOKS;
      const pages = Math.max(1, Math.ceil(list.length / PAGE)); const slice = list.slice((page - 1) * PAGE, page * PAGE);
      const q = (n) => `/books?${genre ? 'genre=' + genre + '&' : ''}page=${n}`;
      const avail = `fetch('/api/availability').then(r=>{if(!r.ok) throw new Error('availability '+r.status)}).catch(e=>console.error('availability check failed',e.message));`;
      return send(200, layout('Books', `<h1>${genre ? esc(genre) + ' books' : 'All books'}</h1><ul>${slice.map(bookCard).join('')}</ul>
<nav aria-label="Pagination">${page > 1 ? `<a href="${q(page - 1)}">Previous</a> ` : ''}Page ${page} of ${pages}${page < pages ? ` <a href="${q(page + 1)}">Next</a>` : ''}</nav>`, avail));
    }
    const bm = p.match(/^\/books\/([a-z0-9-]+)$/);
    if (bm) {
      const b = BOOKS.find(x => x.slug === bm[1]); if (!b) return notFound();
      const reserve = bug('lib-dead-reserve')
        ? `<button type="button" id="reserve">Reserve this book</button>`
        : `<form method="post" action="/reserve"><input type="hidden" name="slug" value="${b.slug}"><button type="submit">Reserve this book</button></form>`;
      return send(200, layout(b.title, `<h1>${esc(b.title)}</h1><p>${b.genre} · ${b.year}</p>${reserve}<p><a href="/books">Back to catalogue</a></p>`,
        bug('lib-dead-reserve') ? `document.getElementById('reserve').addEventListener('click',()=>{reservationQueue.push(1);});` : ''));
    }
    if (p === '/reserve' && req.method === 'POST') { if (!state.reservations.includes(form.slug)) state.reservations.push(form.slug); return redirect('/reservations'); }
    if (p === '/reservations') {
      return send(200, layout('Reservations', state.reservations.length
        ? `<h1>My reservations</h1><ul>${state.reservations.map(s => `<li>${esc(BOOKS.find(b => b.slug === s)?.title)}</li>`).join('')}</ul>`
        : `<h1>My reservations</h1><p>You have no reservations yet.</p><a href="/books">Find a book</a>`));
    }
    if (p === '/search') {
      const q = (url.searchParams.get('q') || '').toLowerCase(); const hits = q ? BOOKS.filter(b => b.title.toLowerCase().includes(q)) : [];
      return send(200, layout('Search', `<h1>Search results</h1>${hits.length ? `<ul>${hits.map(bookCard).join('')}</ul>` : '<p>No books found. Try a different search.</p>'}`));
    }
    if (p === '/events') {
      const wide = bug('lib-layout-overflow') ? '<div style="width:1800px;background:#bfdbfe">Event calendar</div>' : '';
      const err = bug('lib-console-error') ? `console.error('Calendar widget crashed');` : '';
      return send(200, layout('Events', `<h1>Events</h1>${wide}<details><summary>Story time (Saturdays)</summary><p>Children's stories at 10am.</p><a href="/join">Join to attend</a></details>
<details><summary>Book club (monthly)</summary><p>Meets first Tuesday.</p></details>`, err));
    }
    if (p === '/join' && req.method === 'GET') {
      return send(200, layout('Join', `<h1>Become a member</h1>${joinForm('')}`));
    }
    if (p === '/join' && req.method === 'POST') {
      const errs = [];
      if (!form.name?.trim()) errs.push('Name is required');
      if (!/^\S+@\S+\.\S+$/.test(form.email || '')) errs.push('A valid email is required');
      if (!bug('lib-missing-validation') && (form.password || '').length < 8) errs.push('Password must be at least 8 characters');
      if (errs.length) return send(200, layout('Join', `<h1>Become a member</h1>${joinForm(`<div role="alert" class="err">${errs.map(esc).join('<br>')}</div>`)}`));
      state.member = form.email; return redirect('/welcome');
    }
    if (p === '/welcome') return send(200, layout('Welcome', `<h1>Welcome, new member</h1><p>Your library card is ready.</p><a href="/books">Start browsing</a>`));
    return notFound();

    function joinForm(banner) {
      return `${banner}<form method="post" action="/join" novalidate><label>Name <input name="name" type="text"></label><label>Email <input name="email" type="email"></label>
<label>Password <input name="password" type="password"></label><button type="submit">Create account</button></form>`;
    }
  },
});
