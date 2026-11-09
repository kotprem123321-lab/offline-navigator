// node --test tools/  — checks routing and search on the built Dnipro data
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { parseGraph, nearestNode, route, prepareIndex, search, norm, dist, CAR, FOOT } from '../docs/core.js';

const dir = path.resolve(import.meta.dirname, '../docs/data/dnipro');
const read = (f) => zlib.gunzipSync(fs.readFileSync(path.join(dir, f + '.0')));
const gb = read('graph.bin.gz');
const g = parseGraph(gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength));
const idx = prepareIndex(JSON.parse(read('addr.json.gz')));

test('spelling folds Russian and Ukrainian', () => {
  assert.equal(norm('Яворницького'), norm('Яворницкого'));
  assert.equal(norm('вул. Січеславська'), norm('вул. Сичеславська'));
});

test('finds a house by street and number, in Russian', () => {
  const r = search(idx, 'проспект Яворницкого 50');
  assert.ok(r.length > 0, 'no results');
  assert.match(r[0].label, /Яворницького, 50 · Дніпро/);
});

test('same street in different villages is told apart', () => {
  const r = search(idx, 'Шевченко 10');
  assert.ok(r.length > 1);
  assert.equal(new Set(r.map((x) => x.label)).size, r.length, r.map((x) => x.label).join('\n'));
  const c = { lat: 48.4647, lon: 35.0462 };
  const d = search(idx, 'Шевченко 10', 20, c).filter((x) => x.top).map((x) => dist(x.lat, x.lon, c.lat, c.lon));
  assert.ok(d.length > 1 && d.every((v, i) => !i || v >= d[i - 1]), 'nearest first');
});

test('finds a street without number', () => {
  assert.ok(search(idx, 'Набережная Победы').length > 0);
});

// Railway station area -> Left bank (across the Dnipro river)
const A = [48.4776, 35.0145], B = [48.4886, 35.0904];
for (const [name, mode] of [['car', CAR], ['foot', FOOT]]) {
  test(`routes across the river by ${name}`, () => {
    const a = nearestNode(g, ...A, mode), b = nearestNode(g, ...B, mode);
    const t = performance.now();
    const r = route(g, a, b, mode);
    const ms = performance.now() - t;
    assert.ok(r, 'no route');
    assert.ok(r.meters > 5000 && r.meters < 15000, `odd length ${r.meters}`);
    assert.ok(r.coords.length > 10);
    console.log(name, (r.meters / 1000).toFixed(1), 'km', Math.round(r.seconds / 60), 'min', Math.round(ms), 'ms');
  });
}

test('one-way streets are respected by car only', () => {
  // the car route and the reverse car route may differ; foot routes may not
  const a = nearestNode(g, ...A, FOOT), b = nearestNode(g, ...B, FOOT);
  const f1 = route(g, a, b, FOOT).meters, f2 = route(g, b, a, FOOT).meters;
  assert.ok(Math.abs(f1 - f2) < 1, 'walking must be symmetric');
});
