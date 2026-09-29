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

// --- binary glTF (.glb) ---------------------------------------------------------

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json: any, bin: DataView, index: number): Float64Array {
  const acc = json.accessors[index] as GltfAccessor;
  const view = json.bufferViews[acc.bufferView ?? 0];
  const comps = COMPONENTS[acc.type] ?? 1;
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType as 5126] ?? 4;
  const stride = view.byteStride ?? comps * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float64Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      const o = base + i * stride + c * size;
      let v: number;
      switch (acc.componentType) {
        case 5126:
          v = bin.getFloat32(o, true);
          break;
        case 5125:
          v = bin.getUint32(o, true);
          break;
        case 5123:
          v = bin.getUint16(o, true);
          break;
        case 5122:
          v = bin.getInt16(o, true);
          break;
        case 5121:
          v = bin.getUint8(o);
          break;
        default:
          v = bin.getInt8(o);
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

/** Minimal GLB reader: merges every triangle primitive (node transforms ignored). */
export function parseGlb(bytes: Uint8Array): MeshData | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) return null; // 'glTF'
  let o = 12;
  let json: any = null;
  let bin: DataView | null = null;
  while (o + 8 <= bytes.length) {
    const len = dv.getUint32(o, true);
    const type = dv.getUint32(o + 4, true);
    const chunk = bytes.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    o += 8 + len;
  }
  if (!json || !bin) return null;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let hasNormals = true;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      if (prim.attributes?.POSITION === undefined) continue;
      const base = positions.length / 3;
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      positions.push(...pos);
      if (prim.attributes.NORMAL !== undefined) normals.push(...readAccessor(json, bin, prim.attributes.NORMAL));
      else {
        hasNormals = false;
        normals.push(...new Array(pos.length).fill(0));
      }
      if (prim.indices !== undefined) for (const i of readAccessor(json, bin, prim.indices)) indices.push(base + i);
      else for (let i = 0; i < pos.length / 3; i++) indices.push(base + i);
    }
  }
  if (!indices.length) return null;
  const m: MeshData = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
  if (!hasNormals) computeNormals(m);
  normalizeBounds(m);
  return m;
}

/** File extensions accepted as preview meshes. */
export const MESH_EXTENSIONS = ['obj', 'glb', 'fbx'];
export const MESH_FILE = /\.(obj|glb|fbx)$/i;

export function meshMime(name: string): string {
  if (/\.glb$/i.test(name)) return 'model/gltf-binary';
  if (/\.fbx$/i.test(name)) return 'application/octet-stream';
  return 'model/obj';
}

/** Loads .obj (text), .glb (binary) or .fbx (binary / ASCII) by file name. */
export async function parseMesh(bytes: Uint8Array, name: string): Promise<MeshData | null> {
  if (/\.glb$/i.test(name)) return parseGlb(bytes);
  if (/\.fbx$/i.test(name)) return (await import('./fbx')).parseFbx(bytes);
  return parseObj(new TextDecoder().decode(bytes));
}
