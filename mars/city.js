// Nouvelle-Arès : une ville martienne imaginaire au fond de Melas Chasma, son astroport et deux bases militaires.
// Tout est construit par programme dans un repère plat local (km) : x vers l'est, y vers le haut, z vers le sud.
// Le shader courbe ensuite l'ensemble sur la sphère, pour que chaque bâtiment reste posé au sol et vertical.

export const SITE = { lat: -11.2, lon: -70.0, h: -4.75, flat0: 38, flat1: 54 };

const WHITE = [0.80, 0.80, 0.78], SAND = [0.52, 0.45, 0.39], TEAL = [0.12, 0.50, 0.52], COPPER = [0.66, 0.38, 0.20];
const METAL = [0.20, 0.22, 0.25], STEEL = [0.62, 0.64, 0.68], OLIVE = [0.21, 0.24, 0.17], GUN = [0.17, 0.19, 0.21];
const PAVE = [0.20, 0.19, 0.19], ARMY = [0.15, 0.16, 0.14], GREEN = [0.10, 0.27, 0.10], WATER = [0.05, 0.18, 0.30];
const SOLAR = [0.04, 0.08, 0.30], RED = [0.9, 0.12, 0.08], CYAN = [0.2, 0.9, 1.0], AMBER = [1.0, 0.72, 0.35];

function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; }

/** Accumule des triangles : position, normale, couleur, (fenêtres, lueur), coordonnées de motif. */
class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.a = []; this.u = []; }
  tri(A, B, C, col, par = [0, 0], nA, nB, nC, uA = [0, 0], uB = [0, 0], uC = [0, 0]) {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const l = Math.hypot(gx, gy, gz);
    if (l < 1e-12) return;
    gx /= l; gy /= l; gz /= l;
    if (!nA) nA = nB = nC = [gx, gy, gz];
    else if (gx * (nA[0] + nB[0] + nC[0]) + gy * (nA[1] + nB[1] + nC[1]) + gz * (nA[2] + nB[2] + nC[2]) < 0) { [B, C] = [C, B]; [nB, nC] = [nC, nB]; [uB, uC] = [uC, uB]; }
    this.p.push(...A, ...B, ...C); this.n.push(...nA, ...nB, ...nC);
    this.c.push(...col, ...col, ...col); this.a.push(...par, ...par, ...par); this.u.push(...uA, ...uB, ...uC);
  }
  quad(A, B, C, D, col, par, nA, nB, nC, nD, uA, uB, uC, uD) {
    this.tri(A, B, C, col, par, nA, nB, nC, uA, uB, uC); this.tri(A, C, D, col, par, nA, nC, nD, uA, uC, uD);
  }
  /** Boîte posée en (cx, y0, cz), tournée de rot autour de la verticale ; taper rétrécit le sommet. */
  box(cx, y0, cz, w, h, d, rot = 0, col = WHITE, win = 0, taper = 1, glow = 0) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (x, y, z) => [cx + x * c + z * s, y0 + y, cz - x * s + z * c];
    const a = w / 2, b = d / 2, ta = a * taper, tb = b * taper, par = [win, glow];
    const k = [P(-a, 0, -b), P(a, 0, -b), P(a, 0, b), P(-a, 0, b), P(-ta, h, -tb), P(ta, h, -tb), P(ta, h, tb), P(-ta, h, tb)];
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0]]) this.quad(k[j], k[i], k[i + 4], k[j + 4], col, par);
    this.quad(k[4], k[5], k[6], k[7], col, [0, glow]);
  }
  /** Tronc de cône vertical (r1 = 0 : cône), avec couvercle. */
  cyl(cx, y0, cz, r0, r1, h, n = 16, col = WHITE, win = 0, glow = 0, cap = true) {
    const par = [win, glow], sl = (r0 - r1) / h, nl = Math.hypot(1, sl);
    for (let i = 0; i < n; i++) {
      const a0 = i / n * 2 * Math.PI, a1 = (i + 1) / n * 2 * Math.PI, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = [c0 / nl, sl / nl, s0 / nl], n1 = [c1 / nl, sl / nl, s1 / nl];
      this.quad([cx + r0 * c0, y0, cz + r0 * s0], [cx + r0 * c1, y0, cz + r0 * s1], [cx + r1 * c1, y0 + h, cz + r1 * s1], [cx + r1 * c0, y0 + h, cz + r1 * s0], col, par, n0, n1, n1, n0);
      if (cap && r1 > 0) this.tri([cx, y0 + h, cz], [cx + r1 * c0, y0 + h, cz + r1 * s0], [cx + r1 * c1, y0 + h, cz + r1 * s1], col, [0, glow], [0, 1, 0], [0, 1, 0], [0, 1, 0]);
    }
  }
  /** Calotte : demi-ellipsoïde de rayon r et de hauteur r * hs ; inv la retourne en coupe (parabole de radar). */
  dome(cx, y0, cz, r, hs = 1, n = 20, m = 8, col = WHITE, win = 0, glow = 0, inv = false) {
    const par = [win, glow];
    const P = (i, j) => {
      const a = i / n * 2 * Math.PI, e = j / m * Math.PI / 2, ce = Math.cos(e), se = Math.sin(e), x = Math.cos(a) * ce, z = Math.sin(a) * ce;
      const ny = se / hs, l = Math.hypot(x, ny, z), y = inv ? (1 - se) * r * hs : se * r * hs;
      return [[cx + x * r, y0 + y, cz + z * r], [x / l, (inv ? -ny : ny) / l, z / l].map(v => inv ? -v : v), [i, j]];
    };
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const A = P(i, j), B = P(i + 1, j), C = P(i + 1, j + 1), D = P(i, j + 1);
      this.quad(A[0], B[0], C[0], D[0], col, par, A[1], B[1], C[1], D[1], A[2], B[2], C[2], D[2]);
    }
  }
  /** Cylindre entre deux points quelconques (tubes, mâts, canons). */
  tube(A, B, r, n = 8, col = METAL, glow = 0, r1 = r) {
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
    const t = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul);
    const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const ring = i => { const a = i / n * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a); return [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s]; };
    for (let i = 0; i < n; i++) {
      const n0 = ring(i), n1 = ring(i + 1), at = (P, nn, rr) => [P[0] + nn[0] * rr, P[1] + nn[1] * rr, P[2] + nn[2] * rr];
      this.quad(at(A, n0, r), at(A, n1, r), at(B, n1, r1), at(B, n0, r1), col, [0, glow], n0, n1, n1, n0);
      this.tri(B, at(B, n0, r1), at(B, n1, r1), col, [0, glow]);
    }
  }
  /** Hangar en demi-cylindre couché, d'axe tourné de rot. */
  hangar(cx, y0, cz, len, r, rot = 0, col = METAL, glow = 0) {
    const c = Math.cos(rot), s = Math.sin(rot), n = 10, P = (x, y, z) => [cx + x * c + z * s, y0 + y, cz - x * s + z * c], N = (y, z) => [z * s, y, z * c];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI, a1 = (i + 1) / n * Math.PI, y0_ = Math.sin(a0), z0 = Math.cos(a0), y1 = Math.sin(a1), z1 = Math.cos(a1);
      this.quad(P(-len / 2, y0_ * r, z0 * r), P(len / 2, y0_ * r, z0 * r), P(len / 2, y1 * r, z1 * r), P(-len / 2, y1 * r, z1 * r), col, [0, glow], N(y0_, z0), N(y0_, z0), N(y1, z1), N(y1, z1));
      for (const e of [-len / 2, len / 2]) this.tri(P(e, 0, 0), P(e, y0_ * r, z0 * r), P(e, y1 * r, z1 * r), col, [0.5, glow]);
    }
  }
  /** Aile delta : chasseur ou navette, nez vers +x local. */
  craft(cx, y0, cz, s, rot = 0, col = GUN, glow = 0) {
    const c = Math.cos(rot), sn = Math.sin(rot), P = (x, y, z) => [cx + (x * c + z * sn) * s, y0 + y * s, cz + (-x * sn + z * c) * s];
    const nose = P(1, 0.1, 0), l = P(-0.7, 0.06, -0.75), r = P(-0.7, 0.06, 0.75), top = P(-0.5, 0.32, 0), tail = P(-0.8, 0.1, 0), bot = P(-0.3, -0.06, 0);
    for (const [a, b, d] of [[nose, l, top], [nose, top, r], [l, tail, top], [tail, r, top], [nose, bot, l], [nose, r, bot], [l, bot, tail], [bot, r, tail]]) this.tri(a, b, d, col, [0, glow]);
    this.tri(P(-0.75, 0.1, 0), P(-0.35, 0.3, 0), P(-0.85, 0.62, 0), col, [0, glow]);
  }
  build(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aPar', new THREE.Float32BufferAttribute(this.a, 2));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.u, 2));
    return g;
  }
}

