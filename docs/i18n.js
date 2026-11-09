// Interface and voice texts. Ukrainian is the default; Russian is an option in settings.
export const LANGS = { uk: 'Українська', ru: 'Русский' };

const T = {
  uk: {
    title: 'Офлайн-навігатор', from: 'Моє місцезнаходження', to: 'Куди? Вулиця і будинок', me: 'Моє місцезнаходження',
    car: 'Авто', foot: 'Пішки', route: 'Маршрут', go: 'Поїхали', stop: 'Стоп', swap: 'Поміняти місцями звідки і куди',
    fav: 'В обране', where: 'Де я', maps: 'Карти міст', settings: 'Налаштування', overview: 'Весь маршрут', voice: 'Голосові підказки',
    mapsTitle: 'Карти міст', mapsHint: 'Завантажте заздалегідь, поки є інтернет (краще через Wi-Fi). Далі все працює без зв\'язку — навіть у режимі польоту. Геолокацію на телефоні не вимикайте.',
    iosHint: 'На iPhone: натисніть «Поділитися» → «На екран Додому» і відкривайте навігатор з іконки — інакше Safari може видалити карти через 7 днів.',
    close: 'Закрити', credits: 'Карти © учасники OpenStreetMap (ODbL), стиль і тайли Protomaps, рушій карти MapLibre.',
    opening: 'Відкриваю карту…', openFail: 'Не вдалося відкрити «{name}»: {err} Видаліть карту й завантажте знову.',
    stDownloading: 'завантажується…', stNone: 'не завантажено', stOpen: 'відкрито', stOk: 'завантажено', stOld: 'є оновлення',
    mb: 'МБ', update: 'Оновити', download: 'Завантажити', open: 'Відкрити', remove: 'Видалити',
    oldBrowser: 'Цей браузер застарий для офлайн-карт. Оновіть Chrome / iOS (потрібен iOS 16.4+).',
    noSpace: 'На телефоні бракує місця для цієї карти. Звільніть пам\'ять або видаліть інше місто.',
    dlFail: 'Не вдалося завантажити. Перевірте інтернет і спробуйте ще раз.', removeQ: 'Видалити карту «{name}» з телефону?',
    needMap: 'Спершу завантажте карту міста (кнопка карт).', nothing: 'Нічого не знайдено. Приклад: «Яворницького 50»',
    mapPoint: 'Точка на карті', favFirst: 'Спершу оберіть, куди їхати — потім додайте в обране.', favName: 'Назва (наприклад «Дім», «Робота»):',
    noGps: 'Немає GPS. Вийдіть на відкрите місце або впишіть «Звідки».', noTo: 'Вкажіть, куди їхати: адреса або натисніть на карту.',
    start: 'Початок', end: 'Кінець', outside: '{what} маршруту за межами карти «{city}».', noRoute: 'Не вдалося прокласти маршрут.',
    min: 'хв', h: 'год', navNeedsGps: 'Для навігації потрібен GPS. Очистіть «Звідки» і дочекайтеся сигналу.',
    rerouting: 'Перебудовую маршрут', arrived: 'Ви прибули', arrivedShort: 'Ви на місці', toTarget: 'до мети', eta: 'прибуття',
    gpsSearch: 'GPS: шукаю супутники…', gpsOff: 'GPS вимкнено: дозвольте доступ до геолокації', gpsNoSignal: 'GPS: немає сигналу, вийдіть на відкрите місце',
    gpsNone: 'GPS недоступний у цьому браузері', outsideCity: ' · ви поза картою міста', noFix: 'Поки немає GPS-сигналу.', startErr: 'Помилка запуску: ',
    speeding: 'Перевищення швидкості', kmh: 'км/год', then: 'потім',
    language: 'Мова', voiceTest: 'Перевірити голос', voiceSample: 'Через 300 метрів поверніть праворуч, вулиця Шевченка',
    voiceMissing: 'Українського голосу на телефоні не знайдено. Android: Налаштування → Синтез мовлення → Google → Встановити голосові дані → Українська.',
    voiceOk: 'Голос: {name}', speedWarn: 'Попереджати про перевищення швидкості',
  },
  ru: {
    title: 'Офлайн-навигатор', from: 'Моё местоположение', to: 'Куда? Улица и дом', me: 'Моё местоположение',
    car: 'Авто', foot: 'Пешком', route: 'Маршрут', go: 'Поехали', stop: 'Стоп', swap: 'Поменять местами откуда и куда',
    fav: 'В избранное', where: 'Где я', maps: 'Карты городов', settings: 'Настройки', overview: 'Весь маршрут', voice: 'Голосовые подсказки',
    mapsTitle: 'Карты городов', mapsHint: 'Скачайте заранее, пока есть интернет (лучше по Wi-Fi). Потом всё работает без связи — даже в режиме полёта. Геолокацию на телефоне оставьте включённой.',
    iosHint: 'На iPhone: нажмите «Поделиться» → «На экран Домой» и открывайте навигатор с иконки — иначе Safari может удалить карты через 7 дней.',
    close: 'Закрыть', credits: 'Карты © участники OpenStreetMap (ODbL), стиль и тайлы Protomaps, движок карты MapLibre.',
    opening: 'Открываю карту…', openFail: 'Не удалось открыть «{name}»: {err} Удалите карту и скачайте заново.',
    stDownloading: 'скачивается…', stNone: 'не скачана', stOpen: 'открыта', stOk: 'скачана', stOld: 'есть обновление',
    mb: 'МБ', update: 'Обновить', download: 'Скачать', open: 'Открыть', remove: 'Удалить',
    oldBrowser: 'Этот браузер слишком старый для офлайн-карт. Обновите Chrome / iOS (нужен iOS 16.4+).',
    noSpace: 'На телефоне не хватает места для этой карты. Освободите память или удалите другой город.',
    dlFail: 'Не получилось скачать. Проверьте интернет и попробуйте ещё раз.', removeQ: 'Удалить карту «{name}» с телефона?',
    needMap: 'Сначала скачайте карту города (кнопка карт).', nothing: 'Ничего не найдено. Пример: «Яворницкого 50»',
    mapPoint: 'Точка на карте', favFirst: 'Сначала выберите, куда ехать — потом добавьте в избранное.', favName: 'Название (например «Дом», «Работа»):',
    noGps: 'Нет GPS. Выйдите на открытое место или впишите «Откуда».', noTo: 'Укажите, куда ехать: адрес или нажмите на карту.',
    start: 'Начало', end: 'Конец', outside: '{what} маршрута за пределами карты «{city}».', noRoute: 'Не удалось проложить маршрут.',
    min: 'мин', h: 'ч', navNeedsGps: 'Для навигации нужен GPS. Очистите «Откуда» и дождитесь сигнала.',
    rerouting: 'Перестраиваю маршрут', arrived: 'Вы прибыли', arrivedShort: 'Вы на месте', toTarget: 'до цели', eta: 'прибытие',
    gpsSearch: 'GPS: ищу спутники…', gpsOff: 'GPS выключен: разрешите доступ к геолокации', gpsNoSignal: 'GPS: нет сигнала, выйдите на открытое место',
    gpsNone: 'GPS недоступен в этом браузере', outsideCity: ' · вы вне карты города', noFix: 'Пока нет GPS-сигнала.', startErr: 'Ошибка запуска: ',
    speeding: 'Превышение скорости', kmh: 'км/ч', then: 'затем',
    language: 'Язык', voiceTest: 'Проверить голос', voiceSample: 'Через 300 метров поверните направо, улица Шевченко',
    voiceMissing: 'Русского голоса на телефоне не найдено. Android: Настройки → Синтез речи → Google → Установить голосовые данные → Русский.',
    voiceOk: 'Голос: {name}', speedWarn: 'Предупреждать о превышении скорости',
  },
};

