(function (root) {
  function evalQuadratic(coeffs, x) {
    return coeffs.a * x * x + coeffs.b * x + coeffs.c;
  }

  function correctToFullPressure({ qReqM3h, pReqPa, calcType, pdvCoeffC }) {
    if (calcType !== 'static') return pReqPa;
    const qThousand = qReqM3h / 1000;
    const pdv = pdvCoeffC * qThousand * qThousand;
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

  // Каталожная Ny на графике — установочная мощность двигателя = мощность на валу × K
  // (стандартные коэффициенты запаса; Task 2 подтвердил ~1,5 для Ny<=0,25 и ~1,3 для 0,55–0,75 кВт).
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
        const pTarget = correctToFullPressure({
          qReqM3h: input.qReqM3h,
          pReqPa: input.pReqPa,
          calcType: input.calcType,
          pdvCoeffC: pdvCoeffC || 0
        });
        const q0Thousand = input.qReqM3h / 1000;
        const densityRatio = airDensityRatio(input.tempC != null ? input.tempC : 20);
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
          const eta = interpolateSamples(curve.etaSamples, point.qThousand);
          const shaftKw = eta ? (point.pPa * point.qThousand * 1000) / (3600 * 1000 * eta) : null;
          const installedKw = shaftKw != null ? shaftKw * installedPowerFactor(shaftKw) : null;
          const motor = installedKw != null ? pickMotor(curve.motors, installedKw, input.marginPct || 0) : null;
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
    selectCandidates,
    staticUnavailable
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PodborCalc = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
