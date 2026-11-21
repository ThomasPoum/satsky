/* SatSky – calculs purs (sans DOM), partagés par la page et les tests. */
(function (root) {
  const D = Math.PI / 180, RE = 6371, MU = 398600.4418;
  const wrap180 = x => ((((x + 180) % 360) + 360) % 360) - 180;

  /* Position approchée du Soleil (repère inertiel, km). Précision ~0,01°, largement suffisante. */
  function sunEci(d) {
    const n = +d / 864e5 + 2440587.5 - 2451545;
    const L = 280.46 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D;
    const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D, eps = (23.439 - 4e-7 * n) * D;
    const R = 1.496e8 * (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g));
    return { x: R * Math.cos(lam), y: R * Math.cos(eps) * Math.sin(lam), z: R * Math.sin(eps) * Math.sin(lam) };
  }
  /* Le satellite est-il éclairé ? (ombre cylindrique de la Terre) */
  function sunlit(p, sun) {
    const l = Math.hypot(sun.x, sun.y, sun.z), u = { x: sun.x / l, y: sun.y / l, z: sun.z / l };
    const pr = p.x * u.x + p.y * u.y + p.z * u.z;
    return pr > 0 || Math.hypot(p.x - pr * u.x, p.y - pr * u.y, p.z - pr * u.z) > RE;
  }

  /* Quaternions [x, y, z, w], convention W3C DeviceOrientation (Z-X'-Y'') */
  const Q = {
    mul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; },
    euler(a, b, g) { const h = x => x * D / 2; return Q.mul(Q.mul([0, 0, Math.sin(h(a)), Math.cos(h(a))], [Math.sin(h(b)), 0, 0, Math.cos(h(b))]), [0, Math.sin(h(g)), 0, Math.cos(h(g))]); },
    dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; },
    slerp(a, b, t) {
      let d = Q.dot(a, b); if (d < 0) { b = b.map(x => -x); d = -d; }
      if (d > 0.9995) { const r = a.map((x, i) => x + (b[i] - x) * t), n = Math.hypot(...r); return r.map(x => x / n); }
      const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
      return a.map((x, i) => x * wa + b[i] * wb);
    },
    angle(a, b) { return 2 * Math.acos(Math.min(1, Math.abs(Q.dot(a, b)))) / D; },
    conj(q) { return [-q[0], -q[1], -q[2], q[3]]; },
    yaw(deg) { const h = deg * D / 2; return [0, 0, Math.sin(h), Math.cos(h)]; },
    /* rotation autour de la verticale qui amène q_rel sur q_abs (q_abs ≈ yaw(off) · q_rel), en degrés */
    yawOffset(qAbs, qRel) { const d = Q.mul(qAbs, Q.conj(qRel)); return wrap180(2 * Math.atan2(d[2], d[3]) / D); },
    /* matrice 3×3 (ligne par ligne) : repère téléphone → repère local (x est, y nord, z zénith) */
    mat(q) { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]; }
  };
  /* Filtre « 1 € » appliqué à l'orientation : coefficient de lissage pour un pas dt (s) et une vitesse (°/s) */
  function oneEuroAlpha(dt, speed, fcMin = 1.1, beta = 0.045) {
    const fc = fcMin + beta * speed, tau = 1 / (2 * Math.PI * fc);
    return Math.min(1, 1 / (1 + tau / Math.max(dt, 0.001)));
  }

  /* Recalage lent du nord : le gyroscope donne le mouvement, la boussole ne corrige que la dérive.
     Les sursauts du magnétomètre (> 20°) sont ignorés s'ils ne durent pas 1,5 s, et la boussole est
     ignorée quand on vise près du zénith, où elle n'est pas fiable. */
  function northFilter() {
    const f = { off: null, outSince: 0 };
    f.update = (cand, camEl, t, good = true) => {
      if (f.off == null) { f.off = cand; return f.off; }
      if (Math.abs(camEl) > 70) return f.off;
      const err = wrap180(cand - f.off);
      let k;
      if (Math.abs(err) > 20) {
        if (!f.outSince) f.outSince = t;
        if (t - f.outSince < 1500) return f.off;
        k = 0.03;
      } else { f.outSince = 0; k = good ? 0.01 : 0.004; }
      f.off = wrap180(f.off + err * k);
      return f.off;
    };
    return f;
  }
  function enu(az, el) { const c = Math.cos(el * D); return [c * Math.sin(az * D), c * Math.cos(az * D), Math.sin(el * D)]; }
  /* Projection perspective d'une direction du ciel sur l'écran (caméra arrière, axe -z du téléphone). */
  function project(R, az, el, f, th, W, H) {
    const e = enu(az, el);
    const vx = R[0] * e[0] + R[3] * e[1] + R[6] * e[2], vy = R[1] * e[0] + R[4] * e[1] + R[7] * e[2], vz = R[2] * e[0] + R[5] * e[1] + R[8] * e[2];
    const xs = vx * Math.cos(th) - vy * Math.sin(th), ys = vx * Math.sin(th) + vy * Math.cos(th);
    if (vz > -0.05) return { x: 0, y: 0, ok: false, dx: xs, dy: -ys };
    return { x: W / 2 + f * xs / -vz, y: H / 2 - f * ys / -vz, ok: true, dx: xs, dy: -ys };
  }
  /* Direction visée par la caméra arrière */
  function aimOf(R) {
    const d = [-R[2], -R[5], -R[8]];
    return { az: (Math.atan2(d[0], d[1]) / D + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, d[2]))) / D };
  }

  function parseTLE(txt, twoline2satrec) {
    const L = String(txt).split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean), out = [];
    for (let i = 0; i < L.length; i++) {
      if (L[i + 1]?.startsWith('1 ') && L[i + 2]?.startsWith('2 ')) {
        try { out.push({ name: L[i].trim(), id: L[i + 1].slice(2, 7).trim(), rec: twoline2satrec(L[i + 1], L[i + 2]), el: -90, az: 0 }); } catch {}
        i += 2;
      }
    }
    return out;
  }
  /* Paramètres d'orbite lisibles à partir des éléments SGP4 (no en rad/min) */
  function orbitParams(rec) {
    const n = rec.no / 60, a = Math.cbrt(MU / (n * n)), e = rec.ecco;
    const per = 2 * Math.PI / rec.no, inc = rec.inclo / D, apo = a * (1 + e) - RE, peri = a * (1 - e) - RE;
    let kind = apo < 2000 ? 'Orbite basse' : Math.abs(per - 1436) < 15 && e < 0.05 ? 'Orbite géostationnaire' : e > 0.25 ? 'Orbite très elliptique' : 'Orbite moyenne';
    if (apo < 2000 && inc > 95 && inc < 101) kind = 'Orbite basse héliosynchrone';
    return { per, inc, apo, peri, kind, e };
  }
  function kbMatch(kb, name) { return kb.find(k => k.re.test(name)) || null; }

  const Core = { D, RE, MU, wrap180, sunEci, sunlit, Q, oneEuroAlpha, northFilter, enu, project, aimOf, parseTLE, orbitParams, kbMatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof self !== 'undefined' ? self : globalThis);
