"""Draw img/rain-sheet-site.jpg: the LiDAR elevation map of the rain sheet site.

Needs numpy and matplotlib. Reads data/site_lidar.npz (an extract of IGN LiDAR HD,
flown 11 April 2022: bare-earth ground height, vegetation height and
a building mask on a 0.5 m grid) and data/sheet_layout.json (where the sheet sits and which way
the slope faces). To change the sheet, edit "along" and "down" in the JSON: the bottom edge stays
on the same contour, so when changing "down", move "c" downhill by half the change, along
(ux, uy). Labels below are written for the current design; update them to match.

    python scripts/site_map.py

Local coordinates throughout are metres on a site-local grid.
"""
import json
import os

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from mpl_toolkits.axes_grid1 import make_axes_locatable

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = np.load(os.path.join(ROOT, 'data', 'site_lidar.npz'))
res = float(L['res'])
gx0 = float(L['x0'])                   # local x of the extract's west edge
gyt = float(L['y_top'])                # local y of its north edge
ground, veg, bld = L['ground'].astype(float), L['vegetation'].astype(float), L['buildings']

# Map window, local metres.
x0, x1, y0, y1 = 1148, 1238, 478, 568
j0, j1 = int((x0 - gx0) / res), int((x1 - gx0) / res)
i0, i1 = int((gyt - y1) / res), int((gyt - y0) / res)
z, h, B = ground[i0:i1, j0:j1], veg[i0:i1, j0:j1], bld[i0:i1, j0:j1]
tx, ty = 1195.0, 542.0  # main tanks: southern corner of the north-east building

gy, gx = np.gradient(z, res)
s = np.arctan(np.hypot(gx, gy))
a = np.arctan2(-gx, gy)
H = np.sin(np.radians(40)) * np.cos(s) + np.cos(np.radians(40)) * np.sin(s) * np.cos(np.radians(315) - a)
ext = [x0, x1, y0, y1]
plt.rcParams['font.family'] = 'DejaVu Sans'
plt.rcParams['hatch.linewidth'] = 0.6
plt.rcParams['hatch.color'] = '#2a5a2a'
fig, ax = plt.subplots(figsize=(10, 9.2), dpi=120)
im = ax.imshow(z, cmap='terrain', extent=ext, vmin=222, vmax=244)
ax.imshow(H, cmap='gray', extent=ext, alpha=0.35, vmin=0.2, vmax=1.0)
X = x0 + (np.arange(j1 - j0) + 0.5) * res
Y = y1 - (np.arange(i1 - i0) + 0.5) * res
ax.contour(X, Y, z, levels=np.arange(215, 250, 0.5), colors='k', linewidths=0.2, alpha=0.5)
ax.contour(X, Y, z, levels=np.arange(215, 250, 1), colors='k', linewidths=0.45)
cs = ax.contour(X, Y, z, levels=np.arange(215, 250, 5), colors='k', linewidths=1.1)
ax.clabel(cs, fmt='%d m', fontsize=10, inline_spacing=2)
trees = (h > 5) & ~B
ax.contourf(X, Y, trees.astype(float), levels=[0.5, 1.5], colors='none', hatches=['///'], zorder=3)
ax.contour(X, Y, trees.astype(float), levels=[0.5], colors='#1d4d1d', linewidths=0.8, zorder=3)
ax.imshow(np.ma.masked_where(~B, B), cmap=matplotlib.colors.ListedColormap(['#6b6b6b']), alpha=0.9, extent=ext)

S = json.load(open(os.path.join(ROOT, 'data', 'sheet_layout.json')))
cx, cy = S['c']
ux, uy = S['ux'], S['uy']          # downhill
axv, ayv = uy, -ux                 # along the contour
A, D = S['along'], S['down']


def P(u, v):
    return (cx + u * axv + v * ux, cy + u * ayv + v * uy)


