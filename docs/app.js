import { parseGraph, nearestNode, route, prepareIndex, search, dist, maneuvers, progress, CAR } from './core.js';
import { t, lang, setLang, applyStatic, stepText, thenText, fmtDist, sayIn, cityName } from './i18n.js';

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

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const theme = () => (darkQuery.matches ? 'dark' : 'light');
darkQuery.addEventListener('change', () => city && map.setStyle(styleFor(city.id)));

function styleFor(id) {
  const base = new URL('.', location.href).href;
  return {
    version: 8,
    glyphs: base + 'assets/fonts/{fontstack}/{range}.pbf',
    sprite: base + 'assets/sprites/' + theme(),
    sources: { protomaps: { type: 'vector', url: `pmtiles://${id}.pmtiles`,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps' } },
    layers: basemaps.layers('protomaps', basemaps.namedFlavor(theme()), { lang: 'uk' }),
  };
}

map.on('style.load', () => {
  map.addSource('route', { type: 'geojson', data: lineOf(lastRoute?.coords || []) });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff', 'line-width': 10 } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0057b7', 'line-width': 6 } });
});
const lineOf = (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });

const pin = (color) => new maplibregl.Marker({ color });
const markers = { from: pin('#1a7f37'), to: pin('#cf222e') };
const meEl = Object.assign(document.createElement('div'), { className: 'me-dot' });
const meMarker = new maplibregl.Marker({ element: meEl });

// ---- offline storage (Cache API) ---------------------------------------------
// Each city: its file parts + a "data/<id>/version" marker written after the last part.
const versionUrl = (c) => `data/${c.id}/version`;
const canUnzip = typeof DecompressionStream === 'function'; // Safari < 16.4 lacks it

/** 'none' | 'ok' | 'old' (downloaded, but a newer map exists — still usable) */
async function status(c) {
  const cache = await caches.open(DATA);
  for (const f of Object.values(c.files)) for (const u of f.parts) if (!(await cache.match(u))) return 'none';
  const v = await cache.match(versionUrl(c));
  return v && (await v.text()) === c.version ? 'ok' : 'old';
}
async function fileBlob(f) {
  const cache = await caches.open(DATA);
  const parts = [];
  for (const u of f.parts) parts.push(await (await cache.match(u)).blob());
  return new Blob(parts);
}
const gunzip = (blob) => new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();

