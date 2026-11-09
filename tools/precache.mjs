// Lists the app files for the service worker and stamps sw.js with a content hash,
// so phones pick up a new version. Run after changing anything in docs/ (except data/).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DOCS = path.resolve(import.meta.dirname, '..', 'docs');
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(DOCS, p).replaceAll('\\', '/');
    if (e.isDirectory()) { if (rel !== 'data') walk(p); }
    else if (!['sw.js', 'precache.json', '.nojekyll'].includes(rel) && !rel.endsWith('.map')) files.push(rel);
  }
};
walk(DOCS);
files.sort();
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(DOCS, f)));
fs.writeFileSync(path.join(DOCS, 'precache.json'), JSON.stringify(['./', 'data/cities.json', ...files], null, 1));
const sw = path.join(DOCS, 'sw.js');
const version = hash.digest('hex').slice(0, 10);
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
console.log(files.length, 'files, version', version);
