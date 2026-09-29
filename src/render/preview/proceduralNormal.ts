import { mulberry32 } from '../pipeline/resources';

/**
 * Built-in tangent-space normal map (leather-like bumps) used when the user
 * has not chosen one. Tileable value-noise height field → normals.
 */
export function generateNormalMap(size = 512, seed = 7): Uint8Array {
  const rnd = mulberry32(seed);
  const grid = 32;
  const lattice = new Float32Array(grid * grid).map(() => rnd());
  const h = new Float32Array(size * size);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (x: number, y: number, freq: number) => {
    const fx = (x / size) * freq;
    const fy = (y / size) * freq;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const L = (i: number, j: number) => lattice[((j % freq) * grid + (i % freq)) % lattice.length];
    const a = L(x0, y0) + (L(x0 + 1, y0) - L(x0, y0)) * tx;
    const b = L(x0, y0 + 1) + (L(x0 + 1, y0 + 1) - L(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = sample(x, y, 16) * 0.6 + sample(x, y, 32) * 0.4;
      // cellular-looking creases
      h[y * size + x] = 1 - Math.abs(v * 2 - 1);
    }
  }
  const out = new Uint8Array(size * size * 4);
  const k = 2.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const H = (i: number, j: number) => h[((j + size) % size) * size + ((i + size) % size)];
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}
