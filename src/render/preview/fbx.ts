// Minimal FBX reader for the preview mesh: binary (6.x–7.x, incl. 64-bit offsets) and ASCII.
// Reads every Geometry "Mesh" (Vertices / PolygonVertexIndex / LayerElementNormal),
// applies each Model's local transform chain (Lcl Translation / Rotation / Scaling)
// and the file's axis settings, and merges everything into one triangle mesh.
import { computeNormals, normalizeBounds, type MeshData } from './mesh';

type Prop = number | bigint | string | boolean | ArrayLike<number> | Uint8Array;

export interface FbxNode {
  name: string;
  props: Prop[];
  children: FbxNode[];
}

const BINARY_MAGIC = 'Kaydara FBX Binary  \0';

export function isBinaryFbx(bytes: Uint8Array): boolean {
  if (bytes.length < 27) return false;
  for (let i = 0; i < BINARY_MAGIC.length; i++) if (bytes[i] !== BINARY_MAGIC.charCodeAt(i)) return false;
  return true;
}

// --- binary -------------------------------------------------------------------

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseBinaryFbx(bytes: Uint8Array): Promise<FbxNode[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // byte 22 is 1 for (rare) big-endian files, e.g. old FBX 6.0 exporters
  const le = bytes[22] === 0;
  const version = dv.getUint32(23, le);
  const wide = version >= 7500;
  const dec = new TextDecoder();
  let o = 27;

  const u = (): number => {
    if (wide) {
      const v = Number(dv.getBigUint64(o, le));
      o += 8;
      return v;
    }
    const v = dv.getUint32(o, le);
    o += 4;
    return v;
  };

  async function readArray(type: string): Promise<ArrayLike<number>> {
    const len = dv.getUint32(o, le);
    const encoding = dv.getUint32(o + 4, le);
    const size = dv.getUint32(o + 8, le);
    o += 12;
    let raw = bytes.subarray(o, o + size);
    o += size;
    if (encoding === 1) raw = await inflate(raw);
    // copy so the typed array is aligned (and in host = little-endian byte order)
    const copy = raw.slice();
    if (!le) {
      const w = type === 'd' || type === 'l' ? 8 : type === 'b' ? 1 : 4;
      for (let k = 0; k + w <= copy.length; k += w) copy.subarray(k, k + w).reverse();
    }
    const buf = copy.buffer;
    switch (type) {
      case 'f':
        return new Float32Array(buf, 0, len);
      case 'd':
        return new Float64Array(buf, 0, len);
      case 'i':
        return new Int32Array(buf, 0, len);
      case 'l': {
        const b = new BigInt64Array(buf, 0, len);
        return Float64Array.from(b, (x) => Number(x));
      }
      default:
        return new Uint8Array(buf, 0, len);
    }
  }

  async function readProp(): Promise<Prop> {
    const t = String.fromCharCode(bytes[o++]);
    let v: Prop;
    switch (t) {
      case 'Y':
        v = dv.getInt16(o, le);
        o += 2;
        return v;
      case 'C':
        return bytes[o++] !== 0;
      case 'I':
        v = dv.getInt32(o, le);
        o += 4;
        return v;
      case 'F':
        v = dv.getFloat32(o, le);
        o += 4;
        return v;
      case 'D':
        v = dv.getFloat64(o, le);
        o += 8;
        return v;
      case 'L':
        v = dv.getBigInt64(o, le);
        o += 8;
        return v;
      case 'S':
      case 'R': {
        const len = dv.getUint32(o, le);
        o += 4;
        const data = bytes.subarray(o, o + len);
        o += len;
        // binary strings store "Name\0\1Class": keep the name part
        return t === 'S' ? dec.decode(data).split('\0\u0001')[0] : data;
      }
      case 'f':
      case 'd':
      case 'i':
      case 'l':
      case 'b':
        return readArray(t);
      default:
        throw new Error(`FBX: unknown property type '${t}'`);
    }
  }

  async function readNode(): Promise<FbxNode | null> {
    const end = u();
    const count = u();
    u(); // property list length
    const nameLen = bytes[o++];
    if (end === 0) return null; // null record
    const name = dec.decode(bytes.subarray(o, o + nameLen));
    o += nameLen;
    const props: Prop[] = [];
    for (let i = 0; i < count; i++) props.push(await readProp());
    const children: FbxNode[] = [];
    while (o < end) {
      const c = await readNode();
      if (!c) break;
      children.push(c);
    }
    o = end;
    return { name, props, children };
  }

  const nodes: FbxNode[] = [];
  const nullLen = wide ? 25 : 13;
  while (o + nullLen <= bytes.length) {
    const n = await readNode();
    if (!n) break;
    nodes.push(n);
  }
  return nodes;
}