const downloading = new Map(); // city id -> progress 0..1 (survives closing the dialog)
async function download(c, onProgress) {
  await navigator.storage?.persist?.(); // ask the browser not to wipe the maps when space is low
  const total = Object.values(c.files).reduce((s, f) => s + f.size, 0);
  const est = await navigator.storage?.estimate?.();
  if (est && est.quota - est.usage < total * 1.1) throw Object.assign(new Error('мало места'), { name: 'QuotaExceededError' });
  const cache = await caches.open(DATA);
  const v = await cache.match(versionUrl(c));
  const fresh = v && (await v.text()) === c.version;
  if (!fresh) await remove(c); // never mix parts of two map versions
  let got = 0;
  for (const f of Object.values(c.files)) {
    for (const u of f.parts) {
      const have = await cache.match(u);
      if (have) { got += +(have.headers.get('content-length') || 0); onProgress(got / total); continue; }
      const res = await fetch(u, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${u}`);
      // stream straight into the cache, counting bytes on the way (no 45 MB buffer in memory)
      const counted = res.body.pipeThrough(new TransformStream({
        transform(chunk, ctl) { got += chunk.length; onProgress(got / total); ctl.enqueue(chunk); },
      }));
      await cache.put(u, new Response(counted, { headers: { 'content-length': res.headers.get('content-length') || '' } }));
    }
  }
  await cache.put(versionUrl(c), new Response(c.version));
}
async function remove(c) {
  const cache = await caches.open(DATA);
  for (const f of Object.values(c.files)) for (const u of f.parts) await cache.delete(u);
  await cache.delete(versionUrl(c));
}

async function openCity(c) {
  info(t('opening'));
  try {
    // load everything into locals first, so a failure leaves the previous city intact
    const tiles = await fileBlob(c.files.tiles);
    const g = parseGraph(await gunzip(await fileBlob(c.files.graph)));
    const idx = prepareIndex(JSON.parse(new TextDecoder().decode(await gunzip(await fileBlob(c.files.addr)))));
    protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(new File([tiles], `${c.id}.pmtiles`))));
    stopNav();
    graph = g; index = idx; city = c;
  } catch (e) {
    return info(t('openFail', { name: cityName(c), err: e.message }), true);
  }
  try { localStorage.city = c.id; } catch {}
  clearRoute();
  for (const f of ['from', 'to']) { pts[f] = null; $('#' + f).value = ''; markers[f].remove(); }
  map.setStyle(styleFor(c.id));
  map.jumpTo({ center: inCity(myPos) ? [myPos.lon, myPos.lat] : c.center, zoom: 12 });
  info('');
}

const inCity = (p, c = city) => p && c && p.lon >= c.bbox[0] && p.lat >= c.bbox[1] && p.lon <= c.bbox[2] && p.lat <= c.bbox[3];

// ---- download dialog -------------------------------------------------------
const dlg = $('#downloads');
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
async function renderCities() {
  const ul = $('#cities');
  const rows = [];
  for (const c of cities) {
    const li = document.createElement('li');
    const mb = Math.round(Object.values(c.files).reduce((s, f) => s + f.size, 0) / 1e6);
    const st = await status(c);
    const busy = downloading.has(c.id);
    li.className = city?.id === c.id ? 'current' : '';
    const name = Object.assign(document.createElement('div'), { className: 'name', textContent: cityName(c) });
    const label = busy ? t('stDownloading') : { none: t('stNone'), ok: city?.id === c.id ? t('stOpen') : t('stOk'), old: t('stOld') }[st];
    name.append(Object.assign(document.createElement('small'), { textContent: `${mb} ${t('mb')} · ${label}` }));
    li.append(name);
    const btn = (text, fn, cls = '') => {
      const b = Object.assign(document.createElement('button'), { textContent: text, className: cls, disabled: busy });
      b.onclick = fn; li.append(b);
    };
    if (busy) {
      const bar = Object.assign(document.createElement('progress'), { value: downloading.get(c.id) });
      bar.dataset.city = c.id;
      name.append(bar);
    }
    if (st !== 'ok') {
      btn(st === 'old' ? t('update') : t('download'), async () => {
        if (!canUnzip) return alert(t('oldBrowser'));
        downloading.set(c.id, 0);
        renderCities();
        try {
          await download(c, (p) => {
            downloading.set(c.id, p);
            const bar = document.querySelector(`progress[data-city="${c.id}"]`);
            if (bar) bar.value = p;
          });
          downloading.delete(c.id);
          if (!city || city.id === c.id) await openCity(c);
        } catch (e) {
          downloading.delete(c.id);
          alert(e.name === 'QuotaExceededError'
            ? t('noSpace')
            : t('dlFail') + '\n' + e.message);
        }
        renderCities();
      }, 'primary');
    }
    if (st !== 'none') {
      if (city?.id !== c.id) btn(t('open'), async () => { dlg.close(); await openCity(c); }, st === 'ok' ? 'primary' : '');
      btn(t('remove'), async () => {
        if (!confirm(t('removeQ', { name: cityName(c) }))) return;
        await remove(c);
        if (city?.id === c.id) location.reload(); else renderCities();
      });
    }
    rows.push(li);
  }
  ul.replaceChildren(...rows);
  if ($('#ios-hint')) $('#ios-hint').hidden = !isIOS;
}
$('#maps').onclick = () => { renderCities(); dlg.showModal(); };

// ---- search ----------------------------------------------------------------
let field = 'to';
const results = $('#results');
for (const f of ['from', 'to']) {
  const input = $('#' + f);
  input.addEventListener('focus', () => (field = f));
  let timer = 0;
  input.addEventListener('input', () => {
    field = f;
    // typed text no longer matches the picked point: forget it until a result is chosen
    pts[f] = null; markers[f].remove();
    if (f === 'to') updateFav();
    clearTimeout(timer);
    if (!input.value.trim()) return showSaved(f);
    timer = setTimeout(() => showResults(input.value), 150); // big cities: don't search on every keystroke
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); clearTimeout(timer);
      if (input.value.trim()) showResults(input.value);
      results.querySelector('li[tabindex]')?.click();
    }
  });
}
function showResults(q) {
  results.replaceChildren();
  results.hidden = false;
  if (!index) { results.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: t('needMap') })); return; }
  const c = map.getCenter();
  const list = search(index, q, 20, { lat: c.lat, lon: c.lng });
  if (!list.length) { results.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: t('nothing') })); return; }
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
  if (f === 'to') updateFav();
  follow = false;
  map.flyTo({ center: [r.lon, r.lat], zoom: 16 });
  document.activeElement?.blur();
}
map.on('click', (e) => {
  if (!city) return;
  results.hidden = true;
  choose('to', { lat: e.lngLat.lat, lon: e.lngLat.lng, label: t('mapPoint') });
});


// ---- favourites and recent places (per phone) ---------------------------------
const store = {
  get(k) { try { return JSON.parse(localStorage[k] || '[]'); } catch { return []; } },
  set(k, v) { try { localStorage[k] = JSON.stringify(v); } catch {} },
};
const samePlace = (a, b) => dist(a.lat, a.lon, b.lat, b.lon) < 30;
function remember(p) {
  if (!p || p.me) return;
  store.set('recent', [p, ...store.get('recent').filter((x) => !samePlace(x, p))].slice(0, 6));
}
function showSaved(f) {
  const favs = store.get('favs').filter((p) => inCity(p)), recent = store.get('recent').filter((p) => inCity(p) && !favs.some((x) => samePlace(x, p)));
  results.replaceChildren();
  for (const [list, icon] of [[favs, '★'], [recent, '🕘']]) {
    for (const p of list) {
      const li = Object.assign(document.createElement('li'), { tabIndex: 0, className: 'saved' });
      li.append(Object.assign(document.createElement('span'), { className: 'ico', textContent: icon }), p.label);
      li.onclick = () => choose(f, p);
      li.onkeydown = (e) => e.key === 'Enter' && choose(f, p);
      results.append(li);
    }
  }
  results.hidden = !results.children.length;
}
for (const f of ['from', 'to']) $('#' + f).addEventListener('focus', (e) => { if (!e.target.value.trim()) showSaved(f); });

function updateFav() {
  const on = !!pts.to && store.get('favs').some((x) => samePlace(x, pts.to));
  $('#fav').classList.toggle('on', on);
  $('#fav').setAttribute('aria-pressed', on);
  $('#fav').textContent = on ? '★' : '☆';
}
$('#fav').onclick = () => {
  if (!pts.to) return info(t('favFirst'), true);
  const favs = store.get('favs');
  const i = favs.findIndex((x) => samePlace(x, pts.to));
  if (i >= 0) favs.splice(i, 1);
  else {
    const name = prompt(t('favName'), pts.to.label);
    if (name === null) return;
    favs.unshift({ ...pts.to, label: name.trim() || pts.to.label });
  }
  store.set('favs', favs);
  updateFav();
};
$('#swap').onclick = () => {
  const from = pts.from || (myPos && { ...myPos, me: true, label: t('me') });
  const to = pts.to;
  pts.from = to; pts.to = from;
  for (const f of ['from', 'to']) {
    $('#' + f).value = pts[f] && pts[f].me !== true ? pts[f].label : '';
    if (pts[f] && pts[f].me !== true) markers[f].setLngLat([pts[f].lon, pts[f].lat]).addTo(map); else markers[f].remove();
  }
  if (pts.to?.me) pts.to = { ...pts.to }; // keep a fixed point as destination
  if (pts.from?.me) pts.from = null; // follow live GPS
  updateFav();
  if (lastRoute) build();
};

// ---- routing ---------------------------------------------------------------
for (const b of document.querySelectorAll('.mode')) {
  b.onclick = () => {
    mode = +b.dataset.mode;
    document.querySelectorAll('.mode').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    if (lastRoute) build();
  };
}
$('#go').onclick = () => build();

/** Builds a route; `quiet` = automatic re-route during navigation (no map jump, no error popups). */
function build(quiet = false) {
  results.hidden = true;
  if (!graph) return info(t('needMap'), true);
  const from = pts.from || myPos;
  if (!from) return info(t('noGps'), true);
  if (!pts.to) return info(t('noTo'), true);
  for (const [p, what] of [[from, t('start')], [pts.to, t('end')]]) {
    if (!inCity(p)) return info(t('outside', { what, city: cityName(city) }), true);
  }
  const a = nearestNode(graph, from.lat, from.lon, mode);
  const b = nearestNode(graph, pts.to.lat, pts.to.lon, mode);
  const r = a >= 0 && b >= 0 && route(graph, a, b, mode);
  if (!r) return info(t('noRoute'), true);
  r.steps = maneuvers(graph, r, index.roads || []);
  lastRoute = r;
  remember(pts.to);
  map.getSource('route')?.setData(lineOf(r.coords));
  info(`${fmtDist(r.meters)} · ${fmtTime(r.seconds)}`);
  $('#start').hidden = false;
  if (quiet || nav) return;
  const bounds = r.coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(r.coords[0], r.coords[0]));
  follow = false;
  map.fitBounds(bounds, { padding: { top: $('#panel').offsetHeight + 30, bottom: 90, left: 40, right: 80 }, maxZoom: 17 });
}
function clearRoute() { lastRoute = null; map.getSource('route')?.setData(lineOf([])); $('#start').hidden = true; stopNav(); }
function fmtTime(s) {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} ${t('min')}` : `${Math.floor(m / 60)} ${t('h')} ${String(m % 60).padStart(2, '0')} ${t('min')}`;
}
function info(text, err = false) {
  const el = $('#info');
  el.textContent = text; el.hidden = !text; el.classList.toggle('err', err);
}

// ---- turn-by-turn navigation -----------------------------------------------
// nav = {hint, spoken:Set, offCount, lastReroute, baseOff, wake, arrived, overview, speeding}
let nav = null;
const ICON = { depart: '↑', straight: '↑', left: '↰', right: '↱', 'slight-left': '↖', 'slight-right': '↗', uturn: '↶', arrive: '🏁' };
const pref = (k, def) => { try { return localStorage[k] ?? def; } catch { return def; } };
const setPref = (k, v) => { try { localStorage[k] = v; } catch {} };
let voiceOn = pref('voice', 'on') !== 'off';
let speedWarn = pref('speedWarn', 'on') !== 'off';

/** Best installed voice for the interface language (offline TTS voices on the phone). */
function pickVoice() {
  const vs = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  const mine = vs.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  return mine.find((v) => v.localService) || mine[0] || null;
}
function say(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  u.lang = v?.lang || (lang === 'uk' ? 'uk-UA' : 'ru-RU');
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function setVoice(on) {
  voiceOn = on;
  setPref('voice', on ? 'on' : 'off');
  $('#voice').textContent = on ? '🔊' : '🔇';
  $('#voice').setAttribute('aria-pressed', on);
  if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
}
$('#voice').onclick = () => setVoice(!voiceOn);

$('#start').onclick = startNav;
$('#stop').onclick = () => { stopNav(); info(lastRoute ? `${fmtDist(lastRoute.meters)} · ${fmtTime(lastRoute.seconds)}` : ''); };
$('#overview').onclick = () => {
  if (!nav || !lastRoute) return;
  nav.overview = !nav.overview;
  $('#overview').classList.toggle('on', nav.overview);
  if (nav.overview) {
    follow = false;
    const c = lastRoute.coords.slice(nav.hint);
    const b = c.reduce((bb, x) => bb.extend(x), new maplibregl.LngLatBounds(c[0], c[0]));
    map.easeTo({ pitch: 0, bearing: 0, duration: 400 });
    map.fitBounds(b, { padding: { top: $('#nav').offsetHeight + 40, bottom: $('#navbar').offsetHeight + 40, left: 40, right: 40 }, maxZoom: 17, duration: 800 });
  } else { follow = true; if (myPos) onNavPosition(myPos); }
};

async function startNav() {
  if (!lastRoute) return;
  if (pts.from) { // navigating needs the live GPS as the start
    if (!myPos) return info(t('navNeedsGps'), true);
    pts.from = null; $('#from').value = ''; markers.from.remove();
    build(true);
  }
  nav = { hint: 0, spoken: new Set(), offCount: 0, lastReroute: 0, baseOff: 0, wake: null, overview: false, speeding: false };
  document.body.classList.add('navigating');
  setVoice(voiceOn);
  try { nav.wake = await navigator.wakeLock?.request('screen'); } catch {} // keep the screen on while driving
  follow = true;
  say(stepText(lastRoute.steps[1] || lastRoute.steps[0]));
  if (myPos) onNavPosition(myPos);
}
function stopNav() {
  if (!nav) return;
  nav.wake?.release?.().catch(() => {});
  nav = null;
  document.body.classList.remove('navigating', 'speeding');
  $('#overview').classList.remove('on');
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
}
document.addEventListener('visibilitychange', async () => {
  if (nav && document.visibilityState === 'visible' && !nav.wake) try { nav.wake = await navigator.wakeLock?.request('screen'); } catch {}
});

/** Speed limit (km/h) of the road at coords index i, 0 if unknown. */
function limitAt(r, i) {
  let leg = r.legs[0];
  for (const l of r.legs) { if (l.at > i) break; leg = l; }
  return leg ? graph.segMax[leg.seg] : 0;
}

const OFF_ROUTE = { [CAR]: 45, 2: 30 }; // metres before we call it "off route"
function onNavPosition(pos) {
  const r = lastRoute;
  const p = progress(r, pos.lat, pos.lon, nav.hint);
  nav.hint = p.idx;

  // off route twice in a row -> quietly rebuild from here (GPS jitter gives single bad fixes)
  // baseOff: how far from any road we were at the last re-route (yard, park) — don't re-route again for that
  if (p.off > OFF_ROUTE[r.mode] + (pos.acc || 0) / 2 + nav.baseOff) {
    if (++nav.offCount >= 2 && Date.now() - nav.lastReroute > 4000) {
      nav.lastReroute = Date.now(); nav.offCount = 0;
      say(t('rerouting'));
      build(true);
      nav.hint = 0; nav.spoken.clear();
      nav.baseOff = progress(lastRoute, pos.lat, pos.lon).off;
      return onNavPosition(pos);
    }
  } else { nav.offCount = 0; if (p.off < OFF_ROUTE[r.mode]) nav.baseOff = 0; }

  const remain = r.meters - p.along;
  const ni = r.steps.findIndex((s) => s.dist > p.along + 5 && s.type !== 'depart');
  const next = r.steps[ni] || r.steps.at(-1);
  const toNext = Math.max(0, next.dist - p.along);
  // a second turn right after this one: show and say "then …"
  const after = ni >= 0 ? r.steps[ni + 1] : null;
  const thenSoon = after && after.type !== 'straight' && after.dist - next.dist < (r.mode === CAR ? 150 : 40) ? after : null;

  const icon = $('#navIcon');
  if (icon.dataset.type !== next.type) { icon.textContent = ICON[next.type]; icon.dataset.type = next.type; }
  $('#navDist').textContent = next.type === 'arrive' && toNext < 30 ? t('arrivedShort') : fmtDist(toNext);
  $('#navText').textContent = next.type === 'arrive' ? (toNext < 30 ? '' : t('toTarget')) : stepText(next);
  $('#navThen').hidden = !thenSoon;
  if (thenSoon) { $('#navThen').textContent = `${thenText(thenSoon)} ${ICON[thenSoon.type]}`; $('#navThen').dataset.type = thenSoon.type; }
  const secs = r.seconds * (remain / Math.max(1, r.meters));
  const eta = new Date(Date.now() + secs * 1000).toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
  $('#navRemain').textContent = `${fmtDist(remain)} · ${fmtTime(secs)} · ${t('eta')} ${eta}`;

  // speed and the limit of the current road (from OpenStreetMap maxspeed, when mapped)
  const kmh = pos.speed != null ? Math.round(pos.speed * 3.6) : null;
  const lim = r.mode === CAR ? limitAt(r, p.idx) : 0;
  $('#speed').hidden = kmh == null || r.mode !== CAR;
  $('#speedVal').textContent = kmh ?? '';
  $('#limit').hidden = !lim;
  $('#limit').textContent = lim || '';
  const over = !!lim && kmh != null && kmh > lim + 5;
  document.body.classList.toggle('speeding', over);
  if (over && !nav.speeding && speedWarn) { say(t('speeding')); navigator.vibrate?.([200, 100, 200]); }
  nav.speeding = over;

  // announcements: far, near, now (distances depend on speed of travel)
  const marks = r.mode === CAR ? [[800, 'far'], [250, 'near'], [40, 'now']] : [[120, 'near'], [20, 'now']];
  for (const [m, tag] of marks) {
    if (toNext > m || nav.spoken.has(next.at + tag)) continue;
    for (const [, tg] of marks) nav.spoken.add(next.at + tg); // don't repeat the farther ones later
    const then = thenSoon && tag !== 'far' ? `, ${thenText(thenSoon)}` : '';
    if (next.type === 'arrive') say(toNext < 30 ? t('arrived') : sayIn(toNext, next));
    else say((tag === 'now' ? stepText(next) : sayIn(toNext, next)) + then);
    navigator.vibrate?.(tag === 'now' ? [120, 80, 120] : 80);
    break;
  }
  if (next.type === 'arrive' && toNext < 25 && !nav.arrived) { nav.arrived = true; setTimeout(stopNav, 4000); }

  // camera: follow and turn the map so that "up" is where we're going
  if (follow && !nav.overview) {
    const ahead = r.coords[Math.min(r.coords.length - 1, p.idx + 1)];
    const brg = pos.heading ?? Math.atan2((ahead[0] - pos.lon) * Math.cos(pos.lat * Math.PI / 180), ahead[1] - pos.lat) * 180 / Math.PI;
    map.easeTo({ center: [pos.lon, pos.lat], bearing: brg, pitch: r.mode === CAR ? 50 : 30,
      zoom: r.mode === CAR ? 17 : 18, duration: 900, offset: [0, 120] });
  }
  // only the part still ahead stays on the map
  map.getSource('route')?.setData(lineOf([[pos.lon, pos.lat], ...r.coords.slice(p.idx + 1)]));
}

// ---- settings: language, voice, speed warning ------------------------------
const setDlg = $('#settingsDlg');
function renderSettings() {
  for (const el of setDlg.querySelectorAll('input[name=lang]')) el.checked = el.value === lang;
  $('#speedWarn').checked = speedWarn;
  const v = pickVoice();
  $('#voiceInfo').textContent = v ? t('voiceOk', { name: v.name }) : t('voiceMissing');
  $('#voiceInfo').classList.toggle('warn', !v);
}
$('#settings').onclick = () => { renderSettings(); setDlg.showModal(); };
for (const el of setDlg.querySelectorAll('input[name=lang]')) {
  el.onchange = () => { setLang(el.value); applyStatic(); renderSettings(); if (lastRoute) build(true); };
}
$('#speedWarn').onchange = (e) => { speedWarn = e.target.checked; setPref('speedWarn', speedWarn ? 'on' : 'off'); };
$('#voiceTest').onclick = () => { const was = voiceOn; voiceOn = true; say(t('voiceSample')); voiceOn = was; };
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', () => setDlg.open && renderSettings());

// ---- GPS (works without internet: the phone only listens to satellites) ----
const badge = $('#gps');
function gpsBadge(text) { badge.textContent = text; badge.hidden = !text; }
function onPosition(pos) {
  const first = !myPos;
  myPos = { me: true, label: t('me'), ...pos };
  meMarker.setLngLat([pos.lon, pos.lat]).addTo(map);
  meEl.classList.toggle('heading', pos.heading != null);
  if (pos.heading != null) meEl.style.setProperty('--heading', `${pos.heading - map.getBearing()}deg`);
  gpsBadge(`GPS ±${Math.round(pos.acc ?? 0)} м` + (city && !inCity(myPos) ? t('outsideCity') : ''));
  if (nav && lastRoute) return onNavPosition(myPos);
  if (follow || (first && inCity(myPos))) map.easeTo({ center: [pos.lon, pos.lat], zoom: Math.max(map.getZoom(), 15) });
}
if ('geolocation' in navigator) {
  gpsBadge(t('gpsSearch'));
  navigator.geolocation.watchPosition((p) => {
    const c = p.coords;
    // heading is only meaningful while moving
    onPosition({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, speed: Number.isFinite(c.speed) ? c.speed : null,
      heading: c.speed > 1.5 && Number.isFinite(c.heading) ? c.heading : null });
  }, (e) => {
    gpsBadge(e.code === 1 ? t('gpsOff') : t('gpsNoSignal'));
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 60000 });
} else gpsBadge(t('gpsNone'));

$('#me').onclick = () => {
  if (!myPos) return info(t('noFix'), true);
  follow = true;
  $('#me').classList.add('on');
  if (nav) return onNavPosition(myPos);
  map.easeTo({ center: [myPos.lon, myPos.lat], zoom: Math.max(map.getZoom(), 16) });
};
map.on('dragstart', () => { follow = false; $('#me').classList.remove('on'); });

// ---- start -----------------------------------------------------------------
applyStatic();
(async () => {
  cities = await (await fetch('data/cities.json')).json();
  let saved = null;
  try { saved = localStorage.city; } catch {}
  const ordered = [...cities].sort((a, b) => (b.id === saved) - (a.id === saved));
  for (const c of ordered) if ((await status(c)) !== 'none') return openCity(c);
  renderCities();
  dlg.showModal();
})().catch((e) => info(t('startErr') + e.message, true));

// Debug / demo hook: navi.simulate() drives along the current route with fake GPS.
window.navi = {
  map, get city() { return city; }, get route() { return lastRoute; }, dist,
  setPos: (lat, lon) => onPosition({ lat, lon, acc: 5, heading: null }),
  simulate(speed = 14, everyMs = 1000) {
    const r = lastRoute;
    if (!r) return 'build a route first';
    let along = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      along += speed * everyMs / 1000;
      const i = r.cum.findIndex((d) => d >= along);
      if (i < 0) { clearInterval(this.timer); return; }
      const k = (along - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1);
      const [a, b] = [r.coords[i - 1], r.coords[i]];
      onPosition({ lat: a[1] + (b[1] - a[1]) * k, lon: a[0] + (b[0] - a[0]) * k, acc: 5, speed, heading: null });
    }, everyMs);
    return 'driving';
  },
};
