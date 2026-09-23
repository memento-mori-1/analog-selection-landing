# Демо-версия программы подбора (ВЦ 4-70) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Статическая страница `podbor.html`, где пользователь вводит расход/давление и получает
подобранную комплектацию ВЦ 4-70 (типоразмер 2,5/3,15/4 × 5 диаметров колеса) с точкой на
графике и чертежом — без бэкенда, вся логика в браузере.

**Architecture:** Данные (оцифрованные кривые Q-P, таблицы двигателей, размеры) — статический
JS-объект, подготовленный офлайн Python-скриптами по методике [[podbor-ventilyatorov]]. Расчёт
(коррекция давления, пересечение с сетью, фильтр/сортировка кандидатов) — чистый JS-модуль без
DOM-зависимостей, тестируемый в Node. Отрисовка точки/параболы — SVG поверх картинки графика по
калибровочной матрице. Страница подключает эти модули как обычные `<script src>` (не ES-модули —
чтобы работать через `file://` без сборки, как и `index.html`).

**Tech Stack:** HTML5/CSS3/vanilla JS (без фреймворков, без сборки) для страницы; Python
(PyMuPDF, numpy, Pillow) для офлайн-подготовки данных; Node.js (без внешних пакетов) для тестов
JS-модулей — тот же принцип, что и у `scripts/check-landing.mjs`.

**Spec:** `StartUp/docs/superpowers/specs/2026-09-23-demo-podbor-design.md`

## Prerequisite (ручной шаг, не код)

Андрей сохраняет три PDF каталога на диск (уже присланы в чат, нужно перенести на файловую
систему) до начала Task 2:

- `StartUp/docs/каталог/ВЦ 4-70-2,5.pdf`
- `StartUp/docs/каталог/ВЦ 4-70-3,15.pdf`
- `StartUp/docs/каталог/ВЦ 4-70-4.pdf`

Папка `StartUp/docs/каталог/` уже создана.

## Global Constraints

- Три типоразмера ВЦ 4-70: 2,5 / 3,15 / 4 (не другие серии). Все 5 диаметров колеса
  (0,9 / 0,95 / 1,0 / 1,05 / 1,1 D_ном) на каждый типоразмер входят в объём.
- Частотный преобразователь (ЧП) не используется — обороты фиксированные, только те, что есть в
  таблице каталога.
- `podbor.html` — без сборки, без внешних CDN/шрифтов/библиотек, работает через `file://`. Свои
  JS-файлы (`podbor-calc.js`, `podbor-overlay.js`, `podbor-data.js`) подключаются как обычные
  (не `type="module"`) `<script src="...">` — это работает офлайн, в отличие от ES-модулей.
- Русский язык интерфейса.
- Никаких обещаний «за минуты» / цифр вида «80%» без замеров — честный тон, как в PRD и
  `index.html`.
- Список кандидатов сортируется по КПД (по убыванию).
- Значения по умолчанию формы: тип расчёта — «Полный»; отклонение вверх/вниз — 30% / 15%;
  температура — 20 °C.
- Мощность двигателя для найденной аэродинамической кривой — наименьший вариант двигателя из
  каталога, чья номинальная мощность ≥ расчётная мощность на валу × (1 + резерв мощности из
  формы, %).

## Review Focus

- Расход/давление вне диапазона всех оцифрованных кривых → честное сообщение «в демо-диапазоне
  подходящего варианта нет», а не пустой список или неверный подбор. Тест — Task 9.
- Ось расхода на графике каталога — «Q, тыс. м³/час», а пользователь вводит абсолютные м³/ч
  (например 6000) → пересчёт должен делить на 1000 при сравнении с кривой и не давать значение
  «в 1000 раз мимо». Тест — Task 5.
- «Тип расчёта = Статический»: коррекция через ось Pdv на заданном Q должна реально применяться
  до сравнения с кривой (сравниваем не введённое давление, а скорректированное) — это ровно та
  ошибка, ради которой писалась методичка [[podbor-ventilyatorov]] (раздел 0). Тест — Task 5.
- Переключение выбранного варианта в списке кандидатов должно менять картинку графика на
  картинку ЕГО типоразмера/диаметра и перерисовывать точку/параболу на ней — не оставлять старую
  точку поверх чужого графика. Тест — Task 8.
- Если для кривой не удалось оцифровать КПД/мощность в нужной точке — показывать «не
  подтверждено графиком», не подставлять число «с потолка». Тест — Task 5 и Task 9.

---

## Task 1: Библиотека для оцифровки графиков (Python)

**Files:**
- Create: `StartUp/scripts/digitize/lib.py`
- Create: `StartUp/scripts/digitize/test_lib.py`
- Create: `StartUp/scripts/digitize/requirements.txt`
- Create: `StartUp/scripts/digitize/render_pages.py`

**Interfaces:**
- Produces: `render_page(pdf_path, page_index, dpi=300) -> PIL.Image.Image`,
  `fit_log_axis(pixel_coords: list[float], values: list[float]) -> dict{"slope","intercept"}`,
  `value_at_pixel(pixel: float, cal: dict) -> float`,
  `fit_quadratic(xs: list[float], ys: list[float]) -> dict{"a","b","c"}`,
  `eval_quadratic(coeffs: dict, x: float) -> float`. Используются в Task 2-4.

- [ ] **Step 1: Зависимости**

Создать `StartUp/scripts/digitize/requirements.txt`:

```
pymupdf>=1.24
numpy>=1.26
pillow>=10.0
```

Установить:
```bash
cd "StartUp/scripts/digitize" && python -m pip install -r requirements.txt
```
Expected: установка без ошибок (PyMuPDF, numpy, Pillow уже проверены на этой машине — есть
интернет-доступ к PyPI).

- [ ] **Step 2: Написать падающий тест**

Создать `StartUp/scripts/digitize/test_lib.py`:

```python
import math
from lib import fit_log_axis, value_at_pixel, fit_quadratic, eval_quadratic

def test_fit_log_axis_recovers_known_calibration():
    # pixel = slope*log10(value) + intercept, known slope=-200, intercept=800
    slope, intercept = -200.0, 800.0
    values = [10, 100, 1000, 10000]
    pixels = [slope * math.log10(v) + intercept for v in values]
    cal = fit_log_axis(pixels, values)
    assert abs(cal["slope"] - slope) < 0.5, cal
    assert abs(cal["intercept"] - intercept) < 0.5, cal
    # round-trip: value_at_pixel should recover original values within 1%
    for px, v in zip(pixels, values):
        got = value_at_pixel(px, cal)
        assert abs(got - v) / v < 0.01, (got, v)

def test_fit_quadratic_recovers_known_coeffs():
    a, b, c = -0.5, 10.0, 200.0
    xs = [1, 2, 3, 4, 5]
    ys = [a * x * x + b * x + c for x in xs]
    coeffs = fit_quadratic(xs, ys)
    assert abs(coeffs["a"] - a) < 0.01
    assert abs(coeffs["b"] - b) < 0.01
    assert abs(coeffs["c"] - c) < 0.5
    assert abs(eval_quadratic(coeffs, 3) - ys[2]) < 0.5

if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    raise SystemExit(1 if failed else 0)
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `cd "StartUp/scripts/digitize" && python test_lib.py`
Expected: `ModuleNotFoundError: No module named 'lib'` (файла `lib.py` ещё нет).

- [ ] **Step 4: Реализовать `lib.py`**

Создать `StartUp/scripts/digitize/lib.py`:

```python
import math
import fitz  # PyMuPDF
import numpy as np
from PIL import Image
import io


