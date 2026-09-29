// Collects third-party licenses of everything that ships in the app
// (production npm dependencies + Rust crates linked into the Windows exe)
// into src/generated/licenses.json, shown in Help > About.
// Runs as part of `pnpm build`, so the notices never go stale.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'generated', 'licenses.json');
const texts = new Map(); // hash -> text
const packages = [];

function licenseText(dir) {
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort();
  if (!files.length) return null;
  return files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
}

function addText(text) {
  if (!text) return undefined;
  const id = createHash('sha1').update(text).digest('hex').slice(0, 12);
  texts.set(id, text);
  return id;
}

// --- npm (production dependency closure) -------------------------------------
function collectNpm() {
  const seen = new Set();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const queue = Object.keys(pkg.dependencies ?? {}).map((n) => [n, join(root, 'node_modules')]);
  while (queue.length) {
    const [name, base] = queue.shift();
    let dir = join(base, name);
    if (!existsSync(dir)) dir = join(root, 'node_modules', name);
    if (!existsSync(dir)) continue;
    const real = realpathSync(dir);
    if (seen.has(real)) continue;
    seen.add(real);
    const p = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    packages.push({
      name: p.name,
      version: p.version,
      license: typeof p.license === 'string' ? p.license : (p.license?.type ?? 'UNKNOWN'),
      source: 'npm',
      repository: typeof p.repository === 'string' ? p.repository : p.repository?.url,
      textId: addText(licenseText(real)),
    });
    // pnpm: dependencies are siblings in the .pnpm store node_modules
    const parentNm = dirname(real.includes('@') && p.name.startsWith('@') ? dirname(real) : real);
    for (const dep of Object.keys(p.dependencies ?? {})) queue.push([dep, parentNm]);
  }
  // Svelte's runtime is compiled into the bundle
  for (const name of ['svelte']) {
    const d = join(root, 'node_modules', name);
    if (!existsSync(d)) continue;
    const p = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'));
    packages.push({ name: p.name, version: p.version, license: p.license, source: 'npm', textId: addText(licenseText(d)) });
  }
}

// --- cargo (normal deps reachable from the app crate, Windows target) ----------
function collectCargo() {
  let meta;
  try {
    const raw = execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--manifest-path', join(root, 'src-tauri', 'Cargo.toml'), '--filter-platform', 'x86_64-pc-windows-msvc'],
      { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    meta = JSON.parse(raw);
  } catch {
    console.warn('[licenses] cargo metadata unavailable; keeping npm entries only');
    return;
  }
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const rootId = meta.resolve.root;
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    for (const d of nodes.get(id)?.deps ?? []) {
      const normal = d.dep_kinds.some((k) => k.kind === null);
      if (!normal || seen.has(d.pkg)) continue;
      seen.add(d.pkg);
      queue.push(d.pkg);
    }
  }
  for (const id of seen) {
    if (id === rootId) continue;
    const p = byId.get(id);
    if (!p) continue;
    packages.push({
      name: p.name,
      version: p.version,
      license: p.license ?? 'UNKNOWN',
      source: 'cargo',
      repository: p.repository ?? undefined,
      textId: addText(licenseText(dirname(p.manifest_path))),
    });
  }
}

// --- bundled third-party code / assets ------------------------------------------
function collectAssets() {
  packages.push({
    name: 'webgl-noise (simplex noise GLSL)',
    version: '2011',
    license: 'MIT',
    source: 'asset',
    repository: 'https://github.com/ashima/webgl-noise',
    textId: addText(`Copyright (C) 2011 Ashima Arts / Stefan Gustavson. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`),
  });
}

collectNpm();
collectCargo();
collectAssets();

const uniq = new Map();
for (const p of packages) uniq.set(`${p.source}:${p.name}@${p.version}`, p);
const list = [...uniq.values()].sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ packages: list, texts: Object.fromEntries(texts) }));
console.log(`[licenses] ${list.length} packages, ${texts.size} unique license texts → ${out}`);
