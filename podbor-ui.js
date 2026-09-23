(function () {
  const ISPOLNENIE_LABELS = {
    general: 'Общего назначения (оцинкованная сталь)',
    corrosion: 'Коррозионностойкое (нержавеющая сталь)'
  };

  const REQUIRED_IDS = [
    'qInput', 'pInput', 'calcType', 'upPct', 'downPct', 'tempInput', 'ispolnenie', 'calcBtn',
    'resultMessage', 'candidateList', 'graphView', 'graphImg', 'graphSvg', 'summary', 'chertyozhView'
  ];

  const els = {};
  const missing = [];
  REQUIRED_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) els[id] = el; else missing.push(id);
  });
  if (missing.length > 0) {
    console.error('podbor-ui.js: в podbor.html не найдены элементы с id: ' + missing.join(', ') + '. Скрипт не запущен.');
    return;
  }
  if (!window.PODBOR_DATA || !window.PodborCalc || !window.PodborOverlay) {
    console.error('podbor-ui.js: не загружены podbor-data.js / podbor-calc.js / podbor-overlay.js. Скрипт не запущен.');
    return;
  }

  let lastInput = null;
  let currentCandidates = [];

  // ---------- вспомогательные функции ----------

  // Пустая строка → NaN (Number('') был бы 0 и прошёл бы молча).
  function parseField(el) {
    const raw = String(el.value).trim();
    return raw === '' ? NaN : Number(raw);
  }

  function readInput() {
    return {
      qReqM3h: parseField(els.qInput),
      pReqPa: parseField(els.pInput),
      calcType: els.calcType.value,
      upPct: parseField(els.upPct),
      downPct: parseField(els.downPct),
      tempC: parseField(els.tempInput),
      ispolnenie: els.ispolnenie.value,
      marginPct: 0
    };
  }

  // Возвращает массив сообщений об ошибках ввода (пустой — ввод корректен).
  function validateInput(input) {
    const errors = [];
    if (!Number.isFinite(input.qReqM3h) || input.qReqM3h <= 0) {
      errors.push('Расход должен быть числом больше нуля.');
    }
    if (!Number.isFinite(input.pReqPa) || input.pReqPa <= 0) {
      errors.push('Давление должно быть числом больше нуля.');
    }
    if (!Number.isFinite(input.upPct) || input.upPct < 0) {
      errors.push('Допустимое отклонение вверх должно быть числом не меньше нуля.');
    }
    if (!Number.isFinite(input.downPct) || input.downPct < 0) {
      errors.push('Допустимое отклонение вниз должно быть числом не меньше нуля.');
    }
    if (!Number.isFinite(input.tempC) || input.tempC <= -273) {
      errors.push('Температура воздуха должна быть числом выше -273 °C.');
    }
    return errors;
  }

  function el(tag, text) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }

  function setMessage(lines) {
    els.resultMessage.textContent = '';
    lines.forEach((line) => els.resultMessage.appendChild(el('div', line)));
  }

  function appendMessage(line) {
    els.resultMessage.appendChild(el('div', line));
  }

  function clearResults() {
    els.candidateList.textContent = '';
    els.graphView.hidden = true;
    // Поздний load/error прежней картинки не должен дорисовать оверлей в скрытый svg или дописать ошибку.
    els.graphImg.onload = els.graphImg.onerror = null;
    window.PodborOverlay.clearOverlay(els.graphSvg);
    els.summary.textContent = '';
    els.chertyozhView.textContent = '';
    currentCandidates = [];
  }

  function modelName(c) {
    return 'ВЦ 4-70-' + c.typorazmer + ' D=' + c.diameter + 'Dном';
  }

  function etaText(c) {
    return c.eta != null ? 'КПД ' + (c.eta * 100).toFixed(0) + '%' : 'КПД не подтверждён графиком';
  }

  function motorText(c) {
    if (c.motor) return c.motor.type + ' (' + c.motor.nominalKw + ' кВт)';
    if (c.installedKw != null) return 'мотора в каталоге на такую мощность не хватает';
    return 'нет данных по КПД, мотор не подобран';
  }

  // ---------- список вариантов ----------

  function renderCandidateList(candidates) {
    els.candidateList.textContent = '';
    candidates.forEach((c, idx) => {
      const li = el('li', modelName(c) + ', n=' + c.rpmActual + ' об/мин — ' + etaText(c) + ', двигатель: ' + motorText(c));
      li.dataset.index = String(idx);
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.addEventListener('click', () => selectCandidate(idx));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          selectCandidate(idx);
        }
      });
      els.candidateList.appendChild(li);
    });
  }

  // ---------- график ----------

  // Картинки каталога сняты при 20°C, а движок масштабирует давление по плотности воздуха.
  // На графике рисуем давление, приведённое к 20°C (делим на отношение плотностей).
  function draw(c) {
    const img = els.graphImg;
    const svg = els.graphSvg;
    const ratio = window.PodborCalc.airDensityRatio(lastInput.tempC);

    const render = () => {
      svg.setAttribute('viewBox', '0 0 ' + img.naturalWidth + ' ' + img.naturalHeight);
      window.PodborOverlay.renderOverlay(svg, {
        qThousand: c.qFactM3h / 1000,
        pPa: c.pFactPa / ratio,
        targetQThousand: c.targetQThousand,
        targetPPa: c.targetPPa / ratio
      }, c.calibration);
    };

    img.alt = 'Аэродинамическая характеристика ' + modelName(c) + ', обороты ' + c.rpmActual + ' об/мин';
    img.onerror = () => {
      window.PodborOverlay.clearOverlay(svg);
      console.error('podbor-ui.js: не удалось загрузить график ' + c.graphImage);
      appendMessage('Не удалось загрузить картинку графика.');
    };

    if (img.getAttribute('src') !== c.graphImage) {
      // Новая картинка: старую точку убираем сразу, рисуем после загрузки.
      window.PodborOverlay.clearOverlay(svg);
      img.onload = render;
      img.src = c.graphImage;
    } else if (img.complete && img.naturalWidth > 0) {
      // Та же картинка (другие обороты того же диаметра): load не сработает — рисуем сразу.
      render();
    } else {
      img.onload = render;
    }
  }

  // ---------- сводка и чертёж ----------

  function renderSummary(c) {
    const isStatic = lastInput.calcType === 'static';
    // Pdv = coeffC·Q²·ρ_t/ρ_20 (ось Pdv снята при 20°C); coeffC валидна, иначе статика не дала бы кандидата.
    let staticFact = '';
    if (isStatic) {
      const qT = c.qFactM3h / 1000;
      const pdv = c.calibration.pdvAxis.coeffC * qT * qT * window.PodborCalc.airDensityRatio(lastInput.tempC);
      staticFact = (c.pFactPa - pdv).toFixed(0);
    }
    const table = el('table');
    const rows = [
      ['Заданный расход', lastInput.qReqM3h + ' м³/ч'],
      ['Заданное давление', lastInput.pReqPa + ' Па (' + (lastInput.calcType === 'static' ? 'статический' : 'полный') + ' расчёт)'],
      ['Температура воздуха', lastInput.tempC + ' °C'],
      ['Исполнение', ISPOLNENIE_LABELS[lastInput.ispolnenie] || lastInput.ispolnenie],
      ['Целевое полное давление' + (isStatic ? ' (статическое + Pdv)' : ''), c.targetPPa.toFixed(0) + ' Па'],
      ['Модель', modelName(c)],
      ['Обороты', c.rpmActual + ' об/мин'],
      ['Фактический расход', c.qFactM3h.toFixed(0) + ' м³/ч'],
      ['Фактическое полное давление', c.pFactPa.toFixed(0) + ' Па'],
      ...(isStatic ? [['Фактическое статическое давление (полное − Pdv)', staticFact + ' Па']] : []),
      ['КПД', c.eta != null ? (c.eta * 100).toFixed(0) + '%' : 'КПД не подтверждён графиком'],
      ['Мощность на валу', c.shaftKw != null ? c.shaftKw.toFixed(2) + ' кВт' : 'не подтверждена графиком'],
      ['Установочная мощность (с запасом)', c.installedKw != null ? c.installedKw.toFixed(2) + ' кВт' : 'не подтверждена графиком'],
      ['Двигатель', c.motor ? c.motor.type + ', ' + c.motor.nominalKw + ' кВт' : motorText(c)]
    ];
    rows.forEach(([label, value]) => {
      const tr = el('tr');
      tr.appendChild(el('th', label));
      tr.appendChild(el('td', value));
      table.appendChild(tr);
    });
    els.summary.textContent = '';
    els.summary.appendChild(table);
  }

  function renderChertyozh(c) {
    const typorazmer = window.PODBOR_DATA.typorazmery[c.typorazmer];
    const view = els.chertyozhView;
    view.textContent = '';
    view.appendChild(el('h2', 'Габаритно-присоединительные размеры — ВЦ 4-70-' + c.typorazmer));

    const img = document.createElement('img');
    img.src = typorazmer.drawingImage;
    img.alt = 'Чертёж ВЦ 4-70-' + c.typorazmer;
    img.style.maxWidth = '100%';
    view.appendChild(img);

    const table = el('table');
    const head = el('tr');
    ['Угол поворота корпуса', 'B, мм', 'H, мм'].forEach((t) => head.appendChild(el('th', t)));
    table.appendChild(head);
    typorazmer.dimensionsByAngle.forEach((r) => {
      const tr = el('tr');
      tr.appendChild(el('td', r.angle + '°'));
      tr.appendChild(el('td', String(r.B)));
      tr.appendChild(el('td', String(r.H)));
      table.appendChild(tr);
    });
    view.appendChild(table);
  }

  // ---------- выбор варианта и расчёт ----------

  function selectCandidate(idx) {
    const c = currentCandidates[idx];
    if (!c) return;
    els.candidateList.querySelectorAll('li').forEach((li) => {
      const selected = li.dataset.index === String(idx);
      li.classList.toggle('selected', selected);
      if (selected) li.setAttribute('aria-current', 'true');
      else li.removeAttribute('aria-current');
    });

    els.graphView.hidden = false;
    draw(c);
    renderSummary(c);
    renderChertyozh(c);
  }

  function staticExclusionLine() {
    const excluded = window.PodborCalc.staticUnavailable(window.PODBOR_DATA);
    if (excluded.length === 0) return null;
    const names = excluded.map((e) => 'ВЦ 4-70-' + e.typorazmer + ' D=' + e.diameter + 'Dном').join('; ');
    return 'Из статического расчёта исключены (ось динамического давления Pdv для этого графика не откалибрована): ' + names + '.';
  }

  function runCalculation() {
    const input = readInput();
    const errors = validateInput(input);
    if (errors.length > 0) {
      lastInput = null;
      clearResults();
      setMessage(errors);
      return;
    }
    lastInput = input;

    const candidates = window.PodborCalc.selectCandidates(window.PODBOR_DATA, input);
    const exclusion = input.calcType === 'static' ? staticExclusionLine() : null;

    if (candidates.length === 0) {
      clearResults();
      const lines = ['В демо-диапазоне (ВЦ 4-70, №2,5/3,15/4) подходящего варианта нет — напишите нам для полного расчёта.'];
      if (exclusion) lines.push(exclusion);
      setMessage(lines);
      return;
    }

    const lines = ['Найдено вариантов: ' + candidates.length + '.'];
    if (exclusion) lines.push(exclusion);
    setMessage(lines);
    currentCandidates = candidates;
    renderCandidateList(candidates);
    selectCandidate(0);
  }

  els.calcBtn.addEventListener('click', runCalculation);
})();
