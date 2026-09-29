import { defineLayer } from './defineLayer';
import { p, type RGB } from '../schema/params';
import { foldColorIntensity } from './multiplyFold';
import glsl from './fresnel.glsl?raw';

export default defineLayer({
  type: 'fresnel',
  title: 'Fresnel / Rim',
  version: 1,
  kind: 'generator',
  category: 'light',
  icon: '◯',
  defaults: { blendMode: 'add' },
  params: {
    color: p.color({ default: '#00ffff' }),
    intensity: p.float({ default: 1, min: 0, max: 10, softMax: 5 }),
    power: p.float({ default: 5, min: 0, max: 50, softMax: 20, gizmo: 'rimDrag' }),
    bias: p.float({ default: 0, min: -1, max: 1 }),
  },
  shader: glsl,
  uniforms: (params, node) => foldColorIntensity(params.color as RGB, params.intensity as number, node),
  legacy: {
    type: 'FresnelLayer',
    params: (o) => ({ color: o.color, intensity: o.intensity, power: o.power, bias: o.bias }),
  },
});