/** Dalle circulaire au sol ; style : 0 ville (anneaux et avenues), 1 base (quadrillage), 2 astroport. */
function slab(g, cx, cz, r, col, style, y = 0.03) {
  const n = 72, m = Math.max(4, Math.ceil(r / 1.2)), par = [-1, style], up = [0, 1, 0];
  const P = (i, j) => { const a = i / n * 2 * Math.PI, q = j / m * r, x = Math.cos(a) * q, z = Math.sin(a) * q; return [[cx + x, y, cz + z], [x, z]]; };
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const A = P(i, j), B = P(i + 1, j), C = P(i + 1, j + 1), D = P(i, j + 1);
    g.quad(A[0], B[0], C[0], D[0], col, par, up, up, up, up, A[1], B[1], C[1], D[1]);
  }
}
/** Route droite entre deux points, découpée pour suivre la courbure. */
function road(g, x0, z0, x1, z1, w, col = PAVE) {
  const l = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(l / 1.5), rot = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i < n; i++) g.box(x0 + (x1 - x0) * (i + 0.5) / n, 0.02, z0 + (z1 - z0) * (i + 0.5) / n, l / n + 0.01, 0.015, w, rot, col);
}

function layout() {
  const g = new Geo(), glass = new Geo(), dish = new Geo(), flyer = new Geo(), lights = [], movers = [], rnd = rng(2084);
  // lumière : [x, y, z, r, g, b, taille en km, clignotement (0 : fixe), genre (0 : la nuit, 1 : toujours, 2 : halo lointain)]
  const lamp = (x, y, z, col, size, blink = 0, kind = 0) => lights.push(x, y, z, ...col, size, blink, kind);
  const pick = (...a) => a[Math.floor(rnd() * a.length)];

  /* ── Centre : le Grand Dôme, son parc et la flèche ── */
  slab(g, 0, 0, 17.5, PAVE, 0);
  g.cyl(0, 0, 0, 3.2, 3.2, 0.05, 48, GREEN);
  g.cyl(0.9, 0, -1.1, 0.75, 0.75, 0.06, 24, WATER, 0, 0.15);
  g.cyl(0, 0, 0, 3.42, 3.36, 0.16, 48, WHITE, 0.4, 0, false);
  glass.dome(0, 0.12, 0, 3.36, 0.56, 48, 12, [0.55, 0.8, 0.95]);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.283, r = 1.1 + rnd() * 1.75;
    if (Math.hypot(Math.cos(a) * r - 0.9, Math.sin(a) * r + 1.1) < 1) continue;
    g.box(Math.cos(a) * r, 0.04, Math.sin(a) * r, 0.14 + rnd() * 0.12, 0.15 + rnd() * 0.5 * (1 - r / 3.4), 0.14 + rnd() * 0.12, -a, pick(WHITE, WHITE, TEAL), 0.7);
  }
  g.cyl(0, 0, 0, 0.42, 0.16, 5.2, 20, WHITE, 0.75);
  g.cyl(0, 5.2, 0, 0.16, 0.03, 3.2, 10, STEEL, 0, 0.1);
  for (const [y, r] of [[2.2, 0.62], [3.9, 0.48], [5.1, 0.36]]) { g.cyl(0, y, 0, r, r, 0.07, 24, TEAL, 0, 1.2); g.cyl(0, y - 0.1, 0, r * 0.5, r, 0.1, 24, WHITE); }
  lamp(0, 8.45, 0, RED, 0.22, 1.1, 1); lamp(0, 5.25, 0, CYAN, 0.3, 0, 0);

  /* ── Couronne des dômes de quartier, reliés par des tubes ── */
  const nodes = [];
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * Math.PI / 4, x = Math.cos(a) * 6, z = Math.sin(a) * 6;
    nodes.push([x, z]);
    g.tube([Math.cos(a) * 3.4, 0.14, Math.sin(a) * 3.4], [Math.cos(a) * 4.9, 0.14, Math.sin(a) * 4.9], 0.11, 8, WHITE, 0.25);
    if (k % 2 === 0) {
      g.cyl(x, 0, z, 1.3, 1.3, 0.05, 28, GREEN); g.cyl(x, 0, z, 1.36, 1.32, 0.12, 28, WHITE, 0.4, 0, false);
      glass.dome(x, 0.1, z, 1.32, 0.6, 28, 8, [0.6, 0.9, 0.85]);
      for (let i = 0; i < 6; i++) { const b = rnd() * 6.283, q = 0.2 + rnd() * 0.7; g.box(x + Math.cos(b) * q, 0.04, z + Math.sin(b) * q, 0.13, 0.12 + rnd() * 0.3, 0.13, b, WHITE, 0.7); }
    } else {
      g.dome(x, 0, z, 1.1, 0.62, 24, 8, WHITE, 0, 0); g.cyl(x, 0, z, 1.14, 1.14, 0.07, 24, TEAL, 0, 0.9, false);
      for (let i = 0; i < 3; i++) { const b = a + 2.1 * (i - 1) + Math.PI; g.dome(x + Math.cos(b) * 1.5, 0, z + Math.sin(b) * 1.5, 0.42, 0.7, 14, 6, pick(WHITE, COPPER)); }
      lamp(x, 0.75, z, CYAN, 0.12, 0, 0);
    }
  }
  nodes.forEach(([x, z], k) => { const [x1, z1] = nodes[(k + 1) % 8]; g.tube([x, 0.14, z], [x1, 0.14, z1], 0.09, 8, WHITE, 0.2); });

  /* ── Quartier des tours ── */
  for (let k = 0; k < 4; k++) {       // quatre tours-phares
    const a = k * Math.PI / 2, x = Math.cos(a) * 7.7, z = Math.sin(a) * 7.7;
    g.box(x, 0, z, 0.95, 1.5, 0.95, -a, WHITE, 0.85, 0.82); g.box(x, 1.5, z, 0.78, 1.3, 0.78, -a, WHITE, 0.85, 0.8);
    g.box(x, 2.8, z, 0.62, 1.0, 0.62, -a, TEAL, 0.9, 0.6); g.cyl(x, 3.8, z, 0.05, 0.01, 0.9, 6, STEEL);
    g.box(x, 1.47, z, 1.0, 0.05, 1.0, -a, TEAL, 0, 1, 1.3); g.box(x, 2.77, z, 0.84, 0.05, 0.84, -a, TEAL, 0, 1, 1.3);
    lamp(x, 4.72, z, RED, 0.16, 0.7 + k * 0.13, 1);
  }
  for (const r of [8.2, 9.3, 10.4, 11.5, 12.6, 13.6]) {
    const n = Math.round(2 * Math.PI * r / 1.05);
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5 + (rnd() - 0.5) * 0.3) / n * 2 * Math.PI, av = Math.abs(((a / (Math.PI / 8) + 0.5) % 1 + 1) % 1 - 0.5) * (Math.PI / 8) * r;
      if (av < 0.42 || rnd() < 0.16) continue;
      if (r < 8.5 && Math.abs(((a / (Math.PI / 2) + 0.5) % 1 + 1) % 1 - 0.5) * (Math.PI / 2) * r < 0.9) continue;
      const x = Math.cos(a) * (r + (rnd() - 0.5) * 0.3), z = Math.sin(a) * (r + (rnd() - 0.5) * 0.3);
      const h = (0.35 + 2.6 * rnd() ** 2.2) * (1.3 - (r - 8) / 7.5), w = 0.3 + rnd() * 0.32, col = pick(WHITE, WHITE, WHITE, SAND, TEAL, COPPER, STEEL), win = 0.55 + rnd() * 0.4, t = rnd();
      if (t < 0.4) { g.box(x, 0, z, w, h, w * (0.7 + rnd() * 0.5), -a, col, win); g.box(x, h, z, w * 0.4, 0.06, w * 0.4, -a, METAL); }
      else if (t < 0.65) { g.box(x, 0, z, w * 1.15, h * 0.6, w * 1.15, -a, col, win); g.box(x, h * 0.6, z, w * 0.8, h * 0.4, w * 0.8, -a, col, win, 0.7); }
      else if (t < 0.85) { g.cyl(x, 0, z, w * 0.6, w * 0.5, h, 12, col, win); g.cyl(x, h, z, w * 0.5, 0.02, w * 0.5, 12, col); }
      else { g.box(x - 0.12 * Math.sin(a), 0, z + 0.12 * Math.cos(a), w * 0.55, h, w * 0.55, -a, col, win); g.box(x + 0.16 * Math.sin(a), 0, z - 0.16 * Math.cos(a), w * 0.55, h * 0.8, w * 0.55, -a, col, win); g.box(x, h * 0.55, z, w * 0.3, 0.05, 0.4, -a, TEAL, 0, 1, 1); }
      if (h > 1.7) lamp(x, h + 0.1, z, RED, 0.09, 0.5 + rnd(), 1);
    }
  }

  /* ── Ceinture industrielle, serres et ferme solaire ── */
  for (let i = 0; i < 70; i++) {
    const a = rnd() * 6.283, r = 14.6 + rnd() * 2.1, x = Math.cos(a) * r, z = Math.sin(a) * r, deg = ((a * 180 / Math.PI) % 360 + 360) % 360;
    if ((deg > 95 && deg < 175) || (deg > 205 && deg < 255) || Math.abs(((a / (Math.PI / 8) + 0.5) % 1 + 1) % 1 - 0.5) * (Math.PI / 8) * r < 0.4) continue;
    const t = rnd();
    if (t < 0.35) { g.cyl(x, 0, z, 0.22, 0.22, 0.3, 14, STEEL); g.dome(x, 0.3, z, 0.22, 0.5, 14, 4, STEEL); }
    else if (t < 0.55) g.dome(x, 0, z, 0.3, 1, 14, 6, pick(WHITE, COPPER));
    else if (t < 0.85) { g.box(x, 0, z, 0.7, 0.22, 0.45, -a, SAND, 0.3); g.cyl(x + 0.2, 0.22, z, 0.05, 0.035, 0.55, 8, METAL); }
    else { g.cyl(x, 0, z, 0.2, 0.12, 0.7, 12, SAND); lamp(x, 0.74, z, RED, 0.06, 0.9 + rnd(), 1); }
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) {       // serres, au sud-ouest
    const a = (100 + i * 8.2) * Math.PI / 180, r = 14.7 + j * 0.9;
    g.hangar(Math.cos(a) * r, 0.02, Math.sin(a) * r, 1.7, 0.2, -a + Math.PI / 2, [0.25, 0.6, 0.3], 0.55);
  }
  for (let i = 0; i < 12; i++) for (let j = 0; j < 5; j++) {      // panneaux solaires, au nord-ouest
    const a = (208 + i * 4) * Math.PI / 180, r = 14.5 + j * 0.62, x = Math.cos(a) * r, z = Math.sin(a) * r;
    g.box(x, 0.06, z, 0.5, 0.012, 0.85, -a, SOLAR, 0, 1, 0.05); g.cyl(x, 0, z, 0.02, 0.02, 0.06, 5, METAL);
  }
  for (let k = 0; k < 16; k++) {      // enceinte et portes
    const a = k * Math.PI / 8, x = Math.cos(a) * 17.4, z = Math.sin(a) * 17.4;
    g.cyl(x, 0, z, 0.16, 0.12, 0.45, 10, WHITE, 0.4); lamp(x, 0.5, z, AMBER, 0.1, 0, 0);
  }
  for (let k = 0; k < 16; k++) for (let r = 3.8; r < 17.3; r += 0.45) lamp(Math.cos(k * Math.PI / 8) * r, 0.07, Math.sin(k * Math.PI / 8) * r, AMBER, 0.045);
  for (const r of [5, 7.5, 10, 12.5, 15]) for (let i = 0, n = Math.round(2 * Math.PI * r / 0.55); i < n; i++) lamp(Math.cos(i / n * 6.2832) * r, 0.07, Math.sin(i / n * 6.2832) * r, [1, 0.85, 0.6], 0.04);
  lamp(0, 0.5, 0, AMBER, 26, 0, 2);

  /* ── Astroport, à l'est ── */
  const SX = 24.5, SZ = 1.5;
  slab(g, SX, SZ, 5.2, [0.24, 0.23, 0.23], 2);
  road(g, 17.2, 0.4, SX - 5, SZ, 0.5);
  for (let i = 0; i <= 12; i++) { const x = 17.3 + i * 0.4, z = -0.5 + i * 0.12; g.cyl(x, 0, z, 0.03, 0.03, 0.3, 6, STEEL); }
  g.tube([17.2, 0.32, -0.53], [22.2, 0.32, 0.97], 0.07, 8, WHITE, 0.5);
  g.box(SX - 2.3, 0, SZ, 0.55, 0.3, 2.6, 0, WHITE, 0.85); g.hangar(SX - 2.3, 0.3, SZ, 2.6, 0.27, Math.PI / 2, WHITE, 0.2);
  g.cyl(SX - 1.5, 0, SZ - 1.9, 0.09, 0.07, 1.2, 10, WHITE, 0.4); g.cyl(SX - 1.5, 1.2, SZ - 1.9, 0.13, 0.22, 0.12, 12, TEAL, 1, 0.6); g.cyl(SX - 1.5, 1.32, SZ - 1.9, 0.22, 0.05, 0.07, 12, WHITE);
  lamp(SX - 1.5, 1.45, SZ - 1.9, RED, 0.1, 0.8, 1);
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3 + 0.3, x = SX + 0.9 + Math.cos(a) * 2.5, z = SZ + Math.sin(a) * 2.9;
    g.cyl(x, 0.03, z, 0.62, 0.62, 0.03, 28, [0.1, 0.1, 0.11]); g.cyl(x, 0.035, z, 0.5, 0.5, 0.03, 28, [0.3, 0.28, 0.26]);
    for (let i = 0; i < 14; i++) lamp(x + Math.cos(i * 0.449) * 0.62, 0.08, z + Math.sin(i * 0.449) * 0.62, k % 2 ? CYAN : [0.3, 1, 0.5], 0.035, 0, 0);
    if (k === 4) continue;
    const h = 0.75 + (k % 3) * 0.14;
    g.cyl(x, 0.12, z, 0.085, 0.085, h, 14, STEEL, 0, 0.02); g.cyl(x, 0.12 + h, z, 0.085, 0.0, 0.24, 14, STEEL);
    for (let f = 0; f < 3; f++) { const b = f * 2.094; g.box(x + Math.cos(b) * 0.1, 0.06, z + Math.sin(b) * 0.1, 0.16, 0.26, 0.012, -b, METAL, 0, 0.3); }
    g.box(x + 0.26, 0, z + 0.2, 0.07, h + 0.15, 0.07, 0.4, COPPER); g.tube([x + 0.26, h * 0.8, z + 0.2], [x + 0.06, h * 0.8, z + 0.05], 0.015, 5, COPPER);
    lamp(x + 0.26, h + 0.2, z + 0.2, RED, 0.06, 1, 1);
  }
  for (let i = 0; i < 4; i++) g.hangar(SX - 0.4 + i * 0.85, 0.02, SZ + 4.1, 0.9, 0.3, Math.PI / 2, STEEL, 0.15);

  /* ── Bastion Nord : base aérienne fortifiée ── */
  const NX = -12, NZ = -27.5;
  slab(g, NX, NZ, 5.8, ARMY, 1);
  road(g, -6.6, -16.1, NX + 2.2, NZ + 5.1, 0.4);
  fortress(g, lamp, NX, NZ, 5.4, 6);
  for (const [w, y] of [[1.9, 0], [1.35, 0.3], [0.8, 0.6]]) g.box(NX, y, NZ, w, 0.3, w, 0.3, OLIVE, y ? 0.25 : 0.12, 0.82);
  g.box(NX, 0.9, NZ, 0.5, 0.04, 0.5, 0.3, RED, 0, 1, 0.9); g.tube([NX, 0.9, NZ], [NX, 1.9, NZ], 0.02, 5, STEEL); lamp(NX, 1.95, NZ, RED, 0.12, 0.6, 1);
  for (const [dx, dz] of [[-2.6, -1.4], [2.7, 1.9]]) { g.cyl(NX + dx, 0, NZ + dz, 0.2, 0.12, 0.55, 10, GUN); movers.push({ kind: 'radar', x: NX + dx, y: 0.62, z: NZ + dz, speed: 0.9, tilt: 0.5 }); }
  for (let i = 0; i < 4; i++) battery(g, NX - 3.1 + i * 0.75, NZ + 2.6, 0.9);
  for (let i = 0; i < 5; i++) {
    g.hangar(NX - 1.6 + i * 0.85, 0.02, NZ - 2.9, 1.0, 0.32, Math.PI / 2, OLIVE);
    g.craft(NX - 1.6 + i * 0.85, 0.06, NZ - 2.0, 0.17, Math.PI / 2, GUN); g.craft(NX - 1.35 + i * 0.85, 0.06, NZ - 1.55, 0.17, Math.PI / 2, GUN);
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.box(NX + 1.6 + i * 0.5, 0, NZ - 0.6 + j * 0.42, 0.38, 0.1, 0.22, 0, OLIVE, 0.4, 0.9);
  g.cyl(NX - 0.3, 0, NZ + 3.4, 0.75, 0.75, 0.1, 20, GUN); glass.dome(NX - 0.3, 0.08, NZ + 3.4, 0.72, 0.8, 20, 7, [1.0, 0.35, 0.25]);
  g.cyl(NX - 0.3, 0.1, NZ + 3.4, 0.12, 0.05, 0.45, 8, RED, 0, 1.4);
  road(g, NX - 7.5, NZ - 6.6, NX + 7.5, NZ - 6.6, 0.55, [0.12, 0.12, 0.13]);      // piste
  for (let i = 0; i <= 30; i++) for (const s of [-0.32, 0.32]) lamp(NX - 7.5 + i * 0.5, 0.05, NZ - 6.6 + s, [1, 1, 1], 0.04, 0, 0);
  for (let i = -2; i <= 2; i++) { lamp(NX - 7.7, 0.05, NZ - 6.6 + i * 0.12, [0.2, 1, 0.3], 0.05, 0, 0); lamp(NX + 7.7, 0.05, NZ - 6.6 + i * 0.12, RED, 0.05, 0, 0); }
  road(g, NX - 0.5, NZ - 4.9, NX - 0.5, NZ - 6.4, 0.3, [0.12, 0.12, 0.13]);

  /* ── Bastion Sud : défense orbitale ── */
  const MX = 14, MZ = 27;
  slab(g, MX, MZ, 5.4, ARMY, 1);
  road(g, 7.6, 15.6, MX - 2.4, MZ - 4.6, 0.4);
  fortress(g, lamp, MX, MZ, 5.0, 8);
  g.cyl(MX, 0, MZ, 1.15, 1.0, 0.45, 24, GUN, 0.15); g.dome(MX, 0.45, MZ, 0.85, 0.7, 20, 6, OLIVE);
  const el = 0.9, az = -2.2, bd = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], at = t => [MX + bd[0] * t, 0.8 + bd[1] * t, MZ + bd[2] * t];
  g.tube(at(0.2), at(3.9), 0.17, 12, GUN, 0, 0.11);
  for (const t of [1.0, 1.7, 2.4, 3.1]) g.tube(at(t), at(t + 0.12), 0.24, 12, METAL, 0);
  g.tube(at(3.9), at(4.0), 0.15, 12, CYAN, 2.2); lamp(...at(4.05), CYAN, 0.3, 2.3, 1);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + 0.5, x = MX + Math.cos(a) * 3.2, z = MZ + Math.sin(a) * 3.2;
    g.cyl(x, 0, z, 0.34, 0.34, 0.06, 16, GUN); g.cyl(x, 0.06, z, 0.26, 0.26, 0.01, 16, [0.05, 0.05, 0.05]);
    for (let k = 0; k < 8; k++) lamp(x + Math.cos(k * 0.785) * 0.34, 0.1, z + Math.sin(k * 0.785) * 0.34, RED, 0.03, 0, 0);
    if (i % 3 === 0) { g.cyl(x, 0.06, z, 0.09, 0.09, 0.5, 10, WHITE); g.cyl(x, 0.56, z, 0.09, 0, 0.2, 10, RED); }
  }
  for (const [dx, dz] of [[-1.8, 1.2], [1.9, -1.3], [0.3, 2.1], [-0.4, -2.0]]) {
    g.cyl(MX + dx, 0.02, MZ + dz, 0.42, 0.42, 0.02, 16, [0.1, 0.1, 0.1]);
    g.box(MX + dx, 0.08, MZ + dz, 0.5, 0.12, 0.2, dx, OLIVE, 0.2); g.box(MX + dx, 0.1, MZ + dz, 0.16, 0.06, 0.52, dx, GUN); g.box(MX + dx, 0.04, MZ + dz, 0.05, 0.05, 0.3, dx, METAL);
  }
  g.cyl(MX + 3.6, 0, MZ - 2.6, 0.2, 0.12, 0.55, 10, GUN); movers.push({ kind: 'radar', x: MX + 3.6, y: 0.62, z: MZ - 2.6, speed: -0.7, tilt: 0.6 });
  for (let i = 0; i < 6; i++) g.box(MX - 3.4 + (i % 3) * 0.7, 0, MZ - 2.9 + Math.floor(i / 3) * 0.6, 0.55, 0.13, 0.4, 0, OLIVE, 0.1, 0.7);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {       // blindés en rang
    const x = MX - 3.6 + i * 0.22, z = MZ + 2.4 + j * 0.2;
    g.box(x, 0.03, z, 0.13, 0.035, 0.08, 0, OLIVE); g.box(x, 0.065, z, 0.06, 0.025, 0.05, 0, GUN); g.tube([x, 0.08, z], [x + 0.12, 0.09, z], 0.006, 4, GUN);
  }

  /* ── Pièces mobiles : antenne de radar, navette ── */
  dish.dome(0, 0, 0, 0.5, 0.35, 16, 4, STEEL, 0, 0, true); dish.tube([0, 0.03, 0], [0, 0.42, 0], 0.012, 5, METAL); dish.cyl(0, -0.1, 0, 0.06, 0.06, 0.12, 8, GUN);
  flyer.craft(0, 0, 0, 1, 0, WHITE, 0.25);
  for (let i = 0; i < 9; i++) movers.push({ kind: 'flyer', cx: (rnd() - 0.5) * 10, cz: (rnd() - 0.5) * 10, r: 6 + rnd() * 16, y: 1.2 + rnd() * 3.5, speed: (0.035 + rnd() * 0.04) * (i % 2 ? 1 : -1), ph: rnd() * 6.28, s: 0.16 });
  movers.push({ kind: 'flyer', cx: NX, cz: NZ, r: 8.5, y: 1.3, speed: 0.11, ph: 0, s: 0.13, col: 1 }, { kind: 'flyer', cx: NX, cz: NZ, r: 8.5, y: 1.3, speed: 0.11, ph: 0.09, s: 0.13, col: 1 },
    { kind: 'flyer', cx: MX, cz: MZ, r: 7.5, y: 1.6, speed: -0.1, ph: 2, s: 0.13, col: 1 });

  return {
    g, glass, dish, flyer, lights, movers,
    places: [['Nouvelle-Arès', 0, 0, 1e6], ['Astroport', SX, SZ, 500], ['Bastion Nord · base aérienne', NX, NZ, 500], ['Bastion Sud · défense orbitale', MX, MZ, 500]],
  };
}

