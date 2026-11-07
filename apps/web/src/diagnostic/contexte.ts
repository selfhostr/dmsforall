import i18n from '@/i18n';
import { gabaritRoute } from './gabarit';

/** « Firefox 140 / Linux » depuis le user-agent. Valeurs inconnues -> « inconnu ». */
export function decrireNavigateur(ua: string): string {
  const motifs: readonly (readonly [string, RegExp])[] = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+)[^]*Safari/],
  ];
  let navigateur = 'inconnu';
  for (const [nom, motif] of motifs) {
    const m = motif.exec(ua);
    if (m) {
      navigateur = `${nom} ${m[1]}`;
      break;
    }
  }
  const systemes: readonly (readonly [string, RegExp])[] = [
    ['Android', /Android/],
    ['iOS', /iPhone|iPad|iPod/],
    ['Windows', /Windows/],
    ['macOS', /Mac OS X|Macintosh/],
    ['Linux', /Linux|X11/],
  ];
  const systeme = systemes.find(([, motif]) => motif.test(ua))?.[0] ?? 'inconnu';
  return `${navigateur} / ${systeme}`;
}

/** « 0.2.0 » : numéro de version du bundle (avant le premier « + » de `VITE_DFA_VERSION_INFO`). */
export function versionApplication(brut: unknown = import.meta.env.VITE_DFA_VERSION_INFO): string {
  const numero = typeof brut === 'string' ? (brut.split('+')[0]?.trim() ?? '') : '';
  return /^\d+\.\d+\.\d+/.test(numero) ? numero : 'inconnue';
}

export interface ContexteDiagnostic {
  readonly version: string;
  readonly navigateur: string;
  readonly ecran: string;
  readonly langue: string;
  readonly route: string;
}

export function lireContexte(): ContexteDiagnostic {
  return {
    version: versionApplication(),
    navigateur: decrireNavigateur(navigator.userAgent),
    ecran: `${window.innerWidth}x${window.innerHeight}`,
    langue: i18n.language,
    route: gabaritRoute(window.location.pathname),
  };
}
