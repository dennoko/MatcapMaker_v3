import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { isBinaryFbx, parseAsciiFbx, parseBinaryFbx, parseFbx } from '../../src/render/preview/fbx';
import { parseMesh } from '../../src/render/preview/mesh';

// --- a tiny binary FBX writer (test fixture) ------------------------------------

type P =
  | { t: 'I'; v: number }
  | { t: 'D'; v: number }
  | { t: 'L'; v: bigint }
  | { t: 'S'; v: string }
  | { t: 'd' | 'i'; v: number[]; zip?: boolean };
interface N {
  name: string;
  props?: P[];
  children?: N[];
}

const I = (v: number): P => ({ t: 'I', v });
const D = (v: number): P => ({ t: 'D', v });
const L = (v: bigint): P => ({ t: 'L', v });
const S = (v: string): P => ({ t: 'S', v });
const dArr = (v: number[], zip = false): P => ({ t: 'd', v, zip });
const iArr = (v: number[], zip = false): P => ({ t: 'i', v, zip });

function propBytes(p: P): Buffer {
  switch (p.t) {
    case 'I': {
      const b = Buffer.alloc(5);
      b.write('I');
      b.writeInt32LE(p.v, 1);
      return b;
    }
    case 'D': {
      const b = Buffer.alloc(9);
      b.write('D');
      b.writeDoubleLE(p.v, 1);
      return b;
    }
    case 'L': {
      const b = Buffer.alloc(9);
      b.write('L');
      b.writeBigInt64LE(p.v, 1);
      return b;
    }
    case 'S': {
      const s = Buffer.from(p.v, 'utf8');
      const b = Buffer.alloc(5);
      b.write('S');
      b.writeUInt32LE(s.length, 1);
      return Buffer.concat([b, s]);
    }
    default: {
      const size = p.t === 'd' ? 8 : 4;
      let raw = Buffer.alloc(p.v.length * size);
      p.v.forEach((x, k) => (p.t === 'd' ? raw.writeDoubleLE(x, k * size) : raw.writeInt32LE(x, k * size)));
      if (p.zip) raw = deflateSync(raw);
      const h = Buffer.alloc(13);
      h.write(p.t);
      h.writeUInt32LE(p.v.length, 1);
      h.writeUInt32LE(p.zip ? 1 : 0, 5);
      h.writeUInt32LE(raw.length, 9);
      return Buffer.concat([h, raw]);
    }
  }
}

function writeBinaryFbx(nodes: N[], version: number): Uint8Array {
  const wide = version >= 7500;
  const word = wide ? 8 : 4;
  const nullRec = Buffer.alloc(word * 3 + 1);
  const header = Buffer.alloc(27);
  header.write('Kaydara FBX Binary  \0', 0, 'binary');
  header[21] = 0x1a;
  header.writeUInt32LE(version, 23);
  const parts: Buffer[] = [header];
  let offset = 27;
  const writeU = (b: Buffer, at: number, v: number) => (wide ? b.writeBigUInt64LE(BigInt(v), at) : b.writeUInt32LE(v, at));

  function node(n: N): void {
    const props = Buffer.concat((n.props ?? []).map(propBytes));
    const name = Buffer.from(n.name);
    const head = Buffer.alloc(word * 3 + 1 + name.length);
    const start = parts.length;
    parts.push(head);
    offset += head.length;
    parts.push(props);
    offset += props.length;
    if (n.children?.length) {
      for (const c of n.children) node(c);
      parts.push(nullRec);
      offset += nullRec.length;
    }
    writeU(head, 0, offset);
    writeU(head, word, n.props?.length ?? 0);
    writeU(head, word * 2, props.length);
    head[word * 3] = name.length;
    name.copy(head, word * 3 + 1);
    void start;
  }
  for (const n of nodes) node(n);
  parts.push(nullRec, Buffer.alloc(160));
  return new Uint8Array(Buffer.concat(parts));
}

// a unit quad in the XY plane facing +Z, as one 4-gon
const QUAD_V = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
const QUAD_P = [0, 1, 2, ~3];
const QUAD_N = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];

function p70(entries: [string, number[]][]): N {
  return {
    name: 'Properties70',
    children: entries.map(([k, v]) => ({ name: 'P', props: [S(k), S(k), S(''), S('A'), ...v.map(D)] })),
  };
}

function scene(opts: { zip?: boolean; rotation?: number[]; upAxis?: number } = {}): N[] {
  return [
    { name: 'FBXHeaderExtension', children: [{ name: 'FBXVersion', props: [I(7400)] }] },
    ...(opts.upAxis !== undefined
      ? [{ name: 'GlobalSettings', children: [p70([['UpAxis', [opts.upAxis]], ['FrontAxis', [1]], ['FrontAxisSign', [-1]], ['CoordAxis', [0]]])] }]
      : []),
    {
      name: 'Objects',
      children: [
        {
          name: 'Geometry',
          props: [L(100n), S('Quad\0\u0001Geometry'), S('Mesh')],
          children: [
            { name: 'Vertices', props: [dArr(QUAD_V, opts.zip)] },
            { name: 'PolygonVertexIndex', props: [iArr(QUAD_P, opts.zip)] },
            {
              name: 'LayerElementNormal',
              props: [I(0)],
              children: [
                { name: 'MappingInformationType', props: [S('ByPolygonVertex')] },
                { name: 'ReferenceInformationType', props: [S('Direct')] },
                { name: 'Normals', props: [dArr(QUAD_N, opts.zip)] },
              ],
            },
          ],
        },
        {
          name: 'Model',
          props: [L(200n), S('Quad\0\u0001Model'), S('Mesh')],
          children: [p70(opts.rotation ? [['Lcl Rotation', opts.rotation]] : [])],
        },
      ],
    },
    {
      name: 'Connections',
      children: [
        { name: 'C', props: [S('OO'), L(100n), L(200n)] },
        { name: 'C', props: [S('OO'), L(200n), L(0n)] },
      ],
    },
  ];
}

