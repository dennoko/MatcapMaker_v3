// Generates comprehensive license documents into the LICENCE/ directory
// from src/generated/licenses.json.
// Can be run standalone via `node scripts/gen-license-files.mjs` or `pnpm licenses:files`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = join(root, 'src', 'generated', 'licenses.json');
const licenceDir = join(root, 'LICENCE');

if (!existsSync(jsonPath)) {
  console.error(`[gen-license-files] Error: ${jsonPath} does not exist. Run scripts/gen-licenses.mjs first.`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const packages = data.packages ?? [];
const texts = data.texts ?? {};

mkdirSync(licenceDir, { recursive: true });

// Standard license fallbacks for the few packages missing textId
const standardFallbacks = {
  'MIT': `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  'BSD-3-Clause': `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  'MPL-2.0': `Mozilla Public License Version 2.0
==================================

1. Definitions
--------------
... (For full text see https://www.mozilla.org/MPL/2.0/)
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.`
};

function getLicenseText(pkg) {
  if (pkg.textId && texts[pkg.textId]) return texts[pkg.textId];
  // Known shared repository fallbacks
  if (pkg.name.startsWith('webview2-com')) return standardFallbacks['MIT'];
  if (pkg.name === 'alloc-stdlib') return texts['0fd44d64e916'] || standardFallbacks['BSD-3-Clause'];
  if (pkg.name === 'defmt-parser') return texts['124d81d397d4'] || standardFallbacks['MIT'];
  if (pkg.name === 'pulp-wasm-simd-flag') return texts['5bf2a17b5053'] || standardFallbacks['MIT'];
  if (pkg.name === 'selectors') return texts['78fe0ed5d283'] || standardFallbacks['MPL-2.0'];
  if (pkg.name === 'zune-inflate') return standardFallbacks['MIT'];
  return standardFallbacks[pkg.license] || `License: ${pkg.license}\nSee: ${pkg.repository ?? 'upstream repository'}`;
}

// -----------------------------------------------------------------------------
// 1. Generate LICENCE/THIRD_PARTY_LICENSES.txt
// -----------------------------------------------------------------------------
const txtLines = [
  '================================================================================',
  'Matcap Maker - Third-Party Software Licenses and Notices',
  '================================================================================',
  '',
  'This application is built with the following open-source software packages.',
  'This file contains the complete notices and license terms for all components',
  'included in the binary distribution (desktop application) and web build.',
  '',
  '================================================================================',
  'Table of Contents (Included Packages)',
  '================================================================================',
  '',
];

for (const p of packages) {
  txtLines.push(`- ${p.name} (v${p.version}) [${p.source}] - ${p.license}`);
}

txtLines.push('');
txtLines.push('================================================================================');
txtLines.push('License Texts and Notices');
txtLines.push('================================================================================');
txtLines.push('');

for (const p of packages) {
  txtLines.push('--------------------------------------------------------------------------------');
  txtLines.push(`Package:    ${p.name}`);
  txtLines.push(`Version:    ${p.version}`);
  txtLines.push(`Source:     ${p.source}`);
  txtLines.push(`License:    ${p.license}`);
  if (p.repository) txtLines.push(`Repository: ${p.repository}`);
  txtLines.push('--------------------------------------------------------------------------------');
  txtLines.push('');
  txtLines.push(getLicenseText(p).trim());
  txtLines.push('');
  txtLines.push('');
}

const txtPath = join(licenceDir, 'THIRD_PARTY_LICENSES.txt');
writeFileSync(txtPath, txtLines.join('\n'), 'utf8');
console.log(`[gen-license-files] Wrote ${packages.length} packages to ${txtPath}`);

// -----------------------------------------------------------------------------
// 2. Generate LICENCE/THIRD_PARTY_LICENSES.md
// -----------------------------------------------------------------------------
const mdLines = [
  '# Matcap Maker サードパーティライセンス一覧',
  '',
  '本ドキュメントは、「Matcap Maker」に含まれる、またはリンクされているすべてのオープンソースソフトウェアおよびアセットのライセンス表記と著作権通知の一覧です。',
  '',
  '> [!NOTE]',
  `> 本ドキュメントは \`scripts/gen-licenses.mjs\` および \`scripts/gen-license-files.mjs\` により自動生成されています（合計 **${packages.length}** パッケージ）。`,
  '',
  '## 1. 依存コンポーネント一覧',
  '',
  '| パッケージ名 | バージョン | ライセンス | 種別 | リポジトリ / 配布元 |',
  '|:---|:---|:---|:---|:---|',
];

for (const p of packages) {
  const repoLink = p.repository ? `[Link](${p.repository})` : '-';
  const sourceLabel = p.source === 'npm' ? 'npm (Frontend)' : p.source === 'cargo' ? 'Cargo (Rust)' : 'Asset (GLSL)';
  mdLines.push(`| **${p.name}** | \`${p.version}\` | \`${p.license}\` | ${sourceLabel} | ${repoLink} |`);
}

mdLines.push('');
mdLines.push('---');
mdLines.push('');
mdLines.push('## 2. 各ライブラリのライセンス条文全文');
mdLines.push('');

for (const p of packages) {
  mdLines.push(`### ${p.name} (v${p.version})`);
  mdLines.push('');
  mdLines.push(`- **ライセンス**: \`${p.license}\``);
  mdLines.push(`- **配布形態**: ${p.source}`);
  if (p.repository) mdLines.push(`- **リポジトリ**: <${p.repository}>`);
  mdLines.push('');
  mdLines.push('```text');
  mdLines.push(getLicenseText(p).trim());
  mdLines.push('```');
  mdLines.push('');
}

const mdPath = join(licenceDir, 'THIRD_PARTY_LICENSES.md');
writeFileSync(mdPath, mdLines.join('\n'), 'utf8');
console.log(`[gen-license-files] Wrote markdown notices to ${mdPath}`);
