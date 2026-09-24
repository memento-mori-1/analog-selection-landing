// Тесты генератора PDF (podbor-pdf.js): структура файла, правила оформления, данные документа.
// Запуск: node scripts/test-podbor-pdf.js
// Чтобы сохранить PDF для просмотра: PODBOR_PDF_OUT=путь.pdf node scripts/test-podbor-pdf.js
const assert = require('assert');
const fs = require('fs');

global.window = global.window || {};
require('../podbor-data.js');
require('../podbor-pdf-assets.js');
const PodborCalc = require('../podbor-calc.js');
const PodborPdf = require('../podbor-pdf.js');

const DATA = global.window.PODBOR_DATA;
const ASSETS = global.window.PODBOR_PDF_ASSETS;
const input = (q, p, extra) => Object.assign({ qReqM3h: q, pReqPa: p, calcType: 'full', upPct: 30, downPct: 15, tempC: 20, marginPct: 0, ispolnenie: 'general' }, extra || {});
const opts = (c) => ({ typorazmer: DATA.typorazmery[c.typorazmer], airDensityRatio: PodborCalc.airDensityRatio, ispolnenieLabel: 'Общего назначения (оцинкованная сталь)' });
const pick = (inp, typ, d, rpm) => PodborCalc.selectCandidates(DATA, inp).find((c) => c.typorazmer === typ && c.diameter === d && c.rpmActual === rpm);

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const rowsToMap = (rows) => Object.fromEntries(rows);