/** Enceinte polygonale : murs, tours d'angle à tourelle, feux rouges. */
function fortress(g, lamp, cx, cz, r, sides) {
  for (let k = 0; k < sides; k++) {
    const a0 = k / sides * 2 * Math.PI, a1 = (k + 1) / sides * 2 * Math.PI, x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
    const l = Math.hypot(x1 - x0, z1 - z0), rot = Math.atan2(-(z1 - z0), x1 - x0), gate = k === 1;
    for (let i = 0; i < 3; i++) {
      if (gate && i === 1) continue;
      const t = (i + 0.5) / 3; g.box(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, l / 3, 0.28, 0.16, rot, GUN, 0, 0.8);
    }
    for (let i = 0; i <= 8; i++) lamp(x0 + (x1 - x0) * i / 8, 0.32, z0 + (z1 - z0) * i / 8, RED, 0.035, 0, 0);
    g.cyl(x0, 0, z0, 0.38, 0.3, 0.55, 8, OLIVE, 0.1); g.dome(x0, 0.55, z0, 0.22, 0.8, 10, 4, GUN);
    g.tube([x0, 0.66, z0], [x0 + Math.cos(a0) * 0.6, 0.85, z0 + Math.sin(a0) * 0.6], 0.03, 6, METAL);
    lamp(x0, 0.8, z0, RED, 0.08, 0.9 + k * 0.07, 1);
  }
}
/** Batterie de missiles : socle et quatre tubes inclinés. */
function battery(g, x, z, el) {
  g.box(x, 0, z, 0.36, 0.08, 0.3, 0, OLIVE); g.box(x, 0.08, z, 0.2, 0.07, 0.2, 0, GUN);
  for (let i = 0; i < 4; i++) {
    const ox = (i % 2 - 0.5) * 0.11, oy = Math.floor(i / 2) * 0.09, A = [x + ox, 0.16 + oy, z + 0.14], B = [x + ox, 0.16 + oy + Math.sin(el) * 0.5, z + 0.14 - Math.cos(el) * 0.5];
    g.tube(A, B, 0.04, 6, GUN); g.tube(B, [B[0], B[1] + Math.sin(el) * 0.03, B[2] - Math.cos(el) * 0.03], 0.03, 6, RED, 0.4);
  }
}

