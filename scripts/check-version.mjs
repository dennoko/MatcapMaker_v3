import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// version.json is the single source of truth for the app version (vite,
// tauri.conf.json, build.rs and the release scripts all read it).
assert(existsSync('version.json'), 'version.json does not exist at repository root');

const ver = JSON.parse(readFileSync('version.json', 'utf8'));
assert.equal(typeof ver.version, 'string', 'version.json "version" must be a string');
assert(/^\d+\.\d+\.\d+$/.test(ver.version), `version.json "version" must be MAJOR.MINOR.PATCH: ${ver.version}`);
assert.equal(typeof ver.url, 'string', 'version.json "url" must be a string');
assert(/^https?:\/\//.test(ver.url), `version.json "url" must be an HTTP(S) URL: ${ver.url}`);

// a second copy would drift, so package.json must not carry one
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(!('version' in pkg), 'package.json must not have a "version" field; set it in version.json');

// release builds: the pushed tag must match
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME?.startsWith('v')) {
  assert.equal(process.env.GITHUB_REF_NAME, `v${ver.version}`, `Tag ${process.env.GITHUB_REF_NAME} does not match version.json (${ver.version})`);
}

console.log(`Version verified: v${ver.version} (version.json)`);
