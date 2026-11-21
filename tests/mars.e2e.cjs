const { test, expect } = require('@playwright/test');

// Mars en 3D : la page charge ses tuiles locales, affiche la planète et répond au zoom.
test.setTimeout(300_000);

test('Mars : globe affiché, altitudes MOLA exactes, descente au zoom', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/mars/index.html');
  await page.waitForFunction(() => window.mars && window.mars.ready, null, { timeout: 60_000 });
  await expect(page.locator('#load')).toHaveClass(/done/);

  // Altitudes relues sans perte depuis le PNG (valeurs de la grille MOLA moyennée) : Olympus Mons, Hellas, méridien origine.
  const h = await page.evaluate(() => [[17.5, -133], [-41.5, 68], [0, 0]].map(([la, lo]) => Math.round(window.mars.sampleLow(la, lo) * 1000)));
  expect(h).toEqual([21078, -6832, -1407]);

  // Le centre de l'image est sur Mars, côté jour : orangé, pas noir.
  await page.evaluate(() => { window.mars.sun.speed = 0; window.mars.sun.lon = window.mars.view.lon; });
  await page.waitForFunction(() => window.mars.stats.tiles > 0);
  const [r, g, b] = await page.evaluate(() => window.mars.probe());
  expect(r).toBeGreaterThan(90); expect(r).toBeGreaterThan(b + 30); expect(r).toBeGreaterThan(g);

  // La molette rapproche du sol, et des tuiles plus fines arrivent.
  const before = await page.evaluate(() => window.mars.view.distGoal);
  await page.mouse.move(200, 400);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -300);
  await expect.poll(() => page.evaluate(() => window.mars.view.distGoal), { timeout: 30_000 }).toBeLessThan(before / 5);
  await page.waitForFunction(() => Object.keys(window.mars.levels()).some(l => +l >= 3), null, { timeout: 60_000 });
  await expect(page.locator('#hAlt')).toContainText('km');
  expect(errors).toEqual([]);
});

test('Mars : se déplacer garde l’altitude, la ville est là', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/mars/index.html');
  await page.waitForFunction(() => window.mars && window.mars.ready, null, { timeout: 60_000 });
  // Au bord de Valles Marineris, à basse altitude, cap au sud : le sol va s'effondrer sous la caméra.
  await page.evaluate(() => { const m = window.mars; m.sun.speed = 0; document.getElementById('panel').hidden = true; m.flyTo(-8.6, -70, 30, false, Math.PI); m.view.rate = 60; });
  await page.waitForFunction(() => Math.abs(window.mars.view.dist - 30) < 0.01, null, { timeout: 60_000 });
  const pose = () => page.evaluate(() => ({ alt: window.mars.alt, agl: window.mars.agl, lat: window.mars.view.lat }));
  const a = await pose();
  await page.mouse.move(200, 250); await page.mouse.down(); await page.mouse.move(200, 600, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await pose()).lat, { timeout: 30_000 }).toBeLessThan(a.lat - 0.3);
  const b = await pose();
  expect(Math.abs(b.alt - a.alt)).toBeLessThan(0.001);        // même altitude au-dessus du niveau zéro
  // Regarder autour de soi ne déplace pas la caméra.
  const before = await page.evaluate(() => window.mars.camera.position.toArray());
  await page.evaluate(() => window.mars.lookAround(0.6, -0.4));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.mars.camera.position.toArray());
  for (let i = 0; i < 3; i++) expect(Math.abs(after[i] - before[i])).toBeLessThan(0.01);
  // Le site de la ville est un plateau, et ses noms existent.
  const flat = await page.evaluate(() => { const S = window.mars.SITE; return [0, 0.2, -0.3].map(d => window.mars.heightAt(S.lat + d, S.lon - d)); });
  for (const h of flat) expect(h).toBeCloseTo(-4.75, 5);
  await expect(page.locator('.lb.city')).toHaveCount(6);
  // Terraformation : les plaines du nord, sous le rivage d'Arabia, deviennent un océan ; la ville reste au sec.
  await page.evaluate(() => { const m = window.mars; m.flyTo(62, -30, 6000); m.view.tiltGoal = 0; m.sun.lon = -30; m.sun.ls = 90; m.view.rate = 60; });
  await page.waitForFunction(() => Math.abs(window.mars.view.dist - 6000) < 5, null, { timeout: 30_000 });
  const dry = await page.evaluate(() => window.mars.probe());
  expect(dry[0]).toBeGreaterThan(dry[2] + 20);
  await page.evaluate(() => { window.mars.setTerra(1); window.mars.shared.uWet.value = 0.2; });      // peu d'humidité : pas de nuages devant
  const wet = await page.evaluate(() => window.mars.probe());
  expect(wet[2]).toBeGreaterThan(wet[0] + 20);
  expect(await page.evaluate(() => window.mars.shared.uSea.value)).toBeCloseTo(-2.09, 5);
  await page.evaluate(() => window.mars.setTerra(0));
  // Depuis la vue globale, un clic sur le nom de la ville y emmène (et pas chez un voisin).
  await page.evaluate(() => { const m = window.mars; m.flyTo(2, -92, 11500); m.view.rate = 60; });
  const name = page.locator('.lb.city', { hasText: 'Nouvelle-Arès' });
  await expect(name).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Math.abs(window.mars.view.dist - 11500) < 5, null, { timeout: 30_000 });
  const box = await name.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => window.mars.view.distGoal), { timeout: 30_000 }).toBe(70);
  const goal = await page.evaluate(() => { const m = window.mars, v = new m.camera.position.constructor(0, 1, 0).applyQuaternion(m.view.qGoal); return [Math.asin(v.y) * 57.2958, Math.atan2(-v.z, v.x) * 57.2958]; });
  expect(goal[0]).toBeCloseTo(-11.2, 1); expect(goal[1]).toBeCloseTo(-70, 1);
  expect(errors).toEqual([]);
});

test('Menu : on passe des satellites à Mars et retour', async ({ page }) => {
  await page.route('https://**', r => r.abort());
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: /Satellites/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: /Mars en 3D/ }).click();
  await expect(page).toHaveURL(/\/mars\/$/);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: /Mars en 3D/ })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: /Satellites/ })).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: /Satellites/ }).click();
  await expect(page.locator('#start')).toBeVisible();
});
