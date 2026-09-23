// Собирает podbor-data.js (window.PODBOR_DATA) из трёх JSON оцифровки.
// Запуск из корня репозитория: node scripts/build-podbor-data.js
// Пути считаются от корня репозитория через __dirname.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const sources = [
  { key: '2,5', json: 'scripts/digitize/data_2_5.json', prefix: '2.5' },
  { key: '3,15', json: 'scripts/digitize/data_3_15.json', prefix: '3.15' },
  { key: '4', json: 'scripts/digitize/data_4.json', prefix: '4' }
];

const typorazmery = {};
for (const src of sources) {
  const t = readJson(src.json);
  t.drawingImage = `assets/podbor/${src.prefix}-drawing.png`;
  // Число 1.0 в JS печатается как "1", поэтому файлы номинального диаметра — "<prefix>-D1.png"
  for (const dia of t.diameters) dia.graphImage = `assets/podbor/${src.prefix}-D${dia.d}.png`;

  const images = [t.drawingImage, ...t.diameters.map((dia) => dia.graphImage)];
  for (const img of images) {
    if (!fs.existsSync(path.join(root, img))) {
      throw new Error(`Типоразмер ${src.key}: файл изображения не найден: ${img}`);
    }
  }
  typorazmery[src.key] = t;
}

const data = { series: 'ВЦ 4-70', typorazmery };
fs.writeFileSync(path.join(root, 'podbor-data.js'), 'window.PODBOR_DATA = ' + JSON.stringify(data, null, 2) + ';\n');
console.log('written podbor-data.js');