// --- ASCII --------------------------------------------------------------------

export function parseAsciiFbx(text: string): FbxNode[] {
  let i = 0;
  const n = text.length;

  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === ';') {
        while (i < n && text[i] !== '\n') i++;
      } else return;
    }
  };

  const ident = (): string => {
    const s = i;
    while (i < n && /[A-Za-z0-9_|\-.]/.test(text[i])) i++;
    return text.slice(s, i);
  };

  function value(): Prop {
    skip();
    const c = text[i];
    if (c === '"') {
      const e = text.indexOf('"', i + 1);
      const s = text.slice(i + 1, e < 0 ? n : e);
      i = e < 0 ? n : e + 1;
      return s.split('::').pop() ?? s;
    }
    if (c === '*') {
      // *N { a: 1,2,3 }
      i++;
      ident();
      skip();
      if (text[i] !== '{') return [];
      const close = text.indexOf('}', i);
      const body = text.slice(i + 1, close < 0 ? n : close);
      i = close < 0 ? n : close + 1;
      const colon = body.indexOf(':');
      const nums = body.slice(colon + 1).split(',');
      const out = new Float64Array(nums.length);
      let k = 0;
      for (const s of nums) {
        const t = s.trim();
        if (t) out[k++] = Number(t);
      }
      return out.subarray(0, k);
    }
    const s = i;
    while (i < n && !/[,\s{}]/.test(text[i])) i++;
    const tok = text.slice(s, i);
    const num = Number(tok);
    if (tok === '' || Number.isNaN(num)) return tok;
    // object ids can exceed 2^53: keep them as exact strings (binary ids are bigint → same text)
    return /^-?\d+$/.test(tok) && !Number.isSafeInteger(num) ? tok : num;
  }

  function nodeList(closing: boolean): FbxNode[] {
    const out: FbxNode[] = [];
    for (;;) {
      skip();
      if (i >= n) return out;
      if (text[i] === '}') {
        if (closing) i++;
        return out;
      }
      const name = ident();
      skip();
      if (!name || text[i] !== ':') {
        // unexpected token: skip the line
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      i++;
      const props: Prop[] = [];
      let children: FbxNode[] = [];
      for (;;) {
        // stop at end of line (properties never span lines except inside *N {...})
        while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r')) i++;
        if (i >= n || text[i] === '\n') break;
        if (text[i] === '{') {
          i++;
          children = nodeList(true);
          break;
        }
        if (text[i] === '}') break;
        if (text[i] === ',') {
          i++;
          // trailing comma: the value continues on the next line
          skip();
          continue;
        }
        props.push(value());
      }
      out.push({ name, props, children });
    }
  }

  return nodeList(false);
}

// --- scene → mesh --------------------------------------------------------------

type Mat = Float64Array; // 4x4 column-major

const ident4 = (): Mat => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

function mul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

function rotAxis(axis: 0 | 1 | 2, deg: number): Mat {
  const m = ident4();
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const [a, b] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  m[a * 4 + a] = c;
  m[a * 4 + b] = s;
  m[b * 4 + a] = -s;
  m[b * 4 + b] = c;
  return m;
}

/** Euler rotation in FBX order (eEulerXYZ = 0 … eEulerZYX = 5): XYZ means X applied first. */
function euler(v: number[], order: number): Mat {
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 2, 0],
    [1, 0, 2],
    [2, 0, 1],
    [2, 1, 0],
  ][order] ?? [0, 1, 2];
  let m = ident4();
  for (const ax of orders) m = mul(rotAxis(ax as 0 | 1 | 2, v[ax]), m);
  return m;
}

function translate(v: number[]): Mat {
  const m = ident4();
  m[12] = v[0];
  m[13] = v[1];
  m[14] = v[2];
  return m;
}

function scale(v: number[]): Mat {
  const m = ident4();
  m[0] = v[0];
  m[5] = v[1];
  m[10] = v[2];
  return m;
}

const child = (n: FbxNode | undefined, name: string) => n?.children.find((c) => c.name === name);
/** Array values: `*N { a: … }` / binary arrays, or (legacy ASCII 6.x) a plain comma list of numbers. */
function nums(n: FbxNode | undefined): ArrayLike<number> {
  const p = n?.props[0];
  if (p && typeof p === 'object') return p as ArrayLike<number>;
  return (n?.props ?? []).filter((x): x is number => typeof x === 'number');
}
const idOf = (p: Prop | undefined) => String(p);

/** Properties70 / Properties60 → { name: numbers[] } */
function properties(n: FbxNode | undefined): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const block = child(n, 'Properties70') ?? child(n, 'Properties60');
  for (const p of block?.children ?? []) {
    const key = String(p.props[0]);
    const skip = p.name === 'P' ? 4 : 3;
    out.set(key, p.props.slice(skip).map((x) => Number(x)));
  }
  return out;
}

