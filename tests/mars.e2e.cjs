const { test, expect } = require('@playwright/test');

// Mars en 3D : la page charge ses tuiles locales, affiche la planète et répond au zoom.
test.setTimeout(120_000);

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