/* ───────────── Shaders ───────────── */

const BEND = /* glsl */`
uniform float uRc;
vec3 bend(vec3 p) {           // du plan local à la sphère de rayon uRc, au centimètre près
  float d2 = dot(p.xz, p.xz), k = 1.0 + p.y / uRc - d2 / (2.0 * uRc * uRc);
  return vec3(p.x * k, p.y - d2 / (2.0 * uRc), p.z * k);
}`;

const solidVert = /* glsl */`
${BEND}
uniform mat4 uLocal;
attribute vec2 aPar, aUv;
attribute vec3 color;
varying vec3 vN, vNl, vCol, vLoc, vPos;
varying vec2 vPar, vUv;
void main() {
  vec4 lp = uLocal * vec4(position, 1.0);
  vec3 b = bend(lp.xyz);
  vLoc = lp.xyz; vNl = mat3(uLocal) * normal; vN = mat3(modelMatrix) * vNl;
  vCol = color; vPar = aPar; vUv = aUv;
  vPos = (modelMatrix * vec4(b, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
}`;

const solidFrag = atmo => /* glsl */`
precision highp float;
precision highp int;
${atmo}
uniform float uNight, uPix, uTint;
varying vec3 vN, vNl, vCol, vLoc, vPos;
varying vec2 vPar, vUv;
float hash2(vec2 p) {
  ivec2 q = ivec2(floor(p));
  uint n = uint(q.x) * 1597334673u ^ uint(q.y) * 3812015801u;
  n = (n ^ (n >> 15u)) * 2246822519u; n ^= n >> 13u;
  return float(n >> 8u) / 16777216.0;
}
float line(float d, float w, float px) { return 1.0 - smoothstep(w, w + px * 1.5 + 0.002, d); }
// Trait lumineux : même forme, mais il pâlit quand il devient plus fin qu'un pixel, au lieu de baver.
float beam(float d, float w, float px) { return line(d, w, px) * min(1.0, w / (px * 0.75 + 0.001)); }
void main() {
  vec3 n = normalize(vN), nl = normalize(vNl);
  if (!gl_FrontFacing) { n = -n; nl = -nl; }
  vec3 up = normalize(vPos), toCam = uCam - vPos;
  float dist = length(toCam), px = dist * uPix;
  vec3 albedo = vCol, emit = vec3(0.0);
  float lights = 0.1 + 0.9 * uNight;

  if (vPar.x < 0.0) {                       // dalle : routes, marquages, éclairage
    float r = length(vUv), road, glow;
    if (vPar.y < 0.5) {
      float dr = abs(fract(r / 2.5 + 0.5) - 0.5) * 2.5, da = abs(fract(atan(vUv.y, vUv.x) / 6.2831853 * 16.0 + 0.5) - 0.5) * 0.3927 * r;
      float d = r < 3.6 ? 9.0 : min(dr, da);
      road = line(d, 0.11, px); glow = beam(d, 0.012, px);
      albedo *= 0.9 + 0.2 * hash2(vUv / 0.22);
      albedo = mix(albedo, vec3(0.34, 0.32, 0.31), road);
      emit += vec3(1.0, 0.72, 0.4) * (glow * 2.0 + road * 0.05) * lights;
    } else {
      vec2 gq = abs(fract(vUv / 0.9 + 0.5) - 0.5) * 0.9;
      float d = min(gq.x, gq.y);
      road = line(d, 0.05, px);
      albedo *= 0.88 + 0.24 * hash2(vUv / 0.3);
      albedo = mix(albedo, albedo * 1.7, road * 0.6);
      float edge = beam(abs(r - (vPar.y > 1.5 ? 5.05 : 5.6)), 0.03, px);
      emit += (vPar.y > 1.5 ? vec3(0.3, 0.9, 1.0) : vec3(1.0, 0.15, 0.1)) * edge * 0.6 * lights;
    }
  } else if (vPar.x > 0.0 && abs(nl.y) < 0.5) {   // façades : bandeaux vitrés, éclairés la nuit
    vec2 t = normalize(vec2(-nl.z, nl.x));
    vec2 uv = vec2(dot(vLoc.xz, t) / 0.05, vLoc.y / 0.06);
    vec2 f = fract(uv), cell = floor(uv);
    float pane = step(0.07, f.x) * step(f.x, 0.93) * step(0.2, f.y) * step(f.y, 0.86);
    float h = hash2(cell + floor(vLoc.xz * 3.0).yx * 7.0), lit = step(h, vPar.x * (0.08 + 0.6 * uNight));
    float block = hash2(floor(uv / vec2(5.0, 7.0)) + 31.0);                 // des étages entiers allumés ou éteints
    float sharp = 1.0 - smoothstep(0.012, 0.05, px);
    vec3 tone = mix(vec3(1.0, 0.78, 0.5), vec3(0.6, 0.9, 1.0), step(0.75, fract(h * 7.3 + block)));
    vec3 pane3 = vec3(0.10, 0.15, 0.21) * (0.8 + 0.4 * h) + vec3(0.30, 0.26, 0.24) * pow(1.0 - abs(dot(n, toCam / dist)), 3.0);
    albedo = mix(albedo, pane3, mix(0.5 * vPar.x, pane * 0.9, sharp) * step(0.3, vPar.x));
    albedo *= 1.0 - 0.25 * (1.0 - step(0.3, vPar.x)) * (1.0 - pane) * sharp;       // murs des bunkers : joints
    emit += tone * mix(vPar.x * (0.15 + 0.5 * block) * 0.6, lit * pane * (0.6 + 0.8 * block) * 1.5, sharp) * lights * step(0.3, vPar.x);
  }
  emit += vCol * vPar.y * (0.35 + 0.9 * uNight);

  float geo = dot(up, uSun);
  float diff = max(dot(n, uSun), 0.0) * smoothstep(-0.03, 0.07, geo);
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.40) * 0.75, vec3(1.0, 0.97, 0.93), smoothstep(0.0, 0.4, geo)) * 1.9;
  vec3 ambient = vec3(0.80, 0.58, 0.42) * 0.2 * smoothstep(-0.12, 0.25, geo) * (0.55 + 0.45 * dot(n, up)) + vec3(0.006, 0.007, 0.01);
  float ao = 0.65 + 0.35 * smoothstep(0.0, 0.25, vLoc.y);
  vec3 col = albedo * (diff * sunCol + ambient * ao) + emit;
  vec3 h = normalize(uSun + toCam / dist);
  col += sunCol * pow(max(dot(n, h), 0.0), 60.0) * 0.25 * step(0.0, geo) * step(0.001, vPar.x + uTint);
  vec4 a = atmosphere(uCam, -toCam / dist, dist, 6);
  gl_FragColor = vec4(display(col * a.a + a.rgb), 1.0);
}`;

