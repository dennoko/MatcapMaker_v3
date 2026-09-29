import { defineLayer } from './defineLayer';
import { p } from '../schema/params';
import glsl from './solidColor.glsl?raw';

export default defineLayer({
  type: 'solidColor',
  title: 'Solid Color',
  version: 1,
  kind: 'generator',
  category: 'base',
  icon: '■',
  defaults: { blendMode: 'normal' },
  params: {
    color: p.color({ default: '#000000' }),
  },
  shader: glsl,
  legacy: {
    type: 'BaseLayer',
    params: (o) => ({ color: o.base_color }),
  },
});
