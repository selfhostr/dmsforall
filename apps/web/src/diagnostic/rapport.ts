import { masquer } from './nettoyage';
import type { AppelEchoue, ErreurCollectee } from './tampon';
import type { ContexteDiagnostic } from './contexte';

/** Contrat figé avec la page publique du site (`/signaler#r=<base64url(JSON)>`). */
export const URL_SIGNALEMENT_PAR_DEFAUT = 'https://dmsforall.selfhostr.io/signaler';
export const URL_NOUVELLE_FICHE = 'https://github.com/selfhostr/dmsforall/issues/new';
export const LONGUEUR_MAX_URL = 16_000;

export const MAX_CONSTAT = 4000;
export const MAX_ETAPES = 4000;
export const MAX_ATTENDU = 2000;

export interface Diagnostic extends ContexteDiagnostic {
  readonly modules: readonly string[];
  readonly nbSites: number;
  readonly erreurs: readonly ErreurCollectee[];
  readonly appelsEchec: readonly AppelEchoue[];
}

export interface Signalement {
  readonly v: 1;
  readonly source: 'app';
  readonly constat: string;
  readonly etapes: string;
  readonly attendu: string;
  readonly diagnostic: Diagnostic | null;
}

export interface SaisieSignalement {
  readonly constat: string;
  readonly etapes: string;
  readonly attendu: string;
}

/** Textes de l'utilisateur nettoyés et bornés ; diagnostic joint tel quel (déjà nettoyé). */
export function construireSignalement(
  saisie: SaisieSignalement,
  diagnostic: Diagnostic | null,
): Signalement {
  return {
    v: 1,
    source: 'app',
    constat: masquer(saisie.constat.trim()).slice(0, MAX_CONSTAT),
    etapes: masquer(saisie.etapes.trim()).slice(0, MAX_ETAPES),
    attendu: masquer(saisie.attendu.trim()).slice(0, MAX_ATTENDU),
    diagnostic,
  };
}

/** base64url (sans remplissage) du JSON en UTF-8. */
export function encoderBase64Url(texte: string): string {
  const octets = new TextEncoder().encode(texte);
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) {
    binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  }
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decoderBase64Url(encode: string): string {
  const base64 = encode.replace(/-/g, '+').replace(/_/g, '/');
  const binaire = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binaire, (c) => c.charCodeAt(0)));
}

export function construireUrl(signalement: Signalement, base: string): string {
  return `${base}#r=${encoderBase64Url(JSON.stringify(signalement))}`;
}

function avecDiagnostic(s: Signalement, patch: Partial<Diagnostic>): Signalement {
  return s.diagnostic ? { ...s, diagnostic: { ...s.diagnostic, ...patch } } : s;
}

/**
 * Ramène l'URL sous `max` caractères : d'abord on raccourcit les piles (500 car., puis vides),
 * ensuite on retire les erreurs les plus anciennes, et en tout dernier recours le diagnostic.
 * Retourne le signalement RÉELLEMENT encodé (c'est lui que l'aperçu doit montrer).
 */
export function reduirePourUrl(
  signalement: Signalement,
  base: string,
  max: number = LONGUEUR_MAX_URL,
): { readonly signalement: Signalement; readonly url: string } {
  const essayer = (s: Signalement) => ({ signalement: s, url: construireUrl(s, base) });
  let courant = essayer(signalement);
  if (courant.url.length <= max || !signalement.diagnostic) return courant;

  for (const limite of [500, 0]) {
    const erreurs = signalement.diagnostic.erreurs.map((e) => ({
      ...e,
      pile: e.pile.slice(0, limite),
    }));
    courant = essayer(avecDiagnostic(signalement, { erreurs }));
    if (courant.url.length <= max) return courant;
  }
  let erreurs = courant.signalement.diagnostic?.erreurs ?? [];
  while (erreurs.length > 0) {
    erreurs = erreurs.slice(1);
    courant = essayer(avecDiagnostic(courant.signalement, { erreurs }));
    if (courant.url.length <= max) return courant;
  }
  return essayer({ ...courant.signalement, diagnostic: null });
}

export interface TitresRapport {
  readonly constat: string;
  readonly etapes: string;
  readonly attendu: string;
  readonly diagnostic: string;
  readonly aucun: string;
}

/** Rapport Markdown à coller dans une fiche GitHub (instances sans accès au site). */
export function rapportMarkdown(s: Signalement, titres: TitresRapport): string {
  const bloc = (titre: string, texte: string) =>
    `### ${titre}\n\n${texte.trim() || titres.aucun}\n`;
  const diag = s.diagnostic
    ? `\`\`\`json\n${JSON.stringify(s.diagnostic, null, 2)}\n\`\`\`\n`
    : `${titres.aucun}\n`;
  return [
    bloc(titres.constat, s.constat),
    bloc(titres.etapes, s.etapes),
    bloc(titres.attendu, s.attendu),
    `### ${titres.diagnostic}\n\n${diag}`,
  ].join('\n');
}
