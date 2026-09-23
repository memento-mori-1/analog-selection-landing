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

  tests.push(['Отклонение 0% не находит кандидатов, если точное совпадение маловероятно', () => {
    const data = makeData({}, { coeffs: { a: -50, b: 0, c: 150 } });
    // заданная точка сильно не совпадает с кривой
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 500, pReqPa: 900, calcType: 'full', upPct: 0, downPct: 0, marginPct: 0 });
    assert.strictEqual(result.length, 0);
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

  tests.push(['Кандидат без КПД получает eta=null, мощность=null и мотор=null, а не выдуманное число', () => {
    const data = makeData({}, { etaSamples: [] });
    const result = PodborCalc.selectCandidates(data, baseInput);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].eta, null);
    assert.strictEqual(result[0].shaftKw, null);
    assert.strictEqual(result[0].installedKw, null);
    assert.strictEqual(result[0].motor, null);
  }]);

  tests.push(['КПД равен 0 или отрицателен: eta=null (КПД не подтверждён), а не eta=0 при shaftKw=null', () => {
    for (const badEta of [0, -0.1]) {
      const data = makeData({}, { etaSamples: [{ q: 0.4, eta: badEta }, { q: 0.9, eta: badEta }] });
      const result = PodborCalc.selectCandidates(data, baseInput);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].eta, null, 'eta=' + badEta);
      assert.strictEqual(result[0].shaftKw, null);
      assert.strictEqual(result[0].installedKw, null);
      assert.strictEqual(result[0].motor, null);
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
