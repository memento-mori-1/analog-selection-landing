"""Поле КПД графиков каталога для расчёта дуг мощности Nу.

Линии постоянного КПД на графиках — прямые с наклоном 2 в log-log (P = a·Q², Q в тыс. м³/ч), поэтому КПД в любой
точке поля однозначно определяется величиной a = P/Q². Скрипт извлекает из векторных путей PDF положения линий
(a для каждой диагонали) и сопоставляет им значения КПД из spec (`graphs[d].eta`, слева направо по верхним концам).
Результат — eta_field.json: {"<типоразмер>": {"<d>": [[a, eta], ...]}}, отсортировано по a.

Зачем: мощность на валу N = P·Q/(3600·η) (P в Па, Q в тыс. м³/ч, N в кВт) в любой точке поля даёт дугу
любого номинала двигателя (в том числе не нарисованную на графике). Метод проверен по нарисованным синим дугам Nу:
расчётные дуги 0,25 и 0,75 кВт (ВЦ 4-70-4, D=0,95) ложатся на нарисованные.

Запуск (нужны исходные PDF в docs/каталог/, они в git не лежат):
    python eta_field.py            # пишет eta_field.json рядом со скриптом
"""
import json
import math
import os

import fitz  # PyMuPDF

from lib import fit_log_axis, value_at_pixel

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
K = 300 / 72  # pt -> px при 300 dpi (как в vector_extract)

SOURCES = [
    ('2,5', 'ВЦ 4-70-2,5.pdf', 'spec_2_5.json'),
    ('3,15', 'ВЦ 4-70-3,15.pdf', 'spec_3_15.json'),
    ('4', 'ВЦ 4-70-4.pdf', 'spec_4.json'),
]


def diagonals(page, frame):
    """Тонкие чёрные длинные диагонали внутри рамки графика (линии постоянного КПД)."""
    x0, y0, x1, y1 = frame
    inside = lambda x, y: x0 <= x <= x1 and y0 <= y <= y1
    out = []
    for d in page.get_drawings():
        col, w = d.get('color'), d.get('width') or 0
        if not (col and max(col) < 0.05 and w < 1.0):
            continue
        for it in d['items']:
            if it[0] != 'l':
                continue
            ax, ay, bx, by = it[1].x * K, it[1].y * K, it[2].x * K, it[2].y * K
            if (math.hypot(bx - ax, by - ay) > 120 and inside(ax, ay) and inside(bx, by)
                    and abs(by - ay) > 20 and abs(bx - ax) > 10):
                out.append((ax, ay, bx, by))
    return out


def graph_field(spec, doc, key):
    g = spec['graphs'][key]
    page = doc[g['page']]
    qvals = g.get('qValues') or spec['qValues']
    qcal = fit_log_axis(g['qx'], qvals)
    pcal = fit_log_axis([p[0] for p in g['py']], [p[1] for p in g['py']])
    lines = []  # (x верхнего конца, a = P/Q^2)
    for ax, ay, bx, by in diagonals(page, g['frame']):
        top_x = ax if ay < by else bx
        q = value_at_pixel((ax + bx) / 2, qcal)
        p = value_at_pixel((ay + by) / 2, pcal)
        lines.append((top_x, p / q ** 2))
    lines.sort()
    merged = []  # диагональ может состоять из нескольких отрезков — сливаем совпадающие по a
    for x, a in lines:
        if merged and abs(math.log(a / merged[-1][1])) < 0.03:
            continue
        merged.append((x, a))
    etas = g['eta']
    if len(merged) != len(etas):
        raise SystemExit('%s: найдено диагоналей %d, значений КПД в spec %d' % (key, len(merged), len(etas)))
    field = sorted(([round(a, 4), e] for (_, a), e in zip(merged, etas)), key=lambda r: r[0])
    return field


def main():
    result = {}
    for tkey, pdf, specfile in SOURCES:
        spec = json.load(open(os.path.join(HERE, specfile), encoding='utf-8'))
        doc = fitz.open(os.path.join(ROOT, 'docs', 'каталог', pdf))
        result[tkey] = {}
        for key in spec['graphs']:
            result[tkey][key] = graph_field(spec, doc, key)
            print(tkey, 'D=' + key, [r[1] for r in result[tkey][key]])
    with open(os.path.join(HERE, 'eta_field.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('written eta_field.json')


if __name__ == '__main__':
    main()
