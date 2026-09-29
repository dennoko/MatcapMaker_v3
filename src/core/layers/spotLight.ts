import { defineLayer } from './defineLayer';
import { p, type RGB } from '../schema/params';
import { foldColorIntensity } from './multiplyFold';
import glsl from './spotLight.glsl?raw';

/** v3 stored the light's travel direction in a -Z-forward space. */
export function legacyDirection(d: unknown): [number, number, number] | undefined {
  if (!Array.isArray(d) || d.length < 3) return undefined;
  const [x, y, z] = d.map(Number);
  return [-x, -y, z];
}

export default defineLayer({
  type: 'spotLight',
  title: 'Spot Light',
  version: 1,
  kind: 'generator',
  category: 'light',
  icon: '☀',
  defaults: { blendMode: 'add' },
  params: {
    direction: p.direction({ default: [0, 0, 1], gizmo: 'sphereHandle' }),
    color: p.color({ default: '#ffffff' }),
    intensity: p.float({ default: 1, min: 0, max: 10, softMax: 5 }),
    range: p.float({ default: 0.2, min: 0, max: 1 }),
    blur: p.float({ default: 0.1, min: 0, max: 1 }),
    scale: p.vec2({ default: [1, 1], min: 0.01, max: 10, softMin: 0.1, softMax: 5 }),
    rotation: p.angle({ default: 0, gizmo: 'rotateRing' }),
    // light falloff; the default straight line keeps the v3 look
    falloff: p.curve({ default: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
  },
  shader: glsl,
  uniforms: (params, node) => foldColorIntensity(params.color as RGB, params.intensity as number, node),
  legacy: {
    type: 'SpotLightLayer',
    params: (o) => ({
      direction: legacyDirection(o.direction),
      color: o.color,
      intensity: o.intensity,
      range: o.range,
      blur: o.blur,
      scale: [o.scale_x ?? 1, o.scale_y ?? 1],
      rotation: o.rotation,
    }),
  },
});
