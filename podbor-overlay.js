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
    const doc = svgEl.ownerDocument;
    const ns = 'http://www.w3.org/2000/svg';

    // Парабола сети через целевую точку: P = k*Q^2, k = targetP/targetQ^2
    const k = point.targetPPa / (point.targetQThousand * point.targetQThousand);
    const pathPoints = [];
    const qMin = point.targetQThousand * 0.3;
    const qMax = point.targetQThousand * 1.8;
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const q = qMin + ((qMax - qMin) * i) / steps;
      const p = k * q * q;
      if (p <= 0) continue;
      pathPoints.push(`${pixelForQ(q, calibration)},${pixelForP(p, calibration)}`);
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