function localMatrix(model: FbxNode): Mat {
  const p = properties(model);
  const get = (k: string, d: number[]) => p.get(k) ?? d;
  const order = get('RotationOrder', [0])[0] | 0;
  const T = translate(get('Lcl Translation', [0, 0, 0]));
  const R = euler(get('Lcl Rotation', [0, 0, 0]), order);
  const pre = euler(get('PreRotation', [0, 0, 0]), 0);
  const S = scale(get('Lcl Scaling', [1, 1, 1]));
  const rotPivot = get('RotationPivot', [0, 0, 0]);
  const rotOffset = get('RotationOffset', [0, 0, 0]);
  const scalePivot = get('ScalingPivot', [0, 0, 0]);
  const scaleOffset = get('ScalingOffset', [0, 0, 0]);
  const neg = (v: number[]) => v.map((x) => -x);
  // T * Roff * Rp * Rpre * R * Rpost^-1 * Rp^-1 * Soff * Sp * S * Sp^-1
  // (inverse of an XYZ rotation = the negated angles applied in ZYX order)
  const postInv = euler(neg(get('PostRotation', [0, 0, 0])), 5);
  let m = T;
  for (const x of [translate(rotOffset), translate(rotPivot), pre, R, postInv, translate(neg(rotPivot)), translate(scaleOffset), translate(scalePivot), S, translate(neg(scalePivot))])
    m = mul(m, x);
  return m;
}

function geometricMatrix(model: FbxNode): Mat {
  const p = properties(model);
  const t = p.get('GeometricTranslation');
  const r = p.get('GeometricRotation');
  const s = p.get('GeometricScaling');
  let m = ident4();
  if (t) m = mul(m, translate(t));
  if (r) m = mul(m, euler(r, 0));
  if (s) m = mul(m, scale(s));
  return m;
}

/** Converts the file's axis system to Y-up / Z-front (right-handed). */
function axisMatrix(root: FbxNode[]): Mat {
  const gs = properties(root.find((n) => n.name === 'GlobalSettings'));
  const up = gs.get('UpAxis')?.[0] ?? 1;
  const upSign = gs.get('UpAxisSign')?.[0] ?? 1;
  const front = gs.get('FrontAxis')?.[0] ?? 2;
  const frontSign = gs.get('FrontAxisSign')?.[0] ?? 1;
  const coord = gs.get('CoordAxis')?.[0] ?? 0;
  const coordSign = gs.get('CoordAxisSign')?.[0] ?? 1;
  if (up === 1 && upSign === 1 && front === 2 && frontSign === 1 && coord === 0 && coordSign === 1) return ident4();
  // rows: where file X/Y/Z end up. Target: coord→X, up→Y, front→Z
  const m = new Float64Array(16);
  m[15] = 1;
  m[coord * 4 + 0] = coordSign;
  m[up * 4 + 1] = upSign;
  m[front * 4 + 2] = frontSign;
  return m;
}

