const { test, expect } = require('@playwright/test');
const F = require('./fixtures.cjs');

// Une cinquantaine de satellites fictifs en orbite basse, répartis tout autour du ciel
function fakeTLE() {
  const out = [F.ISS];
  for (let i = 0; i < 50; i++) {
    const id = String(40000 + i).padStart(5, '0'), raan = (i * 7.3 % 360).toFixed(4).padStart(8), ma = (i * 37 % 360).toFixed(4).padStart(8);
    out.push([`SAT-${i}`, `1 ${id}U 20001A   26324.50000000  .00001000  00000-0  10000-3 0  9990`, `2 ${id}  53.0000 ${raan} 0001000  90.0000 ${ma} 15.06000000100000`]);
  }
  return F.tle(...out);
}
const SATCAT = [{ OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544, OBJECT_TYPE: 'PAY', OPS_STATUS_CODE: '+', OWNER: 'ISS', LAUNCH_DATE: '1998-11-20', LAUNCH_SITE: 'TYMSC' }];
const WIKI = { type: 'standard', title: 'Station spatiale internationale', extract: 'Texte de test issu de Wikipédia.', content_urls: { mobile: { page: 'https://fr.m.wikipedia.org/wiki/Station_spatiale_internationale' } } };

async function setup(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://raw.githubusercontent.com/**', r => r.fulfill({ body: fakeTLE(), headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://celestrak.org/**', r => r.fulfill({ body: r.request().url().includes('satcat') ? JSON.stringify(SATCAT) : fakeTLE(), headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://*.wikipedia.org/**', r => r.fulfill({ body: JSON.stringify(r.request().url().includes('search') ? { query: { search: [] } } : WIKI), headers: { 'access-control-allow-origin': '*' } }));
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 48.8566, longitude: 2.3522 });
  await page.goto('/index.html');
  await expect(page.locator('#stat')).toContainText('au-dessus');
  return errors;
}
// Simule la boussole : vise en continu une cible choisie dans la page (az/el en degrés)
async function aimAt(page, pick) {
  await page.evaluate(pick => {
    clearInterval(window.__aimTimer);
    const S = window.__satsky, choose = new Function('S', 'return ' + pick);
    window.__aimTimer = setInterval(() => {
      const t = choose(S); if (!t) return;
      dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { alpha: (360 - t.az) % 360, beta: 90 + t.el, gamma: 0, absolute: true }));
    }, 16);
  }, pick);
}
const HIGHEST = "S.sats.filter(s => s.el > 8).sort((a, b) => b.el - a.el)[0]";

test('la visée verrouille la cible après 2 s et affiche passage, globe et fiche', async ({ page }) => {
  const errors = await setup(page);
  await page.click('#go');
  await aimAt(page, HIGHEST);
  await page.waitForTimeout(600);
  await expect(page.locator('#card'), 'pendant la visée, pas de fiche : la vue reste dégagée').not.toHaveClass(/show/);
  await expect(page.locator('#bClear')).toHaveText('Verrouiller');
  await expect(page.locator('#bClear')).toHaveText('Lâcher', { timeout: 4000 });
  await expect(page.locator('#card')).toHaveClass(/locked/);
  await expect(page.locator('#cGlobe')).toBeVisible();
  await expect(page.locator('#cPass')).toContainText(/couche|Monte|Redescend|horizon/);
  await page.click('#cMore');
  await expect(page.locator('#fiche')).toHaveClass(/open/);
  await expect(page.locator('#fBody')).toContainText('Un tour de Terre');
  await expect(page.locator('#fBody')).toContainText('Baïkonour');
  expect(errors).toEqual([]);
});

test('lâcher une cible efface ses infos et ne la reverrouille pas', async ({ page }) => {
  await setup(page);
  await page.click('#go');
  await aimAt(page, HIGHEST);
  await expect(page.locator('#bClear')).toHaveText('Lâcher', { timeout: 4000 });
  await expect(page.locator('#card')).toHaveClass(/show/);
  await page.click('#bClear');
  await expect(page.locator('#bClear')).toHaveText('Verrouiller');
  await expect(page.locator('#card')).not.toHaveClass(/show/);
  await page.waitForTimeout(2600);
  await expect(page.locator('#bClear')).toHaveText('Verrouiller');
  await expect(page.locator('#card'), 'la fiche ne revient pas toute seule').not.toHaveClass(/show/);
});

