/* Формирование PDF результата подбора прямо в браузере, без внешних библиотек.
 *
 * Зачем: кнопка «Скачать PDF» должна сразу отдавать файл (а не открывать печать браузера), и работать при открытии
 * страницы двойным кликом (file://). Поэтому PDF собирается вручную: текст с встроенным шрифтом (Roboto, подмножество,
 * см. podbor-pdf-assets.js), векторные линии/точка/дуга поверх графика и картинки каталога (сжатые данные PNG
 * вставляются в PDF без перекодирования).
 *
 * API:  PodborPdf.build(model, assets) -> Uint8Array   (assets = window.PODBOR_PDF_ASSETS)
 *       PodborPdf.fileName(model)      -> строка имени файла
 *       PodborPdf.download(bytes, name)  (только в браузере)
 * Описание model — у функции compose() ниже.
 */
(function (root) {
  'use strict';

  const MM = 72 / 25.4;
  const PAGE_W = 595.276;
  const PAGE_H = 841.89;

  // Поля документа: левое 20 мм (под подшивку), правое 10 мм, верхнее 12 мм (фирменный бланк), нижнее 15 мм.
  const M_LEFT = 20 * MM;
  const M_RIGHT = 10 * MM;
  const M_TOP = 12 * MM;
  const M_BOTTOM = 15 * MM;
  const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;

  // Палитра без чёрного: тёмный сине-серый текст, фирменный голубой, светлые линии таблиц.
  const C = {
    text: [0.145, 0.22, 0.29],
    muted: [0.357, 0.427, 0.49],
    brand: [0, 0.58, 0.8],
    rule: [0.788, 0.847, 0.894],
    headFill: [0.89, 0.953, 0.98],
    red: [0.816, 0.204, 0.173],
    orange: [0.91, 0.451, 0.047],
    orangeText: [0.706, 0.325, 0.035],
    white: [1, 1, 1]
  };

  const num = (x) => {
    if (!Number.isFinite(x)) throw new Error('PDF: нечисловое значение в координатах');
    const s = (Math.round(x * 1000) / 1000).toString();
    return s.indexOf('e') >= 0 ? x.toFixed(3) : s;
  };

  function asciiBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 127) throw new Error('PDF: не-ASCII символ в служебной части файла: ' + s.slice(Math.max(0, i - 10), i + 10));
      out[i] = c;
    }
    return out;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const hex4 = (n) => n.toString(16).padStart(4, '0');

  // Строка PDF в UTF-16BE (для Info): <FEFF...>
  function pdfText(str) {
    let h = 'FEFF';
    for (let i = 0; i < str.length; i++) h += hex4(str.charCodeAt(i));
    return '<' + h + '>';
  }

  // ---------- шрифт ----------

  function makeFont(spec, resName) {
    const fallback = spec.cmap[63] !== undefined ? spec.cmap[63] : 0; // «?»
    return {
      spec,
      resName,
      used: new Map(), // gid -> кодпоинт (для ToUnicode)
      gid(cp) {
        const g = spec.cmap[cp];
        return g !== undefined ? g : fallback;
      },
      width(str, size) {
        let w = 0;
        for (const ch of str) w += spec.widths[this.gid(ch.codePointAt(0))] || 0;
        return (w * size) / spec.upm;
      },
      hex(str) {
        let h = '';
        for (const ch of str) {
          const cp = ch.codePointAt(0);
          const g = this.gid(cp);
          this.used.set(g, spec.cmap[cp] !== undefined ? cp : 63);
          h += hex4(g);
        }
        return '<' + h + '>';
      }
    };
  }

  // Перенос по словам: строки, каждая не шире maxW (в pt); слишком длинное слово режется по символам.
  function wrapText(font, str, size, maxW) {
    const lines = [];
    let cur = '';
    const push = (s) => { lines.push(s); };
    for (const word of String(str).split(/\s+/).filter((w) => w.length > 0)) {
      const trial = cur ? cur + ' ' + word : word;
      if (font.width(trial, size) <= maxW) { cur = trial; continue; }
      if (cur) { push(cur); cur = ''; }
      if (font.width(word, size) <= maxW) { cur = word; continue; }
      let piece = '';
      for (const ch of word) {
        if (font.width(piece + ch, size) > maxW && piece) { push(piece); piece = ''; }
        piece += ch;
      }
      cur = piece;
    }
    if (cur || lines.length === 0) push(cur);
    return lines;
  }

  // ---------- страница: накопитель команд содержимого (координаты — pt от левого верхнего угла) ----------

  class Page {
    constructor(fonts) {
      this.fonts = fonts;
      this.ops = [];
      this.images = new Set();
    }
    raw(s) { this.ops.push(s); }
    fill(c) { this.raw(num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' rg'); }
    stroke(c) { this.raw(num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' RG'); }
    save() { this.raw('q'); }
    restore() { this.raw('Q'); }
    clipRect(x, y, w, h) { this.raw(num(x) + ' ' + num(PAGE_H - y - h) + ' ' + num(w) + ' ' + num(h) + ' re W n'); }

    // x, y — левый край и БАЗОВАЯ линия текста; o: font, size, color, align, halo
    text(x, y, str, o) {
      const font = this.fonts[o.font || 'regular'];
      const size = o.size || 9;
      let px = x;
      const w = font.width(str, size);
      if (o.align === 'right') px = x - w;
      else if (o.align === 'center') px = x - w / 2;
      const h = font.hex(str);
      const pos = num(px) + ' ' + num(PAGE_H - y) + ' Td ';
      const c = o.color || C.text;
      this.raw('q');
      if (o.halo) {
        // белая обводка под текстом, чтобы подпись читалась поверх линий графика
        this.raw('BT /' + font.resName + ' ' + num(size) + ' Tf 1 Tr ' + num(o.halo) + ' w 1 1 1 RG ' + pos + h + ' Tj ET');
      }
      this.raw('BT /' + font.resName + ' ' + num(size) + ' Tf 0 Tr ' + num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' rg ' + pos + h + ' Tj ET');
      this.raw('Q');
      return w;
    }

    line(x1, y1, x2, y2, o) {
      this.save();
      this.stroke(o.color || C.text);
      this.raw(num(o.w || 0.5) + ' w');
      if (o.dash) this.raw('[' + o.dash.map(num).join(' ') + '] 0 d');
      this.raw(num(x1) + ' ' + num(PAGE_H - y1) + ' m ' + num(x2) + ' ' + num(PAGE_H - y2) + ' l S');
      this.restore();
    }

    rect(x, y, w, h, o) {
      this.save();
      if (o.fill) this.fill(o.fill);
      if (o.stroke) { this.stroke(o.stroke); this.raw(num(o.w || 0.5) + ' w'); }
      const op = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
      this.raw(num(x) + ' ' + num(PAGE_H - y - h) + ' ' + num(w) + ' ' + num(h) + ' re ' + op);
      this.restore();
    }

    polyline(pts, o) {
      if (pts.length < 2) return;
      this.save();
      this.stroke(o.color || C.text);
      this.raw(num(o.w || 0.5) + ' w 1 J 1 j');
      if (o.dash) this.raw('[' + o.dash.map(num).join(' ') + '] 0 d');
      this.raw(pts.map((p, i) => num(p[0]) + ' ' + num(PAGE_H - p[1]) + (i === 0 ? ' m' : ' l')).join(' ') + ' S');
      this.restore();
    }

    circle(cx, cy, r, o) {
      const k = 0.5523 * r;
      const X = cx;
      const Y = PAGE_H - cy;
      this.save();
      if (o.fill) this.fill(o.fill);
      if (o.stroke) { this.stroke(o.stroke); this.raw(num(o.w || 0.5) + ' w'); }
      this.raw(
        num(X + r) + ' ' + num(Y) + ' m ' +
        num(X + r) + ' ' + num(Y + k) + ' ' + num(X + k) + ' ' + num(Y + r) + ' ' + num(X) + ' ' + num(Y + r) + ' c ' +
        num(X - k) + ' ' + num(Y + r) + ' ' + num(X - r) + ' ' + num(Y + k) + ' ' + num(X - r) + ' ' + num(Y) + ' c ' +
        num(X - r) + ' ' + num(Y - k) + ' ' + num(X - k) + ' ' + num(Y - r) + ' ' + num(X) + ' ' + num(Y - r) + ' c ' +
        num(X + k) + ' ' + num(Y - r) + ' ' + num(X + r) + ' ' + num(Y - k) + ' ' + num(X + r) + ' ' + num(Y) + ' c ' +
        (o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S')
      );
      this.restore();
    }

    image(key, x, y, w, h) {
      this.images.add(key);
      this.save();
      this.raw(num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + num(PAGE_H - y - h) + ' cm /Im' + imageIndex(key) + ' Do');
      this.restore();
    }
  }

  // Имена ресурсов картинок: Im0, Im1, ... по порядку первого упоминания в документе (заполняется в build()).
  let imageOrder = [];
  function imageIndex(key) {
    let i = imageOrder.indexOf(key);
    if (i < 0) { imageOrder.push(key); i = imageOrder.length - 1; }
    return i;
  }

  // ---------- таблица ----------

  const TABLE = { size: 8.5, padX: 4, padY: 2.6, lineH: 10.6, labelFrac: 0.46 };

  // Рисует таблицу «заголовок + строки [подпись, значение]»; значения переносятся по словам. Возвращает нижнюю границу (pt от верха).
  function drawTable(page, x, top, w, title, rows) {
    const reg = page.fonts.regular;
    const bold = page.fonts.bold;
    const t = TABLE;
    const labelW = w * t.labelFrac;
    const valueW = w - labelW;
    const headH = t.lineH + 2 * t.padY;
    page.rect(x, top, w, headH, { fill: C.headFill, stroke: C.rule, w: 0.5 });
    page.text(x + t.padX, top + t.padY + t.size * 0.98, title, { font: 'bold', size: t.size, color: C.text });
    let y = top + headH;
    rows.forEach(([label, value]) => {
      const labelLines = wrapText(reg, label, t.size, labelW - 2 * t.padX);
      const valueLines = wrapText(bold, String(value), t.size, valueW - 2 * t.padX);
      const n = Math.max(labelLines.length, valueLines.length);
      const h = n * t.lineH + 2 * t.padY;
      page.rect(x, y, w, h, { stroke: C.rule, w: 0.5 });
      page.line(x + labelW, y, x + labelW, y + h, { color: C.rule, w: 0.5 });
      labelLines.forEach((s, i) => page.text(x + t.padX, y + t.padY + t.size * 0.98 + i * t.lineH, s, { font: 'regular', size: t.size, color: C.muted }));
      valueLines.forEach((s, i) => page.text(x + labelW + t.padX, y + t.padY + t.size * 0.98 + i * t.lineH, s, { font: 'bold', size: t.size, color: C.text }));
      y += h;
    });
    return y;
  }

  // ---------- фирменный бланк ----------

  const REQUISITES = [
    { text: 'РЕСПУБЛИКА БЕЛАРУСЬ', font: 'regular', size: 6.5, color: C.muted },
    { text: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «АЭРОХИТ»', font: 'bold', size: 7.6, color: C.text },
    { text: '223035, а/г Ратомка, Минский район, ул. Перспективная, 12, офис 49', font: 'regular', size: 7.4, color: C.muted },
    { text: '+375 29 690 06 60; +375 29 785 54 89; +375 17 507 71 20', font: 'regular', size: 7.4, color: C.muted },
    { text: 'эл. почта: info@aeroheat.by, вайбер +375 29 690 81 70', font: 'regular', size: 7.4, color: C.muted }
  ];

  const LOGO_KEY = 'assets/podbor/aeroheat-logo.png';

  // Полный бланк (первая страница). Возвращает нижнюю границу бланка (pt от верха).
  function drawLetterhead(page, assets) {
    const logo = assets.images[LOGO_KEY];
    const lw = 42 * MM;
    const lh = (lw * logo.h) / logo.w;
    page.image(LOGO_KEY, M_LEFT, M_TOP, lw, lh);
    const x0 = M_LEFT + lw + 6 * MM;
    const lineGap = 9.2;
    const blockH = REQUISITES.length * lineGap;
    let y = M_TOP + (lh - blockH) / 2 + 7;
    REQUISITES.forEach((r) => { page.text(x0, y, r.text, r); y += lineGap; });
    const bottom = M_TOP + lh + 3 * MM;
    page.line(M_LEFT, bottom, PAGE_W - M_RIGHT, bottom, { color: C.brand, w: 1.1 });
    return bottom;
  }

  // Краткий бланк (следующие страницы): логотип поменьше и линия.
  function drawLetterheadShort(page, assets) {
    const logo = assets.images[LOGO_KEY];
    const lw = 28 * MM;
    const lh = (lw * logo.h) / logo.w;
    page.image(LOGO_KEY, M_LEFT, M_TOP, lw, lh);
    const bottom = M_TOP + lh + 2 * MM;
    page.line(M_LEFT, bottom, PAGE_W - M_RIGHT, bottom, { color: C.brand, w: 1.1 });
    return bottom;
  }

  function drawFooter(page, n, total) {
    page.text(PAGE_W - M_RIGHT, PAGE_H - 9 * MM, 'Страница ' + n + ' из ' + total, { font: 'regular', size: 7.5, color: C.muted, align: 'right' });
  }

  // ---------- график с точкой, параболой сети и дугой Nу (векторно поверх картинки) ----------

  function drawGraph(page, assets, g, box) {
    const img = assets.images[g.image];
    const cal = g.calibration;
    // вписать картинку в область box (pt), по центру по ширине, к верху
    const scale = Math.min(box.w / img.w, box.h / img.h);
    const iw = img.w * scale;
    const ih = img.h * scale;
    const ix = box.x + (box.w - iw) / 2;
    const iy = box.y;
    page.image(g.image, ix, iy, iw, ih);
    page.rect(ix, iy, iw, ih, { stroke: C.rule, w: 0.5 });

    const px = (q) => ix + ((cal.qAxis.slope * Math.log10(q) + cal.qAxis.intercept) * iw) / img.w;
    const py = (p) => iy + ((cal.pAxis.slope * Math.log10(p) + cal.pAxis.intercept) * ih) / img.h;
    const pt = (q, p) => [px(q), py(p)];
    const ok = (a) => Number.isFinite(a[0]) && Number.isFinite(a[1]);

    // Линии поверх графика обрезаются по рамке поля графика (не заходят на подписи осей)
    const fr = cal.plotFrame
      ? { x: ix + (cal.plotFrame[0] * iw) / img.w, y: iy + (cal.plotFrame[1] * ih) / img.h, w: ((cal.plotFrame[2] - cal.plotFrame[0]) * iw) / img.w, h: ((cal.plotFrame[3] - cal.plotFrame[1]) * ih) / img.h }
      : { x: ix, y: iy, w: iw, h: ih };
    page.save();
    page.clipRect(fr.x, fr.y, fr.w, fr.h);

    (g.arcs || []).forEach((arc) => {
      const pts = arc.points.map(([q, p]) => pt(q, p)).filter(ok);
      page.polyline(pts, { color: C.orange, w: 1.5, dash: [6, 3.5] });
      if (arc.label && pts.length > 2) {
        const size = 7.2;
        const w = page.fonts.bold.width(arc.label, size);
        const mid = pts[Math.floor(pts.length * 0.62)];
        let tx = mid[0] + 4;
        if (tx + w > fr.x + fr.w - 3) tx = fr.x + fr.w - 3 - w;
        page.text(tx, mid[1] - 5, arc.label, { font: 'bold', size, color: C.orangeText, halo: 2.6 });
      }
    });

    // парабола сети через целевую точку
    const p = g.point;
    const k = p.targetPPa / (p.targetQThousand * p.targetQThousand);
    const net = [];
    for (let i = 0; i <= 40; i++) {
      const q = p.targetQThousand * (0.3 + (1.5 * i) / 40);
      net.push(pt(q, k * q * q));
    }
    page.polyline(net.filter(ok), { color: C.red, w: 1.1, dash: [3.2, 2.2] });
    // рабочая точка
    const c = pt(p.qThousand, p.pPa);
    page.circle(c[0], c[1], 3.4, { fill: C.red, stroke: C.white, w: 0.9 });
    page.restore();
    return { bottom: iy + ih };
  }

  // ---------- композиция документа ----------

  /* model:
   *   date            'ДД.ММ.ГГГГ'
   *   title           'Подбор вентилятора ВЦ 4-70-4'
   *   leftTitle/left  заголовок и строки [подпись, значение] таблицы «Исходные данные»
   *   rightTitle/right то же для «Результат подбора»
   *   graph           { image, calibration:{qAxis,pAxis}, point:{qThousand,pPa,targetQThousand,targetPPa}, arcs:[{label, points:[[Q,P],...]}] }
   *   drawing         { image, heading, table:{ head:[...], rows:[[...],...] } }  (необязательно)
   */
  function compose(model, assets, fonts) {
    const pages = [];

    // --- страница 1 ---
    const p1 = new Page(fonts);
    let y = drawLetterhead(p1, assets);
    y += 7 * MM;
    p1.text(M_LEFT, y + 9, model.title, { font: 'bold', size: 13.5, color: C.text });
    p1.text(PAGE_W - M_RIGHT, y + 9, 'Дата: ' + model.date, { font: 'regular', size: 9, color: C.muted, align: 'right' });
    y += 16;

    const gap = 4 * MM;
    const leftW = CONTENT_W * 0.43;
    const rightW = CONTENT_W - leftW - gap;
    const bl = drawTable(p1, M_LEFT, y, leftW, model.leftTitle, model.left);
    const br = drawTable(p1, M_LEFT + leftW + gap, y, rightW, model.rightTitle, model.right);
    y = Math.max(bl, br) + 5 * MM;

    const graphBottomLimit = PAGE_H - M_BOTTOM - 4 * MM; // место под номер страницы
    drawGraph(p1, assets, model.graph, { x: M_LEFT, y, w: CONTENT_W, h: graphBottomLimit - y });
    pages.push(p1);

    // --- страница 2: габариты ---
    if (model.drawing) {
      const p2 = new Page(fonts);
      let y2 = drawLetterheadShort(p2, assets) + 8 * MM;
      p2.text(M_LEFT, y2 + 8, model.drawing.heading, { font: 'bold', size: 11.5, color: C.text });
      y2 += 8 * MM + 6;
      const img = assets.images[model.drawing.image];
      const dw = CONTENT_W;
      const dh = (dw * img.h) / img.w;
      p2.image(model.drawing.image, M_LEFT, y2, dw, dh);
      p2.rect(M_LEFT, y2, dw, dh, { stroke: C.rule, w: 0.5 });
      y2 += dh + 6 * MM;
      // таблица размеров: заголовок + строки в три колонки
      const t = model.drawing.table;
      const cw = [CONTENT_W * 0.34, CONTENT_W * 0.16, CONTENT_W * 0.16];
      const rowH = TABLE.lineH + 2 * TABLE.padY;
      let x = M_LEFT;
      t.head.forEach((h, i) => {
        p2.rect(x, y2, cw[i], rowH, { fill: C.headFill, stroke: C.rule, w: 0.5 });
        p2.text(x + TABLE.padX, y2 + TABLE.padY + TABLE.size * 0.98, h, { font: 'bold', size: TABLE.size, color: C.text });
        x += cw[i];
      });
      y2 += rowH;
      t.rows.forEach((r) => {
        x = M_LEFT;
        r.forEach((v, i) => {
          p2.rect(x, y2, cw[i], rowH, { stroke: C.rule, w: 0.5 });
          p2.text(x + TABLE.padX, y2 + TABLE.padY + TABLE.size * 0.98, String(v), { font: i === 0 ? 'regular' : 'bold', size: TABLE.size, color: C.text });
          x += cw[i];
        });
        y2 += rowH;
      });
      pages.push(p2);
    }

    pages.forEach((pg, i) => drawFooter(pg, i + 1, pages.length));
    return pages;
  }

  // ---------- сборка файла PDF ----------

  class Pdf {
    constructor() {
      this.chunks = [];
      this.len = 0;
      this.offsets = [];
      this.next = 1;
    }
    alloc() { return this.next++; }
    write(part) {
      const b = typeof part === 'string' ? asciiBytes(part) : part;
      this.chunks.push(b);
      this.len += b.length;
    }
    put(id, parts) {
      this.offsets[id] = this.len;
      this.write(id + ' 0 obj\n');
      parts.forEach((p) => this.write(p));
      this.write('\nendobj\n');
    }
    putStream(id, dict, bytes) {
      this.put(id, ['<< ' + dict + ' /Length ' + bytes.length + ' >>\nstream\n', bytes, '\nendstream']);
    }
    finish(rootId, infoId) {
      const xrefPos = this.len;
      const n = this.next;
      let x = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
      for (let i = 1; i < n; i++) {
        if (this.offsets[i] === undefined) throw new Error('PDF: объект ' + i + ' не записан');
        x += String(this.offsets[i]).padStart(10, '0') + ' 00000 n \n';
      }
      let idHex = '';
      for (let i = 0; i < 32; i++) idHex += Math.floor(Math.random() * 16).toString(16);
      x += 'trailer\n<< /Size ' + n + ' /Root ' + rootId + ' 0 R /Info ' + infoId + ' 0 R /ID [<' + idHex + '> <' + idHex + '>] >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
      this.write(x);
      const out = new Uint8Array(this.len);
      let o = 0;
      this.chunks.forEach((c) => { out.set(c, o); o += c.length; });
      return out;
    }
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toUnicodeCMap(font) {
    const entries = [...font.used.entries()].sort((a, b) => a[0] - b[0]);
    let s = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      s += chunk.length + ' beginbfchar\n';
      chunk.forEach(([gid, cp]) => { s += '<' + hex4(gid) + '> <' + (cp > 0xffff ? '003F' : hex4(cp)) + '>\n'; });
      s += 'endbfchar\n';
    }
    s += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    return s;
  }

  function build(model, assets) {
    imageOrder = [];
    const fonts = {
      regular: makeFont(assets.fonts.regular, 'F1'),
      bold: makeFont(assets.fonts.bold, 'F2')
    };
    const pages = compose(model, assets, fonts);

    const pdf = new Pdf();
    pdf.write('%PDF-1.4\n');
    pdf.write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // признак двоичного файла
    const rootId = pdf.alloc();
    const pagesId = pdf.alloc();
    const infoId = pdf.alloc();

    // шрифты
    const fontIds = {};
    ['regular', 'bold'].forEach((k) => {
      const f = fonts[k];
      const spec = f.spec;
      const type0 = pdf.alloc();
      const cid = pdf.alloc();
      const desc = pdf.alloc();
      const file = pdf.alloc();
      const tou = pdf.alloc();
      const ttf = b64ToBytes(spec.ttf);
      const s1000 = 1000 / spec.upm;
      const psName = 'AAAAAA+' + spec.name.replace(/[^A-Za-z0-9-]/g, '');
      pdf.put(type0, ['<< /Type /Font /Subtype /Type0 /BaseFont /' + psName + ' /Encoding /Identity-H /DescendantFonts [' + cid + ' 0 R] /ToUnicode ' + tou + ' 0 R >>']);
      let w = '';
      Object.keys(spec.widths).map(Number).sort((a, b) => a - b).forEach((gid) => { w += gid + ' [' + Math.round(spec.widths[gid] * s1000) + '] '; });
      pdf.put(cid, ['<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + psName + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + desc + ' 0 R /CIDToGIDMap /Identity /DW 500 /W [' + w + '] >>']);
      const bb = spec.bbox.map((v) => Math.round(v * s1000));
      pdf.put(desc, ['<< /Type /FontDescriptor /FontName /' + psName + ' /Flags 32 /FontBBox [' + bb.join(' ') + '] /ItalicAngle 0 /Ascent ' +
        Math.round(spec.ascent * s1000) + ' /Descent ' + Math.round(spec.descent * s1000) + ' /CapHeight ' + Math.round(spec.capHeight * s1000) +
        ' /StemV ' + (k === 'bold' ? 140 : 80) + ' /FontFile2 ' + file + ' 0 R >>']);
      pdf.putStream(file, '/Length1 ' + ttf.length, ttf);
      const cmapBytes = asciiBytes(toUnicodeCMap(f));
      pdf.putStream(tou, '', cmapBytes);
      fontIds[f.resName] = type0;
    });

    // картинки
    const imageIds = {};
    imageOrder.forEach((key, i) => {
      const im = assets.images[key];
      if (!im) throw new Error('PDF: нет картинки ' + key);
      const id = pdf.alloc();
      pdf.putStream(id, '/Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ' + im.w + ' >>',
      b64ToBytes(im.data));
      imageIds['Im' + i] = id;
    });

    const fontRes = Object.keys(fontIds).map((n) => '/' + n + ' ' + fontIds[n] + ' 0 R').join(' ');
    const imgRes = Object.keys(imageIds).map((n) => '/' + n + ' ' + imageIds[n] + ' 0 R').join(' ');
    const resources = '<< /Font << ' + fontRes + ' >> /XObject << ' + imgRes + ' >> /ProcSet [/PDF /Text /ImageC] >>';

    const pageIds = [];
    pages.forEach((pg) => {
      const contentId = pdf.alloc();
      const pageId = pdf.alloc();
      pdf.putStream(contentId, '', asciiBytes(pg.ops.join('\n') + '\n'));
      pdf.put(pageId, ['<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + num(PAGE_W) + ' ' + num(PAGE_H) + '] /Resources ' + resources + ' /Contents ' + contentId + ' 0 R >>']);
      pageIds.push(pageId);
    });

    pdf.put(pagesId, ['<< /Type /Pages /Kids [' + pageIds.map((i) => i + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>']);
    pdf.put(rootId, ['<< /Type /Catalog /Pages ' + pagesId + ' 0 R /Lang (ru-RU) >>']);
    const d = new Date();
    const stamp = 'D:' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
    pdf.put(infoId, ['<< /Title ' + pdfText(model.title) + ' /Author ' + pdfText('ООО «АЭРОХИТ»') + ' /Creator ' + pdfText('aeroheat.by, подбор вентиляторов') +
      ' /Producer ' + pdfText('aeroheat.by') + ' /CreationDate (' + stamp + ') >>']);
    return pdf.finish(rootId, infoId);
  }

  // ---------- модель документа из результата подбора ----------

  const NBSP = ' ';
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const fmtDec = (n, digits) => n.toFixed(digits).replace('.', ',');
  // Введённое пользователем число — как есть: целое с разрядами, дробное с запятой
  const fmtEntered = (n) => (Number.isInteger(n) ? fmtInt(n) : String(Math.round(n * 100) / 100).replace('.', ','));
  const fmtDiameter = (d) => String(d).replace('.', ',');

  /* c — кандидат из PodborCalc.selectCandidates; input — введённые параметры расчёта;
   * opts: { typorazmer: data.typorazmery[c.typorazmer], airDensityRatio(tempC), ispolnenieLabel }
   * Правила оформления (по требованию заказчика): без комментариев и пояснений; двигатель — «по типу <модель>»;
   * в строках давления не пишем «полное/статическое» — тип расчёта указан отдельной строкой; при статическом расчёте
   * оба давления статические (фактическое статическое = полное − Pdv). Температуру в документ не выводим. */
  function modelFromCandidate(c, input, opts) {
    const isStatic = input.calcType === 'static';
    const ratio = opts.airDensityRatio(input.tempC);
    let pFactShown = c.pFactPa;
    if (isStatic) {
      const q = c.qFactM3h / 1000;
      pFactShown = c.pFactPa - c.calibration.pdvAxis.coeffC * q * q * ratio;
    }
    const model = 'ВЦ 4-70-' + c.typorazmer;
    const now = new Date();
    const date = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + now.getFullYear();
    const dash = '—';
    return {
      date,
      title: 'Подбор вентилятора ' + model,
      fileTitle: 'Подбор ' + model + ' D=' + fmtDiameter(c.diameter) + ' n=' + c.rpmActual,
      leftTitle: 'Исходные данные',
      left: [
        ['Расход, м³/ч', fmtEntered(input.qReqM3h)],
        ['Давление, Па', fmtEntered(input.pReqPa)],
        ['Тип расчёта', isStatic ? 'Статический' : 'Полный'],
        ['Исполнение', opts.ispolnenieLabel]
      ],
      rightTitle: 'Результат подбора',
      right: [
        ['Вентилятор', model],
        ['Диаметр колеса', fmtDiameter(c.diameter) + ' Dном'],
        ['Частота вращения, об/мин', String(c.rpmActual)],
        ['Расход, м³/ч', fmtInt(c.qFactM3h)],
        ['Давление, Па', fmtInt(pFactShown)],
        ['КПД, %', c.eta != null ? fmtInt(c.eta * 100) : dash],
        ['Мощность на валу, кВт', c.shaftKw != null ? fmtDec(c.shaftKw, 2) : dash],
        ['Двигатель', c.motor ? 'по типу ' + c.motor.type : dash]
      ],
      graph: {
        image: c.graphImage,
        calibration: c.calibration,
        point: {
          qThousand: c.qFactM3h / 1000,
          pPa: c.pFactPa / ratio,
          targetQThousand: c.targetQThousand,
          targetPPa: c.targetPPa / ratio
        },
        arcs: c.nyArc ? [{ label: 'Nу=' + String(c.nyArc.nominalKw).replace('.', ',') + ' кВт (расчёт)', points: c.nyArc.points }] : []
      },
      drawing: {
        image: opts.typorazmer.drawingImage,
        heading: 'Габаритно-присоединительные размеры ' + model,
        table: {
          head: ['Угол поворота корпуса', 'B, мм', 'H, мм'],
          rows: opts.typorazmer.dimensionsByAngle.map((r) => [r.angle + '°', String(r.B), String(r.H)])
        }
      }
    };
  }

  function fileName(model) {
    return (model.fileTitle || model.title).replace(/[\\/:*?"<>|]/g, '') + ' — Аэрохит.pdf';
  }

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
  }

  const api = { build, fileName, download, wrapText, makeFont, modelFromCandidate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PodborPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
