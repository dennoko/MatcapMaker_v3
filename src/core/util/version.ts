/**
 * Version normalization and comparison logic.
 * Follows DennokoMeshEditor's SemVer comparison rules.
 */

/**
 * Normalizes a version string for comparison:
 * - Trims whitespace and BOM
 * - Strips leading 'v' / 'V'
 * - Strips prerelease / build suffixes ('-beta', '+build')
 * - Pads to 3 components (e.g. "3" -> "3.0.0", "3.1" -> "3.1.0")
 */
export function normalizeVersion(v: string | null | undefined): string {
  if (!v) return '0.0.0';
  let s = v.trim().replace(/^\uFEFF/, '').trim();
  if (s.startsWith('v') || s.startsWith('V')) {
    s = s.slice(1);
  }
  const cut = s.search(/[-+ ]/);
  if (cut >= 0) {
    s = s.slice(0, cut);
  }
  if (!s) return '0.0.0';

  const parts = s.split('.');
  const padded = [parts[0] || '0', parts[1] || '0', parts[2] || '0'];
  return padded.join('.');
}

/**
 * Parses version into numerical tuple [major, minor, patch].
 */
export function parseVersionTuple(v: string | null | undefined): [number, number, number] {
  const norm = normalizeVersion(v);
  const parts = norm.split('.').map((x) => parseInt(x, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Returns true if `latest` is strictly newer than `current`.
 */
export function isNewerVersion(latest: string | null | undefined, current: string | null | undefined): boolean {
  const a = parseVersionTuple(latest);
  const b = parseVersionTuple(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}
