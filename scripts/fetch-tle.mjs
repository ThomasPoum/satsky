// Miroir des orbites CelesTrak : un seul téléchargement toutes les quelques heures pour tous les utilisateurs,
// au lieu d'un par téléphone (CelesTrak limite les gros groupes comme Starlink et Active, HTTP 403).
// Usage : node scripts/fetch-tle.mjs <dossier>   — conserve l'ancien fichier si un groupe échoue.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const GROUPS = ['visual', 'stations', 'starlink', 'gps-ops', 'galileo', 'weather', 'science', 'resource', 'active'];
const out = process.argv[2] || 'data';
const sleep = ms => new Promise(r => setTimeout(r, ms));
await mkdir(out, { recursive: true });

let meta = {};
try { meta = JSON.parse(await readFile(join(out, 'meta.json'), 'utf8')); } catch {}
let failures = 0;
for (const g of GROUPS) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'SatSky/1.2 (+https://github.com/ThomasPoum/satsky)' } });
    const txt = await r.text();
    const n = (txt.match(/^1 /gm) || []).length;
    if (!r.ok || n === 0) throw new Error(`HTTP ${r.status} : ${txt.slice(0, 100).replace(/\s+/g, ' ')}`);
    await writeFile(join(out, `${g}.tle`), txt);
    meta[g] = { count: n, fetched: new Date().toISOString() };
    console.log(`✓ ${g} : ${n} satellites`);
  } catch (e) {
    failures++;
    console.warn(`✗ ${g} : ${e.message} (ancien fichier conservé)`);
  }
  await sleep(3000); // politesse envers CelesTrak
}
await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 1));
if (failures === GROUPS.length) process.exit(1);