export let lang = 'uk';
try { if (T[localStorage.lang]) lang = localStorage.lang; } catch {}
export function setLang(l) { lang = l; try { localStorage.lang = l; } catch {} }

export function t(key, vars = {}) {
  return (T[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/** Fills elements marked data-i18n="key" (text), data-i18n-ph (placeholder), data-i18n-aria (aria-label). */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  document.title = t('title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

// ---- spoken / shown turn instructions ----------------------------------------

const VERB = {
  uk: { depart: 'Рушайте', left: 'поверніть ліворуч', right: 'поверніть праворуч', 'slight-left': 'тримайтеся лівіше',
    'slight-right': 'тримайтеся правіше', uturn: 'розверніться', straight: 'продовжуйте прямо', arrive: 'ви на місці' },
  ru: { depart: 'Начните движение', left: 'поверните налево', right: 'поверните направо', 'slight-left': 'держитесь левее',
    'slight-right': 'держитесь правее', uturn: 'развернитесь', straight: 'продолжайте прямо', arrive: 'вы на месте' },
};
const SHORT = { // for the small "then …" line
  uk: { left: 'ліворуч', right: 'праворуч', 'slight-left': 'лівіше', 'slight-right': 'правіше', uturn: 'розворот', straight: 'прямо', arrive: 'фініш' },
  ru: { left: 'налево', right: 'направо', 'slight-left': 'левее', 'slight-right': 'правее', uturn: 'разворот', straight: 'прямо', arrive: 'финиш' },
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** "Поверніть праворуч, вулиця Шевченка" — street name after a comma reads naturally in both languages. */
export const stepText = (s, l = lang) => cap(VERB[l][s.type]) + (s.name && s.type !== 'arrive' ? `, ${s.name}` : '');
export const thenText = (s, l = lang) => `${T[l].then} ${SHORT[l][s.type] || ''}`;

/** Short distance for the screen: "350 м", "1.2 км". */
export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} км` : `${Math.max(10, Math.round(m / 10) * 10)} м`);

function plural(n, [one, few, many]) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
const UNITS = {
  uk: { m: ['метр', 'метри', 'метрів'], km: ['кілометр', 'кілометри', 'кілометрів'], kmFrac: 'кілометра', in: 'Через' },
  ru: { m: ['метр', 'метра', 'метров'], km: ['километр', 'километра', 'километров'], kmFrac: 'километра', in: 'Через' },
};
/** Distance for the voice, with correct word endings: "300 метрів", "1,5 кілометра", "2 кілометри". */
export function sayDist(m, l = lang) {
  const u = UNITS[l];
  if (m >= 1000) {
    const km = Math.round(m / 100) / 10;
    return Number.isInteger(km) ? `${km} ${plural(km, u.km)}` : `${String(km).replace('.', ',')} ${u.kmFrac}`;
  }
  const r = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
  return `${r} ${plural(r, u.m)}`;
}
export const sayIn = (m, s, l = lang) => `${UNITS[l].in} ${sayDist(m, l)} ${VERB[l][s.type]}` + (s.name && s.type !== 'arrive' ? `, ${s.name}` : '');

const CITY = {
  dnipro: ['Дніпро', 'Днепр'], kyiv: ['Київ', 'Киев'], kharkiv: ['Харків', 'Харьков'],
  zaporizhzhia: ['Запоріжжя', 'Запорожье'], odesa: ['Одеса', 'Одесса'], lviv: ['Львів', 'Львов'],
};
export const cityName = (c) => CITY[c.id]?.[lang === 'uk' ? 0 : 1] || c.name;
