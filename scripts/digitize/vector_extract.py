"""Оцифровка аэродинамических характеристик из ВЕКТОРНЫХ путей PDF каталога.

Подкоманды (см. README.md):
  inspect <pdf> <page> [x0 y0 x1 y1]   - показать жирные кривые, диагонали, линии сетки (пиксели 300 dpi)
  run <pdf> <spec.json> <data.json> --out-json OUT.json --out-dir DIR [--prefix 2.5]
"""
import argparse
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
import pymupdf
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

Z = 300 / 72  # pt -> px at 300 dpi
NPTS = 9  # точек на кривую для квадратичной аппроксимации


def bezier(p0, p1, p2, p3, n=60):
    t = np.linspace(0, 1, n)[:, None]
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def path_points(dr):
    """Список полилиний (в пикселях 300 dpi) для одного нарисованного пути."""
    out = []
    for it in dr['items']:
        if it[0] == 'c':
            P = [np.array([q.x * Z, q.y * Z]) for q in it[1:5]]
            out.append(bezier(*P))
        elif it[0] == 'l':
            out.append(np.array([[it[1].x * Z, it[1].y * Z], [it[2].x * Z, it[2].y * Z]]))
    return out


def in_box(rect, b):
    return b[0] <= rect.x0 * Z and rect.x1 * Z <= b[2] and b[1] <= rect.y0 * Z and rect.y1 * Z <= b[3]


def collect(page, frame):
    """Жирные кривые n=const и диагонали eta внутри рамки графика."""
    bold, diag = [], []
    for dr in page.get_drawings():
        if dr.get('type') != 's' or not in_box(dr['rect'], frame):
            continue
        w = dr['width']
        if w > 1.0:
            bold.append(np.vstack(path_points(dr)))
        elif not (dr['color'] is not None and dr['color'][2] > 0.5 and dr['color'][0] < 0.3):  # синие дуги Ny пропускаем
            for it in dr['items']:
                if it[0] == 'l':
                    ax, ay, bx, by = it[1].x * Z, it[1].y * Z, it[2].x * Z, it[2].y * Z
                    if abs(ax - bx) > 0.3 and abs(ay - by) > 0.3 and w < 1:
                        diag.append(((ax, ay), (bx, by)))
    return bold, diag


def seg_intersect(p1, p2, p3, p4):
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    x4, y4 = p4
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-12:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    return None


def polyline_cross(poly, a, b):
    out = []
    for i in range(len(poly) - 1):
        r = seg_intersect(poly[i], poly[i + 1], a, b)
        if r:
            out.append(r)
    return out


def cmd_inspect(args):
    """Помощник для составления spec: сетка, кривые, диагонали (координаты в px при 300 dpi)."""
    doc = pymupdf.open(args.pdf)
    page = doc[args.page]
    box = [float(v) for v in args.box] if args.box else [0, 0, 1e9, 1e9]
    H = defaultdict(lambda: [1e9, -1e9])
    V = defaultdict(lambda: [1e9, -1e9])
    for dr in page.get_drawings():
        if dr.get('type') != 's':
            continue
        r = dr['rect']
        if in_box(r, box) and dr['width'] > 1.0:
            print('bold curve  bbox px', [round(v * Z) for v in (r.x0, r.y0, r.x1, r.y1)], 'width', round(dr['width'], 2))
        for it in dr['items']:
            if it[0] != 'l' or dr['width'] > 0.7:
                continue
            ax, ay, bx, by = it[1].x * Z, it[1].y * Z, it[2].x * Z, it[2].y * Z
            if not (box[0] <= min(ax, bx) and max(ax, bx) <= box[2] and box[1] <= min(ay, by) and max(ay, by) <= box[3]):
                continue
            if abs(ay - by) < 0.05:
                k = round(ay, 1)
                H[k][0] = min(H[k][0], ax, bx)
                H[k][1] = max(H[k][1], ax, bx)
            elif abs(ax - bx) < 0.05:
                k = round(ax, 1)
                V[k][0] = min(V[k][0], ay, by)
                V[k][1] = max(V[k][1], ay, by)
            else:
                print('diagonal (eta) px', round(ax), round(ay), round(bx), round(by))
    print('horizontal grid lines  y: xmin-xmax  (подписанные линии выступают левее рамки)')
    print('; '.join(f'{k}:{v[0]:.0f}-{v[1]:.0f}' for k, v in sorted(H.items())))
    print('vertical grid lines  x: ymin-ymax  (подписанные линии выступают ниже рамки)')
    print('; '.join(f'{k}:{v[0]:.0f}-{v[1]:.0f}' for k, v in sorted(V.items())))


