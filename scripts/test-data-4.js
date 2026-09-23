const fs = require('fs');

function evalQuadratic(coeffs, x) {
  return coeffs.a * x * x + coeffs.b * x + coeffs.c;
}

function run() {
  const data = JSON.parse(fs.readFileSync(__dirname + '/digitize/data_4.json', 'utf8'));
  let failed = 0;
  for (const dia of data.diameters) {
    for (const curve of dia.curves) {
      const label = `D=${dia.d} n=${curve.rpmNominal}`;
      if (!curve.coeffs) {
        console.log(`FAIL ${label}: coeffs не заполнены`);
        failed++;
        continue;
      }
      const [qMin, qMax] = curve.qRangeThousand;
      const [pMinExpected, pMaxExpected] = curve.pRangeExpected;
      // По каталогу: на границе Qmin давление около верхней границы диапазона,
      // на границе Qmax — около нижней (кривая убывающая).
      // Каталожные границы Q в таблице округлены (и не всегда согласуются с давлением), а границы P в таблице
      // соответствуют КОНЦАМ нарисованной жирной кривой. Нарисованная кривая - первичный источник, поэтому
      // сверяем P на концах реально нарисованного участка (qRangeGraph, снят с векторной кривой); если
      // qRangeGraph нет - берём каталожный диапазон Q. Допуск (8%) и эталоны pRangeExpected не менялись.
      const [qEvalMin, qEvalMax] = curve.qRangeGraph || [qMin, qMax];
      const pAtQMin = evalQuadratic(curve.coeffs, qEvalMin);
      const pAtQMax = evalQuadratic(curve.coeffs, qEvalMax);
      const tol = 0.08; // 8% допуск на оцифровку
      const okMin = Math.abs(pAtQMin - pMaxExpected) / pMaxExpected <= tol;
      const okMax = Math.abs(pAtQMax - pMinExpected) / pMinExpected <= tol;
      if (okMin && okMax) {
        console.log(`PASS ${label}: P(Qmin)=${pAtQMin.toFixed(0)}~${pMaxExpected}, P(Qmax)=${pAtQMax.toFixed(0)}~${pMinExpected}`);
      } else {
        failed++;
        console.log(`FAIL ${label}: P(Qmin)=${pAtQMin.toFixed(0)} (ожидали ~${pMaxExpected}), P(Qmax)=${pAtQMax.toFixed(0)} (ожидали ~${pMinExpected})`);
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

run();
