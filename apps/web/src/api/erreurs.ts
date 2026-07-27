import type { TFunction } from 'i18next';

import { CODES_ERREUR, type CodeErreur, type ProblemeDetail } from '@dfa/shared';

/** Erreur applicative : le serveur a répondu, avec un corps `problem+json` exploitable (ou
 *  synthétisé si le corps réel était inexploitable, voir `synthetiserErreurInterne`). */
export class ErreurApi extends Error {
  readonly probleme: ProblemeDetail;
  /** Secondes avant nouvelle tentative autorisée, lues depuis l'en-tête `Retry-After` sur un
   *  429. `undefined` sinon. */
  readonly retryApresSecondes?: number;

  constructor(probleme: ProblemeDetail, retryApresSecondes?: number) {
    super(`ErreurApi(${probleme.code})`);
    this.name = 'ErreurApi';
    this.probleme = probleme;
    this.retryApresSecondes = retryApresSecondes;
  }
}

/** Le serveur n'a pas répondu du tout : réseau coupé, timeout (15s), DNS, etc. Se distingue
 *  volontairement de `ErreurApi` pour permettre un message et un style visuel différents. */
export class ErreurReseau extends Error {
  constructor(cause?: unknown) {
    super('ErreurReseau');
    this.name = 'ErreurReseau';
    this.cause = cause;
  }
}

function estCodeErreurConnu(valeur: unknown): valeur is CodeErreur {
  return typeof valeur === 'string' && (CODES_ERREUR as readonly string[]).includes(valeur);
}

function estProblemeValide(valeur: unknown): valeur is ProblemeDetail {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const candidat = valeur as Record<string, unknown>;
  return (
    estCodeErreurConnu(candidat.code) &&
    typeof candidat.status === 'number' &&
    typeof candidat.type === 'string' &&
    typeof candidat.title === 'string' &&
    typeof candidat.instance === 'string'
  );
}

/** Le front ne doit jamais planter sur une réponse d'erreur mal formée (ex. 502 HTML d'un
 *  reverse proxy) : on synthétise un ERREUR_INTERNE stable plutôt que de propager une erreur
 *  de parsing JSON. */
export function synthetiserErreurInterne(reponse: Response): ProblemeDetail {
  return {
    type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
    title: 'Erreur interne',
    status: reponse.status || 500,
    code: 'ERREUR_INTERNE',
    instance: reponse.headers.get('x-requete-id') ?? '',
  };
}

/** Construit une `ErreurApi` à partir d'une réponse HTTP non-ok : problem+json valide si le
 *  Content-Type et le corps le permettent, sinon ERREUR_INTERNE synthétisé. */
export function construireErreurApi(reponse: Response, corpsTexte: string): ErreurApi {
  const contentType = reponse.headers.get('content-type') ?? '';
  if (contentType.includes('application/problem+json') && corpsTexte.length > 0) {
    try {
      const candidat: unknown = JSON.parse(corpsTexte);
      if (estProblemeValide(candidat)) {
        return new ErreurApi(candidat, lireRetryApres(reponse));
      }
    } catch {
      // Corps annoncé problem+json mais illisible : on tombe dans la synthèse ci-dessous.
    }
  }
  return new ErreurApi(synthetiserErreurInterne(reponse), lireRetryApres(reponse));
}

function lireRetryApres(reponse: Response): number | undefined {
  const entete = reponse.headers.get('retry-after');
  if (!entete) return undefined;
  const secondes = Number.parseInt(entete, 10);
  return Number.isFinite(secondes) && secondes > 0 ? secondes : undefined;
}

/** Traduit une erreur pour affichage utilisateur. Le champ `detail` du serveur n'est JAMAIS
 *  affiché — seul le `code` (contrat machine stable) pilote le message, via
 *  `erreurs:codes.<CODE>`. */
export function messageErreur(erreur: unknown, t: TFunction): string {
  if (erreur instanceof ErreurReseau) {
    return t('erreurs:reseau.description');
  }
  if (erreur instanceof ErreurApi) {
    const minutes = erreur.retryApresSecondes ? Math.max(1, Math.ceil(erreur.retryApresSecondes / 60)) : 1;
    return t(`erreurs:codes.${erreur.probleme.code}`, { minutes });
  }
  return t('erreurs:inattendue.description');
}
