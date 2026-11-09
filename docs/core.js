// Offline routing and address search. Shared by the app (browser) and the tests (Node).

export const CAR = 1, FOOT = 2;
const WALK_MS = 1.33; // 4.8 km/h
const MAX_CAR_MS = 130 / 3.6;

// ---- graph ----------------------------------------------------------------

export function parseGraph(buf) {
  const h = new Uint32Array(buf, 0, 4);
  const [n, E, S, G] = h;
  let o = 16;
  const take = (T, len) => { const a = new T(buf, o, len); o += len * T.BYTES_PER_ELEMENT; return a; };
  const g = {
    n, E, S,
    lat: take(Int32Array, n), lon: take(Int32Array, n),
    off: take(Uint32Array, n + 1), target: take(Uint32Array, E), seg: take(Uint32Array, E),
    segLen: take(Float32Array, S), geomOff: take(Uint32Array, S + 1), geom: take(Int32Array, 2 * G),
  };
  // Older downloads lack later blocks: v1 has no segName/segMax, v2 no segMax. Keep them working.
  const v1 = 16 + 4 * (3 * n + 1 + 2 * E + 2 * S + 1 + 2 * G) + E + S + n, v2 = v1 + 4 * S, v3 = v2 + S;
  if (![v1, v2, v3].includes(buf.byteLength)) throw new Error('Map file is damaged — delete and download the city again.');
  g.segName = buf.byteLength >= v2 ? take(Uint32Array, S) : new Uint32Array(S); // index into addr.json "roads"
  g.edgeFlags = take(Uint8Array, E);
  g.segSpeed = take(Uint8Array, S);
  g.nodeFlags = take(Uint8Array, n);
  g.segMax = buf.byteLength === v3 ? take(Uint8Array, S) : new Uint8Array(S); // speed limit km/h, 0 = unknown
  return g;
}

const R = 6371000, RAD = Math.PI / 180;
export function dist(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  const y = (lat2 - lat1) * RAD;
  return Math.sqrt(x * x + y * y) * R;
}

