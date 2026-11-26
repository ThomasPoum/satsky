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

test('Mars : se déplacer garde l’altitude, terraformation, clic sur un nom', async ({ page }) => {
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
  // Terraformation : les plaines du nord, sous le rivage d'Arabia, deviennent un océan.
  await page.evaluate(() => { const m = window.mars; m.flyTo(62, -30, 6000); m.view.tiltGoal = 0; m.sun.lon = -30; m.sun.ls = 90; m.view.rate = 60; });
  await page.waitForFunction(() => Math.abs(window.mars.view.dist - 6000) < 5, null, { timeout: 30_000 });
  const dry = await page.evaluate(() => window.mars.probe());
  expect(dry[0]).toBeGreaterThan(dry[2] + 20);
  await page.evaluate(() => { window.mars.setTerra(1); window.mars.shared.uWet.value = 0.2; });      // peu d'humidité : pas de nuages devant
  const wet = await page.evaluate(() => window.mars.probe());
  expect(wet[2]).toBeGreaterThan(wet[0] + 20);
  expect(await page.evaluate(() => window.mars.shared.uSea.value)).toBeCloseTo(-2.09, 5);
  await page.evaluate(() => window.mars.setTerra(0));
  // Depuis la vue globale, un clic sur un nom y emmène (et pas chez un voisin).
  await page.evaluate(() => { const m = window.mars; m.flyTo(2, -92, 11500); m.view.rate = 60; });
  const name = page.locator('.lb', { hasText: 'Olympus Mons' });
  await expect(name).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Math.abs(window.mars.view.dist - 11500) < 5, null, { timeout: 30_000 });
  const box = await name.boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => window.mars.view.distGoal), { timeout: 30_000 }).toBe(900);
  const goal = await page.evaluate(() => { const m = window.mars, v = new m.camera.position.constructor(0, 1, 0).applyQuaternion(m.view.qGoal); return [Math.asin(v.y) * 57.2958, Math.atan2(-v.z, v.x) * 57.2958]; });
  expect(goal[0]).toBeCloseTo(18.65, 1); expect(goal[1]).toBeCloseTo(-133.8, 1);
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

test('Mars : repères gardés au rechargement, mesure de distance au clic', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/mars/index.html');
  await page.waitForFunction(() => window.mars && window.mars.ready, null, { timeout: 60_000 });
  // Un quart de méridien : πR/2.
  expect(await page.evaluate(() => window.mars.gcKm(0, 0, 90, 0))).toBeCloseTo(Math.PI * 3389.5 / 2, 3);
  await page.evaluate(() => { const m = window.mars; m.sun.speed = 0; m.flyTo(-5, -70, 4000); m.view.rate = 60; });
  await page.waitForFunction(() => Math.abs(window.mars.view.dist - 4000) < 1, null, { timeout: 30_000 });
  const vp = page.viewportSize(), cx = vp.width / 2, cy = vp.height / 2;

  // Deux repères posés au toucher.
  await page.getByRole('button', { name: 'Repères' }).click();
  await expect(page.locator('#panel')).toBeHidden();
  await page.mouse.click(cx - 60, cy);
  await page.mouse.click(cx + 60, cy + 30);
  await expect(page.locator('#pins li')).toHaveCount(2);
  await expect(page.locator('#pins input').first()).toHaveValue('Repère 1');
  await page.locator('#pins input').first().fill('Base Alpha');

  // Mesure : on part du premier repère (accroché), puis un point au sol.
  await page.getByRole('button', { name: 'Mesurer' }).click();
  await expect(page.locator('#pinBox')).toBeHidden();
  const pin = await page.evaluate(() => ({ x: window.mars.pins[0].x, y: window.mars.pins[0].y }));
  await page.mouse.click(pin.x + 5, pin.y - 4);
  await page.mouse.click(cx + 80, cy - 120);
  const m = await page.evaluate(() => { const [a, b] = window.mars.measure, p = window.mars.pins[0]; return { a, b, p, km: window.mars.gcKm(a.lat, a.lon, b.lat, b.lon) }; });
  expect(m.a).toEqual({ lat: m.p.lat, lon: m.p.lon });
  expect(m.km).toBeGreaterThan(50);
  const shown = (await page.locator('#mDist').textContent()).replace(/\s/g, '').replace(',', '.');
  expect(parseFloat(shown)).toBeCloseTo(m.km, 0);
  // « Retirer » enlève le dernier point.
  await page.getByRole('button', { name: 'Retirer le dernier point' }).click();
  expect(await page.evaluate(() => window.mars.measure.length)).toBe(1);

  // Les repères survivent au rechargement, avec leur nom.
  await page.reload();
  await page.waitForFunction(() => window.mars && window.mars.ready, null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.mars.pins.map(p => p.name))).toEqual(['Base Alpha', 'Repère 2']);
  expect(errors).toEqual([]);
});
