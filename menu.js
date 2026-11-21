// Menu commun aux pages : un bouton en haut à gauche, qui ouvre la liste des vues.
// Usage : <script src="menu.js" data-page="sat" data-root="./"></script>
(function () {
  const me = document.currentScript, here = me.dataset.page, root = me.dataset.root || './';
  const PAGES = [
    { id: 'sat', href: root, name: 'Satellites', text: 'Vise le ciel et vois ceux qui passent' },
    { id: 'mars', href: root + 'mars/', name: 'Mars en 3D', text: 'Tourne autour, descends sur le relief' },
  ];

  const css = document.createElement('style');
  css.textContent = `
#nav{position:fixed;left:12px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:20;font:15px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#navBtn{display:grid;place-items:center;width:44px;min-width:44px;height:44px;min-height:44px;padding:0;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:12px;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#navBtn:hover,#navBtn[aria-expanded=true]{border-color:var(--ice)}
#navBtn:focus-visible,#navList a:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
#navList{position:absolute;left:0;top:52px;width:min(280px,calc(100vw - 24px));margin:0;padding:6px;list-style:none;background:#0a0e1c;border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.6)}
#navList[hidden]{display:none}
#navList a{display:grid;grid-template-columns:8px 1fr;column-gap:12px;align-items:center;padding:10px 12px;border-radius:10px;color:var(--ink);text-decoration:none}
#navList a:hover{background:rgba(160,190,255,.09)}
#navList a::before{content:"";grid-row:1 / span 2;width:8px;height:8px;border-radius:50%;border:1px solid var(--dim)}
#navList a[aria-current]::before{background:var(--amber);border-color:var(--amber)}
#navList b{font-weight:600}
#navList a[aria-current] b{color:var(--amber)}
#navList small{grid-column:2;font-size:13px;color:var(--dim)}`;
  document.head.appendChild(css);

  const nav = document.createElement('nav');
  nav.id = 'nav';
  nav.setAttribute('aria-label', 'Vues');
  nav.innerHTML = `<button id="navBtn" aria-label="Menu" aria-expanded="false" aria-controls="navList">
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg></button>
<ul id="navList" hidden>${PAGES.map(p => `<li><a href="${p.href}"${p.id === here ? ' aria-current="page"' : ''}><b>${p.name}</b><small>${p.text}</small></a></li>`).join('')}</ul>`;
  document.body.appendChild(nav);

  const btn = nav.querySelector('#navBtn'), list = nav.querySelector('#navList');
  function set(open) { list.hidden = !open; btn.setAttribute('aria-expanded', open); }
  btn.addEventListener('click', () => set(list.hidden));
  // La vue en cours : le lien referme simplement le menu, sans recharger la page.
  list.addEventListener('click', e => { const a = e.target.closest('a'); if (a && a.hasAttribute('aria-current')) { e.preventDefault(); set(false); } });
  document.addEventListener('pointerdown', e => { if (!list.hidden && !nav.contains(e.target)) set(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !list.hidden) { set(false); btn.focus(); } });
})();
