#!/usr/bin/env python3
"""Fabrique les tuiles de mars/data à partir des données sources.

Sources (à télécharger à part, elles ne sont pas dans le dépôt) :
  - megt90n000fb.img : altimétrie MOLA MEGDR 32 px/degré (NASA PDS, domaine public),
    11520 x 5760 entiers 16 bits gros-boutistes, en mètres au-dessus de l'aréoïde, longitude 0-360 E.
  - 8k_mars.jpg : carte couleur 8192 x 4096 (Solar System Scope, CC BY 4.0), centrée sur la longitude 0.

Usage : python3 scripts/build-mars.py megt90n000fb.img 8k_mars.jpg mars/data

Pyramide : niveau L = 2^(L+1) x 2^L tuiles, chacune de 180/2^L degrés.
  c/L/x_y.webp  couleur, niveaux 0-3, 512 px utiles + marge de 4 px
  n/L/x_y.webp  pentes pour l'éclairage, niveaux 0-4, deux panneaux gris côte à côte
                (pente est, pente nord), 360 px utiles + marge de 4 px chacun
  h/low.png     altitudes exactes du globe entier, 4 points/degré (1441 x 721 nœuds) :
                (mètres + 10000) sur 16 bits, octet fort dans le rouge, octet faible dans le vert
  h/x_y.webp    altitudes des cases de niveau 3 à la résolution native (720 px + marge de 1 px),
                en gris 8 bits étalé entre le minimum et le maximum de la case
  h/index.json  ces minimums et maximums, en mètres : [min, max] par case, rangés par y puis x
"""
import json
import os
import sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
R_M = 3389500.0
G = 4            # marge autour de chaque tuile, pour le filtrage
CPX, NPX = 512, 360
CMAX, NMAX = 3, 4
H_OFFSET = 10000


def box2(a):
    return (a[0::2, 0::2] + a[0::2, 1::2] + a[1::2, 0::2] + a[1::2, 1::2]) * 0.25


def pad_globe(a, g):
    """Marge : la longitude boucle, les pôles se prolongent."""
    a = np.concatenate([a[:, -g:], a, a[:, :g]], axis=1)
    return np.concatenate([np.repeat(a[:1], g, 0), a, np.repeat(a[-1:], g, 0)], axis=0)


def enc_slope(s):
    """Pente (m/m) -> 0..255, en puissance 0,7 pour garder la précision des faibles pentes."""
    e = np.sign(s) * np.minimum(np.abs(s), 1.0) ** 0.7
    return np.clip(np.round(127.5 + 127.0 * e), 0, 255).astype(np.uint8)


def relief_layers(h):
    """h : altitudes (m), grille équirectangulaire. Renvoie pente est et pente nord (uint8)."""
    rows, cols = h.shape
    step = np.pi / rows
    lat = (np.pi / 2 - (np.arange(rows) + 0.5) * step)[:, None]
    de = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * step * R_M * np.maximum(np.cos(lat), 0.02))
    hp = np.concatenate([h[:1], h, h[-1:]], axis=0)
    dn = (hp[:-2] - hp[2:]) / (2 * step * R_M)
    return enc_slope(de), enc_slope(dn)


def save_webp(arr, path, q):
    Image.fromarray(arr).save(path, 'WEBP', quality=q, method=6)


def save_heights(nodes, path):
    v = np.clip(np.round(nodes + H_OFFSET), 0, 65535).astype(np.uint16)
    rgb = np.zeros(v.shape + (3,), np.uint8)
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 255
    Image.fromarray(rgb).save(path, 'PNG', optimize=True)


def nodes_from_cells(a):
    """Grille de nœuds (coins) deux fois moins dense que la grille de cellules a : filtre [1,3,3,1]/8."""
    p = pad_globe(a, 2)
    w = np.array([1, 3, 3, 1], np.float32) / 8
    rows, cols = a.shape
    out = np.zeros((rows // 2 + 1, cols // 2 + 1), np.float32)
    for i in range(4):
        for j in range(4):
            out += w[i] * w[j] * p[i:i + rows + 1:2, j:j + cols + 1:2]
    return out


def main():
    mola, color, out = sys.argv[1:4]
    for d in ['c/%d' % l for l in range(CMAX + 1)] + ['n/%d' % l for l in range(NMAX + 1)] + ['h']:
        os.makedirs(os.path.join(out, d), exist_ok=True)

    h = np.fromfile(mola, dtype='>i2').reshape(5760, 11520).astype(np.float32)
    h = np.roll(h, 5760, axis=1)          # 0-360 E -> -180..180
    print('altitudes', h.min(), h.max())

    # Altitudes : cases de niveau 3 à la résolution native, puis globe à 4/degré.
    hp = pad_globe(h, 1)
    ranges = []
    for y in range(8):
        for x in range(16):
            t = hp[y * 720:y * 720 + 722, x * 720:x * 720 + 722]
            lo, hi = float(np.floor(t.min())), float(np.ceil(t.max()))
            hi = max(hi, lo + 1)
            ranges.append([int(lo), int(hi)])
            save_webp(np.round((t - lo) / (hi - lo) * 255).astype(np.uint8), '%s/h/%d_%d.webp' % (out, x, y), 92)
    with open('%s/h/index.json' % out, 'w') as f:
        json.dump(ranges, f, separators=(',', ':'))
    low = nodes_from_cells(box2(box2(h)))  # 721 x 1441
    save_heights(low, '%s/h/low.png' % out)
    print('altitudes écrites')

    # Relief : du niveau le plus fin au plus grossier, en moyennant les altitudes.
    a = h
    for level in range(NMAX, -1, -1):
        layers = [pad_globe(l, G) for l in relief_layers(a)]
        t = NPX + 2 * G
        for y in range(2 ** level):
            for x in range(2 ** (level + 1)):
                tile = np.concatenate([l[y * NPX:y * NPX + t, x * NPX:x * NPX + t] for l in layers], axis=1)
                save_webp(tile, '%s/n/%d/%d_%d.webp' % (out, level, x, y), 72)
        print('relief niveau', level)
        a = box2(a)

    im = Image.open(color).convert('RGB')
    for level in range(CMAX, -1, -1):
        w = CPX * 2 ** (level + 1)
        c = np.asarray(im if im.width == w else im.resize((w, w // 2), Image.LANCZOS))
        c = pad_globe(c, G)
        t = CPX + 2 * G
        for y in range(2 ** level):
            for x in range(2 ** (level + 1)):
                save_webp(c[y * CPX:y * CPX + t, x * CPX:x * CPX + t], '%s/c/%d/%d_%d.webp' % (out, level, x, y), 84)
        print('couleur niveau', level)


if __name__ == '__main__':
    main()
