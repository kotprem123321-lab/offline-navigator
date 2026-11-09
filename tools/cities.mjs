// Cities and their 40 km square around the centre: [id, name, lat, lon]
export const RADIUS_KM = 40;
export const CITIES = [
  ['dnipro', 'Днепр', 48.4647, 35.0462],
  ['kyiv', 'Киев', 50.4501, 30.5234],
  ['kharkiv', 'Харьков', 49.9935, 36.2304],
  ['zaporizhzhia', 'Запорожье', 47.8388, 35.1396],
  ['odesa', 'Одесса', 46.4825, 30.7233],
  ['lviv', 'Львов', 49.8397, 24.0297],
];

export function bbox([, , lat, lon]) {
  const dLat = RADIUS_KM / 111.32;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => +v.toFixed(4));
}

// `node cities.mjs` prints "id minlon,minlat,maxlon,maxlat" lines for shell scripts
if (import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  for (const c of CITIES) console.log(c[0], bbox(c).join(','));
}
