import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// NOTE D'INTERPRÉTATION — AMBIGUÏTÉ DE CONTRAT SIGNALÉE (voir réponse de tâche) : le contrat
// §2.10 place `MATRICE_DROITS` et le type `Action` dans apps/api/src/auth/ (propriété
// expert-auth) sans préciser ni le nom de fichier ni de guard d'autorisation par action
// réutilisable par les futurs modules métier. Au moment d'écrire ce fichier, apps/api/src/auth/
// ne contient que auth.types.ts, jetons.ts, erreurs-auth.ts et services/ (pas encore de
// GardeSession ni de MATRICE_DROITS) : le chemin d'import ci-dessous ('../../auth/matrice-droits')
// est une hypothèse de nommage, pas un fait vérifié. Ce guard générique est volontairement placé
// ici (common/droits/, propriété expert-nestjs) pour rester réutilisable par tous les futurs
// modules métier (pas seulement socle). À CONFIRMER avec expert-auth : nom réel du fichier/export,
// et s'assurer qu'aucun mécanisme équivalent n'est dupliqué côté auth/.
import { MATRICE_DROITS, type Action } from '../../auth/matrice-droits';
// Lecture seule de la métadonnée `@Public()` (propriété expert-auth, auth/decorateurs/public.decorator.ts) :
// GardeDroit ne définit ni ne modifie ce décorateur, il se contente de le reconnaître pour qu'une
// route publique n'ait pas besoin de porter EN PLUS `@AucunDroitRequis()` — voir le commentaire de
// `canActivate` ci-dessous sur le passage en refus par défaut.
import { CLE_META_PUBLIC } from '../../auth/decorateurs/public.decorator';
import { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import { ErreurMetier } from '../erreurs/erreur-metier';

export const CLE_META_ACTION = 'dfa:action';
export const CLE_META_AUCUN_DROIT = 'dfa:aucun-droit';

/** Déclare l'action requise sur un handler de contrôleur : `@ExigerDroit('socle.tenant.lire')`. */
export const ExigerDroit = (action: Action): MethodDecorator & ClassDecorator => SetMetadata(CLE_META_ACTION, action);

/**
 * Déclare EXPLICITEMENT qu'une route authentifiée ne requiert aucun droit particulier — tout
 * principal authentifié y accède (ex. `GET /auth/moi` : lire sa propre session). À poser en plus
 * de `@UseGuards(GardeDroit)`, jamais à la place de `@ExigerDroit` quand une action existe.
 *
 * Existe pour rendre l'intention lisible plutôt que de la laisser se déduire d'une absence de
 * décorateur — depuis que `GardeDroit` refuse par défaut (voir `canActivate`), une route sans
 * AUCUN des trois marqueurs (`@Public`, `@ExigerDroit`, `@AucunDroitRequis`) est une route cassée,
 * pas une route ouverte : ce décorateur est la seule façon correcte d'obtenir « authentifié
 * suffit ».
 */
export const AucunDroitRequis = (): MethodDecorator & ClassDecorator => SetMetadata(CLE_META_AUCUN_DROIT, true);

/**
 * Guard d'autorisation par action, à poser en complément de `GardeSession` via
 * `@UseGuards(GardeDroit)` sur les routes qui en ont besoin. Comme `GardeSession` est un
 * `APP_GUARD` global, il s'exécute avant tout guard posé au niveau contrôleur/route : le
 * principal est donc déjà attaché au contexte de requête quand `GardeDroit` s'exécute.
 * Aucun `if (role === …)` dispersé : tout passe par `MATRICE_DROITS`, centralisée côté auth.
 *
 * --- Refus par défaut (durci pour le lot 1) --------------------------------------------------
 * Avant ce durcissement, une route sans `@ExigerDroit` rendait `true` sans rien vérifier — donc
 * accessible à tout rôle authentifié dès que `@UseGuards(GardeDroit)` était posé sur le
 * contrôleur mais qu'UNE méthode oubliait `@ExigerDroit`. Tolérable sur les 2 actions du socle,
 * intenable sur les 54 actions du lot 1 réparties sur une douzaine de contrôleurs : l'oubli d'un
 * seul décorateur ouvrait silencieusement une route en écriture à n'importe quel rôle, sans test
 * rouge ni avertissement de lint.
 *
 * Désormais, une route qui atteint ce guard (donc décorée `@UseGuards(GardeDroit)`) DOIT porter
 * exactement l'un des trois marqueurs suivants, sinon l'accès est REFUSÉ (`403
 * DROIT_INSUFFISANT`) — l'oubli devient une panne visible dès la première requête de
 * développement, pas une faille silencieuse en production :
 *   1. `@Public()` (métadonnée `auth/decorateurs/public.decorator.ts`) — route publique,
 *      reconnue ici en pure défense en profondeur : `GardeSession` (APP_GUARD global) laisse déjà
 *      passer ces routes sans y attacher de principal, donc `GardeDroit` ne doit jamais leur
 *      opposer `exigerPrincipal()`, que ce guard soit ou non posé explicitement dessus.
 *   2. `@ExigerDroit(action)` — vérifié contre `MATRICE_DROITS[role]`, comportement inchangé.
 *   3. `@AucunDroitRequis()` — authentifié suffit, déclaré explicitement (ex. `GET /auth/moi`).
 * ------------------------------------------------------------------------------------------------
 */
@Injectable()
export class GardeDroit implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  canActivate(contexteExecution: ExecutionContext): boolean {
    const cibles = [contexteExecution.getHandler(), contexteExecution.getClass()];

    const estPublic = this.reflector.getAllAndOverride<boolean | undefined>(CLE_META_PUBLIC, cibles);
    if (estPublic) return true;

    const action = this.reflector.getAllAndOverride<Action | undefined>(CLE_META_ACTION, cibles);
    if (action) {
      const principal = this.contexte.exigerPrincipal();
      const droitsDuRole: readonly Action[] = MATRICE_DROITS[principal.role] ?? [];
      if (!droitsDuRole.includes(action)) {
        throw new ErreurMetier('DROIT_INSUFFISANT', `Le rôle "${principal.role}" n'a pas le droit "${action}".`);
      }
      return true;
    }

    const aucunDroitRequis = this.reflector.getAllAndOverride<boolean | undefined>(CLE_META_AUCUN_DROIT, cibles);
    if (aucunDroitRequis) {
      // Authentifié suffit : on exige quand même un principal résolu (cohérence avec le reste du
      // guard, et défense en profondeur si jamais posé sur une route qui n'est pas derrière
      // GardeSession).
      this.contexte.exigerPrincipal();
      return true;
    }

    // Ni @Public, ni @ExigerDroit, ni @AucunDroitRequis : route mal décorée. Refus par défaut —
    // voir le commentaire d'en-tête de la classe.
    throw new ErreurMetier(
      'DROIT_INSUFFISANT',
      'Route sans déclaration de droit (@ExigerDroit ou @AucunDroitRequis manquant) : accès refusé par défaut.',
    );
  }
}