def cmd_run(args):
    spec = json.load(open(args.spec, encoding='utf8'))
    data = json.load(open(args.data, encoding='utf8'))
    doc = pymupdf.open(args.pdf)
    q_vals = spec['qValues']
    pdv_vals = spec['pdvValues']
    os.makedirs(args.out_dir, exist_ok=True)
    page_imgs = {}

    def page_img(i):
        if i not in page_imgs:
            page_imgs[i] = lib.render_page(args.pdf, i, 300)
        return page_imgs[i]

    for dia in data['diameters']:
        dv = dia['d']
        g = spec['graphs'][f'{dv:g}']
        bold, diag = collect(doc[g['page']], g['frame'])
        # нижняя (по картинке) кривая = меньшие обороты
        bold.sort(key=lambda b: -b[:, 1].mean())
        diag.sort(key=lambda s: max(s[0][0], s[1][0]))
        curves = sorted(dia['curves'], key=lambda c: c['rpmActual'])
        assert len(bold) == len(curves), f'D={dv}: жирных кривых {len(bold)}, ожидали {len(curves)}'
        assert len(diag) == len(g['eta']), f'D={dv}: диагоналей {len(diag)}, подписей eta {len(g["eta"])}'
        lo = min(c['pRangeExpected'][0] for c in curves)
        hi = max(c['pRangeExpected'][1] for c in curves)
        qc = lib.fit_log_axis(g['qx'], q_vals)
        sel = [(y, v) for y, v in g['py'] if lo / 1.8 <= v <= hi * 1.8]
        pc = lib.fit_log_axis([y for y, v in sel], [v for y, v in sel])
        qres = max(abs(qc['slope'] * math.log10(v) + qc['intercept'] - x) for x, v in zip(g['qx'], q_vals))
        pres = max(abs(pc['slope'] * math.log10(v) + pc['intercept'] - y) for y, v in sel)
        qs = [lib.value_at_pixel(x, qc) for x in g['pdvx']]
        C = math.exp(np.mean([math.log(pv / q ** 2) for pv, q in zip(pdv_vals, qs)]))
        cx0, cy0, cx1, cy1 = g['crop']
        dia['calibration'] = {
            'source': 'vector paths of PDF page %d (curves and grid), pixels in the cropped PNG at 300dpi' % (g['page'] + 1),
            'qAxis': {'slope': qc['slope'], 'intercept': qc['intercept'] - cx0, 'unit': 'thousand m3/h', 'pixelAxis': 'x',
                      'labeledValues': q_vals, 'maxResidualPx': round(qres, 2)},
            'pAxis': {'slope': pc['slope'], 'intercept': pc['intercept'] - cy0, 'unit': 'Pa (full pressure Pv)', 'pixelAxis': 'y',
                      'labeledValuesUsed': [v for y, v in sel], 'maxResidualPx': round(pres, 2)},
            'pdvAxis': {'coeffC': round(C, 3), 'formula': 'Pdv = coeffC * Q_thousand^2'},
            'cropBoxOnPage300dpi': [cx0, cy0, cx1, cy1],
            'imageWidth': cx1 - cx0, 'imageHeight': cy1 - cy0}

        def conv(pt):
            return lib.value_at_pixel(pt[0], qc), lib.value_at_pixel(pt[1], pc)

        for poly, curve in zip(bold, curves):
            seg = np.hypot(*np.diff(poly, axis=0).T)
            s = np.r_[0, np.cumsum(seg)]
            tt = np.linspace(0, s[-1], NPTS)
            pts = np.c_[np.interp(tt, s, poly[:, 0]), np.interp(tt, s, poly[:, 1])]
            QP = [conv(p) for p in pts]
            curve['coeffs'] = lib.fit_quadratic([a for a, b in QP], [b for a, b in QP])
            qa, qb = conv(poly[0]), conv(poly[-1])
            curve['qRangeGraph'] = [round(min(qa[0], qb[0]), 3), round(max(qa[0], qb[0]), 3)]
            curve['pRangeGraph'] = [round(min(qa[1], qb[1]), 1), round(max(qa[1], qb[1]), 1)]
            eta, pw = [], []
            for k, (a, b) in enumerate(diag):
                c = polyline_cross(poly, a, b)
                if not c:
                    continue
                q, p = conv(c[0])
                e = g['eta'][k]
                eta.append({'q': round(q, 3), 'eta': e})
                pw.append({'q': round(q, 3), 'kw': round(q * 1000 * p / 3.6e6 / e, 4)})
            curve['etaSamples'] = sorted(eta, key=lambda r: r['q'])
            curve['powerSamples'] = sorted(pw, key=lambda r: r['q'])
        name = f"{args.prefix}-D{dv:g}.png"
        img = page_img(g['page']).crop(tuple(g['crop']))
        img.save(os.path.join(args.out_dir, name))
        print(name, img.size)

    data['notes'] = spec['notes']
    json.dump(data, open(args.out_json, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    dg = spec.get('drawing')
    if dg:
        im = page_img(dg['page']).crop(tuple(dg['crop'])).convert('RGB')
        d = ImageDraw.Draw(im)
        for x0, y0, x1, y1 in dg.get('whiten', []):
            d.rectangle((x0, y0, x1, im.size[1] if y1 is None else y1), fill='white')
        im.save(os.path.join(args.out_dir, f'{args.prefix}-drawing.png'))
        print(f'{args.prefix}-drawing.png', im.size)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('inspect')
    p.add_argument('pdf')
    p.add_argument('page', type=int, help='индекс страницы с 0')
    p.add_argument('box', nargs='*', help='x0 y0 x1 y1 в px при 300 dpi')
    p.set_defaults(func=cmd_inspect)
    p = sub.add_parser('run')
    p.add_argument('pdf')
    p.add_argument('spec')
    p.add_argument('data', help='скелет/готовый data_*.json (читается, не изменяется)')
    p.add_argument('--out-json', required=True)
    p.add_argument('--out-dir', required=True)
    p.add_argument('--prefix', required=True, help='например 2.5 -> 2.5-D0.9.png')
    p.set_defaults(func=cmd_run)
    args = ap.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