const glassFrag = atmo => /* glsl */`
precision highp float;
${atmo}
uniform float uNight;
varying vec3 vN, vCol, vLoc, vPos;
varying vec2 vUv;
void main() {
  vec3 n = normalize(vN), toCam = uCam - vPos;
  float dist = length(toCam);
  vec3 v = toCam / dist, up = normalize(vPos);
  if (!gl_FrontFacing) n = -n;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0), geo = dot(up, uSun), day = smoothstep(-0.05, 0.2, geo);
  vec2 f = abs(fract(vUv * vec2(0.5, 1.0) + 0.5) - 0.5), w = fwidth(vUv * vec2(0.5, 1.0));
  float frame = max(1.0 - smoothstep(0.03, 0.03 + w.x * 1.5, f.x), 1.0 - smoothstep(0.04, 0.04 + w.y * 1.5, f.y));
  vec3 sunCol = vec3(1.0, 0.95, 0.88) * 1.9;
  vec3 col = vCol * (0.10 + 0.35 * fres) * (0.15 + day) + sunCol * pow(max(dot(reflect(-v, n), uSun), 0.0), 90.0) * 2.0 * day;
  col += vCol * 0.22 * uNight * (0.5 + 0.5 * fres);                    // la ville éclaire ses dômes de l'intérieur
  col = mix(col, vec3(0.75) * (0.12 + day * max(dot(n, uSun), 0.0) * 1.6 + 0.2 * day), frame);
  float alpha = clamp(0.10 + 0.55 * fres + 0.12 * uNight + frame * 0.85, 0.0, 1.0);
  vec4 a = atmosphere(uCam, -v, dist, 6);
  gl_FragColor = vec4(display(col * a.a + a.rgb * alpha), alpha);
}`;

