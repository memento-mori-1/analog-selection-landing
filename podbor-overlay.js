(function (root) {
  function pixelForQ(qThousand, calibration) {
    const c = calibration.qAxis;
    return c.slope * Math.log10(qThousand) + c.intercept;
  }

  function pixelForP(pPa, calibration) {
    const c = calibration.pAxis;
    return c.slope * Math.log10(pPa) + c.intercept;
  }

  function clearOverlay(svgEl) {
    [...svgEl.children].forEach((c) => svgEl.removeChild(c));
  }

  function renderOverlay(svgEl, point, calibration) {
    clearOverlay(svgEl);

    // Защита от нефинитных/неположительных входов
    if (!Number.isFinite(point.qThousand) || point.qThousand <= 0 ||
        !Number.isFinite(point.pPa) || point.pPa <= 0 ||
        !Number.isFinite(point.targetQThousand) || point.targetQThousand <= 0 ||
        !Number.isFinite(point.targetPPa) || point.targetPPa <= 0) {
      return;
    }

    const doc = svgEl.ownerDocument;
    const ns = 'http://www.w3.org/2000/svg';

    // Линии за рамкой поля графика (подписи осей, поля) не рисуем; рамка — calibration.plotFrame в пикселях картинки.
    const frame = calibration.plotFrame;
    const inFrame = (x, y) => !frame || (x >= frame[0] && x <= frame[2] && y >= frame[1] && y <= frame[3]);

    // Расчётные дуги Nу: point.arcs = [{ label, points: [[Q тыс. м³/ч, P Па], ...] }], координаты графика каталога.
    // Рисуются под параболой и точкой, чтобы точка оставалась читаемой.
    (point.arcs || []).forEach((arc) => {
      const pts = (arc.points || [])
        .map(([q, p]) => [pixelForQ(q, calibration), pixelForP(p, calibration)])
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && inFrame(x, y));
      if (pts.length < 2) return;
      const line = doc.createElementNS(ns, 'polyline');
      line.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', '#e8730c');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-dasharray', '12,7');
      svgEl.appendChild(line);
      if (arc.label) {
        const mid = pts[Math.floor(pts.length * 0.62)];
        const text = doc.createElementNS(ns, 'text');
        text.setAttribute('x', mid[0] + 8);
        text.setAttribute('y', mid[1] - 10);
        text.setAttribute('font-size', '22');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', '#b45309');
        text.setAttribute('stroke', 'white');
        text.setAttribute('stroke-width', '5');
        text.setAttribute('paint-order', 'stroke');
        text.textContent = arc.label;
        svgEl.appendChild(text);
      }
    });

    // Парабола сети через целевую точку: P = k*Q^2, k = targetP/targetQ^2
    const k = point.targetPPa / (point.targetQThousand * point.targetQThousand);
    const pathPoints = [];
    const qMin = point.targetQThousand * 0.3;
    const qMax = point.targetQThousand * 1.8;
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const q = qMin + ((qMax - qMin) * i) / steps;
      const p = k * q * q;
      if (p <= 0) continue;
      const x = pixelForQ(q, calibration);
      const y = pixelForP(p, calibration);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !inFrame(x, y)) continue;
      pathPoints.push(`${x},${y}`);
    }
    const path = doc.createElementNS ? doc.createElementNS(ns, 'polyline') : { setAttribute() {} };
    if (path.setAttribute) {
      path.setAttribute('points', pathPoints.join(' '));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#d0342c');
      path.setAttribute('stroke-dasharray', '6,4');
      path.setAttribute('stroke-width', '2');
    }
    svgEl.appendChild(path);

    // Фактическая точка
    const cx = pixelForQ(point.qThousand, calibration);
    const cy = pixelForP(point.pPa, calibration);
    const circle = doc.createElementNS ? doc.createElementNS(ns, 'circle') : { setAttribute() {} };
    if (circle.setAttribute) {
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', 11);
      circle.setAttribute('fill', '#d0342c');
      circle.setAttribute('stroke', 'white');
      circle.setAttribute('stroke-width', '2');
    }
    svgEl.appendChild(circle);
  }

  const api = { pixelForQ, pixelForP, renderOverlay, clearOverlay };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PodborOverlay = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
