"""Собирает podbor-pdf-assets.js: всё, что нужно браузеру, чтобы сформировать PDF без внешних файлов.

Почему так: страница открывается двойным кликом (file://), а браузер не даёт скриптам читать соседние файлы
(fetch/canvas на file:// заблокированы). Поэтому шрифт и картинки для PDF кладём в JS в base64.
Файл подгружается только по клику «Скачать PDF» (см. podbor-ui.js), на загрузку страницы не влияет.

Содержимое window.PODBOR_PDF_ASSETS:
  fonts.regular / fonts.bold — подмножество Roboto (Apache 2.0, кириллица + латиница + типографика):
      ttf (base64), upm, cmap {кодпоинт: gid}, widths {gid: ширина в единицах em}, ascent, descent, capHeight, bbox, name
  images[<путь как в podbor-data.js>] — {w, h, data}: сжатый поток IDAT PNG (8 бит, RGB, без чересстрочности), который
      PDF принимает как FlateDecode с Predictor 15 без перекодирования.

Запуск из корня репозитория:   python scripts/build-podbor-pdf-assets.py
Нужны: fonttools, font-roboto (pip install fonttools font-roboto). Картинки — assets/podbor/*.png.
"""
import base64
import glob
import io
import json
import os
import struct
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
import font_roboto

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
FONT_DIR = os.path.join(os.path.dirname(font_roboto.__file__), 'files')

# Что нужно в документе: ASCII, кириллица, «ёЁ», кавычки-ёлочки, тире, минус, градус, степени, №, ≤ ≥ ×, неразрывный пробел.
UNICODES = (
    list(range(0x20, 0x7F))
    + [0xA0, 0xAB, 0xBB, 0xB0, 0xB1, 0xB2, 0xB3, 0xB7, 0xD7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
       0x2026, 0x2116, 0x2212, 0x2264, 0x2265, 0x3B7]
    + list(range(0x410, 0x450)) + [0x401, 0x451]
)


def subset_font(path):
    opts = subset.Options()
    opts.layout_features = []
    opts.name_IDs = [1, 2, 4, 6]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    opts.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'kern', 'DSIG', 'LTSH', 'VDMX', 'hdmx', 'meta']
    font = TTFont(path)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    data = buf.getvalue()
    f = TTFont(io.BytesIO(data))
    upm = f['head'].unitsPerEm
    cmap = f.getBestCmap()
    order = f.getGlyphOrder()
    gid_of = {name: i for i, name in enumerate(order)}
    hmtx = f['hmtx']
    widths = {gid_of[name]: hmtx[name][0] for name in order}
    cmap_out = {str(cp): gid_of[name] for cp, name in cmap.items()}
    missing = [chr(cp) for cp in UNICODES if cp not in cmap]
    if missing:
        print('в шрифте нет символов:', ''.join(missing), file=sys.stderr)
    hhea, os2, head = f['hhea'], f['OS/2'], f['head']
    return {
        'name': os.path.splitext(os.path.basename(path))[0],
        'ttf': base64.b64encode(data).decode('ascii'),
        'upm': upm,
        'cmap': cmap_out,
        'widths': {str(g): w for g, w in widths.items()},
        'ascent': hhea.ascent, 'descent': hhea.descent,
        'capHeight': getattr(os2, 'sCapHeight', int(0.71 * upm)),
        'bbox': [head.xMin, head.yMin, head.xMax, head.yMax],
        'size': len(data),
    }


def png_idat(path):
    """(w, h, сжатый IDAT) для PNG 8 бит RGB без чересстрочности и прозрачности; иначе — ошибка."""
    b = open(path, 'rb').read()
    assert b[:8] == b'\x89PNG\r\n\x1a\n', path
    i, idat, ihdr = 8, [], None
    while i < len(b):
        length = struct.unpack('>I', b[i:i + 4])[0]
        kind = b[i + 4:i + 8]
        body = b[i + 8:i + 8 + length]
        if kind == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            idat.append(body)
        elif kind in (b'PLTE', b'tRNS'):
            raise SystemExit(path + ': палитра/прозрачность не поддерживаются, сохраните PNG как RGB 8 бит')
        i += 12 + length
    w, h, depth, ctype, _, _, interlace = ihdr
    if (depth, ctype, interlace) != (8, 2, 0):
        raise SystemExit('%s: нужен PNG 8 бит RGB без чересстрочности (сейчас depth=%d, colortype=%d, interlace=%d)' % (path, depth, ctype, interlace))
    return w, h, b''.join(idat)


def main():
    fonts = {
        'regular': subset_font(os.path.join(FONT_DIR, 'Roboto-Regular.ttf')),
        'bold': subset_font(os.path.join(FONT_DIR, 'Roboto-Bold.ttf')),
    }
    images = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'assets', 'podbor', '*.png'))):
        w, h, data = png_idat(path)
        key = 'assets/podbor/' + os.path.basename(path)
        images[key] = {'w': w, 'h': h, 'data': base64.b64encode(data).decode('ascii')}
    out = 'window.PODBOR_PDF_ASSETS = ' + json.dumps({'fonts': fonts, 'images': images}, ensure_ascii=False, separators=(',', ':')) + ';\n'
    target = os.path.join(ROOT, 'podbor-pdf-assets.js')
    with open(target, 'w', encoding='utf-8') as f:
        f.write(out)
    print('written podbor-pdf-assets.js: %.1f MB, шрифты %d/%d байт, картинок %d' % (
        len(out.encode('utf-8')) / 1e6, fonts['regular']['size'], fonts['bold']['size'], len(images)))


if __name__ == '__main__':
    main()
