// Mars en 3D : globe à niveaux de détail, relief MOLA réel, atmosphère poussiéreuse, Soleil.
// Repère : celui de la planète (fixe). Y = pôle nord, longitude 0 sur +X, l'est vers -Z. Unité : le kilomètre.
import * as THREE from './three.module.min.js';
import { SITE, createCity } from './city.js?v=5';

const R = 3389.5, DEG = Math.PI / 180;
const SEG = 48;            // segments par côté de tuile
const MAXL = 6;            // niveau le plus fin : 2,8° par tuile, un sommet tous les 3,4 km (la résolution de MOLA)
const CMAX = 3, NMAX = 4;  // niveaux les plus fins des tuiles de couleur et de pentes
const HL = 3;              // niveau des cases d'altitude détaillée
const CPX = 512, NPX = 360, GUT = 4;
const EXMAX = 10;
const TILT = 25.19 * DEG, SOL = 88775.244;
const DATA = 'data/';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap180 = d => ((d + 180) % 360 + 360) % 360 - 180;
function dirOf(lat, lon, out = new THREE.Vector3()) {
  const c = Math.cos(lat * DEG);
  return out.set(c * Math.cos(lon * DEG), Math.sin(lat * DEG), -c * Math.sin(lon * DEG));
}
const latOf = v => Math.asin(clamp(v.y / v.length(), -1, 1)) / DEG;
const lonOf = v => Math.atan2(-v.z, v.x) / DEG;

/* ───────────── Altitudes (côté processeur) ───────────── */

async function loadBitmap(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' : ' + r.status);
  return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true });
function pixelsOf(bmp) {
  scratch.width = bmp.width; scratch.height = bmp.height;
  sctx.globalCompositeOperation = 'copy';
  sctx.drawImage(bmp, 0, 0);
  const d = sctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return d;
}

let low = null;                // Float32Array 1441 x 721, kilomètres
let hiRanges = null;           // [min, max] en mètres par case de niveau 3
const hiTiles = new Map();     // 'x_y' -> { d: Uint8Array 722², lo, span, last } ou Promise
let frame = 0;

// Le site de la ville est aplani : un plateau à altitude fixe, raccordé en douceur au terrain réel.
const siteDir = dirOf(SITE.lat, SITE.lon), siteTmp = new THREE.Vector3();
function leveled(h, lat, lon) {
  if (Math.abs(lat - SITE.lat) > 1.2 || Math.abs(wrap180(lon - SITE.lon)) > 1.2) return h;
  const d = Math.acos(Math.min(1, dirOf(lat, lon, siteTmp).dot(siteDir))) * R;
  h += (SITE.h - h) * (1 - smooth(SITE.flat0, SITE.flat1, d));
  // La Grande Digue : un anneau plus haut que la mer future, qui garde la ville au sec.
  return Math.max(h, SITE.h + (SITE.dike - SITE.h) * smooth(52, 58, d) * (1 - smooth(60, 66, d)));
}
function sampleLow(lat, lon) {
  const fx = clamp((wrap180(lon) + 180) * 4, 0, 1440), fy = clamp((90 - lat) * 4, 0, 720);
  const x = Math.min(fx | 0, 1439), y = Math.min(fy | 0, 719), u = fx - x, v = fy - y, i = y * 1441 + x;
  return leveled((low[i] * (1 - u) + low[i + 1] * u) * (1 - v) + (low[i + 1441] * (1 - u) + low[i + 1442] * u) * v, lat, lon);
}
function sampleHi(t, tx, ty, lat, lon) {
  const fx = clamp((lon - (-180 + tx * 22.5)) * 32 + 0.5, 0, 720.999), fy = clamp((90 - ty * 22.5 - lat) * 32 + 0.5, 0, 720.999);
  const x = fx | 0, y = fy | 0, u = fx - x, v = fy - y, i = y * 722 + x, d = t.d;
  return leveled(t.lo + t.span * ((d[i] * (1 - u) + d[i + 1] * u) * (1 - v) + (d[i + 722] * (1 - u) + d[i + 723] * u) * v), lat, lon);
}
function hiKey(lat, lon) {
  const tx = clamp(Math.floor((wrap180(lon) + 180) / 22.5), 0, 15), ty = clamp(Math.floor((90 - lat) / 22.5), 0, 7);
  return [tx, ty];
}
function loadHi(tx, ty) {
  const k = tx + '_' + ty, e = hiTiles.get(k);
  if (e) return e instanceof Promise ? e : Promise.resolve(e);
  const p = loadBitmap(`${DATA}h/${k}.webp`).then(bmp => {
    const px = pixelsOf(bmp), d = new Uint8Array(722 * 722);
    for (let i = 0; i < d.length; i++) d[i] = px[i * 4];
    const [lo, hi] = hiRanges[ty * 16 + tx];
    const t = { d, lo: lo / 1000, span: (hi - lo) / 255000, last: frame };
    hiTiles.set(k, t);
    return t;
  }).catch(err => { hiTiles.delete(k); throw err; });
  hiTiles.set(k, p);
  return p;
}
/** Altitude du sol en km au-dessus de l'aréoïde ; détaillée si la case est déjà chargée. */
function heightAt(lat, lon) {
  lon = wrap180(lon);
  const [tx, ty] = hiKey(lat, lon), t = hiTiles.get(tx + '_' + ty);
  if (t && !(t instanceof Promise)) { t.last = frame; return sampleHi(t, tx, ty, lat, lon); }
  return sampleLow(lat, lon);
}

/* ───────────── Rendu ───────────── */

const canvas = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // les shaders font eux-mêmes la courbe de rendu
const coarse = matchMedia('(pointer:coarse)').matches;
const DETAIL = coarse ? 2.2 : 1.5;                        // taille visée d'un point de donnée à l'écran, en pixels
const scene = new THREE.Scene(), sky = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e5);

const shared = {
  uSun: { value: new THREE.Vector3(1, 0, 0) },
  uCam: { value: new THREE.Vector3() },
  uEx: { value: 3 },
  uHs: { value: 11 },
  uPix: { value: 0.001 },      // angle d'un pixel, en radians
  uCity: { value: siteDir },
  uTerra: { value: 0 },        // avancement de la terraformation, de 0 à 1
  uSea: { value: -20 },        // niveau de la mer, en km par rapport au niveau zéro
  uWet: { value: 0 },          // humidité : lacs, fleuves, végétation
  uTime: { value: 0 },
};

const ATMO = /* glsl */`
uniform vec3 uSun, uCam;
uniform float uHs, uEx, uTerra;
const float RP = 3389.5;
vec2 hitSphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
// Poussière en suspension : densité exponentielle, ciel caramel le jour, lueur bleue vers le Soleil bas.
// Renvoie la lumière diffusée (rgb) et la transmission (a) le long du rayon.
vec4 atmosphere(vec3 ro, vec3 rd, float tmax, int steps) {
  vec2 t = hitSphere(ro, rd, RP + 7.0 * uHs);
  float t0 = max(t.x, 0.0), t1 = min(t.y, tmax);
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);
  float dt = (t1 - t0) / float(steps), beta = mix(0.1, 0.13, uTerra) / uHs, od = 0.0;
  float cs = dot(rd, uSun), fwd = max(cs, 0.0);
  float broad = 0.75 + 0.5 * fwd * fwd * fwd, glow = pow(fwd, 60.0) * 2.0 + pow(fwd, 12.0) * 0.22;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
    float r = length(p), h = max(r - RP, -12.0 * uEx);
    float dens = exp(-h / uHs), mu = dot(p, uSun) / r;
    float lit = smoothstep(-0.05, 0.12, mu + sqrt(2.0 * max(h, 0.0) / RP));
    float low = 1.0 - smoothstep(0.0, 0.35, mu);
    vec3 c = mix(vec3(0.80, 0.56, 0.38), vec3(0.20, 0.40, 0.92), uTerra) * broad * mix(1.0, 0.45, low)
      + mix(vec3(0.32, 0.50, 0.95), vec3(1.0, 0.50, 0.22), uTerra) * glow * (0.25 + low);
    od += dens * dt * 0.5;
    sum += exp(-beta * od) * dens * dt * lit * c;
    od += dens * dt * 0.5;
  }
  return vec4(sum * beta * 1.5, exp(-beta * od));
}
vec3 display(vec3 c) { c = 1.0 - exp(-c * 1.25); return pow(c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65, vec3(1.0 / 2.2)); }
`;

