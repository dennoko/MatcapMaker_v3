import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './noise.glsl?raw';

export default defineLayer({
  type: 'noise',
  title: 'Noise',
  version: 1,
  kind: 'generator',
  category: 'texture',
  icon: '▦',
  defaults: { blendMode: 'multiply' },
  params: {
    noiseType: p.enum({ default: 'white', options: ['white', 'simplex'] }),
    scale: p.float({ default: 1, min: 0.01, max: 50, softMin: 0.1, softMax: 10 }),
    intensity: p.float({ default: 1, min: 0, max: 1 }),
    seed: p.int({ default: 0, min: 0, max: 100000, softMax: 100 }),
    color: p.color({ default: '#000000' }),
  },
  shader: glsl,
  resources: { u_noiseTex: { kind: 'noise', size: 256, seedParam: 'seed' } },
  legacy: {
    type: 'NoiseLayer',
    params: (o) => ({ noiseType: 'white', scale: o.scale, intensity: o.intensity, seed: o.seed, color: o.color }),
  },
});