function transformPoint(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

function transformDir(m: Mat, x: number, y: number, z: number): [number, number, number] {
  // normal matrix ≈ inverse-transpose; for the preview, the adjugate of the 3x3 is enough
  const a = m;
  const n: number[] = [
    a[5] * a[10] - a[6] * a[9],
    a[6] * a[8] - a[4] * a[10],
    a[4] * a[9] - a[5] * a[8],
    a[9] * a[2] - a[10] * a[1],
    a[10] * a[0] - a[8] * a[2],
    a[8] * a[1] - a[9] * a[0],
    a[1] * a[6] - a[2] * a[5],
    a[2] * a[4] - a[0] * a[6],
    a[0] * a[5] - a[1] * a[4],
  ];
  const det = a[0] * n[0] + a[1] * n[1] + a[2] * n[2]; // expansion along column 0
  const s = det < 0 ? -1 : 1;
  const rx = (n[0] * x + n[3] * y + n[6] * z) * s;
  const ry = (n[1] * x + n[4] * y + n[7] * z) * s;
  const rz = (n[2] * x + n[5] * y + n[8] * z) * s;
  const l = Math.hypot(rx, ry, rz) || 1;
  return [rx / l, ry / l, rz / l];
}

interface GeometryOut {
  positions: number[];
  normals: number[];
  indices: number[];
  hasNormals: boolean;
}

function readGeometry(geo: FbxNode, world: Mat, out: GeometryOut) {
  const verts = nums(child(geo, 'Vertices'));
  const poly = nums(child(geo, 'PolygonVertexIndex'));
  if (!verts.length || !poly.length) return;
  const flip = (() => {
    const a = world;
    const det = a[0] * (a[5] * a[10] - a[6] * a[9]) - a[4] * (a[1] * a[10] - a[2] * a[9]) + a[8] * (a[1] * a[6] - a[2] * a[5]);
    return det < 0;
  })();

  const ln = child(geo, 'LayerElementNormal');
  const normalData = nums(child(ln, 'Normals'));
  const normalIndex = nums(child(ln, 'NormalsIndex') ?? child(ln, 'NormalIndex'));
  const mapping = String(child(ln, 'MappingInformationType')?.props[0] ?? '');
  const reference = String(child(ln, 'ReferenceInformationType')?.props[0] ?? 'Direct');
  const useNormals = normalData.length > 0;
  if (!useNormals) out.hasNormals = false;

  const normalAt = (pvIndex: number, cp: number, polyIndex: number): [number, number, number] => {
    let k: number;
    if (mapping === 'ByPolygonVertex') k = pvIndex;
    else if (mapping === 'ByPolygon') k = polyIndex;
    else k = cp; // ByVertice / ByVertex / ByControlPoint
    if (reference === 'IndexToDirect' || reference === 'Index') k = normalIndex[k] ?? k;
    return [normalData[k * 3] ?? 0, normalData[k * 3 + 1] ?? 0, normalData[k * 3 + 2] ?? 1];
  };

  let polygon: number[] = [];
  let polyIndex = 0;
  for (let pv = 0; pv < poly.length; pv++) {
    let cp = poly[pv];
    const last = cp < 0;
    if (last) cp = ~cp;
    const [x, y, z] = transformPoint(world, verts[cp * 3], verts[cp * 3 + 1], verts[cp * 3 + 2]);
    out.positions.push(x, y, z);
    if (useNormals) out.normals.push(...transformDir(world, ...normalAt(pv, cp, polyIndex)));
    else out.normals.push(0, 0, 0);
    polygon.push(out.positions.length / 3 - 1);
    if (last) {
      for (let i = 1; i + 1 < polygon.length; i++) {
        if (flip) out.indices.push(polygon[0], polygon[i + 1], polygon[i]);
        else out.indices.push(polygon[0], polygon[i], polygon[i + 1]);
      }
      polygon = [];
      polyIndex++;
    }
  }
}

export function fbxToMesh(root: FbxNode[]): MeshData | null {
  const objects = root.find((n) => n.name === 'Objects');
  if (!objects) return null;
  const out: GeometryOut = { positions: [], normals: [], indices: [], hasNormals: true };
  const axis = axisMatrix(root);

  // 7.x: separate Geometry + Model objects linked by Connections
  const geometries = objects.children.filter((n) => n.name === 'Geometry' && (n.props[2] === 'Mesh' || (n.props[2] === undefined && !!child(n, 'Vertices'))));
  if (geometries.length) {
    const models = new Map<string, FbxNode>();
    for (const n of objects.children) if (n.name === 'Model') models.set(idOf(n.props[0]), n);
    const parentOf = new Map<string, string>();
    for (const c of root.find((n) => n.name === 'Connections')?.children ?? []) {
      if (c.name !== 'C' || c.props[0] !== 'OO') continue;
      const from = idOf(c.props[1]);
      if (!parentOf.has(from)) parentOf.set(from, idOf(c.props[2]));
    }
    const worldOf = (id: string, depth = 0): Mat => {
      const m = models.get(id);
      if (!m || depth > 64) return ident4();
      const parent = parentOf.get(id);
      const local = localMatrix(m);
      return parent && models.has(parent) ? mul(worldOf(parent, depth + 1), local) : local;
    };
    for (const g of geometries) {
      const modelId = parentOf.get(idOf(g.props[0]));
      const model = modelId ? models.get(modelId) : undefined;
      const world = model ? mul(axis, mul(worldOf(modelId!), geometricMatrix(model))) : axis;
      readGeometry(g, world, out);
    }
  } else {
    // 6.x: geometry lives directly in Model: "…", "Mesh" nodes
    for (const m of objects.children) {
      if (m.name !== 'Model' || !child(m, 'Vertices')) continue;
      readGeometry(m, mul(axis, localMatrix(m)), out);
    }
  }

  if (!out.indices.length) return null;
  const mesh: MeshData = {
    positions: new Float32Array(out.positions),
    normals: new Float32Array(out.normals),
    indices: new Uint32Array(out.indices),
  };
  if (!out.hasNormals) computeNormals(mesh);
  normalizeBounds(mesh);
  return mesh;
}

export async function parseFbx(bytes: Uint8Array): Promise<MeshData | null> {
  const root = isBinaryFbx(bytes) ? await parseBinaryFbx(bytes) : parseAsciiFbx(new TextDecoder().decode(bytes));
  return fbxToMesh(root);
}