/** Nearest node that is on the main road network for this mode. */
export function nearestNode(g, lat, lon, mode) {
  let best = -1, bestD = Infinity;
  const la = Math.round(lat * 1e7), lo = Math.round(lon * 1e7);
  const k = Math.cos(lat * RAD);
  for (let i = 0; i < g.n; i++) {
    if (!(g.nodeFlags[i] & mode)) continue;
    const dy = g.lat[i] - la, dx = (g.lon[i] - lo) * k;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** A* from node a to node b. Returns {coords:[[lon,lat]...], meters, seconds} or null. */
export function route(g, a, b, mode) {
  const n = g.n;
  const cost = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap();
  const bl = g.lat[b] / 1e7, bo = g.lon[b] / 1e7;
  const hspeed = mode === CAR ? MAX_CAR_MS : WALK_MS;
  const h = (i) => dist(g.lat[i] / 1e7, g.lon[i] / 1e7, bl, bo) / hspeed;
  cost[a] = 0;
  heap.push(a, h(a));
  while (heap.size) {
    const u = heap.pop();
    if (u === b) break;
    if (done[u]) continue;
    done[u] = 1;
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      if (!(g.edgeFlags[e] & mode)) continue;
      const s = g.seg[e] & 0x7fffffff;
      const v = g.target[e];
      const w = mode === CAR ? g.segLen[s] / (g.segSpeed[s] / 3.6) : g.segLen[s] / WALK_MS;
      const c = cost[u] + w;
      if (c < cost[v]) { cost[v] = c; prevEdge[v] = e; heap.push(v, c + h(v)); }
    }
  }
  if (cost[b] === Infinity) return null;

  // walk back: collect edges, then build coordinates forward
  const edges = [];
  for (let v = b; v !== a; ) {
    const e = prevEdge[v];
    edges.push(e);
    v = edgeSource(g, e);
  }
  edges.reverse();
  const pt = (i) => [g.lon[i] / 1e7, g.lat[i] / 1e7];
  const coords = [pt(a)];
  const legs = []; // {seg, from (node), at (index in coords where this edge starts)}
  let meters = 0, from = a;
  for (const e of edges) {
    const raw = g.seg[e], s = raw & 0x7fffffff, rev = raw >>> 31;
    legs.push({ seg: s, from, at: coords.length - 1 });
    const mid = [];
    for (let j = g.geomOff[s]; j < g.geomOff[s + 1]; j++) mid.push([g.geom[2 * j + 1] / 1e7, g.geom[2 * j] / 1e7]);
    if (rev) mid.reverse();
    coords.push(...mid, pt(g.target[e]));
    meters += g.segLen[s];
    from = g.target[e];
  }
  // cumulative distance along the line, used for "in 300 m" and progress
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + dist(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  return { coords, cum, legs, meters, seconds: cost[b], mode };
}

// ---- turn-by-turn ----------------------------------------------------------

const bearing = (p, q) => {
  const y = (q[1] - p[1]), x = (q[0] - p[0]) * Math.cos(p[1] * RAD);
  return Math.atan2(x, y) / RAD; // 0 = north, 90 = east
};

/** Turns along a route: [{type, name, at, dist, lon, lat}], last one is 'arrive'. */
export function maneuvers(g, r, roads) {
  const { coords, cum, legs } = r;
  const steps = [];
  const nameOf = (leg) => roads[g.segName[leg.seg]] || '';
  let cur = legs.length ? nameOf(legs[0]) : '';
  steps.push({ type: 'depart', name: cur, at: 0, dist: 0 });
  for (let k = 1; k < legs.length; k++) {
    const at = legs[k].at, u = legs[k].from;
    const name = nameOf(legs[k]);
    const degree = g.off[u + 1] - g.off[u];
    if (degree < 3 && name === cur) continue; // just a bend, no other road to take
    // look ~20 m back and forward so tiny kinks at the junction don't fool us
    let i = at, j = at;
    while (i > 0 && cum[at] - cum[i] < 20) i--;
    while (j < coords.length - 1 && cum[j] - cum[at] < 20) j++;
    if (i === at || j === at) continue;
    let ang = bearing(coords[at], coords[j]) - bearing(coords[i], coords[at]);
    ang = ((ang + 540) % 360) - 180; // -180..180, + is right
    const a = Math.abs(ang);
    let type = null;
    if (a > 155) type = 'uturn';
    else if (a >= 55) type = ang < 0 ? 'left' : 'right';
    else if (a >= 25 && degree >= 3 && name && name !== cur) type = ang < 0 ? 'slight-left' : 'slight-right'; // a fork, not a curve
    else if (name !== cur && name && degree >= 3) type = 'straight';
    if (!type) continue;
    steps.push({ type, name, at, dist: cum[at], lon: coords[at][0], lat: coords[at][1] });
    cur = name;
  }
  const last = coords.length - 1;
  steps.push({ type: 'arrive', name: '', at: last, dist: cum[last], lon: coords[last][0], lat: coords[last][1] });
  return steps;
}

/**
 * Where we are on the route: nearest point on the line to (lat, lon).
 * Searches near `hint` (last coords index) first. Returns {idx, along, off} in metres.
 */
export function progress(r, lat, lon, hint = 0) {
  const { coords, cum } = r;
  const k = Math.cos(lat * RAD);
  let best = { idx: 0, along: 0, off: Infinity };
  const scan = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(coords.length - 1, to); i++) {
      const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
      const dx = (bx - ax) * k, dy = by - ay;
      const px = (lon - ax) * k, py = lat - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx, ey = py - t * dy;
      const off = Math.sqrt(ex * ex + ey * ey) * RAD * R;
      if (off < best.off) best = { idx: i, along: cum[i] + t * (cum[i + 1] - cum[i]), off };
    }
  };
  scan(hint - 5, hint + 300);
  if (best.off > 60) scan(0, coords.length); // lost the thread: check the whole line
  return best;
}

function edgeSource(g, e) {
  // binary search the CSR offsets
  let lo = 0, hi = g.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.off[mid] <= e) lo = mid; else hi = mid - 1;
  }
  return lo;
}

