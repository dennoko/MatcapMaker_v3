import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './image.glsl?raw';

export default defineLayer({
  type: 'image',
  title: 'Image',
  version: 1,
  kind: 'generator',
  category: 'texture',
  icon: '▣',
  defaults: { blendMode: 'add' },
  params: {
    image: p.asset({ gizmo: 'imageBox' }),
    mapping: p.enum({ default: 'uv', options: ['uv', 'planar'] }),
    scale: p.float({ default: 1, min: 0.01, max: 20, softMin: 0.1, softMax: 5 }),
    scaleXY: p.vec2({ default: [1, 1], min: 0.01, max: 20, softMin: 0.1, softMax: 5 }),
    rotation: p.angle({ default: 0 }),
    offset: p.vec2({ default: [0, 0], min: -10, max: 10, softMin: -1, softMax: 1 }),
    blur: p.float({ default: 0, min: 0, max: 1 }),
  },
  shader: glsl,
  legacy: {
    type: 'ImageLayer',
    // image_path is resolved to an asset by the importer
    params: (o) => ({
      mapping: o.mapping_mode === 'Planar' ? 'planar' : 'uv',
      scale: o.scale,
      scaleXY: [o.scale_x ?? 1, o.scale_y ?? 1],
      rotation: o.rotation,
      offset: o.offset,
      blur: o.blur,
    }),
  },
});
