(function () {
  const ISPOLNENIE_LABELS = {
    general: 'Общего назначения (оцинкованная сталь)',
    corrosion: 'Коррозионностойкое (нержавеющая сталь)'
  };

  const REQUIRED_IDS = [
    'qInput', 'pInput', 'calcType', 'upPct', 'downPct', 'tempInput', 'ispolnenie', 'calcBtn',
    'resultMessage', 'candidateList', 'graphView', 'graphImg', 'graphSvg', 'summary', 'chertyozhView',
    'printBtn'
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
  let selectedIndex = -1;

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
    els.printBtn.hidden = true;
    selectedIndex = -1;
    // Поздний load/error прежней картинки не должен дорисовать оверлей в скрытый svg или дописать ошибку.
    els.graphImg.onload = els.graphImg.onerror = null;
    window.PodborOverlay.clearOverlay(els.graphSvg);
    els.summary.textContent = '';
    els.chertyozhView.textContent = '';
    currentCandidates = [];
  }

  // Диаметр в подписях — с десятичной запятой, как «2,5» в названии типоразмера.
  function formatDiameter(d) {
    return String(d).replace('.', ',');
  }

  function modelName(c) {
    return 'ВЦ 4-70-' + c.typorazmer + ' D=' + formatDiameter(c.diameter) + 'Dном';
  }

  function etaText(c) {
    return c.eta != null ? 'КПД ' + (c.eta * 100).toFixed(0) + '%' : 'КПД не подтверждён графиком';
  }

  function motorText(c) {
    if (c.motor) {
      const base = c.motor.type + ' (' + c.motor.nominalKw + ' кВт)';
      if (c.motorBasis === 'graph+table') return base + ' — согласуется с графиком и таблицей';
      if (c.motorBasis === 'table') return base + ' — по таблице каталога (график мощность не подтверждает)';
      if (c.motorBasis === 'graph') return base + ' — по графику (точка вне диапазона таблицы)';
      return base;
    }
    if (c.installedKw != null) return 'мотора в каталоге на такую мощность не хватает';
    // КПД в этой точке неизвестен → мощность на валу не посчитать → подбор двигателя по мощности невозможен.
    // Показываем двигатели, которые каталог назначает этому колесу и оборотам, и честно помечаем, что это не подбор.
    if (c.catalogMotors && c.catalogMotors.length > 0) {
      const sorted = c.catalogMotors.slice().sort((a, b) => a.nominalKw - b.nominalKw);
      const fmt = (m) => m.type + ' (' + m.nominalKw + ' кВт)';
      const biggest = sorted[sorted.length - 1];
      if (sorted.length === 1) return 'по каталогу для этого колеса и оборотов ' + fmt(biggest) + ' (мощность в точке не подтверждена графиком)';
      // Дуга Nу меньшего двигателя на графике может быть не нанесена. Гарантированно подходит наибольший двигатель
      // строки таблицы (он рассчитан на весь диапазон); меньший — только если мощность в точке не выше его номинала.
      return 'по каталогу для этого колеса и оборотов ' + sorted.map(fmt).join(' / ') +
        ' — мощность в точке не подтверждена графиком; гарантированно подходит наибольший: ' + fmt(biggest);
    }
    return 'нет данных по КПД, мотор не подобран';
  }

  // Пояснение к двигателю: чем подтверждён выбор — графиком (вал ≤ допустимого для двигателя), таблицей каталога или обоими.
  function motorBasisNote(c) {
    const kw = (x) => String(x).replace('.', ',');
    const others = (c.catalogMotors || []).filter((m) => m.type !== c.motor.type).sort((a, b) => a.nominalKw - b.nominalKw);
    const othersText = others.length > 0
      ? '; в этой же строке таблицы допускается: ' + others.map((m) => m.type + ' (' + kw(m.nominalKw) + ' кВт)').join(', ')
      : '';
    const cap = window.PodborCalc.shaftCapacityKw(c.motor.nominalKw);
    const shaft = c.shaftKw != null ? c.shaftKw.toFixed(2) : null;
    if (c.motorBasis === 'graph+table') {
      return ' — согласуется с графиком (мощность на валу ' + shaft + ' кВт не больше допустимых ' + cap.toFixed(2) +
        ' кВт для этого двигателя; его дуга Nу нанесена на график расчётом) и с таблицей каталога (двигатель есть в строке, точка внутри её диапазона)' + othersText;
    }
    if (c.motorBasis === 'graph') {
      return ' — по графику (мощность на валу ' + shaft + ' кВт не больше допустимых ' + cap.toFixed(2) +
        ' кВт), но точка вне диапазона таблицы каталога: проверьте по каталогу' + othersText;
    }
    if (c.motorBasis === 'table') {
      return ' — по таблице каталога (двигатель допустим на весь диапазон строки); график мощность в этой точке не подтверждает: за краем линий КПД' + othersText;
    }
    return '';
  }

  // Сверка точки с диапазоном строки таблицы каталога (Q и полное давление) и вывод по ней.
  function tableRangeInfo(c) {
    const qr = c.tableQRangeThousand;
    const pr = c.tablePRangePa;
    if (!qr || !pr) return null;
    const qT = c.qFactM3h / 1000;
    const pMin = Math.min(pr[0], pr[1]);
    const pMax = Math.max(pr[0], pr[1]);
    const rangeText = 'Q ' + qr[0].toFixed(2) + '–' + qr[1].toFixed(2) + ' тыс. м³/ч, P ' + pMax + '–' + pMin + ' Па';
    let verdict;
    if (qT < qr[0] - 1e-9) verdict = 'точка левее диапазона таблицы: кривая на графике нарисована шире округлённого диапазона таблицы, проверьте по каталогу';
    else if (qT > qr[1] + 1e-9) verdict = 'точка правее диапазона таблицы: кривая на графике нарисована шире округлённого диапазона таблицы, проверьте по каталогу';
    else verdict = 'точка внутри диапазона таблицы';
    return { rangeText, verdict };
  }

  // ---------- список вариантов ----------

  function renderCandidateList(candidates) {
    els.candidateList.textContent = '';
    candidates.forEach((c, idx) => {
      const li = el('li', modelName(c) + ', n=' + c.rpmActual + ' об/мин — ' + etaText(c) + ', двигатель: ' + motorText(c));
      li.dataset.index = String(idx);
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.addEventListener('click', () => selectCandidate(idx, true));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          selectCandidate(idx, true);
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
        targetPPa: c.targetPPa / ratio,
        // Расчётная дуга Nу выбранного двигателя (на графике может быть не нанесена, например 0,55 кВт у ВЦ 4-70-4 D=0,95)
        arcs: c.nyArc
          ? [{ label: 'Nу=' + String(c.nyArc.nominalKw).replace('.', ',') + ' кВт (расчёт)', points: c.nyArc.points }]
          : []
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
      ['КПД', c.eta != null ? (c.eta * 100).toFixed(0) + '%' : 'не подтверждён графиком: линии КПД оцифрованы не на всём рабочем участке кривой, эта точка лежит за их пределами'],
      ['Мощность на валу', c.shaftKw != null ? c.shaftKw.toFixed(2) + ' кВт' : 'не подтверждена графиком (считается через КПД)'],
      ['Нагрузка двигателя (вал × запас каталога)', c.installedKw != null ? c.installedKw.toFixed(2) + ' кВт' : 'не подтверждена графиком'],
      ['Двигатель', c.motor ? c.motor.type + ', ' + c.motor.nominalKw + ' кВт' + motorBasisNote(c) : motorText(c)]
    ];
    const tri = tableRangeInfo(c);
    if (tri) {
      rows.push(['Диапазон по таблице каталога (эта строка)', tri.rangeText]);
      rows.push(['Сверка с таблицей', tri.verdict]);
    }
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

  // ---------- PDF: формируется в браузере и скачивается сразу ----------

  // Шрифт и картинки для PDF (около 4 МБ) грузятся только по клику: обычным <script>, чтобы работало и при file://.
  function loadPdfAssets() {
    return new Promise((resolve, reject) => {
      if (window.PODBOR_PDF_ASSETS) { resolve(window.PODBOR_PDF_ASSETS); return; }
      const tag = document.createElement('script');
      tag.src = 'podbor-pdf-assets.js';
      tag.onload = () => (window.PODBOR_PDF_ASSETS ? resolve(window.PODBOR_PDF_ASSETS) : reject(new Error('файл podbor-pdf-assets.js пуст')));
      tag.onerror = () => reject(new Error('не найден файл podbor-pdf-assets.js'));
      document.head.appendChild(tag);
    });
  }

  function downloadPdf() {
    const c = currentCandidates[selectedIndex];
    if (!c || !lastInput || !window.PodborPdf) return;
    const label = els.printBtn.textContent;
    els.printBtn.disabled = true;
    els.printBtn.textContent = 'Формирую PDF…';
    loadPdfAssets()
      .then((assets) => {
        const model = window.PodborPdf.modelFromCandidate(c, lastInput, {
          typorazmer: window.PODBOR_DATA.typorazmery[c.typorazmer],
          airDensityRatio: window.PodborCalc.airDensityRatio,
          ispolnenieLabel: ISPOLNENIE_LABELS[lastInput.ispolnenie] || lastInput.ispolnenie
        });
        window.PodborPdf.download(window.PodborPdf.build(model, assets), window.PodborPdf.fileName(model));
      })
      .catch((e) => {
        console.error('podbor-ui.js: не удалось сформировать PDF:', e);
        appendMessage('Не удалось сформировать PDF: ' + e.message);
      })
      .then(() => {
        els.printBtn.disabled = false;
        els.printBtn.textContent = label;
      });
  }
  els.printBtn.addEventListener('click', downloadPdf);

  // ---------- выбор варианта и расчёт ----------

  // График и список на широком экране стоят рядом (см. CSS podbor.html). На узком график идёт под списком,
  // и после клика по варианту его не видно без прокрутки — прокручиваем к нему (только по действию пользователя).
  const WIDE_LAYOUT = '(min-width: 1100px)';

  function selectCandidate(idx, fromUser) {
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
    selectedIndex = idx;
    els.printBtn.hidden = false;
    if (fromUser && !window.matchMedia(WIDE_LAYOUT).matches) {
      els.graphView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function staticExclusionLine() {
    const excluded = window.PodborCalc.staticUnavailable(window.PODBOR_DATA);
    if (excluded.length === 0) return null;
    const names = excluded.map((e) => 'ВЦ 4-70-' + e.typorazmer + ' D=' + formatDiameter(e.diameter) + 'Dном').join('; ');
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