def render_page(pdf_path, page_index, dpi=300):
    """Рендерит страницу PDF в PIL.Image при заданном dpi."""
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    doc.close()
    return img


def fit_log_axis(pixel_coords, values):
    """Калибровка лог-оси: pixel = slope*log10(value) + intercept.
    Возвращает {"slope": ..., "intercept": ...} через линейную регрессию."""
    logs = np.log10(np.array(values, dtype=float))
    px = np.array(pixel_coords, dtype=float)
    slope, intercept = np.polyfit(logs, px, 1)
    return {"slope": float(slope), "intercept": float(intercept)}


def value_at_pixel(pixel, cal):
    """Обратное преобразование: пиксель -> инженерная величина."""
    return 10 ** ((pixel - cal["intercept"]) / cal["slope"])


def fit_quadratic(xs, ys):
    """P = a*x^2 + b*x + c по точкам, снятым с кривой."""
    a, b, c = np.polyfit(np.array(xs, dtype=float), np.array(ys, dtype=float), 2)
    return {"a": float(a), "b": float(b), "c": float(c)}


def eval_quadratic(coeffs, x):
    return coeffs["a"] * x * x + coeffs["b"] * x + coeffs["c"]
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `cd "StartUp/scripts/digitize" && python test_lib.py`
Expected: `PASS test_fit_log_axis_recovers_known_calibration`, `PASS test_fit_quadratic_recovers_known_coeffs`, exit code 0.

- [ ] **Step 6: CLI для рендера страниц**

Создать `StartUp/scripts/digitize/render_pages.py`:

```python
import sys
from lib import render_page

def main():
    if len(sys.argv) < 4:
        print("Usage: python render_pages.py <pdf_path> <page_index_0based> <out_png> [dpi]")
        raise SystemExit(1)
    pdf_path, page_index, out_png = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 300
    img = render_page(pdf_path, page_index, dpi=dpi)
    img.save(out_png)
    print(f"Saved {out_png} ({img.size[0]}x{img.size[1]}px, {dpi}dpi)")

if __name__ == "__main__":
    main()
```

Проверить вручную на одном из каталогов (когда PDF уже сохранён по Prerequisite):
```bash
cd "StartUp/scripts/digitize" && python render_pages.py "../../docs/каталог/ВЦ 4-70-2,5.pdf" 0 /tmp/test-page0.png
```
Expected: файл создан, в выводе — реальные размеры в пикселях.

- [ ] **Step 7: Commit**

```bash
git add scripts/digitize/lib.py scripts/digitize/test_lib.py scripts/digitize/requirements.txt scripts/digitize/render_pages.py
git commit -m "Добавить библиотеку оцифровки графиков (калибровка осей, аппроксимация кривых)"
```

---

## Task 2: Оцифровка ВЦ 4-70-2,5

**Files:**
- Create: `StartUp/scripts/digitize/data_2_5.json` (промежуточный результат оцифровки)
- Create: `StartUp/scripts/test-data-2-5.js` (проверка против таблицы каталога)
- Create: `StartUp/assets/podbor/2.5-D0.9.png`, `2.5-D0.95.png`, `2.5-D1.png`, `2.5-D1.05.png`,
  `2.5-D1.1.png` (5 файлов, обрезанные графики — **имя для номинального диаметра — `2.5-D1.png`,
  без `.0`**: так это число сериализуется в JS при сборке `podbor-data.js` в Task 5, и оба места
  должны совпадать дословно)
- Create: `StartUp/assets/podbor/2.5-drawing.png` (чертёж)

**Interfaces:**
- Consumes: `render_page`, `fit_log_axis`, `value_at_pixel`, `fit_quadratic` из Task 1.
- Produces: `data_2_5.json` со структурой ниже — читается в Task 4б (сборка `podbor-data.js`).

Соответствие номинальных и фактических оборотов (из акустической таблицы каталога, стр. 10):
**1500 (ном.) → 1350 (факт.)**, **3000 (ном.) → 2750 (факт.)**.

Готовый (не требующий трассировки, уже перенесённый из текста каталога) скелет данных —
таблица двигателей и диапазоны производительности/давления (стр. 10 каталога), используются как
контрольные точки для валидации оцифровки:

```json
{
  "typorazmer": "2,5",
  "dimensionsByAngle": [
    {"angle": 0, "B": 485, "H": 510},
    {"angle": 45, "B": 430, "H": 655},
    {"angle": 90, "B": 430, "H": 600},
    {"angle": 135, "B": 555, "H": 565},
    {"angle": 270, "B": 430, "H": 515},
    {"angle": 315, "B": 555, "H": 500}
  ],
  "diameters": [
    {"d": 0.9, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.40, 0.90], "pRangeExpected": [63, 117],
       "motors": [
         {"nominalKw": 0.12, "consumedKw": 0.19, "type": "АИР56А4", "currentA": 0.44, "massKg": 17},
         {"nominalKw": 0.18, "consumedKw": 0.28, "type": "АИР56В4", "currentA": 0.65, "massKg": 18}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2750, "qRangeThousand": [0.80, 1.80], "pRangeExpected": [270, 490],
       "motors": [{"nominalKw": 0.37, "consumedKw": 0.51, "type": "АИР63А2", "currentA": 0.91, "massKg": 19}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 0.95, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.40, 0.90], "pRangeExpected": [90, 150],
       "motors": [
         {"nominalKw": 0.12, "consumedKw": 0.19, "type": "АИР56А4", "currentA": 0.44, "massKg": 17},
         {"nominalKw": 0.18, "consumedKw": 0.28, "type": "АИР56В4", "currentA": 0.65, "massKg": 18}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2750, "qRangeThousand": [0.80, 1.80], "pRangeExpected": [370, 610],
       "motors": [{"nominalKw": 0.55, "consumedKw": 0.73, "type": "АИР63В2", "currentA": 1.31, "massKg": 19}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.0, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.40, 0.90], "pRangeExpected": [100, 170],
       "motors": [
         {"nominalKw": 0.12, "consumedKw": 0.19, "type": "АИР56А4", "currentA": 0.44, "massKg": 17},
         {"nominalKw": 0.18, "consumedKw": 0.28, "type": "АИР56В4", "currentA": 0.65, "massKg": 18}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2750, "qRangeThousand": [0.80, 1.80], "pRangeExpected": [410, 710],
       "motors": [
         {"nominalKw": 0.55, "consumedKw": 0.73, "type": "АИР63В2", "currentA": 1.31, "massKg": 20},
         {"nominalKw": 0.75, "consumedKw": 0.96, "type": "АИР71А2", "currentA": 1.75, "massKg": 23}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.05, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.40, 0.90], "pRangeExpected": [120, 190],
       "motors": [
         {"nominalKw": 0.12, "consumedKw": 0.19, "type": "АИР56А4", "currentA": 0.44, "massKg": 17},
         {"nominalKw": 0.18, "consumedKw": 0.28, "type": "АИР56В4", "currentA": 0.65, "massKg": 18}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2750, "qRangeThousand": [0.80, 1.80], "pRangeExpected": [500, 800],
       "motors": [{"nominalKw": 0.75, "consumedKw": 0.96, "type": "АИР71А2", "currentA": 1.75, "massKg": 23}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.1, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.40, 0.90], "pRangeExpected": [160, 230],
       "motors": [
         {"nominalKw": 0.12, "consumedKw": 0.19, "type": "АИР56А4", "currentA": 0.44, "massKg": 17},
         {"nominalKw": 0.18, "consumedKw": 0.28, "type": "АИР56В4", "currentA": 0.65, "massKg": 18}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2750, "qRangeThousand": [0.80, 1.80], "pRangeExpected": [660, 980],
       "motors": [{"nominalKw": 0.75, "consumedKw": 0.96, "type": "АИР71А2", "currentA": 1.75, "massKg": 23}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null}
  ]
}
```

