// Turns raw/<city>.geojsonseq (roads + addresses from osmium) and raw/tiles/<city>.pmtiles
// into the files the app downloads: docs/data/<city>/{tiles.pmtiles,graph.bin.gz,addr.json.gz}[.N]
// Usage: node tools/build-data.mjs [cityId ...]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { CITIES, bbox } from './cities.mjs';
import { dist } from '../docs/core.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'data');
const PART = 45 * 1024 * 1024; // GitHub refuses files over 100 MB

const CAR_KMH = {
  motorway: 110, motorway_link: 60, trunk: 90, trunk_link: 50, primary: 70, primary_link: 40,
  secondary: 60, secondary_link: 40, tertiary: 50, tertiary_link: 30, unclassified: 40,
  residential: 30, living_street: 10, service: 15, road: 30,
};
const FOOT_ONLY = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'bridleway', 'corridor']);
const NO = new Set(['no', 'private']);
const YES = new Set(['yes', 'designated', 'permissive', 'destination']);

function access(t) {
  const hw = t.highway;
  let car = hw in CAR_KMH, foot = (hw in CAR_KMH || FOOT_ONLY.has(hw)) && !hw.startsWith('motorway');
  if (t.area === 'yes') return null;
  if (NO.has(t.access)) { car = car && YES.has(t.motor_vehicle ?? t.motorcar); foot = foot && YES.has(t.foot); }
  if (NO.has(t.motor_vehicle) || NO.has(t.motorcar) || NO.has(t.vehicle)) car = false;
  if (NO.has(t.foot)) foot = false;
  if (!car && !foot) return null;
  let fwd = car, bwd = car;
  const ow = t.oneway;
  if (car && ow !== 'no' && (ow === 'yes' || ow === '1' || ow === 'true' || t.junction === 'roundabout' ||
      t.junction === 'circular' || hw === 'motorway')) bwd = false;
  if (car && ow === '-1') { fwd = false; bwd = true; }
  const max = parseInt(t.maxspeed, 10);
  const kmh = car ? (max > 0 && max < 140 ? Math.min(max, CAR_KMH[hw] * 1.3) : CAR_KMH[hw]) : 0;
  return { fwd, bwd, foot, kmh: Math.max(5, Math.round(kmh * 0.85)), max: car && max > 0 && max <= 140 ? max : 0 }; // 0.85: real driving is slower than limits
}

const key = ([lon, lat]) => `${lon},${lat}`; // a shared OSM node has identical coordinates in every way
const r5 = (v) => Math.round(v * 1e5) / 1e5;

