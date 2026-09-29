/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __WEB_BUILD__: boolean;

declare module '*.glsl?raw' {
  const src: string;
  export default src;
}

declare module '*/licenses.json' {
  const data: { packages: any[]; texts: Record<string, string> };
  export default data;
}
