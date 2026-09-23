const assert = require('assert');
const PodborOverlay = require('../podbor-overlay.js');

function run() {
  const tests = [];
  const calibration = {
    qAxis: { slope: 200, intercept: 100 }, // pixel = 200*log10(Q) + 100
    pAxis: { slope: -300, intercept: 1200 } // pixel = -300*log10(P) + 1200
  };

  tests.push(['pixelForQ считает через калибровку лог-оси', () => {
    const px = PodborOverlay.pixelForQ(1, calibration); // log10(1)=0 -> px=100
    assert.strictEqual(px, 100);
  }]);

  tests.push(['pixelForP считает через калибровку лог-оси', () => {
    const px = PodborOverlay.pixelForP(1, calibration); // log10(1)=0 -> px=1200
    assert.strictEqual(px, 1200);
  }]);

  tests.push(['renderOverlay очищает предыдущее содержимое перед отрисовкой (нет накопления точек)', () => {
    const calls = [];
    const fakeSvg = {
      children: ['old-point', 'old-parabola'],
      removeChild(c) { calls.push('remove:' + c); this.children = this.children.filter((x) => x !== c); },
      appendChild(c) { calls.push('append'); this.children.push(c); },
      ownerDocument: {
        createElementNS: () => ({ setAttribute() {} })
      }
    };
    PodborOverlay.renderOverlay(fakeSvg, { qThousand: 2, pPa: 10, targetQThousand: 2, targetPPa: 10 }, calibration);
    assert.ok(calls.includes('remove:old-point'));
    assert.ok(calls.includes('remove:old-parabola'));
    assert.ok(fakeSvg.children.length >= 1);
  }]);

  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
  }
  process.exit(failed ? 1 : 0);
}

run();
