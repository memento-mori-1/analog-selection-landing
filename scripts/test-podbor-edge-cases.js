const assert = require('assert');
const PodborCalc = require('../podbor-calc.js');

function run() {
  const tests = [];

  function makeData(diaOverrides, curveOverrides) {
    const curve = Object.assign({
      rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.4, 0.9],
      coeffs: { a: 0, b: 0, c: 500 },
      motors: [{ nominalKw: 0.2, type: 'M' }],
      etaSamples: [], powerSamples: []
    }, curveOverrides);
    const dia = Object.assign({ d: 1.0, graphImage: 'x', calibration: {}, curves: [curve] }, diaOverrides);
    return { typorazmery: { '2,5': { diameters: [dia] } } };
  }

  const baseInput = { qReqM3h: 600, pReqPa: 500, calcType: 'full', upPct: 30, downPct: 15, marginPct: 0 };

  tests.push(['Нулевой допуск отсекает кандидата, чьё давление отличается от цели; допуск 30% вверх его пропускает', () => {
    // Кривая P = -500·Q² + 1000, сеть через (0,6 тыс. м³/ч; 600 Па): P = 600·(Q/0,6)².
    // Пересечение: 1000 - 500·Q² = (600/0,36)·Q²  =>  Q² = 1000 / (500 + 600/0,36).
    const data = makeData({}, { coeffs: { a: -500, b: 0, c: 1000 }, motors: [{ nominalKw: 5, type: 'M' }] });
    const k = 600 / (0.6 * 0.6);
    const qExpected = Math.sqrt(1000 / (500 + k));
    const pExpected = -500 * qExpected * qExpected + 1000;
    assert.ok(qExpected >= 0.4 && qExpected <= 0.9, 'пересечение должно лежать в рабочем диапазоне Q');
    assert.ok(Math.abs(pExpected - 600) > 100, 'давление пересечения должно заметно отличаться от цели');
    const input = { qReqM3h: 600, pReqPa: 600, calcType: 'full', marginPct: 0 };
    // (2) допуск вверх 30% пропускает кандидата: пересечение реально есть (иначе (1) было бы вакуумным)
    const withUp = PodborCalc.selectCandidates(data, Object.assign({}, input, { upPct: 30, downPct: 0 }));
    assert.strictEqual(withUp.length, 1);
    assert.ok(Math.abs(withUp[0].pFactPa - pExpected) < 0.5, 'pFactPa=' + withUp[0].pFactPa + ', ожидалось ' + pExpected);
    assert.ok(Math.abs(withUp[0].qFactM3h - qExpected * 1000) < 1, 'qFactM3h=' + withUp[0].qFactM3h);
    // (1) нулевой допуск: то же пересечение (~769 Па) не равно цели 600 Па, значит кандидата нет
    const zero = PodborCalc.selectCandidates(data, Object.assign({}, input, { upPct: 0, downPct: 0 }));
    assert.strictEqual(zero.length, 0);
  }]);

  tests.push(['Статика для диаметра без оцифрованной оси Pdv: диаметр пропускается, исключение не бросается', () => {
    const data = makeData({ calibration: { pdvAxis: null } }, {
      etaSamples: [{ q: 0.4, eta: 0.5 }, { q: 0.9, eta: 0.6 }]
    });
    let result;
    assert.doesNotThrow(() => {
      result = PodborCalc.selectCandidates(data, Object.assign({}, baseInput, { calcType: 'static' }));
    });
    assert.deepStrictEqual(result, []);
    // тот же диаметр при полном расчёте проходит — значит, пустой результат именно из-за статики
    const full = PodborCalc.selectCandidates(data, baseInput);
    assert.strictEqual(full.length, 1);
    // причина отключения видна через staticUnavailable
    assert.deepStrictEqual(PodborCalc.staticUnavailable(data), [{ typorazmer: '2,5', diameter: 1.0 }]);
  }]);

  tests.push(['Кандидат без КПД: eta, мощность на валу и установочная = null; двигатель — только из таблицы каталога, не выдуманный', () => {
    const data = makeData({}, { etaSamples: [] });
    const result = PodborCalc.selectCandidates(data, baseInput);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].eta, null);
    assert.strictEqual(result[0].shaftKw, null);
    assert.strictEqual(result[0].installedKw, null);
    // точка внутри диапазона таблицы → двигатель берётся из строки каталога (число не придумано)
    assert.strictEqual(result[0].inTableRange, true);
    assert.strictEqual(result[0].motorBasis, 'table');
    assert.ok(result[0].motor && result[0].catalogMotors.some((m) => m.type === result[0].motor.type));
  }]);

  tests.push(['Кандидат без КПД ЗА пределами диапазона таблицы: мотор = null (ни расчёта, ни таблицы, подставлять нечего)', () => {
    // таблица покрывает только [0.1, 0.3], нарисованная кривая — [0.4, 0.9]; точка Q=0.6 вне таблицы
    const data = makeData({}, { etaSamples: [], qRangeThousand: [0.1, 0.3], qRangeGraph: [0.4, 0.9] });
    const result = PodborCalc.selectCandidates(data, baseInput);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].inTableRange, false);
    assert.strictEqual(result[0].motor, null);
    assert.strictEqual(result[0].motorBasis, null);
  }]);

  tests.push(['КПД равен 0 или отрицателен: eta=null (КПД не подтверждён), а не eta=0 при shaftKw=null', () => {
    for (const badEta of [0, -0.1]) {
      const data = makeData({}, { etaSamples: [{ q: 0.4, eta: badEta }, { q: 0.9, eta: badEta }] });
      const result = PodborCalc.selectCandidates(data, baseInput);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].eta, null, 'eta=' + badEta);
      assert.strictEqual(result[0].shaftKw, null);
      assert.strictEqual(result[0].installedKw, null);
      assert.strictEqual(result[0].motorBasis, 'table', 'без КПД двигатель возможен только из таблицы');
    }
  }]);

  tests.push(['Инвариант: eta === null тогда и только тогда, когда shaftKw === null', () => {
    const variants = [[], [{ q: 0.4, eta: 0 }, { q: 0.9, eta: 0 }], [{ q: 0.4, eta: 0.5 }, { q: 0.9, eta: 0.6 }]];
    for (const etaSamples of variants) {
      const result = PodborCalc.selectCandidates(makeData({}, { etaSamples }), baseInput);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].eta === null, result[0].shaftKw === null);
    }
  }]);

  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
  }
  console.log(`${tests.length - failed} PASS, ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

run();
