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

  tests.push(['renderOverlay отрисовывает polyline и circle с корректными атрибутами', () => {
    const elements = [];
    const fakeSvg = {
      children: ['old-point', 'old-parabola'],
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      appendChild(c) { this.children.push(c); },
      ownerDocument: {
        createElementNS: (ns, tag) => {
          const el = { tag, attrs: {} };
          el.setAttribute = function(k, v) { this.attrs[k] = v; };
          elements.push(el);
          return el;
        }
      }
    };
    PodborOverlay.renderOverlay(fakeSvg, { qThousand: 2, pPa: 10, targetQThousand: 2, targetPPa: 10 }, calibration);

    // Проверка: ровно 2 элемента, старые удалены
    assert.strictEqual(fakeSvg.children.length, 2);
    assert.ok(!fakeSvg.children.includes('old-point'));
    assert.ok(!fakeSvg.children.includes('old-parabola'));

    // Проверка: имена тегов и типы
    assert.strictEqual(elements.length, 2);
    assert.strictEqual(elements[0].tag, 'polyline');
    assert.strictEqual(elements[1].tag, 'circle');

    // Проверка circle: cx и cy совпадают с пикселями
    const expectedCx = PodborOverlay.pixelForQ(2, calibration);
    const expectedCy = PodborOverlay.pixelForP(10, calibration);
    assert.strictEqual(parseFloat(elements[1].attrs.cx), expectedCx);
    assert.strictEqual(parseFloat(elements[1].attrs.cy), expectedCy);

    // Проверка polyline: points содержит вершину близко к целевой точке
    const targetCx = PodborOverlay.pixelForQ(2, calibration);
    const targetCy = PodborOverlay.pixelForP(10, calibration);
    const points = elements[0].attrs.points.split(' ').map(p => p.split(',').map(parseFloat));
    const hasPointNearTarget = points.some(([x, y]) =>
      Math.abs(x - targetCx) < 1e-6 && Math.abs(y - targetCy) < 1e-6
    );
    assert.ok(hasPointNearTarget, `Парабола должна проходить через целевую точку (${targetCx}, ${targetCy})`);
  }]);

  tests.push(['renderOverlay защищен от нефинитных targetQThousand', () => {
    const fakeSvg = {
      children: ['old'],
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      appendChild(c) { this.children.push(c); },
      ownerDocument: {
        createElementNS: (ns, tag) => ({ setAttribute() {} })
      }
    };
    PodborOverlay.renderOverlay(fakeSvg, { qThousand: 2, pPa: 10, targetQThousand: 0, targetPPa: 10 }, calibration);
    assert.strictEqual(fakeSvg.children.length, 0, 'SVG должен остаться пустым при targetQThousand=0');
  }]);

  tests.push(['renderOverlay защищен от неположительного qThousand', () => {
    const fakeSvg = {
      children: ['old'],
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      appendChild(c) { this.children.push(c); },
      ownerDocument: {
        createElementNS: (ns, tag) => ({ setAttribute() {} })
      }
    };
    PodborOverlay.renderOverlay(fakeSvg, { qThousand: 0, pPa: 10, targetQThousand: 2, targetPPa: 10 }, calibration);
    assert.strictEqual(fakeSvg.children.length, 0, 'SVG должен остаться пустым при qThousand=0');
  }]);

  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
  }
  process.exit(failed ? 1 : 0);
}

run();
