import type { Plugin } from 'vite';
import { execFileSync } from 'node:child_process';

/** Embed only notices from modules which survived tree shaking. */
export function webLicenses(): Plugin {
  return {
    name: 'matcap-web-licenses',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/generated/licenses.json')) return '\0matcap-web-licenses';
    },
    load(id) {
      if (id === '\0matcap-web-licenses') return 'export default JSON.parse("__MATCAP_WEB_LICENSES__")';
    },
    generateBundle(_, bundle) {
      const ids = Object.values(bundle).flatMap((chunk) => chunk.type === 'chunk'
        ? Object.entries(chunk.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => id) : []);
      const notices = execFileSync(process.execPath, ['scripts/gen-licenses.mjs', '--target', 'web', '--modules-stdin'], {
        input: JSON.stringify(ids), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      });
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') chunk.code = chunk.code.replace(/(["'`])__MATCAP_WEB_LICENSES__\1/g, () => JSON.stringify(notices));
      }
    },
  };
}

export function singleFile(): Plugin {
  return {
    name: 'matcap-single-file',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const entry = bundle['index.html'];
        if (!entry || entry.type !== 'asset') throw new Error('Missing index.html');
        let html = String(entry.source);
        for (const [name, output] of Object.entries(bundle)) {
          if (output.type === 'chunk') {
            // Rolldown reports inlined dynamic modules as a reference to this chunk.
            if ([...output.imports, ...output.dynamicImports].some((id) => id !== name)) throw new Error(`External JS in ${name}`);
            const code = output.code.replace(/<\/script/gi, '<\\/script');
            html = html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (tag, src: string) =>
              src.replace(/^\.\//, '') === name ? `<script type="module">${code}</script>` : tag);
            delete bundle[name];
          } else if (name.endsWith('.css')) {
            html = html.replace(/<link\b[^>]*href="([^"]+)"[^>]*>/g, (tag, href: string) =>
              href.replace(/^\.\//, '') === name ? `<style>${String(output.source).replace(/<\/style/gi, '<\\/style')}</style>` : tag);
            delete bundle[name];
          } else if (name.endsWith('.png') && html.includes(`./${name}`)) {
            html = html.replaceAll(`./${name}`, `data:image/png;base64,${Buffer.from(output.source).toString('base64')}`);
            delete bundle[name];
          }
        }
        delete bundle['index.html'];
        if (Object.keys(bundle).length) throw new Error(`Unembedded assets: ${Object.keys(bundle).join(', ')}`);
        this.emitFile({ type: 'asset', fileName: 'MatcapMaker.html', source: html });
      },
    },
  };
}
