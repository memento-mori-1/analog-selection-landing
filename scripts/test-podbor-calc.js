const assert = require('assert');
const PodborCalc = require('../podbor-calc.js');

function run() {
  const tests = [];

  tests.push(['evalQuadratic считает верно', () => {
    const p = PodborCalc.evalQuadratic({ a: -10, b: 5, c: 100 }, 2);
    assert.strictEqual(p, -10 * 4 + 5 * 2 + 100);
  }]);

  tests.push(['correctToFullPressure не трогает Полный расчёт', () => {
    const p = PodborCalc.correctToFullPressure({ qReqM3h: 6000, pReqPa: 1100, calcType: 'full', pdvCoeffC: 50 });
    assert.strictEqual(p, 1100);
  }]);

  tests.push(['correctToFullPressure прибавляет Pdv для Статического расчёта (единицы: тыс. м3/ч)', () => {
    // qReqM3h=6000 -> 6 тыс. м3/ч; Pdv = C * Q^2 = 50 * 36 = 1800
    const p = PodborCalc.correctToFullPressure({ qReqM3h: 6000, pReqPa: 1100, calcType: 'static', pdvCoeffC: 50 });
    assert.strictEqual(p, 1100 + 50 * 6 * 6);
  }]);

  tests.push(['РАЗБОР ЕДИНИЦ: кривая откалибрована в тыс. м3/ч, вход в м3/ч — не должно быть промаха в 1000 раз', () => {
    // кривая с диапазоном 0.4-0.9 тыс м3/ч (т.е. 400-900 м3/ч), пользователь вводит 6000 м3/ч
    const coeffs = { a: -100, b: 0, c: 200 }; // P=200 Па при Q=0
    const range = [0.40, 0.90];
    // при вводе 6000 м3/ч (=6 тыс) пересечение должно либо не найтись (вне диапазона),
    // либо считаться в правильных единицах — проверяем, что результат не в 1000 раз меньше/больше
    const result = PodborCalc.intersectWithNetwork(coeffs, range, 6000 / 1000, 1100);
    assert.ok(result === null || (result.qThousand >= 0.4 && result.qThousand <= 0.9));
  }]);

  tests.push(['intersectWithNetwork находит пересечение параболы сети с кривой', () => {
    // сеть: P = k*Q^2 с k = p0/q0^2; берём p0=100 при q0=1 -> k=100 (совпадает с сетью самой кривой при a=-100..)
    // подберём кривую и сеть так, чтобы пересечение было заведомо в Q=1, P=100
    const coeffs = { a: 0, b: 0, c: 100 }; // P=100 всегда (горизонтальная кривая)
    const range = [0.1, 5];
    const result = PodborCalc.intersectWithNetwork(coeffs, range, 1, 100); // сеть: P=100*(Q/1)^2, при Q=1 P=100 — совпадает с кривой в Q=1
    assert.ok(result !== null);
    assert.ok(Math.abs(result.qThousand - 1) < 0.01);
    assert.ok(Math.abs(result.pPa - 100) < 0.5);
  }]);

  tests.push(['intersectWithNetwork возвращает null, если пересечение вне диапазона кривой', () => {
    const coeffs = { a: 0, b: 0, c: 100 };
    const range = [2, 5]; // Q=1 вне диапазона
    const result = PodborCalc.intersectWithNetwork(coeffs, range, 1, 100);
    assert.strictEqual(result, null);
  }]);

  tests.push(['interpolateSamples интерполирует линейно и возвращает null вне диапазона', () => {
    const samples = [{ q: 1, eta: 0.5 }, { q: 2, eta: 0.7 }];
    assert.strictEqual(PodborCalc.interpolateSamples(samples, 1.5), 0.6);
    assert.strictEqual(PodborCalc.interpolateSamples(samples, 10), null);
  }]);

  tests.push(['pickMotor выбирает наименьший подходящий двигатель с учётом резерва', () => {
    const motors = [
      { nominalKw: 1.1, type: 'A' },
      { nominalKw: 1.5, type: 'B' },
      { nominalKw: 2.2, type: 'C' }
    ];
    // требуется 1.2 кВт на валу, резерв 10% -> нужно >= 1.32 кВт -> должен выбрать 1.5 (B)
    const motor = PodborCalc.pickMotor(motors, 1.2, 10);
    assert.strictEqual(motor.type, 'B');
  }]);

  tests.push(['pickMotor возвращает null, если ни один двигатель не хватает', () => {
    const motors = [{ nominalKw: 1.1, type: 'A' }];
    assert.strictEqual(PodborCalc.pickMotor(motors, 5, 0), null);
  }]);

  tests.push(['selectCandidates: НЕТ кандидатов вне диапазона — честный пустой список, не ошибка', () => {
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: { pdvAxis: null }, curves: [
      { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.4, 0.9], coeffs: { a: -100, b: 0, c: 150 }, motors: [{ nominalKw: 0.5, type: 'M' }], etaSamples: [{ q: 0.4, eta: 0.6 }, { q: 0.9, eta: 0.7 }], powerSamples: [] }
    ] }] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 50000, pReqPa: 100000, calcType: 'full', upPct: 30, downPct: 15, marginPct: 0 });
    assert.deepStrictEqual(result, []);
  }]);

  tests.push(['airDensityRatio: при 20°C коэффициент = 1, при нагреве — меньше 1', () => {
    assert.strictEqual(PodborCalc.airDensityRatio(20), 1);
    assert.ok(PodborCalc.airDensityRatio(80) < 1);
    assert.ok(PodborCalc.airDensityRatio(-20) > 1);
  }]);

  tests.push(['selectCandidates учитывает температуру: горячий воздух -> меньшее фактическое давление на той же кривой', () => {
    const curve = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0, 10], coeffs: { a: 0, b: 0, c: 1000 }, motors: [{ nominalKw: 10, type: 'M' }], etaSamples: [], powerSamples: [] };
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [curve] }] } } };
    const cold = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 1000, calcType: 'full', upPct: 0, downPct: 100, marginPct: 0, tempC: 20 });
    const hot = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 1000, calcType: 'full', upPct: 0, downPct: 100, marginPct: 0, tempC: 80 });
    assert.strictEqual(cold.length, 1);
    assert.strictEqual(hot.length, 1);
    assert.ok(hot[0].pFactPa < cold[0].pFactPa, `ожидали меньшее давление при 80°C (${hot[0].pFactPa}) чем при 20°C (${cold[0].pFactPa})`);
  }]);

  tests.push(['workingRange: нарисованный участок кривой имеет приоритет над таблицей, таблица — запасной вариант', () => {
    assert.deepStrictEqual(PodborCalc.workingRange({ qRangeThousand: [0.4, 0.9] }), [0.4, 0.9]);
    assert.deepStrictEqual(PodborCalc.workingRange({ qRangeThousand: [0.4, 0.9], qRangeGraph: [0.43, 0.874] }), [0.43, 0.874]);
    assert.deepStrictEqual(PodborCalc.workingRange({ qRangeThousand: [1.6, 4.0], qRangeGraph: [1.6, 4.21] }), [1.6, 4.21]);
  }]);

  tests.push(['installedPowerFactor: ступени стандартных коэффициентов запаса', () => {
    assert.strictEqual(PodborCalc.installedPowerFactor(0.3), 1.5);
    assert.strictEqual(PodborCalc.installedPowerFactor(0.7), 1.3);
    assert.strictEqual(PodborCalc.installedPowerFactor(1.5), 1.2);
    assert.strictEqual(PodborCalc.installedPowerFactor(3), 1.15);
    assert.strictEqual(PodborCalc.installedPowerFactor(6), 1.1);
  }]);

  tests.push(['selectCandidates: ЗА пределами диапазона таблицы двигатель подбирается только по графику (вал ≤ допустимого для двигателя)', () => {
    // P=1000 Па на всём диапазоне, сеть через (1 тыс. м3/ч, 1000 Па) -> пересечение Q=1, P=1000
    // КПД 0.6 -> вал = 1000*1000/(3.6e6*0.6) = 0.463 кВт; 0.55 кВт несёт по валу 0.55/1.29 = 0.426 (с допуском 0.439) -> не проходит, 0.75 проходит
    // Диапазон таблицы [0.1, 0.5] не содержит Q=1 (нарисованная кривая шире таблицы: qRangeGraph [0.1, 5]).
    const curve = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.1, 0.5], qRangeGraph: [0.1, 5], coeffs: { a: 0, b: 0, c: 1000 },
      motors: [{ nominalKw: 0.55, type: 'S' }, { nominalKw: 0.75, type: 'L' }],
      etaSamples: [{ q: 0.1, eta: 0.6 }, { q: 5, eta: 0.6 }], powerSamples: [] };
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [curve] }] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 1000, calcType: 'full', upPct: 10, downPct: 10, marginPct: 0 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].inTableRange, false);
    assert.ok(Math.abs(result[0].shaftKw - 0.463) < 0.005);
    assert.ok(Math.abs(result[0].installedKw - 0.463 * PodborCalc.nominalFactor(0.75)) < 0.005);
    assert.strictEqual(result[0].motor.type, 'L');
    assert.strictEqual(result[0].motorBasis, 'graph');
  }]);

  tests.push(['selectCandidates: в пределах таблицы и график проходит — берётся наименьший двигатель строки (0,55 кВт при вале 0,417 кВт)', () => {
    // P=900 Па -> вал = 900*1000/(3.6e6*0.6) = 0.4167 кВт <= 0.55/1.29*1.03 = 0.439 -> 0.55 проходит и по графику, и по таблице
    const curve = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.1, 5], coeffs: { a: 0, b: 0, c: 900 },
      motors: [{ nominalKw: 0.75, type: 'L' }, { nominalKw: 0.55, type: 'S' }],
      etaSamples: [{ q: 0.1, eta: 0.6 }, { q: 5, eta: 0.6 }], powerSamples: [] };
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [curve] }] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 900, calcType: 'full', upPct: 10, downPct: 10, marginPct: 0 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].inTableRange, true);
    assert.strictEqual(result[0].motor.type, 'S');
    assert.strictEqual(result[0].motorBasis, 'graph+table');
    assert.ok(result[0].installedKw <= 0.55 * 1.03);
  }]);

  tests.push(['selectCandidates: таблица перечисляет 0,55 кВт, но график его не пропускает (вал 0,463 кВт) — берётся 0,75 кВт, согласованный с обоими', () => {
    const curve = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.1, 5], coeffs: { a: 0, b: 0, c: 1000 },
      motors: [{ nominalKw: 0.55, type: 'S' }, { nominalKw: 0.75, type: 'L' }],
      etaSamples: [{ q: 0.1, eta: 0.6 }, { q: 5, eta: 0.6 }], powerSamples: [] };
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [curve] }] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 1000, calcType: 'full', upPct: 10, downPct: 10, marginPct: 0 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].inTableRange, true);
    assert.strictEqual(result[0].motor.type, 'L');
    assert.strictEqual(result[0].motorBasis, 'graph+table');
  }]);

  tests.push(['selectCandidates: мощности не хватает ни одному двигателю строки — motor=null, установочная мощность показана', () => {
    const curve = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.1, 5], coeffs: { a: 0, b: 0, c: 5000 },
      motors: [{ nominalKw: 0.55, type: 'S' }, { nominalKw: 0.75, type: 'L' }],
      etaSamples: [{ q: 0.1, eta: 0.6 }, { q: 5, eta: 0.6 }], powerSamples: [] };
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [curve] }] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 5000, calcType: 'full', upPct: 10, downPct: 10, marginPct: 0 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].motor, null);
    assert.strictEqual(result[0].motorBasis, null);
    assert.ok(result[0].installedKw > 0.75);
  }]);

  tests.push(['коэффициент запаса каталога: узлы измерены по нарисованным дугам, между узлами — по log(номинала)', () => {
    assert.strictEqual(PodborCalc.nominalFactor(0.55), 1.29);
    assert.strictEqual(PodborCalc.nominalFactor(0.75), 1.3);
    assert.strictEqual(PodborCalc.nominalFactor(0.01), 1.49);
    assert.strictEqual(PodborCalc.nominalFactor(100), 1.1);
    const mid = PodborCalc.nominalFactor(0.65);
    assert.ok(mid > 1.29 && mid < 1.3 + 1e-9, String(mid));
    assert.ok(Math.abs(PodborCalc.shaftCapacityKw(0.55) - 0.55 / 1.29) < 1e-9);
  }]);

  tests.push(['selectCandidates: не выходит за нарисованный участок кривой (qRangeGraph)', () => {
    const curve = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.1, 5], qRangeGraph: [0.4, 0.8], coeffs: { a: 0, b: 0, c: 1000 },
      motors: [{ nominalKw: 5, type: 'M' }], etaSamples: [{ q: 0.4, eta: 0.6 }, { q: 0.8, eta: 0.6 }], powerSamples: [] };
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [curve] }] } } };
    // пересечение с сетью через (1, 1000) лежит в Q=1 — вне нарисованного участка [0.4, 0.8]
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 1000, calcType: 'full', upPct: 50, downPct: 50, marginPct: 0 });
    assert.deepStrictEqual(result, []);
  }]);

  tests.push(['selectCandidates: сортирует по КПД по убыванию', () => {
    const curveLow = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0, 10], coeffs: { a: 0, b: 0, c: 100 }, motors: [{ nominalKw: 10, type: 'M' }], etaSamples: [{ q: 0, eta: 0.4 }, { q: 10, eta: 0.4 }], powerSamples: [] };
    const curveHigh = { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0, 10], coeffs: { a: 0, b: 0, c: 100 }, motors: [{ nominalKw: 10, type: 'M' }], etaSamples: [{ q: 0, eta: 0.8 }, { q: 10, eta: 0.8 }], powerSamples: [] };
    const data = { typorazmery: { '2,5': { diameters: [
      { d: 0.9, graphImage: 'a', calibration: {}, curves: [curveLow] },
      { d: 1.1, graphImage: 'b', calibration: {}, curves: [curveHigh] }
    ] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 1000, pReqPa: 100, calcType: 'full', upPct: 50, downPct: 50, marginPct: 0 });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].diameter, 1.1);
    assert.strictEqual(result[1].diameter, 0.9);
  }]);

  // ---- Интеграционные тесты на РЕАЛЬНЫХ данных (podbor-data.js) ----
  // Файл — браузерный (window.PODBOR_DATA), поэтому в Node подсовываем заглушку window.
  global.window = global.window || {};
  require('../podbor-data.js');
  const REAL = global.window.PODBOR_DATA;
  const realInput = (q, p, extra) => Object.assign({ qReqM3h: q, pReqPa: p, calcType: 'full', upPct: 30, downPct: 15, marginPct: 0 }, extra || {});

  // Ищет кривую кандидата в реальных данных по (типоразмер, диаметр, rpmActual)
  function findRealCurve(c) {
    const dia = REAL.typorazmery[c.typorazmer].diameters.find((d) => d.d === c.diameter);
    return dia.curves.find((cv) => cv.rpmActual === c.rpmActual && cv.rpmNominal === c.rpmNominal);
  }

  tests.push(['REAL: Q=650 м3/ч, P=135 Па (полное, 30/15 %) даёт кандидата типоразмера 2,5', () => {
    const r = PodborCalc.selectCandidates(REAL, realInput(650, 135));
    assert.ok(r.length >= 1);
    assert.ok(r.some((c) => c.typorazmer === '2,5'), 'нет кандидата 2,5');
    // фактическая точка близка к запрошенной (в рамках допуска 30/15 % по давлению)
    for (const c of r) {
      assert.ok(c.pFactPa >= 135 * 0.85 - 1e-9 && c.pFactPa <= 135 * 1.3 + 1e-9, `pFact ${c.pFactPa} вне допуска`);
    }
  }]);

  tests.push(['REAL: абсурдный запрос (500000 м3/ч, 100000 Па) даёт пустой список', () => {
    assert.deepStrictEqual(PodborCalc.selectCandidates(REAL, realInput(500000, 100000)), []);
  }]);

  tests.push(['REAL: qFact в рабочем диапазоне кривой, eta в (0,1), нет NaN/undefined; отсортировано по eta убыванию (null в конце)', () => {
    const inputs = [realInput(650, 135), realInput(1400, 240), realInput(3000, 450), realInput(1300, 640), realInput(2900, 1080, { tempC: 60 }), realInput(1300, 640, { calcType: 'static' })];
    for (const inp of inputs) {
      const r = PodborCalc.selectCandidates(REAL, inp);
      for (const c of r) {
        const [qMin, qMax] = PodborCalc.workingRange(findRealCurve(c));
        assert.ok(c.qFactM3h / 1000 >= qMin - 1e-9 && c.qFactM3h / 1000 <= qMax + 1e-9, `qFact ${c.qFactM3h} вне [${qMin}, ${qMax}]`);
        for (const k of ['qFactM3h', 'pFactPa', 'targetQThousand', 'targetPPa']) {
          assert.ok(Number.isFinite(c[k]), `${k} не число: ${c[k]}`);
        }
        if (c.eta !== null) assert.ok(c.eta > 0 && c.eta < 1, `eta вне (0,1): ${c.eta}`);
        // честный null: shaftKw/installedKw либо оба числа, либо оба null; motor только при известной мощности
        for (const k of ['shaftKw', 'installedKw']) assert.ok(c[k] === null || Number.isFinite(c[k]), `${k}: ${c[k]}`);
        assert.strictEqual(c.eta === null, c.shaftKw === null);
        assert.strictEqual(c.shaftKw === null, c.installedKw === null);
        // двигатель без известной мощности возможен только из таблицы каталога (точка в её диапазоне)
        if (c.installedKw === null && !c.inTableRange) assert.strictEqual(c.motor, null);
        if (c.motor) assert.ok(['graph+table', 'graph', 'table'].includes(c.motorBasis), String(c.motorBasis));
        if (c.motor && c.motorBasis !== 'table') assert.ok(c.shaftKw <= PodborCalc.shaftCapacityKw(c.motor.nominalKw) * 1.03 + 1e-9);
        assert.ok(c.motor === null || Number.isFinite(c.motor.nominalKw));
      }
      // реализация: eta по убыванию, кандидаты с eta === null — в конце
      for (let i = 1; i < r.length; i++) {
        const prev = r[i - 1].eta === null ? -1 : r[i - 1].eta;
        const cur = r[i].eta === null ? -1 : r[i].eta;
        assert.ok(prev >= cur, `нарушена сортировка: ${prev} < ${cur}`);
      }
    }
  }]);

  tests.push(['REAL: кандидат без КПД (край рабочего участка) несёт двигатели каталога; motor — из таблицы, если точка в её диапазоне', () => {
    // 4, D=0.95, n=880: замеры КПД начинаются с Q=1.42 тыс. м3/ч, а нарисованная кривая — от 1.17
    const r = PodborCalc.selectCandidates(REAL, realInput(1330, 180));
    const noEta = r.filter((c) => c.eta === null);
    assert.ok(noEta.length >= 1, 'на этом входе ожидался хотя бы один кандидат без КПД');
    for (const c of noEta) {
      const cv = findRealCurve(c);
      assert.ok(Array.isArray(c.catalogMotors) && c.catalogMotors.length >= 1);
      assert.deepStrictEqual(c.catalogMotors, cv.motors);
      // без КПД мощность не считается, поэтому двигатель бывает только «по таблице» и только в её диапазоне
      if (c.motor) { assert.strictEqual(c.motorBasis, 'table'); assert.strictEqual(c.inTableRange, true); }
      else assert.strictEqual(c.inTableRange, false);
    }
    // и у кандидатов с КПД поле тоже есть — UI показывает его только при eta === null
    for (const c of r.filter((x) => x.eta !== null)) assert.deepStrictEqual(c.catalogMotors, findRealCurve(c).motors);
  }]);

  tests.push(['REAL: точка 2500 м3/ч, 350 Па — ВЦ 4-70-4 D=0,95 n=1380 получает 0,55 кВт: согласуется и с графиком (дуга 0,55 рассчитана), и с таблицей', () => {
    const r = PodborCalc.selectCandidates(REAL, realInput(2500, 350));
    const c = r.find((x) => x.typorazmer === '4' && x.diameter === 0.95 && x.rpmActual === 1380);
    assert.ok(c, 'нет кандидата 4, D=0,95, n=1380');
    // таблица каталога: 1,80–4,20 тыс. м3/ч, 415–220 Па, двигатели 0,55 и 0,75 кВт — оба на весь диапазон
    assert.strictEqual(c.inTableRange, true);
    assert.strictEqual(c.motor.nominalKw, 0.55);
    assert.strictEqual(c.motorBasis, 'graph+table');
    // график: вал 0,415 кВт при допустимых для 0,55 кВт 0,426; справочная установочная мощность не выше номинала
    assert.ok(c.shaftKw <= PodborCalc.shaftCapacityKw(0.55));
    assert.ok(c.installedKw <= 0.55 + 1e-9);
    // расчётная дуга 0,55 кВт для графика построена
    assert.ok(c.nyArc && c.nyArc.nominalKw === 0.55 && c.nyArc.points.length >= 10);
  }]);

  tests.push(['REAL: расчётная дуга мощности — вдоль неё мощность на валу постоянна и равна заданной (метод P=a·Q², η по линиям КПД)', () => {
    const dia = REAL.typorazmery['4'].diameters.find((d) => d.d === 0.95);
    const target = 0.5;
    const pts = PodborCalc.powerArcPoints(dia.etaField, target);
    assert.ok(pts.length >= 50);
    for (const [q, p] of pts) {
      const eta = PodborCalc.etaAtA(dia.etaField, p / (q * q));
      assert.ok(eta > 0.6 && eta < 0.8, 'eta ' + eta);
      assert.ok(Math.abs((p * q) / (3600 * eta) - target) < 1e-6);
    }
    // проверка по нарисованной дуге Nу=0,75 кВт (K'=1,30 → вал 0,577): дуга должна проходить через точку Q≈3,6, P≈430
    // (снято с нарисованной синей дуги графика D=0,95; допуск 6 %)
    const arc = PodborCalc.powerArcPoints(dia.etaField, 0.75 / 1.3, 200);
    const near = arc.reduce((best, pt) => (Math.abs(Math.log(pt[0] / 3.6)) < Math.abs(Math.log(best[0] / 3.6)) ? pt : best), arc[0]);
    assert.ok(Math.abs(near[1] / 430 - 1) < 0.06, 'P на дуге при Q≈' + near[0].toFixed(2) + ' = ' + near[1].toFixed(0));
  }]);

  tests.push(['REAL: у каждого графика есть рамка поля (plotFrame) внутри картинки и поле КПД для расчёта дуг', () => {
    for (const [key, t] of Object.entries(REAL.typorazmery)) {
      for (const dia of t.diameters) {
        const f = dia.calibration.plotFrame;
        const cal = dia.calibration;
        assert.ok(Array.isArray(f) && f.length === 4, `${key} D=${dia.d}: нет plotFrame`);
        assert.ok(f[0] >= 0 && f[1] >= 0 && f[2] <= cal.imageWidth && f[3] <= cal.imageHeight && f[2] > f[0] && f[3] > f[1], `${key} D=${dia.d}: рамка вне картинки`);
        assert.ok(Array.isArray(dia.etaField) && dia.etaField.length >= 5, `${key} D=${dia.d}: нет поля КПД`);
        // поле КПД — колокол: значения растут к середине, потом падают (защита от перепутанных подписей КПД)
        const e = dia.etaField.map((r) => r[1]);
        const peak = e.indexOf(Math.max(...e));
        for (let i = 1; i <= peak; i++) assert.ok(e[i] >= e[i - 1] - 1e-9, `${key} D=${dia.d}: КПД не растёт до пика: ${e}`);
        for (let i = peak + 1; i < e.length; i++) assert.ok(e[i] <= e[i - 1] + 1e-9, `${key} D=${dia.d}: КПД не падает после пика: ${e}`);
      }
    }
  }]);

  tests.push(['REAL: середина кривой 3,15 (D=1, n=1350: Q=1400, P=240) и 4 (D=1, n=1380: Q=3000, P=450) даёт кандидатов своего типоразмера', () => {
    const r315 = PodborCalc.selectCandidates(REAL, realInput(1400, 240));
    assert.ok(r315.some((c) => c.typorazmer === '3,15'));
    const r4 = PodborCalc.selectCandidates(REAL, realInput(3000, 450));
    assert.ok(r4.some((c) => c.typorazmer === '4'));
  }]);

  // ---- Статический расчёт без откалиброванной оси Pdv (Fix round 1) ----
  // Синтетические данные: горизонтальная кривая P=1000 Па; один диаметр с осью Pdv, второй без неё
  // (разные варианты «отсутствия»: null, нет поля, не число, <=0).
  const flatCurve = () => ({ rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.1, 5], coeffs: { a: 0, b: 0, c: 1000 },
    motors: [{ nominalKw: 5, type: 'M' }], etaSamples: [{ q: 0.1, eta: 0.6 }, { q: 5, eta: 0.6 }], powerSamples: [] });
  const noPdvData = () => ({ typorazmery: { '2,5': { diameters: [
    { d: 0.9, graphImage: 'a', calibration: { pdvAxis: { coeffC: 0 } }, curves: [flatCurve()] },
    { d: 1.0, graphImage: 'b', calibration: { pdvAxis: { coeffC: 20 } }, curves: [flatCurve()] },
    { d: 1.1, graphImage: 'c', calibration: { pdvAxis: null }, curves: [flatCurve()] }
  ] }, '3,15': { diameters: [
    { d: 0.9, graphImage: 'd', calibration: {}, curves: [flatCurve()] },
    { d: 1.0, graphImage: 'e', curves: [flatCurve()] },
    { d: 1.05, graphImage: 'f', calibration: { pdvAxis: { coeffC: 'x' } }, curves: [flatCurve()] },
    { d: 1.1, graphImage: 'g', calibration: { pdvAxis: { coeffC: 15 } }, curves: [flatCurve()] }
  ] } } });
  const wideInput = (calcType) => ({ qReqM3h: 1000, pReqPa: 500, calcType, upPct: 1000, downPct: 100, marginPct: 0 });

  tests.push(['selectCandidates: static + диаметр без оси Pdv пропускается, при full тот же диаметр участвует', () => {
    const data = noPdvData();
    const key = (c) => `${c.typorazmer}/${c.diameter}`;
    const stat = PodborCalc.selectCandidates(data, wideInput('static')).map(key).sort();
    const full = PodborCalc.selectCandidates(data, wideInput('full')).map(key).sort();
    assert.deepStrictEqual(stat, ['2,5/1', '3,15/1.1']);
    assert.deepStrictEqual(full, ['2,5/0.9', '2,5/1', '2,5/1.1', '3,15/0.9', '3,15/1', '3,15/1.05', '3,15/1.1']);
  }]);

  tests.push(['staticUnavailable: перечисляет ровно диаметры без валидной оси Pdv, в порядке обхода данных', () => {
    assert.deepStrictEqual(PodborCalc.staticUnavailable(noPdvData()), [
      { typorazmer: '2,5', diameter: 0.9 },
      { typorazmer: '2,5', diameter: 1.1 },
      { typorazmer: '3,15', diameter: 0.9 },
      { typorazmer: '3,15', diameter: 1 },
      { typorazmer: '3,15', diameter: 1.05 }
    ]);
  }]);

  tests.push(['REAL: staticUnavailable на реальных данных пуст (все оси Pdv откалиброваны)', () => {
    assert.deepStrictEqual(PodborCalc.staticUnavailable(REAL), []);
  }]);

  tests.push(['REAL: static даёт targetPPa больше, чем full, ровно на coeffC·Q² (Q в тыс. м3/ч)', () => {
    const q = 1300, p = 640;
    const full = PodborCalc.selectCandidates(REAL, realInput(q, p, { calcType: 'full' }));
    const stat = PodborCalc.selectCandidates(REAL, realInput(q, p, { calcType: 'static' }));
    assert.ok(full.length > 0 && stat.length > 0);
    const seen = new Set();
    for (const c of stat) {
      const dia = REAL.typorazmery[c.typorazmer].diameters.find((d) => d.d === c.diameter);
      const coeffC = dia.calibration.pdvAxis.coeffC;
      assert.ok(coeffC > 0);
      const f = full.find((x) => x.typorazmer === c.typorazmer && x.diameter === c.diameter);
      const fullTarget = f ? f.targetPPa : p;
      assert.ok(c.targetPPa > fullTarget, `static ${c.targetPPa} не больше full ${fullTarget}`);
      assert.ok(Math.abs(c.targetPPa - fullTarget - coeffC * (q / 1000) * (q / 1000)) < 1e-6, `превышение не равно coeffC·Q²`);
      seen.add(c.typorazmer + '/' + c.diameter);
    }
    assert.ok(seen.size > 0);
  }]);

  // ---- Pdv и температура: ось Pdv снята при 20°C, Pdv ∝ плотности воздуха (Final fix wave, A) ----
  tests.push(['correctToFullPressure: Pdv масштабируется по densityRatio; по умолчанию 1', () => {
    const base = { qReqM3h: 6000, pReqPa: 1100, calcType: 'static', pdvCoeffC: 50 };
    assert.ok(Math.abs(PodborCalc.correctToFullPressure(base) - (1100 + 50 * 36)) < 1e-9);
    assert.ok(Math.abs(PodborCalc.correctToFullPressure(Object.assign({}, base, { densityRatio: 0.8 })) - (1100 + 50 * 36 * 0.8)) < 1e-9);
    assert.strictEqual(PodborCalc.correctToFullPressure({ qReqM3h: 6000, pReqPa: 1100, calcType: 'full', pdvCoeffC: 50, densityRatio: 0.8 }), 1100);
  }]);

  tests.push(['selectCandidates: static при tempC=80 и -30: targetPPa - pReqPa = coeffC·Q²·airDensityRatio(t) (синтетика и реальные данные)', () => {
    const q = 2000, qT = q / 1000;
    for (const t of [80, -30, 20]) {
      const ratio = PodborCalc.airDensityRatio(t);
      const syn = PodborCalc.selectCandidates(noPdvData(), Object.assign(wideInput('static'), { qReqM3h: q, tempC: t }));
      assert.ok(syn.length > 0, 'синтетика: нет кандидатов при t=' + t);
      for (const c of syn) {
        const dia = noPdvData().typorazmery[c.typorazmer].diameters.find((d) => d.d === c.diameter);
        const coeffC = dia.calibration.pdvAxis.coeffC;
        assert.ok(Math.abs(c.targetPPa - 500 - coeffC * qT * qT * ratio) < 1e-6, 't=' + t + ': ' + c.targetPPa);
      }
      const real = PodborCalc.selectCandidates(REAL, realInput(1300, 640, { calcType: 'static', tempC: t, upPct: 500, downPct: 100 }));
      assert.ok(real.length > 0, 'реальные данные: нет кандидатов при t=' + t);
      for (const c of real) {
        const dia = REAL.typorazmery[c.typorazmer].diameters.find((d) => d.d === c.diameter);
        const coeffC = dia.calibration.pdvAxis.coeffC;
        assert.ok(Math.abs(c.targetPPa - 640 - coeffC * 1.3 * 1.3 * ratio) < 1e-6, 'REAL t=' + t + ': ' + c.targetPPa);
      }
    }
  }]);

  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`PASS ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}: ${e.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

run();