class Heap {
  constructor() { this.k = []; this.p = []; this.size = 0; }
  push(key, pri) {
    const k = this.k, p = this.p;
    let i = this.size++;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pri) break;
      k[i] = k[j]; p[i] = p[j]; i = j;
    }
    k[i] = key; p[i] = pri;
  }
  pop() {
    const k = this.k, p = this.p, top = k[0];
    const lk = k[--this.size], lp = p[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && p[c + 1] < p[c]) c++;
      if (p[c] >= lp) break;
      k[i] = k[c]; p[i] = p[c]; i = c;
    }
    k[i] = lk; p[i] = lp;
    return top;
  }
}

// ---- search ---------------------------------------------------------------

const STOP = new Set(('вулиця вул улица ул проспект просп пр пр-т провулок пров переулок пер бульвар бул б-р ' +
  'площа пл площадь шосе шоссе узвиз спуск набережна набережная наб тупик произд проезд м г город мисто ' +
  'село смт поселок селище дом д буд будинок').split(' ').flatMap((w) => norm(w).split(' '))); // "б-р" -> "б", "р"

/** Lowercase and fold Ukrainian/Russian spelling differences so "Яворницкого" == "Яворницького". */
export function norm(s) {
  return s.toLowerCase()
    .replace(/ё/g, 'е').replace(/[іїы]/g, 'и').replace(/[єэ]/g, 'е').replace(/ґ/g, 'г')
    .replace(/[ьъ'’ʼ`"«»]/g, '')
    .replace(/[^a-zа-я0-9/]+/g, ' ')
    .trim();
}

const town = (street) => (street[4] ? ` · ${street[4]}` : '');

/** data = {streets:[[name, ru, lat, lon, town]],addr:[streetIdx, hn, lat, lon, ...], places:[[name, ru, lat, lon]]} */
export function prepareIndex(data) {
  data.streetKeys = data.streets.map(([n, ru]) => ' ' + norm(n) + ' ' + norm(ru || ''));
  data.placeKeys = data.places.map(([n, ru]) => ' ' + norm(n) + ' ' + norm(ru || ''));
  return data;
}

/** Returns up to `limit` results: {label, lat, lon}. */
export function search(idx, query, limit = 20, near = null) {
  // "5 а" / "5-а" -> "5а" before splitting, so the letter is not taken for a street word
  const toks = norm(query).replace(/(\d) ([а-яa-z])(?= |$)/g, '$1$2').split(' ').filter((t) => t && !STOP.has(t));
  const num = toks.find((t) => /^\d+[а-яa-z]?(\/\d+[а-яa-z]?)?$/.test(t));
  const words = toks.filter((t) => t !== num);
  if (!words.length) return [];
  // every word must start some word of the name
  const match = (key) => words.every((w) => key.includes(' ' + w));
  const out = [];

  const streetIds = [];
  idx.streetKeys.forEach((k, i) => { if (match(k)) streetIds.push(i); });

  if (num) {
    const want = new Set(streetIds);
    const exact = [], prefix = [];
    const a = idx.addr;
    for (let i = 0; i < a.length; i += 4) {
      if (!want.has(a[i])) continue;
      const hn = norm(String(a[i + 1])).replace(/ /g, '');
      const r = { label: `${idx.streets[a[i]][0]}, ${a[i + 1]}${town(idx.streets[a[i]])}`, lat: a[i + 2], lon: a[i + 3] };
      if (hn === num) exact.push({ ...r, top: 1 }); else if (hn.startsWith(num)) prefix.push(r);
    }
    out.push(...exact, ...prefix);
  } else {
    for (const i of streetIds) out.push({ label: idx.streets[i][0] + town(idx.streets[i]), lat: idx.streets[i][2], lon: idx.streets[i][3] });
    idx.placeKeys.forEach((k, i) => {
      if (match(k)) out.unshift({ label: idx.places[i][0], lat: idx.places[i][2], lon: idx.places[i][3], top: 1 });
    });
  }
  // closest to `near` (map centre) first; exact house numbers stay ahead of prefix matches
  if (near) {
    for (const r of out) r.d = dist(r.lat, r.lon, near.lat, near.lon);
    out.sort((a, b) => (b.top || 0) - (a.top || 0) || a.d - b.d);
  }
  // one building is often mapped twice (point + outline): same label within ~1 km is one result
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.label}|${Math.round(r.lat * 100)}|${Math.round(r.lon * 100)}`;
    return !seen.has(k) && seen.add(k);
  }).slice(0, limit);
}
