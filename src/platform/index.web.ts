// The web build never resolves native modules (including their side effects).
export { createWebPlatform as createPlatform } from './web';
export * from './types';
