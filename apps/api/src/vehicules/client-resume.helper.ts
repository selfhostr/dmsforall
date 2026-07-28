import type { LigneClient } from '../db/schema';

/**
 * Rendu d'affichage d'un client (`raisonSociale`, ou `nom prenom`) — DUPLICATION MINIMALE ET
 * ASSUMÉE de la règle canonique du module `clients/` (propriété d'un autre agent, L1-08,
 * développé en parallèle et hors de mon périmètre `apps/api/src/vehicules/**`). Le contexte-atelier
 * (§8.1) et la projection de détention (`ReponseVehiculeDetention.client.nomAffiche`) ont besoin de
 * ce calcul ; l'importer depuis `clients/` créerait une dépendance de compilation entre deux
 * répertoires livrés en parallèle par deux agents différents. À terme, cette règle devrait vivre
 * une seule fois (ex. `common/` ou `@dfa/shared`) — signalé, pas résolu ici.
 */
export function calculerNomAfficheClient(ligne: Pick<LigneClient, 'type' | 'nom' | 'prenom' | 'raisonSociale'>): string {
  if (ligne.type === 'entreprise') {
    return ligne.raisonSociale ?? '';
  }
  return [ligne.nom, ligne.prenom].filter((partie) => Boolean(partie && partie.trim())).join(' ');
}