async function buildCity([id, name, lat, lon]) {
  const src = path.join(ROOT, 'raw', `${id}.geojsonseq`);
  const ways = [], addrFeat = [], places = [], streetRu = new Map(), streetPos = [];
  const rl = readline.createInterface({ input: fs.createReadStream(src), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const f = JSON.parse(line.replace(/^\x1e/, ''));
    const t = f.properties, gt = f.geometry.type;
    if (t.highway && gt === 'LineString') {
      if (t.name) {
        if (t['name:ru'] && !streetRu.has(t.name)) streetRu.set(t.name, t['name:ru']);
        const c = f.geometry.coordinates;
        streetPos.push([t.name, c[c.length >> 1]]);
      }
      const a = access(t);
      if (a) ways.push([f.geometry.coordinates, a, t.name || t.ref || '']);
    } else if (t['addr:housenumber'] && (t['addr:street'] || t['addr:place']) && gt !== 'LineString') {
      addrFeat.push([t['addr:street'] || t['addr:place'], t['addr:housenumber'], centroid(f.geometry), t['addr:city']]);
    } else if (t.place && t.name && gt === 'Point') {
      places.push([t.name, t['name:ru'] || '', r5(f.geometry.coordinates[1]), r5(f.geometry.coordinates[0]), t.place]);
    }
  }

  // ---- graph: split ways at junctions (nodes used more than once) and at ends
  const uses = new Map();
  for (const [c] of ways) for (const p of c) { const k = key(p); uses.set(k, (uses.get(k) || 0) + 1); }
  const nodeIdx = new Map(), nodes = [];
  const node = (p) => {
    const k = key(p);
    let i = nodeIdx.get(k);
    if (i === undefined) { i = nodes.length; nodeIdx.set(k, i); nodes.push(p); }
    return i;
  };
  const segs = []; // [a, b, len, mid[], a(access)]
  const roadIdx = new Map([['', 0]]), roads = [''];
  const road = (s) => { let i = roadIdx.get(s); if (i === undefined) { i = roads.length; roadIdx.set(s, i); roads.push(s); } return i; };
  for (const [c, acc, nm] of ways) {
    const ri = road(nm);
    let start = 0, len = 0;
    for (let j = 1; j < c.length; j++) {
      len += dist(c[j - 1][1], c[j - 1][0], c[j][1], c[j][0]);
      if (j === c.length - 1 || uses.get(key(c[j])) > 1) {
        const a = node(c[start]), b = node(c[j]);
        if (a !== b || len > 0) segs.push([a, b, len, c.slice(start + 1, j), acc, ri]);
        start = j; len = 0;
      }
    }
  }

  // directed edges: [from, to, seg|rev<<31, flags]
  const edges = [];
  segs.forEach(([a, b, , , acc], s) => {
    const fwd = (acc.fwd ? 1 : 0) | (acc.foot ? 2 : 0), bwd = (acc.bwd ? 1 : 0) | (acc.foot ? 2 : 0);
    if (fwd) edges.push([a, b, s, fwd]);
    if (bwd) edges.push([b, a, (s | 0x80000000) >>> 0, bwd]);
  });
  edges.sort((x, y) => x[0] - y[0]);

  // nodes on the biggest connected piece per mode, so we never snap onto an isolated parking lot
  const nodeFlags = new Uint8Array(nodes.length);
  for (const mode of [1, 2]) {
    const parent = new Int32Array(nodes.length).map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
    const has = new Uint8Array(nodes.length);
    for (const [a, b, , f] of edges) if (f & mode) { parent[find(a)] = find(b); has[a] = has[b] = 1; }
    const size = new Map();
    for (let i = 0; i < nodes.length; i++) if (has[i]) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
    let big = -1, bigN = 0;
    for (const [r, n] of size) if (n > bigN) { big = r; bigN = n; }
    for (let i = 0; i < nodes.length; i++) if (has[i] && find(i) === big) nodeFlags[i] |= mode;
  }

  const n = nodes.length, E = edges.length, S = segs.length;
  const G = segs.reduce((s, x) => s + x[3].length, 0);
  const parts = [];
  const push = (T, arr) => parts.push(Buffer.from(T.from(arr).buffer));
  push(Uint32Array, [n, E, S, G]);
  push(Int32Array, nodes.map((p) => Math.round(p[1] * 1e7)));
  push(Int32Array, nodes.map((p) => Math.round(p[0] * 1e7)));
  const off = new Uint32Array(n + 1);
  for (const [a] of edges) off[a + 1]++;
  for (let i = 0; i < n; i++) off[i + 1] += off[i];
  push(Uint32Array, off);
  push(Uint32Array, edges.map((e) => e[1]));
  push(Uint32Array, edges.map((e) => e[2]));
  push(Float32Array, segs.map((s) => s[2]));
  const geomOff = new Uint32Array(S + 1);
  segs.forEach((s, i) => (geomOff[i + 1] = geomOff[i] + s[3].length));
  push(Uint32Array, geomOff);
  const geom = new Int32Array(2 * G);
  let gi = 0;
  for (const s of segs) for (const p of s[3]) { geom[gi++] = Math.round(p[1] * 1e7); geom[gi++] = Math.round(p[0] * 1e7); }
  parts.push(Buffer.from(geom.buffer));
  push(Uint32Array, segs.map((s) => s[5])); // road name index -> addr.json "roads"
  push(Uint8Array, edges.map((e) => e[3]));
  push(Uint8Array, segs.map((s) => s[4].kmh));
  parts.push(Buffer.from(nodeFlags.buffer));
  push(Uint8Array, segs.map((s) => s[4].max)); // signed speed limit, 0 = not mapped
  const graph = zlib.gzipSync(Buffer.concat(parts), { level: 9 });

  // ---- addresses
  // The same street name repeats in many villages, so a street is (name, settlement).
  // shortcut: settlement = nearest place node weighted by size; addr:city wins when mapped. Upgrade to boundary polygons if labels look wrong.
  const WEIGHT = { city: 8, town: 3, village: 1, hamlet: 0.5 };
  const towns = places.filter((p) => WEIGHT[p[4]]);
  const townAt = (lat, lon) => {
    let best = '', bestD = Infinity;
    for (const p of towns) { const d = dist(lat, lon, p[2], p[3]) / WEIGHT[p[4]]; if (d < bestD) { bestD = d; best = p[0]; } }
    return best;
  };
  const streetIdx = new Map(), streets = [], addr = [];
  const sid = (s, town, lat, lon) => {
    const k = s + '|' + town;
    let i = streetIdx.get(k);
    if (i === undefined) {
      i = streets.length; streetIdx.set(k, i);
      streets.push([s, streetRu.get(s) || '', r5(lat), r5(lon), town]);
    }
    return i;
  };
  for (const [s, [x, y]] of streetPos) sid(s, townAt(y, x), y, x);
  const seen = new Set();
  for (const [s, hn, [x, y], city] of addrFeat) {
    const k = s + '|' + hn + '|' + Math.round(x * 1e3) + Math.round(y * 1e3); // same address in two towns stays
    if (seen.has(k)) continue;
    seen.add(k);
    addr.push(sid(s, city || townAt(y, x), y, x), hn, r5(y), r5(x));
  }
  for (const p of places) p.length = 4; // the app does not need the place type
  const addrGz = zlib.gzipSync(JSON.stringify({ streets, addr, places, roads }), { level: 9 });

  // ---- write
  const dir = path.join(OUT, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    tiles: writeParts(dir, id, 'tiles.pmtiles', fs.readFileSync(path.join(ROOT, 'raw', 'tiles', `${id}.pmtiles`))),
    graph: writeParts(dir, id, 'graph.bin.gz', graph),
    addr: writeParts(dir, id, 'addr.json.gz', addrGz),
  };
  console.log(id, `nodes=${n} edges=${E} addresses=${addr.length / 4} streets=${streets.length} places=${places.length}`,
    Object.entries(files).map(([k, f]) => `${k}=${(f.size / 1e6).toFixed(1)}MB`).join(' '));
  // version lets phones see that a downloaded city is outdated (part URLs stay the same)
  const version = crypto.createHash('sha256').update(graph).update(addrGz).update(String(files.tiles.size)).digest('hex').slice(0, 10);
  return { id, name, version, center: [lon, lat], bbox: bbox([id, name, lat, lon]), files };
}

function writeParts(dir, id, file, buf) {
  const urls = [];
  for (let o = 0, i = 0; o < buf.length; o += PART, i++) {
    const f = `${file}.${i}`;
    fs.writeFileSync(path.join(dir, f), buf.subarray(o, o + PART));
    urls.push(`data/${id}/${f}`);
  }
  return { parts: urls, size: buf.length };
}

function centroid(g) {
  if (g.type === 'Point') return g.coordinates;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

const only = process.argv.slice(2);
const manifestPath = path.join(OUT, 'cities.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
for (const c of CITIES) {
  if (only.length && !only.includes(c[0])) continue;
  const entry = await buildCity(c);
  const i = manifest.findIndex((m) => m.id === c[0]);
  if (i >= 0) manifest[i] = entry; else manifest.push(entry);
}
manifest.sort((a, b) => CITIES.findIndex((c) => c[0] === a.id) - CITIES.findIndex((c) => c[0] === b.id));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
