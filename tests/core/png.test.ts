import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { encodePng } from '../../src/platform/pngEncode';

// Rust decodes this TS fixture and its own encoding of the same pixels in
// commands/image.rs. Keep the fixture deterministic so neither side can drift.
test('PNG16 matches the cross-language fixture (big-endian, straight alpha)', () => {
  const pixels = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
  const fixture = readFileSync(new URL('../fixtures/png16-ts.png', import.meta.url));
  expect(Buffer.from(encodePng(pixels, 2, 2, 16))).toEqual(fixture);
});
