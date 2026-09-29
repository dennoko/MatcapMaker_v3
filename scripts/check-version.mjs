import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

assert(existsSync('version.json'), 'version.json does not exist at repository root');
assert(existsSync('package.json'), 'package.json does not exist');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const ver = JSON.parse(readFileSync('version.json', 'utf8'));

assert.equal(typeof ver.version, 'string', 'version.json "version" must be a string');
assert.equal(ver.version, pkg.version, `Version mismatch: package.json (${pkg.version}) !== version.json (${ver.version})`);
assert.equal(typeof ver.url, 'string', 'version.json "url" must be a string');
assert(/^https?:\/\//.test(ver.url), `version.json "url" must be an HTTP(S) URL: ${ver.url}`);

console.log(`Version verified: v${pkg.version} (package.json and version.json match)`);
