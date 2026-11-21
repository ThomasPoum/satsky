// Miroir des orbites CelesTrak : un seul téléchargement toutes les quelques heures pour tous les utilisateurs,
// au lieu d'un par téléphone (CelesTrak limite les gros groupes comme Starlink et Active : HTTP 403, coupures).
// Usage : node scripts/fetch-tle.mjs <dossier>   — conserve l'ancien fichier si un groupe échoue.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Starlink n'est pas téléchargé à part : CelesTrak coupe souvent ce transfert. On l'extrait du groupe « active »,
// qui contient tous les Starlink en service — et ça fait une requête de moins chez CelesTrak.
export const GROUPS = ['visual', 'stations', 'gps-ops', 'galileo', 'weather', 'science', 'resource', 'active'];
export const DERIVED = { starlink: { from: 'active', re: /^STARLINK/ } };

export function filterTLE(txt, re) {
  const L = txt.split(/\r?\n/), out = [];
  for (let i = 0; i + 2 < L.length + 0; i++) {
    if (L[i + 1]?.startsWith('1 ') && L[i + 2]?.startsWith('2 ')) {
      if (re.test(L[i].trim())) out.push(L[i], L[i + 1], L[i + 2]);
      i += 2;
    }
  }
  return out.length ? out.join('\n') + '\n' : '';
}

async function main(out) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await mkdir(out, { recursive: true });
  let meta = {};
  try { meta = JSON.parse(await readFile(join(out, 'meta.json'), 'utf8')); } catch {}
  let ok = 0;
  for (const g of GROUPS) {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'SatSky/1.3 (+https://github.com/ThomasPoum/satsky)' }, signal: AbortSignal.timeout(240000) });
        const txt = await r.text(), n = (txt.match(/^1 /gm) || []).length;
        if (!r.ok || n === 0) throw new Error(`HTTP ${r.status} : ${txt.slice(0, 100).replace(/\s+/g, ' ')}`);
        await writeFile(join(out, `${g}.tle`), txt);
        meta[g] = { count: n, fetched: new Date().toISOString() };
        console.log(`✓ ${g} : ${n} satellites`); ok++;
        break;
      } catch (e) {
        console.warn(`✗ ${g} (essai ${attempt}) : ${e.message}`);
        if (attempt === 1) await sleep(20000);
      }
    }
    await sleep(3000); // politesse envers CelesTrak
  }
  for (const [g, { from, re }] of Object.entries(DERIVED)) {
    try {
      const txt = filterTLE(await readFile(join(out, `${from}.tle`), 'utf8'), re), n = (txt.match(/^1 /gm) || []).length;
      if (!n) throw new Error('aucun satellite');
      await writeFile(join(out, `${g}.tle`), txt);
      meta[g] = { count: n, fetched: meta[from]?.fetched, derivedFrom: from };
      console.log(`✓ ${g} : ${n} satellites (extraits de ${from})`);
    } catch (e) { console.warn(`✗ ${g} : ${e.message} (ancien fichier conservé)`); }
  }
  await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 1));
  if (!ok) process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv[2] || 'data');
