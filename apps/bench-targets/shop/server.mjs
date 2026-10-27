// "Shopfront": server-rendered multi-page shop. Injectable bugs via FLOWRIGHT_BUGS.
import { createApp, esc } from '../_lib.mjs';

const PRODUCTS = [
  { id: 1, name: 'Studio Headphones', category: 'audio', price: 129, stock: 8 },
  { id: 2, name: 'Pocket Speaker', category: 'audio', price: 59, stock: 0 },
  { id: 3, name: 'Mechanical Keyboard', category: 'office', price: 99, stock: 14 },
  { id: 4, name: 'Desk Lamp', category: 'office', price: 39, stock: 21 },
  { id: 5, name: 'Trail Backpack', category: 'outdoor', price: 89, stock: 0 },
  { id: 6, name: 'Insulated Bottle', category: 'outdoor', price: 25, stock: 40 },
];
const byId = (id) => PRODUCTS.find(p => p.id === Number(id));

createApp({
  name: 'shop',
  seed: () => ({ cart: [], orders: [], user: null, nextOrder: 1001 }),
  handler: async ({ url, state, form, send, redirect, sendJson, bug, req }) => {
    const p = url.pathname;
    const cartCount = state.cart.reduce((n, i) => n + i.qty, 0);

    const layout = (title, main, { head = '' } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} - Shopfront</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;margin:0}header,footer{padding:12px 24px;background:#f3f4f6}nav a{margin-right:16px}main{padding:24px;max-width:960px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{border:1px solid #ddd;padding:12px}.err{color:#b00020}label{display:block;margin:8px 0}</style>${head}</head><body>
<header><nav aria-label="Main"><a href="/">Home</a><a href="/products">Products</a><a href="/cart">Cart (${cartCount})</a><a href="/about">About</a><a href="/contact">Contact</a>
${state.user ? '<a href="/account">Account</a>' : '<a href="/login">Log in</a>'}</nav></header>
<main>${main}</main>
<footer><a href="/about">About us</a> · <a href="${bug('shop-broken-link') ? '/help-center' : '/help'}">Help</a> · <a href="/contact">Contact</a></footer></body></html>`;

    const notFound = () => send(404, layout('Not found', '<h1>Page not found</h1><p>The page you requested does not exist.</p><a href="/">Back to home</a>'));

    // ---- API
    if (p.startsWith('/api/stock/')) {
      if (bug('shop-failing-api')) return sendJson(500, { error: 'stock service down' });
      const prod = byId(p.split('/').pop());
      return prod ? sendJson(200, { stock: prod.stock }) : sendJson(404, {});
    }

    // ---- Pages
    if (p === '/') {
      return send(200, layout('Home', `<h1>Welcome to Shopfront</h1><p>Quality gear for work and play.</p>
<h2>Featured</h2><ul>${PRODUCTS.slice(0, 3).map(x => `<li><a href="/products/${x.id}">${esc(x.name)}</a> - $${x.price}</li>`).join('')}</ul>
<a href="/products">Shop all products</a>`));
    }
    if (p === '/products') {
      const cat = url.searchParams.get('category');
      const list = cat ? PRODUCTS.filter(x => x.category === cat) : PRODUCTS;
      const cats = ['audio', 'office', 'outdoor'];
      const wide = bug('shop-layout-overflow') ? '<div style="width:1700px;background:#fde68a">Summer sale banner</div>' : '';
      return send(200, layout('Products', `<h1>${cat ? 'Category: ' + esc(cat) : 'All products'}</h1>${wide}
<nav aria-label="Categories">${cats.map(c => `<a href="/products?category=${c}">${c}</a> `).join('')}<a href="/products">all</a></nav>
<div class="grid">${list.map(x => `<div class="card"><h2>${esc(x.name)}</h2><p>$${x.price}</p><a href="/products/${x.id}">View ${esc(x.name)}</a></div>`).join('')}</div>`));
    }
    const pm = p.match(/^\/products\/(\d+)$/);
    if (pm) {
      const prod = byId(pm[1]);
      if (!prod) return notFound();
      const addBtn = bug('shop-dead-add-to-cart')
        ? `<button type="button" onclick="addItem(${prod.id})">Add to cart</button>`
        : `<form method="post" action="/cart/add"><input type="hidden" name="id" value="${prod.id}"><button type="submit">Add to cart</button></form>`;
      return send(200, layout(prod.name, `<h1>${esc(prod.name)}</h1><p>$${prod.price} · ${esc(prod.category)}</p>
<p id="stock">Checking stock…</p>${addBtn}<p><a href="/products">Back to products</a></p>
<script>
fetch('/api/stock/${prod.id}').then(r=>{ if(!r.ok) throw new Error('stock '+r.status); return r.json(); })
 .then(d=>{document.getElementById('stock').textContent = d.stock>0 ? 'In stock' : 'Out of stock';})
 .catch(e=>{document.getElementById('stock').textContent='Stock unavailable'; console.error('stock lookup failed', e.message);});
</script>`));
    }
    if (p === '/cart/add' && req.method === 'POST') {
      const prod = byId(form.id);
      if (prod) {
        const ex = state.cart.find(i => i.id === prod.id);
        ex ? ex.qty++ : state.cart.push({ id: prod.id, qty: 1 });
      }
      return redirect('/cart');
    }
    if (p === '/cart/remove' && req.method === 'POST') {
      state.cart = state.cart.filter(i => i.id !== Number(form.id));
      return redirect('/cart');
    }
    if (p === '/cart') {
      if (!state.cart.length) return send(200, layout('Cart', `<h1>Your cart</h1><p>Your cart is empty.</p><a href="/products">Browse products</a>`));
      const total = state.cart.reduce((s, i) => s + byId(i.id).price * i.qty, 0);
      return send(200, layout('Cart', `<h1>Your cart</h1><ul>${state.cart.map(i => `<li>${esc(byId(i.id).name)} × ${i.qty}
<form method="post" action="/cart/remove" style="display:inline"><input type="hidden" name="id" value="${i.id}"><button>Remove</button></form></li>`).join('')}</ul>
<p>Subtotal: $${total}</p><a href="/checkout">Proceed to checkout</a>`));
    }
    if (p === '/checkout' && req.method === 'GET') {
      return send(200, layout('Checkout', checkoutForm('')));
    }
    if (p === '/checkout' && req.method === 'POST') {
      const errs = [];
      if (!form.name?.trim()) errs.push('Please enter your name');
      if (!bug('shop-missing-validation') && !/^\S+@\S+\.\S+$/.test(form.email || '')) errs.push('Please enter a valid email');
      if (!form.address?.trim()) errs.push('Please enter your address');
      if (errs.length) return send(200, layout('Checkout', checkoutForm(`<div role="alert" class="err">${errs.map(esc).join('<br>')}</div>`)));
      const id = state.nextOrder++;
      state.orders.push({ id, items: state.cart }); state.cart = [];
      return redirect(`/order/${id}`);
    }
    const om = p.match(/^\/order\/(\d+)$/);
    if (om) return send(200, layout('Order', `<h1>Order confirmed</h1><p>Thank you! Your order #${om[1]} is on its way.</p><a href="/products">Continue shopping</a>`));
    if (p === '/login' && req.method === 'GET') return send(200, layout('Log in', loginForm('')));
    if (p === '/login' && req.method === 'POST') {
      if (form.email === 'demo@example.com' && form.password === 'password123') { state.user = form.email; return redirect('/account'); }
      return send(200, layout('Log in', loginForm('<div role="alert" class="err">Invalid email or password</div>')));
    }
    if (p === '/account') {
      if (!state.user) return redirect('/login');
      return send(200, layout('Account', `<h1>My account</h1><p>Signed in as ${esc(state.user)}</p><h2>Orders</h2><p>${state.orders.length} orders this session.</p><a href="/logout">Log out</a>`));
    }
    if (p === '/logout') { state.user = null; return redirect('/'); }
    if (p === '/about') {
      const bad = bug('shop-console-error') ? `<script>console.error('Team widget failed to initialise');</script>` : '';
      return send(200, layout('About', `<h1>About us</h1><p>We have sold gear since 2012.</p>${bad}`));
    }
    if (p === '/help' && !bug('shop-broken-link')) return send(200, layout('Help', `<h1>Help center</h1><p>Shipping takes 3-5 days.</p>`));
    if (p === '/contact' && req.method === 'GET') {
      return send(200, layout('Contact', `<h1>Contact us</h1><form method="post" action="/contact"><label>Name <input name="name" type="text" required></label>
<label>Email <input name="email" type="email" required></label><label>Message <textarea name="message"></textarea></label><button type="submit">Send message</button></form>`));
    }
    if (p === '/contact' && req.method === 'POST') return redirect('/contact/sent');
    if (p === '/contact/sent') return send(200, layout('Thanks', `<h1>Message sent</h1><p>We will reply within one business day.</p><a href="/">Back home</a>`));
    return notFound();

    function checkoutForm(banner) {
      return `<h1>Checkout</h1>${banner}<form method="post" action="/checkout" novalidate>
<label>Full name <input name="name" type="text"></label><label>Email <input name="email" type="email"></label>
<label>Address <input name="address" type="text"></label><button type="submit">Place order</button></form>`;
    }
    function loginForm(banner) {
      return `<h1>Log in</h1>${banner}<form method="post" action="/login"><label>Email <input name="email" type="email"></label>
<label>Password <input name="password" type="password"></label><button type="submit">Sign in</button></form>`;
    }
  },
});