function run() {
  const tests = [];

  tests.push(['структура файла: заголовок, xref указывает на объекты, startxref, конец файла', () => {
    const inp = input(2500, 350);
    const c = pick(inp, '4', 0.95, 1380);
    const bytes = PodborPdf.build(PodborPdf.modelFromCandidate(c, inp, opts(c)), ASSETS);
    const s = latin1(bytes);
    assert.ok(s.startsWith('%PDF-1.4\n'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
    const sx = /startxref\n(\d+)\n%%EOF/.exec(s);
    assert.ok(sx, 'нет startxref');
    assert.strictEqual(s.substr(Number(sx[1]), 4), 'xref');
    const m = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(s.substr(Number(sx[1])));
    const n = Number(m[1]);
    const entries = m[2].trim().split('\n');
    assert.strictEqual(entries.length, n);
    for (let i = 1; i < n; i++) {
      const off = Number(entries[i].slice(0, 10));
      assert.ok(s.substr(off, 12).startsWith(i + ' 0 obj'), `объект ${i}: по смещению ${off} нет «${i} 0 obj»`);
    }
    // ровно две страницы: точка + габариты
    assert.strictEqual((s.match(/\/Type \/Page /g) || []).length, 2);
    // длины потоков объявлены верно
    const re = /\/Length (\d+) [^>]*>>\nstream\n/g;
    let mm;
    let checked = 0;
    while ((mm = re.exec(s)) !== null) {
      const start = mm.index + mm[0].length;
      assert.strictEqual(s.substr(start + Number(mm[1]), 10), '\nendstream', 'длина потока не совпала с фактической');
      checked++;
    }
    assert.ok(checked >= 8, 'проверено потоков: ' + checked);
  }]);

  tests.push(['оформление: двигатель «по типу …», температуры и комментариев в таблицах нет', () => {
    const inp = input(2500, 350, { tempC: 35 });
    const c = pick(inp, '4', 0.95, 1380);
    const model = PodborPdf.modelFromCandidate(c, inp, opts(c));
    const left = rowsToMap(model.left);
    const right = rowsToMap(model.right);
    assert.strictEqual(right['Двигатель'], 'по типу АИР71А4');
    assert.strictEqual(left['Тип расчёта'], 'Полный');
    assert.ok(!('Температура воздуха' in left) && !Object.keys(left).some((k) => /темп/i.test(k)));
    // подписи давления без «полное/статическое»
    [...model.left, ...model.right].forEach(([label, value]) => {
      if (/давлен/i.test(label)) assert.ok(!/полн|статич/i.test(label + ' ' + value), label + ': ' + value);
    });
    // никаких комментариев: значения короткие, без скобок и пояснений
    [...model.left.filter(([l]) => l !== 'Исполнение'), ...model.right].forEach(([label, value]) => {
      assert.ok(!/[()]|не подтвержд|график|таблиц/i.test(value), label + ': ' + value);
    });
    assert.strictEqual(model.graph.arcs.length, 1);
    assert.strictEqual(model.graph.arcs[0].label, 'Nу=0,55 кВт (расчёт)');
  }]);

  tests.push(['статический расчёт: оба давления статические, фактическое = полное − Pdv; тип расчёта — «Статический»', () => {
    const inp = input(6000, 800, { calcType: 'static' });
    const c = PodborCalc.selectCandidates(DATA, inp)[0];
    const model = PodborCalc.selectCandidates ? PodborPdf.modelFromCandidate(c, inp, opts(c)) : null;
    const left = rowsToMap(model.left);
    const right = rowsToMap(model.right);
    assert.strictEqual(left['Тип расчёта'], 'Статический');
    assert.strictEqual(left['Давление, Па'], '800');
    const pdv = c.calibration.pdvAxis.coeffC * (c.qFactM3h / 1000) ** 2;
    const shown = Number(right['Давление, Па'].replace(/ /g, ''));
    assert.ok(Math.abs(shown - Math.round(c.pFactPa - pdv)) <= 1, `${shown} vs ${c.pFactPa - pdv}`);
    assert.ok(shown < c.pFactPa);
  }]);

  tests.push(['без КПД и двигателя в таблице — прочерк, а не выдуманные значения', () => {
    const inp = input(1330, 180);
    const c = PodborCalc.selectCandidates(DATA, inp).find((x) => x.eta === null && x.motor === null) ||
      Object.assign({}, PodborCalc.selectCandidates(DATA, inp)[0], { eta: null, shaftKw: null, motor: null, nyArc: null });
    const right = rowsToMap(PodborPdf.modelFromCandidate(c, inp, opts(c)).right);
    assert.strictEqual(right['КПД, %'], '—');
    assert.strictEqual(right['Мощность на валу, кВт'], '—');
    assert.strictEqual(right['Двигатель'], '—');
  }]);

  tests.push(['перенос по словам: строки не шире заданной ширины, слова не теряются', () => {
    const f = PodborPdf.makeFont(ASSETS.fonts.regular, 'F1');
    const text = 'Общего назначения (оцинкованная сталь)';
    const lines = PodborPdf.wrapText(f, text, 8.5, 100);
    assert.ok(lines.length >= 2);
    lines.forEach((l) => assert.ok(f.width(l, 8.5) <= 100 + 1e-9, l));
    assert.strictEqual(lines.join(' '), text);
    assert.deepStrictEqual(PodborPdf.wrapText(f, 'Полный', 8.5, 100), ['Полный']);
  }]);

  tests.push(['все символы документа есть в шрифте (нет «?» вместо букв)', () => {
    const fr = ASSETS.fonts.regular;
    const need = 'ООО «АЭРОХИТ» Республика Беларусь м³/ч ° Nу=0,55 кВт (расчёт) ВЦ 4-70-2,5 Dном Ёё № — 0123456789 +375 info@aeroheat.by';
    for (const ch of need) assert.ok(fr.cmap[ch.codePointAt(0)] !== undefined, 'нет глифа «' + ch + '»');
  }]);

  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
  }
  if (process.env.PODBOR_PDF_OUT) {
    const inp = input(2500, 350);
    const c = pick(inp, '4', 0.95, 1380);
    fs.writeFileSync(process.env.PODBOR_PDF_OUT, PodborPdf.build(PodborPdf.modelFromCandidate(c, inp, opts(c)), ASSETS));
    console.log('PDF сохранён: ' + process.env.PODBOR_PDF_OUT);
  }
  console.log(`${tests.length - failed} PASS, ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

run();