const terrainVert = /* glsl */`
attribute vec3 aUp;
attribute float aH, aSkirt;
uniform float uEx, uSkirt, uSea;
uniform vec3 uCity;
varying vec2 vUv;
varying vec3 vPos;
varying float vH;
void main() {
  float h = length(aUp - uCity) * 3389.5 < 59.0 ? aH : max(aH, uSea);      // pas de mer dans le polder de la ville
  vH = aH;
  vec3 p = position + aUp * (h * uEx - aSkirt * uSkirt * max(uEx, 1.0));
  vUv = uv;
  vPos = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const terrainFrag = /* glsl */`
precision highp float;
precision highp int;
${ATMO}
uniform sampler2D tColor, tNorm;
uniform vec4 uCx, uNx;        // échelle (xy) et décalage (zw) vers la tuile de couleur / de pentes
uniform float uSmooth, uPix, uSea, uWet, uTime;
uniform vec3 uCity;
uniform sampler2D tRiver, tLake;
uniform vec4 uWx;
varying float vH;
varying vec2 vUv;
varying vec3 vPos;

float bicubic(vec2 p) {       // B-spline en 4 lectures, p en pixels de la texture de pentes
  vec2 q = p - 0.5, i = floor(q), f = q - i, f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = i - 0.5 + w1 / g0, h1 = i + 1.5 + w3 / g1, s = vec2(${2 * (NPX + 2 * GUT)}.0, ${NPX + 2 * GUT}.0);
  return g0.y * (g0.x * textureLod(tNorm, vec2(h0.x, h0.y) / s, 0.0).r + g1.x * textureLod(tNorm, vec2(h1.x, h0.y) / s, 0.0).r)
       + g1.y * (g0.x * textureLod(tNorm, vec2(h0.x, h1.y) / s, 0.0).r + g1.x * textureLod(tNorm, vec2(h1.x, h1.y) / s, 0.0).r);
}
float slope(float v) { float e = (v * 255.0 - 127.5) / 127.0; return sign(e) * pow(abs(e), 1.0 / 0.7); }

