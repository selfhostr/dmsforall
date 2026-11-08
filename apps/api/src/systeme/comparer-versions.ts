/** Comparaison semver 2.0 (précédence) : `v` initial toléré, métadonnée de build ignorée. */

interface VersionAnalysee {
  readonly noyau: readonly [number, number, number];
  readonly pre: readonly string[];
}

const MOTIF = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function analyserVersion(brut: string): VersionAnalysee | null {
  const m = MOTIF.exec(brut.trim());
  if (m === null) return null;
  return {
    noyau: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] === undefined ? [] : m[4].split('.'),
  };
}

/** Version sans `v` initial ni métadonnée de build, `null` si ce n'est pas du semver. */
export function normaliserVersion(brut: string): string | null {
  const v = analyserVersion(brut);
  if (v === null) return null;
  const base = v.noyau.join('.');
  return v.pre.length > 0 ? `${base}-${v.pre.join('.')}` : base;
}

function comparerIdentifiants(a: string, b: string): number {
  const numA = /^\d+$/.test(a);
  const numB = /^\d+$/.test(b);
  if (numA && numB) return Math.sign(Number(a) - Number(b));
  if (numA) return -1;
  if (numB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Négatif si a < b, 0 si égales, positif si a > b ; `null` si l'une n'est pas du semver. */
export function comparerVersions(a: string, b: string): number | null {
  const va = analyserVersion(a);
  const vb = analyserVersion(b);
  if (va === null || vb === null) return null;
  for (let i = 0; i < 3; i += 1) {
    const diff = (va.noyau[i] ?? 0) - (vb.noyau[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (va.pre.length === 0 && vb.pre.length === 0) return 0;
  if (va.pre.length === 0) return 1;
  if (vb.pre.length === 0) return -1;
  const n = Math.max(va.pre.length, vb.pre.length);
  for (let i = 0; i < n; i += 1) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const c = comparerIdentifiants(x, y);
    if (c !== 0) return c;
  }
  return 0;
}
