import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './gradient.glsl?raw';

export default defineLayer({
  type: 'gradient',
  title: 'Gradient',
  version: 1,
  kind: 'generator',
  category: 'color',
  icon: '▤',
  defaults: { blendMode: 'normal' },
  params: {
    stops: p.gradient({
      default: {
        stops: [
          { pos: 0, color: [0, 0, 0] },
          { pos: 1, color: [1, 1, 1] },
        ],
        interp: 'rgb',
      },
    }),
    gradientType: p.enum({ default: 'linear', options: ['linear', 'radial'] }),
    angle: p.angle({ default: 90, gizmo: 'gradientAxis', visibleIf: (q) => q.gradientType === 'linear' }),
    center: p.vec2({ default: [0, 0], min: -1, max: 1, visibleIf: (q) => q.gradientType === 'radial' }),
    radius: p.float({ default: 1, min: 0.01, max: 2, visibleIf: (q) => q.gradientType === 'radial' }),
  },
  shader: glsl,
  legacy: {
    type: 'GradientLayer',
    params: (o) => ({
      stops: Array.isArray(o.gradient_stops)
        ? {
            stops: (o.gradient_stops as { position: number; color: number[] }[]).map((s) => ({
              pos: s.position,
              color: s.color,
            })),
            interp: 'rgb',
          }
        : undefined,
      angle: o.angle,
      gradientType: o.gradient_type === 'Radial' ? 'radial' : 'linear',
    }),
  },
});