float hash(ivec3 p) {
  uint n = uint(p.x) * 1597334673u ^ uint(p.y) * 3812015801u ^ uint(p.z) * 2798796415u;
  n = (n ^ (n >> 15u)) * 2246822519u; n ^= n >> 13u;
  return float(n >> 8u) / 16777216.0;
}
vec4 noised(vec3 x) {         // bruit de valeur et son gradient
  vec3 i = floor(x), f = x - i, u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  ivec3 I = ivec3(i);
  float a = hash(I), b = hash(I + ivec3(1, 0, 0)), c = hash(I + ivec3(0, 1, 0)), d = hash(I + ivec3(1, 1, 0));
  float e = hash(I + ivec3(0, 0, 1)), g = hash(I + ivec3(1, 0, 1)), h = hash(I + ivec3(0, 1, 1)), k = hash(I + ivec3(1, 1, 1));
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g, k7 = -a + b + c - d + e - g - h + k;
  return vec4(-1.0 + 2.0 * (a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z),
    2.0 * du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
}

void main() {
  vec3 up = normalize(vPos);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
  east = dot(east, east) < 1e-8 ? vec3(0.0, 0.0, -1.0) : normalize(east);
  vec3 north = cross(up, east);

  vec2 uc = (float(${GUT}) + (uCx.zw + vUv * uCx.xy) * float(${CPX})) / float(${CPX + 2 * GUT});
  vec3 albedo = texture2D(tColor, uc).rgb;
  albedo = mix(vec3(dot(albedo, vec3(0.3, 0.55, 0.15))), albedo, 0.9);

  vec2 pn = float(${GUT}) + (uNx.zw + vUv * uNx.xy) * float(${NPX});
  vec2 pn2 = pn + vec2(${NPX + 2 * GUT}.0, 0.0), sz = vec2(${2 * (NPX + 2 * GUT)}.0, ${NPX + 2 * GUT}.0);
  float se, sn;
  if (uSmooth > 0.5) { se = slope(bicubic(pn)); sn = slope(bicubic(pn2)); }
  else { se = slope(texture2D(tNorm, pn / sz).r); sn = slope(texture2D(tNorm, pn2 / sz).r); }
  float cityD = length(up - uCity) * RP, level = smoothstep(50.0, 66.0, cityD);      // plateau de la ville : plus de pentes
  se *= level; sn *= level;
  if (cityD < 68.0 && cityD > 50.0) {       // flancs de la digue
    float f1 = smoothstep(52.0, 58.0, cityD + 0.5) * (1.0 - smoothstep(60.0, 66.0, cityD + 0.5)), f0 = smoothstep(52.0, 58.0, cityD - 0.5) * (1.0 - smoothstep(60.0, 66.0, cityD - 0.5));
    vec3 away = normalize(up - uCity * dot(up, uCity));
    float sr = (f1 - f0) * ${(2.85).toFixed(2)};
    se += sr * dot(away, east); sn += sr * dot(away, north);
    albedo = mix(albedo, vec3(0.42, 0.40, 0.39), smoothstep(52.0, 55.0, cityD) * (1.0 - smoothstep(63.0, 66.0, cityD)) * 0.8);
  }

  // ── Terraformation : eau dans les creux, végétation selon la latitude, l'altitude et l'humidité ──
  float water = 0.0, ice = 0.0, depthKm = 0.0;
  if (uWet > 0.0) {
    vec2 uw = uWx.zw + vUv * uWx.xy;
    float riv = texture2D(tRiver, uw).r, lk = texture2D(tLake, uw).r, sinLat = abs(up.y);
    float coast = noised(vPos / 23.0).x * 0.035;
    float sea = step(vH + coast, uSea);
    float lake = smoothstep(1.0 - 0.72 * uWet, 1.03 - 0.72 * uWet, lk) * step(0.004, lk);
    float thr = mix(0.92, 0.3, uWet), river = smoothstep(thr, thr + 0.1, riv) * (1.0 - smoothstep(6.0, 7.5, vH));
    water = cityD < 59.0 ? 0.0 : max(sea, max(lake, river));
    depthKm = max(uSea - vH, 0.0) * sea + 0.3 * (1.0 - sea);
    float elev = max(vH - max(uSea, -4.5), 0.0);
    vec4 n1 = noised(vPos / 260.0), n2 = noised(vPos / 70.0 + 9.0);
    float temp = mix(-0.75, 1.05, uTerra) - sinLat * sinLat * 1.25 - elev * 0.085 + 0.08 * n2.x;
    float moist = clamp(0.72 - elev * 0.065 + 0.3 * n1.x + 0.12 * n2.x + riv * 0.5 + lk, 0.0, 1.0) * uWet;
    float bare = smoothstep(0.18, 0.5, length(vec2(se, sn)));
    float green = smoothstep(-0.05, 0.3, temp) * smoothstep(0.2, 0.5, moist) * (1.0 - bare);
    float lum = clamp(dot(albedo, vec3(0.3, 0.55, 0.15)) / 0.22, 0.4, 1.8);
    vec3 veg = mix(vec3(0.20, 0.19, 0.10), vec3(0.15, 0.25, 0.07), smoothstep(0.45, 0.75, uTerra) * smoothstep(0.1, 0.45, temp));     // lichens et toundra, puis prairie
    veg = mix(veg, vec3(0.035, 0.12, 0.04), smoothstep(0.25, 0.6, temp) * smoothstep(0.5, 0.78, moist) * smoothstep(0.55, 0.9, uTerra));   // forêt
    albedo = mix(albedo, veg * (0.5 + 0.55 * lum), green);
    float snow = smoothstep(-0.32, -0.55, temp) * smoothstep(0.25, 0.7, uWet) * (1.0 - smoothstep(9.0, 12.0, vH)) * smoothstep(0.15, 0.4, moist + 0.3);
    albedo = mix(albedo, vec3(0.88, 0.90, 0.93), snow * 0.9 * (1.0 - bare * 0.6));
    ice = water * smoothstep(-0.25, -0.45, temp);
    vec3 wcol = mix(vec3(0.04, 0.24, 0.30), vec3(0.008, 0.05, 0.16), smoothstep(0.0, 1.0, depthKm));
    albedo = mix(albedo, mix(wcol, vec3(0.82, 0.88, 0.93), ice), water);
    se *= 1.0 - water; sn *= 1.0 - water;
  }

  // De près, les données (1,85 km par point) ne suffisent plus : un grain fractal prend le relais,
  // plus marqué là où le terrain réel est accidenté. Chaque octave s'efface quand elle devient plus fine qu'un pixel.
  vec3 toCam = uCam - vPos;
  float dist = length(toCam), near = 1.0 - smoothstep(60.0, 900.0, dist);
  if (near > 0.0) {
    float px = dist * uPix, rough = 0.35 + 5.0 * length(vec2(se, sn)), wl = 12.0, tone = 0.0, amp = 1.0;
    vec3 g = vec3(0.0);
    for (int i = 0; i < ${coarse ? 7 : 9}; i++) {
      float w = smoothstep(2.0, 6.0, wl / px);
      if (w > 0.0) { vec4 n = noised(vPos / wl + float(i) * 17.3); g += n.yzw * w * amp; tone += n.x * w * amp; }
      wl *= 0.5; amp *= 0.85;
    }
    float k = 0.026 * rough * near * (1.0 - water);
    se += dot(g, east) * k; sn += dot(g, north) * k;
    albedo *= 1.0 + 0.045 * tone * near;
  }

  vec3 n = normalize(up - uEx * (se * east + sn * north));
  float geo = dot(up, uSun), shade = smoothstep(-0.03, 0.07, geo);
  float diff = max(dot(n, uSun), 0.0) * shade;
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.40) * 0.75, vec3(1.0, 0.97, 0.93), smoothstep(0.0, 0.4, geo)) * 1.9;
  vec3 skyCol = mix(vec3(0.80, 0.58, 0.42), vec3(0.45, 0.62, 0.95), uTerra);
  vec3 ambient = skyCol * 0.16 * smoothstep(-0.12, 0.25, geo) * (0.6 + 0.4 * dot(n, up)) + vec3(0.004, 0.005, 0.008);
  vec3 col = albedo * (diff * sunCol + ambient);
  vec3 v = toCam / dist;
  if (water > 0.0) {                         // reflet du ciel et éclat du Soleil sur l'eau libre
    float open = water * (1.0 - ice), fres = 0.02 + 0.98 * pow(1.0 - max(dot(up, v), 0.0), 5.0);
    vec3 wn = normalize(up + 0.012 * noised(vPos / 0.9 + uTime * 0.05).yzw + 0.02 * noised(vPos / 6.0).yzw);
    col += open * (skyCol * 0.5 * fres * smoothstep(-0.1, 0.2, geo) + sunCol * pow(max(dot(reflect(-v, wn), uSun), 0.0), 220.0) * 2.5 * shade);
  }
  if (uWet > 0.25) {                         // nuages, vus d'en haut seulement
    float far = smoothstep(120.0, 700.0, dist);
    if (far > 0.0) {
      vec3 q = vPos / 420.0 + vec3(uTime * 0.004, 0.0, uTime * 0.002);
      float c = noised(q).x * 0.55 + noised(q * 2.3 + 4.0).x * 0.28 + noised(q * 5.1 + 9.0).x * 0.17;
      float thr = mix(0.82, 0.57, uWet);
      float cover = smoothstep(thr, thr + 0.16, c * 0.5 + 0.5 + 0.03 * water) * (1.0 - smoothstep(9.0, 13.0, vH));
      col = mix(col, vec3(0.95) * (max(geo, 0.0) * shade * sunCol * 0.85 + skyCol * 0.2 * smoothstep(-0.12, 0.25, geo)), cover * 0.82 * far);
    }
  }

  vec4 a = atmosphere(uCam, -toCam / dist, dist, ${coarse ? 6 : 8});
  gl_FragColor = vec4(display(col * a.a + a.rgb), 1.0);
}`;

const edges = [[], [], [], []];   // indices des sommets de chaque bord
const quadIndex = (() => {
  const n = SEG + 1, idx = [];
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // Jupes : chaque bord est doublé par une rangée enfoncée, pour boucher les jours entre tuiles de niveaux différents.
  for (let i = 0; i < n; i++) { edges[0].push(i); edges[1].push(SEG * n + i); edges[2].push(i * n); edges[3].push(i * n + SEG); }
  let s = n * n;
  for (const e of edges) {
    for (let i = 0; i < SEG; i++) idx.push(e[i], e[i + 1], s + i, e[i + 1], s + i + 1, s + i, e[i], s + i, e[i + 1], e[i + 1], s + i, s + i + 1);
    s += n;
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
})();

/* ───────────── Textures, avec compte de références ───────────── */

const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const texCache = new Map();
function acquire(kind, l, x, y) {
  const key = `${kind}/${l}/${x}_${y}`;
  let e = texCache.get(key);
  if (!e) {
    e = { key, refs: 0, tex: null, dead: false };
    e.promise = loadBitmap(`${DATA}${key}.webp`).then(bmp => {
      if (e.dead) { bmp.close(); return e; }
      const t = new THREE.Texture(bmp);
      t.flipY = false; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.anisotropy = maxAniso;
      if (kind === 'c') t.colorSpace = THREE.SRGBColorSpace;
      else { t.format = THREE.RedFormat; t.colorSpace = THREE.NoColorSpace; }
      t.onUpdate = () => { bmp.close(); };
      t.needsUpdate = true;
      e.tex = t;
      return e;
    });
    e.promise.catch(() => { if (texCache.get(key) === e) texCache.delete(key); });
    texCache.set(key, e);
  }
  e.refs++;
  return e;
}
function release(e) {
  if (--e.refs > 0) return;
  e.dead = true;
  if (texCache.get(e.key) === e) texCache.delete(e.key);
  if (e.tex) e.tex.dispose();
}

/* ───────────── Fleuves et lacs : deux cartes par hémisphère, chargées au premier usage ───────────── */

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
const hemi = [0, 1].map(() => ({ tRiver: { value: blank }, tLake: { value: blank } }));
let waterAsked = false;
function loadWater() {
  if (waterAsked) return;
  waterAsked = true;
  hemi.forEach((h, i) => [['tRiver', 'rivers'], ['tLake', 'lakes']].forEach(([u, name]) => {
    loadBitmap(`${DATA}w/${name}_${'WE'[i]}.webp`).then(bmp => {
      const t = new THREE.Texture(bmp);
      t.flipY = false; t.format = THREE.RedFormat; t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = maxAniso;
      t.onUpdate = () => { bmp.close(); };
      t.needsUpdate = true;
      h[u].value = t;
    }).catch(() => { waterAsked = false; });
  }));
}

/* ───────────── Arbre de tuiles ───────────── */

const NONE = 0, LOADING = 1, READY = 2;
const buildQueue = [];
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

class Node {
  constructor(l, x, y) {
    this.l = l; this.x = x; this.y = y;
    this.size = 180 / 2 ** l;
    this.lonW = -180 + x * this.size; this.latN = 90 - y * this.size;
    this.latC = this.latN - this.size / 2; this.lonC = this.lonW + this.size / 2;
    this.dir = dirOf(this.latC, this.lonC);
    this.center = this.dir.clone().multiplyScalar(R);
    let r = 0;
    for (const [la, lo] of [[this.latN, this.lonW], [this.latN, this.lonW + this.size], [this.latN - this.size, this.lonW], [this.latN - this.size, this.lonW + this.size]])
      r = Math.max(r, dirOf(la, lo, tmpV).multiplyScalar(R).distanceTo(this.center));
    this.flatR = r;
    this.ang = Math.asin(Math.min(1, r / (2 * R))) * 2;         // rayon angulaire vu du centre de Mars
    this.sphere = new THREE.Sphere(this.center, r + 22 * EXMAX);
    this.texel = this.size * DEG * R / NPX;
    this.hAvg = 0;
    this.state = NONE; this.children = null; this.mesh = null; this.last = 0; this.res = null;
  }
  request() {
    if (this.state !== NONE) return;
    this.state = LOADING;
    const cl = Math.min(this.l, CMAX), nl = Math.min(this.l, NMAX);
    const c = acquire('c', cl, this.x >> (this.l - cl), this.y >> (this.l - cl));
    const n = acquire('n', nl, this.x >> (this.l - nl), this.y >> (this.l - nl));
    this.res = [c, n];
    const jobs = [c.promise, n.promise];
    if (this.l > HL) jobs.push(loadHi(this.x >> (this.l - HL), this.y >> (this.l - HL)));
    Promise.all(jobs).then(r => { if (this.state === LOADING) { this.hi = r[2] || null; buildQueue.push(this); } })
      .catch(() => { if (this.state !== LOADING) return; this.dispose(); this.retry = performance.now() + 4000; });
  }
  build() {
    if (this.state !== LOADING) return;
    const n = SEG + 1, count = n * n + 4 * n;
    const pos = new Float32Array(count * 3), up = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    const hh = new Float32Array(count), skirt = new Float32Array(count);
    const tx = this.x >> Math.max(0, this.l - HL), ty = this.y >> Math.max(0, this.l - HL), hi = this.hi;
    let sum = 0, amp = 0, rad = 0, k = 0;
    for (let j = 0; j < n; j++) {
      const lat = this.latN - this.size * j / SEG;
      for (let i = 0; i < n; i++, k++) {
        const lon = this.lonW + this.size * i / SEG;
        const h = hi ? sampleHi(hi, tx, ty, lat, lon) : sampleLow(lat, lon);
        dirOf(lat, lon, tmpV);
        up[k * 3] = tmpV.x; up[k * 3 + 1] = tmpV.y; up[k * 3 + 2] = tmpV.z;
        pos[k * 3] = tmpV.x * R - this.center.x; pos[k * 3 + 1] = tmpV.y * R - this.center.y; pos[k * 3 + 2] = tmpV.z * R - this.center.z;
        uv[k * 2] = i / SEG; uv[k * 2 + 1] = j / SEG;
        hh[k] = h; sum += h; amp = Math.max(amp, Math.abs(h));
        rad = Math.max(rad, Math.hypot(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]));
      }
    }
    for (const e of edges) for (const s of e) {
      pos.copyWithin(k * 3, s * 3, s * 3 + 3); up.copyWithin(k * 3, s * 3, s * 3 + 3); uv.copyWithin(k * 2, s * 2, s * 2 + 2);
      hh[k] = hh[s]; skirt[k] = 1; k++;
    }
    this.hAvg = sum / (n * n);
    const skirtLen = this.size * DEG * R * 0.03 + 1.5;
    const g = new THREE.BufferGeometry();
    g.setIndex(quadIndex);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aUp', new THREE.BufferAttribute(up, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aH', new THREE.BufferAttribute(hh, 1));
    g.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rad + (amp + skirtLen) * EXMAX);
    const xf = max => { const d = Math.max(0, this.l - max), s = 1 / 2 ** d; return new THREE.Vector4(s, s, (this.x & (2 ** d - 1)) * s, (this.y & (2 ** d - 1)) * s); };
    const m = new THREE.ShaderMaterial({
      vertexShader: terrainVert, fragmentShader: terrainFrag,
      uniforms: {
        ...shared, tColor: { value: this.res[0].tex }, tNorm: { value: this.res[1].tex },
        ...hemi[this.x >> this.l], uWx: { value: xf(0) },
        uCx: { value: xf(CMAX) }, uNx: { value: xf(NMAX) }, uSmooth: { value: this.l > NMAX ? 1 : 0 }, uSkirt: { value: skirtLen },
      },
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.position.copy(this.center);
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false; this.mesh.updateMatrix();
    scene.add(this.mesh);
    this.hi = null;
    this.state = READY;
  }
  dispose() {
    if (this.children) { for (const c of this.children) c.dispose(); this.children = null; }
    if (this.mesh) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    if (this.res) { this.res.forEach(release); this.res = null; }
    this.state = NONE; this.hi = null;
  }
}

const roots = [new Node(0, 0, 0), new Node(0, 1, 0)];
const frustum = new THREE.Frustum(), projScreen = new THREE.Matrix4();
let shown = [], camLat = 0, camLon = 0, camDist = 1e4, camAgl = 1e4, focalPx = 1000, horizon = Math.PI;

function distanceTo(n) {
  const dl = wrap180(camLon - n.lonC), half = n.size / 2;
  if (Math.abs(dl) <= half && camLat <= n.latN && camLat >= n.latN - n.size) return camAgl;
  dirOf(clamp(camLat, n.latN - n.size, n.latN), n.lonC + clamp(dl, -half, half), tmpV).multiplyScalar(R + shared.uEx.value * n.hAvg);
  return Math.max(tmpV.distanceTo(camera.position), camAgl);
}
const culled = n => n.l > 0 && (Math.acos(clamp(n.dir.dot(tmpV2), -1, 1)) - n.ang > horizon || !frustum.intersectsSphere(n.sphere));
const wantsSplit = n => n.l < MAXL && n.texel / distanceTo(n) * focalPx > DETAIL;
function kids(n) {
  if (!n.children) n.children = [0, 1, 2, 3].map(i => new Node(n.l + 1, n.x * 2 + (i & 1), n.y * 2 + (i >> 1)));
  return n.children;
}
// Une tuile pas encore affichable : on lance tout de suite le chargement de toute la chaîne jusqu'au niveau voulu.
function preload(n) {
  n.last = frame;
  if (n.state === NONE && !(n.retry > performance.now())) n.request();
  if (!culled(n) && wantsSplit(n)) for (const c of kids(n)) preload(c);
}
function visit(n) {
  n.last = frame;
  if (culled(n)) return;
  if (wantsSplit(n)) {
    const ch = kids(n);
    if (ch.every(c => c.state === READY)) { for (const c of ch) visit(c); return; }
    for (const c of ch) preload(c);
  }
  n.mesh.visible = true; shown.push(n);
}
function prune(n) {
  if (!n.children) return;
  if (n.children.every(c => c.last < frame - 240)) { for (const c of n.children) c.dispose(); n.children = null; }
  else for (const c of n.children) prune(c);
}
function selectTiles() {
  for (const n of shown) n.mesh.visible = false;
  shown = [];
  projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreen);
  const ex = shared.uEx.value, rMin = R - 9 * ex;
  horizon = Math.acos(Math.min(1, rMin / camDist)) + Math.acos(rMin / (R + 22 * ex));
  tmpV2.copy(camera.position).normalize();
  for (const r of roots) visit(r);
  for (const t0 = performance.now(); buildQueue.length && performance.now() - t0 < 7;) buildQueue.shift().build();
  if (frame % 120 === 0) {
    for (const r of roots) prune(r);
    if (hiTiles.size > 40) for (const [k, t] of hiTiles) if (!(t instanceof Promise) && t.last < frame - 600) hiTiles.delete(k);
  }
}

/* ───────────── Ciel : étoiles, Soleil, atmosphère ───────────── */

const skyRoot = new THREE.Group();      // suit la caméra ; tourne avec le Soleil
sky.add(skyRoot);
let stars;
{
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const N = 3500, p = new Float32Array(N * 3), s = new Float32Array(N), c = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const z = rnd() * 2 - 1, a = rnd() * 2 * Math.PI, r = Math.sqrt(1 - z * z), m = rnd() ** 4, t = rnd();
    p.set([r * Math.cos(a), z, r * Math.sin(a)], i * 3);
    s[i] = 1 + 2.2 * m;
    const b = 0.25 + 0.75 * m;
    c.set([b * (0.85 + 0.15 * t), b * 0.92, b * (1 - 0.2 * t)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
  g.setAttribute('aCol', new THREE.BufferAttribute(c, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uDpr: { value: 1 }, uFade: { value: 1 } },
    vertexShader: `attribute float aSize; attribute vec3 aCol; uniform float uDpr; varying vec3 vC;
      void main(){ vC = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uDpr; }`,
    fragmentShader: `varying vec3 vC; uniform float uFade; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * smoothstep(0.5, 0.1, d) * uFade, 1.0); }`,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });
  stars = new THREE.Points(g, m);
  stars.frustumCulled = false; stars.renderOrder = 0;
  skyRoot.add(stars);
}
const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec2 vP;
    void main(){
      float r = length(vP), fade = max(1.0 - r, 0.0);
      float disc = smoothstep(0.020, 0.014, r) * 30.0;
      float halo = 0.0016 / (r * r + 0.0004) + 0.05 * fade * fade;
      vec3 c = vec3(1.0, 0.95, 0.86) * disc + vec3(1.0, 0.86, 0.66) * halo * fade * fade;
      gl_FragColor = vec4(1.0 - exp(-c), 1.0);
    }`,
  blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
}));
sunMesh.frustumCulled = false; sunMesh.renderOrder = 1;
sky.add(sunMesh);

const airMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.ShaderMaterial({
  uniforms: shared,
  vertexShader: `varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `precision highp float;
    ${ATMO}
    varying vec3 vPos;
    void main(){
      vec3 rd = normalize(vPos - uCam);
      vec2 g = hitSphere(uCam, rd, RP - 9.0 * uEx - 2.0);
      if (g.y > 0.0 && g.x < 1e8) discard;      // le sol recouvrira ce pixel
      vec4 a = atmosphere(uCam, rd, 1e9, 16);
      gl_FragColor = vec4(display(a.rgb), 1.0 - a.a);
    }`,
  side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
}));
airMesh.frustumCulled = false; airMesh.renderOrder = 2;
sky.add(airMesh);

/* ───────────── Caméra ─────────────
   Un pivot (un point de l'espace, d'ordinaire au sol), une distance, une inclinaison.
   Se déplacer garde le pivot à altitude constante : on vole à plat, comme un avion, sans plonger dans les ravins.
   Le pivot ne se recale sur le terrain qu'au début d'un geste, sans jamais faire bouger la caméra. */

// Orientation du « chariot » : son Y est la verticale du pivot, son -Z la direction de visée à plat.
function rigAt(lat, lon, heading = 0) {
  const up = dirOf(lat, lon), east = new THREE.Vector3(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-10) east.set(0, 0, -1);
  east.normalize();
  const north = up.clone().cross(east);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.negate()));
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(AY, -heading));
}
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const HOME = { lat: 2, lon: -92, dist: 11500 };
const view = {
  q: rigAt(HOME.lat, HOME.lon), qGoal: rigAt(HOME.lat, HOME.lon),
  rP: R, rPGoal: R,                  // rayon du pivot, depuis le centre de Mars
  dist: 26000, distGoal: HOME.dist, tilt: 0, tiltGoal: 0, rate: 3,
  vel: new THREE.Vector2(), lat: HOME.lat, lon: HOME.lon, tiltNow: 0, onGround: true, look: false,
};
const MIN_DIST = 1.2, MAX_DIST = 90000, CLEAR = 0.3, ORBIT_MAX = 88 * DEG, LOOK_MAX = 155 * DEG;
const qTmp = new THREE.Quaternion(), mTmp = new THREE.Matrix4();
const autoTilt = d => 78 * DEG * (1 - smooth(Math.log10(8), Math.log10(4000), Math.log10(d)));

function pan(right, fwd, both = false) {     // angles en radians, à altitude constante
  view.qGoal.multiply(qTmp.setFromAxisAngle(AX, -fwd)).multiply(qTmp.setFromAxisAngle(AZ, -right)).normalize();
  if (both) view.q.multiply(qTmp.setFromAxisAngle(AX, -fwd)).multiply(qTmp.setFromAxisAngle(AZ, -right)).normalize();
}
function userMoved() { view.rate = 14; }
function flyTo(lat, lon, dist, keepHeading = false, heading = 0) {
  if (keepHeading) {
    const up = AY.clone().applyQuaternion(view.qGoal), f = AZ.clone().negate().applyQuaternion(view.qGoal);
    const e = new THREE.Vector3(0, 1, 0).cross(up).normalize(), n = up.clone().cross(e);
    heading = Math.atan2(f.dot(e), f.dot(n));
  }
  view.qGoal.copy(rigAt(lat, lon, heading));
  if (dist) {
    view.distGoal = clamp(dist, MIN_DIST, MAX_DIST);
    view.rPGoal = R + shared.uEx.value * heightAt(lat, lon);
    view.tiltGoal = clamp(view.tiltGoal, -autoTilt(view.distGoal), ORBIT_MAX - autoTilt(view.distGoal));
    view.onGround = true;
  }
  view.rate = 2.6; view.vel.set(0, 0);
}

/** Surface sur laquelle on vole : le sol, ou la mer là où elle le recouvre (jamais dans le polder de la ville). */
function surfaceAt(lat, lon) {
  const h = heightAt(lat, lon), sea = shared.uSea.value;
  if (h >= sea) return h;
  return Math.acos(Math.min(1, dirOf(lat, lon, siteTmp).dot(siteDir))) * R < 59 ? h : sea;
}
/** Distance du premier point de terrain le long d'un rayon, ou null s'il part dans le ciel. */
function castTerrain(ro, rd, maxT = 2e4) {
  const ex = shared.uEx.value, rTop = R + 22 * ex + 1;
  const b = ro.dot(rd), c = ro.lengthSq() - rTop * rTop, h = b * b - c;
  let t = 0;
  if (c > 0) { if (h < 0 || b > 0) return null; t = -b - Math.sqrt(h); }
  const tEnd = Math.min(maxT, h > 0 ? -b + Math.sqrt(h) : maxT);
  let prev = t;
  for (let i = 0; i < 400 && t <= tEnd; i++) {
    tmpV.copy(ro).addScaledVector(rd, t);
    const gap = tmpV.length() - (R + ex * surfaceAt(latOf(tmpV), lonOf(tmpV)));
    if (gap <= 0) {
      let lo = prev, hi = t;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2; tmpV.copy(ro).addScaledVector(rd, mid);
        if (tmpV.length() - (R + ex * surfaceAt(latOf(tmpV), lonOf(tmpV))) > 0) lo = mid; else hi = mid;
      }
      return hi;
    }
    prev = t; t += Math.max(gap * 0.4, 0.02 + t * 0.003);
  }
  return null;
}
const aP = new THREE.Vector3(), aD = new THREE.Vector3(), aX = new THREE.Vector3(), aU = new THREE.Vector3(), aF = new THREE.Vector3(), aO = new THREE.Vector3();
/** Place le pivot en X sans déplacer la caméra (en P, qui regarde vers X). */
function setRig(X, P, upHint, onGround) {
  const rho = Math.max(X.distanceTo(P), 1e-3);
  aU.copy(X).normalize(); aO.copy(P).sub(X).divideScalar(rho);
  const t = Math.acos(clamp(aU.dot(aO), -1, 1));
  aF.copy(aO).addScaledVector(aU, -aU.dot(aO)).negate();
  if (aF.lengthSq() < 1e-6) aF.copy(upHint).addScaledVector(aU, -aU.dot(upHint));
  aF.normalize();
  view.q.setFromRotationMatrix(mTmp.makeBasis(aD.copy(aF).cross(aU), aU, aO.copy(aF).negate()));
  view.qGoal.copy(view.q);
  view.rP = view.rPGoal = X.length();
  view.dist = view.distGoal = rho;
  view.tilt = view.tiltGoal = t - autoTilt(rho);
  view.onGround = onGround; view.vel.set(0, 0);
}
/** Recale le pivot sur ce que la caméra regarde ; s'il n'y a que du ciel, le pivot reste devant elle, en l'air. */
function anchor(dir) {
  aP.copy(camera.position);
  if (!dir) dir = camera.getWorldDirection(aD);
  const upHint = aX.set(0, 1, 0).applyQuaternion(camera.quaternion).clone();
  let t = castTerrain(aP, dir), solid = t !== null;
  // La station compte aussi : si on la regarde, on tourne autour d'elle.
  const c = city.stationCenter, along = aO.copy(c).sub(aP).dot(dir);
  if (along > 0 && (t === null || along < t) && aO.copy(aP).addScaledVector(dir, along).distanceTo(c) < STATION_R) { t = along; solid = true; }
  const rho = t ?? clamp(view.dist, 5, 400);
  setRig(aX.copy(aP).addScaledVector(dir, Math.max(rho, 0.05)), aP, upHint, solid);
}
/** Tourne la caméra sur place : dx vers la droite, dy vers le bas, en radians. */
const lD = new THREE.Vector3(), lZ = new THREE.Vector3(), lR = new THREE.Vector3();
function lookAround(dx, dy) {
  lZ.copy(camera.position).normalize();
  camera.getWorldDirection(lD);
  lR.copy(lD).cross(lZ);
  if (lR.lengthSq() < 1e-8) lR.set(1, 0, 0).applyQuaternion(camera.quaternion);
  lR.normalize();
  const nadir = Math.acos(clamp(-lD.dot(lZ), -1, 1)), turn = clamp(nadir - dy, 0.02, LOOK_MAX) - nadir;
  lD.applyAxisAngle(lR, turn).applyAxisAngle(lZ, -dx).normalize();
  anchor(lD);
}

const sun = { lon: -52, ls: 70, speed: 300 };
const vUp = new THREE.Vector3(), vFwd = new THREE.Vector3(), vT = new THREE.Vector3();
const keys = new Set();
let lookedByKey = false;

function flyByKeys(dt) {
  if (!keys.size) return;
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
  const step = clamp(camAgl, 0.4, 4000) * 1.1 * fast * dt;
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const u = (keys.has('KeyR') || keys.has('PageUp') || keys.has('Space') ? 1 : 0) - (keys.has('KeyF') || keys.has('PageDown') ? 1 : 0);
  const yaw = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), pitch = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
  if (yaw || pitch) { lookAround(yaw * dt * 0.9, pitch * dt * 0.7); lookedByKey = true; }
  if (f || r) { view.vel.set(0, 0); pan(r * step / view.rP, f * step / view.rP, true); }
  if (u) { view.rP = view.rPGoal = Math.max(view.rP + u * step, R - 9 * shared.uEx.value); }
  if (f || r || u || yaw || pitch) userMoved();
}

function updateCamera(dt) {
  // Vu de loin, c'est Mars qui tourne sous un Soleil fixe ; au sol, c'est le Soleil qui traverse le ciel.
  const spin = dt * sun.speed * 2 * Math.PI / SOL;
  sun.lon = wrap180(sun.lon - spin / DEG);
  const follow = smooth(400, 3000, view.dist);
  if (follow > 0 && spin) {
    qTmp.setFromAxisAngle(AY, -spin * follow);
    view.q.premultiply(qTmp); view.qGoal.premultiply(qTmp);
  }
  flyByKeys(dt);
  if (view.vel.lengthSq() > 1e-12) {
    pan(view.vel.x * dt, view.vel.y * dt);
    view.vel.multiplyScalar(Math.exp(-dt * 4));
  }
  const k = 1 - Math.exp(-dt * view.rate);
  view.q.slerp(view.qGoal, k);
  view.dist = Math.exp(Math.log(view.dist) + (Math.log(view.distGoal) - Math.log(view.dist)) * k);
  view.tilt += (view.tiltGoal - view.tilt) * k;
  view.rP += (view.rPGoal - view.rP) * k;

  vUp.copy(AY).applyQuaternion(view.q); vFwd.set(0, 0, -1).applyQuaternion(view.q);
  view.lat = latOf(vUp); view.lon = lonOf(vUp);
  const ex = shared.uEx.value;
  vT.copy(vUp).multiplyScalar(view.rP);
  const t = clamp(autoTilt(view.dist) + view.tilt, 0, LOOK_MAX), ct = Math.cos(t), st = Math.sin(t);
  view.tiltNow = t;
  camera.position.copy(vT).addScaledVector(vUp, view.dist * ct).addScaledVector(vFwd, -view.dist * st);
  camLat = latOf(camera.position); camLon = lonOf(camera.position);
  const ground = R + ex * surfaceAt(camLat, camLon), lift = ground + CLEAR - camera.position.length();
  if (lift > 0) {                    // un relief sur la route : on monte juste ce qu'il faut, et on reste à cette altitude
    camera.position.setLength(ground + CLEAR);
    view.rP += lift; view.rPGoal += lift; vT.addScaledVector(vUp, lift);
  }
  camDist = camera.position.length(); camAgl = camDist - ground;
  camera.up.copy(vFwd).multiplyScalar(ct).addScaledVector(vUp, st);
  camera.lookAt(vT);
  camera.near = clamp(Math.min(camAgl * 0.12, Math.max(camera.position.distanceTo(city.stationCenter) - STATION_R - 10, 1) * 0.5), 0.02, 3000);
  camera.far = camDist + R * 1.2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  if (camAgl < 2500) { const [tx, ty] = hiKey(camLat, camLon); loadHi(tx, ty).catch(() => {}); }
  if (view.dist < 2500) { const [tx, ty] = hiKey(view.lat, view.lon); loadHi(tx, ty).catch(() => {}); }

  const dec = Math.asin(Math.sin(TILT) * Math.sin(sun.ls * DEG)) / DEG;
  dirOf(dec, sun.lon, shared.uSun.value);
  shared.uCam.value.copy(camera.position);
  shared.uHs.value = 11 * (0.5 + 0.5 * ex);
  const mid = Math.sqrt(camera.near * camera.far);
  skyRoot.position.copy(camera.position); skyRoot.scale.setScalar(mid); skyRoot.rotation.y = sun.lon * DEG;
  sunMesh.position.copy(camera.position).addScaledVector(shared.uSun.value, mid);
  sunMesh.quaternion.copy(camera.quaternion); sunMesh.scale.setScalar(mid * 0.42);
  const day = smooth(-0.12, 0.1, camera.position.dot(shared.uSun.value) / camDist);
  stars.material.uniforms.uFade.value = 1 - day * (1 - smooth(2 * shared.uHs.value, 7 * shared.uHs.value, camDist - R));
  airMesh.scale.setScalar((R + 7 * shared.uHs.value) * 1.004);
}

/* ───────────── Gestes ─────────────
   Glisser : se déplacer. Clic droit, Ctrl ou deux doigts : tourner autour du point visé.
   Maj + glisser, ou le mode « Regarder » : tourner la caméra sur place. Molette, pincement : avancer vers le point visé. */

const pointers = new Map();
let pinch = null, lastTap = 0, tapX = 0, tapY = 0, moved = 0, lastMoveT = 0, lastWheel = 0;
const cssFocal = () => focalPx / renderer.getPixelRatio();
const panScale = () => Math.min(view.dist / (view.rP * cssFocal()), 0.008);
const tmp2 = new THREE.Vector2();
function dragPan(dx, dy, now) {
  const s = panScale(), r = -dx * s, f = dy * s / Math.max(Math.abs(Math.cos(view.tiltNow)), 0.35);
  pan(r, f);
  const dtm = Math.max((now - lastMoveT) / 1000, 0.004);
  view.vel.lerp(tmp2.set(r / dtm, f / dtm), 0.5);
  lastMoveT = now;
}
function orbit(dHeading, dTilt) {
  if (!view.onGround) { lookAround(-dHeading, dTilt); return; }
  view.qGoal.multiply(qTmp.setFromAxisAngle(AY, dHeading)).normalize();
  const base = autoTilt(view.distGoal);
  view.tiltGoal = clamp(view.tiltGoal + dTilt, -base, ORBIT_MAX - base);
}
function rayAt(cx, cy, out) {
  const r = canvas.getBoundingClientRect();
  return out.set((cx - r.left) / r.width * 2 - 1, 1 - (cy - r.top) / r.height * 2, 0.5).unproject(camera).sub(camera.position).normalize();
}
function goTo(cx, cy) {
  const d = rayAt(cx, cy, aD).clone(), t = castTerrain(camera.position, d);
  if (t === null) return;
  const p = d.multiplyScalar(t).add(camera.position);
  flyTo(latOf(p), lonOf(p), Math.max(t * 0.35, 6), true);
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const mode = e.button === 2 || e.button === 1 || e.ctrlKey ? 'orbit' : e.shiftKey || view.look ? 'look' : 'pan';
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, mode });
  canvas.classList.add('drag'); canvas.focus({ preventScroll: true });
  anchor();
  moved = 0; lastMoveT = performance.now(); pinch = null;
  userMoved();
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 1) {
    if (p.mode === 'orbit') orbit(dx * 0.005, -dy * 0.005);
    else if (p.mode === 'look') lookAround(-dx / cssFocal(), -dy / cssFocal());
    else dragPan(dx, dy, performance.now());
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
    if (pinch) {
      view.distGoal = clamp(view.distGoal * pinch.d / Math.max(d, 1), MIN_DIST, MAX_DIST);
      let da = ang - pinch.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      orbit(da, -(my - pinch.my) * 0.006);
    }
    pinch = { d, ang, my };
  }
});
function pointerEnd(e) {
  if (!pointers.delete(e.pointerId)) return;
  pinch = null;
  if (!pointers.size) canvas.classList.remove('drag');
  const now = performance.now();
  if (now - lastMoveT > 80) view.vel.set(0, 0);
  if (e.type === 'pointerup' && moved < 8 && !pointers.size) {
    const r = canvas.getBoundingClientRect(), l = labelAt(e.clientX - r.left, e.clientY - r.top);
    if (l) { l.go(); lastTap = 0; return; }
  }
  if (e.type === 'pointerup' && e.pointerType !== 'mouse' && moved < 12 && !pointers.size) {
    if (now - lastTap < 320 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 30) { goTo(e.clientX, e.clientY); lastTap = 0; }
    else { lastTap = now; tapX = e.clientX; tapY = e.clientY; }
  }
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('dblclick', e => goTo(e.clientX, e.clientY));
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const now = performance.now();
  if (now - lastWheel > 400) anchor();
  lastWheel = now;
  const d = e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (e.ctrlKey ? 4 : 1);
  view.distGoal = clamp(view.distGoal * Math.exp(clamp(d, -300, 300) * 0.0014), MIN_DIST, MAX_DIST);
  userMoved();
}, { passive: false });
const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'Space', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight']);
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement && e.code === 'Space' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (FLY_KEYS.has(e.code)) {
    if (!keys.has(e.code) && !e.code.startsWith('Shift') && !e.code.startsWith('Arrow') && !keys.size) anchor();
    keys.add(e.code); e.preventDefault();
  } else if (e.key === '+' || e.key === '=') { view.distGoal = Math.max(MIN_DIST, view.distGoal * 0.8); userMoved(); }
  else if (e.key === '-') { view.distGoal = Math.min(MAX_DIST, view.distGoal * 1.25); userMoved(); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

/* ───────────── La ville ───────────── */

const city = createCity(THREE, { shared, ATMO, R, dirOf });
scene.add(city.group);
// L'ascenseur et sa station montent bien au-delà du plan lointain de la caméra : ils ont leur propre scène, dessinée en deux passes.
const spaceScene = new THREE.Scene();
spaceScene.add(city.space);
const STATION_R = 70;

/* ───────────── Noms de lieux ───────────── */

// [nom, latitude, longitude est, distance d'apparition en km, site d'atterrissage ?]
const PLACES = [
  ['Olympus Mons', 18.65, -133.8, 1e6], ['Valles Marineris', -13.9, -59.2, 1e6], ['Hellas Planitia', -42.4, 70.5, 1e6],
  ['Tharsis', 1, -105, 1e6], ['Elysium Mons', 25.02, 147.21, 1e6], ['Syrtis Major', 8.4, 69.5, 1e6],
  ['Planum Boreum', 87, 0, 1e6], ['Planum Australe', -84, 160, 1e6], ['Utopia Planitia', 46.7, 117.5, 1e6],
  ['Argyre Planitia', -49.7, -44, 1e6], ['Arabia Terra', 21.3, 5.7, 1e6], ['Acidalia Planitia', 49.8, -20.7, 1e6],
  ['Ascraeus Mons', 11.92, -104.08, 9000], ['Pavonis Mons', 1.48, -112.96, 9000], ['Arsia Mons', -8.35, -120.09, 9000],
  ['Alba Mons', 40.47, -109.6, 9000], ['Isidis Planitia', 12.9, 87, 9000], ['Chryse Planitia', 28.4, -40, 9000],
  ['Noctis Labyrinthus', -6.36, -98.9, 6000], ['Kasei Valles', 24.6, -65, 6000], ['Schiaparelli', -2.71, 16.77, 6000],
  ['Huygens', -13.88, 55.58, 6000], ['Korolev', 72.77, 164.58, 6000], ['Elysium Planitia', 3, 154.7, 9000],
  ['Meridiani Planum', -0.2, -2.5, 9000], ['Amazonis Planitia', 24.8, -164, 9000], ['Terra Sirenum', -39.7, -150, 9000],
  ['Noachis Terra', -45, 10, 9000], ['Terra Cimmeria', -34.7, 145, 9000], ['Coprates Chasma', -13.2, -61.4, 2500],
  ['Hecates Tholus', 32.12, 150.24, 4000], ['Tyrrhenus Mons', -21.36, 105.88, 5000], ['Lyot', 50.8, 29.3, 5000],
  ['Gale · Curiosity', -4.59, 137.44, 7000, 1], ['Jezero · Perseverance', 18.44, 77.45, 7000, 1],
  ['Viking 1', 22.27, -47.95, 5000, 1], ['Viking 2', 47.64, 134.29, 5000, 1], ['InSight', 4.5, 135.62, 3000, 1],
  ['Opportunity', -1.95, -5.53, 5000, 1], ['Gusev · Spirit', -14.57, 175.47, 5000, 1], ['Zhurong', 25.07, 109.93, 5000, 1],
  ['Phoenix', 68.22, -125.75, 5000, 1], ['Pathfinder', 19.13, -33.22, 4000, 1],
];
const labelBox = $('labels');
const labels = [...PLACES, ...city.places].map(([name, lat, lon, far, site, alt = 0]) => {
  const el = document.createElement('button');
  el.className = 'lb' + (site === 2 ? ' city' : site ? ' site' : ''); el.textContent = name;
  const go = alt ? () => {             // la station : on s'y rend à sa hauteur, vue de côté
    const c = city.stationCenter;
    flyTo(latOf(c), lonOf(c), 300);
    view.rPGoal = c.length(); view.tiltGoal = 75 * DEG - autoTilt(300);
  } : () => flyTo(lat, lon, Math.min(view.distGoal, site === 2 ? (far > 1e5 ? 70 : 14) : site ? 250 : 900));
  el.addEventListener('click', go);
  labelBox.appendChild(el);
  const w = el.offsetWidth;
  el.style.display = 'none';
  return { el, lat, lon, far, go, alt, dir: dirOf(lat, lon), on: false, x: 0, y: 0, w, top: site === 2 };
});
let namesOn = true;
// Ordre de priorité : la ville d'abord, puis l'ordre de la liste. Un nom qui en chevaucherait un autre s'efface.
const byRank = [...labels.filter(l => l.top), ...labels.filter(l => !l.top)];
// Les noms ne captent pas la souris (ils gêneraient les glissers) : un clic bref sur le canevas cherche le nom dessous.
function labelAt(x, y) {
  return byRank.find(l => l.on && x > l.x - 10 && x < l.x + l.w + 4 && Math.abs(y - l.y) < 15) || null;
}
const placed = [];
function updateLabels(w, h) {
  const ex = shared.uEx.value;
  placed.length = 0;
  for (const l of byRank) {
    let on = namesOn && view.dist < l.far;
    if (on) {
      if (l.alt) {                       // en orbite : caché seulement si la planète est entre nous
        tmpV.copy(city.stationCenter); tmpV2.copy(tmpV).sub(camera.position);
        const t = clamp(-camera.position.dot(tmpV2) / tmpV2.lengthSq(), 0, 1);
        on = tmpV2.multiplyScalar(t).add(camera.position).length() > R;
      } else {
        tmpV.copy(l.dir).multiplyScalar(R + ex * sampleLow(l.lat, l.lon));
        on = tmpV.dot(tmpV2.copy(camera.position).sub(tmpV)) > 0;       // devant l'horizon
      }
      if (on) {
        tmpV.project(camera);
        on = tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05;
      }
      if (on) {
        const x = (tmpV.x + 1) / 2 * w, y = (1 - tmpV.y) / 2 * h;
        on = !placed.some(o => x < o.x + o.w + 6 && x + l.w + 6 > o.x && Math.abs(y - o.y) < 20);
        if (on) { l.x = x; l.y = y; placed.push(l); l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translateY(-50%)`; }
      }
    }
    if (on !== l.on) { l.on = on; l.el.style.display = on ? '' : 'none'; }
  }
}