const lightVert = /* glsl */`
${BEND}
uniform float uFocal, uTime, uNight, uMinPx;
uniform vec3 uCam;
attribute vec3 aCol, aLamp;       // aLamp : taille en km, clignotement, genre
varying vec3 vC;
void main() {
  vec3 b = bend(position);
  vec4 mv = modelViewMatrix * vec4(b, 1.0);
  float dist = length(mv.xyz), px = aLamp.x / dist * uFocal, size = clamp(px, uMinPx, 80.0);
  float k = min(1.0, max(px / size, 0.35));
  if (aLamp.z < 0.5) k *= uNight;
  else if (aLamp.z > 1.5) k *= uNight * 0.6 * smoothstep(150.0, 900.0, dist);
  if (aLamp.y > 0.0) k *= 0.25 + 0.75 * smoothstep(0.55, 0.75, sin(uTime * 2.6 / aLamp.y + aLamp.y * 40.0));
  vC = aCol * k;
  gl_PointSize = k > 0.002 ? size : 0.0;
  gl_Position = projectionMatrix * mv;
}`;
const lightFrag = /* glsl */`
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0, f = exp(-d * d * 5.0) - 0.0067;
  gl_FragColor = vec4(vC * max(f, 0.0) * 2.6, 1.0);
}`;