poly = [P(-A / 2, -D / 2), P(A / 2, -D / 2), P(A / 2, D / 2), P(-A / 2, D / 2)]
ax.add_patch(Polygon(poly, closed=True, facecolor='#123e7a', alpha=0.55, edgecolor='#081f40', linewidth=2.4, zorder=5))
b0, b1 = P(-A / 2 - 0.8, D / 2 + 0.6), P(A / 2 + 0.8, D / 2 + 0.6)
ax.plot([b0[0], b1[0]], [b0[1], b1[1]], color='#d62728', linewidth=3.2, zorder=6)
ax.annotate('', xy=P(A / 2 - 1, D / 2 + 2.2), xytext=P(-A / 2 + 3, D / 2 + 2.2),
            arrowprops=dict(arrowstyle='-|>', color='#d62728', lw=1.6), zorder=6)
out = b1
us = np.linspace(-A / 2 - 3, A / 2 + 3, 40)
pts = [P(u, -D / 2 - 2.5 + 3.0 * (u / (A / 2 + 3)) ** 2) for u in us]
ax.plot([p[0] for p in pts], [p[1] for p in pts], color='#7a3e00', linestyle=(0, (2, 2)), linewidth=2.2, zorder=5)
ax.plot([out[0], tx], [out[1], ty], color='#d62728', linewidth=2.6, linestyle=(0, (5, 3)), zorder=6)
ax.plot(out[0], out[1], 's', ms=10, mfc='white', mec='#d62728', mew=2.2, zorder=7)
ax.plot(tx, ty, 'o', ms=14, mfc='#4aa3df', mec='#081f40', mew=2.2, zorder=7)

kw = dict(fontsize=16, zorder=8, bbox=dict(boxstyle='round,pad=0.3', fc='white', ec='none', alpha=0.9))
arrow = lambda c: dict(arrowstyle='->', color=c, lw=1.4)
ax.annotate(f'Step 2 rain sheet, if needed:\n{A:g} × {D:g} m ({A * D:.0f} m²), 10° slope', P(-A / 4, -1), (1150, 481),
            arrowprops=arrow('#081f40'), color='#081f40', weight='bold', **kw)
ax.annotate('Trench on the contour,\nfalling 1% to the outlet', P(A / 2 - 8, D / 2 + 0.6), (1200, 501),
            arrowprops=arrow('#d62728'), color='#a01818', **kw)
ax.annotate('Outlet', out, (1165, 530), arrowprops=arrow('#d62728'), color='#a01818', **kw)
ax.annotate('Pipe about 25 m,\nfalling about 2 m', ((out[0] + tx) / 2, (out[1] + ty) / 2), (1205, 521),
            arrowprops=arrow('#d62728'), color='#a01818', **kw)
ax.annotate('Main tanks', (tx, ty), (1208, 552), arrowprops=arrow('#081f40'), color='#081f40', **kw)
ax.annotate('Ditch round\nthe top edge', P(A / 2 + 1.5, -D / 2 - 2.0), (1212, 486),
            arrowprops=arrow('#7a3e00'), color='#7a3e00', **kw)
ax.plot([1222, 1232], [481, 481], color='k', lw=4, solid_capstyle='butt', zorder=9)
ax.text(1227, 482.5, '10 m', ha='center', fontsize=14, zorder=9)
ax.text(1150, 562, 'Hatched: trees over 5 m', color='#1d4d1d', **kw)
ax.annotate('', xy=(1233, 565), xytext=(1233, 557), arrowprops=dict(arrowstyle='-|>', color='k', lw=2), zorder=9)
ax.text(1233, 566, 'N', ha='center', fontsize=13, weight='bold', zorder=9)
ax.set_xlim(x0, x1)
ax.set_ylim(y0, y1)
ax.set_xticks([])
ax.set_yticks([])
cax = make_axes_locatable(ax).append_axes('right', size='3%', pad=0.12)
cb = fig.colorbar(im, cax=cax, ticks=range(222, 245, 2))
cb.set_label('Ground height above sea level (m)', fontsize=14)
cb.ax.tick_params(labelsize=13)
fig.savefig(os.path.join(ROOT, 'img', 'rain-sheet-site.jpg'), dpi=135, bbox_inches='tight', pad_inches=0.05,
            pil_kwargs={'quality': 86, 'optimize': True})
print('written img/rain-sheet-site.jpg; outlet', out, 'pipe length %.1f m' % np.hypot(out[0] - tx, out[1] - ty))