/* ───────────── Réglages et mesures ───────────── */

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }), nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtKm = v => (Math.abs(v) < 100 ? nf1.format(v) : nf.format(v)) + ' km';
const fmtPos = (lat, lon) => `${nf1.format(Math.abs(lat))}° ${lat >= 0 ? 'N' : 'S'}, ${nf1.format(Math.abs(lon))}° ${lon >= 0 ? 'E' : 'O'}`;
const localHour = () => ((12 + wrap180(view.lon - sun.lon) / 15) % 24 + 24) % 24;
const fmtHour = h => `${Math.floor(h)} h ${String(Math.floor(h % 1 * 60)).padStart(2, '0')}`;
const SEASONS = ['printemps au nord', 'été au nord', 'automne au nord', 'hiver au nord'];
const SPEEDS = [[0, 'Rotation arrêtée'], [1, 'Rotation réelle'], [300, 'Rotation ×300'], [3000, 'Rotation ×3000']];

const sEx = $('sEx'), sSun = $('sSun'), sLs = $('sLs');
function syncPanel() {
  $('vEx').textContent = '×' + nf1.format(shared.uEx.value).replace(',0', '');
  $('vLs').textContent = SEASONS[Math.floor(sun.ls / 90) % 4];
  $('bSpeed').textContent = SPEEDS.find(s => s[0] === sun.speed)[1];
}
sEx.addEventListener('input', () => { shared.uEx.value = +sEx.value; syncPanel(); });
sLs.addEventListener('input', () => { sun.ls = +sLs.value; syncPanel(); });
// Terraformation. Niveaux de la mer : les deux rivages anciens proposés pour l'océan boréal de Mars
// (Deuteronilus, vers -3,76 km, puis Arabia, vers -2,09 km ; Carr et Head, 2003).
const STAGES = [
  [0.001, 'Mars aujourd’hui'], [0.2, 'Réchauffement : l’air s’épaissit'], [0.4, 'Dégel : mers d’Hellas et du nord'],
  [0.6, 'Océan boréal, lichens et toundra'], [0.85, 'Fleuves, prairies, premières forêts'], [2, 'Mars bleue'],
];
function setTerra(t) {
  shared.uTerra.value = t;
  shared.uWet.value = smooth(0.2, 1, t);
  shared.uSea.value = t < 0.2 ? -20 : t < 0.6 ? -8.3 + (-3.76 + 8.3) * smooth(0.2, 0.6, t) : -3.76 + (-2.09 + 3.76) * (t - 0.6) / 0.4;
  if (t > 0) loadWater();
  $('vTerra').textContent = STAGES.find(s => t < s[0])[1];
}
const sTerra = $('sTerra');
sTerra.addEventListener('input', () => setTerra(+sTerra.value / 100));
setTerra(0);
let sunDrag = false;
sSun.addEventListener('input', () => { sun.lon = wrap180(view.lon - (+sSun.value - 12) * 15); });
sSun.addEventListener('pointerdown', () => { sunDrag = true; });
addEventListener('pointerup', () => { sunDrag = false; });
$('bSpeed').addEventListener('click', () => { sun.speed = SPEEDS[(SPEEDS.findIndex(s => s[0] === sun.speed) + 1) % SPEEDS.length][0]; syncPanel(); });
$('bNames').addEventListener('click', e => { namesOn = !namesOn; e.currentTarget.setAttribute('aria-pressed', namesOn); });
$('bGlobe').addEventListener('click', () => { anchor(); view.tiltGoal = 0; flyTo(view.lat, view.lon, HOME.dist); });
$('bNorth').addEventListener('click', () => { anchor(); flyTo(view.lat, view.lon, 0); view.tiltGoal = view.onGround ? 0 : view.tiltGoal; });
$('bCity').addEventListener('click', () => { view.tiltGoal = 0; flyTo(SITE.lat, SITE.lon, 70, false, 0.5); });
$('bLook').addEventListener('click', e => { view.look = !view.look; e.currentTarget.setAttribute('aria-pressed', view.look); });
const panel = $('panel'), bPanel = $('bPanel');
function setPanel(open) { panel.hidden = !open; bPanel.setAttribute('aria-expanded', open); }
bPanel.addEventListener('click', () => setPanel(panel.hidden));
setPanel(innerWidth > 720);

