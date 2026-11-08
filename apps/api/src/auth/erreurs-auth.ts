/**
 * Exceptions du module auth.
 *
 * Chacune porte un `CodeErreur` du contrat partagé (`@dfa/shared`) dans le corps de la réponse
 * NestJS (`getResponse()`), aux côtés d'un `message` humain FR. Le filtre d'exception global
 * (`apps/api/src/common/`, hors périmètre de ce module) est responsable de transformer ce corps
 * en `ProblemeDetail` complet (`type`, `title`, `instance` = requeteId, etc.) — ce fichier ne
 * connaît que le `code` et le `status` HTTP, qui sont la partie du contrat qui nous appartient.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { CodeErreur, ErreurChamp } from '@dfa/shared';

export interface CorpsErreurAuth {
  readonly code: CodeErreur;
  readonly message: string;
  readonly retryApresSecondes?: number;
  readonly erreurs?: ReadonlyArray<ErreurChamp>;
}

export abstract class ErreurAuth extends HttpException {
  protected constructor(status: number, corps: CorpsErreurAuth) {
    super(corps, status);
  }

  get code(): CodeErreur {
    return (this.getResponse() as CorpsErreurAuth).code;
  }
}

/** 400 — corps de `POST /auth/connexion` ne respectant pas `schemaConnexion`. */
export class ErreurValidation extends ErreurAuth {
  constructor(erreurs: ReadonlyArray<ErreurChamp>) {
    super(HttpStatus.BAD_REQUEST, {
      code: 'VALIDATION_ECHOUEE',
      message: 'Requête invalide.',
      erreurs,
    });
  }
}

/** 401 — email inconnu OU mot de passe faux. Ces deux cas sont RIGOUREUSEMENT indifférenciés. */
export class ErreurIdentifiantsInvalides extends ErreurAuth {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, {
      code: 'AUTH_IDENTIFIANTS_INVALIDES',
      message: 'Identifiants invalides.',
    });
  }
}

/** 401 — aucun cookie de session présent sur une route qui en exige un. */
export class ErreurSessionAbsente extends ErreurAuth {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, {
      code: 'AUTH_SESSION_ABSENTE',
      message: 'Aucune session active.',
    });
  }
}

/** 403 — mot de passe temporaire jamais remplacé (issue #58) : seule la route de changement passe. */
export class ErreurChangementMotDePasseRequis extends ErreurAuth {
  constructor() {
    super(HttpStatus.FORBIDDEN, {
      code: 'AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS',
      message: 'Vous devez choisir votre propre mot de passe avant de continuer.',
    });
  }
}

/** 401 — cookie présent mais session inconnue, révoquée, ou expirée (absolu ou glissant). */
export class ErreurSessionExpiree extends ErreurAuth {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, {
      code: 'AUTH_SESSION_EXPIREE',
      message: 'Session expirée, merci de vous reconnecter.',
    });
  }
}

/** 403 — compte existant mais `statut !== 'actif'` (invité ou suspendu). */
export class ErreurCompteSuspendu extends ErreurAuth {
  constructor() {
    super(HttpStatus.FORBIDDEN, {
      code: 'AUTH_COMPTE_SUSPENDU',
      message: 'Ce compte est suspendu.',
    });
  }
}

/** 403 — mot de passe correct mais tenant du compte `statut !== 'actif'`. */
export class ErreurTenantSuspendu extends ErreurAuth {
  constructor() {
    super(HttpStatus.FORBIDDEN, {
      code: 'AUTH_TENANT_SUSPENDU',
      message: "L'accès de votre entreprise est suspendu.",
    });
  }
}

/** 403 — méthode mutante (≠ GET/HEAD) sans en-tête `Origin` valide. */
export class ErreurOrigineRefusee extends ErreurAuth {
  constructor() {
    super(HttpStatus.FORBIDDEN, {
      code: 'AUTH_ORIGINE_REFUSEE',
      message: 'Origine de la requête refusée.',
    });
  }
}

/**
 * 403 — un COMPTE DE SERVICE (borne d'atelier) tente d'agir sur un site autre que le sien
 * (`utilisateur.site_id`, migration 0039). Levée par `verifierSiteAutorise()`
 * (`auth/comptes-de-service.ts`).
 *
 * Réutilise `DROIT_INSUFFISANT` plutôt qu'un code neuf : le comportement attendu côté client est
 * exactement celui d'un droit manquant (afficher, ne pas réessayer), et le contrat d'erreur ne
 * gagne rien à distinguer une portée d'une permission. Ce n'est PAS un 404 : le site existe dans
 * le tenant de l'appelant, il n'y a rien à dissimuler — seule l'action est refusée. Le `message`
 * reste spécifique, c'est ce que lit un exploitant dans les logs.
 */
export class ErreurSiteHorsPortee extends ErreurAuth {
  constructor() {
    super(HttpStatus.FORBIDDEN, {
      code: 'DROIT_INSUFFISANT',
      message: 'Ce poste est rattaché à un autre site : action refusée.',
    });
  }
}

/** 423 — compte verrouillé (verrouillage progressif après échecs répétés). */
export class ErreurCompteVerrouille extends ErreurAuth {
  constructor(retryApresSecondes: number) {
    super(423 /* Locked — absent de HttpStatus dans certaines versions de @nestjs/common */, {
      code: 'AUTH_COMPTE_VERROUILLE',
      message: 'Compte temporairement verrouillé après plusieurs échecs.',
      retryApresSecondes,
    });
  }
}

/** 429 — trop de tentatives de connexion (par IP ou par email) sur la fenêtre glissante. */
export class ErreurTropDeTentatives extends ErreurAuth {
  constructor(retryApresSecondes: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, {
      code: 'AUTH_TROP_DE_TENTATIVES',
      message: 'Trop de tentatives de connexion, réessayez plus tard.',
      retryApresSecondes,
    });
  }
}

/**
 * 400 — `POST /auth/mot-de-passe/reinitialisation` : email inconnu, jeton inconnu/expiré/déjà
 * utilisé/révoqué, ou compte/tenant non actif. RIGOUREUSEMENT indifférenciés (anti-énumération,
 * même doctrine qu'`ErreurIdentifiantsInvalides`) — voir `ServiceReinitialisationMotDePasse
 * .confirmer` (`auth.types.ts`).
 */
export class ErreurJetonReinitialisationInvalide extends ErreurAuth {
  constructor() {
    super(HttpStatus.BAD_REQUEST, {
      code: 'AUTH_JETON_REINITIALISATION_INVALIDE',
      message: 'Ce lien de réinitialisation est invalide, expiré, ou a déjà été utilisé.',
    });
  }
}
