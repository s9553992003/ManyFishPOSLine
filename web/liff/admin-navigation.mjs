const pages = ['reports-section', 'menu-section', 'schedule-section', 'orders-section', 'management-section', 'imports-section'];
const restricted = new Set(['management-section', 'imports-section']);
export function resolveAdminPage(hash, user) {
 if (!user || user.mustChangePassword) return null;
 const id = hash.replace(/^#/, '');
 const page = ({'schedule-form':'schedule-section', 'admin-orders':'orders-section'})[id] ?? id;
 return pages.includes(page) && (!restricted.has(page) || user.role === 'ADMIN') ? page : 'reports-section';
}
export function createAdminNavigation(getUser, doc = document, win = window) {
 const links = [...doc.querySelectorAll('.admin-nav a')];
 const menu = doc.getElementById('admin-sidebar');
 const toggle = doc.getElementById('admin-menu-toggle');
 function close() { menu.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); }
 function refresh(focus = false) {
  const user = getUser(), page = resolveAdminPage(win.location.hash, user);
  for (const id of pages) doc.getElementById(id).hidden = id !== page;
  for (const link of links) {
   const id = link.hash.slice(1);
   link.hidden = restricted.has(id) && user?.role !== 'ADMIN';
   if (id === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  const active = links.find(link => link.hash === '#'+page);
  doc.getElementById('admin-page-label').textContent = active?.textContent ?? '功能選單';
  doc.body.classList.toggle('admin-signed-in', !!user);
  close();
  if (page && win.location.hash !== '#'+page) win.history.replaceState(null, '', '#'+page);
  if (focus && page) { const panel = doc.getElementById(page); panel.focus({preventScroll:true}); win.scrollTo({top:0,behavior:'instant'}); }
 }
 function open(id) {
  const page = resolveAdminPage('#'+id, getUser());
  if (!page) return;
  if (win.location.hash !== '#'+page) win.history.pushState(null, '', '#'+page);
  refresh(true);
 }
 for (const link of links) link.addEventListener('click', event => {
  if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
  event.preventDefault();open(link.hash.slice(1));
 });
 toggle.addEventListener('click', () => { const expanded = menu.classList.toggle('is-open'); toggle.setAttribute('aria-expanded', String(expanded)); });
 menu.addEventListener('keydown', event => { if(event.key === 'Escape'){close();toggle.focus();} });
 win.addEventListener('popstate', () => refresh(true));
 win.addEventListener('hashchange', () => refresh(true));
 return {refresh,open};
}
