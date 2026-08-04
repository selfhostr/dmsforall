import type { TFunction } from 'i18next';

import {
  CODES_ERREUR,
  type ActionProposee,
  type CodeConfirmation,
  type CodeErreur,
  type ElementBloquant,
  type ErreurChamp,
  type ProblemeDetail,
} from '@dfa/shared';

/** Erreur applicative : le serveur a répondu, avec un corps `problem+json` exploitable (ou
 *  synthétisé si le corps réel était inexploitable, voir `synthetiserErreurInterne`).
 *
 *  `blocages`, `confirmationsRequises` et `actionsProposees` sont exposés en accesseurs à côté de
 *  `probleme` (qui reste la source de vérité complète) : c'est l'invariant produit n°8 — « aucun
 *  refus sans chemin de sortie » — rendu directement consommable par l'UI, sans que chaque
 *  composant `RefusBloquant` ne réécrive `erreur.probleme.blocages ?? []`. Rien n'est perdu entre
 *  `construireErreurApi` (qui reconstruit `probleme` en préservant tous ses champs, y compris
 *  ceux-ci) et ces accesseurs : ils lisent `probleme`, ils ne le dupliquent pas. */
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

  /** Ce qui bloque, nommément (§3.2 du contrat) — toujours un tableau, jamais `undefined`, même
   *  quand le serveur n'a rien envoyé (ex. `ERREUR_INTERNE` synthétisé) : simplifie
   *  `erreur.blocages.map(...)` côté écran sans garde répétée. */
  get blocages(): readonly ElementBloquant[] {
    return this.probleme.blocages ?? [];
  }

  /** Codes à renvoyer dans `confirmations[]` du corps pour rejouer la requête (§4.4). Vide en
   *  dehors d'un `409 CONFIRMATION_REQUISE`. */
  get confirmationsRequises(): readonly CodeConfirmation[] {
    return this.probleme.confirmationsRequises ?? [];
  }

  /** Le chemin de sortie proposé (§3.3). Vide uniquement quand aucune sortie n'existe (état
   *  terminal) — un refus avec un tableau vide ici, hors état terminal, est un défaut serveur à
   *  corriger côté API, pas à compenser côté écran. */
  get actionsProposees(): readonly ActionProposee[] {
    return this.probleme.actionsProposees ?? [];
  }

  /** Erreurs de saisie par champ (`ProblemeDetail.erreurs`, §3.5 règle 5) — RÉSERVÉ à la
   *  validation de saisie, jamais à un refus métier (qui va dans `blocages`). Même contrat que
   *  `blocages`/`actionsProposees` ci-dessus : toujours un tableau, jamais `undefined`. Sert à
   *  afficher un message SOUS le champ fautif plutôt que de le laisser mourir dans un bandeau
   *  générique — voir `messageErreurChamp` plus bas. */
  get erreursChamp(): readonly ErreurChamp[] {
    return this.probleme.erreurs ?? [];
  }

  /** Raccourci pour trouver l'erreur portant sur un `champ` précis (chemin pointé, ex.
   *  `adressePrincipale.rue`) — évite de répéter `erreur.erreursChamp.find(...)` dans chaque
   *  écran de formulaire. */
  champErreur(champ: string): ErreurChamp | undefined {
    return this.erreursChamp.find((erreurChamp) => erreurChamp.champ === champ);
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

/** Forme d'un problem+json, INDÉPENDAMMENT de savoir si `code` est un `CodeErreur` connu du
 *  front. Distinguée de la vérification du `code` (`estCodeErreurConnu`) pour séparer deux modes
 *  de panne bien différents : un corps qui ne respecte pas RFC 9457 (proxy, 502 HTML…) contre un
 *  corps parfaitement formé dont seul le `code` échappe à `CODES_ERREUR` — voir
 *  `construireErreurApi`, qui journalise ce second cas au lieu de le laisser silencieux. */
function estFormeProblemeValide(
  valeur: unknown,
): valeur is Omit<ProblemeDetail, 'code'> & { readonly code: string } {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const candidat = valeur as Record<string, unknown>;
  return (
    typeof candidat.code === 'string' &&
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
 *  Content-Type et le corps le permettent, sinon ERREUR_INTERNE synthétisé.
 *
 *  STRATÉGIE DE REPLI SUR CODE INCONNU — délibérément conservée, argumentée ici plutôt que
 *  changée en silence. Un `code` absent de `CODES_ERREUR` est un cas *normal* de production : le
 *  front est un artefact déployé séparément du serveur, et un décalage d'une version (front en
 *  retard sur une API qui vient d'apprendre un nouveau refus métier, ou l'inverse pendant un
 *  déploiement progressif) arrivera. Trois options existaient :
 *   1. Propager le `code` inconnu tel quel jusqu'à l'UI. Rejeté : rien ne garantit qu'une clé
 *      `erreurs:codes.<CODE>` existe pour ce code, donc rien ne garantit qu'i18next ne rende pas
 *      la clé brute à l'écran — exactement la panne silencieuse que ce correctif doit éliminer.
 *   2. Laisser planter (exception non rattrapée). Rejeté : un `409` métier bien formé ne doit
 *      jamais faire planter un écran, invariant n°8 du produit (aucun refus sans chemin de sortie
 *      pour l'utilisateur, même dégradé).
 *   3. **Synthétiser `ERREUR_INTERNE`** (comportement retenu, inchangé par ce correctif) : le
 *      garagiste voit un message stable et traduit, avec une action claire (« réessayez »).
 *      Ce n'est plus un mode de panne SILENCIEUX depuis ce correctif : le `code` réel et l'URL
 *      sont journalisés en `console.error` ci-dessous, ce qui rend l'écart visible en
 *      développement, en CI (logs de test) et via toute supervision qui capte la console
 *      (ex. Sentry `captureConsoleIntegration`, hors périmètre ici). Le jour où `CODES_ERREUR`
 *      grandit (V1, voir docs/plan-lot1-frontend-execution.md §2.1), ce repli redevient
 *      transparent sans aucun changement de code ici. */
export function construireErreurApi(reponse: Response, corpsTexte: string): ErreurApi {
  const contentType = reponse.headers.get('content-type') ?? '';
  if (contentType.includes('application/problem+json') && corpsTexte.length > 0) {
    try {
      const candidat: unknown = JSON.parse(corpsTexte);
      if (estFormeProblemeValide(candidat)) {
        if (estCodeErreurConnu(candidat.code)) {
          // `estCodeErreurConnu` ne narrowe que la lecture `candidat.code`, pas le type de
          // `candidat` dans son ensemble (TS ne remonte pas la narrowing d'une propriété au
          // type de l'objet porteur) : on reconstruit donc explicitement un `ProblemeDetail`
          // dont le `code` est bien typé `CodeErreur`, plutôt que d'élargir `ProblemeDetail`
          // pour accepter un `code: string` — ça aurait fait fuiter l'incertitude jusqu'à
          // `messageErreur`, qui doit pouvoir compter sur un `code` toujours connu du contrat.
          const probleme: ProblemeDetail = { ...candidat, code: candidat.code };
          return new ErreurApi(probleme, lireRetryApres(reponse));
        }
        // Corps RFC 9457 par ailleurs impeccable (blocages, actionsProposees potentiellement
        // inclus) mais `code` que ce front ne sait pas encore traduire — voir le bloc de
        // commentaire ci-dessus. Sans ce log, ce cas était totalement invisible : ni test, ni
        // lint, ni CI ne le détectait (voir docs/plan-lot1-frontend-execution.md §2.1).
        console.error(
          `[erreurs] Code d'erreur inconnu du front reçu depuis ${reponse.url || 'une URL non disponible'} : "${candidat.code}". ` +
            'ERREUR_INTERNE est synthétisé en repli — voir le commentaire de construireErreurApi pour la justification.',
        );
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
    const minutes = erreur.retryApresSecondes
      ? Math.max(1, Math.ceil(erreur.retryApresSecondes / 60))
      : 1;
    return t(`erreurs:codes.${erreur.probleme.code}`, { minutes });
  }
  return t('erreurs:inattendue.description');
}

/**
 * Codes natifs de `ZodIssue.code` (zod 4, `node_modules/zod/v4/core/errors.d.ts`) — liste
 * FERMÉE, à ne pas confondre avec un code métier (`ErreurMetier`, snake_case français, ex.
 * `adresse_active_unique`). `PipeZod` (apps/api/src/common/validation/pipe-zod.ts) recopie
 * `issue.code` et `issue.message` TELS QUELS dans `ProblemeDetail.erreurs[]` — pour un code zod
 * natif, `message` est donc le texte généré par zod, presque toujours en ANGLAIS (« Too big:
 * expected string to have <=200 characters »), qui ne doit JAMAIS atteindre un garagiste tel
 * quel. Un code absent de cette liste vient d'un `ErreurMetier` rédigé à la main côté backend, en
 * français, pour ce cas précis — affichable directement (voir `messageErreurChamp`).
 */
const CODES_ISSUE_ZOD = [
  'invalid_type',
  'invalid_value',
  'too_big',
  'too_small',
  'invalid_format',
  'not_multiple_of',
  'unrecognized_keys',
  'invalid_union',
  'invalid_key',
  'invalid_element',
  'custom',
  // zod 3 (compatibilité défensive, au cas où une dépendance transitive encoderait encore
  // l'ancien nom) : `invalid_string` est devenu `invalid_format` en zod 4.
  'invalid_string',
] as const;

function estMessageMetierFrancais(erreurChamp: ErreurChamp): boolean {
  return !(CODES_ISSUE_ZOD as readonly string[]).includes(erreurChamp.code);
}

/**
 * Traduit une erreur de champ (`ProblemeDetail.erreurs[]`) pour affichage SOUS le champ fautif
 * d'un formulaire — jamais dans le bandeau générique d'écran (`messageErreur`), qui reste utile
 * en complément pour les erreurs qui ne visent aucun champ précis.
 *
 * - Code MÉTIER (`ErreurMetier`) : `message` est rédigé en français par le backend pour ce cas
 *   précis (ex. « Une adresse « principale » active existe déjà. ») — affiché tel quel.
 * - Code natif ZOD (`CODES_ISSUE_ZOD`) : `message` n'est JAMAIS affiché tel quel. Un repli connu
 *   et déjà traduit est utilisé quand le nom du champ permet de lever l'ambiguïté sans risque
 *   (ex. `email`), sinon repli générique existant (`erreurs:codes.VALIDATION_ECHOUEE`).
 *
 * MANQUE CONNU (i18n, hors périmètre d'écriture ici) : des clés `validation:formatInvalide` et
 * `validation:longueurMax` généralistes rendraient ce repli plus précis que le message d'écran
 * générique actuel pour `too_big`/`invalid_type`/etc. — voir le rapport de livraison du correctif
 * qui a introduit cette fonction.
 */
export function messageErreurChamp(erreurChamp: ErreurChamp, t: TFunction): string {
  if (estMessageMetierFrancais(erreurChamp)) {
    return erreurChamp.message;
  }
  const nomChamp = erreurChamp.champ.split('.').pop();
  if (
    nomChamp === 'email' &&
    (erreurChamp.code === 'invalid_format' || erreurChamp.code === 'invalid_string')
  ) {
    return t('validation:email.invalide');
  }
  return t('erreurs:codes.VALIDATION_ECHOUEE');
}
