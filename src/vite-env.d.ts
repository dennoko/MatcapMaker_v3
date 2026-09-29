/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __WEB_BUILD__: boolean;

declare module '*.glsl?raw' {
  const src: string;
  export default src;
}
