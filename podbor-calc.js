(function (root) {
  function evalQuadratic(coeffs, x) {
    return coeffs.a * x * x + coeffs.b * x + coeffs.c;
  }

  // Ось Pdv снята при 20°C, а Pdv = ρ·v²/2 пропорционально плотности воздуха: при другой температуре
  // Pdv умножается на densityRatio (= ρ_t/ρ_20, см. airDensityRatio); по умолчанию 1 (20°C).
  function correctToFullPressure({ qReqM3h, pReqPa, calcType, pdvCoeffC, densityRatio }) {
    if (calcType !== 'static') return pReqPa;
    const qThousand = qReqM3h / 1000;
    const pdv = pdvCoeffC * qThousand * qThousand * (densityRatio != null ? densityRatio : 1);
    return pReqPa + pdv;
  }

  // Каталожные кривые сняты при стандартной температуре воздуха 20°C (подпись "t=20°C" на
  // каждом графике). Давление, которое реально развивает вентилятор, пропорционально плотности
  // воздуха (ρ ∝ 1/T при постоянном давлении) — более горячий воздух даёт меньшее фактическое
  // давление на той же точке кривой. Высота над уровнем моря в демо сознательно не учитывается
  // (за рамками объёма спека).
  function airDensityRatio(tempC) {
    const T0 = 273.15 + 20;
    const T = 273.15 + tempC;
    return T0 / T;
  }

  function intersectWithNetwork(coeffs, qRangeThousand, q0Thousand, p0Pa) {
    if (!q0Thousand || q0Thousand <= 0) return null;
    const k = p0Pa / (q0Thousand * q0Thousand);
    const A = coeffs.a - k;
    const B = coeffs.b;
    const C = coeffs.c;
    let roots = [];
    if (Math.abs(A) < 1e-9) {
      if (Math.abs(B) > 1e-9) roots = [-C / B];
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        roots = [(-B + sq) / (2 * A), (-B - sq) / (2 * A)];
      }
    }
    const [qMin, qMax] = qRangeThousand;
    const valid = roots.filter((q) => q >= qMin && q <= qMax && q > 0);
    if (valid.length === 0) return null;
    // если два корня в диапазоне — берём ближайший к заданной точке q0
    valid.sort((a, b) => Math.abs(a - q0Thousand) - Math.abs(b - q0Thousand));
    const q = valid[0];
    return { qThousand: q, pPa: evalQuadratic(coeffs, q) };
  }

  function interpolateSamples(samples, q) {
    if (!samples || samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a.q - b.q);
    if (q < sorted[0].q || q > sorted[sorted.length - 1].q) return null;
    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      if (q >= p1.q && q <= p2.q) {
        const key = 'eta' in p1 ? 'eta' : 'kw';
        const t = p2.q === p1.q ? 0 : (q - p1.q) / (p2.q - p1.q);
        return p1[key] + t * (p2[key] - p1[key]);
      }
    }
    return null;
  }

  // Рабочий диапазон Q кривой = реально нарисованный жирный участок кривой (qRangeGraph, Task 2-4).
  // Каталожная таблица округляет Q-диапазон одинаково для всех диаметров (в ней Qmax может быть
  // и меньше, и больше нарисованного конца), тогда как табличные давления совпадают с давлением
  // на нарисованных концах. График — первичный источник; таблица — запасной вариант, если
  // qRangeGraph нет. За нарисованный конец квадратику не экстраполируем.
  function workingRange(curve) {
    return curve.qRangeGraph ? [curve.qRangeGraph[0], curve.qRangeGraph[1]] : curve.qRangeThousand;
  }

  // Коэффициент запаса каталога K' по НОМИНАЛУ двигателя: N_ном = K'·N_вал в точке, где кривая касается дуги Nу
  // этого двигателя. Измерен по нарисованным синим дугам Nу (ВЦ 4-70-3,15 и 4-70-4, разброс K' вдоль одной дуги
  // ±3 %): 0,18 кВт → 1,50; 0,25 → 1,36–1,49; 0,37 → 1,36–1,49; 0,55 → 1,29; 0,75 → 1,30; 1,1 и 1,5 → 1,21;
  // 2,2 → 1,15; 5,5 и 7,5 → 1,10. Между узлами — линейно по log(номинала). Это оценка с погрешностью около ±5 %,
  // поэтому ниже добавлен допуск CAPACITY_TOLERANCE.
  const NOMINAL_K = [
    [0.12, 1.49], [0.18, 1.50], [0.25, 1.42], [0.37, 1.40], [0.55, 1.29], [0.75, 1.30],
    [1.1, 1.21], [1.5, 1.21], [2.2, 1.15], [5.5, 1.10], [7.5, 1.10]
  ];
  const CAPACITY_TOLERANCE = 1.03;

  function nominalFactor(nominalKw) {
    const t = NOMINAL_K;
    if (nominalKw <= t[0][0]) return t[0][1];
    if (nominalKw >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 0; i < t.length - 1; i++) {
      if (nominalKw >= t[i][0] && nominalKw <= t[i + 1][0]) {
        const f = (Math.log(nominalKw) - Math.log(t[i][0])) / (Math.log(t[i + 1][0]) - Math.log(t[i][0]));
        return t[i][1] + f * (t[i + 1][1] - t[i][1]);
      }
    }
    return t[t.length - 1][1];
  }

  // Наибольшая мощность на валу, которую двигатель номинала nominalKw несёт по каталогу (дуга Nу этого двигателя).
  function shaftCapacityKw(nominalKw) {
    return nominalKw / nominalFactor(nominalKw);
  }

  // Выбор двигателя, согласованный и с графиком, и с таблицей каталога.
  //  • Есть мощность на валу (КПД в точке известен): график — двигатель должен нести эту мощность
  //    (вал ≤ допустимого для него, с допуском на погрешность K'); таблица — двигатель перечислен в строке каталога
  //    для этой кривой (motors). Берём наименьший из подходящих. Дуга нужного двигателя на графике может быть
  //    не нанесена (например, 0,55 кВт у ВЦ 4-70-4, D=0,95): тогда график проверяется расчётом дуги, а таблица
  //    подтверждает, что двигатель для этой строки допустим.
  //  • Мощность неизвестна (точка за краем линий КПД): график проверить нельзя — если точка внутри диапазона
  //    строки таблицы, берём наименьший двигатель строки (таблица: подходит на весь диапазон), иначе двигателя нет.
  // basis: 'graph+table' — график и таблица; 'graph' — только график (точка вне диапазона таблицы);
  //        'table' — только таблица (график мощность не подтверждает).
  function chooseMotor(motors, shaftKw, inTable) {
    const sorted = [...(motors || [])].sort((a, b) => a.nominalKw - b.nominalKw);
    if (shaftKw != null) {
      const m = sorted.find((x) => shaftKw <= shaftCapacityKw(x.nominalKw) * CAPACITY_TOLERANCE);
      return m ? { motor: m, basis: inTable ? 'graph+table' : 'graph' } : { motor: null, basis: null };
    }
    if (inTable && sorted.length > 0) return { motor: sorted[0], basis: 'table' };
    return { motor: null, basis: null };
  }

  // КПД в любой точке поля графика: линии η — прямые P = a·Q², поэтому η однозначно определяется a = P/Q².
  // field — [[a, η], ...] по возрастанию a; вне крайних линий КПД неизвестен (null).
  function etaAtA(field, a) {
    const la = Math.log(a);
    if (!(a > 0) || la < Math.log(field[0][0]) || la > Math.log(field[field.length - 1][0])) return null;
    for (let i = 0; i < field.length - 1; i++) {
      const l0 = Math.log(field[i][0]);
      const l1 = Math.log(field[i + 1][0]);
      if (la >= l0 && la <= l1) return field[i][1] + ((la - l0) / (l1 - l0)) * (field[i + 1][1] - field[i][1]);
    }
    return null;
  }

  // Дуга постоянной мощности на валу N (кВт) в координатах графика каталога (20 °C): [[Q тыс. м³/ч, P Па], ...].
  // N = P·Q/(3600·η) [Q в тыс. м³/ч] и P = a·Q² дают Q = (3600·η·N/a)^(1/3). Дуга строится между крайними
  // линиями КПД — как нарисованные дуги Nу. Метод проверен на нарисованных дугах (0,25 и 0,75 кВт, ВЦ 4-70-4 D=0,95).
  function powerArcPoints(field, shaftKw, steps) {
    const n = steps || 60;
    const l0 = Math.log(field[0][0]);
    const l1 = Math.log(field[field.length - 1][0]);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = Math.exp(l0 + ((l1 - l0) * i) / n);
      const eta = etaAtA(field, a);
      if (eta == null) continue;
      const q = Math.cbrt((3600 * eta * shaftKw) / a);
      pts.push([q, a * q * q]);
    }
    return pts;
  }

  // Стандартные ступени запаса (старая оценка, в подборе больше не используется: заменена nominalFactor).
  function installedPowerFactor(shaftKw) {
    if (shaftKw < 0.5) return 1.5;
    if (shaftKw < 1) return 1.3;
    if (shaftKw < 2) return 1.2;
    if (shaftKw < 5) return 1.15;
    return 1.1;
  }

  function pickMotor(motors, shaftKw, marginPct) {
    const required = shaftKw * (1 + (marginPct || 0) / 100);
    const sorted = [...motors].sort((a, b) => a.nominalKw - b.nominalKw);
    return sorted.find((m) => m.nominalKw >= required) || null;
  }

  // Валидная ось Pdv: число coeffC > 0 в dia.calibration.pdvAxis; иначе null.
  function validPdvCoeffC(dia) {
    const c = dia.calibration && dia.calibration.pdvAxis ? dia.calibration.pdvAxis.coeffC : null;
    return typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : null;
  }

  // Q (тыс. м³/ч) лежит в диапазоне производительности строки таблицы каталога.
  function inTableRange(curve, qThousand) {
    const r = curve.qRangeThousand;
    return Array.isArray(r) && qThousand >= r[0] - 1e-9 && qThousand <= r[1] + 1e-9;
  }

  // Наименьший двигатель из перечисленных каталогом для кривой.
  function smallestMotor(motors) {
    return [...motors].sort((a, b) => a.nominalKw - b.nominalKw)[0] || null;
  }

  // Наибольший двигатель строки (или null, если двигателей нет).
  function largestMotor(motors) {
    const sorted = [...(motors || [])].sort((a, b) => a.nominalKw - b.nominalKw);
    return sorted[sorted.length - 1] || null;
  }

  // Диаметры, для которых статический расчёт недоступен (ось Pdv не откалибрована), в порядке
  // обхода данных. UI (Task 8) по ней показывает причину отключения статического варианта.
  function staticUnavailable(data) {
    const out = [];
    for (const [typorazmerKey, typorazmer] of Object.entries(data.typorazmery)) {
      for (const dia of typorazmer.diameters) {
        if (validPdvCoeffC(dia) === null) out.push({ typorazmer: typorazmerKey, diameter: dia.d });
      }
    }
    return out;
  }

  function selectCandidates(data, input) {
    const candidates = [];
    for (const [typorazmerKey, typorazmer] of Object.entries(data.typorazmery)) {
      for (const dia of typorazmer.diameters) {
        const pdvCoeffC = validPdvCoeffC(dia);
        // Статический расчёт без оси Pdv молча стал бы полным (заниженный вентилятор) — пропускаем.
        if (input.calcType === 'static' && pdvCoeffC === null) continue;
        const densityRatio = airDensityRatio(input.tempC != null ? input.tempC : 20);
        const pTarget = correctToFullPressure({
          qReqM3h: input.qReqM3h,
          pReqPa: input.pReqPa,
          calcType: input.calcType,
          pdvCoeffC: pdvCoeffC || 0,
          densityRatio
        });
        const q0Thousand = input.qReqM3h / 1000;
        for (const curve of dia.curves) {
          const scaledCoeffs = {
            a: curve.coeffs.a * densityRatio,
            b: curve.coeffs.b * densityRatio,
            c: curve.coeffs.c * densityRatio
          };
          const point = intersectWithNetwork(scaledCoeffs, workingRange(curve), q0Thousand, pTarget);
          if (!point) continue;
          const pMin = pTarget * (1 - (input.downPct || 0) / 100);
          const pMax = pTarget * (1 + (input.upPct || 0) / 100);
          if (point.pPa < pMin || point.pPa > pMax) continue;
          const etaRaw = interpolateSamples(curve.etaSamples, point.qThousand);
          // КПД <= 0 физически бессмыслен: считаем неподтверждённым, чтобы eta === null <=> shaftKw === null.
          const eta = etaRaw != null && etaRaw > 0 ? etaRaw : null;
          const shaftKw = eta != null ? (point.pPa * point.qThousand * 1000) / (3600 * 1000 * eta) : null;
          // Двигатель должен согласовываться и с графиком, и с таблицей каталога (см. chooseMotor).
          const inTable = inTableRange(curve, point.qThousand);
          const chosen = chooseMotor(curve.motors, shaftKw, inTable);
          const motor = chosen.motor;
          const motorBasis = chosen.basis;
          // Справочная установочная мощность = вал × K' каталога для номинала выбранного двигателя
          // (если двигателя нет — для наибольшего в строке, чтобы показать, чего не хватило).
          let installedKw = null;
          if (shaftKw != null) {
            const ref = motor || largestMotor(curve.motors);
            installedKw = shaftKw * (ref ? nominalFactor(ref.nominalKw) : installedPowerFactor(shaftKw));
          }
          // Расчётная дуга Nу выбранного двигателя в координатах графика (20 °C): грузоподъёмность двигателя по валу
          // делится на отношение плотностей, потому что давление на графике приведено к 20 °C.
          let nyArc = null;
          if (motor && Array.isArray(dia.etaField) && dia.etaField.length >= 3) {
            const points = powerArcPoints(dia.etaField, shaftCapacityKw(motor.nominalKw) / densityRatio);
            if (points.length >= 2) nyArc = { nominalKw: motor.nominalKw, points };
          }
          candidates.push({
            typorazmer: typorazmerKey,
            diameter: dia.d,
            graphImage: dia.graphImage,
            calibration: dia.calibration,
            rpmNominal: curve.rpmNominal,
            rpmActual: curve.rpmActual,
            qFactM3h: point.qThousand * 1000,
            pFactPa: point.pPa,
            eta: eta,
            shaftKw: shaftKw,
            installedKw: installedKw,
            motor: motor,
            motorBasis: motorBasis,        // 'graph+table' | 'graph' | 'table' | null (не подобран), см. chooseMotor
            inTableRange: inTable,
            nyArc: nyArc,                  // расчётная дуга Nу двигателя для графика: { nominalKw, points: [[Q, P], ...] } или null
            // Двигатели, назначенные каталогом для этого колеса и оборотов: показываем, когда КПД в точке
            // не подтверждён и мощность посчитать нельзя (подбор по мощности при этом не выполняется).
            catalogMotors: curve.motors,
            // Диапазон строки таблицы каталога (Q, тыс. м³/ч; полное давление, Па): нарисованный участок кривой
            // может выходить за округлённый диапазон таблицы — UI сверяет точку с обоими.
            tableQRangeThousand: curve.qRangeThousand,
            tablePRangePa: curve.pRangeExpected,
            targetQThousand: q0Thousand,
            targetPPa: pTarget
          });
        }
      }
    }
    candidates.sort((a, b) => (b.eta || 0) - (a.eta || 0));
    return candidates;
  }

  const api = {
    evalQuadratic,
    correctToFullPressure,
    airDensityRatio,
    intersectWithNetwork,
    interpolateSamples,
    workingRange,
    installedPowerFactor,
    pickMotor,
    inTableRange,
    smallestMotor,
    nominalFactor,
    shaftCapacityKw,
    chooseMotor,
    etaAtA,
    powerArcPoints,
    selectCandidates,
    staticUnavailable
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PodborCalc = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
