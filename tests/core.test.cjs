const test = require('node:test');
const assert = require('node:assert/strict');
const sat = require('../satellite.min.js');
const C = require('../core.js');
require('../kb.js');
const F = require('./fixtures.cjs');
const { D } = C;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} attendu ${b} ± ${tol}, obtenu ${a}`);

test('wrap180 ramène les angles dans [-180, 180)', () => {
  near(C.wrap180(190), -170, 1e-9); near(C.wrap180(-190), 170, 1e-9); near(C.wrap180(720 + 10), 10, 1e-9);
});

test('Soleil : déclinaison aux solstices et à l\'équinoxe', () => {
  const dec = d => { const s = C.sunEci(new Date(d)); return Math.asin(s.z / Math.hypot(s.x, s.y, s.z)) / D; };
  near(dec('2026-06-21T08:24:00Z'), 23.44, 0.05, 'solstice de juin');
  near(dec('2026-12-21T20:50:00Z'), -23.44, 0.05, 'solstice de décembre');
  near(dec('2026-03-20T14:46:00Z'), 0, 0.05, 'équinoxe de mars');
  const s = C.sunEci(new Date('2026-01-03T12:00:00Z'));
  near(Math.hypot(s.x, s.y, s.z) / 1.496e8, 0.983, 0.002, 'distance au périhélie (UA)');
});

test('Ombre de la Terre : côté jour éclairé, derrière la Terre dans l\'ombre', () => {
  const sun = { x: 1.496e8, y: 0, z: 0 };
  assert.equal(C.sunlit({ x: 7000, y: 0, z: 0 }, sun), true);
  assert.equal(C.sunlit({ x: -7000, y: 0, z: 0 }, sun), false);
  assert.equal(C.sunlit({ x: -7000, y: 6500, z: 0 }, sun), true, 'hors du cylindre d\'ombre');
});

test('Quaternions : identiques à la matrice Z-X\'-Y\'\' du W3C', () => {
  const rot = (a, b, g) => { a *= D; b *= D; g *= D; const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    return [ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg, sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg, -cb * sg, sb, cb * cg]; };
  for (let k = 0; k < 500; k++) {
    const a = Math.random() * 360, b = Math.random() * 360 - 180, g = Math.random() * 180 - 90;
    const A = rot(a, b, g), B = C.Q.mat(C.Q.euler(a, b, g));
    A.forEach((v, i) => near(B[i], v, 1e-9));
  }
});

test('Slerp : extrémités, milieu, et passage 359° → 1° sans tour complet', () => {
  const q1 = C.Q.euler(359, 90, 0), q2 = C.Q.euler(1, 90, 0);
  near(C.Q.angle(C.Q.slerp(q1, q2, 0), q1), 0, 1e-6);
  near(C.Q.angle(C.Q.slerp(q1, q2, 1), q2), 0, 1e-6);
  near(C.Q.angle(q1, q2), 2, 1e-6, 'écart réel de 2°');
  const mid = C.Q.slerp(q1, q2, 0.5);
  near(C.aimOf(C.Q.mat(mid)).az, 0, 1e-6, 'le milieu vise le nord, pas le sud');
});

test('Filtre 1 € : lisse fort à l\'arrêt, suit vite en mouvement', () => {
  const still = C.oneEuroAlpha(1 / 60, 0), fast = C.oneEuroAlpha(1 / 60, 200);
  assert.ok(still < 0.12, `arrêt : ${still}`);
  assert.ok(fast > 0.45, `mouvement : ${fast}`);
  const big = C.oneEuroAlpha(10, 0); assert.ok(big > 0.95 && big <= 1, 'gros pas de temps : rattrape presque tout, sans dépasser');
});

test('Visée : téléphone debout face au nord', () => {
  const R = C.Q.mat(C.Q.euler(0, 90, 0)), W = 400, H = 800, f = 500;
  const a = C.aimOf(R); near(a.az, 0, 1e-6); near(a.el, 0, 1e-6);
  const c = C.project(R, 0, 0, f, 0, W, H); assert.ok(c.ok); near(c.x, 200, 1e-6); near(c.y, 400, 1e-6);
  const up = C.project(R, 0, 20, f, 0, W, H); near(up.x, 200, 1e-6); assert.ok(up.y < 400, 'plus haut dans le ciel = plus haut à l\'écran');
  const east = C.project(R, 20, 0, f, 0, W, H); assert.ok(east.x > 200, 'l\'est est à droite');
  assert.equal(C.project(R, 180, 0, f, 0, W, H).ok, false, 'le sud est derrière');
});

test('Visée : vers le sud-ouest, 40° de hauteur, avec la convention alpha = 360 − cap', () => {
  const az = 225, el = 40, R = C.Q.mat(C.Q.euler(360 - az, 90 + el, 0));
  const a = C.aimOf(R); near(a.az, az, 1e-6); near(a.el, el, 1e-6);
  const p = C.project(R, az, el, 600, 0, 390, 844); near(p.x, 195, 1e-6); near(p.y, 422, 1e-6);
});

test('Visée en paysage : l\'écran tourne avec le téléphone', () => {
  const R = C.Q.mat(C.Q.euler(0, 90, 0));
  const p = C.project(R, 0, 20, 500, 90 * D, 800, 400);
  assert.ok(p.x < 400, 'en paysage (90°), le haut du ciel part vers la gauche de l\'écran'); near(p.y, 200, 1e-6);
});

test('Lecture TLE : noms, numéros NORAD, lignes invalides ignorées', () => {
  const txt = F.tle(F.ISS, F.GEO) + 'ligne parasite\n';
  const L = C.parseTLE(txt, sat.twoline2satrec);
  assert.equal(L.length, 2);
  assert.equal(L[0].name, 'ISS (ZARYA)'); assert.equal(L[0].id, '25544'); assert.equal(L[1].id, '40732');
  assert.equal(C.parseTLE('', sat.twoline2satrec).length, 0);
});

test('Paramètres d\'orbite : ISS, géostationnaire, héliosynchrone', () => {
  const [iss, geo, sso] = C.parseTLE(F.tle(F.ISS, F.GEO, F.SSO), sat.twoline2satrec).map(s => C.orbitParams(s.rec));
  near(iss.per, 92.9, 0.3, 'période ISS (min)'); near(iss.inc, 51.64, 0.01); assert.equal(iss.kind, 'Orbite basse');
  assert.ok(iss.apo > 380 && iss.apo < 440, `altitude ISS ${iss.apo}`);
  assert.equal(geo.kind, 'Orbite géostationnaire'); near(geo.apo, 35786, 60, 'altitude GEO');
  assert.equal(sso.kind, 'Orbite basse héliosynchrone'); near(sso.apo, 786, 15, 'altitude Sentinel-2');
});

test('SGP4 : l\'ISS reste à ~400 km et ~7,7 km/s', () => {
  const [iss] = C.parseTLE(F.tle(F.ISS), sat.twoline2satrec);
  for (let h = 0; h < 6; h++) {
    const pv = sat.propagate(iss.rec, new Date(Date.UTC(2026, 10, 20, 12 + h)));
    near(Math.hypot(pv.position.x, pv.position.y, pv.position.z) - C.RE, 410, 35, 'altitude');
    near(Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z), 7.66, 0.08, 'vitesse');
  }
});

test('Contexte : chaque famille trouve la bonne fiche', () => {
  const m = n => C.kbMatch(KB, n)?.nom;
  assert.equal(m('ISS (ZARYA)'), 'Station spatiale internationale');
  assert.equal(m('CSS (TIANHE)'), 'Station spatiale Tiangong');
  assert.equal(m('HST'), 'Télescope spatial Hubble');
  assert.equal(m('STARLINK-31415'), 'Starlink');
  assert.equal(m('GPS BIIF-12 (PRN 32)'), 'GPS');
  assert.equal(m('GSAT0219 (GALILEO 23)'), 'Galileo');
  assert.equal(m('NOAA 19'), 'Satellites météo NOAA');
  assert.equal(m('SL-16 R/B'), 'Étage de fusée');
  assert.equal(m('COSMOS 2251 DEB'), 'Débris spatial', 'un débris Cosmos est un débris');
  assert.equal(m('COSMOS 2588'), 'Cosmos');
  assert.equal(m('SATELLITE INCONNU'), undefined);
  for (const k of KB) for (const f of ['nom', 'type', 'resume', 'wiki']) assert.ok(k[f], `${k.nom} : champ ${f}`);
});

test('Décalage de cap : retrouve la rotation verticale entre gyroscope et boussole', () => {
  for (const [off, b, g] of [[37, 120, 10], [-150, 95, -30], [179, 60, 5]]) {
    const rel = C.Q.euler(80, b, g), abs = C.Q.euler(80 + off, b, g);
    near(C.Q.yawOffset(abs, rel), C.wrap180(off), 1e-6);
    const fused = C.Q.mul(C.Q.yaw(off), rel);
    near(C.Q.angle(fused, abs), 0, 1e-6, 'gyroscope recalé = boussole');
  }
});

test('Filtre du nord : ignore un sursaut bref, suit un vrai décalage, ignore la boussole au zénith', () => {
  const f = C.northFilter(); let t = 0;
  f.update(10, 20, t);
  near(f.off, 10, 1e-9, 'première mesure acceptée');
  for (let i = 0; i < 30; i++) f.update(190, 20, t += 16);          // sursaut de 180° pendant 0,5 s
  near(f.off, 10, 1e-9, 'sursaut bref ignoré');
  for (let i = 0; i < 60; i++) f.update(12, 20, t += 16);           // bruit normal : suit doucement
  assert.ok(f.off > 10 && f.off < 12);
  const before = f.off;
  for (let i = 0; i < 120; i++) f.update(60, 80, t += 16);          // visée au zénith : boussole ignorée
  near(f.off, before, 1e-9, 'pas de correction près du zénith');
  for (let i = 0; i < 700; i++) f.update(60, 20, t += 16);          // décalage réel et durable (~11 s)
  near(f.off, 60, 1, 'finit par suivre un décalage durable');
});
