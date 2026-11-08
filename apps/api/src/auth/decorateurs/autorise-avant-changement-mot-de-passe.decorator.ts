/**
 * `@AutoriseAvantChangementMotDePasse()` (issue #58) -- marque les rares routes authentifiées qui
 * restent accessibles tant que la personne n'a pas remplacé son mot de passe temporaire : lire sa
 * session (`GET /auth/moi`) et changer son mot de passe. La déconnexion est `@Public()` et passe
 * déjà. TOUTE autre route authentifiée est refusée en `403 AUTH_CHANGEMENT_MOT_DE_PASSE_REQUIS`
 * par `GardeSession` -- le refus est côté serveur, jamais seulement une redirection de l'interface.
 */
import { SetMetadata } from '@nestjs/common';

export const CLE_META_AVANT_CHANGEMENT_MDP = 'dfa:autorise-avant-changement-mdp';

export const AutoriseAvantChangementMotDePasse = () =>
  SetMetadata(CLE_META_AVANT_CHANGEMENT_MDP, true);