let hudT = 0;
function updateHud(now) {
  if (now - hudT < 150) return;
  hudT = now;
  $('hAlt').textContent = fmtKm(camDist - R);
  $('hAgl').textContent = fmtKm(camAgl);
  $('hPos').textContent = fmtPos(camLat, camLon);
  const lh = localHour();
  $('hTime').textContent = $('vSun').textContent = fmtHour(lh);
  if (!sunDrag) sSun.value = lh;
}

/* ───────────── Boucle ───────────── */

let cssW = 0, cssH = 0;
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  if (w === cssW && h === cssH && dpr === renderer.getPixelRatio()) return;
  cssW = w; cssH = h;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 55 : 45;
  focalPx = h * dpr / (2 * Math.tan(camera.fov * DEG / 2));
  shared.uPix.value = 1 / focalPx;
  stars.material.uniforms.uDpr.value = dpr;
}
let lastT = 0, running = false;
const stats = { tiles: 0, fps: 0 };
function tick(now) {
  if (!running) return;
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastT) / 1000, 0.1) || 0.016; lastT = now; frame++;
  resize();
  updateCamera(dt);
  shared.uTime.value = now / 1000;
  selectTiles();
  city.update(now / 1000, camera, shared.uEx.value, focalPx, renderer.getPixelRatio());
  renderer.clear();
  renderer.render(sky, camera);
  // Passe lointaine : ce qui dépasse le plan lointain (le câble, la station). La planète, dessinée ensuite, les recouvre s'ils sont derrière elle.
  const near = camera.near, far = camera.far;
  camera.near = far * 0.98; camera.far = 1e6; camera.updateProjectionMatrix();
  renderer.clearDepth();
  renderer.render(spaceScene, camera);
  camera.near = near; camera.far = far; camera.updateProjectionMatrix();
  renderer.clearDepth();
  renderer.render(scene, camera);
  renderer.render(spaceScene, camera);
  updateLabels(cssW, cssH);
  updateHud(now);
  stats.tiles = shown.length; stats.fps += (1 / dt - stats.fps) * 0.05;
}

