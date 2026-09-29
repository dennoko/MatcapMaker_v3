import type { RGB } from '$core/schema/params';

export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb([h, s, v]: [number, number, number]): RGB {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

export function rgbCss(c: RGB | number[]): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to(c[0])}, ${to(c[1])}, ${to(c[2])})`;
}

/** Linear interpolation used to preview gradients in CSS (matches shader 'rgb'). */
export function gradientCss(stops: { pos: number; color: RGB }[], dir = 'to right'): string {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  return `linear-gradient(${dir}, ${s.map((x) => `${rgbCss(x.color)} ${(x.pos * 100).toFixed(2)}%`).join(', ')})`;
}

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);

function toOklab(c: RGB): RGB {
  const [r, g, b] = c.map(srgbToLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, bb]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => Math.min(1, Math.max(0, linToSrgb(v)))) as RGB;
}

/** Samples a gradient value at t (same rules as the shader). */
export function sampleGradient(stops: { pos: number; color: RGB }[], interp: 'rgb' | 'oklab', t: number): RGB {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (!s.length) return [0, 0, 0];
  if (t <= s[0].pos) return [...s[0].color] as RGB;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (t <= b.pos) {
      const span = b.pos - a.pos;
      const k = span > 1e-4 ? (t - a.pos) / span : 0;
      if (interp === 'oklab') {
        const la = toOklab(a.color);
        const lb = toOklab(b.color);
        return fromOklab([0, 1, 2].map((j) => la[j] + (lb[j] - la[j]) * k) as RGB);
      }
      return [0, 1, 2].map((j) => a.color[j] + (b.color[j] - a.color[j]) * k) as RGB;
    }
  }
  return [...s[s.length - 1].color] as RGB;
}

/** CSS preview of a gradient with many samples (exact for OKLab too). */
export function gradientCssSampled(stops: { pos: number; color: RGB }[], interp: 'rgb' | 'oklab', dir = 'to right'): string {
  if (interp === 'rgb') return gradientCss(stops, dir);
  const parts: string[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    parts.push(`${rgbCss(sampleGradient(stops, interp, t))} ${(t * 100).toFixed(2)}%`);
  }
  return `linear-gradient(${dir}, ${parts.join(', ')})`;
}
