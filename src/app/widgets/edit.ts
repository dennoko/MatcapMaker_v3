/**
 * Edit phases emitted by widgets:
 * - begin/update/end: a continuous gesture (drag) → one undo step
 * - set: a discrete change (typed value, click, reset) → its own undo step
 */
export type Phase = 'begin' | 'update' | 'end' | 'set';
export type OnEdit<T> = (value: T, phase: Phase) => void;

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function decimalsFor(range: number, step?: number): number {
  if (step && step >= 1) return 0;
  if (range >= 100) return 1;
  if (range >= 10) return 2;
  return 3;
}

export function formatNum(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  return decimals > 0 ? s.replace(/\.?0+$/, '') || '0' : s;
}

/** Evaluates simple arithmetic typed into number fields ("0.5*2", "1/3"). */
export function evalNumber(text: string): number | null {
  const s = text.replace(/\s+/g, '').replace(/,/g, '.');
  let i = 0;
  const peek = () => s[i];
  const num = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error('nan');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number => {
    if (peek() === '-') {
      i++;
      return -factor();
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (s[i++] !== ')') throw new Error('paren');
      return v;
    }
    return num();
  };
  const term = (): number => {
    let v = factor();
    while (peek() === '*' || peek() === '/') v = s[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = s[i++] === '+' ? v + term() : v - term();
    return v;
  };
  try {
    const v = expr();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