async function start() {
  const bar = document.querySelector('#bar i');
  let done = 0; const step = () => { bar.style.width = (++done / 4 * 100) + '%'; };
  const lowP = loadBitmap(DATA + 'h/low.png').then(bmp => {
    const px = pixelsOf(bmp); low = new Float32Array(1441 * 721);
    for (let i = 0; i < low.length; i++) low[i] = (px[i * 4] * 256 + px[i * 4 + 1] - 10000) / 1000;
    step();
  });
  const idxP = fetch(DATA + 'h/index.json').then(r => r.json()).then(j => { hiRanges = j; step(); });
  await Promise.all([lowP, idxP]);
  for (const r of roots) r.request();
  await Promise.all(roots.map(r => Promise.all(r.res.map(e => e.promise)).then(step)));
  while (buildQueue.length) buildQueue.shift().build();
  if (roots.some(r => r.state !== READY)) throw new Error('tuiles de base manquantes');
  syncPanel();
  running = true; lastT = performance.now();
  requestAnimationFrame(tick);
  $('load').classList.add('done');
}
start().catch(err => {
  console.error(err);
  $('loadMsg').textContent = 'Impossible de charger Mars. Vérifie la connexion puis recharge la page.';
});
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); $('loadMsg').textContent = 'L’affichage 3D s’est interrompu. Recharge la page.'; $('load').classList.remove('done'); running = false; });

// Pour les tests et la console.
function probe() {                   // couleur au centre de l'image, juste après un rendu
  renderer.clear(); renderer.render(sky, camera); renderer.clearDepth(); renderer.render(scene, camera);
  const gl = renderer.getContext(), px = new Uint8Array(4);
  gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [...px];
}
window.mars = { probe, city, setTerra, SITE, anchor, lookAround, keys, get alt() { return camDist - R; }, levels: () => shown.reduce((a, n) => (a[n.l] = (a[n.l] || 0) + 1, a), {}), view, sun, stats, heightAt, sampleLow, flyTo, shared, camera, get agl() { return camAgl; }, get ready() { return running; } };