const normalOf = (n: Float32Array, i: number) => [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]].map((x) => Math.round(x * 1000) / 1000 + 0);

describe('FBX (binary)', () => {
  it('reads 7.4 with 32-bit offsets and triangulates polygons', async () => {
    const bytes = writeBinaryFbx(scene(), 7400);
    expect(isBinaryFbx(bytes)).toBe(true);
    const mesh = await parseFbx(bytes);
    expect(mesh).not.toBeNull();
    expect(mesh!.indices.length).toBe(6);
    expect(mesh!.positions.length).toBe(12);
    expect(normalOf(mesh!.normals, 0)).toEqual([0, 0, 1]);
  });

  it('reads 7.5 (64-bit offsets) with zlib-compressed arrays', async () => {
    const bytes = writeBinaryFbx(scene({ zip: true }), 7500);
    const root = await parseBinaryFbx(bytes);
    expect(root.map((n) => n.name)).toEqual(['FBXHeaderExtension', 'Objects', 'Connections']);
    const mesh = await parseFbx(bytes);
    expect(mesh!.indices.length).toBe(6);
  });

  it('applies the model transform (Lcl Rotation)', async () => {
    const mesh = await parseFbx(writeBinaryFbx(scene({ rotation: [90, 0, 0] }), 7400));
    expect(normalOf(mesh!.normals, 0)).toEqual([0, -1, 0]);
  });

  it('converts Z-up files to Y-up', async () => {
    const mesh = await parseFbx(writeBinaryFbx(scene({ upAxis: 2 }), 7400));
    // file +Z (up) → +Y
    expect(normalOf(mesh!.normals, 0)).toEqual([0, 1, 0]);
  });

  it('goes through parseMesh by extension', async () => {
    const mesh = await parseMesh(writeBinaryFbx(scene(), 7400), 'model.FBX');
    expect(mesh?.indices.length).toBe(6);
  });
});

const ASCII_74 = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXVersion: 7400
}
Objects:  {
	Geometry: 2035615390896, "Geometry::Quad", "Mesh" {
		Vertices: *12 {
			a: -1,-1,0,1,-1,0,1,1,0,-1,1,0
		}
		PolygonVertexIndex: *4 {
			a: 0,1,2,-4
		}
		LayerElementNormal: 0 {
			MappingInformationType: "ByVertice"
			ReferenceInformationType: "Direct"
			Normals: *12 {
				a: 0,0,1,0,0,1,0,0,1,0,0,1
			}
		}
	}
	Model: 9007199254740993, "Model::Quad", "Mesh" {
		Properties70:  {
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,90,0
		}
	}
}
Connections:  {
	C: "OO",2035615390896,9007199254740993
	C: "OO",9007199254740993,0
}
`;

const ASCII_61 = `; FBX 6.1.0 project file
Objects:  {
	Model: "Model::Tri", "Mesh" {
		Properties60:  {
			Property: "Lcl Translation", "Lcl Translation", "A+",5,0,0
		}
		Vertices: 0,0,0,1,0,0,
		 0,1,0
		PolygonVertexIndex: 0,1,-3
	}
}
`;

describe('FBX (ASCII)', () => {
  it('parses 7.4 ASCII arrays, strings and large ids', async () => {
    const root = parseAsciiFbx(ASCII_74);
    expect(root.map((n) => n.name)).toEqual(['FBXHeaderExtension', 'Objects', 'Connections']);
    const model = root[1].children[1];
    expect(model.props[0]).toBe('9007199254740993'); // beyond 2^53: kept exact
    const mesh = await parseFbx(new TextEncoder().encode(ASCII_74));
    expect(mesh!.indices.length).toBe(6);
    // rotated 90° about Y: +Z → +X
    expect(normalOf(mesh!.normals, 0)).toEqual([1, 0, 0]);
  });

  it('parses legacy 6.1 ASCII (geometry inside Model, plain comma lists)', async () => {
    const mesh = await parseFbx(new TextEncoder().encode(ASCII_61));
    expect(mesh!.indices.length).toBe(3);
    // no normals in the file: computed from the triangle (+Z)
    expect(normalOf(mesh!.normals, 0)).toEqual([0, 0, 1]);
  });

  it('returns null for files without geometry', async () => {
    expect(await parseFbx(new TextEncoder().encode('Objects:  {\n}\n'))).toBeNull();
  });
});