/**
 * Construit la ville. `env` : { shared (uniformes communs), ATMO (source GLSL), R, dirOf }.
 * Renvoie { group, places, update(time, camera, ex, focalPx, dpr) }.
 */
export function createCity(THREE, env) {
  const L = layout(), { shared, ATMO, R, dirOf } = env;
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const up = dirOf(SITE.lat, SITE.lon), east = new THREE.Vector3(0, 1, 0).cross(up).normalize(), south = east.clone().cross(up);
  const own = { uRc: { value: R }, uNight: { value: 0 }, uTime: { value: 0 }, uFocal: { value: 1000 }, uMinPx: { value: 2 } };
  const solid = (local, tint = 0) => new THREE.ShaderMaterial({
    vertexShader: solidVert, fragmentShader: solidFrag(ATMO), side: THREE.DoubleSide,
    uniforms: { ...shared, ...own, uLocal: { value: local }, uTint: { value: tint } },
  });
  const add = (geo, mat, order = 0) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = order; group.add(m); return m; };

  add(L.g.build(THREE), solid(new THREE.Matrix4()));
  add(L.glass.build(THREE), new THREE.ShaderMaterial({
    vertexShader: solidVert, fragmentShader: glassFrag(ATMO), side: THREE.DoubleSide, transparent: true, depthWrite: false,
    uniforms: { ...shared, ...own, uLocal: { value: new THREE.Matrix4() } },
  }), 1);

  const n = L.lights.length / 9, lp = new Float32Array(n * 3), lc = new Float32Array(n * 3), ll = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { lp.set(L.lights.slice(i * 9, i * 9 + 3), i * 3); lc.set(L.lights.slice(i * 9 + 3, i * 9 + 6), i * 3); ll.set(L.lights.slice(i * 9 + 6, i * 9 + 9), i * 3); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('aCol', new THREE.BufferAttribute(lc, 3)); lg.setAttribute('aLamp', new THREE.BufferAttribute(ll, 3));
  const pts = new THREE.Points(lg, new THREE.ShaderMaterial({
    vertexShader: lightVert, fragmentShader: lightFrag, uniforms: { ...shared, ...own },
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  pts.frustumCulled = false; pts.renderOrder = 2; group.add(pts);

  const dishGeo = L.dish.build(THREE), flyGeo = L.flyer.build(THREE);
  for (const m of L.movers) {
    m.mat = new THREE.Matrix4();
    add(m.kind === 'radar' ? dishGeo : flyGeo, solid(m.mat, m.kind === 'radar' ? 1 : 0));
  }
  const rot = new THREE.Matrix4(), tmp = new THREE.Matrix4(), center = new THREE.Vector3();

  return {
    group,
    places: L.places.map(([name, x, z, far]) => { const lat = SITE.lat - z / (R * Math.PI / 180); return [name, lat, SITE.lon + x / (R * Math.PI / 180 * Math.cos(lat * Math.PI / 180)), far, 2]; }),
    update(time, camera, ex, focalPx, dpr) {
      const rc = R + ex * SITE.h;
      center.copy(up).multiplyScalar(rc);
      group.visible = camera.position.distanceTo(center) < 5000;
      if (!group.visible) return;
      group.matrix.makeBasis(east, up, south).setPosition(center);
      group.matrixWorld.copy(group.matrix);
      for (const c of group.children) c.matrixWorld.copy(group.matrix);
      own.uRc.value = rc; own.uTime.value = time; own.uFocal.value = focalPx; own.uMinPx.value = 2.4 * dpr;
      own.uNight.value = 1 - Math.min(1, Math.max(0, (up.dot(shared.uSun.value) + 0.04) / 0.2));
      for (const m of L.movers) {
        if (m.kind === 'radar') m.mat.makeRotationY(time * m.speed).multiply(rot.makeRotationZ(m.tilt)).setPosition(m.x, m.y, m.z);
        else {
          const a = m.ph + time * m.speed, dir = Math.sign(m.speed);
          m.mat.makeRotationY(-a - dir * Math.PI / 2).multiply(rot.makeRotationX(-dir * 0.35)).multiply(tmp.makeScale(m.s, m.s, m.s))
            .setPosition(m.cx + Math.cos(a) * m.r, m.y + Math.sin(a * 3 + m.ph) * 0.15, m.cz + Math.sin(a) * m.r);
        }
      }
    },
  };
}
