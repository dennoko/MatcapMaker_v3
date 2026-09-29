// `[u32 LE json length][json][blobs]` container shared with the Rust side.

export function pack(json: string, blobs: Uint8Array[]): Uint8Array {
  const j = new TextEncoder().encode(json);
  const total = blobs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(4 + j.length + total);
  new DataView(out.buffer).setUint32(0, j.length, true);
  out.set(j, 4);
  let o = 4 + j.length;
  for (const b of blobs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

export function unpack(data: Uint8Array): { json: string; rest: Uint8Array } {
  const n = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
  const json = new TextDecoder().decode(data.subarray(4, 4 + n));
  return { json, rest: data.subarray(4 + n) };
}