test('viser un autre satellite libère le précédent puis verrouille le nouveau', async ({ page }) => {
  await setup(page);
  await page.click('#go');
  await aimAt(page, HIGHEST);
  await expect(page.locator('#bClear')).toHaveText('Lâcher', { timeout: 4000 });
  const first = await page.locator('#cMode').textContent();
  // nouvelle cible : le plus haut des satellites à plus de 15° du premier
  await page.evaluate(() => { window.__first = window.__satsky.sel; });
  await aimAt(page, `(() => { const f = window.__first, r = Math.PI / 180;
    const sep = s => Math.acos(Math.min(1, Math.sin(s.el * r) * Math.sin(f.el * r) + Math.cos(s.el * r) * Math.cos(f.el * r) * Math.cos((s.az - f.az) * r))) / r;
    return S.sats.filter(s => s.el > 8 && s !== f && sep(s) > 15).sort((a, b) => b.el - a.el)[0]; })()`);
  await expect(page.locator('#bClear'), 'le précédent est libéré dès qu\'on vise ailleurs').toHaveText('Verrouiller', { timeout: 1500 });
  await expect(page.locator('#card')).not.toHaveClass(/show/);
  await expect(page.locator('#bClear')).toHaveText('Lâcher', { timeout: 4000 });
  await expect(page.locator('#cMode')).not.toHaveText(first);
});

test('un petit tremblement ne remet pas le verrouillage à zéro', async ({ page }) => {
  await setup(page);
  await page.click('#go');
  // vise la cible, mais toutes les 0,5 s décroche 100 ms à 3° à côté
  await aimAt(page, `(() => { const t = ${HIGHEST}; if (!t) return null; const off = (performance.now() % 500) < 100 ? 3 : 0; return { az: t.az + off, el: t.el }; })()`);
  await expect(page.locator('#bClear')).toHaveText('Lâcher', { timeout: 5000 });
});

test('la liste permet de chercher et verrouiller un satellite', async ({ page }) => {
  const errors = await setup(page);
  await page.click('#goMap');
  await page.click('#bList');
  await page.fill('#q', 'ISS');
  await page.locator('#list li[data-id="25544"]').click();
  await expect(page.locator('#bClear')).toHaveText('Lâcher');
  await expect(page.locator('#cName')).toHaveText('ISS (ZARYA)');
  await expect(page.locator('#cSub')).toContainText('Station spatiale habitée');
  await page.click('#cMore');
  await expect(page.locator('#fBody')).toContainText('occupé en permanence');
  await expect(page.locator('#fBody')).toContainText('Wikipédia');
  expect(errors).toEqual([]);
});

test('la carte du ciel s\'affiche sans capteurs et sans erreur', async ({ page }) => {
  const errors = await setup(page);
  await page.click('#goMap');
  await page.waitForTimeout(800);
  const painted = await page.evaluate(() => { const c = document.querySelector('#cv'), x = c.getContext('2d').getImageData(c.width / 2, c.height / 3, 1, 1).data; return x[0] + x[1] + x[2]; });
  expect(painted).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('si le miroir est indisponible, les orbites viennent de CelesTrak', async ({ page }) => {
  await page.route('https://raw.githubusercontent.com/**', r => r.fulfill({ status: 404, body: 'Not Found' }));
  const errors = await setup(page);
  expect(errors).toEqual([]);
});

test('une grosse constellation (9 000 satellites) se charge sans geler l\'écran', async ({ page }) => {
  const big = [];
  for (let i = 0; i < 9000; i++) {
    const id = String(50000 + i), raan = (i * 0.731 % 360).toFixed(4).padStart(8), ma = (i * 13.7 % 360).toFixed(4).padStart(8);
    big.push([`STARLINK-${i}`, `1 ${id}U 20001A   26324.50000000  .00001000  00000-0  10000-3 0  9990`, `2 ${id}  53.0000 ${raan} 0001000  90.0000 ${ma} 15.06000000100000`]);
  }
  const txt = F.tle(...big);
  await setup(page);
  await page.route('https://raw.githubusercontent.com/**', r => r.fulfill({ body: txt, headers: { 'access-control-allow-origin': '*' } }));
  await page.click('#goMap');
  // mesure le plus long intervalle entre deux images pendant le chargement et les premiers calculs
  await page.evaluate(() => { window.__maxGap = 0; let last = performance.now(); const f = t => { window.__maxGap = Math.max(window.__maxGap, t - last); last = t; if (!window.__stopGap) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await page.selectOption('#group', 'starlink');
  await expect(page.locator('#stat')).toContainText('au-dessus', { timeout: 20000 });
  await page.waitForTimeout(3000);
  const gap = await page.evaluate(() => { window.__stopGap = true; return window.__maxGap; });
  expect(await page.evaluate(() => window.__satsky.sats.length)).toBe(9000);
  expect(gap, `plus longue image : ${Math.round(gap)} ms`).toBeLessThan(250);
});
