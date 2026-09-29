import { mount } from 'svelte';
import App from './app/App.svelte';

const target = document.getElementById('app')!;
const probe = document.createElement('canvas');
const gl = probe.getContext('webgl2');
let app;
if (gl) {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  app = mount(App, { target });
} else {
  target.innerHTML = `<main style="max-width:42rem;margin:10vh auto;padding:2rem;font:18px/1.6 sans-serif">
    <h1>Matcap Maker — WebGL2</h1>
    <p>WebGL2 が利用できません。ブラウザのハードウェアアクセラレーションを有効にして再起動してください。</p>
    <p>WebGL2 is unavailable. Enable hardware acceleration and restart your browser, or try Chrome / Edge with an updated graphics driver.</p>
  </main>`;
}
export default app;