- [ ] **Step 1: Сохранить скелет выше в `StartUp/scripts/digitize/data_2_5.json`**

- [ ] **Step 2: Написать падающий тест валидации**

Создать `StartUp/scripts/test-data-2-5.js` (CommonJS, без зависимостей):

```js
const fs = require('fs');

function evalQuadratic(coeffs, x) {
  return coeffs.a * x * x + coeffs.b * x + coeffs.c;
}

function run() {
  const data = JSON.parse(fs.readFileSync(__dirname + '/digitize/data_2_5.json', 'utf8'));
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
      const pAtQMin = evalQuadratic(curve.coeffs, qMin);
      const pAtQMax = evalQuadratic(curve.coeffs, qMax);
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
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `cd StartUp && node scripts/test-data-2-5.js`
Expected: все строки `FAIL ...: coeffs не заполнены` (coeffs пока `null`).

- [ ] **Step 4: Оцифровать 5 графиков**

Для каждого из 5 диаметров (0,9 / 0,95 / 1,0 / 1,05 / 1,1):

1. Отрендерить страницу с нужным графиком (`D=Dном` — стр. 1 = page_index 0; остальные 4 —
   стр. 3 = page_index 2 файла `ВЦ 4-70-2,5.pdf`) через `render_pages.py` в 300dpi.
2. Открыть PNG через Read tool, определить пиксельные координаты обрезки нужного графика
   (на стр. 3 — четыре графика в сетке 2×2, подписаны `D=0,9Dном`, `D=0,95Dном`, `D=1,05Dном`,
   `D=1,1Dном`). Обрезать через `PIL.Image.crop` в отдельный файл
   `StartUp/assets/podbor/2.5-D<значение>.png` (например `2.5-D0.9.png`).
3. По методике [[podbor-ventilyatorov]] раздел 2 — откалибровать ось Q (значения `0.3, 0.4, 0.6,
   0.8, 1, 2` тыс. м³/ч на нижней шкале) и ось Pv (значения по сетке, напр. `100,200,300...2000`
   Па) через `fit_log_axis`, локально, вблизи рабочего участка. Отдельно откалибровать
   вспомогательную ось `Pdv, Па` (значения `10,20,50,70,100,200` Па) тем же способом — она
   пригодится в Task 5 для коррекции статика→полное давление.
4. По разделу 3 методички — трассировать обе кривые оборотов (n=1350 и n=2750) — снять 5-10
   точек по длине каждой, перевести пиксели в (Q,P) через калибровку, получить `coeffs` через
   `fit_quadratic`. Отдельно снять 2-3 точки пересечения каждой n-кривой с линиями КПД (`η=...`)
   и мощности (`N_y=...кВт`) — записать как `etaSamples: [{"q":..,"eta":..}, ...]` и
   `powerSamples: [{"q":..,"kw":..}, ...]` (в тех же тыс. м³/ч, что и Q).
5. Записать `coeffs`, `etaSamples`, `powerSamples` в соответствующую кривую в `data_2_5.json`, и
   калибровочные константы (`{"qAxis":..., "pAxis":..., "pdvAxis":..., "imageWidth":...,
   "imageHeight":...}`) в поле `calibration` диаметра.

- [ ] **Step 5: Обрезать и сохранить чертёж**

Из стр. 2 `ВЦ 4-70-2,5.pdf` (page_index 1) вырезать область с чертежом (виды А/Б с размерами) в
`StartUp/assets/podbor/2.5-drawing.png`.

- [ ] **Step 6: Запустить тест — убедиться, что проходит**

Run: `cd StartUp && node scripts/test-data-2-5.js`
Expected: `PASS` по всем 10 кривым (5 диаметров × 2 кривые оборотов). Если какая-то не проходит
допуск 8% — перепроверить калибровку/трассировку этой конкретной кривой по методичке
(скорее всего, перепутан диапазон шкалы или кривая КПД принята за кривую оборотов).

- [ ] **Step 7: Commit**

```bash
git add scripts/digitize/data_2_5.json scripts/test-data-2-5.js assets/podbor/2.5-*.png
git commit -m "Оцифровать аэродинамические характеристики ВЦ 4-70-2,5"
```

---

## Task 3: Оцифровка ВЦ 4-70-3,15

Тот же процесс, что в Task 2, для второго типоразмера.

**Files:**
- Create: `StartUp/scripts/digitize/data_3_15.json`
- Create: `StartUp/scripts/test-data-3-15.js`
- Create: `StartUp/assets/podbor/3.15-D0.9.png`, `3.15-D0.95.png`, `3.15-D1.png`,
  `3.15-D1.05.png`, `3.15-D1.1.png`, `3.15-drawing.png` (номинальный диаметр — файл
  `3.15-D1.png`, без `.0`, как и в Task 2 — так число сериализуется в JS при сборке
  `podbor-data.js` в Task 5)

Соответствие оборотов (акустическая таблица, стр. 13): **1500 (ном.) → 1350 (факт.)**,
**3000 (ном.) → 2850 (факт.)**.

Скелет `data_3_15.json` (dimensionsByAngle и таблица двигателей/диапазонов — из стр. 13
каталога):

```json
{
  "typorazmer": "3,15",
  "dimensionsByAngle": [
    {"angle": 0, "B": 570, "H": 600},
    {"angle": 45, "B": 515, "H": 770},
    {"angle": 90, "B": 505, "H": 705},
    {"angle": 135, "B": 655, "H": 665},
    {"angle": 270, "B": 505, "H": 610},
    {"angle": 315, "B": 655, "H": 590}
  ],
  "diameters": [
    {"d": 0.9, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.76, 1.90], "pRangeExpected": [95, 192],
       "motors": [{"nominalKw": 0.18, "consumedKw": 0.28, "type": "АИР56В4", "currentA": 0.65, "massKg": 25}],
       "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [1.60, 4.00], "pRangeExpected": [400, 820],
       "motors": [{"nominalKw": 1.1, "consumedKw": 1.39, "type": "АИР71В2", "currentA": 2.55, "massKg": 31}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 0.95, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.76, 1.90], "pRangeExpected": [120, 240],
       "motors": [{"nominalKw": 0.18, "consumedKw": 0.28, "type": "АИР56В4", "currentA": 0.65, "massKg": 25}],
       "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [1.60, 4.00], "pRangeExpected": [550, 1050],
       "motors": [{"nominalKw": 1.5, "consumedKw": 1.85, "type": "АИР80А2", "currentA": 3.30, "massKg": 34}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.0, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.76, 2.00], "pRangeExpected": [140, 275],
       "motors": [
         {"nominalKw": 0.25, "consumedKw": 0.37, "type": "АИР63А4", "currentA": 0.83, "massKg": 26},
         {"nominalKw": 0.37, "consumedKw": 0.55, "type": "АИР63В4", "currentA": 1.20, "massKg": 27}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [1.60, 4.00], "pRangeExpected": [600, 1200],
       "motors": [
         {"nominalKw": 1.5, "consumedKw": 1.85, "type": "АИР80А2", "currentA": 3.30, "massKg": 34},
         {"nominalKw": 2.2, "consumedKw": 2.72, "type": "АИР80В2", "currentA": 4.8, "massKg": 37}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.05, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.76, 2.00], "pRangeExpected": [180, 310],
       "motors": [
         {"nominalKw": 0.25, "consumedKw": 0.37, "type": "АИР63А4", "currentA": 0.83, "massKg": 27},
         {"nominalKw": 0.37, "consumedKw": 0.55, "type": "АИР63В4", "currentA": 1.20, "massKg": 27}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [1.60, 4.00], "pRangeExpected": [800, 1300],
       "motors": [{"nominalKw": 2.2, "consumedKw": 2.72, "type": "АИР80В2", "currentA": 4.8, "massKg": 37}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.1, "curves": [
      {"rpmNominal": 1500, "rpmActual": 1350, "qRangeThousand": [0.76, 2.00], "pRangeExpected": [200, 370],
       "motors": [{"nominalKw": 0.37, "consumedKw": 0.55, "type": "АИР63В4", "currentA": 1.20, "massKg": 27}],
       "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [1.60, 4.00], "pRangeExpected": [900, 1600],
       "motors": [{"nominalKw": 2.2, "consumedKw": 2.72, "type": "АИР80В2", "currentA": 4.8, "massKg": 37}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null}
  ]
}
```

- [ ] **Step 1-7:** повторить шаги Task 2 (сохранить скелет → падающий тест по образцу
  `test-data-2-5.js`, только читающий `data_3_15.json` → оцифровать 5 графиков со стр. 1 и 3
  `ВЦ 4-70-3,15.pdf` → вырезать чертёж со стр. 2 → тест проходит → commit).

Ожидаемый commit message: `Оцифровать аэродинамические характеристики ВЦ 4-70-3,15`.

---

## Task 4: Оцифровка ВЦ 4-70-4

Тот же процесс, для третьего типоразмера — но здесь **3 кривые оборотов на каждом графике**
(не 2), т.к. у ВЦ 4-70-4 три частоты вращения.

**Files:**
- Create: `StartUp/scripts/digitize/data_4.json`
- Create: `StartUp/scripts/test-data-4.js`
- Create: `StartUp/assets/podbor/4-D0.9.png`, `4-D0.95.png`, `4-D1.png`, `4-D1.05.png`,
  `4-D1.1.png`, `4-drawing.png` (номинальный диаметр — файл `4-D1.png`, без `.0`, как и в
  Task 2 — так число сериализуется в JS при сборке `podbor-data.js` в Task 5)

Соответствие оборотов (акустическая таблица, стр. 17): **1000 (ном.) → 880 (факт.)**,
**1500 (ном.) → 1380 (факт.)**, **3000 (ном.) → 2850 (факт.)**.

Скелет `data_4.json` (dimensionsByAngle и таблица — из стр. 17 каталога):

```json
{
  "typorazmer": "4",
  "dimensionsByAngle": [
    {"angle": 0, "B": 720, "H": 745},
    {"angle": 45, "B": 650, "H": 955},
    {"angle": 90, "B": 635, "H": 880},
    {"angle": 135, "B": 820, "H": 835},
    {"angle": 270, "B": 635, "H": 760},
    {"angle": 315, "B": 820, "H": 735}
  ],
  "diameters": [
    {"d": 0.9, "curves": [
      {"rpmNominal": 1000, "rpmActual": 880, "qRangeThousand": [1.20, 2.60], "pRangeExpected": [68, 140],
       "motors": [{"nominalKw": 0.18, "consumedKw": 0.32, "type": "АИР63А6", "currentA": 0.79, "massKg": 40}],
       "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 1500, "rpmActual": 1380, "qRangeThousand": [1.80, 4.20], "pRangeExpected": [170, 340],
       "motors": [{"nominalKw": 0.55, "consumedKw": 0.77, "type": "АИР71А4", "currentA": 1.61, "massKg": 44}],
       "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [3.70, 8.50], "pRangeExpected": [750, 1500],
       "motors": [
         {"nominalKw": 4, "consumedKw": 4.69, "type": "АИР100S2", "currentA": 7.9, "massKg": 63},
         {"nominalKw": 5.5, "consumedKw": 6.25, "type": "АИР100L2", "currentA": 10.7, "massKg": 68}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 0.95, "curves": [
      {"rpmNominal": 1000, "rpmActual": 880, "qRangeThousand": [1.20, 2.60], "pRangeExpected": [90, 172],
       "motors": [
         {"nominalKw": 0.18, "consumedKw": 0.32, "type": "АИР63А6", "currentA": 0.79, "massKg": 40},
         {"nominalKw": 0.25, "consumedKw": 0.42, "type": "АИР63В6", "currentA": 1.04, "massKg": 41}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 1500, "rpmActual": 1380, "qRangeThousand": [1.80, 4.20], "pRangeExpected": [220, 415],
       "motors": [
         {"nominalKw": 0.55, "consumedKw": 0.77, "type": "АИР71А4", "currentA": 1.61, "massKg": 44},
         {"nominalKw": 0.75, "consumedKw": 1.0, "type": "АИР71В4", "currentA": 1.90, "massKg": 45}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [3.70, 8.50], "pRangeExpected": [890, 1700],
       "motors": [
         {"nominalKw": 4, "consumedKw": 4.69, "type": "АИР100S2", "currentA": 7.9, "massKg": 63},
         {"nominalKw": 5.5, "consumedKw": 6.25, "type": "АИР100L2", "currentA": 10.7, "massKg": 68}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.0, "curves": [
      {"rpmNominal": 1000, "rpmActual": 880, "qRangeThousand": [1.20, 2.60], "pRangeExpected": [110, 210],
       "motors": [
         {"nominalKw": 0.25, "consumedKw": 0.42, "type": "АИР63В6", "currentA": 1.04, "massKg": 42},
         {"nominalKw": 0.37, "consumedKw": 0.57, "type": "АИР71А6", "currentA": 1.31, "massKg": 45}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 1500, "rpmActual": 1380, "qRangeThousand": [1.80, 4.20], "pRangeExpected": [280, 500],
       "motors": [
         {"nominalKw": 0.75, "consumedKw": 1.0, "type": "АИР71В4", "currentA": 1.90, "massKg": 46},
         {"nominalKw": 1.1, "consumedKw": 1.47, "type": "АИР80А4", "currentA": 2.75, "massKg": 49}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [3.70, 9.00], "pRangeExpected": [1200, 2100],
       "motors": [
         {"nominalKw": 5.5, "consumedKw": 6.25, "type": "АИР100L2", "currentA": 10.7, "massKg": 69},
         {"nominalKw": 7.5, "consumedKw": 8.57, "type": "АИР112М2", "currentA": 14.7, "massKg": 78}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.05, "curves": [
      {"rpmNominal": 1000, "rpmActual": 880, "qRangeThousand": [1.20, 2.60], "pRangeExpected": [130, 225],
       "motors": [{"nominalKw": 0.37, "consumedKw": 0.57, "type": "АИР71А6", "currentA": 1.31, "massKg": 45}],
       "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 1500, "rpmActual": 1380, "qRangeThousand": [1.80, 4.20], "pRangeExpected": [310, 550],
       "motors": [
         {"nominalKw": 1.1, "consumedKw": 1.47, "type": "АИР80А4", "currentA": 2.75, "massKg": 49},
         {"nominalKw": 1.5, "consumedKw": 1.92, "type": "АИР80В4", "currentA": 3.52, "massKg": 51}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [4.00, 9.00], "pRangeExpected": [1300, 2300],
       "motors": [{"nominalKw": 7.5, "consumedKw": 8.57, "type": "АИР112М2", "currentA": 14.7, "massKg": 79}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null},
    {"d": 1.1, "curves": [
      {"rpmNominal": 1000, "rpmActual": 880, "qRangeThousand": [1.20, 2.60], "pRangeExpected": [160, 270],
       "motors": [{"nominalKw": 0.37, "consumedKw": 0.57, "type": "АИР71А6", "currentA": 1.31, "massKg": 45}],
       "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 1500, "rpmActual": 1380, "qRangeThousand": [1.80, 4.20], "pRangeExpected": [400, 680],
       "motors": [
         {"nominalKw": 1.1, "consumedKw": 1.47, "type": "АИР80А4", "currentA": 2.75, "massKg": 49},
         {"nominalKw": 1.5, "consumedKw": 1.92, "type": "АИР80В4", "currentA": 3.52, "massKg": 51}
       ], "coeffs": null, "etaSamples": [], "powerSamples": []},
      {"rpmNominal": 3000, "rpmActual": 2850, "qRangeThousand": [4.00, 9.00], "pRangeExpected": [1700, 2900],
       "motors": [{"nominalKw": 7.5, "consumedKw": 8.57, "type": "АИР112М2", "currentA": 14.7, "massKg": 79}],
       "coeffs": null, "etaSamples": [], "powerSamples": []}
    ], "calibration": null}
  ]
}
```

- [ ] **Step 1-7:** повторить шаги Task 2 (15 кривых вместо 10 — по 3 на каждый из 5 диаметров;
  исходник — `ВЦ 4-70-4.pdf`, график D=Dном на стр. 1, остальные 4 на стр. 3, чертёж на стр. 2).

Ожидаемый commit message: `Оцифровать аэродинамические характеристики ВЦ 4-70-4`.

---

## Task 5: Расчётный движок `podbor-calc.js`

**Files:**
- Create: `StartUp/podbor-calc.js`
- Create: `StartUp/podbor-data.js` (собирает 3 JSON из Task 2-4 в один объект `window.PODBOR_DATA`)
- Create: `StartUp/scripts/test-podbor-calc.js`

**Interfaces:**
- Consumes: `data_2_5.json`, `data_3_15.json`, `data_4.json` из Task 2-4.
- Produces: `PodborCalc.correctToFullPressure(input) -> pTargetPa`,
  `PodborCalc.evalQuadratic(coeffs, qThousand) -> pPa`,
  `PodborCalc.airDensityRatio(tempC) -> number`,
  `PodborCalc.intersectWithNetwork(coeffs, qRangeThousand, q0Thousand, p0Pa) -> {qThousand,pPa}|null`,
  `PodborCalc.interpolateSamples(samples, qThousand) -> number|null`,
  `PodborCalc.pickMotor(motors, shaftKw, marginPct) -> motor|null`,
  `PodborCalc.selectCandidates(data, input) -> candidate[]` (принимает опционально `input.tempC`,
  по умолчанию 20). Используются в Task 7-8 (`podbor.html`).

- [ ] **Step 1: Собрать `podbor-data.js` из трёх JSON**

```bash
cd StartUp && node -e "
const fs = require('fs');
const d25 = JSON.parse(fs.readFileSync('scripts/digitize/data_2_5.json','utf8'));
const d315 = JSON.parse(fs.readFileSync('scripts/digitize/data_3_15.json','utf8'));
const d4 = JSON.parse(fs.readFileSync('scripts/digitize/data_4.json','utf8'));
d25.drawingImage = 'assets/podbor/2.5-drawing.png';
d315.drawingImage = 'assets/podbor/3.15-drawing.png';
d4.drawingImage = 'assets/podbor/4-drawing.png';
for (const dia of d25.diameters) dia.graphImage = 'assets/podbor/2.5-D' + dia.d + '.png';
for (const dia of d315.diameters) dia.graphImage = 'assets/podbor/3.15-D' + dia.d + '.png';
for (const dia of d4.diameters) dia.graphImage = 'assets/podbor/4-D' + dia.d + '.png';
const data = { series: 'ВЦ 4-70', typorazmery: { '2,5': d25, '3,15': d315, '4': d4 } };
const js = 'window.PODBOR_DATA = ' + JSON.stringify(data, null, 2) + ';\n';
fs.writeFileSync('podbor-data.js', js);
console.log('written podbor-data.js');
"
```

Expected: `written podbor-data.js`, файл содержит все три типоразмера с заполненными `coeffs`.

- [ ] **Step 2: Написать падающий тест расчётного движка**

Создать `StartUp/scripts/test-podbor-calc.js`:

```js
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
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `cd StartUp && node scripts/test-podbor-calc.js`
Expected: `Error: Cannot find module '../podbor-calc.js'`.

- [ ] **Step 4: Реализовать `podbor-calc.js`**

```js
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

  function pickMotor(motors, shaftKw, marginPct) {
    const required = shaftKw * (1 + (marginPct || 0) / 100);
    const sorted = [...motors].sort((a, b) => a.nominalKw - b.nominalKw);
    return sorted.find((m) => m.nominalKw >= required) || null;
  }

  function selectCandidates(data, input) {
    const candidates = [];
    for (const [typorazmerKey, typorazmer] of Object.entries(data.typorazmery)) {
      for (const dia of typorazmer.diameters) {
        const pdvCoeffC = dia.calibration && dia.calibration.pdvAxis ? dia.calibration.pdvAxis.coeffC : null;
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
          const point = intersectWithNetwork(scaledCoeffs, curve.qRangeThousand, q0Thousand, pTarget);
          if (!point) continue;
          const pMin = pTarget * (1 - (input.downPct || 0) / 100);
          const pMax = pTarget * (1 + (input.upPct || 0) / 100);
          if (point.pPa < pMin || point.pPa > pMax) continue;
          const eta = interpolateSamples(curve.etaSamples, point.qThousand);
          const shaftKw = eta ? (point.pPa * point.qThousand * 1000) / (3600 * 1000 * eta) : null;
          const motor = shaftKw != null ? pickMotor(curve.motors, shaftKw, input.marginPct || 0) : null;
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
    pickMotor,
    selectCandidates
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PodborCalc = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `cd StartUp && node scripts/test-podbor-calc.js`
Expected: все строки `PASS`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add podbor-calc.js podbor-data.js scripts/test-podbor-calc.js
git commit -m "Добавить расчётный движок подбора (коррекция давления, пересечение с сетью, выбор двигателя)"
```

---

## Task 6: Отрисовка точки и параболы сети на графике (`podbor-overlay.js`)

**Files:**
- Create: `StartUp/podbor-overlay.js`
- Create: `StartUp/scripts/test-podbor-overlay.js`

**Interfaces:**
- Consumes: калибровочные константы `calibration.qAxis`/`calibration.pAxis` (формат
  `{"slope":..,"intercept":..}`, `pixel = slope*log10(value)+intercept`) из Task 2-4.
- Produces: `PodborOverlay.pixelForQ(qThousand, calibration) -> number`,
  `PodborOverlay.pixelForP(pPa, calibration) -> number`,
  `PodborOverlay.renderOverlay(svgEl, {qThousand, pPa, targetQThousand, targetPPa}, calibration)`.
  Используется в Task 8.

- [ ] **Step 1: Написать падающий тест**

Создать `StartUp/scripts/test-podbor-overlay.js`:

```js
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
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd StartUp && node scripts/test-podbor-overlay.js`
Expected: `Error: Cannot find module '../podbor-overlay.js'`.

- [ ] **Step 3: Реализовать `podbor-overlay.js`**

```js
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
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `cd StartUp && node scripts/test-podbor-overlay.js`
Expected: все `PASS`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add podbor-overlay.js scripts/test-podbor-overlay.js
git commit -m "Добавить отрисовку точки и параболы сети поверх графика"
```

---

## Task 7: Страница `podbor.html` — форма и список кандидатов

**Files:**
- Create: `StartUp/podbor.html`

**Interfaces:**
- Consumes: `PodborCalc.selectCandidates` (Task 5), `window.PODBOR_DATA` (Task 5).
- Produces: DOM-элементы с id `qInput,pInput,calcType,upPct,downPct,tempInput,ispolnenie,
  calcBtn,candidateList,resultMessage` — используются в Task 8-9.

- [ ] **Step 1: Написать `podbor.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Демо подбора ВЦ 4-70</title>
<style>
  :root { --bg:#0d1117; --fg:#e6edf3; --accent:#4c8dff; --accent-strong:#1d5fd1; --border:#30363d; }
  body { background:var(--bg); color:var(--fg); font-family:system-ui,sans-serif; margin:0; padding:16px; }
  h1 { font-size:1.4rem; }
  label { display:block; margin-top:12px; font-size:0.9rem; }
  input, select { width:100%; max-width:360px; padding:8px; margin-top:4px; background:#161b22; color:var(--fg); border:1px solid var(--border); border-radius:6px; box-sizing:border-box; }
  button { margin-top:16px; padding:10px 20px; background:var(--accent-strong); color:white; border:none; border-radius:6px; cursor:pointer; font-size:1rem; }
  button:focus-visible, a:focus-visible { outline:2px solid var(--accent); }
  #candidateList { list-style:none; padding:0; margin-top:16px; }
  #candidateList li { padding:10px; border:1px solid var(--border); border-radius:6px; margin-bottom:8px; cursor:pointer; }
  #candidateList li:hover, #candidateList li.selected { border-color:var(--accent); }
  #resultMessage { margin-top:12px; }
  #graphView { position:relative; margin-top:16px; max-width:100%; }
  #graphView img { max-width:100%; display:block; }
  #graphView svg { position:absolute; top:0; left:0; width:100%; height:100%; }
  #summary, #chertyozhView { margin-top:16px; }
  table { border-collapse:collapse; }
  td, th { border:1px solid var(--border); padding:4px 8px; text-align:left; }
</style>
</head>
<body>
  <h1>Демо: подбор ВЦ 4-70 по рабочей точке</h1>
  <p>Прототип для проверки на первых пользователях. Данные — только по типоразмерам 2,5 / 3,15 / 4.</p>

  <label for="qInput">Расход требуемый, м³/ч
    <input id="qInput" type="number" value="6000" min="1">
  </label>
  <label for="pInput">Давление требуемое, Па
    <input id="pInput" type="number" value="1100" min="1">
  </label>
  <label for="calcType">Тип расчёта
    <select id="calcType">
      <option value="full" selected>Полный</option>
      <option value="static">Статический</option>
    </select>
  </label>
  <label for="upPct">Допустимое отклонение вверх, %
    <input id="upPct" type="number" value="30" min="0" max="200">
  </label>
  <label for="downPct">Допустимое отклонение вниз, %
    <input id="downPct" type="number" value="15" min="0" max="100">
  </label>
  <label for="tempInput">Температура воздуха, °C
    <input id="tempInput" type="number" value="20">
  </label>
  <label for="ispolnenie">Исполнение
    <select id="ispolnenie">
      <option value="general">Общего назначения (оцинкованная сталь)</option>
      <option value="corrosion">Коррозионностойкое (нержавеющая сталь)</option>
    </select>
  </label>

  <button id="calcBtn" type="button">Рассчитать</button>

  <div id="resultMessage" role="status"></div>
  <ul id="candidateList"></ul>
  <div id="graphView" hidden>
    <img id="graphImg" alt="Аэродинамическая характеристика выбранного вентилятора">
    <svg id="graphSvg"></svg>
  </div>
  <div id="summary"></div>
  <div id="chertyozhView"></div>

  <script src="podbor-data.js"></script>
  <script src="podbor-calc.js"></script>
  <script src="podbor-overlay.js"></script>
  <script src="podbor-ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: Проверить, что страница открывается без ошибок в консоли**

Открыть `StartUp/podbor.html` через Playwright MCP (`browser_navigate` на `file:///.../podbor.html`),
`browser_console_messages` — до появления `podbor-ui.js` (следующий Task) ожидается одна ошибка
`podbor-ui.js net::ERR_FILE_NOT_FOUND` — это ожидаемо, файл ещё не создан. После Task 8 эта
проверка повторяется и ошибка должна исчезнуть.

- [ ] **Step 3: Commit**

```bash
git add podbor.html
git commit -m "Добавить страницу демо-подбора: форма ввода и разметка результата"
```

---

## Task 8: Логика страницы `podbor-ui.js` — расчёт, список, график

**Files:**
- Create: `StartUp/podbor-ui.js`

**Interfaces:**
- Consumes: `PodborCalc.selectCandidates`, `PodborOverlay.renderOverlay`, `window.PODBOR_DATA`,
  DOM id из Task 7.

- [ ] **Step 1: Реализовать `podbor-ui.js`**

```js
(function () {
  const ISPOLNENIE_LABELS = {
    general: 'Общего назначения (оцинкованная сталь)',
    corrosion: 'Коррозионностойкое (нержавеющая сталь)'
  };

  function readInput() {
    return {
      qReqM3h: Number(document.getElementById('qInput').value),
      pReqPa: Number(document.getElementById('pInput').value),
      calcType: document.getElementById('calcType').value,
      upPct: Number(document.getElementById('upPct').value),
      downPct: Number(document.getElementById('downPct').value),
      tempC: Number(document.getElementById('tempInput').value),
      ispolnenie: document.getElementById('ispolnenie').value,
      marginPct: 0
    };
  }

  function renderCandidateList(candidates) {
    const list = document.getElementById('candidateList');
    list.innerHTML = '';
    candidates.forEach((c, idx) => {
      const li = document.createElement('li');
      const etaText = c.eta != null ? `КПД ${(c.eta * 100).toFixed(0)}%` : 'КПД не подтверждён графиком';
      const motorText = c.motor ? `двигатель ${c.motor.type} (${c.motor.nominalKw} кВт)` : 'двигатель не подобран';
      li.textContent = `ВЦ 4-70-${c.typorazmer} D=${c.diameter}Dном, n=${c.rpmActual} об/мин — ${etaText}, ${motorText}`;
      li.dataset.index = String(idx);
      li.addEventListener('click', () => selectCandidate(candidates, idx));
      list.appendChild(li);
    });
  }

  let lastInput = null;

  function selectCandidate(candidates, idx) {
    [...document.querySelectorAll('#candidateList li')].forEach((li) => li.classList.remove('selected'));
    const li = document.querySelector(`#candidateList li[data-index="${idx}"]`);
    if (li) li.classList.add('selected');

    const c = candidates[idx];
    const graphView = document.getElementById('graphView');
    const img = document.getElementById('graphImg');
    graphView.hidden = false;
    img.src = c.graphImage;
    img.onload = () => {
      const svg = document.getElementById('graphSvg');
      svg.setAttribute('viewBox', `0 0 ${img.naturalWidth} ${img.naturalHeight}`);
      window.PodborOverlay.renderOverlay(svg, {
        qThousand: c.qFactM3h / 1000,
        pPa: c.pFactPa,
        targetQThousand: c.targetQThousand,
        targetPPa: c.targetPPa
      }, c.calibration);
    };

    const summary = document.getElementById('summary');
    summary.innerHTML = `
      <table>
        <tr><th>Заданный расход</th><td>${lastInput.qReqM3h} м³/ч</td></tr>
        <tr><th>Заданное давление</th><td>${lastInput.pReqPa} Па (${lastInput.calcType === 'static' ? 'статический' : 'полный'} расчёт)</td></tr>
        <tr><th>Температура воздуха</th><td>${lastInput.tempC} °C</td></tr>
        <tr><th>Исполнение</th><td>${ISPOLNENIE_LABELS[lastInput.ispolnenie] || lastInput.ispolnenie}</td></tr>
        <tr><th>Давление, скорректированное под расчёт</th><td>${c.targetPPa.toFixed(0)} Па</td></tr>
        <tr><th>Модель</th><td>ВЦ 4-70-${c.typorazmer} D=${c.diameter}Dном</td></tr>
        <tr><th>Фактический расход</th><td>${c.qFactM3h.toFixed(0)} м³/ч</td></tr>
        <tr><th>Фактическое давление</th><td>${c.pFactPa.toFixed(0)} Па</td></tr>
        <tr><th>КПД</th><td>${c.eta != null ? (c.eta * 100).toFixed(0) + '%' : 'не подтверждён графиком'}</td></tr>
        <tr><th>Мощность на валу</th><td>${c.shaftKw != null ? c.shaftKw.toFixed(2) + ' кВт' : 'не подтверждена графиком'}</td></tr>
        <tr><th>Двигатель</th><td>${c.motor ? `${c.motor.type}, ${c.motor.nominalKw} кВт` : 'не подобран каталогом'}</td></tr>
      </table>
    `;

    renderChertyozh(c);
  }

  function renderChertyozh(c) {
    const typorazmer = window.PODBOR_DATA.typorazmery[c.typorazmer];
    const view = document.getElementById('chertyozhView');
    const rows = typorazmer.dimensionsByAngle.map((r) => `<tr><td>${r.angle}°</td><td>${r.B}</td><td>${r.H}</td></tr>`).join('');
    view.innerHTML = `
      <h2>Габаритно-присоединительные размеры — ВЦ 4-70-${c.typorazmer}</h2>
      <img src="${typorazmer.drawingImage}" alt="Чертёж ВЦ 4-70-${c.typorazmer}" style="max-width:100%">
      <table>
        <tr><th>Угол поворота корпуса</th><th>B, мм</th><th>H, мм</th></tr>
        ${rows}
      </table>
    `;
  }

  function runCalculation() {
    const input = readInput();
    lastInput = input;
    const message = document.getElementById('resultMessage');
    const candidates = window.PodborCalc.selectCandidates(window.PODBOR_DATA, input);
    if (candidates.length === 0) {
      message.textContent = 'В демо-диапазоне (ВЦ 4-70, №2,5/3,15/4) подходящего варианта нет — напишите нам для полного расчёта.';
      document.getElementById('candidateList').innerHTML = '';
      document.getElementById('graphView').hidden = true;
      document.getElementById('summary').innerHTML = '';
      document.getElementById('chertyozhView').innerHTML = '';
      return;
    }
    message.textContent = `Найдено вариантов: ${candidates.length}.`;
    renderCandidateList(candidates);
    selectCandidate(candidates, 0);
  }

  document.getElementById('calcBtn').addEventListener('click', runCalculation);
})();
```

- [ ] **Step 2: Проверить в браузере через Playwright MCP**

`browser_navigate` на `file:///.../StartUp/podbor.html`, `browser_console_messages` (должно быть
0 ошибок), ввести Q=6000, P=1100, нажать «Рассчитать», `browser_snapshot` — убедиться, что список
кандидатов не пуст, выбрать второй пункт списка, `browser_take_screenshot` — убедиться, что
картинка графика и точка на ней поменялись (не осталась от первого варианта) — это прямая
проверка Review Focus про переключение вариантов.

- [ ] **Step 3: Commit**

```bash
git add podbor-ui.js
git commit -m "Подключить расчёт, список кандидатов и отрисовку графика к странице демо"
```

---

## Task 9: Обработка ошибок и честные сообщения

**Files:**
- Modify: `StartUp/podbor-calc.js` (если понадобятся доп. проверки — статический расчёт без
  калибровки Pdv)
- Create: `StartUp/scripts/test-podbor-edge-cases.js`

**Interfaces:**
- Consumes: `PodborCalc.selectCandidates`.

- [ ] **Step 1: Написать падающий тест на честные сообщения при нетипичном вводе**

Создать `StartUp/scripts/test-podbor-edge-cases.js`:

```js
const assert = require('assert');
const PodborCalc = require('../podbor-calc.js');

function run() {
  const tests = [];

  tests.push(['Отклонение 0% не находит кандидатов, если точное совпадение маловероятно', () => {
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [
      { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.4, 0.9], coeffs: { a: -50, b: 0, c: 150 }, motors: [{ nominalKw: 0.2, type: 'M' }], etaSamples: [], powerSamples: [] }
    ] }] } } };
    // заданная точка сильно не совпадает с кривой
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 500, pReqPa: 900, calcType: 'full', upPct: 0, downPct: 0, marginPct: 0 });
    assert.strictEqual(result.length, 0);
  }]);

  tests.push(['Без oцифрованной Pdv-калибровки статический расчёт не крашится (считает Pdv=0, не додумывает)', () => {
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: { pdvAxis: null }, curves: [
      { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.4, 0.9], coeffs: { a: 0, b: 0, c: 500 }, motors: [{ nominalKw: 0.2, type: 'M' }], etaSamples: [{ q: 0.4, eta: 0.5 }, { q: 0.9, eta: 0.6 }], powerSamples: [] }
    ] }] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 600, pReqPa: 500, calcType: 'static', upPct: 30, downPct: 15, marginPct: 0 });
    // не должно бросать исключение; раз Pdv не откалиброван, коррекция = 0 (не додумываем на глаз)
    assert.ok(Array.isArray(result));
  }]);

  tests.push(['Кандидат без КПД получает eta=null и mощность=null, а не выдуманное число', () => {
    const data = { typorazmery: { '2,5': { diameters: [{ d: 1.0, graphImage: 'x', calibration: {}, curves: [
      { rpmNominal: 1500, rpmActual: 1350, qRangeThousand: [0.4, 0.9], coeffs: { a: 0, b: 0, c: 500 }, motors: [{ nominalKw: 0.2, type: 'M' }], etaSamples: [], powerSamples: [] }
    ] }] } } };
    const result = PodborCalc.selectCandidates(data, { qReqM3h: 600, pReqPa: 500, calcType: 'full', upPct: 30, downPct: 15, marginPct: 0 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].eta, null);
    assert.strictEqual(result[0].shaftKw, null);
    assert.strictEqual(result[0].motor, null);
  }]);

  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
  }
  process.exit(failed ? 1 : 0);
}

run();
```

- [ ] **Step 2: Запустить — часть тестов должна упасть или выявить недоработку**

Run: `cd StartUp && node scripts/test-podbor-edge-cases.js`
Expected: скорее всего всё уже проходит благодаря коду из Task 5 (там `eta`/`shaftKw`/`motor`
уже `null`, если `interpolateSamples`/`pickMotor` не находят данных). Если что-то падает —
поправить `selectCandidates`/`correctToFullPressure` в `podbor-calc.js` так, чтобы отсутствие
данных давало `null`, а не исключение или придуманное число.

- [ ] **Step 3: Убедиться, что все тесты проходят**

Run: `cd StartUp && node scripts/test-podbor-edge-cases.js`
Expected: все `PASS`, exit code 0.

- [ ] **Step 4: Проверить сообщение «нет варианта» в браузере**

Через Playwright MCP ввести заведомо недостижимое давление (например 100000 Па), нажать
«Рассчитать», `browser_snapshot` — убедиться, что `#resultMessage` содержит текст «в
демо-диапазоне... подходящего варианта нет», без цифр «80%»/«за минуты».

- [ ] **Step 5: Commit**

```bash
git add scripts/test-podbor-edge-cases.js podbor-calc.js
git commit -m "Закрыть граничные случаи: честные сообщения вместо придуманных чисел"
```

---

## Task 10: Ссылка с лендинга и итоговая проверка по контрольным точкам

**Files:**
- Modify: `StartUp/index.html` (секция «Что дальше»)
- Create: `StartUp/docs/superpowers/plans/2026-09-23-demo-podbor-validation.md` (протокол проверки)

- [ ] **Step 1: Добавить ссылку на демо в лендинг**

Открыть `StartUp/index.html`, найти секцию «Что дальше» (по `PRD.md`: призыв написать, если тема
откликнулась) и добавить туда ссылку на `podbor.html`, например:
```html
<p><a href="podbor.html">Попробовать демо подбора (ВЦ 4-70)</a></p>
```
Точное место и формулировку — сверить с текущей вёрсткой `index.html` перед вставкой (открыть
файл, найти секцию по тексту из PRD).

- [ ] **Step 2: Проверить, что лендинг по-прежнему проходит существующие проверки**

Run: `cd StartUp && node scripts/check-landing.mjs`
Expected: без новых `FAIL` по сравнению с состоянием до изменения (ссылка на `podbor.html` не
должна ломать проверки на внешние ресурсы — это локальный относительный путь, не внешний домен).

- [ ] **Step 3: Прогнать контрольные точки по всем трём типоразмерам**

Взять по 2 точки на каждый типоразмер прямо из `pRangeExpected`/`qRangeThousand`, уже
зашитых в `data_*.json` (Task 2-4) — например, для ВЦ 4-70-2,5 D=1,0/1500об: Q≈650 м³/ч,
P≈135 Па (середина диапазона 0,40-0,90 тыс/170-100 Па). Через Playwright MCP: открыть
`podbor.html`, ввести эти Q/P, нажать «Рассчитать», убедиться, что среди кандидатов есть вариант
ВЦ 4-70-2,5 D=1,0Dном, n≈1350. Повторить для одной точки каждого из трёх типоразмеров (3
прогона).

- [ ] **Step 4: Записать результат проверки**

Создать `StartUp/docs/superpowers/plans/2026-09-23-demo-podbor-validation.md` с таблицей:
типоразмер | введённые Q,P | ожидаемая модель | что показало демо | совпало? — заполнить по
результатам Step 3.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/superpowers/plans/2026-09-23-demo-podbor-validation.md
git commit -m "Добавить ссылку на демо с лендинга, зафиксировать протокол проверки"
```
