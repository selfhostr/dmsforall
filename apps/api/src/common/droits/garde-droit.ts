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
import { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import { ErreurMetier } from '../erreurs/erreur-metier';

export const CLE_META_ACTION = 'dfa:action';

/** Déclare l'action requise sur un handler de contrôleur : `@ExigerDroit('socle.tenant.lire')`. */
export const ExigerDroit = (action: Action): MethodDecorator & ClassDecorator => SetMetadata(CLE_META_ACTION, action);

/**
 * Guard d'autorisation par action, à poser en complément de `GardeSession` via
 * `@UseGuards(GardeDroit)` sur les routes qui en ont besoin. Comme `GardeSession` est un
 * `APP_GUARD` global, il s'exécute avant tout guard posé au niveau contrôleur/route : le
 * principal est donc déjà attaché au contexte de requête quand `GardeDroit` s'exécute.
 * Aucun `if (role === …)` dispersé : tout passe par `MATRICE_DROITS`, centralisée côté auth.
 */
@Injectable()
export class GardeDroit implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  canActivate(contexteExecution: ExecutionContext): boolean {
    const action = this.reflector.getAllAndOverride<Action | undefined>(CLE_META_ACTION, [
      contexteExecution.getHandler(),
      contexteExecution.getClass(),
    ]);
    if (!action) {
      // Pas de `@ExigerDroit` posé sur cette route : ce guard n'a rien à vérifier
      // (la route reste protégée par GardeSession si elle n'est pas @Public).
      return true;
    }

    const principal = this.contexte.exigerPrincipal();
    const droitsDuRole: readonly Action[] = MATRICE_DROITS[principal.role] ?? [];
    if (!droitsDuRole.includes(action)) {
      throw new ErreurMetier('DROIT_INSUFFISANT', `Le rôle "${principal.role}" n'a pas le droit "${action}".`);
    }
    return true;
  }
}
