import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const directory = 'dist-single';
assert.deepEqual(readdirSync(directory), ['MatcapMaker.html'], 'Distribution must contain exactly one HTML');
const data = readFileSync(`${directory}/MatcapMaker.html`);
assert(data.length <= 1_500_000, `Single HTML exceeds 1.5 MB: ${data.length} bytes`);
const html = data.toString('utf8');
assert(!/__TAURI_INTERNALS__|["'`]plugin:|__MATCAP_WEB_LICENSES__/.test(html), 'Native code or unresolved notices in web bundle');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
for (const [, value] of markup.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
  assert(/^(?:data:|#)/.test(value), `External resource in HTML: ${value}`);
}
assert(!/\bimport\s*\(\s*["'`]/.test(html), 'Dynamic import in single HTML');
console.log(`Single HTML verified: ${data.length.toLocaleString()} / 1,500,000 bytes`);
