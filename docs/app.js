import { parseGraph, nearestNode, route, prepareIndex, search, dist, CAR } from './core.js';

const DATA = 'navi-data-v1';
const $ = (s) => document.querySelector(s);
let cities = [], city = null, graph = null, index = null, mode = CAR;
let myPos = null, follow = false, lastRoute = null;
const pts = { from: null, to: null }; // {lat, lon, label}; from=null means "my location"

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// ---- map -------------------------------------------------------------------
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);
const map = new maplibregl.Map({
  container: 'map', center: [31.2, 48.8], zoom: 5, attributionControl: { compact: true },
  style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f2' } }] },
});
map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

function styleFor(id) {
  const base = new URL('.', location.href).href;
  return {
    version: 8,
    glyphs: base + 'assets/fonts/{fontstack}/{range}.pbf',
    sprite: base + 'assets/sprites/light',
    sources: { protomaps: { type: 'vector', url: `pmtiles://${id}.pmtiles`,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps' } },
    layers: basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'uk' }),
  };
}

map.on('style.load', () => {
  map.addSource('route', { type: 'geojson', data: lineOf(lastRoute?.coords || []) });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff', 'line-width': 10 } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1f6feb', 'line-width': 6 } });
});
const lineOf = (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });

const pin = (color) => new maplibregl.Marker({ color });
const markers = { from: pin('#1a7f37'), to: pin('#cf222e') };
const meEl = Object.assign(document.createElement('div'), { className: 'me-dot' });
const meMarker = new maplibregl.Marker({ element: meEl });

// ---- offline storage (Cache API) ---------------------------------------------
async function isDownloaded(c) {
  const cache = await caches.open(DATA);
  for (const f of Object.values(c.files)) for (const u of f.parts) if (!(await cache.match(u))) return false;
  return true;
}
async function fileBlob(f) {
  const cache = await caches.open(DATA);
  const parts = [];
  for (const u of f.parts) parts.push(await (await cache.match(u)).blob());
  return new Blob(parts);
}
const gunzip = (blob) => new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();

