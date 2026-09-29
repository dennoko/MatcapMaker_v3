export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Minimal Wavefront OBJ parser (v / vn / f, polygons fan-triangulated). */
export function parseObj(text: string): MeshData | null {
  const vs: number[][] = [];
  const vns: number[][] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cache = new Map<string, number>();
  let hasNormals = true;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) vs.push(line.split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('vn ')) vns.push(line.split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('f ')) {
      const verts = line.split(/\s+/).slice(1);
      const ids = verts.map((v) => {
        let id = cache.get(v);
        if (id !== undefined) return id;
        const [vi, , ni] = v.split('/');
        const p = vs[resolve(Number(vi), vs.length)] ?? [0, 0, 0];
        positions.push(p[0], p[1], p[2]);
        if (ni) {
          const n = vns[resolve(Number(ni), vns.length)] ?? [0, 0, 1];
          normals.push(n[0], n[1], n[2]);
        } else {
          hasNormals = false;
          normals.push(0, 0, 0);
        }
        id = positions.length / 3 - 1;
        cache.set(v, id);
        return id;
      });
      for (let i = 1; i + 1 < ids.length; i++) indices.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  if (!indices.length) return null;
  const mesh: MeshData = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
  if (!hasNormals) computeNormals(mesh);
  normalizeBounds(mesh);
  return mesh;
}

function resolve(i: number, len: number) {
  return i < 0 ? len + i : i - 1;
}

export function computeNormals(m: MeshData) {
  const n = new Float32Array(m.positions.length);
  const p = m.positions;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i] * 3;
    const b = m.indices[i + 1] * 3;
    const c = m.indices[i + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const fn = cross(e1, e2);
    for (const v of [a, b, c]) {
      n[v] += fn[0];
      n[v + 1] += fn[1];
      n[v + 2] += fn[2];
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  m.normals = n;
}

/** Centers the mesh and scales it into the unit sphere. */
export function normalizeBounds(m: MeshData) {
  const p = m.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  let r = 0;
  for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - c[0], p[i + 1] - c[1], p[i + 2] - c[2]));
  r = r || 1;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) p[i + k] = (p[i + k] - c[k]) / r;
}

/** Default preview mesh: a (2,3) torus knot tube. */
export function torusKnot(tubular = 256, radial = 24, p = 2, q = 3, tube = 0.28): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const curve = (u: number) => {
    const quOverP = (q / p) * u;
    const cs = Math.cos(quOverP);
    return [(2 + cs) * 0.5 * Math.cos(u), (2 + cs) * 0.5 * Math.sin(u), Math.sin(quOverP) * 0.5];
  };
  for (let i = 0; i <= tubular; i++) {
    const u = (i / tubular) * p * Math.PI * 2;
    const p1 = curve(u);
    const p2 = curve(u + 0.01);
    const T = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const N = [p2[0] + p1[0], p2[1] + p1[1], p2[2] + p1[2]];
    const B = cross(T, N);
    const Nn = normalize(cross(B, T));
    const Bn = normalize(B);
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const cx = -tube * Math.cos(v);
      const cy = tube * Math.sin(v);
      const px = p1[0] + cx * Nn[0] + cy * Bn[0];
      const py = p1[1] + cx * Nn[1] + cy * Bn[1];
      const pz = p1[2] + cx * Nn[2] + cy * Bn[2];
      positions.push(px, py, pz);
      normals.push(...normalize([px - p1[0], py - p1[1], pz - p1[2]]));
    }
  }
  for (let j = 1; j <= tubular; j++) {
    for (let i = 1; i <= radial; i++) {
      const a = (radial + 1) * (j - 1) + (i - 1);
      const b = (radial + 1) * j + (i - 1);
      const c = (radial + 1) * j + i;
      const d = (radial + 1) * (j - 1) + i;
      indices.push(a, b, d, b, c, d);
    }
  }
  const m: MeshData = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
  normalizeBounds(m);
  return m;
}

function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: number[]) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
