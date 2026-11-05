import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du tableau de bord — DUPLIQUÉE ici depuis `apps/api/src/tableau-bord/
 * droits-provisoires.ts` (frontière tenant/serveur jamais franchie, même doctrine que
 * `ecrans/pieces/droits.ts`) : un défensif d'ERGONOMIE, pas la seule ligne de défense. Un rôle
 * sans le droit qui atteindrait quand même l'endpoint reçoit un `403 DROIT_INSUFFISANT` géré
 * normalement côté écran — le serveur reste l'arbitre final.
 *
 * `GET /tableau-bord/activite` : ouvert à tout rôle de PERSONNE sauf `poste_atelier` (la borne
 * murale partagée n'a pas d'usage tableau de bord). Consommée par `navigation-modele.ts`
 * (`composants/layout/`) pour l'entrée de menu — la garde RÉELLE de l'écran est la route
 * (`ROLES_TABLEAU_BORD_ACTIVITE`, `routes/routeur.tsx`), pas un prédicat local ici : le bloc
 * financier (`direction`/`comptable` seuls, RF-115) n'a pas de garde locale non plus depuis le
 * passage à un dashboard PAR RÔLE (`EcranTableauBord.tsx`, arbitrage @laupernoe du 10.08.2026) — seuls
 * `TableauBordDirection`/`TableauBordComptable` montent structurellement le bloc financier, les
 * autres composants de rôle ne le contiennent pas, vérifié par `EcranTableauBord.spec.tsx` (test
 * F8, non-fuite).
 */
export const ROLES_TABLEAU_BORD_ACTIVITE: readonly RoleUtilisateur[] = [
  'technicien',
  'magasinier',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'comptable',
  'direction',
  'admin',
];