async function download(c, onProgress) {
  await navigator.storage?.persist?.(); // ask the browser not to wipe the maps when space is low
  const cache = await caches.open(DATA);
  const total = Object.values(c.files).reduce((s, f) => s + f.size, 0);
  let got = 0;
  for (const f of Object.values(c.files)) {
    for (const u of f.parts) {
      const have = await cache.match(u);
      if (have) { got += (await have.blob()).size; onProgress(got / total); continue; }
      const res = await fetch(u, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${u}`);
      const reader = res.body.getReader(), chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length; onProgress(got / total);
      }
      await cache.put(u, new Response(new Blob(chunks)));
    }
  }
}
async function remove(c) {
  const cache = await caches.open(DATA);
  for (const f of Object.values(c.files)) for (const u of f.parts) await cache.delete(u);
}

async function openCity(c) {
  info('Открываю карту…');
  const tiles = await fileBlob(c.files.tiles);
  protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(new File([tiles], `${c.id}.pmtiles`))));
  graph = parseGraph(await gunzip(await fileBlob(c.files.graph)));
  index = prepareIndex(JSON.parse(new TextDecoder().decode(await gunzip(await fileBlob(c.files.addr)))));
  city = c;
  try { localStorage.city = c.id; } catch {}
  clearRoute();
  map.setStyle(styleFor(c.id));
  map.jumpTo({ center: inCity(myPos) ? [myPos.lon, myPos.lat] : c.center, zoom: 12 });
  info('');
}

const inCity = (p, c = city) => p && c && p.lon >= c.bbox[0] && p.lat >= c.bbox[1] && p.lon <= c.bbox[2] && p.lat <= c.bbox[3];

// ---- download dialog -------------------------------------------------------
const dlg = $('#downloads');
async function renderCities() {
  const ul = $('#cities');
  ul.replaceChildren();
  for (const c of cities) {
    const li = document.createElement('li');
    const mb = Math.round(Object.values(c.files).reduce((s, f) => s + f.size, 0) / 1e6);
    const ok = await isDownloaded(c);
    li.className = city?.id === c.id ? 'current' : '';
    li.innerHTML = `<div class="name">${c.name}<small>${mb} МБ · ${ok ? (city?.id === c.id ? 'открыта' : 'скачана') : 'не скачана'}</small></div>`;
    const btn = (text, fn, cls = '') => {
      const b = Object.assign(document.createElement('button'), { textContent: text, className: cls });
      b.onclick = fn; li.append(b);
    };
    if (!ok) {
      btn('Скачать', async () => {
        const bar = document.createElement('progress');
        li.querySelector('.name').append(bar);
        li.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          await download(c, (p) => (bar.value = p));
          if (!city) await openCity(c);
        } catch (e) {
          alert('Не получилось скачать. Проверьте интернет и попробуйте ещё раз.\n' + e.message);
        }
        renderCities();
      }, 'primary');
    } else {
      if (city?.id !== c.id) btn('Открыть', async () => { dlg.close(); await openCity(c); }, 'primary');
      btn('Удалить', async () => {
        if (!confirm(`Удалить карту «${c.name}» с телефона?`)) return;
        await remove(c);
        if (city?.id === c.id) location.reload(); else renderCities();
      });
    }
    ul.append(li);
  }
}
$('#maps').onclick = () => { renderCities(); dlg.showModal(); };

// ---- search ----------------------------------------------------------------
let field = 'to';
const results = $('#results');
for (const f of ['from', 'to']) {
  const input = $('#' + f);
  input.addEventListener('focus', () => (field = f));
  input.addEventListener('input', () => {
    field = f;
    if (!input.value.trim()) { pts[f] = null; markers[f].remove(); results.hidden = true; return; }
    showResults(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); results.querySelector('li[tabindex]')?.click(); }
  });
}
function showResults(q) {
  results.replaceChildren();
  results.hidden = false;
  if (!index) { results.innerHTML = '<li class="empty">Сначала скачайте карту города (кнопка 🗺️)</li>'; return; }
  const c = map.getCenter();
  const list = search(index, q, 20, { lat: c.lat, lon: c.lng });
  if (!list.length) { results.innerHTML = '<li class="empty">Ничего не найдено. Пример: «Яворницкого 50»</li>'; return; }
  for (const r of list) {
    const li = Object.assign(document.createElement('li'), { textContent: r.label, tabIndex: 0 });
    li.onclick = () => choose(field, r);
    li.onkeydown = (e) => e.key === 'Enter' && choose(field, r);
    results.append(li);
  }
}
function choose(f, r) {
  pts[f] = r;
  $('#' + f).value = r.label;
  results.hidden = true;
  markers[f].setLngLat([r.lon, r.lat]).addTo(map);
  follow = false;
  map.flyTo({ center: [r.lon, r.lat], zoom: 16 });
  document.activeElement?.blur();
}
map.on('click', (e) => {
  if (!city) return;
  results.hidden = true;
  choose('to', { lat: e.lngLat.lat, lon: e.lngLat.lng, label: 'Точка на карте' });
});

// ---- routing ---------------------------------------------------------------
for (const b of document.querySelectorAll('.mode')) {
  b.onclick = () => {
    mode = +b.dataset.mode;
    document.querySelectorAll('.mode').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    if (lastRoute) build();
  };
}
$('#go').onclick = build;

function build() {
  results.hidden = true;
  if (!graph) return info('Сначала скачайте карту города (кнопка 🗺️)', true);
  const from = pts.from || myPos;
  if (!from) return info('Нет GPS. Выйдите на открытое место или впишите «Откуда».', true);
  if (!pts.to) return info('Укажите, куда ехать: адрес или нажмите на карту.', true);
  for (const [p, what] of [[from, 'Начало'], [pts.to, 'Конец']]) {
    if (!inCity(p)) return info(`${what} маршрута за пределами карты «${city.name}».`, true);
  }
  const a = nearestNode(graph, from.lat, from.lon, mode);
  const b = nearestNode(graph, pts.to.lat, pts.to.lon, mode);
  const r = a >= 0 && b >= 0 && route(graph, a, b, mode);
  if (!r) return info('Не удалось проложить маршрут.', true);
  lastRoute = r;
  map.getSource('route')?.setData(lineOf(r.coords));
  info(`${(r.meters / 1000).toFixed(1)} км · ${fmtTime(r.seconds)}`);
  const bounds = r.coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(r.coords[0], r.coords[0]));
  follow = false;
  map.fitBounds(bounds, { padding: { top: $('#panel').offsetHeight + 30, bottom: 40, left: 40, right: 80 }, maxZoom: 17 });
}
function clearRoute() { lastRoute = null; map.getSource('route')?.setData(lineOf([])); }
function fmtTime(s) {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}
function info(text, err = false) {
  const el = $('#info');
  el.textContent = text; el.hidden = !text; el.classList.toggle('err', err);
}

// ---- GPS (works without internet: the phone only listens to satellites) ----
const badge = $('#gps');
function gpsBadge(text) { badge.textContent = text; badge.hidden = !text; }
if ('geolocation' in navigator) {
  gpsBadge('GPS: ищу спутники…');
  navigator.geolocation.watchPosition((p) => {
    const first = !myPos;
    myPos = { lat: p.coords.latitude, lon: p.coords.longitude, label: 'Моё местоположение' };
    meMarker.setLngLat([myPos.lon, myPos.lat]).addTo(map);
    gpsBadge(`GPS ±${Math.round(p.coords.accuracy)} м` + (city && !inCity(myPos) ? ' · вы вне карты города' : ''));
    if (follow || (first && inCity(myPos))) map.easeTo({ center: [myPos.lon, myPos.lat], zoom: Math.max(map.getZoom(), 15) });
  }, (e) => {
    gpsBadge(e.code === 1 ? 'GPS выключен: разрешите доступ к геолокации' : 'GPS: нет сигнала, выйдите на открытое место');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
} else gpsBadge('GPS недоступен в этом браузере');

$('#me').onclick = () => {
  if (!myPos) return info('Пока нет GPS-сигнала.', true);
  follow = true;
  $('#me').classList.add('on');
  map.easeTo({ center: [myPos.lon, myPos.lat], zoom: Math.max(map.getZoom(), 16) });
};
map.on('dragstart', () => { follow = false; $('#me').classList.remove('on'); });

// ---- start -----------------------------------------------------------------
(async () => {
  cities = await (await fetch('data/cities.json')).json();
  let saved = null;
  try { saved = localStorage.city; } catch {}
  const ordered = [...cities].sort((a, b) => (b.id === saved) - (a.id === saved));
  for (const c of ordered) if (await isDownloaded(c)) return openCity(c);
  renderCities();
  dlg.showModal();
})().catch((e) => info('Ошибка запуска: ' + e.message, true));

// debug hook for automated checks
window.navi = { map, get city() { return city; }, setPos: (lat, lon) => (myPos = { lat, lon }), dist };
