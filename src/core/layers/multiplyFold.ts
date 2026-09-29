import type { LayerNode } from '../model/types';
import type { RGB, UniformValue } from '../schema/params';

/**
 * v3 behaviour for light-like layers: in Multiply mode the color acts as a
 * tint, so intensity is folded into the color (0 = white/no-op, 1 = color).
 */
export function foldColorIntensity(color: RGB, intensity: number, node: LayerNode): Record<string, UniformValue> {
  let c: number[] = color;
  let i = intensity;
  if (node.blendMode === 'multiply') {
    i = 1;
    if (intensity <= 1) c = color.map((v) => 1 - intensity + v * intensity);
    else if (intensity > 0) c = color.map((v) => v / intensity);
  }
  return { u_colorEff: { t: 'v3', v: c }, u_intensityEff: { t: 'f', v: i } };
}
