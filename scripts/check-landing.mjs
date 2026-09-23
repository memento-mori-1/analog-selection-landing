import { readFileSync, existsSync } from 'node:fs';

const file = process.argv[2] ?? 'index.html';
if (!existsSync(file)) { console.log(`FAIL  файл не найден: ${file}`); process.exit(1); }

const html = readFileSync(file, 'utf8');
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const body = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const flat = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const h1 = flat((body.match(/<h1[\s\S]*?<\/h1>/) ?? [''])[0]);
const pageText = flat(body);

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };

// --- цвет ---
const rgb = hex => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
};
const lum = hex => {
  const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hue = hex => {
  const [r, g, b] = rgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return null;
  const l = (mx + mn) / 2, s = d / (1 - Math.abs(2 * l - 1));
  if (s < 0.35 || l < 0.12 || l > 0.92) return null; // нейтральные и очень светлые/тёмные не считаем акцентом
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

// --- структура ---
check('lang="ru"', /<html[^>]*lang="ru"/.test(html));
check('meta viewport', /<meta[^>]*name="viewport"[^>]*width=device-width/.test(html));
check('meta color-scheme: dark', /<meta[^>]*name="color-scheme"[^>]*content="dark"/.test(html));
check('OpenGraph: og:title и og:description', /property="og:title"/.test(html) && /property="og:description"/.test(html));
check('семантика: есть <main>', /<main[\s>]/.test(html));
check('один <style>', (html.match(/<style[\s>]/g) ?? []).length === 1);
check('нет внешних ресурсов (link, script, @import, url(http), src=http)',
  !/<link[\s>]/i.test(html) && !/<script[\s>]/i.test(html) && !/@import/.test(css) && !/url\(\s*['"]?https?:/.test(css) && !/\ssrc\s*=\s*["']?https?:/i.test(html));

// --- контент по PRD ---
check('H1 дословно по PRD', h1 === 'Проектное оборудование недоступно или дорогое? Подберём равноценный аналог');
check('в H1 нет «рабочей точки»', !/рабоч\S* точк/i.test(h1));
for (const id of ['problem', 'solution', 'how', 'diff', 'contact']) {
  check(`секция #${id}`, new RegExp(`<section[^>]*id="${id}"`).test(html));
}
check('упомянута кривая Q-P', pageText.includes('Q-P'));
check('упомянут подбор под процесс (окрасочная камера)', /окрасочн/i.test(pageText));
check('есть призыв «напишите мне»', /напишите мне/i.test(pageText));
check('нет запрещённых обещаний («80%», «за минуты»)', !/80\s?%/.test(pageText) && !/за минуты/i.test(pageText));
check('все три способа связи: Telegram, Email, Телефон', ['Telegram', 'Email', 'Телефон'].every(w => pageText.includes(w)));

// --- тёмная тема: токены и контраст ---
const vars = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]));
const tokens = ['bg', 'bg-alt', 'surface', 'line', 'ink', 'muted', 'accent', 'accent-strong', 'accent-hover',
  'accent-soft', 'on-blue', 'on-blue-dim', 'link-bg', 'link-hover'];
const missing = tokens.filter(t => !vars[t]);
check('токены тёмной темы определены в :root', missing.length === 0);
if (missing.length) console.log(`      не найдены: ${missing.join(', ')}`);
check('тёмный фон: --bg темнее 0.05 по яркости', !!vars.bg && lum(vars.bg) < 0.05);
check('body закрашен через var(--bg)', /body\s*\{[^}]*background:\s*var\(--bg\)/.test(css));

const val = t => (t.startsWith('#') ? t : vars[t]);
const pairs = [
  ['#ffffff', 'accent-strong', 'белый на кнопке и синем блоке'],
  ['#ffffff', 'accent-hover', 'белый на кнопке при наведении'],
  ['accent', 'bg', 'акцент на фоне'],
  ['accent', 'bg-alt', 'акцент на фоне секции'],
  ['accent', 'surface', 'акцент на карточке'],
  ['accent', 'accent-soft', 'акцент на плашке'],
  ['ink', 'bg', 'основной текст на фоне'],
  ['ink', 'surface', 'основной текст на карточке'],
  ['muted', 'bg', 'приглушённый текст на фоне'],
  ['muted', 'bg-alt', 'приглушённый текст на фоне секции'],
  ['muted', 'surface', 'приглушённый текст на карточке'],
  ['on-blue', 'accent-strong', 'текст на синем блоке'],
  ['#ffffff', 'link-bg', 'белый на кнопке-ссылке'],
  ['on-blue-dim', 'link-bg', 'подпись на кнопке-ссылке'],
  ['#ffffff', 'link-hover', 'белый на кнопке-ссылке при наведении'],
  ['on-blue-dim', 'link-hover', 'подпись на кнопке-ссылке при наведении'],
];
for (const [fg, bg, label] of pairs) {
  const a = val(fg), b = val(bg);
  check(`контраст ≥ 4.5:1 — ${label}`, !!a && !!b && contrast(a, b) >= 4.5);
}

// --- один акцент ---
const hexes = css.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [];
const hues = hexes.map(hue).filter(h => h !== null);
const spread = hues.length ? Math.max(...hues.map(h => Math.min(Math.abs(h - hues[0]), 360 - Math.abs(h - hues[0])))) : 0;
check('один акцентный цвет (все насыщенные цвета в пределах 20° по тону)', hues.length > 0 && spread <= 20);

check('виден фокус клавиатуры (:focus-visible)', /:focus-visible/.test(css));
check('уважает prefers-reduced-motion', /prefers-reduced-motion/.test(css));
check('адаптив: есть @media (max-width', /@media\s*\(max-width/.test(css));

// --- заглушки: предупреждение, не ошибка ---
const placeholders = (body.match(/data-placeholder/g) ?? []).length;
check('заглушки контактов помечены data-placeholder (ровно 3)', placeholders === 3);
if (placeholders) console.log(`WARN  ${placeholders} контакта — заглушки, заменить до публикации`);

console.log(failed ? `\n${failed} проверок не пройдено` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
