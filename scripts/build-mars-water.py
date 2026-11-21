#!/usr/bin/env python3
"""Hydrologie de Mars terraformée : où couleraient les fleuves, où se formeraient les lacs.

Calculé une fois à partir du relief MOLA (megt90n000fb.img, voir build-mars.py), à 16 points/degré :
  1. « Priority-flood » (Barnes et al., 2014) : on inonde le relief depuis les points les plus bas
     (fonds du bassin boréal, d'Hellas, d'Argyre, de Valles Marineris). Chaque cellule reçoit son
     exutoire : la cellule par laquelle l'eau la quitte, y compris à travers les cuvettes fermées.
  2. Accumulation : chaque cellule envoie sa pluie vers son exutoire. Pas de pluie au-dessus de 6 km
     (l'air y reste trop mince) ni près des pôles. Les grandes valeurs dessinent les fleuves ;
     beaucoup suivent les vallées anciennes déjà creusées par l'eau.
  3. Lacs : chaque cuvette fermée (cratère, bassin) se remplit jusqu'à une profondeur limitée par sa
     taille, 0,4 % de son diamètre, sans dépasser son seuil de débordement.

Sorties, par hémisphère (W : -180..0, E : 0..180), en gris 8 bits, 2880 x 2880 :
  w/rivers_{W,E}.webp  log10 de l'aire drainée, de 10^3,3 à 10^7 km²
  w/lakes_{W,E}.webp   niveau du lac au-dessus du sol, rapporté à sa profondeur maximale

Usage : python3 scripts/build-mars-water.py megt90n000fb.img mars/data
"""
import os
import sys
import numpy as np
from numba import njit
from PIL import Image
from scipy import ndimage

R_KM = 3389.5
SINK = -4.8       # km : en dessous, la cellule est un point bas où l'eau s'arrête


@njit(cache=True)
def flood(h, seeds):
    rows, cols = h.shape
    n = rows * cols
    filled = np.full(n, np.inf, np.float32)
    parent = np.full(n, -1, np.int32)
    order = np.empty(n, np.int32)
    hk = np.empty(n, np.float32)      # tas binaire : clés
    hi = np.empty(n, np.int32)        # tas binaire : cellules
    size = 0
    flat = h.ravel()
    for s in seeds:
        filled[s] = flat[s]
        k = size
        size += 1
        while k > 0 and hk[(k - 1) // 2] > flat[s]:
            hk[k] = hk[(k - 1) // 2]; hi[k] = hi[(k - 1) // 2]; k = (k - 1) // 2
        hk[k] = flat[s]; hi[k] = s
    done = 0
    while size > 0:
        key = hk[0]; c = hi[0]
        size -= 1
        lk = hk[size]; li = hi[size]
        k = 0
        while True:
            a = 2 * k + 1
            if a >= size:
                break
            if a + 1 < size and hk[a + 1] < hk[a]:
                a += 1
            if hk[a] >= lk:
                break
            hk[k] = hk[a]; hi[k] = hi[a]; k = a
        hk[k] = lk; hi[k] = li
        order[done] = c
        done += 1
        r = c // cols; q = c % cols
        for dr in range(-1, 2):
            rr = r + dr
            if rr < 0 or rr >= rows:
                continue
            for dq in range(-1, 2):
                if dr == 0 and dq == 0:
                    continue
                m = rr * cols + (q + dq) % cols
                if filled[m] != np.inf:
                    continue
                v = max(flat[m], key)
                filled[m] = v
                parent[m] = c
                k = size
                size += 1
                while k > 0 and hk[(k - 1) // 2] > v:
                    hk[k] = hk[(k - 1) // 2]; hi[k] = hi[(k - 1) // 2]; k = (k - 1) // 2
                hk[k] = v; hi[k] = m
    return filled.reshape(rows, cols), parent, order


@njit(cache=True)
def accumulate(weight, parent, order):
    acc = weight.copy()
    for i in range(order.size - 1, -1, -1):
        c = order[i]
        p = parent[c]
        if p >= 0:
            acc[p] += acc[c]
    return acc


def main():
    mola, out = sys.argv[1:3]
    os.makedirs(os.path.join(out, 'w'), exist_ok=True)
    h = np.fromfile(mola, dtype='>i2').reshape(5760, 11520).astype(np.float32)
    h = np.roll(h, 5760, axis=1)
    h = (h[0::2, 0::2] + h[0::2, 1::2] + h[1::2, 0::2] + h[1::2, 1::2]) / 4000.0     # 16 px/degré, en km
    rows, cols = h.shape
    lat = (90 - (np.arange(rows) + 0.5) / 16)[:, None]
    cell = (R_KM * np.pi / 180 / 16) ** 2 * np.cos(np.radians(lat)) * np.ones((1, cols))

    seeds = np.flatnonzero(h.ravel() < SINK).astype(np.int32)
    filled, parent, order = flood(h, seeds)
    print('inondation faite ;', len(seeds), 'points bas')

    rain = np.clip((6.0 - h) / 4.0, 0, 1) * (np.abs(lat) < 78)
    acc = accumulate((cell * rain).astype(np.float64).ravel(), parent, order).reshape(rows, cols)
    river = np.clip((np.log10(np.maximum(acc, 1)) - 3.3) / (7.0 - 3.3), 0, 1)
    river = np.maximum(river, 0.7 * ndimage.maximum_filter(river, size=3, mode='wrap'))    # un peu de largeur
    print('fleuves : aire drainée maximale %.2e km²' % acc.max())

    depth = filled - h
    labels, count = ndimage.label(depth > 0.01)
    idx = np.arange(1, count + 1)
    area = ndimage.sum(cell, labels, idx)
    bottom = ndimage.minimum(h, labels, idx)
    spill = ndimage.maximum(filled, labels, idx)
    dmax = np.clip(np.minimum(spill - bottom, 0.004 * 2 * np.sqrt(area / np.pi)), 0.03, None)
    level = np.concatenate([[0], bottom + dmax])[labels]
    dm = np.concatenate([[1], dmax])[labels]
    lake = np.where(labels > 0, np.clip((level - h) / dm, 0, 1), 0)
    print('lacs :', count, 'cuvettes, la plus grande %.0f km de large' % (2 * np.sqrt(area.max() / np.pi)))

    for name, a in (('rivers', river), ('lakes', lake)):
        img = np.round(a * 255).astype(np.uint8)
        for side, half in (('W', img[:, :cols // 2]), ('E', img[:, cols // 2:])):
            Image.fromarray(half).save('%s/w/%s_%s.webp' % (out, name, side), 'WEBP', quality=80, method=6)


if __name__ == '__main__':
    main()
